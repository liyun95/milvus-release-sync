import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { approvePlan } from '../src/approval/approval.js';
import { sha256 } from '../src/core/hash.js';
import {
  loadTask,
  savePlan,
  saveTask,
} from '../src/core/task-store.js';
import type {
  PlannedFile,
  ReleasePlan,
  ReleaseTask,
} from '../src/core/types.js';
import { computePlanHash } from '../src/plan/build-plan.js';
import { getStatus } from '../src/status/status.js';
import { preflightWorkspace } from '../src/workspace/preflight.js';
import {
  createGitFixture,
  RELEASE_NOTES_PATH,
  VARIABLES_PATH,
  type GitFixture,
} from './helpers/git-fixture.js';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const cleanups: Array<() => Promise<void>> = [];

type PreparedTask = {
  repo: GitFixture;
  taskDir: string;
  plan: ReleasePlan;
  task: ReleaseTask;
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('approvePlan', () => {
  it('rejects a supplied hash that does not match the task and plan', async () => {
    const prepared = await prepareTask();

    await expect(
      approvePlan({
        taskDir: prepared.taskDir,
        planHash: 'sha256:not-the-plan',
        approvedBy: 'release-reviewer',
      }),
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: {
        type: 'approval',
        subtype: 'plan_hash_mismatch',
        retryable: false,
      },
    });
  });

  it('rejects a plan whose content no longer matches its stored hash', async () => {
    const prepared = await prepareTask();
    await savePlan(prepared.taskDir, {
      ...prepared.plan,
      releaseVersion: '2.6.21',
    });

    await expect(
      approvePlan({
        taskDir: prepared.taskDir,
        planHash: prepared.plan.planHash,
        approvedBy: 'release-reviewer',
      }),
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: { subtype: 'plan_hash_mismatch' },
    });
  });

  it('records the approval in task.json and appends approvals.json history', async () => {
    const prepared = await prepareTask();
    const first = await approvePlan({
      taskDir: prepared.taskDir,
      planHash: prepared.plan.planHash,
      approvedBy: 'first-reviewer',
      now: () => new Date('2026-07-16T05:00:00.000Z'),
    });
    const second = await approvePlan({
      taskDir: prepared.taskDir,
      planHash: prepared.plan.planHash,
      approvedBy: 'second-reviewer',
      now: () => new Date('2026-07-16T06:00:00.000Z'),
    });

    expect(first).toEqual({
      planHash: prepared.plan.planHash,
      approvedBy: 'first-reviewer',
      approvedAt: '2026-07-16T05:00:00.000Z',
    });
    expect(second.approvedBy).toBe('second-reviewer');
    await expect(loadTask(prepared.taskDir)).resolves.toMatchObject({
      status: 'approved',
      approval: second,
    });
    await expect(
      readFile(join(prepared.taskDir, 'approvals.json'), 'utf8'),
    ).resolves.toBe(`${JSON.stringify([first, second], null, 2)}\n`);
  });
});

describe('getStatus', () => {
  it('reports planned and blocked tasks', async () => {
    const planned = await prepareTask();
    const blocked = await prepareTask({ blocked: true });

    await expect(getStatus(planned.taskDir)).resolves.toMatchObject({
      state: 'planned',
    });
    await expect(getStatus(blocked.taskDir)).resolves.toMatchObject({
      state: 'blocked',
      reasons: expect.arrayContaining(['plan_blocked']),
    });
  });

  it('reports a valid approval and ignores unrelated dirty files', async () => {
    const prepared = await prepareTask();
    await approve(prepared);
    await prepared.repo.write('notes/unrelated.md', 'local notes\n');

    await expect(getStatus(prepared.taskDir)).resolves.toEqual({
      state: 'approved',
      reasons: [],
    });
  });

  it('reports approval-invalidated when covered plan content changes', async () => {
    const prepared = await prepareTask();
    await approve(prepared);
    await savePlan(prepared.taskDir, {
      ...prepared.plan,
      releaseVersion: '2.6.21',
    });

    await expect(getStatus(prepared.taskDir)).resolves.toMatchObject({
      state: 'approval-invalidated',
      reasons: expect.arrayContaining(['plan_hash_mismatch']),
    });
  });

  it('does not invalidate approval when only generatedAt changes', async () => {
    const prepared = await prepareTask();
    await approve(prepared);
    await savePlan(prepared.taskDir, {
      ...prepared.plan,
      generatedAt: '2027-01-01T00:00:00.000Z',
    });

    await expect(getStatus(prepared.taskDir)).resolves.toEqual({
      state: 'approved',
      reasons: [],
    });
  });

  it('reports workspace-drifted when HEAD changes', async () => {
    const prepared = await prepareTask();
    await approve(prepared);
    await prepared.repo.write('notes/committed.md', 'new commit\n');
    await prepared.repo.git('add', 'notes/committed.md');
    await prepared.repo.git('commit', '-m', 'Move workspace HEAD');

    await expect(getStatus(prepared.taskDir)).resolves.toMatchObject({
      state: 'workspace-drifted',
      reasons: expect.arrayContaining(['head_commit_changed']),
    });
  });

  it('reports applied when dirty target files exactly match both after hashes', async () => {
    const prepared = await prepareTask();
    await approve(prepared);
    await prepared.repo.write(RELEASE_NOTES_PATH, prepared.plan.files[0].after);
    await prepared.repo.write(VARIABLES_PATH, prepared.plan.files[1].after);
    const approvedTask = await loadTask(prepared.taskDir);
    await saveTask(prepared.taskDir, { ...approvedTask, status: 'applied' });

    await expect(getStatus(prepared.taskDir)).resolves.toEqual({
      state: 'applied',
      reasons: [],
    });
  });

  it('reports blockers before applied when a blocked plan matches exact after bytes', async () => {
    const prepared = await prepareTask({ blocked: true });
    await prepared.repo.write(RELEASE_NOTES_PATH, prepared.plan.files[0].after);
    await prepared.repo.write(VARIABLES_PATH, prepared.plan.files[1].after);

    await expect(getStatus(prepared.taskDir)).resolves.toEqual({
      state: 'blocked',
      reasons: ['plan_blocked'],
    });
  });

  it('reports workspace drift before applied when HEAD changes after target writes', async () => {
    const prepared = await prepareTask();
    await approve(prepared);
    await prepared.repo.write(RELEASE_NOTES_PATH, prepared.plan.files[0].after);
    await prepared.repo.write(VARIABLES_PATH, prepared.plan.files[1].after);
    const approvedTask = await loadTask(prepared.taskDir);
    await saveTask(prepared.taskDir, { ...approvedTask, status: 'applied' });
    await prepared.repo.write('notes/committed.md', 'new HEAD after apply\n');
    await prepared.repo.git('add', 'notes/committed.md');
    await prepared.repo.git('commit', '-m', 'Move HEAD after target writes');

    await expect(getStatus(prepared.taskDir)).resolves.toMatchObject({
      state: 'workspace-drifted',
      reasons: expect.arrayContaining(['head_commit_changed']),
    });
  });
});

describe('approval and status CLI', () => {
  it('emits the stable mismatch failure and successful command results', async () => {
    const mismatch = await prepareTask();
    const failed = await runSourceCli([
      'approve',
      mismatch.taskDir,
      '--plan-hash',
      'sha256:not-the-plan',
      '--by',
      'release-reviewer',
      '--format',
      'json',
    ]);

    expect(failed.status).toBe(10);
    expect(failed.stdout).toBe('');
    expect(failed.stderr.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(failed.stderr)).toMatchObject({
      ok: false,
      error: { type: 'approval', subtype: 'plan_hash_mismatch' },
    });

    const prepared = await prepareTask();
    const approved = await runSourceCli([
      'approve',
      prepared.taskDir,
      '--plan-hash',
      prepared.plan.planHash,
      '--by',
      'release-reviewer',
      '--format',
      'json',
    ]);
    expect(approved.status).toBe(0);
    expect(approved.stderr).toBe('');
    expect(JSON.parse(approved.stdout)).toMatchObject({
      ok: true,
      command: 'approve',
      approval: {
        planHash: prepared.plan.planHash,
        approvedBy: 'release-reviewer',
      },
    });

    const status = await runSourceCli([
      'status',
      prepared.taskDir,
      '--format',
      'json',
    ]);
    expect(status.status).toBe(0);
    expect(status.stderr).toBe('');
    expect(JSON.parse(status.stdout)).toEqual({
      ok: true,
      command: 'status',
      state: 'approved',
      reasons: [],
    });
  });
});

async function prepareTask(
  options: { blocked?: boolean } = {},
): Promise<PreparedTask> {
  const repo = await createGitFixture();
  cleanups.push(repo.cleanup);
  const taskDir = await mkdtemp(join(tmpdir(), 'milvus-release-approval-'));
  cleanups.push(() => rm(taskDir, { recursive: true, force: true }));
  const workspace = await preflightWorkspace({
    repoPath: repo.path,
    baseRef: 'v2.6.x',
  });
  const [releaseNotesBefore, variablesBefore] = await Promise.all([
    readFile(join(repo.path, RELEASE_NOTES_PATH), 'utf8'),
    readFile(join(repo.path, VARIABLES_PATH), 'utf8'),
  ]);
  const files: ReleasePlan['files'] = [
    plannedFile(
      RELEASE_NOTES_PATH,
      releaseNotesBefore,
      `${releaseNotesBefore}\n## v2.6.20\n`,
    ),
    plannedFile(
      VARIABLES_PATH,
      variablesBefore,
      '{"version":"2.6.20","approved":true}\n',
    ),
  ];
  const planWithoutHash = {
    kind: 'milvus-release-sync-plan' as const,
    schemaVersion: 1 as const,
    runnerVersion: '0.1.0' as const,
    registryHash: sha256('registry'),
    releaseVersion: '2.6.20',
    releaseLine: '2.6.x',
    generatedAt: '2026-07-16T04:00:00.000Z',
    workspace,
    source: {
      kind: 'local-markdown' as const,
      locator: '/tmp/release-source.md',
      rawHash: sha256('## Improvements\n'),
      markdown: '## Improvements\n',
    },
    releaseDate: {
      source: 'explicit' as const,
      date: '2026-07-14',
      reason: 'Fixture release date',
    },
    sdkVersions: [],
    findings: options.blocked
      ? [
          {
            severity: 'blocker' as const,
            code: 'fixture_blocker',
            message: 'Fixture is blocked.',
          },
        ]
      : [],
    files,
  };
  const plan: ReleasePlan = {
    ...planWithoutHash,
    planHash: computePlanHash(planWithoutHash),
  };
  const task: ReleaseTask = {
    kind: 'milvus-release-sync-task',
    schemaVersion: 1,
    status: options.blocked ? 'blocked' : 'planned',
    releaseVersion: plan.releaseVersion,
    releaseLine: plan.releaseLine,
    createdAt: plan.generatedAt,
    planHash: plan.planHash,
    approval: null,
  };
  await Promise.all([savePlan(taskDir, plan), saveTask(taskDir, task)]);
  return { repo, taskDir, plan, task };
}

function plannedFile(
  path: PlannedFile['path'],
  before: string,
  after: string,
): PlannedFile {
  return {
    path,
    before,
    after,
    beforeHash: sha256(before),
    afterHash: sha256(after),
    diff: `--- a/${path}\n+++ b/${path}\n`,
  };
}

async function approve(prepared: PreparedTask): Promise<void> {
  await approvePlan({
    taskDir: prepared.taskDir,
    planHash: prepared.plan.planHash,
    approvedBy: 'release-reviewer',
    now: () => new Date('2026-07-16T05:00:00.000Z'),
  });
}

async function runSourceCli(args: string[]) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'src/cli/index.ts', ...args],
      { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}
