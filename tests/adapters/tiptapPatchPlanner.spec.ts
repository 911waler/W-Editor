import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'

import {
  InvalidTiptapPatchSerializationError,
  TIPTAP_EXTERNAL_HYDRATION_META,
  TiptapTransactionPatchPlanner,
  UnmappedTiptapTransactionError,
  findTiptapProjectionNode,
} from '../../src/adapters/tiptapPatchPlanner'
import { createTiptapVisualExtensions } from '../../src/adapters/tiptapVisualSchema'
import type { TiptapVisualProjection } from '../../src/adapters/tiptapVisualAdapter'
import type { ProjectionMapEntry } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const schema = getSchema(createTiptapVisualExtensions())

function projection(markdown: string, revision = 0): TiptapVisualProjection {
  const lines = markdown.split('\n')
  let sourceOffset = 0
  const entries: ProjectionMapEntry[] = []
  const content = lines.map((line, index) => {
    const from = sourceOffset
    const to = from + line.length
    sourceOffset = to + (index < lines.length - 1 ? 1 : 0)
    const projectionId = `paragraph-${index}`
    entries.push({
      codecId: 'paragraph',
      originalSource: line,
      projectionId,
      safePatchUnit: {
        codecId: 'paragraph',
        expectedSource: line,
        sourceSpan: { from, to },
        strategy: { kind: 'direct', scope: 'block' },
        structural: false,
        unitId: `unit-${index}`,
      },
      sourceSpan: { from, to },
    })
    return {
      type: 'paragraph',
      attrs: {
        codecId: 'paragraph',
        originalSource: line,
        projectionId,
        revision,
        sourceFrom: from,
        sourceTo: to,
      },
      ...(line.length === 0 ? {} : { content: [{ type: 'text', text: line }] }),
    }
  })
  return {
    content: { type: 'doc', content },
    map: { documentLength: markdown.length, entries, revision },
    revision,
  }
}

function stateFor(value: TiptapVisualProjection): EditorState {
  return EditorState.create({ doc: schema.nodeFromJSON(value.content), schema })
}

function textSerializer(input: Parameters<ConstructorParameters<typeof TiptapTransactionPatchPlanner>[0]['serialize']>[0]): string {
  const node = findTiptapProjectionNode(input.after, input.entries[0]?.projectionId ?? '')
  if (node === null) throw new Error('Expected the safe projection unit to remain in the document.')
  return node.node.textContent
}

describe('TiptapTransactionPatchPlanner', () => {
  it('serializes only the smallest codec-declared safe unit touched by a text edit', () => {
    const value = projection('alpha\nbeta\ngamma')
    const state = stateFor(value)
    const serialize = vi.fn(textSerializer)
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'visual-text-edit',
      serialize,
    })

    const plan = planner.plan(state.tr.insertText('BETA', 8, 12), value)

    expect(plan).toEqual({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'beta', from: 6, replacement: 'BETA', to: 10 }],
      transactionId: 'visual-text-edit',
    })
    expect(serialize).toHaveBeenCalledOnce()
    expect(serialize.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      affectedProjectionIds: ['paragraph-1'],
      entries: [value.map.entries[1]],
      safePatchUnit: value.map.entries[1]?.safePatchUnit,
    }))
    expect(new DocumentSession({ documentId: 'planner', markdown: 'alpha\nbeta\ngamma' }).previewPatchPlan(plan!))
      .toBe('alpha\nBETA\ngamma')
  })

  it('emits non-overlapping patches for disjoint steps without serializing the intervening unit', () => {
    const value = projection('alpha\nbeta\ngamma')
    const state = stateFor(value)
    const bold = schema.marks['bold']?.create()
    if (bold === undefined) throw new Error('The production schema must include the bold mark.')
    const serialize = vi.fn((input: Parameters<typeof textSerializer>[0]) => {
      const id = input.entries[0]?.projectionId
      const node = findTiptapProjectionNode(input.after, id ?? '')
      if (node === null) throw new Error('Expected the safe projection unit to remain in the document.')
      return `**${node.node.textContent}**`
    })
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'visual-disjoint-edit',
      serialize,
    })
    const transaction = state.tr
      .addMark(1, 6, bold)
      .addMark(14, 19, bold)

    const plan = planner.plan(transaction, value)

    expect(plan?.patches).toEqual([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: '**alpha**', to: 5 },
      { codecId: 'paragraph', expected: 'gamma', from: 11, replacement: '**gamma**', to: 16 },
    ])
    expect(serialize).toHaveBeenCalledTimes(2)
    expect(serialize.mock.calls.map(([input]) => input.entries[0]?.projectionId)).toEqual([
      'paragraph-0',
      'paragraph-2',
    ])
    expect(new DocumentSession({ documentId: 'planner', markdown: 'alpha\nbeta\ngamma' }).previewPatchPlan(plan!))
      .toBe('**alpha**\nbeta\n**gamma**')
  })

  it('serializes a cross-block join as one declared unit containing both blocks and their separator', () => {
    const base = projection('alpha\nbeta')
    const joinedUnit = {
      codecId: 'paragraph',
      expectedSource: 'alpha\nbeta',
      sourceSpan: { from: 0, to: 10 },
      strategy: { kind: 'direct', scope: 'joined-blocks' } as const,
      structural: true,
      unitId: 'joined-paragraphs',
    }
    const value: TiptapVisualProjection = {
      ...base,
      map: {
        ...base.map,
        entries: base.map.entries.map((entry) => ({ ...entry, safePatchUnit: joinedUnit })),
      },
    }
    const state = stateFor(value)
    const serialize = vi.fn((input: Parameters<typeof textSerializer>[0]) => input.after.textContent)
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'visual-block-join',
      serialize,
    })

    const plan = planner.plan(state.tr.delete(6, 8), value)

    expect(plan?.patches).toEqual([{
      codecId: 'paragraph',
      expected: 'alpha\nbeta',
      from: 0,
      replacement: 'alphabeta',
      to: 10,
    }])
    expect(serialize).toHaveBeenCalledOnce()
    expect(serialize.mock.calls[0]?.[0].entries.map((entry) => entry.projectionId)).toEqual([
      'paragraph-0',
      'paragraph-1',
    ])
    expect(new DocumentSession({ documentId: 'planner', markdown: 'alpha\nbeta' }).previewPatchPlan(plan!))
      .toBe('alphabeta')
  })

  it('ignores tagged external hydration transactions', () => {
    const value = projection('alpha')
    const state = stateFor(value)
    const serialize = vi.fn(textSerializer)
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'must-not-be-created',
      serialize,
    })
    const replacement = state.schema.nodeFromJSON(projection('external').content)
    const transaction = state.tr
      .replaceWith(0, state.doc.content.size, replacement.content)
      .setMeta(TIPTAP_EXTERNAL_HYDRATION_META, { revision: 1 })

    expect(planner.plan(transaction, value)).toBeNull()
    expect(serialize).not.toHaveBeenCalled()
  })

  it('rejects an unmapped document mutation instead of falling back to whole-document serialization', () => {
    const value = projection('alpha')
    const state = stateFor(value)
    const serialize = vi.fn(textSerializer)
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'unmapped',
      serialize,
    })
    const unmapped: TiptapVisualProjection = {
      ...value,
      map: { ...value.map, entries: [] },
    }

    expect(() => planner.plan(state.tr.insertText('!', 2), unmapped))
      .toThrow(UnmappedTiptapTransactionError)
    expect(serialize).not.toHaveBeenCalled()
  })

  it('rejects duplicate projection identity before any serializer or authority mutation runs', () => {
    const value = projection('alpha\nbeta')
    const projectedContent = value.content.content
    if (projectedContent === undefined) throw new Error('Expected projected paragraph content.')
    const content = projectedContent.map((node, index) => index === 1
      ? { ...node, attrs: { ...node.attrs, projectionId: 'paragraph-0' } }
      : node)
    const duplicated: TiptapVisualProjection = {
      ...value,
      content: { ...value.content, content },
    }
    const state = stateFor(duplicated)
    const serialize = vi.fn(textSerializer)
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'duplicate-identity',
      serialize,
    })

    expect(() => planner.plan(state.tr.insertText('!', 2), duplicated)).toThrowError(
      new InvalidTiptapPatchSerializationError(
        'Projection id paragraph-0 occurs more than once in the Tiptap document.',
      ),
    )
    expect(serialize).not.toHaveBeenCalled()
  })

  it('rejects a non-string safe-unit serializer result without emitting a patch plan', () => {
    const value = projection('alpha')
    const state = stateFor(value)
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'invalid-serializer',
      serialize: () => undefined as unknown as string,
    })

    expect(() => planner.plan(state.tr.insertText('!', 2), value)).toThrowError(
      new InvalidTiptapPatchSerializationError(
        'A Tiptap safe-unit serializer returned a non-string replacement.',
      ),
    )
  })
})
