/** Navigation state belongs to one mounted reader, never to the saved document. */
export function readerScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

export function installReaderHeadingReturns(root: HTMLElement, label: () => string): () => void {
  const headingSelector = 'h1,h2,h3,h4,h5,h6'
  const returns = new WeakMap<HTMLElement, { link: HTMLAnchorElement; href: string; index: number }>()
  let highlighted: HTMLElement | null = null
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  const clearHighlight = () => {
    clearTimeout(highlightTimer)
    highlighted?.classList.remove('nwu-reader-toc-returned')
    highlighted = null
  }
  const linksFor = (href: string) => [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .filter(link => link.getAttribute('href') === href)

  function handle(event: MouseEvent | KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (event instanceof MouseEvent && event.button !== 0) return
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
    const element = event.target instanceof Element ? event.target : null
    const editor = element?.closest<HTMLElement>('.ProseMirror[data-presentation-mode="readonly"]')
    if (!element || !editor || !root.contains(editor)) return
    const link = element.closest<HTMLAnchorElement>('a[href]')
    if (link) {
      // Observe forward navigation before the renderer handles it. Do not change its behavior.
      if (event instanceof KeyboardEvent) return
      const href = link.getAttribute('href') ?? ''
      if (!href.startsWith('#') || href.length < 2) return
      const anchors = new Set([href.slice(1)])
      try {
        const decoded = decodeURIComponent(href.slice(1))
        anchors.add(decoded); anchors.add(encodeURIComponent(decoded))
      } catch { /* Literal malformed anchors can still be valid targets. */ }
      const target = [...editor.querySelectorAll<HTMLElement>('[id],a[name]')]
        .find(candidate => anchors.has(candidate.id) || anchors.has(candidate.getAttribute('name') ?? ''))
      if (!target) return
      const heading = target.closest<HTMLElement>(headingSelector)
        ?? [...editor.querySelectorAll<HTMLElement>(headingSelector)]
          .find(candidate => target.contains(candidate) || Boolean(target.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING))
      if (!heading) return
      returns.set(heading, { link, href, index: linksFor(href).indexOf(link) })
      heading.classList.add('nwu-reader-return-heading')
      heading.setAttribute('tabindex', '0')
      heading.setAttribute('title', label())
      return
    }
    if (element.closest('button,input,select,textarea,summary')) return
    if (event instanceof MouseEvent && window.getSelection()?.isCollapsed === false) return
    const heading = element.closest<HTMLElement>(headingSelector)
    const destination = heading ? returns.get(heading) : undefined
    if (!destination) return
    // Generated TOC node views may replace their anchors after a selection transaction.
    const entry = root.contains(destination.link) ? destination.link : linksFor(destination.href)[destination.index]
    if (!entry) return
    event.preventDefault()
    event.stopPropagation()
    entry.scrollIntoView?.({ block: 'center', behavior: readerScrollBehavior() })
    entry.focus({ preventScroll: true })
    clearHighlight()
    highlighted = entry
    entry.classList.add('nwu-reader-toc-returned')
    highlightTimer = setTimeout(clearHighlight, 1600)
  }
  root.addEventListener('click', handle, true)
  root.addEventListener('keydown', handle, true)
  return () => {
    root.removeEventListener('click', handle, true)
    root.removeEventListener('keydown', handle, true)
    clearHighlight()
  }
}
