# Article switching and unsaved text

Add an explicit discard action to the existing switch decision. Restore the last manual save, or the initial text for new documents. NWU must use canonical server text as the initial baseline even when it restores a newer autosaved draft. Only Cancel, Discard changes and Save changes are offered. Download and keep-draft choices have been removed at the user’s request.

Implementation: separate saved text from recovery text in the NWU adapter; add a manual-checkpoint discard operation that drains synchronization/persistence and persists the replacement before changing the live session; let the ordinary autosave and switch guard finish with the restored text. Do not publish or delete an article during discard. On persistence error keep the article open. Discard concerns body text; existing metadata controls remain separate.

Validation: service failure/success tests, NWU baseline tests, browser edit → save → edit → autosave → discard → switch back → reload. Run types and lint. Build the committed Web bundle and deploy only to 7B12 port 18003 with a resource rollback and unchanged data check.
