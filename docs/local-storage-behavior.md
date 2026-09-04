# Local storage and concurrent tabs

W-Editor version 1 stores one workspace envelope at `w-editor:v1:workspace` and one complete document envelope per fixed document at `w-editor:v1:document:<encoded-document-id>`.

The first-round application intentionally uses last-successful-write-wins behavior when two browser tabs edit the same document. It does not use `BroadcastChannel`, storage-event coordination, locks, revision-conflict detection, merging, or a conflict-resolution interface. Each successful persistence operation replaces the complete envelope under that document's deterministic key, so the last successful `localStorage.setItem` value is the recovery value loaded on the next startup.

This is a documented boundary, not a concurrency guarantee. Users should avoid editing the same fixed article in multiple tabs. A future change that adds concurrent editing must specify detection, ownership, merge, recovery, and UI behavior before changing this contract.

Malformed JSON and unsupported schema versions are different from concurrent writes: W-Editor retains those raw values, blocks normal overwrite, and requires raw export followed by explicit clear-and-reset.
