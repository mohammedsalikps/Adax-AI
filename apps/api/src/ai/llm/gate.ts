/**
 * One model runs on this computer, and it answers one request at a time. This lets a few requests wait their turn, in order, and refuses more than
 * that, so a burst of "generate" clicks cannot pile up work the machine cannot do. A waiting request can be cancelled.
 */
export class Gate {
  private active = 0
  private readonly queue: { resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal | undefined; onAbort?: () => void }[] = []

  constructor(
    readonly slots: number,
    readonly maxWaiting: number,
  ) {}

  get waiting(): number {
    return this.queue.length
  }
  get running(): number {
    return this.active
  }
  /** True when a new request would have to wait behind too many others. */
  get full(): boolean {
    return this.active >= this.slots && this.queue.length >= this.maxWaiting
  }

  /** Resolves when it is this request's turn. `onTurn` fires when it starts running (after any wait). Rejects if `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error('aborted'))
    if (this.active < this.slots) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const entry: (typeof this.queue)[number] = { resolve, reject, signal }
      if (signal) {
        entry.onAbort = () => {
          const i = this.queue.indexOf(entry)
          if (i >= 0) this.queue.splice(i, 1)
          reject(new Error('aborted'))
        }
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      this.queue.push(entry)
    })
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort)
      // The slot passes straight to the next request: `active` is unchanged.
      next.resolve()
    } else this.active = Math.max(0, this.active - 1)
  }
}
