#!/usr/bin/env python3
"""Check/apply a static-only compatibility release; never restart the service.

ROOT PACKAGE BACKUP defaults to validation. --apply backs up entry documents
before atomic replacement. --rollback restores only those entry documents.
New hash-named JS is retained so already-open pages can finish loading.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

PAGES = ('drawio-bridge.html', 'index.html')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_path(root, name):
    path = (root / name).resolve()
    if path == root or root not in path.parents:
        raise ValueError('Path escapes root: ' + name)
    return path


def verify(root, hashes):
    for name, expected in hashes.items():
        if digest(safe_path(root, name)) != expected:
            raise ValueError('Hash mismatch: ' + name)


def replace(path, data):
    fd, temporary = tempfile.mkstemp(prefix='.webvpn-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('root', 'package', 'backup'):
        parser.add_argument(name, type=Path)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--apply', action='store_true')
    actions.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    root, package, backup = [path.resolve() for path in (args.root, args.package, args.backup)]
    if backup == root or root in backup.parents:
        raise ValueError('Backup must be outside public assets')
    if args.rollback:
        journal = json.loads((backup / 'journal.json').read_text())
        if journal['root'] != str(root):
            raise ValueError('Backup belongs to another root')
        verify(backup, journal['original'])
        for page, expected in journal['installed'].items():
            if digest(root / page) not in (expected, journal['original'][page]):
                raise ValueError('Entry changed after installation: ' + page)
        for page in journal['original']:
            replace(root / page, (backup / page).read_bytes())
        verify(root, journal['original'])
        print('ROLLBACK VERIFIED')
        return
    manifest = json.loads((package / 'manifest.json').read_text())
    if manifest['version'] != 1 or 'index.html' not in manifest['entries']:
        raise ValueError('Unsupported package')
    outputs = manifest['outputHashes']
    pages = [page for page in PAGES if page in outputs]
    allowed = set(pages) | set(manifest['entries'].values())
    if set(outputs) != allowed or any('/' in name or not name.endswith('.js') for name in manifest['entries'].values()):
        raise ValueError('Unexpected output files')
    verify(package, outputs)
    verify(root, manifest['sourceHashes'])
    for name in outputs:
        target = safe_path(root, name)
        if name not in pages and target.exists() and digest(target) != outputs[name]:
            raise ValueError('Asset collision: ' + name)
    if not args.apply:
        print('CHECK VERIFIED; no files changed')
        return
    backup.mkdir(mode=0o700, parents=False, exist_ok=False)
    original = {page: digest(root / page) for page in pages}
    for page in pages:
        (backup / page).write_bytes((root / page).read_bytes())
    journal = {'root': str(root), 'original': original, 'installed': {page: outputs[page] for page in pages}}
    (backup / 'journal.json').write_text(json.dumps(journal, indent=2) + '\n')
    (backup / 'manifest.json').write_bytes((package / 'manifest.json').read_bytes())
    try:
        for name in outputs:
            if name not in pages:
                replace(root / name, (package / name).read_bytes())
        for page in pages:
            replace(root / page, (package / page).read_bytes())
        verify(root, outputs)
    except BaseException:
        for page in pages:
            replace(root / page, (backup / page).read_bytes())
        raise
    print('APPLY VERIFIED; original assets retained; backup=' + str(backup))


if __name__ == '__main__':
    main()
