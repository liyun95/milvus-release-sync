export type CliErrorType =
  | 'validation'
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'external'
  | 'blocked'
  | 'approval'
  | 'verification'
  | 'internal';

export type CliFailure = {
  ok: false;
  error: {
    type: CliErrorType;
    subtype: string;
    message: string;
    hint?: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

export class RunnerError extends Error {
  constructor(
    readonly exitCode: 1 | 2 | 3 | 4 | 5 | 10,
    readonly failure: CliFailure['error'],
  ) {
    super(failure.message);
  }
}

export function normalizeFailure(error: unknown): RunnerError {
  if (error instanceof RunnerError) {
    return error;
  }

  return new RunnerError(5, {
    type: 'internal',
    subtype: 'unexpected_error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  });
}
