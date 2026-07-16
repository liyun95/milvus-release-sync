import { randomUUID } from 'node:crypto';
import {
  chmod,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  sep
} from 'node:path';
import { RunnerError } from '../core/cli-failure.js';
import { canonicalJson, sha256 } from '../core/hash.js';
import {
  planSchema,
  releaseDateEvidenceSchema,
  sdkVersionRowSchema
} from '../core/schema.js';
import { loadTask, saveTask } from '../core/task-store.js';
import type {
  PlannedFile,
  ReleasePlan,
  SdkVersionRow,
  WorkspaceSnapshot
} from '../core/types.js';
import { resolveReleaseDate } from '../evidence/release-date.js';
import { parseSdkRegistry } from '../evidence/sdk-registry.js';
import {
  listGithubTags,
  resolveSdkVersions
} from '../evidence/sdk-versions.js';
import {
  assertTaskDirOutsideRepo,
  computePlanHash
} from '../plan/build-plan.js';
import { unifiedDiff } from '../plan/diff.js';
import { runProcess } from '../process/run-process.js';
import {
  assertVerbatimBody,
  countReleaseHeadings,
  insertOrReplaceReleaseSection,
  renderReleaseSection
} from '../render/release-notes.js';
import { planVariables } from '../render/variables.js';
import { readLocalSource } from '../source/local-source.js';
import { acquireSource } from '../source/source.js';
import {
  ALLOWED_FILES,
  inspectAppliedWorkspace,
  inspectWorkspaceIdentity,
  preflightWorkspace,
  type AppliedWorkspaceInspection,
  type WorkspaceIdentity
} from '../workspace/preflight.js';

export type ApplyResult = {
  mode: 'dry-run' | 'write' | 'no-op';
  files: Array<{ path: string; diff: string }>;
};

const registryUrl = new URL('../../registry/sdk-sources.json', import.meta.url);

function approvalError(
  subtype: string,
  message: string,
  details?: Record<string, unknown>
): RunnerError {
  return new RunnerError(10, {
    type: 'approval',
    subtype,
    message,
    retryable: false,
    details
  });
}

function verificationError(
  subtype: string,
  message: string,
  details?: Record<string, unknown>
): RunnerError {
  return new RunnerError(5, {
    type: 'verification',
    subtype,
    message,
    retryable: false,
    details
  });
}

function planBlocked(): RunnerError {
  return new RunnerError(1, {
    type: 'blocked',
    subtype: 'plan_blocked',
    message: 'The approved plan contains blocker findings.',
    retryable: false
  });
}

function resultFiles(plan: ReleasePlan): ApplyResult['files'] {
  return plan.files.map((file) => ({ path: file.path, diff: file.diff }));
}

function rawAllowlist(raw: unknown): void {
  const files =
    raw !== null && typeof raw === 'object' && 'files' in raw
      ? (raw as { files?: unknown }).files
      : undefined;
  const paths = Array.isArray(files)
    ? files.map((file) =>
        file !== null && typeof file === 'object' && 'path' in file
          ? (file as { path?: unknown }).path
          : undefined
      )
    : [];
  const uniquePaths = new Set(paths);
  if (
    !Array.isArray(files) ||
    files.length !== ALLOWED_FILES.length ||
    uniquePaths.size !== ALLOWED_FILES.length ||
    paths.some(
      (path) =>
        typeof path !== 'string' ||
        !ALLOWED_FILES.includes(path as (typeof ALLOWED_FILES)[number])
    ) ||
    ALLOWED_FILES.some((path) => !uniquePaths.has(path))
  ) {
    throw verificationError(
      'allowlist_violation',
      'The release plan must contain exactly the two allowlisted target paths.',
      { paths }
    );
  }
}

async function loadPlanForApply(taskDir: string): Promise<ReleasePlan> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(taskDir, 'plan/plan.json'), 'utf8')) as unknown;
  } catch (error) {
    throw verificationError('plan_invalid', 'The stored release plan is not valid JSON.', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  rawAllowlist(raw);
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    throw verificationError('plan_invalid', 'The stored release plan does not match schema 1.', {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

function verifyApproval(
  task: Awaited<ReturnType<typeof loadTask>>,
  plan: ReleasePlan
): void {
  if (task.approval === null) {
    throw approvalError(
      'approval_required',
      'The release plan must be approved before apply.'
    );
  }
  const recomputedHash = computePlanHash(plan);
  if (
    recomputedHash !== plan.planHash ||
    task.planHash !== plan.planHash ||
    task.approval.planHash !== plan.planHash ||
    task.releaseVersion !== plan.releaseVersion ||
    task.releaseLine !== plan.releaseLine
  ) {
    throw approvalError(
      'approval_invalidated',
      'The stored approval no longer matches the current release plan.',
      {
        recomputedPlanHash: recomputedHash,
        planHash: plan.planHash,
        taskPlanHash: task.planHash,
        approvalPlanHash: task.approval.planHash
      }
    );
  }
}

function workspaceDrift(
  expected: WorkspaceSnapshot,
  current: WorkspaceIdentity
): string[] {
  const reasons: string[] = [];
  if (expected.repoPath !== current.repoPath) reasons.push('repository_path_changed');
  if (expected.canonicalRemote !== current.canonicalRemote) {
    reasons.push('repository_identity_changed');
  }
  if (expected.baseRef !== current.baseRef) reasons.push('base_ref_changed');
  if (expected.baseCommit !== current.baseCommit) reasons.push('base_commit_changed');
  if (expected.headCommit !== current.headCommit) reasons.push('head_commit_changed');
  return reasons;
}

function hashesMatch(
  plan: ReleasePlan,
  hashes: Record<string, string>,
  side: 'beforeHash' | 'afterHash'
): boolean {
  return plan.files.every((file) => hashes[file.path] === file[side]);
}

async function inspectCurrentState(
  plan: ReleasePlan
): Promise<{
  state: 'before' | 'after';
  workspace: WorkspaceSnapshot | AppliedWorkspaceInspection;
}> {
  try {
    const workspace = await preflightWorkspace({
      repoPath: plan.workspace.repoPath,
      baseRef: plan.workspace.baseRef
    });
    const reasons = workspaceDrift(plan.workspace, workspace);
    if (reasons.length > 0) {
      throw approvalError(
        'workspace_drift',
        'The Milvus Docs workspace no longer matches the approved plan.',
        { reasons }
      );
    }
    if (hashesMatch(plan, workspace.fileHashes, 'afterHash')) {
      return { state: 'after', workspace };
    }
    if (hashesMatch(plan, workspace.fileHashes, 'beforeHash')) {
      return { state: 'before', workspace };
    }
    throw approvalError(
      'target_drift',
      'The target files no longer match the approved before or after hashes.'
    );
  } catch (error) {
    if (
      error instanceof RunnerError &&
      error.failure.subtype === 'target_file_dirty'
    ) {
      try {
        const workspace = await inspectAppliedWorkspace({
          repoPath: plan.workspace.repoPath,
          baseRef: plan.workspace.baseRef,
          expectedAfterHashes: Object.fromEntries(
            plan.files.map((file) => [file.path, file.afterHash])
          ) as Record<(typeof ALLOWED_FILES)[number], string>
        });
        const reasons = workspaceDrift(plan.workspace, workspace);
        if (reasons.length > 0) {
          throw approvalError(
            'workspace_drift',
            'The Milvus Docs workspace no longer matches the approved plan.',
            { reasons }
          );
        }
        return { state: 'after', workspace };
      } catch (inspectionError) {
        if (
          inspectionError instanceof RunnerError &&
          (inspectionError.failure.subtype === 'workspace_drift' ||
            inspectionError.failure.subtype === 'approval_invalidated')
        ) {
          throw inspectionError;
        }
        throw approvalError(
          'target_drift',
          'The dirty target files do not match the approved after hashes.'
        );
      }
    }
    if (
      error instanceof RunnerError &&
      (error.failure.subtype === 'workspace_drift' ||
        error.failure.subtype === 'target_drift')
    ) {
      throw error;
    }
    throw approvalError(
      'workspace_drift',
      'Workspace preflight no longer matches the approved plan.',
      {
        cause:
          error instanceof RunnerError
            ? error.failure.subtype
            : error instanceof Error
              ? error.message
              : String(error)
      }
    );
  }
}

function evidenceDrift(component: string): RunnerError {
  return approvalError(
    'evidence_drift',
    'Approved evidence changed after planning.',
    { component }
  );
}

function sameEvidence(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw verificationError('plan_invalid', label + ' must contain a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requiredSdk(rows: SdkVersionRow[], id: string): string {
  const value = rows.find((row) => row.id === id)?.value;
  if (value === undefined) {
    throw evidenceDrift('sdk-versions');
  }
  return value;
}

function plannedFile(plan: ReleasePlan, path: PlannedFile['path']): PlannedFile {
  const file = plan.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw verificationError('allowlist_violation', 'An allowlisted plan file is missing.', {
      path
    });
  }
  return file;
}

async function revalidateEvidence(taskDir: string, plan: ReleasePlan): Promise<void> {
  const registryText = await readFile(registryUrl, 'utf8');
  if (sha256(registryText) !== plan.registryHash) {
    throw evidenceDrift('sdk-registry');
  }
  const registry = parseSdkRegistry(JSON.parse(registryText) as unknown);

  const sourceArtifact = await readFile(
    join(taskDir, 'source/release-notes.remote.md'),
    'utf8'
  );
  if (sourceArtifact !== plan.source.markdown) {
    throw evidenceDrift('source-artifact');
  }
  const source =
    plan.source.kind === 'local-markdown'
      ? await readLocalSource(plan.source.locator)
      : await acquireSource(plan.source.locator, (command, args) =>
          runProcess(command, args)
        );
  if (!sameEvidence(source, plan.source)) {
    throw evidenceDrift('source');
  }

  const releaseDateArtifact = releaseDateEvidenceSchema.parse(
    JSON.parse(
      await readFile(join(taskDir, 'evidence/release-date.json'), 'utf8')
    ) as unknown
  );
  if (!sameEvidence(releaseDateArtifact, plan.releaseDate)) {
    throw evidenceDrift('release-date');
  }
  const releaseDate = await resolveReleaseDate(
    plan.releaseDate.source === 'explicit'
      ? {
          releaseVersion: plan.releaseVersion,
          explicitDate: plan.releaseDate.date,
          explicitReason: plan.releaseDate.reason
        }
      : { releaseVersion: plan.releaseVersion }
  );
  if (!sameEvidence(releaseDate, plan.releaseDate)) {
    throw evidenceDrift('release-date');
  }

  const sdkArtifact = sdkVersionRowSchema.array().parse(
    JSON.parse(
      await readFile(join(taskDir, 'evidence/sdk-versions.json'), 'utf8')
    ) as unknown
  );
  if (!sameEvidence(sdkArtifact, plan.sdkVersions)) {
    throw evidenceDrift('sdk-versions');
  }
  const variablesFile = plannedFile(plan, 'site/en/Variables.json');
  const currentVariables = record(
    JSON.parse(variablesFile.before) as unknown,
    'Planned Variables.json before content'
  );
  const sdkVersions = await resolveSdkVersions({
    releaseVersion: plan.releaseVersion,
    releaseLine: plan.releaseLine,
    currentVariables,
    registry,
    listTags: listGithubTags,
    explicitEvidence: plan.sdkVersions.every((row) => row.sourceType === 'explicit')
      ? sdkArtifact
      : undefined
  });
  if (!sameEvidence(sdkVersions, plan.sdkVersions)) {
    throw evidenceDrift('sdk-versions');
  }

  const releaseNotesFile = plannedFile(plan, 'site/en/release_notes.md');
  const section = renderReleaseSection({
    releaseVersion: plan.releaseVersion,
    releaseDate: releaseDate.date,
    versions: {
      milvus: plan.releaseVersion,
      python: requiredSdk(sdkVersions, 'python'),
      nodejs: requiredSdk(sdkVersions, 'nodejs'),
      java: requiredSdk(sdkVersions, 'java'),
      go: requiredSdk(sdkVersions, 'go')
    },
    sourceMarkdown: source.markdown
  });
  assertVerbatimBody(source.markdown, section);
  const releaseNotesAfter = insertOrReplaceReleaseSection({
    localMarkdown: releaseNotesFile.before,
    releaseVersion: plan.releaseVersion,
    section
  });
  const sdkValues = Object.fromEntries(
    sdkVersions.flatMap((row) =>
      row.variablesKeys.map((key) => [key, row.value] as const)
    )
  );
  const variablesAfter = planVariables({
    variablesJson: variablesFile.before,
    releaseVersion: plan.releaseVersion,
    sdkValues,
    releaseTemplates: registry.releaseVariables
  }).after;
  const regenerated = [
    {
      file: releaseNotesFile,
      after: releaseNotesAfter,
      diff: unifiedDiff(releaseNotesFile.path, releaseNotesFile.before, releaseNotesAfter)
    },
    {
      file: variablesFile,
      after: variablesAfter,
      diff: unifiedDiff(variablesFile.path, variablesFile.before, variablesAfter)
    }
  ];
  if (
    regenerated.some(
      ({ file, after, diff }) =>
        after !== file.after ||
        sha256(after) !== file.afterHash ||
        diff !== file.diff
    )
  ) {
    throw evidenceDrift('rendered-output');
  }
}

function validateVariables(contents: string): void {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw verificationError(
      'write_verification_failed',
      'Variables.json is not valid JSON.'
    );
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw verificationError(
      'write_verification_failed',
      'Variables.json must contain a JSON object.'
    );
  }
}

function validateContents(plan: ReleasePlan, contents: Record<string, string>): void {
  const variables = contents['site/en/Variables.json'];
  const releaseNotes = contents['site/en/release_notes.md'];
  if (variables === undefined || releaseNotes === undefined) {
    throw verificationError('write_verification_failed', 'A target file is missing.');
  }
  validateVariables(variables);
  if (countReleaseHeadings(releaseNotes, plan.releaseVersion) !== 1) {
    throw verificationError(
      'write_verification_failed',
      'Release Notes must contain exactly one target release heading.'
    );
  }
}

async function readTargetContents(plan: ReleasePlan): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      plan.files.map(async (file) => [
        file.path,
        await readFile(join(plan.workspace.repoPath, file.path), 'utf8')
      ] as const)
    )
  );
}

function requireHashes(
  plan: ReleasePlan,
  contents: Record<string, string>,
  side: 'beforeHash' | 'afterHash',
  subtype: string
): void {
  const mismatched = plan.files.filter(
    (file) => sha256(contents[file.path] ?? '') !== file[side]
  );
  if (mismatched.length > 0) {
    if (subtype === 'target_drift') {
      throw approvalError(
        subtype,
        'Target files changed during apply revalidation.',
        { paths: mismatched.map((file) => file.path) }
      );
    }
    throw verificationError(
      subtype,
      'Written target files do not match the approved hashes.',
      { paths: mismatched.map((file) => file.path) }
    );
  }
}

async function assertParentInsideRepo(repoPath: string, targetPath: string): Promise<void> {
  const [repo, parent] = await Promise.all([
    realpath(repoPath),
    realpath(dirname(targetPath))
  ]);
  const fromRepo = relative(repo, parent);
  if (
    fromRepo === '..' ||
    fromRepo.startsWith('..' + sep) ||
    isAbsolute(fromRepo)
  ) {
    throw verificationError(
      'allowlist_violation',
      'An allowlisted target resolves outside the Milvus Docs worktree.',
      { targetPath, parent }
    );
  }
}

async function assertApprovedWorkspaceIdentity(plan: ReleasePlan): Promise<void> {
  let current;
  try {
    current = await inspectWorkspaceIdentity({
      repoPath: plan.workspace.repoPath,
      baseRef: plan.workspace.baseRef
    });
  } catch (error) {
    throw approvalError(
      'workspace_drift',
      'Workspace identity no longer matches the approved plan.',
      {
        cause:
          error instanceof RunnerError
            ? error.failure.subtype
            : error instanceof Error
              ? error.message
              : String(error)
      }
    );
  }

  const reasons = workspaceDrift(plan.workspace, current);
  if (reasons.length > 0) {
    throw approvalError(
      'workspace_drift',
      'The Milvus Docs workspace no longer matches the approved plan.',
      { reasons }
    );
  }
}

async function assertTargetBeforeRename(file: PlannedFile, targetPath: string): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(targetPath, 'utf8');
  } catch (error) {
    throw approvalError(
      'target_drift',
      'A target file became unavailable immediately before replacement.',
      {
        path: file.path,
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }
  if (sha256(contents) !== file.beforeHash) {
    throw approvalError(
      'target_drift',
      'A target file changed immediately before replacement.',
      { paths: [file.path] }
    );
  }
}

async function writeApprovedFiles(
  taskDir: string,
  task: Awaited<ReturnType<typeof loadTask>>,
  plan: ReleasePlan
): Promise<ApplyResult> {
  const temporaryPaths: string[] = [];
  const temporaryByPath = new Map<string, string>();
  const replacedPaths: string[] = [];

  try {
    await assertApprovedWorkspaceIdentity(plan);

    for (const file of plan.files) {
      const targetPath = join(plan.workspace.repoPath, file.path);
      await assertParentInsideRepo(plan.workspace.repoPath, targetPath);
      const metadata = await stat(targetPath);
      const temporaryPath = join(
        dirname(targetPath),
        '.' +
          basename(targetPath) +
          '.milvus-release-sync-' +
          randomUUID() +
          '.tmp'
      );
      await writeFile(temporaryPath, file.after, {
        encoding: 'utf8',
        flag: 'wx',
        mode: metadata.mode
      });
      await chmod(temporaryPath, metadata.mode);
      temporaryPaths.push(temporaryPath);
      temporaryByPath.set(file.path, temporaryPath);
      const written = await readFile(temporaryPath, 'utf8');
      if (sha256(written) !== file.afterHash) {
        throw verificationError(
          'temporary_file_verification_failed',
          'A temporary target file does not match the approved after hash.',
          { path: file.path }
        );
      }
    }

    const temporaryContents = Object.fromEntries(
      await Promise.all(
        plan.files.map(async (file) => [
          file.path,
          await readFile(temporaryByPath.get(file.path) as string, 'utf8')
        ] as const)
      )
    );
    validateContents(plan, temporaryContents);

    for (const file of plan.files) {
      const temporaryPath = temporaryByPath.get(file.path) as string;
      const targetPath = join(plan.workspace.repoPath, file.path);
      try {
        await assertApprovedWorkspaceIdentity(plan);
        await assertTargetBeforeRename(file, targetPath);
        await rename(temporaryPath, targetPath);
        replacedPaths.push(file.path);
      } catch (error) {
        if (replacedPaths.length > 0) {
          throw verificationError(
            'partial_write',
            'Only part of the approved release plan was written.',
            {
              replacedPath: replacedPaths.at(-1),
              failedPath: file.path,
              causeSubtype:
                error instanceof RunnerError ? error.failure.subtype : undefined,
              cause: error instanceof Error ? error.message : String(error)
            }
          );
        }
        if (
          error instanceof RunnerError &&
          (error.failure.subtype === 'workspace_drift' ||
            error.failure.subtype === 'target_drift')
        ) {
          throw error;
        }
        throw verificationError(
          'write_failed',
          'Failed to replace an approved target file.',
          {
            failedPath: file.path,
            cause: error instanceof Error ? error.message : String(error)
          }
        );
      }
    }

    const after = await readTargetContents(plan);
    requireHashes(plan, after, 'afterHash', 'write_verification_failed');
    validateContents(plan, after);
    await saveTask(taskDir, { ...task, status: 'applied' });
    return { mode: 'write', files: resultFiles(plan) };
  } finally {
    await Promise.all(
      temporaryPaths.map((path) => rm(path, { force: true }).catch(() => undefined))
    );
  }
}

export async function applyPlan(input: {
  taskDir: string;
  write: boolean;
}): Promise<ApplyResult> {
  const [task, plan] = await Promise.all([
    loadTask(input.taskDir),
    loadPlanForApply(input.taskDir)
  ]);
  await assertTaskDirOutsideRepo(input.taskDir, plan.workspace.repoPath);
  verifyApproval(task, plan);
  if (plan.findings.some((finding) => finding.severity === 'blocker')) {
    throw planBlocked();
  }

  const current = await inspectCurrentState(plan);
  if (current.state === 'after') {
    const contents = await readTargetContents(plan);
    requireHashes(plan, contents, 'afterHash', 'write_verification_failed');
    validateContents(plan, contents);
    if (input.write && task.status !== 'applied') {
      await saveTask(input.taskDir, { ...task, status: 'applied' });
    }
    return { mode: 'no-op', files: resultFiles(plan) };
  }

  await revalidateEvidence(input.taskDir, plan);
  if (!input.write) {
    return { mode: 'dry-run', files: resultFiles(plan) };
  }
  return writeApprovedFiles(input.taskDir, task, plan);
}
