import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/core/hash.js';
import { loadPlan, loadTask } from '../src/core/task-store.js';
import { buildPlan, computePlanHash } from '../src/plan/build-plan.js';
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

type PreparedFixture = {
  repo: GitFixture;
  taskDir: string;
  releaseNotesBefore: string;
  variablesBefore: string;
};

describe('buildPlan', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function prepareFixture(): Promise<PreparedFixture> {
    const repo = await createGitFixture();
    cleanups.push(repo.cleanup);
    const taskDir = await mkdtemp(join(tmpdir(), 'milvus-release-plan-'));
    cleanups.push(() => rm(taskDir, { recursive: true, force: true }));

    const [releaseNotesBefore, variablesBefore] = await Promise.all([
      readFile(fixturePath('repo-before/site/en/release_notes.md'), 'utf8'),
      readFile(fixturePath('repo-before/site/en/Variables.json'), 'utf8')
    ]);
    await repo.write(RELEASE_NOTES_PATH, releaseNotesBefore);
    await repo.write(VARIABLES_PATH, variablesBefore);
    await repo.git('add', RELEASE_NOTES_PATH, VARIABLES_PATH);
    await repo.git('commit', '-m', 'Use v2.6.20 baseline');
    await repo.git('branch', '-f', 'v2.6.x', 'HEAD');

    return { repo, taskDir, releaseNotesBefore, variablesBefore };
  }

  function input(prepared: PreparedFixture, now = '2026-07-16T03:04:05.000Z') {
    return {
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      sourceLocator: fixturePath('source/release-notes.remote.md'),
      repoPath: prepared.repo.path,
      baseRef: 'v2.6.x',
      taskDir: prepared.taskDir,
      explicitReleaseDate: '2026-07-14',
      explicitReleaseDateReason:
        'Frozen v2.6.20 fixture matching GitHub Release published_at',
      sdkEvidencePath: fixturePath('evidence/sdk-versions.json'),
      now: () => new Date(now)
    };
  }

  it('builds the real two-file v2.6.20 plan and writes complete task artifacts', async () => {
    const prepared = await prepareFixture();
    const [releaseNotesAfter, variablesAfter, sourceMarkdown] = await Promise.all([
      readFile(fixturePath('repo-after/site/en/release_notes.md'), 'utf8'),
      readFile(fixturePath('repo-after/site/en/Variables.json'), 'utf8'),
      readFile(fixturePath('source/release-notes.remote.md'), 'utf8')
    ]);

    const result = await buildPlan(input(prepared));

    expect(result.plan).toMatchObject({
      kind: 'milvus-release-sync-plan',
      schemaVersion: 1,
      runnerVersion: '0.1.0',
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      generatedAt: '2026-07-16T03:04:05.000Z'
    });
    expect(result.plan.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.plan.findings.filter((finding) => finding.severity === 'blocker')).toEqual([]);
    expect(result.plan.findings).toContainEqual(
      expect.objectContaining({
        severity: 'planned_change',
        code: 'release_section_insert'
      })
    );
    expect(result.plan.findings).toContainEqual(
      expect.objectContaining({
        severity: 'planned_change',
        code: 'variables_update'
      })
    );
    expect(result.plan.files.map((file) => file.path)).toEqual([
      RELEASE_NOTES_PATH,
      VARIABLES_PATH
    ]);
    expect(result.plan.files[0].after).toBe(releaseNotesAfter);
    expect(result.plan.files[1].after).toBe(variablesAfter);
    expect(result.task).toEqual({
      kind: 'milvus-release-sync-task',
      schemaVersion: 1,
      status: 'planned',
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      createdAt: '2026-07-16T03:04:05.000Z',
      planHash: result.plan.planHash,
      approval: null
    });

    await expect(loadPlan(prepared.taskDir)).resolves.toEqual(result.plan);
    await expect(loadTask(prepared.taskDir)).resolves.toEqual(result.task);
    await expect(
      readFile(join(prepared.taskDir, 'source/release-notes.remote.md'), 'utf8')
    ).resolves.toBe(sourceMarkdown);
    await expect(
      readFile(join(prepared.taskDir, 'evidence/release-date.json'), 'utf8')
    ).resolves.toBe(JSON.stringify(result.plan.releaseDate, null, 2) + '\n');
    await expect(
      readFile(join(prepared.taskDir, 'evidence/sdk-versions.json'), 'utf8')
    ).resolves.toBe(JSON.stringify(result.plan.sdkVersions, null, 2) + '\n');

    const report = await readFile(join(prepared.taskDir, 'plan/report.md'), 'utf8');
    expect(report).toContain('## Workspace');
    expect(report).toContain('## Source');
    expect(report).toContain('## Evidence');
    expect(report).toContain('## Findings');
    expect(report).toContain('## Plan hash');
    expect(report).toContain(result.plan.planHash);
    expect(report).toContain(RELEASE_NOTES_PATH);
    expect(report).toContain(VARIABLES_PATH);

    const patch = await readFile(join(prepared.taskDir, 'plan/patch.diff'), 'utf8');
    expect(patch).toBe(
      result.plan.files.map((file) => file.diff.trimEnd()).join('\n\n') + '\n'
    );
    await expect(readFile(join(prepared.repo.path, RELEASE_NOTES_PATH), 'utf8')).resolves.toBe(
      prepared.releaseNotesBefore
    );
    await expect(readFile(join(prepared.repo.path, VARIABLES_PATH), 'utf8')).resolves.toBe(
      prepared.variablesBefore
    );
  });

  it('excludes generatedAt and taskDir from the stable plan hash', async () => {
    const first = await prepareFixture();
    const secondTaskDir = await mkdtemp(join(tmpdir(), 'milvus-release-plan-second-'));
    cleanups.push(() => rm(secondTaskDir, { recursive: true, force: true }));

    const firstResult = await buildPlan(input(first, '2026-07-16T03:04:05.000Z'));
    const secondResult = await buildPlan({
      ...input(first, '2027-01-02T00:00:00.000Z'),
      taskDir: secondTaskDir
    });

    expect(secondResult.plan.generatedAt).not.toBe(firstResult.plan.generatedAt);
    expect(secondResult.plan.planHash).toBe(firstResult.plan.planHash);
  });

  it('records the raw SDK registry hash and covers it in the reusable plan hash', async () => {
    const prepared = await prepareFixture();
    const registryText = await readFile(
      new URL('../registry/sdk-sources.json', import.meta.url),
      'utf8'
    );

    const { plan } = await buildPlan(input(prepared));

    expect(plan.registryHash).toBe(sha256(registryText));
    expect(computePlanHash(plan)).toBe(plan.planHash);
    expect(
      computePlanHash({ ...plan, registryHash: sha256(registryText + '\n') })
    ).not.toBe(plan.planHash);
  });

  it('runs plan through the source CLI and emits the public JSON summary', async () => {
    const prepared = await prepareFixture();

    const result = await runSourceCli([
      'plan',
      '--release-version',
      '2.6.20',
      '--release-line',
      '2.6.x',
      '--source',
      fixturePath('source/release-notes.remote.md'),
      '--repo',
      prepared.repo.path,
      '--base',
      'v2.6.x',
      '--task-dir',
      prepared.taskDir,
      '--release-date',
      '2026-07-14',
      '--release-date-reason',
      'Frozen v2.6.20 fixture matching GitHub Release published_at',
      '--sdk-evidence',
      fixturePath('evidence/sdk-versions.json'),
      '--format',
      'json'
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).toMatchObject({
      ok: true,
      command: 'plan',
      taskDir: prepared.taskDir,
      blocked: false
    });
    expect(output.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(output.findings).toEqual(expect.any(Array));
    expect(
      (output.files as Array<{ path: string }>).map((file) => file.path)
    ).toEqual([RELEASE_NOTES_PATH, VARIABLES_PATH]);
    await expect(access(join(prepared.taskDir, 'plan/plan.json'))).resolves.toBeUndefined();
  });

  it('rejects an unsupported plan output format before creating artifacts', async () => {
    const prepared = await prepareFixture();

    const result = await runSourceCli([
      'plan',
      '--release-version',
      '2.6.20',
      '--release-line',
      '2.6.x',
      '--source',
      fixturePath('source/release-notes.remote.md'),
      '--repo',
      prepared.repo.path,
      '--base',
      'v2.6.x',
      '--task-dir',
      prepared.taskDir,
      '--format',
      'yaml'
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Output format must be pretty or json.');
    await expect(access(join(prepared.taskDir, 'task.json'))).rejects.toThrow();
  });

  it('rejects a task directory inside the Milvus Docs worktree without writing artifacts', async () => {
    const prepared = await prepareFixture();
    const taskDir = join(prepared.repo.path, '.milvus-release-sync', 'task');

    await expect(
      buildPlan({ ...input(prepared), taskDir })
    ).rejects.toMatchObject({
      exitCode: 2,
      failure: { type: 'validation', subtype: 'task_dir_inside_repo' }
    });
    await expect(access(taskDir)).rejects.toThrow();
  });

  it('rejects the worktree root itself as a task directory without writing artifacts', async () => {
    const prepared = await prepareFixture();

    await expect(
      buildPlan({ ...input(prepared), taskDir: prepared.repo.path })
    ).rejects.toMatchObject({
      exitCode: 2,
      failure: { type: 'validation', subtype: 'task_dir_inside_repo' }
    });
    await expect(access(join(prepared.repo.path, 'task.json'))).rejects.toThrow();
    await expect(access(join(prepared.repo.path, 'source'))).rejects.toThrow();
    await expect(access(join(prepared.repo.path, 'plan'))).rejects.toThrow();
    await expect(access(join(prepared.repo.path, 'evidence'))).rejects.toThrow();
  });
});

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
