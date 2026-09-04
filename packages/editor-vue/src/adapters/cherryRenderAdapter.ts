import type { DocumentSnapshot } from '@w-editor/editor-core'

import {
  createSharedRendererPipeline,
  type SharedRendererPipeline,
  type SharedRendererPipelineOptions,
} from '../rendering/sharedRendererPipeline'

export interface CherryRenderResult {
  readonly html: string
  readonly snapshot: DocumentSnapshot
}

/** Compatibility adapter over the one shared Renderer pipeline. */
export class CherryRenderAdapter {
  readonly pipeline: SharedRendererPipeline

  constructor(options: Readonly<SharedRendererPipelineOptions & { readonly pipeline?: SharedRendererPipeline }> = {}) {
    this.pipeline = options.pipeline ?? createSharedRendererPipeline(options)
  }

  render(snapshot: DocumentSnapshot): CherryRenderResult {
    return this.pipeline.render(snapshot, 'author-preview')
  }
}
