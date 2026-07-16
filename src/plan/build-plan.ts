import { readFile, realpath } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path';
import { RunnerError } from '../core/cli-failure.js';
import { hashCanonical, sha256 } from '../core/hash.js';
import { planSchema, taskSchema } from '../core/schema.js';
import { savePlanArtifacts } from '../core/task-store.js';
import type {
  Finding,
  PlannedFile,
  ReleasePlan,
  ReleaseTask,
  SdkVersionRow
} from '../core/types.js';
import { resolveReleaseDate } from '../evidence/release-date.js';
import { parseSdkRegistry } from '../evidence/sdk-registry.js';
import {
  listGithubTags,
  resolveSdkVersions
} from '../evidence/sdk-versions.js';
import { runProcess } from '../process/run-process.js';
import {
  assertVerbatimBody,
  insertOrReplaceReleaseSection,
  renderReleaseSection
} from '../render/release-notes.js';
import { planVariables } from '../render/variables.js';
import { acquireSource } from '../source/source.js';
import { preflightWorkspace } from '../workspace/preflight.js';
import { unifiedDiff } from './diff.js';
import { plannedChange, warning } from './findings.js';

export type BuildPlanInput = {
  releaseVersion: string;
  releaseLine: string;
  sourceLocator: string;
  repoPath: string;
  baseRef: string;
  taskDir: string;
  explicitReleaseDate?: string;
  explicitReleaseDateReason?: string;
  sdkEvidencePath?: string;
  now?: () => Date;
};

export function computePlanHash<T extends { generatedAt: string; planHash?: string }>(
  plan: T
): string {
  const hashInput: Record<string, unknown> = { ...plan };
  delete hashInput.generatedAt;
  delete hashInput.planHash;
  return hashCanonical(hashInput);
}

const releaseNotesPath = 'site/en/release_notes.md' as const;
const variablesPath = 'site/en/Variables.json' as const;
const registryUrl = new URL('../../registry/sdk-sources.json', import.meta.url);

function isMissingPath(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function canonicalPotentialPath(path: string): Promise<string> {
  let candidate = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const existingPath = await realpath(candidate);
      return resolve(existingPath, ...missingSegments.reverse());
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

async function assertTaskDirOutsideRepo(taskDir: string, repoPath: string): Promise<void> {
  const canonicalTaskDir = await canonicalPotentialPath(taskDir);
  const pathFromRepo = relative(repoPath, canonicalTaskDir);
  const insideRepo =
    pathFromRepo === '' ||
    (pathFromRepo !== '..' &&
      !pathFromRepo.startsWith('..' + sep) &&
      !isAbsolute(pathFromRepo));

  if (insideRepo) {
    throw new RunnerError(2, {
      type: 'validation',
      subtype: 'task_dir_inside_repo',
      message: 'Task artifacts must be stored outside the Milvus Docs worktree.',
      hint: 'Choose a --task-dir that is not equal to or nested under --repo.',
      retryable: false,
      details: { taskDir: canonicalTaskDir, repoPath }
    });
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(label + ' must contain a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requiredSdk(rows: SdkVersionRow[], id: string): string {
  const value = rows.find((row) => row.id === id)?.value;
  if (value === undefined) {
    throw new TypeError('SDK evidence is missing required row: ' + id);
  }
  return value;
}

function hasReleaseHeading(markdown: string, releaseVersion: string): boolean {
  const escaped = releaseVersion.replaceAll('.', '\\.');
  return new RegExp('^## v' + escaped + '$', 'm').test(markdown);
}

function plannedFile(
  path: PlannedFile['path'],
  before: string,
  after: string
): PlannedFile {
  return {
    path,
    beforeHash: sha256(before),
    afterHash: sha256(after),
    before,
    after,
    diff: unifiedDiff(path, before, after)
  };
}

function reportMarkdown(plan: ReleasePlan): string {
  const findings =
    plan.findings.length === 0
      ? ['- None']
      : plan.findings.map(
          (finding) =>
            '- [' + finding.severity + '] ' + finding.code + ': ' + finding.message
        );
  const sdkEvidence = plan.sdkVersions.map(
    (row) => '- ' + row.label + ': ' + row.value + ' — ' + row.evidence
  );
  const fileSections = plan.files.flatMap((file) => [
    '### ' + file.path,
    '',
    'Before: `' + file.beforeHash + '`',
    '',
    'After: `' + file.afterHash + '`',
    '',
    '~~~diff',
    file.diff.trimEnd(),
    '~~~',
    ''
  ]);

  return [
    '# Milvus release sync plan',
    '',
    '- Release: v' + plan.releaseVersion,
    '- Release line: ' + plan.releaseLine,
    '- Generated at: ' + plan.generatedAt,
    '',
    '## Workspace',
    '',
    '- Repository: ' + plan.workspace.repoPath,
    '- Base ref: ' + plan.workspace.baseRef,
    '- Base commit: `' + plan.workspace.baseCommit + '`',
    '- HEAD commit: `' + plan.workspace.headCommit + '`',
    '- Canonical remote: ' + plan.workspace.canonicalRemote,
    '',
    '## Source',
    '',
    '- Kind: ' + plan.source.kind,
    '- Locator: ' + plan.source.locator,
    '- Raw hash: `' + plan.source.rawHash + '`',
    '',
    '## Evidence',
    '',
    '- Release date: ' + plan.releaseDate.date + ' (' + plan.releaseDate.source + ')',
    '- SDK registry hash: `' + plan.registryHash + '`',
    ...sdkEvidence,
    '',
    '## Findings',
    '',
    ...findings,
    '',
    '## Plan hash',
    '',
    '`' + plan.planHash + '`',
    '',
    '## Files',
    '',
    ...fileSections
  ].join('\n');
}

function patchText(files: ReleasePlan['files']): string {
  return files.map((file) => file.diff.trimEnd()).join('\n\n') + '\n';
}

export async function buildPlan(
  input: BuildPlanInput
): Promise<{ plan: ReleasePlan; task: ReleaseTask }> {
  const workspace = await preflightWorkspace({
    repoPath: input.repoPath,
    baseRef: input.baseRef
  });
  await assertTaskDirOutsideRepo(input.taskDir, workspace.repoPath);
  const [releaseNotesBefore, variablesBefore, registryText] = await Promise.all([
    readFile(join(workspace.repoPath, releaseNotesPath), 'utf8'),
    readFile(join(workspace.repoPath, variablesPath), 'utf8'),
    readFile(registryUrl, 'utf8')
  ]);
  const currentVariables = record(
    JSON.parse(variablesBefore) as unknown,
    'Variables.json'
  );
  const registry = parseSdkRegistry(JSON.parse(registryText) as unknown);
  const registryHash = sha256(registryText);
  const source = await acquireSource(input.sourceLocator, (command, args) =>
    runProcess(command, args)
  );
  const releaseDate = await resolveReleaseDate({
    releaseVersion: input.releaseVersion,
    explicitDate: input.explicitReleaseDate,
    explicitReason: input.explicitReleaseDateReason
  });
  const explicitEvidence =
    input.sdkEvidencePath === undefined
      ? undefined
      : (JSON.parse(await readFile(input.sdkEvidencePath, 'utf8')) as unknown);
  const sdkVersions = await resolveSdkVersions({
    releaseVersion: input.releaseVersion,
    releaseLine: input.releaseLine,
    currentVariables,
    registry,
    listTags: listGithubTags,
    explicitEvidence: explicitEvidence as SdkVersionRow[] | undefined
  });

  const section = renderReleaseSection({
    releaseVersion: input.releaseVersion,
    releaseDate: releaseDate.date,
    versions: {
      milvus: input.releaseVersion,
      python: requiredSdk(sdkVersions, 'python'),
      nodejs: requiredSdk(sdkVersions, 'nodejs'),
      java: requiredSdk(sdkVersions, 'java'),
      go: requiredSdk(sdkVersions, 'go')
    },
    sourceMarkdown: source.markdown
  });
  assertVerbatimBody(source.markdown, section);
  const releaseNotesAfter = insertOrReplaceReleaseSection({
    localMarkdown: releaseNotesBefore,
    releaseVersion: input.releaseVersion,
    section
  });
  const sdkValues = Object.fromEntries(
    sdkVersions.flatMap((row) =>
      row.variablesKeys.map((key) => [key, row.value] as const)
    )
  );
  const variablesResult = planVariables({
    variablesJson: variablesBefore,
    releaseVersion: input.releaseVersion,
    sdkValues,
    releaseTemplates: registry.releaseVariables
  });

  const findings: Finding[] = [];
  if (releaseNotesAfter !== releaseNotesBefore) {
    findings.push(
      plannedChange(
        hasReleaseHeading(releaseNotesBefore, input.releaseVersion)
          ? 'release_section_replace'
          : 'release_section_insert',
        'Update the v' + input.releaseVersion + ' Release Notes section.',
        { path: releaseNotesPath }
      )
    );
  }
  if (variablesResult.changedKeys.length > 0) {
    findings.push(
      plannedChange(
        'variables_update',
        'Update release and SDK values in Variables.json.',
        { path: variablesPath, changedKeys: variablesResult.changedKeys }
      )
    );
  }
  if (workspace.unrelatedDirtyFiles.length > 0) {
    findings.push(
      warning(
        'unrelated_dirty_files',
        'The workspace contains unrelated dirty files.',
        { paths: workspace.unrelatedDirtyFiles }
      )
    );
  }

  const files = [
    plannedFile(releaseNotesPath, releaseNotesBefore, releaseNotesAfter),
    plannedFile(variablesPath, variablesBefore, variablesResult.after)
  ] as const;
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  const planWithoutHash = {
    kind: 'milvus-release-sync-plan' as const,
    schemaVersion: 1 as const,
    runnerVersion: '0.1.0' as const,
    registryHash,
    releaseVersion: input.releaseVersion,
    releaseLine: input.releaseLine,
    generatedAt,
    workspace,
    source,
    releaseDate,
    sdkVersions,
    findings,
    files
  };
  const plan = planSchema.parse({
    ...planWithoutHash,
    planHash: computePlanHash(planWithoutHash)
  });
  const blocked = findings.some((finding) => finding.severity === 'blocker');
  const task = taskSchema.parse({
    kind: 'milvus-release-sync-task',
    schemaVersion: 1,
    status: blocked ? 'blocked' : 'planned',
    releaseVersion: input.releaseVersion,
    releaseLine: input.releaseLine,
    createdAt: generatedAt,
    planHash: plan.planHash,
    approval: null
  });

  await savePlanArtifacts({
    taskDir: input.taskDir,
    plan,
    task,
    sourceMarkdown: source.markdown,
    releaseDate,
    sdkVersions,
    report: reportMarkdown(plan),
    patch: patchText(plan.files)
  });

  return { plan, task };
}
