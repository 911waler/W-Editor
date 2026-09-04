import { describe, expect, it } from 'vitest'

import { BoundedScheduler as SharedBoundedScheduler } from '../../packages/editor-core/src/core/boundedScheduler'
import { DocumentSession as SharedDocumentSession } from '../../packages/editor-core/src/core/documentSession'
import { SynchronizationStateStore as SharedSynchronizationStateStore } from '../../packages/editor-core/src/core/operationState'
import { ProjectionRevisionGate as SharedProjectionRevisionGate } from '../../packages/editor-core/src/core/projectionRevisionGate'
import { BoundedScheduler as RootBoundedScheduler } from '../../src/core/boundedScheduler'
import { DocumentSession as RootDocumentSession } from '../../src/core/documentSession'
import { SynchronizationStateStore as RootSynchronizationStateStore } from '../../src/core/operationState'
import { ProjectionRevisionGate as RootProjectionRevisionGate } from '../../src/core/projectionRevisionGate'

describe('editor-core authority boundary', () => {
  it('owns the session, operation state, projection gate, and bounded scheduler while root imports remain compatible', () => {
    expect(RootBoundedScheduler).toBe(SharedBoundedScheduler)
    expect(RootDocumentSession).toBe(SharedDocumentSession)
    expect(RootSynchronizationStateStore).toBe(SharedSynchronizationStateStore)
    expect(RootProjectionRevisionGate).toBe(SharedProjectionRevisionGate)
  })
})
