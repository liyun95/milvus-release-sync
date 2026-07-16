import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './helpers/cli.js';
import {
  createGitFixture,
  RELEASE_NOTES_PATH,
  VARIABLES_PATH,
} from './helpers/git-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('v2.6.20 public built-CLI replay', () => {
  it('reproduces commit 01a787a2 byte-for-byte through plan, approve, apply, and status', async () => {
    const repo = await createGitFixture();
    cleanups.push(repo.cleanup);
    const taskDir = await mkdtemp(join(tmpdir(), 'milvus-release-replay-'));
    cleanups.push(() => rm(taskDir, { recursive: true, force: true }));

    const [
      releaseNotesBefore,
      variablesBefore,
      releaseNotesAfter,
      variablesAfter,
      releaseDate,
    ] = await Promise.all([
      readFile(fixturePath('repo-before/site/en/release_notes.md')),
      readFile(fixturePath('repo-before/site/en/Variables.json')),
      readFile(fixturePath('repo-after/site/en/release_notes.md')),
      readFile(fixturePath('repo-after/site/en/Variables.json')),
      readFile(fixturePath('evidence/release-date.json'), 'utf8').then(
        (value) =>
          JSON.parse(value) as {
            date: string;
            reason: string;
          },
      ),
    ]);

    await Promise.all([
      writeFile(join(repo.path, RELEASE_NOTES_PATH), releaseNotesBefore),
      writeFile(join(repo.path, VARIABLES_PATH), variablesBefore),
    ]);
    await repo.git('add', RELEASE_NOTES_PATH, VARIABLES_PATH);
    await repo.git('commit', '-m', 'Use the v2.6.20 release baseline');
    await repo.git('branch', '-f', 'v2.6.x', 'HEAD');

    const planResult = await runCli([
      'plan',
      '--release-version',
      '2.6.20',
      '--release-line',
      '2.6.x',
      '--source',
      fixturePath('source/release-notes.remote.md'),
      '--repo',
      repo.path,
      '--base',
      'v2.6.x',
      '--task-dir',
      taskDir,
      '--release-date',
      releaseDate.date,
      '--release-date-reason',
      releaseDate.reason,
      '--sdk-evidence',
      fixturePath('evidence/sdk-versions.json'),
      '--format',
      'json',
    ]);

    expect(planResult.status).toBe(0);
    expect(planResult.stderr).toBe('');
    const plan = parseSingleJsonLine<{
      ok: boolean;
      command: string;
      taskDir: string;
      planHash: string;
      blocked: boolean;
      findings: Array<{ severity: string }>;
      files: Array<{
        path: string;
        beforeHash: string;
        afterHash: string;
        diff: string;
      }>;
    }>(planResult.stdout);
    expect(plan).toMatchObject({
      ok: true,
      command: 'plan',
      taskDir,
      blocked: false,
    });
    expect(plan.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.findings.filter(({ severity }) => severity === 'blocker')).toEqual([]);
    expect(
      plan.files.map(({ path, beforeHash, afterHash }) => ({
        path,
        beforeHash,
        afterHash,
      })),
    ).toEqual([
      {
        path: RELEASE_NOTES_PATH,
        beforeHash: sha256(releaseNotesBefore),
        afterHash: sha256(releaseNotesAfter),
      },
      {
        path: VARIABLES_PATH,
        beforeHash: sha256(variablesBefore),
        afterHash: sha256(variablesAfter),
      },
    ]);
    await expect(readFile(join(repo.path, RELEASE_NOTES_PATH))).resolves.toEqual(
      releaseNotesBefore,
    );
    await expect(readFile(join(repo.path, VARIABLES_PATH))).resolves.toEqual(
      variablesBefore,
    );
    await expect(repo.git('status', '--short')).resolves.toBe('');

    const approveResult = await runCli([
      'approve',
      taskDir,
      '--plan-hash',
      plan.planHash,
      '--by',
      'fixture-replay',
      '--format',
      'json',
    ]);

    expect(approveResult.status).toBe(0);
    expect(approveResult.stderr).toBe('');
    const approval = parseSingleJsonLine<{
      ok: boolean;
      command: string;
      approval: {
        planHash: string;
        approvedBy: string;
        approvedAt: string;
      };
    }>(approveResult.stdout);
    expect(approval).toMatchObject({
      ok: true,
      command: 'approve',
      approval: {
        planHash: plan.planHash,
        approvedBy: 'fixture-replay',
      },
    });
    expect(Number.isNaN(Date.parse(approval.approval.approvedAt))).toBe(false);

    const applyResult = await runCli([
      'apply',
      taskDir,
      '--write',
      '--format',
      'json',
    ]);

    expect(applyResult.status).toBe(0);
    expect(applyResult.stderr).toBe('');
    const apply = parseSingleJsonLine<{
      ok: boolean;
      command: string;
      mode: string;
      files: Array<{ path: string; diff: string }>;
    }>(applyResult.stdout);
    expect(apply).toMatchObject({
      ok: true,
      command: 'apply',
      mode: 'write',
    });
    expect(apply.files.map(({ path }) => path)).toEqual([
      RELEASE_NOTES_PATH,
      VARIABLES_PATH,
    ]);
    await expect(readFile(join(repo.path, RELEASE_NOTES_PATH))).resolves.toEqual(
      releaseNotesAfter,
    );
    await expect(readFile(join(repo.path, VARIABLES_PATH))).resolves.toEqual(
      variablesAfter,
    );

    const statusResult = await runCli([
      'status',
      taskDir,
      '--format',
      'json',
    ]);

    expect(statusResult.status).toBe(0);
    expect(statusResult.stderr).toBe('');
    expect(parseSingleJsonLine(statusResult.stdout)).toEqual({
      ok: true,
      command: 'status',
      state: 'applied',
      reasons: [],
    });
  }, 20_000);
});

function fixturePath(relativePath: string): string {
  return fileURLToPath(
    new URL(`./fixtures/v2.6.20/${relativePath}`, import.meta.url),
  );
}

function sha256(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseSingleJsonLine<T = unknown>(stdout: string): T {
  expect(stdout.trim().split('\n')).toHaveLength(1);
  return JSON.parse(stdout) as T;
}
