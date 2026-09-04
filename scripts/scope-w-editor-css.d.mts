export function scopeWEditorCssText(source: string, id?: string): string
export function createWEditorCssScopePlugin(): {
  readonly enforce: 'pre'
  readonly name: string
  readonly transform: (code: string, id: string) => { readonly code: string; readonly map: null } | null
}
