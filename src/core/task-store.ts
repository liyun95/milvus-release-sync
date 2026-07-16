import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planSchema, taskSchema } from './schema.js';
import type { ReleasePlan, ReleaseTask } from './types.js';

export async function saveTask(taskDir: string, task: ReleaseTask): Promise<void> {
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(taskSchema.parse(task), null, 2)}\n`, 'utf8');
}

export async function loadTask(taskDir: string): Promise<ReleaseTask> {
  return taskSchema.parse(JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8')));
}

export async function savePlan(taskDir: string, plan: ReleasePlan): Promise<void> {
  await mkdir(join(taskDir, 'plan'), { recursive: true });
  await writeFile(join(taskDir, 'plan/plan.json'), `${JSON.stringify(planSchema.parse(plan), null, 2)}\n`, 'utf8');
}

export async function loadPlan(taskDir: string): Promise<ReleasePlan> {
  return planSchema.parse(JSON.parse(await readFile(join(taskDir, 'plan/plan.json'), 'utf8')));
}
