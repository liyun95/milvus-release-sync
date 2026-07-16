# Milvus Release Sync Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and release the standalone `liyun95/milvus-release-sync` v0.1 Runner that plans, approves, applies, and verifies the two-file Milvus release metadata update without requiring an Agent Skill.

**Architecture:** A Node 20 TypeScript ESM CLI exposes `plan`, `approve`, `apply`, and `status`. One orchestration module owns workspace preflight, source/evidence adapters, deterministic rendering, plan hashing, approval validation, and allowlisted writes; injected adapters keep the v2.6.20 replay deterministic.

**Tech Stack:** Node.js 20+, TypeScript 5.7+, Commander 12, Zod 3, diff 7, Vitest 3, tsx, GitHub Actions, official `lark-cli`.

---

## Scope

This plan delivers Runner v0.1 only. It does not create the Agent Skill, modify the installed `feishu-release-notes` Skill, publish to npm, create feature documentation, or automate Git worktree/PR preparation.

## Public CLI Contract

```text
milvus-release-sync plan --release-version 2.6.20 --release-line 2.6.x --source SOURCE --repo REPO --base BASE --task-dir TASK_DIR [--release-date YYYY-MM-DD --release-date-reason REASON] [--sdk-evidence FILE] [--format pretty|json]
milvus-release-sync approve TASK_DIR --plan-hash sha256:DIGEST --by APPROVER [--format pretty|json]
milvus-release-sync apply TASK_DIR [--write] [--format pretty|json]
milvus-release-sync status TASK_DIR [--format pretty|json]
```

Exit codes: `0` success, `1` complete blocked plan, `2` invalid arguments, `3` auth/configuration, `4` retryable external failure, `5` write/verification/internal failure, `10` approval missing or invalidated.

## Final File Map

```text
/Users/liyun/milvus-release-sync/
  .github/workflows/ci.yml
  .gitignore
  CHANGELOG.md
  LICENSE
  README.md
  package.json
  package-lock.json
  tsconfig.json
  docs/research/beautiful-feishu-whiteboard-repo-shape.md
  docs/superpowers/specs/2026-07-16-milvus-release-sync-runner-design.md
  docs/superpowers/plans/2026-07-16-milvus-release-sync-runner.md
  registry/sdk-sources.json
  src/cli/index.ts
  src/cli/output.ts
  src/core/cli-failure.ts
  src/core/hash.ts
  src/core/schema.ts
  src/core/task-store.ts
  src/core/types.ts
  src/process/run-process.ts
  src/workspace/preflight.ts
  src/source/source.ts
  src/source/local-source.ts
  src/source/lark-source.ts
  src/evidence/release-date.ts
  src/evidence/sdk-registry.ts
  src/evidence/sdk-versions.ts
  src/render/release-notes.ts
  src/render/variables.ts
  src/plan/findings.ts
  src/plan/diff.ts
  src/plan/build-plan.ts
  src/approval/approval.ts
  src/status/status.ts
  src/apply/apply-plan.ts
  test/helpers/cli.ts
  test/helpers/git-fixture.ts
  test/fixtures/v2.6.20/**
  test/*.test.ts
```

## Locked Core Interfaces

All tasks use these names and shapes; do not introduce alternate names:

```ts
export type Finding = { severity:'planned_change'|'warning'|'blocker'|'not_configured'; code:string; message:string; details?:Record<string,unknown> };
export type SourceEvidence = { kind:'local-markdown'|'feishu-docx'; locator:string; documentId?:string; revision?:string; rawHash:string; markdown:string };
export type ReleaseDateEvidence = { source:'github-release-published-at'|'explicit'; date:string; evidenceUrl?:string; reason?:string };
export type SdkVersionRow = { id:string; label:string; value:string; sourceType:'github-tag'|'release-version'|'unchanged'|'explicit'; evidence:string; variablesKeys:string[]; includeInTable:boolean };
export type PlannedFile = { path:'site/en/release_notes.md'|'site/en/Variables.json'; beforeHash:string; afterHash:string; before:string; after:string; diff:string };
export type WorkspaceSnapshot = { repoPath:string; baseRef:string; baseCommit:string; headCommit:string; canonicalRemote:string; targetFilesClean:true; unrelatedDirtyFiles:string[]; fileHashes:Record<PlannedFile['path'],string> };
export type Approval = { planHash:string; approvedBy:string; approvedAt:string };
export type ReleasePlan = { kind:'milvus-release-sync-plan'; schemaVersion:1; runnerVersion:'0.1.0'; releaseVersion:string; releaseLine:string; generatedAt:string; workspace:WorkspaceSnapshot; source:SourceEvidence; releaseDate:ReleaseDateEvidence; sdkVersions:SdkVersionRow[]; findings:Finding[]; files:[PlannedFile,PlannedFile]; planHash:string };
export type ReleaseTask = { kind:'milvus-release-sync-task'; schemaVersion:1; status:'planned'|'blocked'|'approved'|'applied'; releaseVersion:string; releaseLine:string; createdAt:string; planHash:string; approval:Approval|null };
export type ProcessRunner = (command:string,args:string[])=>Promise<string>;
export type ReleaseDateInput = { releaseVersion:string; explicitDate?:string; explicitReason?:string; fetchJson?:(url:string)=>Promise<unknown> };
export type SdkVersionInput = { releaseVersion:string; releaseLine:string; currentVariables:Record<string,unknown>; registry:unknown; listTags:(repository:string)=>Promise<string[]>; explicitEvidence?:SdkVersionRow[] };
export type RenderReleaseInput = { releaseVersion:string; releaseDate:string; versions:{milvus:string;python:string;nodejs:string;java:string;go:string}; sourceMarkdown:string };
export type InsertReleaseInput = { localMarkdown:string; releaseVersion:string; section:string };
export type VariablesPlanInput = { variablesJson:string; releaseVersion:string; sdkValues:Record<string,string>; releaseTemplates:Record<string,string> };
export type BuildPlanInput = { releaseVersion:string; releaseLine:string; sourceLocator:string; repoPath:string; baseRef:string; taskDir:string; explicitReleaseDate?:string; explicitReleaseDateReason?:string; sdkEvidencePath?:string; now?:()=>Date };

export function preflightWorkspace(input:{repoPath:string;baseRef:string}):Promise<WorkspaceSnapshot>;
export function acquireSource(locator:string,run:ProcessRunner):Promise<SourceEvidence>;
export function resolveReleaseDate(input:ReleaseDateInput):Promise<ReleaseDateEvidence>;
export function resolveSdkVersions(input:SdkVersionInput):Promise<SdkVersionRow[]>;
export function renderReleaseSection(input:RenderReleaseInput):string;
export function insertOrReplaceReleaseSection(input:InsertReleaseInput):string;
export function planVariables(input:VariablesPlanInput):{after:string;changedKeys:string[]};
export function buildPlan(input:BuildPlanInput):Promise<{plan:ReleasePlan;task:ReleaseTask}>;
export function approvePlan(input:{taskDir:string;planHash:string;approvedBy:string;now?:()=>Date}):Promise<Approval>;
export function getStatus(taskDir:string):Promise<{state:string;reasons:string[]}>;
export function applyPlan(input:{taskDir:string;write:boolean}):Promise<{mode:'dry-run'|'write'|'no-op';files:Array<{path:string;diff:string}>}>;
```

### Task 1: Create the repository and package skeleton

**Files:**
- Create: `/Users/liyun/milvus-release-sync/.gitignore`
- Create: `/Users/liyun/milvus-release-sync/LICENSE`
- Create: `/Users/liyun/milvus-release-sync/README.md`
- Create: `/Users/liyun/milvus-release-sync/CHANGELOG.md`
- Create: `/Users/liyun/milvus-release-sync/package.json`
- Create: `/Users/liyun/milvus-release-sync/tsconfig.json`
- Copy: the three approved documents from the plan worktree

- [ ] **Step 1: Verify target state before creating anything**

Run `test ! -e /Users/liyun/milvus-release-sync` and `gh repo view liyun95/milvus-release-sync`.

Expected: the filesystem check exits `0`; GitHub reports that the repository does not exist. Stop if either target already exists.

- [ ] **Step 2: Initialize the local repository and copy approved documents**

Run:

```bash
mkdir /Users/liyun/milvus-release-sync
cd /Users/liyun/milvus-release-sync
git init -b main
mkdir -p docs/research docs/superpowers/specs docs/superpowers/plans
cp /Users/liyun/skills-hub-milvus-release-sync-plan/personal/milvus-release-sync/docs/research/beautiful-feishu-whiteboard-repo-shape.md docs/research/
cp /Users/liyun/skills-hub-milvus-release-sync-plan/personal/milvus-release-sync/docs/superpowers/specs/2026-07-16-milvus-release-sync-runner-design.md docs/superpowers/specs/
cp /Users/liyun/skills-hub-milvus-release-sync-plan/personal/milvus-release-sync/docs/superpowers/plans/2026-07-16-milvus-release-sync-runner.md docs/superpowers/plans/
```

Expected: `git status --short` lists only the three copied documents.

- [ ] **Step 3: Add package metadata**

Create `package.json`:

```json
{
  "name": "milvus-release-sync",
  "version": "0.1.0",
  "description": "Plan and apply auditable Milvus release notes, SDK version, and Variables.json updates.",
  "license": "MIT",
  "type": "module",
  "repository": {"type":"git","url":"git+https://github.com/liyun95/milvus-release-sync.git"},
  "homepage": "https://github.com/liyun95/milvus-release-sync#readme",
  "bugs": {"url":"https://github.com/liyun95/milvus-release-sync/issues"},
  "bin": {"milvus-release-sync":"dist/cli/index.js"},
  "files": ["dist","registry","README.md","LICENSE","CHANGELOG.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/cli/index.js",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "check": "npm run typecheck && npm test && npm run build",
    "prepack": "npm run check"
  },
  "engines": {"node":">=20"},
  "dependencies": {"commander":"^12.1.0","diff":"^7.0.0","zod":"^3.24.1"},
  "devDependencies": {"@types/node":"^22.10.2","tsx":"^4.19.2","typescript":"^5.7.2","vitest":"^3.2.4"}
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext",
    "rootDir":"src","outDir":"dist","strict":true,"declaration":true,
    "sourceMap":true,"esModuleInterop":true,"forceConsistentCasingInFileNames":true,"skipLibCheck":true
  },
  "include":["src/**/*.ts"],
  "exclude":["dist","node_modules","test"]
}
```

Create `.gitignore` with `node_modules/`, `dist/`, `coverage/`, `*.log`, `.DS_Store`, `.sync/`, and `.milvus-release-sync/` on separate lines. Add the standard MIT license with `Copyright (c) 2026 liyun95`.

Create `README.md`:

```markdown
# milvus-release-sync

Plan and apply auditable, one-way synchronization of approved Milvus Release Notes, SDK versions, and release variables into a local Milvus Docs worktree.

This is not the complete Milvus release workflow. Runner v0.1 is under development; see `docs/` for the approved design and implementation plan.
```

Create `CHANGELOG.md` with an `0.1.0 - Unreleased` entry: `Establish the standalone Runner and its audited two-file release workflow.`

- [ ] **Step 4: Install dependencies, commit, and create GitHub repository**

Run:

```bash
cd /Users/liyun/milvus-release-sync
npm install
git add .
git diff --cached --check
git commit -m "chore: scaffold milvus release sync"
gh repo create liyun95/milvus-release-sync --public --source=. --remote=origin --push --description="Plan and apply auditable Milvus release metadata updates"
gh repo view liyun95/milvus-release-sync --json visibility --jq .visibility
```

Expected: the commit succeeds and the final command prints `PUBLIC`.

### Task 2: Define the executable, output, and error contract

**Files:**
- Create: `src/core/cli-failure.ts`
- Create: `src/cli/output.ts`
- Create: `src/cli/index.ts`
- Create: `test/helpers/cli.ts`
- Create: `test/cli-help.test.ts`
- Create: `test/cli-output.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create `test/helpers/cli.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function runCli(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, ['dist/cli/index.js', ...args], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { status: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}
```

Create tests asserting `--help` exposes only `plan`, `approve`, `apply`, `status`; `--version` prints `0.1.0`; and `plan --format json` without required options exits `2`, writes no stdout, and writes one JSON object matching `{ok:false,error:{type:'validation',retryable:false}}` to stderr.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm run build && npm test -- test/cli-help.test.ts test/cli-output.test.ts`

Expected: FAIL because the executable source does not exist.

- [ ] **Step 3: Implement the stable failure taxonomy**

Create `src/core/cli-failure.ts`:

```ts
export type CliErrorType = 'validation'|'configuration'|'authentication'|'authorization'|'external'|'blocked'|'approval'|'verification'|'internal';
export type CliFailure = { ok:false; error:{ type:CliErrorType; subtype:string; message:string; hint?:string; retryable:boolean; details?:Record<string,unknown> } };
export class RunnerError extends Error {
  constructor(readonly exitCode:1|2|3|4|5|10, readonly failure:CliFailure['error']) { super(failure.message); }
}
export function normalizeFailure(error:unknown):RunnerError {
  if (error instanceof RunnerError) return error;
  return new RunnerError(5,{type:'internal',subtype:'unexpected_error',message:error instanceof Error?error.message:String(error),retryable:false});
}
```

Create `src/cli/output.ts`:

```ts
import type { CliFailure } from '../core/cli-failure.js';
export type OutputFormat = 'pretty'|'json';
export const printSuccess = (value:unknown,format:OutputFormat) => process.stdout.write(format==='json'?`${JSON.stringify(value)}\n`:`${JSON.stringify(value,null,2)}\n`);
export const printFailure = (value:CliFailure,format:OutputFormat) => process.stderr.write(format==='json'?`${JSON.stringify(value)}\n`:`${value.error.message}${value.error.hint?`\nHint: ${value.error.hint}`:''}\n`);
```

- [ ] **Step 4: Implement the executable surface**

Create `src/cli/index.ts` with shebang, Commander name/version/description, `exitOverride`, and four placeholder commands. Each placeholder throws exit `2` `invalid_arguments`. Catch `CommanderError`, normalize other errors, select JSON only when `--format json` is present, print one failure, and set `process.exitCode`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run build
npm test -- test/cli-help.test.ts test/cli-output.test.ts
git add src test/helpers/cli.ts test/cli-help.test.ts test/cli-output.test.ts
git commit -m "feat: define runner CLI contract"
```

Expected: PASS.

### Task 3: Implement Runner-owned workspace preflight

**Files:**
- Create: `src/process/run-process.ts`
- Create: `src/core/hash.ts`
- Create: `src/workspace/preflight.ts`
- Create: `test/helpers/git-fixture.ts`
- Create: `test/workspace-preflight.test.ts`

- [ ] **Step 1: Write failing preflight tests**

Create fixtures and tests for these exact outcomes:

```ts
await expect(preflightWorkspace({repoPath:'/missing/milvus-docs',baseRef:'upstream/v2.6.x'}))
  .rejects.toMatchObject({exitCode:3,failure:{subtype:'milvus_docs_missing'}});
expect(await preflightWorkspace({repoPath:validFixture,baseRef:'v2.6.x'}))
  .toMatchObject({repoPath:validFixture,baseRef:'v2.6.x',targetFilesClean:true});
await expect(preflightWorkspace({repoPath:dirtyFixture,baseRef:'v2.6.x'}))
  .rejects.toMatchObject({exitCode:3,failure:{subtype:'target_file_dirty'}});
```

The helper initializes Git, configures fixture identity, adds canonical remote `https://github.com/milvus-io/milvus-docs.git`, commits both target files, and creates `v2.6.x` at HEAD. Add wrong-remote, missing-base, non-ancestor, missing-file, and unrelated-dirty cases.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- test/workspace-preflight.test.ts`

Expected: FAIL because preflight does not exist.

- [ ] **Step 3: Implement safe subprocess and SHA-256 helpers**

Create `src/process/run-process.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export async function runProcess(command:string,args:string[],cwd?:string):Promise<string> {
  return (await execFileAsync(command,args,{cwd,encoding:'utf8',maxBuffer:10*1024*1024})).stdout;
}
```

Create `src/core/hash.ts`:

```ts
import { createHash } from 'node:crypto';
export const sha256 = (value:string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
```

- [ ] **Step 4: Implement preflight**

Create `src/workspace/preflight.ts`. Export `ALLOWED_FILES = ['site/en/release_notes.md','site/en/Variables.json']`, `WorkspaceSnapshot`, and `preflightWorkspace`. Execute these exact argument-array commands: `git rev-parse --show-toplevel`, `git remote -v`, `git rev-parse --verify BASE^{commit}`, `git rev-parse HEAD`, `git merge-base --is-ancestor BASE_COMMIT HEAD_COMMIT`, and `git status --porcelain`.

Require the canonical remote, both target files, clean target files, and an ancestor base. Return base/head commits, canonical remote line, hashes for both files, and unrelated dirty files. Map failures to `milvus_docs_missing`, `not_git_worktree`, `repository_identity_mismatch`, `base_ref_missing`, `head_not_based_on_release_base`, `target_file_missing`, and `target_file_dirty` using exit `3` configuration errors.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- test/workspace-preflight.test.ts
npm run typecheck
git add src/process src/core/hash.ts src/workspace test/helpers/git-fixture.ts test/workspace-preflight.test.ts
git commit -m "feat: validate Milvus Docs workspace"
```

Expected: all preflight tests PASS.

### Task 4: Define canonical schemas, hashing, and task persistence

**Files:**
- Modify: `src/core/hash.ts`
- Create: `src/core/schema.ts`
- Create: `src/core/types.ts`
- Create: `src/core/task-store.ts`
- Create: `test/task-store.test.ts`

- [ ] **Step 1: Write failing canonical-hash and round-trip tests**

Use these assertions:

```ts
expect(hashCanonical({b:2,a:1})).toBe(hashCanonical({a:1,b:2}));
expect(canonicalJson({b:2,a:1})).toBe('{"a":1,"b":2}');
await saveTask(taskDir,taskFixture);
await expect(loadTask(taskDir)).resolves.toEqual(taskFixture);
```

- [ ] **Step 2: Implement canonical JSON**

Extend `src/core/hash.ts`:

```ts
export function canonicalJson(value:unknown):string{return JSON.stringify(sortValue(value));}
export function hashCanonical(value:unknown):string{return sha256(canonicalJson(value));}
function sortValue(value:unknown):unknown{
  if(Array.isArray(value))return value.map(sortValue);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,nested])=>[key,sortValue(nested)]));
}
```

- [ ] **Step 3: Define schemas and types**

Create Zod schemas with these discriminants: finding severities `planned_change|warning|blocker|not_configured`; source kinds `local-markdown|feishu-docx`; date sources `github-release-published-at|explicit`; SDK sources `github-tag|release-version|unchanged|explicit`; plan kind `milvus-release-sync-plan`; task kind `milvus-release-sync-task`; schema version `1`; runner version `0.1.0`; task statuses `planned|blocked|approved|applied`; planned paths restricted to the two allowlisted files.

Every planned file contains `before`, `after`, `beforeHash`, `afterHash`, and `diff`. Export only Zod-inferred types from `src/core/types.ts`.

- [ ] **Step 4: Implement persistence**

Create `src/core/task-store.ts` with `saveTask`, `loadTask`, `savePlan`, and `loadPlan`. Store task at `task.json`, plan at `plan/plan.json`, validate on read/write, and format with two spaces plus one trailing newline.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- test/task-store.test.ts
npm run typecheck
git add src/core test/task-store.test.ts
git commit -m "feat: persist canonical release tasks"
```

Expected: PASS.
### Task 5: Implement local and Feishu source acquisition

**Files:**
- Create: `src/source/source.ts`
- Create: `src/source/local-source.ts`
- Create: `src/source/lark-source.ts`
- Create: `test/source.test.ts`

- [ ] **Step 1: Write failing source tests**

Test a local file containing `## Improvements\n\n- Added X.\n` and expect `kind:'local-markdown'`, the absolute locator, identical Markdown, and a SHA-256 hash. Mock Lark output as `{"data":{"document":{"content":"## Improvements\\n","revision_id":7}}}` and expect `kind:'feishu-docx'`, document ID `DocToken`, revision `7`, and identical Markdown.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- test/source.test.ts`

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement source selection and local reads**

Create `src/source/source.ts`:

```ts
import { stat } from 'node:fs/promises';
import type { SourceEvidence } from '../core/types.js';
import { readLocalSource } from './local-source.js';
import { fetchLarkSource } from './lark-source.js';
export type ProcessRunner=(command:string,args:string[])=>Promise<string>;
export async function acquireSource(locator:string,run:ProcessRunner):Promise<SourceEvidence>{
  try{if((await stat(locator)).isFile())return readLocalSource(locator);}catch{}
  return fetchLarkSource(locator,args=>run('lark-cli',args));
}
```

Create `src/source/local-source.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from '../core/hash.js';
export async function readLocalSource(path:string){
  const locator=resolve(path);const markdown=await readFile(locator,'utf8');
  return {kind:'local-markdown' as const,locator,rawHash:sha256(markdown),markdown};
}
```

- [ ] **Step 4: Implement Lark acquisition**

Create `src/source/lark-source.ts`. Parse `/docx/TOKEN` or a raw token. Execute exactly:

```text
lark-cli docs +fetch --doc TOKEN --doc-format markdown --format json
```

Accept Markdown from `data.document.content` or `data.content`, revision from `data.document.revision_id`, and return the same evidence shape. Map subprocess/auth failure to exit `3` subtype `lark_fetch_failed`; map missing Markdown to exit `5` subtype `lark_content_missing`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- test/source.test.ts
npm run typecheck
git add src/source test/source.test.ts
git commit -m "feat: acquire immutable release sources"
```

Expected: PASS.

### Task 6: Implement release-date and SDK evidence resolution

**Files:**
- Create: `registry/sdk-sources.json`
- Create: `src/evidence/release-date.ts`
- Create: `src/evidence/sdk-registry.ts`
- Create: `src/evidence/sdk-versions.ts`
- Create: `test/release-date.test.ts`
- Create: `test/sdk-versions.test.ts`

- [ ] **Step 1: Add the exact registry**

Create `registry/sdk-sources.json`:

```json
{
  "schemaVersion":1,
  "sources":[
    {"id":"python","label":"Python SDK","sourceType":"github-tag","repository":"milvus-io/pymilvus","variablesKeys":["milvus_python_sdk_real_version"],"includeInTable":true},
    {"id":"nodejs","label":"Node.js SDK","sourceType":"github-tag","repository":"milvus-io/milvus-sdk-node","variablesKeys":["milvus_node_sdk_real_version"],"includeInTable":true},
    {"id":"java","label":"Java SDK","sourceType":"github-tag","repository":"milvus-io/milvus-sdk-java","variablesKeys":["milvus_java_sdk_real_version"],"includeInTable":true},
    {"id":"go","label":"Go SDK","sourceType":"release-version","variablesKeys":["milvus_go_sdk_real_version"],"includeInTable":true},
    {"id":"rest","label":"REST","sourceType":"release-version","variablesKeys":["milvus_restful_sdk_real_version"],"includeInTable":false},
    {"id":"csharp","label":"C# SDK","sourceType":"unchanged","variablesKeys":["milvus_csharp_sdk_real_version"],"includeInTable":false}
  ],
  "releaseVariables":{
    "milvus_release_version":"{version}","milvus_release_tag":"{version}","milvus_deb_release":"{version}",
    "milvus_deb_amd64":"milvus_{version}-1_amd64.deb","milvus_rpm_amd64":"milvus_{version}-1_amd64.rpm",
    "milvus_deb_arm64":"milvus_{version}-1_arm64.deb","milvus_rpm_arm64":"milvus_{version}-1_arm64.rpm","milvus_image":"{version}"
  }
}
```

- [ ] **Step 2: Write failing evidence tests**

Assert explicit dates require a reason and GitHub `published_at:'2026-07-14T12:00:00Z'` resolves to `2026-07-14`. For SDKs inject tags and expect Python `2.6.16`, Node.js `2.6.17`, Java `2.6.22`, Go `2.6.20`, REST `2.6.20`, and unchanged C# `2.6.4`.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- test/release-date.test.ts test/sdk-versions.test.ts`

Expected: FAIL because resolvers do not exist.

- [ ] **Step 4: Implement release-date evidence**

Create `resolveReleaseDate`. Explicit dates require `--release-date-reason`. Otherwise fetch `https://api.github.com/repos/milvus-io/milvus/releases/tags/vVERSION`, use `published_at.slice(0,10)`, store `html_url`, and send `Authorization: Bearer $GITHUB_TOKEN` only when defined. Map missing/failed evidence to exit `4` subtypes `release_date_unavailable` or `github_release_failed`.

- [ ] **Step 5: Implement SDK registry and resolution**

Parse the registry with Zod. `github-tag` runs `git ls-remote --tags https://github.com/REPOSITORY.git` and selects the highest strict matching `vMAJOR.MINOR.PATCH`; `release-version` uses the Milvus version; `unchanged` reads the declared Variables key. `--sdk-evidence` parses a validated explicit evidence array and bypasses live tag lookup while remaining visible in the report.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- test/release-date.test.ts test/sdk-versions.test.ts
npm run typecheck
git add registry src/evidence test/release-date.test.ts test/sdk-versions.test.ts
git commit -m "feat: resolve release and SDK evidence"
```

Expected: PASS.

### Task 7: Implement deterministic Release Notes and Variables rendering

**Files:**
- Create: `src/render/release-notes.ts`
- Create: `src/render/variables.ts`
- Create: `src/plan/findings.ts`
- Create: `src/plan/diff.ts`
- Create: `test/release-notes.test.ts`
- Create: `test/variables.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Assert that source `## Improvements` and `## Bug fixes` become level 3, every non-heading source line remains byte-for-byte present and ordered, the table contains Milvus/Python/Node.js/Java/Go, insertion occurs before `## v2.6.19`, and repeated insertion never duplicates `## v2.6.20`.

For Variables, assert the exact `01a787a2` result: release/tag/deb/package/image and Go/REST change to `2.6.20`; Python `2.6.16`, Node.js `2.6.17`, Java `2.6.22`, and C# `2.6.4` remain unchanged.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- test/release-notes.test.ts test/variables.test.ts`

Expected: FAIL because renderers do not exist.

- [ ] **Step 3: Implement findings and diff helpers**

Create helpers returning `planned_change`, `warning`, and `blocker` findings. Create `unifiedDiff(path,before,after)` using `createTwoFilesPatch('a/'+path,'b/'+path,before,after,'','',{context:3})`.

- [ ] **Step 4: Implement Release Notes rendering**

Export `renderReleaseSection`, `insertOrReplaceReleaseSection`, and `assertVerbatimBody`. Strip an optional leading version heading; only lower the two known subsection headings; prefix canonical version/date/table; preserve all other source lines; insert before the first release heading or replace the exact version section; reverse permitted heading normalization when checking verbatim fidelity. Throw exit `1` blocker `verbatim_content_mismatch` on mismatch.

Format the date deterministically with `new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'))`, producing `July 14, 2026` for the fixture.

- [ ] **Step 5: Implement Variables planning**

Create `planVariables` that parses JSON, expands `{version}` templates, applies SDK key/value pairs, records changed keys, preserves existing key order, and returns two-space JSON with one trailing newline.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- test/release-notes.test.ts test/variables.test.ts
npm run typecheck
git add src/render src/plan test/release-notes.test.ts test/variables.test.ts
git commit -m "feat: render deterministic release updates"
```

Expected: PASS.

### Task 8: Build plans and wire the `plan` command

**Files:**
- Create: `src/plan/build-plan.ts`
- Create: `test/build-plan.test.ts`
- Modify: `src/core/task-store.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Write a failing integration test**

Build a temporary canonical Git fixture and inject local source/date/SDK evidence. Assert plan kind/version/release fields, zero blockers, a `release_section_insert` planned change, exactly the two allowlisted files, and a `sha256:` plan hash.

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- test/build-plan.test.ts`

Expected: FAIL because `buildPlan` does not exist.

- [ ] **Step 3: Implement plan orchestration**

Export `buildPlan` accepting release version/line, source locator, repo/base, task dir, optional explicit date/reason, optional SDK evidence, and injected clock. Execute: preflight; current Variables read; source acquisition; date and SDK evidence; release/Variables rendering; verbatim validation; two planned files; findings; canonical hash excluding `generatedAt` and `planHash`; schema validation; then artifact writes.

Write `source/release-notes.remote.md`, evidence JSON files, `plan/plan.json`, `plan/report.md`, `plan/patch.diff`, and `task.json` only after plan construction succeeds. Report Markdown lists workspace/source/evidence/findings/hash and both diffs.

- [ ] **Step 4: Wire `plan`**

Declare every public option in `src/cli/index.ts`, validate format, call `buildPlan`, print `{ok:true,command:'plan',taskDir,planHash,blocked,findings,files}`, and set exit `1` only when blocker findings exist.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- test/build-plan.test.ts test/workspace-preflight.test.ts
npm run typecheck
git add src/plan/build-plan.ts src/core/task-store.ts src/cli/index.ts test/build-plan.test.ts
git commit -m "feat: generate auditable release plans"
```

Expected: PASS.

### Task 9: Implement approval and status

**Files:**
- Create: `src/approval/approval.ts`
- Create: `src/status/status.ts`
- Create: `test/approval-status.test.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Write failing approval/status tests**

Test: non-matching `--plan-hash` exits `10` subtype `plan_hash_mismatch`; matching approval records approver/timestamp/hash in `task.json` and `approvals.json`; status reports `approved`; changing `plan/plan.json` after approval reports `approval-invalidated`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- test/approval-status.test.ts`

Expected: FAIL because approval/status do not exist.

- [ ] **Step 3: Implement approval**

Create `approvePlan({taskDir,planHash,approvedBy,now})`. Load validated task/plan, require both hashes equal the supplied hash, build `{planHash,approvedBy,approvedAt}`, set task status `approved`, and append the record to an array in `approvals.json`. Mismatch throws exit `10` subtype `plan_hash_mismatch`.

- [ ] **Step 4: Implement status and CLI wiring**

Create `getStatus(taskDir)`. Load task/plan, recompute the canonical plan hash, rerun workspace preflight, and return `planned`, `blocked`, `approved`, `approval-invalidated`, `workspace-drifted`, or `applied` plus structured reasons. Wire commands to emit `{ok:true,command:'approve',approval}` and `{ok:true,command:'status',...result}`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- test/approval-status.test.ts
npm run typecheck
git add src/approval src/status src/cli/index.ts test/approval-status.test.ts
git commit -m "feat: approve and inspect release plans"
```

Expected: PASS.

### Task 10: Implement dry-run and verified allowlisted apply

**Files:**
- Create: `src/apply/apply-plan.ts`
- Create: `test/apply-plan.test.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Write failing apply safety tests**

Test: missing approval exits `10`; target drift exits `10`; a forged third path exits `5` subtype `allowlist_violation`; dry-run returns both diffs and writes nothing; `--write` produces exact after content and task status `applied`; rerunning returns successful `no-op`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- test/apply-plan.test.ts`

Expected: FAIL because apply does not exist.

- [ ] **Step 3: Implement apply revalidation**

Export `applyPlan({taskDir,write})`. Load task/plan; require approval; recompute plan hash; rerun workspace preflight; require matching repo/base/HEAD and two-file allowlist; return `no-op` if current hashes equal after hashes; otherwise require before hashes; reacquire source/date/SDK evidence and require exact equality; return dry-run without writes when `write=false`.

- [ ] **Step 4: Implement verified writes**

For `write=true`, write same-directory temporary files, reread and hash them, then rename over targets. Reread both targets, validate hashes and JSON, assert exactly one release heading, then save task status `applied`. If one rename succeeds and the next fails, throw exit `5` subtype `partial_write` with the replaced path in `details`.

- [ ] **Step 5: Wire `apply`, verify, and commit**

Run:

```bash
npm test -- test/apply-plan.test.ts test/approval-status.test.ts
npm run typecheck
git add src/apply src/cli/index.ts test/apply-plan.test.ts
git commit -m "feat: apply approved release plans safely"
```

Expected: PASS.

### Task 11: Add the real v2.6.20 fixture and public CLI replay

**Files:**
- Create: `test/fixtures/v2.6.20/**`
- Create: `test/v2.6.20-replay.test.ts`

- [ ] **Step 1: Extract exact before/after targets from commit `01a787a2`**

Run:

```bash
cd /Users/liyun/milvus-release-sync
mkdir -p test/fixtures/v2.6.20/repo-before/site/en test/fixtures/v2.6.20/repo-after/site/en
git -C /Users/liyun/milvus-docs show 01a787a2^:site/en/release_notes.md > test/fixtures/v2.6.20/repo-before/site/en/release_notes.md
git -C /Users/liyun/milvus-docs show 01a787a2^:site/en/Variables.json > test/fixtures/v2.6.20/repo-before/site/en/Variables.json
git -C /Users/liyun/milvus-docs show 01a787a2:site/en/release_notes.md > test/fixtures/v2.6.20/repo-after/site/en/release_notes.md
git -C /Users/liyun/milvus-docs show 01a787a2:site/en/Variables.json > test/fixtures/v2.6.20/repo-after/site/en/Variables.json
```

Expected: the diff contains 35 added release-note lines and the 10 Variables replacements from the successful release commit.

- [ ] **Step 2: Add frozen source and evidence**

Create the source fixture with this deterministic extraction:

```bash
mkdir -p test/fixtures/v2.6.20/source test/fixtures/v2.6.20/evidence
awk '
  /^## v2\.6\.20$/ { in_release=1; next }
  in_release && /^We are excited to announce/ { in_body=1 }
  in_release && /^## v2\.6\.19$/ { exit }
  in_body { print }
' test/fixtures/v2.6.20/repo-after/site/en/release_notes.md \
  | sed -E 's/^### (Improvements|Bug fixes)$/## \1/' \
  > test/fixtures/v2.6.20/source/release-notes.remote.md
```

Expected: the file begins with `We are excited to announce the release of Milvus v2.6.20!` and ends with the `#51144` bug-fix bullet.

Create `evidence/release-date.json`:

```json
{"source":"explicit","date":"2026-07-14","reason":"Frozen v2.6.20 fixture matching GitHub Release published_at"}
```

Create `evidence/sdk-versions.json`:

```json
[
  {"id":"python","label":"Python SDK","value":"2.6.16","sourceType":"explicit","evidence":"pymilvus tag v2.6.16","variablesKeys":["milvus_python_sdk_real_version"],"includeInTable":true},
  {"id":"nodejs","label":"Node.js SDK","value":"2.6.17","sourceType":"explicit","evidence":"milvus-sdk-node tag v2.6.17","variablesKeys":["milvus_node_sdk_real_version"],"includeInTable":true},
  {"id":"java","label":"Java SDK","value":"2.6.22","sourceType":"explicit","evidence":"milvus-sdk-java tag v2.6.22","variablesKeys":["milvus_java_sdk_real_version"],"includeInTable":true},
  {"id":"go","label":"Go SDK","value":"2.6.20","sourceType":"explicit","evidence":"Milvus release v2.6.20","variablesKeys":["milvus_go_sdk_real_version"],"includeInTable":true},
  {"id":"rest","label":"REST","value":"2.6.20","sourceType":"explicit","evidence":"Milvus release v2.6.20","variablesKeys":["milvus_restful_sdk_real_version"],"includeInTable":false},
  {"id":"csharp","label":"C# SDK","value":"2.6.4","sourceType":"explicit","evidence":"Unchanged upstream Variables value","variablesKeys":["milvus_csharp_sdk_real_version"],"includeInTable":false}
]
```

- [ ] **Step 3: Write the public CLI replay test**

The test creates a temporary canonical Git worktree from `repo-before`, runs built `plan` with local source/date/SDK evidence, asserts zero blockers and two files, runs `approve`, runs `apply --write`, compares both files byte-for-byte with `repo-after`, then runs `status` and expects `applied`.

- [ ] **Step 4: Run replay and fix only implementation discrepancies**

Run:

```bash
npm run build
npm test -- test/v2.6.20-replay.test.ts
```

Expected: PASS with byte-for-byte equality to commit `01a787a2`. Do not alter expected files to accommodate incorrect output.

- [ ] **Step 5: Commit fixture acceptance**

Run:

```bash
git add test/fixtures/v2.6.20 test/v2.6.20-replay.test.ts
git commit -m "test: replay Milvus v2.6.20 release sync"
```

### Task 12: Complete README, CI, package smoke, and GitHub v0.1 release

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `.github/workflows/ci.yml`
- Create: `test/package-smoke.test.ts`

- [ ] **Step 1: Write a package smoke test**

The test runs `npm pack --json`, installs the tarball in a temporary directory, invokes `node_modules/.bin/milvus-release-sync --version`, expects `0.1.0`, and removes all temporary files in `finally`.

- [ ] **Step 2: Write the final English README**

Use this exact section order: outcome and one-way sync definition; non-goals; requirements; clone/install/build; Milvus Docs direct-clone and fork-plus-upstream preparation; CLI examples using `MRS_REPO`, `MILVUS_DOCS`, `TASK_DIR`, `BASE_REF`; `milvus_docs_missing` JSON example; safety model; v2.6.20 fixture walkthrough; repository map; contributing commands; license and v0.1 status.

- [ ] **Step 3: Add CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm test -- test/package-smoke.test.ts
```

- [ ] **Step 4: Finalize changelog and verify everything**

Change the changelog heading to `0.1.0 - 2026-07-16` and list commands, workspace preflight, evidence, approval, two-file apply, and fixture replay.

Run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
git diff --check
```

Expected: all commands exit `0`; package contents include only declared release files.

- [ ] **Step 5: Commit, push, verify CI, and publish GitHub Release**

Run:

```bash
git add README.md CHANGELOG.md .github/workflows/ci.yml test/package-smoke.test.ts package.json package-lock.json
git commit -m "docs: prepare standalone runner release"
git push origin main
gh run watch --repo liyun95/milvus-release-sync --exit-status
git tag -a v0.1.0 -m "milvus-release-sync v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --repo liyun95/milvus-release-sync --title "milvus-release-sync v0.1.0" --notes-from-tag
```

Expected: public release URL `https://github.com/liyun95/milvus-release-sync/releases/tag/v0.1.0` exists and CI is green.

## Final Verification Checklist

Run from `/Users/liyun/milvus-release-sync`:

```bash
npm ci
npm run typecheck
npm test
npm run build
node dist/cli/index.js --version
node dist/cli/index.js --help
npm pack --dry-run
git diff --check
git status --short
```

Expected: version `0.1.0`; only four commands; all tests including v2.6.20 replay pass; package contents are restricted; worktree is clean; Runner works without an Agent Skill; apply cannot write outside the two-file allowlist.
