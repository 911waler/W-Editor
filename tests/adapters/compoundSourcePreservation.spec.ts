import { afterEach, describe, expect, it } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters'
import {
  PANEL_DESCRIPTORS,
  columnLayoutStarterSource,
  disclosureStarterSource,
  panelStarterSource,
  projectOrdinaryMarkdown,
  timelineStarterSource,
  type ColumnLayoutCommandId,
  type DisclosureCommandId,
  type PanelCommandId,
} from '../../src/codecs'
import { DocumentSession, type DocumentSnapshot, type PatchPlan } from '../../src/core'
import {
  createColumnLayoutCommandPlan,
  createDisclosureCommandPlan,
  createPanelCommandPlan,
  createTimelineCommandPlan,
} from '../../src/services'

interface CompoundCase {
  readonly commandId: string
  readonly edited: string
  readonly plan: (snapshot: DocumentSnapshot, selection: Readonly<{ from: number; to: number }>) => PatchPlan
  readonly source: string
}

type CompoundSelection = Readonly<{ from: number; to: number }>

const panelCases: readonly CompoundCase[] = PANEL_DESCRIPTORS.map((descriptor) => {
  const source = panelStarterSource(descriptor.commandId)
  const edited = source.replace(/\n([^\n]+)\n:::/u, '\nEdited panel body.\n:::')
  return Object.freeze({
    commandId: descriptor.commandId,
    edited,
    plan: (snapshot: DocumentSnapshot, selection: CompoundSelection) => createPanelCommandPlan(
      snapshot,
      selection,
      descriptor.commandId as PanelCommandId,
      `${descriptor.commandId}:edit`,
      edited,
    ).plan,
    source,
  })
})

const columnCases: readonly CompoundCase[] = (['layout.two-column', 'layout.multi-column'] as const).map((commandId) => {
  const source = columnLayoutStarterSource(commandId)
  const edited = source.replace('First column', 'Edited first column')
  return Object.freeze({
    commandId,
    edited,
    plan: (snapshot: DocumentSnapshot, selection: CompoundSelection) => createColumnLayoutCommandPlan(
      snapshot,
      selection,
      commandId as ColumnLayoutCommandId,
      `${commandId}:edit`,
      edited,
    ).plan,
    source,
  })
})

const disclosureCases: readonly CompoundCase[] = (['layout.tabs', 'layout.accordion'] as const).map((commandId) => {
  const source = disclosureStarterSource(commandId)
  const edited = source.replace('content', 'edited content')
  return Object.freeze({
    commandId,
    edited,
    plan: (snapshot: DocumentSnapshot, selection: CompoundSelection) => createDisclosureCommandPlan(
      snapshot,
      selection,
      commandId as DisclosureCommandId,
      edited,
      `${commandId}:edit`,
    ).plan,
    source,
  })
})

const timelineSource = timelineStarterSource()
const timelineEdited = timelineSource.replace('Integration testing in progress', 'Integration testing completed')
const cases: readonly CompoundCase[] = Object.freeze([
  ...panelCases,
  ...columnCases,
  ...disclosureCases,
  Object.freeze({
    commandId: 'layout.timeline',
    edited: timelineEdited,
    plan: (snapshot: DocumentSnapshot, selection: CompoundSelection) => createTimelineCommandPlan(
      snapshot,
      selection,
      timelineEdited,
      'layout.timeline:edit',
    ).plan,
    source: timelineSource,
  }),
])

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('compound source preservation', () => {
  it.each(cases)('$commandId remains byte-identical when merely projected and viewed', ({ commandId, source }) => {
    const markdown = `Before \t\r\n\r\n${source}\r\n\r\nAfter  \n`
    const session = new DocumentSession({ documentId: commandId, markdown })
    const host = document.createElement('div')
    document.body.append(host)
    adapters.push(new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session }))
    expect(session.snapshot()).toMatchObject({ markdown, revision: 0 })
  })

  it.each(cases)('$commandId edits only its checked semantic safe unit', ({ commandId, edited, plan, source }) => {
    const prefix = 'Before \t\r\n\r\n'
    const suffix = '\r\n\r\nAfter  \n'
    const session = new DocumentSession({ documentId: commandId, markdown: `${prefix}${source}${suffix}` })
    const patchPlan = plan(session.snapshot(), {
      from: prefix.length + 2,
      to: prefix.length + 2,
    })
    expect(patchPlan.patches).toEqual([expect.objectContaining({
      expected: source,
      from: prefix.length,
      replacement: edited,
      to: prefix.length + source.length,
    })])
    session.commitPatchPlan(patchPlan, 'toolbar-command')
    expect(session.snapshot()).toMatchObject({
      markdown: `${prefix}${edited}${suffix}`,
      revision: 1,
    })
  })
})
