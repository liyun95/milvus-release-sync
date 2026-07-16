import { describe, expect, it } from 'vitest';

import { runCli } from './helpers/cli.js';

describe('CLI help and version', () => {
  it('exposes only the four public commands', async () => {
    const result = await runCli(['--help']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Commands:');

    const commands = [...result.stdout.matchAll(/^  ([a-z][a-z-]*)\b/gm)].map(
      ([, command]) => command,
    );

    expect(commands).toEqual(['plan', 'approve', 'apply', 'status']);
  });

  it('prints the runner version', async () => {
    const result = await runCli(['--version']);

    expect(result).toEqual({ status: 0, stdout: '0.1.0\n', stderr: '' });
  });
});
