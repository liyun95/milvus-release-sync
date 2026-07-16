import { execFile } from 'node:child_process';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renameControl = vi.hoisted(() => ({
  failAt: 0,
  calls: 0,
  beforeFirstTemporaryWrite: undefined as (() => Promise<void>) | undefined,
  afterRename: undefined as ((call: number) => Promise<void>) | undefined
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const path = String(args[0]);
      if (
        basename(path).includes('.milvus-release-sync-') &&
        path.endsWith('.tmp') &&
        renameControl.beforeFirstTemporaryWrite !== undefined
      ) {
        const hook = renameControl.beforeFirstTemporaryWrite;
        renameControl.beforeFirstTemporaryWrite = undefined;
        await hook();
      }
      return actual.writeFile(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      renameControl.calls += 1;
      if (renameControl.failAt === renameControl.calls) {
        throw Object.assign(new Error('Injected rename failure'), { code: 'EIO' });
      }
      const result = await actual.rename(...args);
      await renameControl.afterRename?.(renameControl.calls);
      return result;
    }
  };
});

import { approvePlan } from '../src/approval/approval.js';
import { applyPlan } from '../src/apply/apply-plan.js';
import {
  loadTask,
  savePlan,
  saveTask
} from '../src/core/task-store.js';
import type { ReleasePlan } from '../src/core/types.js';
import { buildPlan, computePlanHash } from '../src/plan/build-plan.js';
import { getStatus } from '../src/status/status.js';
import {
  createGitFixture,
  RELEASE_NOTES_PATH,
  VARIABLES_PATH,
  type GitFixture
} from './helpers/git-fixture.js';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixturePath = (path: string) =>
  fileURLToPath(new URL('./fixtures/v2.6.20/' + path, import.meta.url));
const cleanups: Array<() => Promise<void>> = [];

type PreparedApply = {
  repo: GitFixture;
  taskDir: string;
  evidenceDir: string;
  sourcePath: string;
  sdkEvidencePath: string;
  plan: ReleasePlan;
};

afterEach(async () => {
  renameControl.failAt = 0;
  renameControl.calls = 0;
  renameControl.beforeFirstTemporaryWrite = undefined;
  renameControl.afterRename = undefined;
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('applyPlan safety', () => {
  it('requires an approval', async () => {
    const prepared = await prepareApply({ approve: false });

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: {
        type: 'approval',
        subtype: 'approval_required',
        retryable: false
      }
    });
  });

  it('rejects a copied task tree inside the target worktree', async () => {
    const prepared = await prepareApply();
    const copiedTaskDir = join(prepared.repo.path, '.milvus-release-sync-task');
    await cp(prepared.taskDir, copiedTaskDir, { recursive: true });

    await expect(
      applyPlan({ taskDir: copiedTaskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 2,
      failure: { type: 'validation', subtype: 'task_dir_inside_repo' }
    });
  });

  it('rejects an external symlink that resolves to a task tree inside the worktree', async () => {
    const prepared = await prepareApply();
    const copiedTaskDir = join(prepared.repo.path, '.milvus-release-sync-task');
    await cp(prepared.taskDir, copiedTaskDir, { recursive: true });
    const linkRoot = await mkdtemp(join(tmpdir(), 'milvus-release-task-link-'));
    cleanups.push(() => rm(linkRoot, { recursive: true, force: true }));
    const linkedTaskDir = join(linkRoot, 'task');
    await symlink(copiedTaskDir, linkedTaskDir, 'dir');

    await expect(
      applyPlan({ taskDir: linkedTaskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 2,
      failure: { type: 'validation', subtype: 'task_dir_inside_repo' }
    });
  });

  it('rejects target drift with approval exit 10', async () => {
    const prepared = await prepareApply();
    await prepared.repo.write(RELEASE_NOTES_PATH, '# Drifted release notes\n');

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: {
        type: 'approval',
        subtype: 'target_drift'
      }
    });
  });

  it.each([
    ['third', (plan: Record<string, unknown>) => {
      const files = plan.files as Array<Record<string, unknown>>;
      plan.files = [...files, { ...files[0], path: 'README.md' }];
    }],
    ['duplicate', (plan: Record<string, unknown>) => {
      const files = plan.files as Array<Record<string, unknown>>;
      plan.files = [files[0], files[0]];
    }],
    ['missing', (plan: Record<string, unknown>) => {
      const files = plan.files as Array<Record<string, unknown>>;
      plan.files = [files[0]];
    }]
  ])('rejects a raw %s path shape before Zod and hash checks', async (_name, forge) => {
    const prepared = await prepareApply();
    const planPath = join(prepared.taskDir, 'plan/plan.json');
    const raw = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>;
    forge(raw);
    await writeFile(planPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 5,
      failure: {
        type: 'verification',
        subtype: 'allowlist_violation'
      }
    });
  });

  it('returns both diffs in dry-run mode without writing targets or task state', async () => {
    const prepared = await prepareApply();
    const [notesBefore, variablesBefore, taskBefore] = await Promise.all([
      readFile(join(prepared.repo.path, RELEASE_NOTES_PATH), 'utf8'),
      readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8'),
      readFile(join(prepared.taskDir, 'task.json'), 'utf8')
    ]);

    const result = await applyPlan({ taskDir: prepared.taskDir, write: false });

    expect(result.mode).toBe('dry-run');
    expect(result.files).toEqual(
      prepared.plan.files.map((file) => ({ path: file.path, diff: file.diff }))
    );
    await expect(readFile(join(prepared.repo.path, RELEASE_NOTES_PATH), 'utf8')).resolves.toBe(
      notesBefore
    );
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      variablesBefore
    );
    await expect(readFile(join(prepared.taskDir, 'task.json'), 'utf8')).resolves.toBe(taskBefore);
    expect(await temporaryFiles(prepared.repo.path)).toEqual([]);
  });

  it('writes exact after bytes, verifies them, and marks the task applied', async () => {
    const prepared = await prepareApply();

    const result = await applyPlan({ taskDir: prepared.taskDir, write: true });

    expect(result.mode).toBe('write');
    await expect(readFile(join(prepared.repo.path, RELEASE_NOTES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[0].after
    );
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[1].after
    );
    await expect(loadTask(prepared.taskDir)).resolves.toMatchObject({
      status: 'applied',
      approval: { planHash: prepared.plan.planHash }
    });
    await expect(getStatus(prepared.taskDir)).resolves.toEqual({
      state: 'applied',
      reasons: []
    });
    expect(await temporaryFiles(prepared.repo.path)).toEqual([]);
  });

  it('returns no-op when both dirty targets already match the approved after hashes', async () => {
    const prepared = await prepareApply();
    await applyPlan({ taskDir: prepared.taskDir, write: true });

    const result = await applyPlan({ taskDir: prepared.taskDir, write: true });

    expect(result).toEqual({
      mode: 'no-op',
      files: prepared.plan.files.map((file) => ({ path: file.path, diff: file.diff }))
    });
  });

  it('invalidates approval when the covered plan hash changes', async () => {
    const prepared = await prepareApply();
    await savePlan(prepared.taskDir, {
      ...prepared.plan,
      releaseVersion: '2.6.21'
    });

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: { subtype: 'approval_invalidated' }
    });
  });

  it('rejects an approved blocked plan before target writes', async () => {
    const prepared = await prepareApply();
    await replaceApprovedPlan(prepared, {
      ...prepared.plan,
      findings: [
        ...prepared.plan.findings,
        {
          severity: 'blocker',
          code: 'fixture_blocker',
          message: 'Fixture is blocked.'
        }
      ]
    });

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 1,
      failure: { type: 'blocked', subtype: 'plan_blocked' }
    });
  });

  it('rejects workspace HEAD drift', async () => {
    const prepared = await prepareApply();
    await prepared.repo.write('notes/committed.md', 'move HEAD\n');
    await prepared.repo.git('add', 'notes/committed.md');
    await prepared.repo.git('commit', '-m', 'Move HEAD');

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: {
        type: 'approval',
        subtype: 'workspace_drift'
      }
    });
  });

  it('detects source, date, and SDK task artifact drift', async () => {
    const source = await prepareApply();
    await writeFile(source.sourcePath, '# Changed source\n', 'utf8');
    await expect(
      applyPlan({ taskDir: source.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: { subtype: 'evidence_drift', details: { component: 'source' } }
    });

    const date = await prepareApply();
    await writeFile(
      join(date.taskDir, 'evidence/release-date.json'),
      JSON.stringify({ ...date.plan.releaseDate, date: '2026-07-15' }, null, 2) + '\n',
      'utf8'
    );
    await expect(
      applyPlan({ taskDir: date.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: { subtype: 'evidence_drift', details: { component: 'release-date' } }
    });

    const sdk = await prepareApply();
    const changedSdk = sdk.plan.sdkVersions.map((row, index) =>
      index === 0 ? { ...row, value: '9.9.9' } : row
    );
    await writeFile(
      join(sdk.taskDir, 'evidence/sdk-versions.json'),
      JSON.stringify(changedSdk, null, 2) + '\n',
      'utf8'
    );
    await expect(
      applyPlan({ taskDir: sdk.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: { subtype: 'evidence_drift', details: { component: 'sdk-versions' } }
    });
  });

  it('detects drift in the frozen source task artifact', async () => {
    const prepared = await prepareApply();
    await writeFile(
      join(prepared.taskDir, 'source/release-notes.remote.md'),
      '# Tampered frozen source artifact\n',
      'utf8'
    );

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: false })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: {
        subtype: 'evidence_drift',
        details: { component: 'source-artifact' }
      }
    });
  });

  it('reports partial_write with replaced and failed paths when the second rename fails', async () => {
    const prepared = await prepareApply();
    renameControl.failAt = 2;

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 5,
      failure: {
        type: 'verification',
        subtype: 'partial_write',
        details: {
          replacedPath: RELEASE_NOTES_PATH,
          failedPath: VARIABLES_PATH
        }
      }
    });
    await expect(readFile(join(prepared.repo.path, RELEASE_NOTES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[0].after
    );
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[1].before
    );
    expect(await temporaryFiles(prepared.repo.path)).toEqual([]);
  });

  it('rejects workspace identity drift introduced after evidence revalidation', async () => {
    const prepared = await prepareApply();
    renameControl.beforeFirstTemporaryWrite = async () => {
      await prepared.repo.write('notes/late-head-change.md', 'late HEAD change\n');
      await prepared.repo.git('add', 'notes/late-head-change.md');
      await prepared.repo.git('commit', '-m', 'Move HEAD after evidence revalidation');
    };

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 10,
      failure: { type: 'approval', subtype: 'workspace_drift' }
    });
    await expect(readFile(join(prepared.repo.path, RELEASE_NOTES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[0].before
    );
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[1].before
    );
  });

  it('reports partial_write when the second target drifts after the first rename', async () => {
    const prepared = await prepareApply();
    const lateVariables = '{"late":"external edit"}\n';
    renameControl.afterRename = async (call) => {
      if (call === 1) {
        await prepared.repo.write(VARIABLES_PATH, lateVariables);
      }
    };

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 5,
      failure: {
        type: 'verification',
        subtype: 'partial_write',
        details: {
          replacedPath: RELEASE_NOTES_PATH,
          failedPath: VARIABLES_PATH
        }
      }
    });
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      lateVariables
    );
  });

  it('reports partial_write when workspace identity changes after the first rename', async () => {
    const prepared = await prepareApply();
    renameControl.afterRename = async (call) => {
      if (call === 1) {
        await prepared.repo.write('notes/interleaved-head-change.md', 'new HEAD\n');
        await prepared.repo.git('add', 'notes/interleaved-head-change.md');
        await prepared.repo.git('commit', '-m', 'Move HEAD between target renames');
      }
    };

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).rejects.toMatchObject({
      exitCode: 5,
      failure: {
        type: 'verification',
        subtype: 'partial_write',
        details: {
          replacedPath: RELEASE_NOTES_PATH,
          failedPath: VARIABLES_PATH
        }
      }
    });
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      prepared.plan.files[1].before
    );
  });

  it('counts the target release heading outside fenced code only', async () => {
    const prepared = await prepareApply({
      sourceSuffix: '\n~~~markdown\n## v2.6.20\n~~~\n'
    });

    await expect(
      applyPlan({ taskDir: prepared.taskDir, write: true })
    ).resolves.toMatchObject({ mode: 'write' });
  });
});

describe('apply CLI', () => {
  it('emits stable dry-run, write, and no-op JSON results', async () => {
    const prepared = await prepareApply();

    const dryRun = await runSourceCli([
      'apply',
      prepared.taskDir,
      '--format',
      'json'
    ]);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      ok: true,
      command: 'apply',
      mode: 'dry-run',
      files: expect.any(Array)
    });

    const write = await runSourceCli([
      'apply',
      prepared.taskDir,
      '--write',
      '--format',
      'json'
    ]);
    expect(write.status).toBe(0);
    expect(JSON.parse(write.stdout)).toMatchObject({
      ok: true,
      command: 'apply',
      mode: 'write'
    });

    const noOp = await runSourceCli([
      'apply',
      prepared.taskDir,
      '--write',
      '--format',
      'json'
    ]);
    expect(noOp.status).toBe(0);
    expect(JSON.parse(noOp.stdout)).toMatchObject({
      ok: true,
      command: 'apply',
      mode: 'no-op'
    });
  });
});

async function prepareApply(
  options: { approve?: boolean; sourceSuffix?: string } = {}
): Promise<PreparedApply> {
  const repo = await createGitFixture();
  cleanups.push(repo.cleanup);
  const taskDir = await mkdtemp(join(tmpdir(), 'milvus-release-apply-task-'));
  cleanups.push(() => rm(taskDir, { recursive: true, force: true }));
  const evidenceDir = await mkdtemp(join(tmpdir(), 'milvus-release-apply-evidence-'));
  cleanups.push(() => rm(evidenceDir, { recursive: true, force: true }));

  const [notesBefore, variablesBefore, source, sdkEvidence] = await Promise.all([
    readFile(fixturePath('repo-before/site/en/release_notes.md'), 'utf8'),
    readFile(fixturePath('repo-before/site/en/Variables.json'), 'utf8'),
    readFile(fixturePath('source/release-notes.remote.md'), 'utf8'),
    readFile(fixturePath('evidence/sdk-versions.json'), 'utf8')
  ]);
  await repo.write(RELEASE_NOTES_PATH, notesBefore);
  await repo.write(VARIABLES_PATH, variablesBefore);
  await repo.git('add', RELEASE_NOTES_PATH, VARIABLES_PATH);
  await repo.git('commit', '-m', 'Use v2.6.20 baseline');
  await repo.git('branch', '-f', 'v2.6.x', 'HEAD');

  const sourcePath = join(evidenceDir, 'release-notes.remote.md');
  const sdkEvidencePath = join(evidenceDir, 'sdk-versions.json');
  await Promise.all([
    writeFile(sourcePath, source + (options.sourceSuffix ?? ''), 'utf8'),
    writeFile(sdkEvidencePath, sdkEvidence, 'utf8')
  ]);
  const { plan } = await buildPlan({
    releaseVersion: '2.6.20',
    releaseLine: '2.6.x',
    sourceLocator: sourcePath,
    repoPath: repo.path,
    baseRef: 'v2.6.x',
    taskDir,
    explicitReleaseDate: '2026-07-14',
    explicitReleaseDateReason:
      'Frozen v2.6.20 fixture matching GitHub Release published_at',
    sdkEvidencePath,
    now: () => new Date('2026-07-16T03:04:05.000Z')
  });

  if (options.approve !== false) {
    await approvePlan({
      taskDir,
      planHash: plan.planHash,
      approvedBy: 'release-reviewer',
      now: () => new Date('2026-07-16T05:00:00.000Z')
    });
  }
  return { repo, taskDir, evidenceDir, sourcePath, sdkEvidencePath, plan };
}

async function replaceApprovedPlan(
  prepared: PreparedApply,
  changed: ReleasePlan
): Promise<void> {
  const planHash = computePlanHash(changed);
  const plan = { ...changed, planHash };
  const task = await loadTask(prepared.taskDir);
  const approval = {
    planHash,
    approvedBy: 'release-reviewer',
    approvedAt: '2026-07-16T05:00:00.000Z'
  };
  await Promise.all([
    savePlan(prepared.taskDir, plan),
    saveTask(prepared.taskDir, {
      ...task,
      status: 'approved',
      planHash,
      approval
    })
  ]);
  prepared.plan = plan;
}

async function temporaryFiles(repoPath: string): Promise<string[]> {
  const files = await readdir(join(repoPath, 'site/en'));
  return files.filter((file) => file.includes('.milvus-release-sync-'));
}

async function runSourceCli(args: string[]) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'src/cli/index.ts', ...args],
      { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? ''
    };
  }
}
