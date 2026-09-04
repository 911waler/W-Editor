export type BoundedSchedulerStatus = 'failed' | 'idle' | 'pending' | 'running'

export interface BoundedSchedulerSnapshot {
  readonly failure: unknown | null
  readonly pending: boolean
  readonly status: BoundedSchedulerStatus
}

export interface BoundedSchedulerOptions<Request> {
  readonly coalesce: (pending: Request, next: Request) => Request
  readonly maxWaitMs: number
  readonly run: (request: Request) => void | Promise<void>
  readonly trailingDelayMs: number
}

export type BoundedSchedulerSubscriber = (snapshot: BoundedSchedulerSnapshot) => void

function assertDelay(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`)
  }
}

export class BoundedScheduler<Request> {
  readonly #coalesce: (pending: Request, next: Request) => Request
  readonly #maxWaitMs: number
  readonly #run: (request: Request) => void | Promise<void>
  readonly #subscribers = new Set<BoundedSchedulerSubscriber>()
  readonly #trailingDelayMs: number
  #active: Promise<void> | null = null
  #failure: unknown | null = null
  #flushPromise: Promise<void> | null = null
  #maximumTimer: ReturnType<typeof setTimeout> | null = null
  #paused = false
  #pending: Request | undefined
  #runAfterActive = false
  #status: BoundedSchedulerStatus = 'idle'
  #trailingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: BoundedSchedulerOptions<Request>) {
    assertDelay('trailingDelayMs', options.trailingDelayMs)
    assertDelay('maxWaitMs', options.maxWaitMs)
    if (options.maxWaitMs < options.trailingDelayMs) {
      throw new RangeError('maxWaitMs must be greater than or equal to trailingDelayMs.')
    }
    this.#coalesce = options.coalesce
    this.#maxWaitMs = options.maxWaitMs
    this.#run = options.run
    this.#trailingDelayMs = options.trailingDelayMs
  }

  snapshot(): BoundedSchedulerSnapshot {
    return Object.freeze({
      failure: this.#failure,
      pending: this.#pending !== undefined,
      status: this.#status,
    })
  }

  subscribe(subscriber: BoundedSchedulerSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  request(request: Request): void {
    const firstPendingRequest = this.#pending === undefined
    this.#pending = firstPendingRequest ? request : this.#coalesce(this.#pending as Request, request)
    this.#failure = null
    if (this.#active === null) this.#status = 'pending'
    if (!this.#paused) this.#armTimers(firstPendingRequest)
    this.#publish()
  }

  pause(): void {
    if (this.#paused) return
    this.#paused = true
    this.#clearTimers()
  }

  resume(): void {
    if (!this.#paused) return
    this.#paused = false
    if (this.#pending !== undefined && this.#active === null) this.#armTimers(true)
  }

  cancel(): boolean {
    if (this.#pending === undefined) return false
    this.#pending = undefined
    this.#runAfterActive = false
    this.#clearTimers()
    if (this.#active === null) {
      this.#failure = null
      this.#status = 'idle'
    }
    this.#publish()
    return true
  }

  clearFailure(): boolean {
    if (this.#active !== null || this.#pending !== undefined || this.#failure === null) return false
    this.#failure = null
    this.#status = 'idle'
    this.#publish()
    return true
  }

  flush(): Promise<void> {
    if (this.#flushPromise !== null) return this.#flushPromise
    const drain = async (): Promise<void> => {
      this.#clearTimers()
      while (true) {
        if (this.#active !== null) {
          await this.#active
          continue
        }
        if (this.#failure !== null) throw this.#failure
        if (this.#pending === undefined) return
        await this.#executeOne()
        this.#clearTimers()
      }
    }
    const flushing = drain()
    this.#flushPromise = flushing.finally(() => {
      this.#flushPromise = null
    })
    return this.#flushPromise
  }

  #scheduledRun(): void {
    this.#clearTimers()
    if (this.#paused) return
    if (this.#active !== null) {
      this.#runAfterActive = true
      return
    }
    void this.#executeOne().catch(() => {
      // Scheduled failures remain observable through snapshot() and a later flush().
    })
  }

  #executeOne(): Promise<void> {
    if (this.#active !== null) return this.#active
    const request = this.#pending
    if (request === undefined) return Promise.resolve()
    this.#pending = undefined
    this.#runAfterActive = false
    this.#clearTimers()
    this.#status = 'running'
    this.#publish()

    const runner = Promise.resolve().then(() => this.#run(request))
    const completed = runner.then(
      () => {
        this.#failure = null
        this.#status = this.#pending === undefined ? 'idle' : 'pending'
      },
      (failure: unknown) => {
        this.#failure = failure
        this.#status = 'failed'
        this.#clearTimers()
        throw failure
      },
    ).finally(() => {
      this.#active = null
      this.#publish()
      if (this.#failure === null && this.#pending !== undefined && this.#runAfterActive) {
        queueMicrotask(() => {
          void this.#executeOne().catch(() => {
            // The next scheduled failure is retained in the scheduler state.
          })
        })
      }
    })
    this.#active = completed
    return completed
  }

  #clearTimers(): void {
    if (this.#trailingTimer !== null) clearTimeout(this.#trailingTimer)
    if (this.#maximumTimer !== null) clearTimeout(this.#maximumTimer)
    this.#trailingTimer = null
    this.#maximumTimer = null
  }

  #armTimers(firstPendingRequest: boolean): void {
    if (firstPendingRequest && this.#maximumTimer === null) {
      this.#maximumTimer = setTimeout(() => this.#scheduledRun(), this.#maxWaitMs)
    }
    if (this.#trailingTimer !== null) clearTimeout(this.#trailingTimer)
    this.#trailingTimer = setTimeout(() => this.#scheduledRun(), this.#trailingDelayMs)
  }

  #publish(): void {
    const snapshot = this.snapshot()
    for (const subscriber of this.#subscribers) subscriber(snapshot)
  }
}
