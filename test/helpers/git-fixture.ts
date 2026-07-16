import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RELEASE_NOTES_PATH = 'site/en/release_notes.md';
export const VARIABLES_PATH = 'site/en/Variables.json';

export type GitFixture = {
  path: string;
  cleanup: () => Promise<void>;
  git: (...args: string[]) => Promise<string>;
  write: (path: string, contents: string) => Promise<void>;
};

export async function createGitFixture(): Promise<GitFixture> {
  const temporaryPath = await mkdtemp(join(tmpdir(), 'milvus-release-sync-'));
  const path = await realpath(temporaryPath);

  const git = async (...args: string[]): Promise<string> => {
    const result = await execFileAsync('git', args, {
      cwd: path,
      encoding: 'utf8',
    });
    return result.stdout.trim();
  };

  const write = async (relativePath: string, contents: string): Promise<void> => {
    const absolutePath = join(path, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  };

  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'Milvus Release Sync Test');
  await git('config', 'user.email', 'milvus-release-sync@example.com');
  await git('remote', 'add', 'origin', 'https://github.com/milvus-io/milvus-docs.git');
  await write(RELEASE_NOTES_PATH, '# Release Notes\n');
  await write(VARIABLES_PATH, '{"version":"2.6.20"}\n');
  await git('add', RELEASE_NOTES_PATH, VARIABLES_PATH);
  await git('commit', '-m', 'Add release targets');
  await git('branch', 'v2.6.x');

  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
    git,
    write,
  };
}
