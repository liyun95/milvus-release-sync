import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { approvalSchema, planSchema, taskSchema } from './schema.js';
import type {
  Approval,
  ReleaseDateEvidence,
  ReleasePlan,
  ReleaseTask,
  SdkVersionRow
} from './types.js';

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function saveTask(taskDir: string, task: ReleaseTask): Promise<void> {
  await mkdir(taskDir, { recursive: true });
  await writeJson(join(taskDir, 'task.json'), taskSchema.parse(task));
}

export async function loadTask(taskDir: string): Promise<ReleaseTask> {
  return taskSchema.parse(JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8')));
}

export async function savePlan(taskDir: string, plan: ReleasePlan): Promise<void> {
  await mkdir(join(taskDir, 'plan'), { recursive: true });
  await writeJson(join(taskDir, 'plan/plan.json'), planSchema.parse(plan));
}

export async function loadPlan(taskDir: string): Promise<ReleasePlan> {
  return planSchema.parse(JSON.parse(await readFile(join(taskDir, 'plan/plan.json'), 'utf8')));
}

export async function loadApprovals(taskDir: string): Promise<Approval[]> {
  try {
    const value = JSON.parse(
      await readFile(join(taskDir, 'approvals.json'), 'utf8'),
    );
    return z.array(approvalSchema).parse(value);
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }
}

export async function saveApprovals(
  taskDir: string,
  approvals: Approval[],
): Promise<void> {
  await mkdir(taskDir, { recursive: true });
  await writeJson(
    join(taskDir, 'approvals.json'),
    z.array(approvalSchema).parse(approvals),
  );
}

export async function savePlanArtifacts(input: {
  taskDir: string;
  plan: ReleasePlan;
  task: ReleaseTask;
  sourceMarkdown: string;
  releaseDate: ReleaseDateEvidence;
  sdkVersions: SdkVersionRow[];
  report: string;
  patch: string;
}): Promise<void> {
  const plan = planSchema.parse(input.plan);
  const task = taskSchema.parse(input.task);

  await Promise.all([
    mkdir(join(input.taskDir, 'source'), { recursive: true }),
    mkdir(join(input.taskDir, 'evidence'), { recursive: true }),
    mkdir(join(input.taskDir, 'plan'), { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      join(input.taskDir, 'source/release-notes.remote.md'),
      input.sourceMarkdown,
      'utf8'
    ),
    writeJson(join(input.taskDir, 'evidence/release-date.json'), input.releaseDate),
    writeJson(join(input.taskDir, 'evidence/sdk-versions.json'), input.sdkVersions),
    writeJson(join(input.taskDir, 'plan/plan.json'), plan),
    writeFile(join(input.taskDir, 'plan/report.md'), input.report, 'utf8'),
    writeFile(join(input.taskDir, 'plan/patch.diff'), input.patch, 'utf8'),
    writeJson(join(input.taskDir, 'task.json'), task)
  ]);
}

function isMissingPath(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
