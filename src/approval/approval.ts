import { RunnerError } from '../core/cli-failure.js';
import { approvalSchema } from '../core/schema.js';
import {
  loadApprovals,
  loadPlan,
  loadTask,
  saveApprovals,
  saveTask,
} from '../core/task-store.js';
import type { Approval } from '../core/types.js';
import { computePlanHash } from '../plan/build-plan.js';

export async function approvePlan(input: {
  taskDir: string;
  planHash: string;
  approvedBy: string;
  now?: () => Date;
}): Promise<Approval> {
  const [task, plan, approvals] = await Promise.all([
    loadTask(input.taskDir),
    loadPlan(input.taskDir),
    loadApprovals(input.taskDir),
  ]);
  const recomputedHash = computePlanHash(plan);

  if (
    input.planHash !== task.planHash ||
    input.planHash !== plan.planHash ||
    input.planHash !== recomputedHash
  ) {
    throw new RunnerError(10, {
      type: 'approval',
      subtype: 'plan_hash_mismatch',
      message: 'The supplied plan hash does not match the current release plan.',
      hint: 'Review the current plan and approve its exact plan hash.',
      retryable: false,
      details: {
        suppliedPlanHash: input.planHash,
        taskPlanHash: task.planHash,
        planHash: plan.planHash,
        recomputedPlanHash: recomputedHash,
      },
    });
  }

  const approval = approvalSchema.parse({
    planHash: input.planHash,
    approvedBy: input.approvedBy,
    approvedAt: (input.now ?? (() => new Date()))().toISOString(),
  });

  await saveApprovals(input.taskDir, [...approvals, approval]);
  await saveTask(input.taskDir, {
    ...task,
    status: 'approved',
    approval,
  });

  return approval;
}
