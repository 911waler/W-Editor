import { afterEach, describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.destroy()
  document.body.replaceChildren()
})

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const plans: PatchPlan[] = []
  const failures: unknown[] = []
  const session = new DocumentSession({ documentId: 'block-actions', markdown })
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) plans.push(patchPlan)
    },
    onTransactionFailure: ({ failure }) => failures.push(failure),
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `duplicate:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  adapters.push(adapter)
  return { adapter, failures, host, plans }
}

describe('Visual block actions', () => {
  it.each([
    {
      expected: 'Alpha\n\nAlpha',
      markdown: 'Alpha',
      selector: '.ProseMirror > p',
    },
    {
      expected: '```ts\nconst answer = 42\n```\n\n```ts\nconst answer = 42\n```',
      markdown: '```ts\nconst answer = 42\n```',
      selector: '.ProseMirror > [data-w-editor-node="code-block"]',
    },
    {
      expected: '::: primary Card\nBody\n:::\n\n::: primary Card\nBody\n:::',
      markdown: '::: primary Card\nBody\n:::',
      selector: '.ProseMirror > [data-semantic-kind="panel"]',
    },
  ])('duplicates one $selector block into one serializable sibling', ({ expected, markdown, selector }) => {
    const { adapter, failures, host, plans } = mount(markdown)
    const block = host.querySelector<HTMLElement>(selector)
    expect(block).not.toBeNull()

    expect(adapter.duplicateDomBlock(block!)).toEqual({ active: true, changed: true })
    expect(failures).toEqual([])
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(expected)
    expect(host.querySelectorAll(selector)).toHaveLength(2)
  })
})

it('duplicates a referenced formula without inheriting its target identity', () => {
  const markdown = '$$\na=b\n$$\n<!-- w-editor-formula-id: stable -->\n\n[公式](#wformula-stable)'
  const { adapter, failures, host, plans } = mount(markdown)
  const block = host.querySelector<HTMLElement>('.formula-node--block')!
  expect(adapter.duplicateDomBlock(block).changed).toBe(true)
  expect(failures).toEqual([])
  const blocks = host.querySelectorAll<HTMLElement>('.formula-node--block')
  expect(blocks).toHaveLength(2)
  expect(blocks[0]?.dataset['formulaId']).toBe('stable')
  expect(blocks[1]?.dataset['formulaId']).toBeUndefined()
  expect(host.querySelector('[data-formula-reference-target]')?.getAttribute('href')).toBe('#wformula-stable')
  const session = new DocumentSession({ documentId: 'block-actions', markdown })
  session.commitPatchPlan(plans[0]!)
  expect(session.snapshot().markdown).toBe('$$\na=b\n$$\n<!-- w-editor-formula-id: stable -->\n\n$$\na=b\n$$\n\n[公式](#wformula-stable)')
  expect(adapter.undo()).toBe(true)
  expect(host.querySelectorAll('.formula-node--block')).toHaveLength(1)
})
