import { describe, expect, it } from 'vitest';

import { runCli } from './helpers/cli.js';

describe('CLI failures', () => {
  it('writes one JSON validation failure to stderr for invalid plan arguments', async () => {
    const result = await runCli(['plan', '--format', 'json']);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: {
        type: 'validation',
        retryable: false,
      },
    });
  });
});
