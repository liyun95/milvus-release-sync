import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/core/hash.js';
import {
  ALLOWED_FILES,
  inspectAppliedWorkspace,
  preflightWorkspace,
} from '../src/workspace/preflight.js';
import {
  createGitFixture,
  RELEASE_NOTES_PATH,
  VARIABLES_PATH,
  type GitFixture,
} from './helpers/git-fixture.js';

describe('preflightWorkspace', () => {
  const cleanups: Array<() => Promise<void>> = [];

  const fixture = async (): Promise<GitFixture> => {
    const result = await createGitFixture();
    cleanups.push(result.cleanup);
    return result;
  };

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('rejects a missing Milvus Docs repository', async () => {
    const missingPath = join(tmpdir(), `missing-milvus-docs-${Date.now()}`);

    await expect(
      preflightWorkspace({
        repoPath: missingPath,
        baseRef: 'upstream/v2.6.x',
      }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: { type: 'configuration', subtype: 'milvus_docs_missing' },
    });
  });

  it('rejects an existing directory that is not a Git worktree', async () => {
    const path = await mkdtemp(join(tmpdir(), 'milvus-release-sync-not-git-'));
    cleanups.push(() => rm(path, { recursive: true, force: true }));

    await expect(
      preflightWorkspace({ repoPath: path, baseRef: 'v2.6.x' }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: { type: 'configuration', subtype: 'not_git_worktree' },
    });
  });

  it('returns commits, the canonical remote, and target hashes for a valid workspace', async () => {
    const repo = await fixture();
    const headCommit = await repo.git('rev-parse', 'HEAD');

    const snapshot = await preflightWorkspace({
      repoPath: repo.path,
      baseRef: 'v2.6.x',
    });

    expect(snapshot).toEqual({
      repoPath: repo.path,
      baseRef: 'v2.6.x',
      baseCommit: headCommit,
      headCommit,
      canonicalRemote:
        'origin\thttps://github.com/milvus-io/milvus-docs.git (fetch)',
      targetFilesClean: true,
      unrelatedDirtyFiles: [],
      fileHashes: {
        [RELEASE_NOTES_PATH]: sha256('# Release Notes\n'),
        [VARIABLES_PATH]: sha256('{"version":"2.6.20"}\n'),
      },
    });
    expect(ALLOWED_FILES).toEqual([RELEASE_NOTES_PATH, VARIABLES_PATH]);
  });

  it('rejects a checkout without a canonical Milvus Docs remote', async () => {
    const repo = await fixture();
    await repo.git('remote', 'set-url', 'origin', 'https://github.com/example/fork.git');

    await expect(
      preflightWorkspace({ repoPath: repo.path, baseRef: 'v2.6.x' }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: {
        type: 'configuration',
        subtype: 'repository_identity_mismatch',
      },
    });
  });

  it('rejects a base ref that is not available locally', async () => {
    const repo = await fixture();

    await expect(
      preflightWorkspace({ repoPath: repo.path, baseRef: 'v2.5.x' }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: { type: 'configuration', subtype: 'base_ref_missing' },
    });
  });

  it('rejects a HEAD that is not descended from the release base', async () => {
    const repo = await fixture();
    await repo.git('checkout', '--orphan', 'unrelated');
    await repo.git('rm', '-rf', '.');
    await repo.write(RELEASE_NOTES_PATH, '# Unrelated Release Notes\n');
    await repo.write(VARIABLES_PATH, '{}\n');
    await repo.git('add', RELEASE_NOTES_PATH, VARIABLES_PATH);
    await repo.git('commit', '-m', 'Create unrelated history');

    await expect(
      preflightWorkspace({ repoPath: repo.path, baseRef: 'v2.6.x' }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: {
        type: 'configuration',
        subtype: 'head_not_based_on_release_base',
      },
    });
  });

  it('rejects a workspace with a missing target file', async () => {
    const repo = await fixture();
    await rm(join(repo.path, VARIABLES_PATH));

    await expect(
      preflightWorkspace({ repoPath: repo.path, baseRef: 'v2.6.x' }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: {
        type: 'configuration',
        subtype: 'target_file_missing',
        details: { paths: [VARIABLES_PATH] },
      },
    });
  });

  it('rejects uncommitted changes to an allowlisted target file', async () => {
    const repo = await fixture();
    await repo.write(RELEASE_NOTES_PATH, '# Edited Release Notes\n');

    await expect(
      preflightWorkspace({ repoPath: repo.path, baseRef: 'v2.6.x' }),
    ).rejects.toMatchObject({
      exitCode: 3,
      failure: {
        type: 'configuration',
        subtype: 'target_file_dirty',
        details: { paths: [RELEASE_NOTES_PATH] },
      },
    });
  });

  it('inspects exact dirty-after targets without claiming they are clean', async () => {
    const repo = await fixture();
    const releaseNotes = '# Applied Release Notes\n';
    await repo.write(RELEASE_NOTES_PATH, releaseNotes);

    const inspection = await inspectAppliedWorkspace({
      repoPath: repo.path,
      baseRef: 'v2.6.x',
      expectedAfterHashes: {
        [RELEASE_NOTES_PATH]: sha256(releaseNotes),
        [VARIABLES_PATH]: sha256('{"version":"2.6.20"}\n'),
      },
    });

    expect(inspection.fileHashes[RELEASE_NOTES_PATH]).toBe(sha256(releaseNotes));
    expect(inspection.targetFilesDirty).toBe(true);
    expect(inspection.targetFilesMatchExpectedAfter).toBe(true);
    expect(inspection).not.toHaveProperty('targetFilesClean');
    expect(inspection.unrelatedDirtyFiles).toEqual([]);
  });

  it('rejects dirty targets that do not match the bound after hashes', async () => {
    const repo = await fixture();
    await repo.write(RELEASE_NOTES_PATH, '# Unexpected Release Notes\n');

    await expect(
      inspectAppliedWorkspace({
        repoPath: repo.path,
        baseRef: 'v2.6.x',
        expectedAfterHashes: {
          [RELEASE_NOTES_PATH]: sha256('# Planned Release Notes\n'),
          [VARIABLES_PATH]: sha256('{"version":"2.6.20"}\n'),
        },
      }),
    ).rejects.toMatchObject({
      exitCode: 5,
      failure: { type: 'verification', subtype: 'target_state_mismatch' },
    });
  });

  it('rejects applied-workspace expectations outside the exact two-file allowlist', async () => {
    const repo = await fixture();

    await expect(
      inspectAppliedWorkspace({
        repoPath: repo.path,
        baseRef: 'v2.6.x',
        expectedAfterHashes: {
          [RELEASE_NOTES_PATH]: sha256('# Release Notes\n'),
          [VARIABLES_PATH]: sha256('{"version":"2.6.20"}\n'),
          'README.md': sha256('forged'),
        } as never,
      }),
    ).rejects.toMatchObject({
      exitCode: 5,
      failure: { type: 'verification', subtype: 'allowlist_violation' },
    });
  });

  it('reports unrelated dirty files without blocking preflight', async () => {
    const repo = await fixture();
    await repo.write('local-review.md', 'Review in progress\n');

    const snapshot = await preflightWorkspace({
      repoPath: repo.path,
      baseRef: 'v2.6.x',
    });

    expect(snapshot.targetFilesClean).toBe(true);
    expect(snapshot.unrelatedDirtyFiles).toEqual(['local-review.md']);
    await expect(access(join(repo.path, 'local-review.md'))).resolves.toBeUndefined();
  });
});
