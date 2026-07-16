import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, hashCanonical } from '../src/core/hash.js';
import { loadPlan, loadTask, savePlan, saveTask } from '../src/core/task-store.js';
import type { ReleasePlan, ReleaseTask } from '../src/core/types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('canonical task state', () => {
  it('hashes objects independently of key insertion order', () => {
    expect(hashCanonical({ b: 2, a: 1 })).toBe(hashCanonical({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('round-trips validated task and plan artifacts', async () => {
    const taskDir = await mkdtemp(join(tmpdir(), 'mrs-task-'));
    roots.push(taskDir);
    const task: ReleaseTask = {
      kind: 'milvus-release-sync-task',
      schemaVersion: 1,
      status: 'planned',
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      createdAt: '2026-07-16T00:00:00.000Z',
      planHash: 'sha256:abc',
      approval: null
    };
    const plan: ReleasePlan = {
      kind: 'milvus-release-sync-plan',
      schemaVersion: 1,
      runnerVersion: '0.1.0',
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      generatedAt: '2026-07-16T00:00:00.000Z',
      workspace: {
        repoPath: '/tmp/milvus-docs',
        baseRef: 'upstream/v2.6.x',
        baseCommit: 'a'.repeat(40),
        headCommit: 'a'.repeat(40),
        canonicalRemote: 'upstream https://github.com/milvus-io/milvus-docs.git (fetch)',
        targetFilesClean: true,
        unrelatedDirtyFiles: [],
        fileHashes: {
          'site/en/release_notes.md': 'sha256:before-notes',
          'site/en/Variables.json': 'sha256:before-variables'
        }
      },
      source: {
        kind: 'local-markdown',
        locator: '/tmp/source.md',
        rawHash: 'sha256:source',
        markdown: '## Improvements\n'
      },
      releaseDate: {
        source: 'explicit',
        date: '2026-07-14',
        reason: 'fixture'
      },
      sdkVersions: [],
      findings: [],
      files: [
        plannedFile('site/en/release_notes.md'),
        plannedFile('site/en/Variables.json')
      ],
      planHash: 'sha256:abc'
    };

    await saveTask(taskDir, task);
    await savePlan(taskDir, plan);

    await expect(loadTask(taskDir)).resolves.toEqual(task);
    await expect(loadPlan(taskDir)).resolves.toEqual(plan);
  });
});

function plannedFile(path: 'site/en/release_notes.md' | 'site/en/Variables.json') {
  return {
    path,
    beforeHash: 'sha256:before',
    afterHash: 'sha256:after',
    before: 'before\n',
    after: 'after\n',
    diff: 'diff\n'
  };
}
