# milvus-release-sync

## Outcome and one-way sync

`milvus-release-sync` plans and applies an auditable, release-scoped update from approved Milvus Release Notes, release-date evidence, and SDK version evidence into a local Milvus Docs worktree.

The data flow is one way:

```text
approved Feishu Release Notes or a local Markdown snapshot
+ release-date evidence
+ SDK version evidence
+ the current Milvus Docs checkout
        -> site/en/release_notes.md
        -> site/en/Variables.json
```

This is not continuous synchronization, bidirectional synchronization, or the complete Milvus release workflow. The Runner is intentionally limited to one release and two target files.

## Non-goals

The Runner does not:

- Author, edit, or synchronize feature documentation.
- Rewrite approved feature wording or PR grouping.
- Publish content back to Feishu.
- Clone, fetch, check out, repair, commit, push, or open a pull request for a Git repository.
- Replace the rest of the Milvus release process.
- Publish v0.1 as an npm package.
- Provide an Agent Skill in v0.1.

## Requirements

- Node.js 20 or later.
- npm and Git.
- A local Milvus Docs checkout or worktree.
- [`lark-cli`](https://github.com/larksuite/lark-cli) installed and authenticated when the source is a live Feishu document.
- Network access for live GitHub Release and SDK tag evidence. `GITHUB_TOKEN` is optional and is used when present.

The task directory must be outside the Milvus Docs worktree. The Runner rejects a `--task-dir` that is equal to or nested under `--repo`.

## Clone, install, and build

Runner v0.1 is installed from source:

```bash
export MRS_REPO="$HOME/src/milvus-release-sync"

git clone https://github.com/liyun95/milvus-release-sync.git "$MRS_REPO"
cd "$MRS_REPO"
npm ci
npm run build
npm link

milvus-release-sync --version
```

The expected version is `0.1.0`.

## Prepare Milvus Docs

The Runner requires `--repo` to resolve to a Git worktree with a remote for the canonical `milvus-io/milvus-docs` repository. The `--base` ref must resolve to a local commit and must be an ancestor of the current `HEAD`.

For a direct clone:

```bash
export MILVUS_DOCS="$HOME/src/milvus-docs-v2.6.20"

git clone https://github.com/milvus-io/milvus-docs.git "$MILVUS_DOCS"
git -C "$MILVUS_DOCS" fetch origin v2.6.x
git -C "$MILVUS_DOCS" switch -c release/v2.6.20 origin/v2.6.x

export BASE_REF="origin/v2.6.x"
```

For a fork, add the canonical repository as `upstream`:

```bash
export MILVUS_DOCS="$HOME/src/milvus-docs-v2.6.20"

git clone git@github.com:YOUR_GITHUB_USER/milvus-docs.git "$MILVUS_DOCS"
git -C "$MILVUS_DOCS" remote add upstream \
  https://github.com/milvus-io/milvus-docs.git
git -C "$MILVUS_DOCS" fetch upstream v2.6.x
git -C "$MILVUS_DOCS" switch -c release/v2.6.20 upstream/v2.6.x

export BASE_REF="upstream/v2.6.x"
```

An existing clone can use `git worktree add` instead. Prepare the worktree explicitly, set `MILVUS_DOCS` to its root, and set `BASE_REF` to the local canonical release ref. The Runner never performs these Git operations for you.

## CLI workflow

Set a task directory outside both repositories and choose a live Feishu document or local Markdown snapshot:

```bash
export TASK_DIR="$HOME/.local/state/milvus-release-sync/v2.6.20"
export SOURCE="https://example.feishu.cn/docx/DocToken"
```

Create a plan:

```bash
milvus-release-sync plan \
  --release-version 2.6.20 \
  --release-line 2.6.x \
  --source "$SOURCE" \
  --repo "$MILVUS_DOCS" \
  --base "$BASE_REF" \
  --task-dir "$TASK_DIR" \
  --format json
```

By default, `plan` resolves the exact GitHub Release publication date and live SDK evidence. For a frozen or manually justified run, add all applicable evidence options:

```bash
milvus-release-sync plan \
  --release-version 2.6.20 \
  --release-line 2.6.x \
  --source "$MRS_REPO/test/fixtures/v2.6.20/source/release-notes.remote.md" \
  --repo "$MILVUS_DOCS" \
  --base "$BASE_REF" \
  --task-dir "$TASK_DIR" \
  --release-date 2026-07-14 \
  --release-date-reason "Frozen evidence matching the GitHub Release published_at" \
  --sdk-evidence "$MRS_REPO/test/fixtures/v2.6.20/evidence/sdk-versions.json" \
  --format json
```

Review `plan/report.md` and `plan/patch.diff`, then copy the exact `planHash` from the plan result:

```bash
export PLAN_HASH="sha256:REPLACE_WITH_THE_REVIEWED_PLAN_HASH"

milvus-release-sync approve "$TASK_DIR" \
  --plan-hash "$PLAN_HASH" \
  --by "${USER:-release-reviewer}" \
  --format json
```

`apply` defaults to verification and dry-run. Only `--write` replaces target files:

```bash
milvus-release-sync apply "$TASK_DIR" --format json
milvus-release-sync apply "$TASK_DIR" --write --format json
milvus-release-sync status "$TASK_DIR" --format json
```

The four public commands are `plan`, `approve`, `apply`, and `status`.

## Missing Milvus Docs workspace

With `--format json`, a missing checkout exits with status `3` and writes one structured error to stderr:

```json
{"ok":false,"error":{"type":"configuration","subtype":"milvus_docs_missing","message":"Milvus Docs repository directory does not exist: /missing/milvus-docs","hint":"Clone Milvus Docs, prepare a worktree based on the desired release branch, and rerun with --repo and --base.","retryable":false,"details":{"repoPath":"/missing/milvus-docs"}}}
```

Prepare or select the intended worktree and rerun the same command. The Runner does not automatically clone or repair it.

## Safety model

- `plan` writes task artifacts but never changes the two Milvus Docs target files.
- Task artifacts must remain outside the Milvus Docs worktree.
- Workspace preflight verifies the canonical remote, local base commit, base ancestry, `HEAD`, required files, and target cleanliness.
- Dirty target files block planning. Unrelated dirty files are reported as warnings.
- The plan hash covers source evidence, release-date evidence, SDK evidence, the SDK registry, workspace baselines, complete after content, and both diffs.
- `approve` records one exact reviewed plan hash. Changing covered plan content invalidates approval.
- `apply` is a dry-run unless `--write` is supplied.
- Before writing, `apply` revalidates approval, blockers, source, date, SDK evidence, registry, repository identity, base, `HEAD`, and both before hashes.
- Each target is rechecked immediately before its same-directory temporary file is renamed into place.
- Writes are restricted to `site/en/release_notes.md` and `site/en/Variables.json`; raw plan paths are checked before schema parsing.
- Written bytes, hashes, Variables JSON, and the target release heading are verified before success is reported.
- A second identical apply returns `no-op` instead of duplicating the release section.

## v2.6.20 fixture walkthrough

The frozen v2.6.20 replay uses the approved source snapshot, explicit release-date evidence, and six SDK evidence rows committed under `test/fixtures/v2.6.20/`.

```bash
cd "$MRS_REPO"
npm run build
npm test -- test/v2.6.20-replay.test.ts
```

The replay creates a temporary canonical Milvus Docs worktree and executes the public workflow:

```text
plan -> approve -> apply --write -> status
```

It then compares both target files byte for byte with commit `01a787a2`. The accepted change adds the 35-line v2.6.20 release section, preserves the approved body and PR grouping verbatim, and applies the ten expected `Variables.json` replacements. Its evidence and expected repository states are organized as follows:

```text
test/fixtures/v2.6.20/
  source/
    release-notes.remote.md
  evidence/
    release-date.json
    sdk-versions.json
  repo-before/site/en/
  repo-after/site/en/
```

## Repository map

```text
src/cli/                  Public command surface and output contract
src/workspace/            Git identity, preflight, and applied-state inspection
src/source/               Local Markdown and lark-cli source acquisition
src/evidence/             Release-date and SDK evidence resolution
src/render/               Deterministic Release Notes and Variables rendering
src/plan/                 Plan construction, findings, hashes, reports, and diffs
src/approval/             Exact plan-hash approval
src/status/               Task, approval, and workspace state reporting
src/apply/                Dry-run and verified two-file writes
registry/                 Versioned SDK source policy
test/fixtures/v2.6.20/    Frozen byte-for-byte replay data
docs/                     Approved design, plan, and research
.github/workflows/        Continuous integration
```

## Contributing

Install locked dependencies and run the complete local checks:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
npm test -- test/v2.6.20-replay.test.ts
npm test -- test/package-smoke.test.ts
npm pack --dry-run
git diff --check
```

Normal tests use local fixtures and temporary task directories. Live Feishu tests are optional and require a disposable task directory and valid `lark-cli` authentication.

## License and v0.1 status

This project is available under the [MIT License](LICENSE).

Runner v0.1 is distributed from [GitHub](https://github.com/liyun95/milvus-release-sync) as source and as a semantic Git tag and GitHub Release. npm publication is a separate future decision after team usage and interface stabilization.

Use [GitHub Issues](https://github.com/liyun95/milvus-release-sync/issues) for bugs and proposals. The v0.1 Runner is deliberately standalone; no Agent Skill is included yet.
