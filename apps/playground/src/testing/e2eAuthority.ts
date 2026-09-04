export type InspectableEditorMode = 'source' | 'visual' | 'preview'

export interface AuthoritySnapshot {
  readonly actionCount: number
  readonly autosaveStatus: 'failed' | 'idle' | 'pending' | 'saved' | 'saving'
  readonly documentId: string
  readonly markdown: string
  readonly mode: InspectableEditorMode
  readonly revision: number
  readonly synchronizationStatus: 'failed' | 'pending' | 'running' | 'synchronized' | 'waiting-composition'
}

export interface AuthorityInspection {
  readonly read: () => Readonly<AuthoritySnapshot>
}

export function installAuthorityInspection(readAuthority: () => AuthoritySnapshot): void {
  const inspection = Object.freeze({
    read: (): Readonly<AuthoritySnapshot> => Object.freeze({ ...readAuthority() }),
  })

  Object.defineProperty(window, '__W_EDITOR_AUTHORITY__', {
    configurable: true,
    enumerable: false,
    value: inspection,
    writable: false,
  })
}
