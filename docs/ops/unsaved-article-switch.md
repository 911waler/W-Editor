# Switching articles with unsaved text

The decision dialog now has three explicit choices:

- Cancel: cancel switching and keep editing.
- Save changes: manual save before switching. NWU updates existing article content while preserving its visibility; a new article is saved privately.
- Discard changes: replace the recovery body with the last saved body, then switch. New articles use their initial body. No article or media deletion and no publish request occurs.

Discard drains synchronization and previous autosave, persists the replacement before changing the live session, then flushes the normal autosave path. Failure retains the current article. A recovery record may still exist, but contains restored saved text rather than discarded text. Existing independent conflict-recovery archives are retained.

NWU tracks canonical saved Markdown separately from restored drafts. Successful manual save and publication advance the saved baseline; autosave does not. Publishing updates the captured article runtime even if the active article changes before the request completes. The shared service/UI also applies to future Windows builds from this source. No Windows build or GitHub push is part of this rollout.

Validation covers service discard success/failure and publish baseline, NWU canonical/draft separation, shared browser switching and reload, and a NWU host fixture with no manual-save request during discard.
