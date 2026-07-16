import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planSchema, taskSchema } from './schema.js';
import type {
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
