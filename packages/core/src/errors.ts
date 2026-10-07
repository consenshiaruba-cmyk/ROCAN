export type TransitionErrorCode = 'invalid_transition' | 'guard_failed';

export class TransitionError extends Error {
  constructor(
    readonly code: TransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}
