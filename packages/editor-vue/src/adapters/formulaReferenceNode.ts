import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { formulaReferenceMarkdown, isFormulaId } from '@w-editor/editor-core'
import { createRandomId } from '../services/randomId'

export const FormulaReferenceNode = Node.create({
  name: 'formulaReference', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ targetId: { default: null, renderHTML: () => ({}), parseHTML: element => element.getAttribute('data-formula-reference-target') } }),
  parseHTML: () => [{ tag: 'a[data-formula-reference-target]', priority: 101, getAttrs: element => isFormulaId(element.getAttribute('data-formula-reference-target')) ? {} : false }],
  renderText: ({ node }) => formulaReferenceMarkdown(String(node.attrs['targetId'])),
  renderHTML: ({ node, HTMLAttributes }) => ['a', mergeAttributes(HTMLAttributes, {
    'data-formula-reference-target': node.attrs['targetId'], class: 'formula-reference', tabindex: '0',
  }), 'Equation (unavailable)'],
  addProseMirrorPlugins: () => {
    let dropMoves: boolean | undefined
    return [new Plugin({ props: {
    handleDOMEvents: {
      drop: (view, event) => {
        // ProseMirror decides copy versus move at drop time, which may differ
        // from dragstart when the user changes the copy modifier mid-drag.
        let copy: boolean | undefined
        view.someProp('dragCopies', test => { copy = copy || test(event) })
        const apple = /Mac|iPhone|iPad|iPod/u.test(view.dom.ownerDocument.defaultView?.navigator.platform ?? '')
        dropMoves = !!view.dragging && (copy != null ? !copy : !(apple ? event.altKey : event.ctrlKey))
        return false
      },
    },
    transformPasted: (slice, view) => {
      const moving = view.dragging && (dropMoves ?? view.dragging.move)
      dropMoves = undefined
      if (moving) return slice
      const existing = new Set<string>()
      view.state.doc.descendants(node => { if (node.type.name === 'formulaBlock' && isFormulaId(node.attrs['formulaId'])) existing.add(node.attrs['formulaId']) })
      const replacements = new Map<string, string>()
      slice.content.descendants(node => {
        const id = node.attrs['formulaId']
        if (node.type.name === 'formulaBlock' && isFormulaId(id) && existing.has(id)) replacements.set(id, createRandomId())
      })
      const rewrite = (fragment: Fragment): Fragment => {
        const nodes: PMNode[] = []
        fragment.forEach(node => {
          const key = node.type.name === 'formulaBlock' ? 'formulaId' : node.type.name === 'formulaReference' ? 'targetId' : null
          const id = key ? replacements.get(String(node.attrs[key])) : undefined
          nodes.push(id && key ? node.type.create({ ...node.attrs, [key]: id }, rewrite(node.content), node.marks) : node.copy(rewrite(node.content)))
        })
        return Fragment.fromArray(nodes)
      }
      return new Slice(rewrite(slice.content), slice.openStart, slice.openEnd)
    },
  } })]
  },
})
