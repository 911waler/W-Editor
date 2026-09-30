/** Copy during a user gesture, including private-network HTTP deployments. */
export async function copyText(text: string, owner: Document): Promise<boolean> {
  const clipboard = owner.defaultView?.navigator.clipboard
  if (clipboard !== undefined) {
    try { await clipboard.writeText(text); return true } catch { /* Try the user-gesture fallback. */ }
  }
  const focused = owner.activeElement
  const selection = owner.getSelection()
  const ranges = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
  const input = owner.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  owner.body.append(input)
  try {
    input.focus({ preventScroll: true })
    input.select()
    return owner.execCommand('copy')
  } catch { return false } finally {
    input.remove()
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true })
    if (selection !== null) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }
}
