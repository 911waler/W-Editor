"""Static entry rollout must refuse drift and preserve unrelated assets."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/install-webvpn-compat.py'


def fixture(tmp_path):
    root, package, backup = (tmp_path / name for name in ('web', 'package', 'backup'))
    root.mkdir()
    package.mkdir()
    originals = {'index.html': b'old index', 'drawio-bridge.html': b'old bridge', 'original.js': b'original'}
    outputs = {'index.html': b'new index', 'drawio-bridge.html': b'new bridge', 'index-classic-abc.js': b'new js'}
    for name, data in originals.items():
        (root / name).write_bytes(data)
    for name, data in outputs.items():
        (package / name).write_bytes(data)
    digest = lambda data: hashlib.sha256(data).hexdigest()
    (package / 'manifest.json').write_text(json.dumps({'version': 1, 'entries': {'index.html': 'index-classic-abc.js'},
        'sourceHashes': {name: digest(data) for name, data in originals.items()},
        'outputHashes': {name: digest(data) for name, data in outputs.items()}}))
    return root, package, backup


def run(root, package, backup, *flags):
    return subprocess.run([sys.executable, str(SCRIPT), str(root), str(package), str(backup), *flags], capture_output=True, text=True)


def test_apply_and_rollback_preserve_original_assets(tmp_path):
    root, package, backup = fixture(tmp_path)
    assert run(root, package, backup).returncode == 0
    assert not backup.exists()
    assert (root / 'index.html').read_bytes() == b'old index'
    result = run(root, package, backup, '--apply')
    assert result.returncode == 0, result.stderr
    assert (root / 'index.html').read_bytes() == b'new index'
    assert (root / 'original.js').read_bytes() == b'original'
    assert run(root, package, backup, '--rollback').returncode == 0
    assert (root / 'index.html').read_bytes() == b'old index'
    assert (root / 'drawio-bridge.html').read_bytes() == b'old bridge'
    assert (root / 'original.js').read_bytes() == b'original'


def test_refuses_source_drift_without_modifications(tmp_path):
    root, package, backup = fixture(tmp_path)
    (root / 'original.js').write_bytes(b'newer production')
    result = run(root, package, backup, '--apply')
    assert result.returncode != 0
    assert 'Hash mismatch: original.js' in result.stderr
    assert not backup.exists()
    assert (root / 'index.html').read_bytes() == b'old index'


def test_refuses_corrupt_package_without_modifications(tmp_path):
    root, package, backup = fixture(tmp_path)
    (package / 'index-classic-abc.js').write_bytes(b'corrupt')
    result = run(root, package, backup, '--apply')
    assert result.returncode != 0
    assert 'Hash mismatch: index-classic-abc.js' in result.stderr
    assert not backup.exists()
    assert (root / 'index.html').read_bytes() == b'old index'


def test_mid_install_failure_restores_both_entries(tmp_path, monkeypatch):
    root, package, backup = fixture(tmp_path)
    spec = importlib.util.spec_from_file_location('webvpn_install', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original_replace = module.replace

    def fail_index_once(path, data):
        if path.name == 'index.html' and data == b'new index':
            raise OSError('simulated disk write failure')
        original_replace(path, data)

    monkeypatch.setattr(module, 'replace', fail_index_once)
    monkeypatch.setattr(sys, 'argv', [str(SCRIPT), str(root), str(package), str(backup), '--apply'])
    with pytest.raises(OSError, match='simulated'):
        module.main()
    assert (root / 'index.html').read_bytes() == b'old index'
    assert (root / 'drawio-bridge.html').read_bytes() == b'old bridge'
    assert (root / 'original.js').read_bytes() == b'original'
    assert run(root, package, backup, '--rollback').returncode == 0


def test_rollback_refuses_to_overwrite_newer_release(tmp_path):
    root, package, backup = fixture(tmp_path)
    assert run(root, package, backup, '--apply').returncode == 0
    (root / 'index.html').write_bytes(b'newer release')
    result = run(root, package, backup, '--rollback')
    assert result.returncode != 0
    assert 'Entry changed after installation' in result.stderr
    assert (root / 'index.html').read_bytes() == b'newer release'
    assert (root / 'drawio-bridge.html').read_bytes() == b'new bridge'
