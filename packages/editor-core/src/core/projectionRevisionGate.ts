import type { DocumentChange, DocumentSnapshot, MutationOrigin } from '../publicContracts'

export type ProjectionOrigin = Extract<MutationOrigin, 'cherry-source' | 'tiptap-visual'>

export interface ProjectionAcknowledgement {
  readonly origin: MutationOrigin
  readonly revision: number
  readonly transactionId?: string
}

export interface ProjectionHydration {
  readonly addToHistory: false
  readonly snapshot: DocumentSnapshot
}

export type ProjectionUpdateDisposition = 'acknowledged-own-origin' | 'hydrated-external-origin'

export class ProjectionRevisionGate {
  readonly #hydrate: (update: ProjectionHydration) => void
  readonly #origin: ProjectionOrigin
  #lastAcknowledgement: ProjectionAcknowledgement | undefined

  constructor(origin: ProjectionOrigin, hydrate: (update: ProjectionHydration) => void) {
    this.#origin = origin
    this.#hydrate = hydrate
  }

  acknowledgement(): ProjectionAcknowledgement | undefined {
    return this.#lastAcknowledgement
  }

  receive(change: DocumentChange): ProjectionUpdateDisposition {
    const acknowledgement = Object.freeze({
      origin: change.acknowledgement.origin,
      revision: change.acknowledgement.revision,
      ...(change.acknowledgement.transactionId === undefined
        ? {}
        : { transactionId: change.acknowledgement.transactionId }),
    })
    this.#lastAcknowledgement = acknowledgement

    if (change.acknowledgement.origin === this.#origin) {
      return 'acknowledged-own-origin'
    }

    this.#hydrate(Object.freeze({ addToHistory: false, snapshot: change.current }))
    return 'hydrated-external-origin'
  }
}
