import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { referenceMarkdown, referenceUrl, ReferenceRegistry, parseReferenceAt, type DocumentReference } from '@w-editor/editor-core'

export const ReferenceNode = Node.create({
  name: 'citation', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({
    id: { default: '', parseHTML: element => element.getAttribute('data-reference-id'), renderHTML: () => ({}) },
    number: { default: 1, parseHTML: element => Number(element.getAttribute('data-reference-number')), renderHTML: () => ({}) },
    text: { default: '', parseHTML: element => element.getAttribute('data-reference-text'), renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: 'a[data-reference-id]', priority: 100, getAttrs: element => {
    try {
      referenceMarkdown({ id: element.getAttribute('data-reference-id') ?? '', number: Number(element.getAttribute('data-reference-number')), text: element.getAttribute('data-reference-text') ?? '' })
      return null
    } catch { return false }
  } }],
  renderText: ({ node }) => referenceMarkdown(node.attrs as DocumentReference),
  renderHTML: ({ node, HTMLAttributes }) => ['a', mergeAttributes(HTMLAttributes, {
    'data-reference-id': node.attrs['id'], 'data-reference-number': node.attrs['number'],
    'data-reference-text': node.attrs['text'], href: `#reference-${String(node.attrs['id'])}`,
    class: 'w-reference', title: node.attrs['text'],
  }), `[${String(node.attrs['number'])}]`],
})

export function buildReferenceList(references: readonly DocumentReference[], doc: Document): HTMLElement {
  const section = doc.createElement('section')
  section.className = 'w-reference-list'
  section.setAttribute('aria-label', '参考文献 / References')
  section.setAttribute('contenteditable', 'false')
  const heading = doc.createElement('h2')
  heading.textContent = '参考文献 / References'
  section.append(heading)
  const unique = [...new Map(references.map(item => [item.id, item])).values()].sort((a, b) => a.number - b.number)
  for (const reference of unique) {
    const row = doc.createElement('p')
    row.id = `reference-${reference.id}`
    const back = doc.createElement('a')
    back.href = `#citation-${reference.id}`
    back.dataset['referenceBack'] = reference.id
    back.textContent = `[${reference.number}]`
    back.setAttribute('aria-label', `返回引用 ${reference.number} / Back to citation`)
    row.append(back, doc.createTextNode(' '))
    const url = referenceUrl(reference.text)
    const text = doc.createElement(url ? 'a' : 'span')
    text.textContent = reference.text
    if (url) { text.setAttribute('href', url); text.setAttribute('rel', 'noopener noreferrer'); text.setAttribute('target', '_blank') }
    row.append(text)
    section.append(row)
  }
  section.hidden = unique.length === 0
  return section
}

/** Event delegation scopes navigation to one editor, including repeated occurrences. */
export function bindReferenceNavigation(root: HTMLElement, editing: () => boolean): () => void {
  const origins = new Map<string, HTMLElement>()
  const click = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reference-id], [data-reference-back]') : null
    if (!target || !root.contains(target)) return
    event.preventDefault()
    const id = target.dataset['referenceId'] ?? target.dataset['referenceBack']!
    if (target.dataset['referenceId']) {
      origins.set(id, target)
      if (editing()) {
        root.dispatchEvent(new CustomEvent('w-reference-open', { bubbles: true, detail: { id } }))
        return
      }
    }
    const destination = target.dataset['referenceId']
      ? [...root.querySelectorAll<HTMLElement>('.w-reference-list p')].find(item => item.id === `reference-${id}`)
      : (origins.get(id)?.isConnected ? origins.get(id) : [...root.querySelectorAll<HTMLElement>('[data-reference-id]')].find(item => item.dataset['referenceId'] === id))
    destination?.scrollIntoView?.({ block: 'center' })
    if (destination) { destination.tabIndex = -1; destination.focus({ preventScroll: true }) }
  }
  root.addEventListener('click', click)
  return () => root.removeEventListener('click', click)
}

type PositionedReference = DocumentReference & { pos: number }
function collect(doc: PMNode): PositionedReference[] {
  const references: PositionedReference[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation') references.push({ id: String(node.attrs['id']), number: Number(node.attrs['number']), text: String(node.attrs['text']), pos })
  })
  return references
}

export const ReferenceBibliography = Extension.create<{ registry: ReferenceRegistry | null }>({
  name: 'referenceBibliography',
  addOptions: () => ({ registry: null }),
  addProseMirrorPlugins() {
    const editor = this.editor
    const registry = this.options.registry ?? new ReferenceRegistry()
    const plugin = new Plugin<PositionedReference[]>({
      props: {
        transformPasted: (slice, view) => {
          const known = collect(view.state.doc)
          registry.observe(known)
          const rewrite = (fragment: Fragment): Fragment => {
            const nodes: PMNode[] = []
            fragment.forEach(node => {
              if (node.type.name === 'citation') {
                const text = String(node.attrs['text'])
                const reference = registry.adopt({ id: String(node.attrs['id']), number: Number(node.attrs['number']), text })
                nodes.push(node.type.create(reference, null, node.marks))
              } else nodes.push(node.copy(rewrite(node.content)))
            })
            return Fragment.fromArray(nodes)
          }
          return new Slice(rewrite(slice.content), slice.openStart, slice.openEnd)
        },
      },
      state: {
        init: (_, state) => { const references = collect(state.doc); registry.observe(references); return references },
        apply: (transaction, previous) => {
          if (!transaction.docChanged) return previous
          // Ordinary text replacements only map existing positions; no full-document traversal.
          const touchesReference = transaction.steps.some(step => {
            const json = step.toJSON() as { stepType?: string; from?: number; to?: number; slice?: unknown }
            return json.stepType !== 'replace' || JSON.stringify(json.slice ?? '').includes('"citation"')
              || previous.some(item => item.pos >= (json.from ?? 0) && item.pos < (json.to ?? 0))
          })
          if (touchesReference) { const references = collect(transaction.doc); registry.observe(references); return references }
          return previous.map(item => ({ ...item, pos: transaction.mapping.map(item.pos, 1) }))
        },
      },
      view: view => {
        const root = view.dom.parentElement!
        let signature = ''
        let footer: HTMLElement | null = null
        const unbind = bindReferenceNavigation(root, () => editor.isEditable)
        const update = () => {
          const references = plugin.getState(view.state) ?? []
          const next = JSON.stringify(references.map(({ id, number, text }) => ({ id, number, text })))
          if (signature === next) return
          signature = next
          footer?.remove()
          footer = buildReferenceList(references, root.ownerDocument)
          root.append(footer)
          const seen = new Set<string>()
          for (const anchor of root.querySelectorAll<HTMLElement>('[data-reference-id]')) {
            const id = anchor.dataset['referenceId']!
            anchor.id = seen.has(id) ? '' : `citation-${id}`
            seen.add(id)
          }
        }
        update()
        return { update, destroy: () => { unbind(); footer?.remove() } }
      },
    })
    return [plugin]
  },
})

/** Cherry produces ordinary links; promote only our validated self-contained format. */
export function renderReferencesHtml(html: string, doc: Document): string {
  const root = doc.createElement('div')
  root.innerHTML = html
  const references: DocumentReference[] = []
  const seen = new Set<string>()
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="#wref-"]')) {
    const reference = parseReferenceAt(`[${anchor.textContent ?? ''}](${anchor.getAttribute('href') ?? ''})`, 0)
    if (!reference) continue
    references.push(reference)
    anchor.classList.add('w-reference')
    anchor.textContent = `[${reference.number}]`
    anchor.dataset['referenceId'] = reference.id
    anchor.dataset['referenceNumber'] = String(reference.number)
    anchor.dataset['referenceText'] = reference.text
    anchor.href = `#reference-${reference.id}`
    if (!seen.has(reference.id)) anchor.id = `citation-${reference.id}`
    seen.add(reference.id)
  }
  if (references.length) root.append(buildReferenceList(references, doc))
  return root.innerHTML
}
