import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Node, getSchema } from '@tiptap/core'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Underline } from '@tiptap/extension-underline'
import { EditorState } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

const TIPTAP_VERSION = '3.30.2'
const REQUIRED_TIPTAP_PACKAGES = Object.freeze([
  '@tiptap/core',
  '@tiptap/extension-color',
  '@tiptap/extension-highlight',
  '@tiptap/extension-link',
  '@tiptap/extension-subscript',
  '@tiptap/extension-superscript',
  '@tiptap/extension-table',
  '@tiptap/extension-task-item',
  '@tiptap/extension-task-list',
  '@tiptap/extension-text-align',
  '@tiptap/extension-text-style',
  '@tiptap/extension-underline',
  '@tiptap/pm',
  '@tiptap/starter-kit',
  '@tiptap/vue-3',
])

function packageManifest(packageName: string): { readonly name: string; readonly version: string } {
  return JSON.parse(readFileSync(join('node_modules', ...packageName.split('/'), 'package.json'), 'utf8')) as {
    readonly name: string
    readonly version: string
  }
}

const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ source: { default: '' } }),
  renderHTML: ({ HTMLAttributes }) => ['span', { ...HTMLAttributes, 'data-type': 'raw-inline' }],
})

const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => ({ source: { default: '' } }),
  renderHTML: ({ HTMLAttributes }) => ['div', { ...HTMLAttributes, 'data-type': 'raw-block' }],
})

const SemanticBlock = Node.create({
  name: 'semanticBlock',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes: () => ({
    kind: { default: 'unknown' },
    source: { default: '' },
  }),
  renderHTML: ({ HTMLAttributes }) => ['figure', { ...HTMLAttributes, 'data-type': 'semantic-block' }],
})

function plannedSchema() {
  return getSchema([
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5] },
      link: false,
      underline: false,
    }),
    Link,
    Underline,
    Subscript,
    Superscript,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    RawInline,
    RawBlock,
    SemanticBlock,
  ])
}

describe('published Tiptap 3.30.2 capability baseline', () => {
  it('pins and resolves every required published Tiptap package at one version', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly dependencies: Readonly<Record<string, string>>
    }
    const declared = Object.keys(root.dependencies).filter((name) => name.startsWith('@tiptap/')).sort()

    expect(declared).toEqual([...REQUIRED_TIPTAP_PACKAGES].sort())
    for (const packageName of REQUIRED_TIPTAP_PACKAGES) {
      expect(root.dependencies[packageName]).toBe(TIPTAP_VERSION)
      expect(packageManifest(packageName)).toEqual(expect.objectContaining({
        name: packageName,
        version: TIPTAP_VERSION,
      }))
    }
  })

  it('builds the planned ordinary, table, task, raw, and semantic schema', () => {
    const schema = plannedSchema()
    const styledText = schema.text('styled', [
      schema.marks['bold']?.create(),
      schema.marks['underline']?.create(),
      schema.marks['textStyle']?.create({ color: '#b42318' }),
    ].filter((mark) => mark !== undefined))
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 5 }, [schema.text('Heading')]),
      schema.node('paragraph', { textAlign: 'center' }, [styledText]),
      schema.node('taskList', null, [
        schema.node('taskItem', { checked: false }, [schema.node('paragraph', null, [schema.text('Task')])]),
      ]),
      schema.node('table', null, [
        schema.node('tableRow', null, [
          schema.node('tableHeader', null, [schema.node('paragraph', null, [schema.text('Name')])]),
          schema.node('tableCell', null, [schema.node('paragraph', null, [schema.text('Value')])]),
        ]),
      ]),
      schema.node('rawBlock', { source: '::: unknown\nexact\n:::' }),
      schema.node('semanticBlock', { kind: 'mermaid', source: 'graph LR\nA-->B' }),
      schema.node('paragraph', null, [
        schema.text('before '),
        schema.node('rawInline', { source: '{{ exact }}' }),
        schema.text(' after'),
      ]),
    ])

    expect(() => doc.check()).not.toThrow()
    expect(schema.nodes['heading']?.spec.attrs?.['level']?.default).toBe(1)
    expect(schema.nodes['rawBlock']?.spec.isolating).toBe(true)
    expect(schema.nodes['semanticBlock']?.spec.atom).toBe(true)
    expect(schema.marks['textStyle']?.spec.attrs?.['color']?.default).toBeNull()
    expect(schema.marks).toEqual(expect.objectContaining({
      highlight: expect.anything(),
      link: expect.anything(),
      subscript: expect.anything(),
      superscript: expect.anything(),
      textStyle: expect.anything(),
      underline: expect.anything(),
    }))
  })

  it('carries W-Editor projection metadata and non-history intent on a ProseMirror transaction', () => {
    const schema = plannedSchema()
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('before')])]),
    })
    const metadata = Object.freeze({
      baseRevision: 12,
      origin: 'projection-hydration',
      projectionRevision: 13,
    })
    const transaction = state.tr
      .insertText('X', 1)
      .setMeta('addToHistory', false)
      .setMeta('w-editor-projection', metadata)
    const applied = state.applyTransaction(transaction)

    expect(transaction.docChanged).toBe(true)
    expect(transaction.steps).toHaveLength(1)
    expect(transaction.mapping.maps).toHaveLength(1)
    expect(transaction.getMeta('addToHistory')).toBe(false)
    expect(transaction.getMeta('w-editor-projection')).toBe(metadata)
    expect(applied.state.doc.textContent).toBe('Xbefore')
    expect(applied.transactions).toEqual([transaction])
  })
})
