/** Host-owned immutable history. Personal recovery drafts are supplied separately. */
export interface DocumentHistoryVersion {
  readonly id: string
  readonly savedAt: string | null
  readonly kind: string
  readonly title: string
}
export interface DocumentHistorySnapshot extends DocumentHistoryVersion { readonly markdown: string }
export interface DocumentHistoryPage { readonly versions: readonly DocumentHistoryVersion[]; readonly nextCursor: string | null }
export interface DocumentHistoryServices {
  list(documentId: string, cursor?: string, signal?: AbortSignal): Promise<DocumentHistoryPage>
  get(documentId: string, versionId: string, signal?: AbortSignal): Promise<DocumentHistorySnapshot>
}
