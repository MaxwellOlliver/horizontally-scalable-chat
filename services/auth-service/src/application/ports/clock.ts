/** Abstracts "now" so use cases are deterministically testable. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
