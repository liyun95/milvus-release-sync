import type { CliFailure } from '../core/cli-failure.js';

export type OutputFormat = 'pretty' | 'json';

export const printSuccess = (value: unknown, format: OutputFormat) =>
  process.stdout.write(
    format === 'json'
      ? `${JSON.stringify(value)}\n`
      : `${JSON.stringify(value, null, 2)}\n`,
  );

export const printFailure = (value: CliFailure, format: OutputFormat) =>
  process.stderr.write(
    format === 'json'
      ? `${JSON.stringify(value)}\n`
      : `${value.error.message}${
          value.error.hint ? `\nHint: ${value.error.hint}` : ''
        }\n`,
  );
