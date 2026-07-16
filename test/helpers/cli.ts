import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runCli(args: string[]) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['dist/cli/index.js', ...args],
      {
        cwd: new URL('../..', import.meta.url),
        encoding: 'utf8',
      },
    );

    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };

    return {
      status: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}
