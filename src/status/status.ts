import { RunnerError } from '../core/cli-failure.js';
import { loadPlan, loadTask } from '../core/task-store.js';
import type { ReleasePlan, WorkspaceSnapshot } from '../core/types.js';
import { computePlanHash } from '../plan/build-plan.js';
import {
  ALLOWED_FILES,
  inspectAppliedWorkspace,
  preflightWorkspace,
  type AppliedWorkspaceInspection,
} from '../workspace/preflight.js';

export type StatusState =
  | 'planned'
  | 'blocked'
  | 'approved'
  | 'approval-invalidated'
  | 'workspace-drifted'
  | 'applied';

export type StatusResult = {
  state: StatusState;
  reasons: string[];
};

export async function getStatus(taskDir: string): Promise<StatusResult> {
  const [task, plan] = await Promise.all([
    loadTask(taskDir),
    loadPlan(taskDir),
  ]);
  const hashReasons = planHashReasons(task, plan);
  if (hashReasons.length > 0) {
    return { state: 'approval-invalidated', reasons: hashReasons };
  }

  let workspace: WorkspaceSnapshot | AppliedWorkspaceInspection | undefined;
  let workspaceFailure: unknown;
  try {
    workspace = await preflightWorkspace({
      repoPath: plan.workspace.repoPath,
      baseRef: plan.workspace.baseRef,
    });
  } catch (error) {
    if (
      error instanceof RunnerError &&
      error.failure.subtype === 'target_file_dirty'
    ) {
      try {
        workspace = await inspectAppliedWorkspace({
          repoPath: plan.workspace.repoPath,
          baseRef: plan.workspace.baseRef,
          expectedAfterHashes: Object.fromEntries(
            plan.files.map((file) => [file.path, file.afterHash]),
          ) as Record<(typeof ALLOWED_FILES)[number], string>,
        });
      } catch (inspectionError) {
        workspaceFailure = inspectionError;
      }
    } else {
      workspaceFailure = error;
    }
  }

  if (workspace === undefined) {
    return {
      state: 'workspace-drifted',
      reasons: [workspaceFailureReason(workspaceFailure)],
    };
  }

  const targetsApplied =
    new Set(plan.files.map((file) => file.path)).size === ALLOWED_FILES.length &&
    ALLOWED_FILES.every((path) =>
      plan.files.some((file) => file.path === path),
    ) &&
    plan.files.every(
      (file) => workspace.fileHashes[file.path] === file.afterHash,
    );
  const driftReasons = workspaceDriftReasons(
    plan.workspace,
    workspace,
    targetsApplied,
  );
  if (driftReasons.length > 0) {
    return { state: 'workspace-drifted', reasons: driftReasons };
  }

  if (plan.findings.some((finding) => finding.severity === 'blocker')) {
    return { state: 'blocked', reasons: ['plan_blocked'] };
  }

  if (targetsApplied) {
    return { state: 'applied', reasons: [] };
  }

  if (task.status === 'applied') {
    return { state: 'workspace-drifted', reasons: ['applied_state_missing'] };
  }

  if (task.approval !== null) {
    return { state: 'approved', reasons: [] };
  }

  return { state: task.status === 'blocked' ? 'blocked' : 'planned', reasons: [] };
}

function planHashReasons(
  task: Awaited<ReturnType<typeof loadTask>>,
  plan: ReleasePlan,
): string[] {
  const reasons: string[] = [];
  const recomputedHash = computePlanHash(plan);

  if (
    recomputedHash !== plan.planHash ||
    task.planHash !== plan.planHash
  ) {
    reasons.push('plan_hash_mismatch');
  }
  if (
    task.approval !== null &&
    task.approval.planHash !== plan.planHash
  ) {
    reasons.push('approval_hash_mismatch');
  }
  if (
    (task.status === 'approved' || task.status === 'applied') &&
    task.approval === null
  ) {
    reasons.push('approval_missing');
  }

  return reasons;
}

function workspaceFailureReason(error: unknown): string {
  return error instanceof RunnerError
    ? `workspace_preflight:${error.failure.subtype}`
    : 'workspace_preflight:unexpected_error';
}

function workspaceDriftReasons(
  expected: WorkspaceSnapshot,
  current: Omit<WorkspaceSnapshot, 'targetFilesClean'>,
  targetsApplied: boolean,
): string[] {
  const reasons: string[] = [];
  if (expected.repoPath !== current.repoPath) {
    reasons.push('repository_path_changed');
  }
  if (expected.canonicalRemote !== current.canonicalRemote) {
    reasons.push('repository_identity_changed');
  }
  if (expected.baseRef !== current.baseRef) {
    reasons.push('base_ref_changed');
  }
  if (expected.baseCommit !== current.baseCommit) {
    reasons.push('base_commit_changed');
  }
  if (expected.headCommit !== current.headCommit) {
    reasons.push('head_commit_changed');
  }
  if (
    !targetsApplied &&
    ALLOWED_FILES.some(
      (path) => expected.fileHashes[path] !== current.fileHashes[path],
    )
  ) {
    reasons.push('target_file_changed');
  }
  return reasons;
}
