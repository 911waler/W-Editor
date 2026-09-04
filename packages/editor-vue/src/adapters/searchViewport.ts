export interface SearchViewportCoordinates {
  readonly bottom: number
  readonly top: number
}

export function revealSearchCoordinates(
  editorRoot: HTMLElement,
  start: SearchViewportCoordinates | null,
  end: SearchViewportCoordinates | null,
): void {
  if (start === null || end === null) return
  const scroller = editorRoot.closest<HTMLElement>('.editor-surface')
  if (scroller === null) return
  const viewport = scroller.getBoundingClientRect()
  if (viewport.height <= 0) return
  const matchCenter = (Math.min(start.top, end.top) + Math.max(start.bottom, end.bottom)) / 2
  const targetCenter = viewport.top + viewport.height * 0.45
  scroller.scrollTop = Math.max(0, scroller.scrollTop + matchCenter - targetCenter)
}
