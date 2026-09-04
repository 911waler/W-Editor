import type { TiptapVisualProjector, TiptapVisualProjection } from '@w-editor/editor-vue/adapters'
import { projectOrdinaryMarkdown } from '@w-editor/editor-core'

const CODEC_THROW_MARKDOWN = '[[fixture:codec-throw]]'
const RESOURCE_LIMIT_MARKDOWN = '[[fixture:resource-limit]]'

function injectedFailure(code: string, message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code })
}

export function createTestingVisualProjector(): TiptapVisualProjector | undefined {
  const failure = new URLSearchParams(window.location.search).get('modeFailure')
  if (![
    'visual-ack-schema',
    'visual-ack-schema-once',
    'preview',
    'visual-codec',
    'visual-resource',
    'visual-schema',
    'visual-schema-once',
  ].includes(failure ?? '')) return undefined
  let oneShotSchemaFailurePending = failure === 'visual-schema-once'
  let acknowledgementBaselineRevision: number | null = null
  let acknowledgementFailurePending = failure === 'visual-ack-schema' || failure === 'visual-ack-schema-once'
  let initialVisualProjectionPending = failure === 'preview'
    || failure === 'visual-schema-once'
    || failure === 'visual-ack-schema'
    || failure === 'visual-ack-schema-once'
  return (snapshot): TiptapVisualProjection => {
    if (failure === 'visual-codec' && snapshot.markdown.includes(CODEC_THROW_MARKDOWN)) {
      throw injectedFailure('CODEC_THROW', 'Injected codec failure at the declared fixture marker.')
    }
    if (failure === 'visual-resource' && snapshot.markdown.includes(RESOURCE_LIMIT_MARKDOWN)) {
      throw injectedFailure('DECLARED_RESOURCE_LIMIT_EXCEEDED', 'Injected visual projection resource limit exceeded.')
    }
    if (initialVisualProjectionPending) {
      initialVisualProjectionPending = false
      return projectOrdinaryMarkdown(snapshot)
    }
    if (failure === 'preview') {
      throw injectedFailure('INVALID_TIPTAP_SCHEMA', 'Injected read-only Tiptap presentation failure.')
    }
    if (failure === 'visual-ack-schema' || failure === 'visual-ack-schema-once') {
      acknowledgementBaselineRevision ??= snapshot.revision
      if (acknowledgementFailurePending && snapshot.revision > acknowledgementBaselineRevision) {
        if (failure === 'visual-ack-schema-once') acknowledgementFailurePending = false
        throw injectedFailure('INVALID_TIPTAP_SCHEMA', 'Visual projection does not satisfy the active Tiptap schema.')
      }
    }
    const projection = projectOrdinaryMarkdown(snapshot)
    if (failure !== 'visual-schema' && !oneShotSchemaFailurePending) return projection
    oneShotSchemaFailurePending = false
    return Object.freeze({
      ...projection,
      content: {
        content: [{ type: 'fixture-node-that-is-not-in-the-schema' }],
        type: 'doc',
      },
    })
  }
}
