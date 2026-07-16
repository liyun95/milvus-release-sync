import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RunnerError } from '../core/cli-failure.js';
import { sha256 } from '../core/hash.js';
import { runProcess } from '../process/run-process.js';

export const ALLOWED_FILES = [
  'site/en/release_notes.md',
  'site/en/Variables.json',
] as const;

type AllowedFile = (typeof ALLOWED_FILES)[number];

export type WorkspaceSnapshot = {
  repoPath: string;
  baseRef: string;
  baseCommit: string;
  headCommit: string;
  canonicalRemote: string;
  targetFilesClean: true;
  unrelatedDirtyFiles: string[];
  fileHashes: Record<AllowedFile, string>;
};

export type WorkspaceIdentity = Pick<
  WorkspaceSnapshot,
  | 'repoPath'
  | 'baseRef'
  | 'baseCommit'
  | 'headCommit'
  | 'canonicalRemote'
>;

type WorkspaceState = Omit<WorkspaceSnapshot, 'targetFilesClean'>;

type WorkspaceInspection = WorkspaceState & {
  targetDirtyFiles: AllowedFile[];
};

export type AppliedWorkspaceInspection = WorkspaceState & {
  targetFilesDirty: boolean;
  targetFilesMatchExpectedAfter: true;
};

function configurationError(
  subtype: string,
  message: string,
  options: {
    hint?: string;
    details?: Record<string, unknown>;
  } = {},
): RunnerError {
  return new RunnerError(3, {
    type: 'configuration',
    subtype,
    message,
    hint: options.hint,
    retryable: false,
    details: options.details,
  });
}

function verificationError(
  subtype: string,
  message: string,
  details?: Record<string, unknown>,
): RunnerError {
  return new RunnerError(5, {
    type: 'verification',
    subtype,
    message,
    retryable: false,
    details,
  });
}

function isCanonicalRemote(line: string): boolean {
  const fields = line.trim().split(/\s+/);
  const url = fields[1];
  if (url === undefined) {
    return false;
  }

  return (
    /^https?:\/\/github\.com\/milvus-io\/milvus-docs(?:\.git)?\/?$/i.test(url) ||
    /^git@github\.com:milvus-io\/milvus-docs(?:\.git)?$/i.test(url) ||
    /^ssh:\/\/git@github\.com\/milvus-io\/milvus-docs(?:\.git)?\/?$/i.test(url)
  );
}

function statusPath(line: string): string {
  const path = line.slice(3);
  const renameSeparator = ' -> ';
  const separatorIndex = path.indexOf(renameSeparator);
  return separatorIndex === -1
    ? path
    : path.slice(separatorIndex + renameSeparator.length);
}

async function requireDirectory(repoPath: string): Promise<void> {
  try {
    const metadata = await stat(repoPath);
    if (metadata.isDirectory()) {
      return;
    }
  } catch {
    // The structured error below covers missing and inaccessible paths.
  }

  throw configurationError(
    'milvus_docs_missing',
    `Milvus Docs repository directory does not exist: ${repoPath}`,
    {
      hint: 'Clone Milvus Docs, prepare a worktree based on the desired release branch, and rerun with --repo and --base.',
      details: { repoPath },
    },
  );
}

export async function inspectWorkspaceIdentity(input: {
  repoPath: string;
  baseRef: string;
}): Promise<WorkspaceIdentity> {
  await requireDirectory(input.repoPath);

  let repoPath: string;
  try {
    repoPath = (
      await runProcess('git', ['rev-parse', '--show-toplevel'], input.repoPath)
    ).trim();
  } catch {
    throw configurationError(
      'not_git_worktree',
      `Milvus Docs path is not a Git worktree: ${input.repoPath}`,
      { details: { repoPath: input.repoPath } },
    );
  }

  const remoteOutput = await runProcess('git', ['remote', '-v'], repoPath);
  const canonicalRemote = remoteOutput
    .split('\n')
    .find((line) => isCanonicalRemote(line));
  if (canonicalRemote === undefined) {
    throw configurationError(
      'repository_identity_mismatch',
      'The configured Git remotes do not identify milvus-io/milvus-docs.',
      {
        hint: 'Add the canonical Milvus Docs repository as a remote and rerun preflight.',
        details: { repoPath },
      },
    );
  }

  let baseCommit: string;
  try {
    baseCommit = (
      await runProcess(
        'git',
        ['rev-parse', '--verify', `${input.baseRef}^{commit}`],
        repoPath,
      )
    ).trim();
  } catch {
    throw configurationError(
      'base_ref_missing',
      `Base ref does not resolve to a local commit: ${input.baseRef}`,
      {
        hint: 'Prepare the requested release base locally and rerun with --base.',
        details: { baseRef: input.baseRef },
      },
    );
  }

  const headCommit = (
    await runProcess('git', ['rev-parse', 'HEAD'], repoPath)
  ).trim();
  try {
    await runProcess(
      'git',
      ['merge-base', '--is-ancestor', baseCommit, headCommit],
      repoPath,
    );
  } catch {
    throw configurationError(
      'head_not_based_on_release_base',
      `HEAD is not based on ${input.baseRef}.`,
      {
        hint: 'Select or prepare a worktree whose HEAD descends from the requested release base.',
        details: { baseRef: input.baseRef, baseCommit, headCommit },
      },
    );
  }

  return {
    repoPath,
    baseRef: input.baseRef,
    baseCommit,
    headCommit,
    canonicalRemote,
  };
}

async function inspectWorkspace(input: {
  repoPath: string;
  baseRef: string;
}): Promise<WorkspaceInspection> {
  const identity = await inspectWorkspaceIdentity(input);
  const { repoPath } = identity;

  const missingFiles: AllowedFile[] = [];
  for (const path of ALLOWED_FILES) {
    try {
      const metadata = await stat(join(repoPath, path));
      if (!metadata.isFile()) {
        missingFiles.push(path);
      }
    } catch {
      missingFiles.push(path);
    }
  }
  if (missingFiles.length > 0) {
    throw configurationError(
      'target_file_missing',
      `Required target file${missingFiles.length === 1 ? ' is' : 's are'} missing.`,
      { details: { paths: missingFiles } },
    );
  }

  const statusOutput = await runProcess(
    'git',
    ['status', '--porcelain'],
    repoPath,
  );
  const dirtyFiles = statusOutput
    .split('\n')
    .filter((line) => line.length >= 4)
    .map(statusPath);
  const targetDirtyFiles = ALLOWED_FILES.filter((path) =>
    dirtyFiles.includes(path),
  );

  const releaseNotes = await readFile(join(repoPath, ALLOWED_FILES[0]), 'utf8');
  const variables = await readFile(join(repoPath, ALLOWED_FILES[1]), 'utf8');
  const unrelatedDirtyFiles = dirtyFiles.filter(
    (path) => !ALLOWED_FILES.includes(path as AllowedFile),
  );

  return {
    ...identity,
    targetDirtyFiles,
    unrelatedDirtyFiles,
    fileHashes: {
      [ALLOWED_FILES[0]]: sha256(releaseNotes),
      [ALLOWED_FILES[1]]: sha256(variables),
    },
  };
}

export async function preflightWorkspace(input: {
  repoPath: string;
  baseRef: string;
}): Promise<WorkspaceSnapshot> {
  const inspection = await inspectWorkspace(input);
  if (inspection.targetDirtyFiles.length > 0) {
    throw configurationError(
      'target_file_dirty',
      `Allowlisted target file${inspection.targetDirtyFiles.length === 1 ? ' has' : 's have'} uncommitted changes.`,
      { details: { paths: inspection.targetDirtyFiles } },
    );
  }

  const { targetDirtyFiles: _targetDirtyFiles, ...workspace } = inspection;
  return { ...workspace, targetFilesClean: true };
}

export async function inspectAppliedWorkspace(input: {
  repoPath: string;
  baseRef: string;
  expectedAfterHashes: Record<AllowedFile, string>;
}): Promise<AppliedWorkspaceInspection> {
  const expectedPaths = Object.keys(input.expectedAfterHashes);
  if (
    expectedPaths.length !== ALLOWED_FILES.length ||
    expectedPaths.some((path) => !ALLOWED_FILES.includes(path as AllowedFile)) ||
    ALLOWED_FILES.some((path) => !Object.hasOwn(input.expectedAfterHashes, path))
  ) {
    throw verificationError(
      'allowlist_violation',
      'Applied workspace inspection requires exactly the two allowlisted target files.',
      { paths: expectedPaths },
    );
  }

  const inspection = await inspectWorkspace(input);
  const mismatchedPaths = ALLOWED_FILES.filter(
    (path) => inspection.fileHashes[path] !== input.expectedAfterHashes[path],
  );
  if (mismatchedPaths.length > 0) {
    throw verificationError(
      'target_state_mismatch',
      'Current target files do not match the expected applied hashes.',
      { paths: mismatchedPaths },
    );
  }

  const { targetDirtyFiles, ...workspace } = inspection;
  return {
    ...workspace,
    targetFilesDirty: targetDirtyFiles.length > 0,
    targetFilesMatchExpectedAfter: true,
  };
}
