# Milvus Release Sync Standalone Runner Design

Date: 2026-07-16

## Summary

Build `milvus-release-sync` first as a standalone, shareable GitHub repository containing a deterministic command-line Runner. The Runner prepares an auditable Milvus release-notes patch from an approved Feishu source, release-date evidence, SDK version evidence, and the current Milvus Docs checkout.

The Agent Skill is a later adapter over the stable Runner. It is not the implementation and is not part of the initial v0.1 scope.

The tool remains deliberately narrow. It plans and applies changes only to:

- `site/en/release_notes.md`
- `site/en/Variables.json`

It does not author or synchronize feature documentation and does not represent the complete Milvus release process.

## Product Decision

- GitHub repository and CLI name: `milvus-release-sync`
- Initial product: standalone Runner
- Initial distribution: `git clone` plus `npm install`
- Initial documentation: one English `README.md`
- Initial package publication: none
- Later Agent Skill: `milvus-release-sync`
- Deprecated compatibility Skill: `feishu-release-notes`
- Reserved future umbrella name: `milvus-release`

GitHub is the canonical source for collaboration, issues, source history, tags, and releases. npm publication may be added after the team has used and stabilized the Runner; it is not required for v0.1.

## Meaning of Sync

In this product, `sync` means a one-way, release-scoped reconciliation:

```text
approved Feishu Release Notes
+ release-date evidence
+ SDK version evidence
        -> Milvus Docs release_notes.md and Variables.json
```

It does not mean continuous synchronization, bidirectional synchronization, or synchronization of feature documentation. The README and CLI help must state this explicitly so the product is not confused with `feishu-md-sync`.

## Reference Repository Findings

[`zarazhangrui/beautiful-feishu-whiteboard`](https://github.com/zarazhangrui/beautiful-feishu-whiteboard) is a useful reference for GitHub product presentation and Skill distribution, but not for Runner architecture.

Patterns to adopt:

- One memorable GitHub repository as the shareable product page.
- Clear positioning, prerequisites, installation, examples, and a concise file map.
- A checked-in example that demonstrates the real output.
- A preflight experience and an open-source license.
- A later Skill that can be installed from the same repository.

Patterns not to adopt:

- Skill-first implementation.
- Natural-language orchestration for deterministic release logic.
- Missing package metadata, tests, CI, Git tags, or GitHub Releases.
- Agent installation as the only way to use the product.
- A mutable `SKILL.md` version as the canonical product version.

The detailed reference audit is in `docs/research/beautiful-feishu-whiteboard-repo-shape.md`.

## Goals

- Provide a CLI that teammates can use without an Agent.
- Pull or accept an immutable Markdown snapshot of approved Feishu Release Notes.
- Record the Feishu document identity, revision when available, and content hashes.
- Resolve the Milvus release date from explicit evidence.
- Resolve independent SDK and server-coupled versions from a versioned registry.
- Audit and plan the matching `Variables.json` changes.
- Render a deterministic release section for `release_notes.md`.
- Preserve approved feature wording and PR grouping verbatim.
- Produce structured JSON, a human-readable report, a complete diff, and a stable plan hash.
- Require explicit approval of the exact plan before local writes.
- Restrict writes to the two fixed files and verify results after writing.
- Reproduce the successful Milvus v2.6.20 update from frozen fixtures.
- Run build, typecheck, tests, and fixture replay in GitHub Actions.

## Non-Goals

- Authoring, editing, or synchronizing feature documentation.
- Auditing feature-document code examples or language coverage.
- Inferring or inserting user-documentation links.
- Editing technical wording supplied by the release-note owner.
- Publishing content back to Feishu.
- Creating Git worktrees, branches, commits, pushes, pull requests, or merges.
- Automatically cloning, fetching, checking out, or repairing a Milvus Docs workspace.
- Acting as a complete Milvus release orchestrator.
- Adding Milvus-specific release commands back to `feishu-md-sync`.
- Publishing the initial version to npm.
- Shipping an Agent Skill before the Runner interface is stable.
- Maintaining a separate Chinese README.

Git setup and PR handoff remain separate generic repository operations performed by a human or calling Agent.

## Repository Shape

The standalone repository should use a single Node 20+ TypeScript ESM package:

```text
milvus-release-sync/
  README.md
  LICENSE
  CHANGELOG.md
  package.json
  package-lock.json
  tsconfig.json

  src/
    cli/
      index.ts
      plan.ts
      approve.ts
      apply.ts
      status.ts
    core/
      task.ts
      hash.ts
      schema.ts
      paths.ts
    source/
      types.ts
      lark-cli-adapter.ts
      local-snapshot-adapter.ts
    evidence/
      release-date.ts
      sdk-versions.ts
    render/
      release-notes.ts
      variables.ts
    validation/
      findings.ts
      content-fidelity.ts
      target-state.ts
    workspace/
      preflight.ts
      git-state.ts
    write/
      plan.ts
      apply.ts

  registry/
    sdk-sources.json

  test/
    fixtures/
      v2.6.20/
    *.test.ts

  docs/
    architecture.md
    task-artifacts.md
    research/

  .github/
    workflows/
      ci.yml

  skills/                       # added only after Runner stabilization
    milvus-release-sync/
      SKILL.md
```

The later Skill is nested under `skills/` because the repository root is the Runner product, not an Agent Skill package.

## Local Installation and Invocation

The v0.1 README documents this development/team installation path:

```bash
git clone https://github.com/<owner>/milvus-release-sync.git
cd milvus-release-sync
npm install
npm run build
npm link
milvus-release-sync --help
```

`npm link` is optional; contributors may instead use the repository's development script. The exact GitHub owner remains a repository-creation choice and is not embedded in Runner behavior.

The package manifest owns the executable name and version even before npm publication. Git tags and GitHub Releases correspond to that package version.

## Runner Interface

The Runner is a deep module with four public commands:

```text
milvus-release-sync plan
milvus-release-sync approve
milvus-release-sync apply
milvus-release-sync status
```

The former `init`, `pull`, `scan-sdk-tags`, and `audit` phases are internal implementation. Callers should not coordinate or understand their ordering.

Every command supports `--format json`. JSON output and exit codes are the stable automation interface. Human-readable output is a presentation of the same result.

### `plan`

Required inputs:

- Release version, such as `2.6.20`.
- Release line, such as `2.6.x`.
- Feishu document URL/token or an explicit local source snapshot.
- Explicit local Milvus Docs checkout path through `--repo <path>`.
- Explicit release base ref through `--base <ref>`, such as `upstream/v2.6.x`.
- Task output directory.

Behavior:

1. Run workspace preflight against `--repo` and `--base`.
2. Resolve or read the source snapshot.
3. Record source identity, revision, raw hash, and normalized hash.
4. Resolve release-date evidence.
5. Resolve SDK version evidence from the versioned registry.
6. Read the two target files and record their hashes.
7. Render the proposed Release Notes section and Variables changes.
8. Validate evidence, content fidelity, target state, and output scope.
9. Write `plan.json`, `report.md`, and `patch.diff` in the task directory.
10. Compute a plan hash over all inputs, evidence, policies, target baselines, and exact outputs.

`plan` may write task artifacts but never modifies the Milvus Docs checkout.

When workspace preflight fails, `plan` returns a structured configuration error before source acquisition or task artifact creation. It does not clone or repair the repository.

### `approve`

Records explicit human approval of one exact plan hash. Approval includes approver, timestamp, and hash. It does not modify the Milvus Docs checkout.

The CLI does not claim that executing `approve` proves a human reviewed the plan. It records the approval supplied by the caller. The later Skill must pause after `plan` before invoking it.

### `apply`

Defaults to verification/dry-run. `apply --write` is allowed only when:

- Workspace preflight still passes for the same repository and base ref.
- The current plan hash matches the approved hash.
- Source snapshot and evidence are unchanged.
- Target base commit and both target file hashes are unchanged.
- There are no blockers.
- Every output path is in the fixed allowlist.

After writing, the Runner rereads both files and reruns deterministic validation.

### `status`

Reports task state, source identity, evidence freshness, plan hash, approval state, target-baseline state, blockers, and whether the planned result is currently applied.

## Workspace Preflight

Workspace validation is owned by the Runner and executed by both `plan` and `apply`. README instructions and the later Skill explain or remediate failures, but they are not the source of truth for the invariant.

Preflight verifies:

- `--repo` was supplied and resolves to an existing directory.
- The directory is a Git worktree.
- At least one configured remote URL identifies the canonical `milvus-io/milvus-docs` repository. A fork-only checkout must add the canonical repository as a remote before planning.
- `--base` resolves to a local Git commit.
- The current HEAD is based on the specified base commit; a release feature branch is allowed and does not need to have the same name as the base branch.
- `site/en/release_notes.md` and `site/en/Variables.json` both exist.
- Neither allowlisted target file has uncommitted changes.
- HEAD, base commit, repository identity, and target-file hashes can be recorded in the plan.

Unrelated dirty files are reported as warnings because the Runner does not inspect or modify them. Dirty allowlisted files are blockers because their intended baseline is ambiguous.

If the repository is missing, preflight returns exit `3` with a structured configuration failure such as subtype `milvus_docs_missing`. The hint tells a direct CLI user to clone Milvus Docs, prepare or select a worktree based on the desired release branch, and rerun with `--repo` and `--base`.

The Runner never silently executes `git clone`, `git fetch`, `git checkout`, or `git worktree add`. A later Skill may offer to perform those operations only after explicit user authorization, then rerun the Runner so the same preflight verifies the result.

A future explicit `workspace prepare` command may be considered after team usage demonstrates repeated friction. It is not part of v0.1.

## Findings Model

Expected release changes are not failures. Findings are classified as:

- `planned_change`: an expected change included in the patch.
- `warning`: a reviewable condition that does not make the plan unsafe.
- `blocker`: missing or contradictory evidence, invalid content, or unsafe target state.
- `not_configured`: an intentionally unavailable audit capability.

Inserting a new release section and updating Variables values are `planned_change` findings. They do not block approval.

## Fixed Content Policy

The initial Runner has one invariant rather than an exposed content-policy option:

- Feishu feature wording and PR grouping are preserved verbatim.
- The Runner may add only repository-owned structure: version heading, release date, SDK table, normalized subsection heading levels, and surrounding formatting.
- Unexpected feature-text changes are blockers.

An editorial mode should be added only after a real release requires it.

## SDK Source Registry

`registry/sdk-sources.json` is versioned with the Runner. Each entry declares:

- Display name.
- Source type: independent repository tag, server-coupled version, unchanged value, or explicit manual evidence.
- Source repository or evidence location.
- Version selection rule.
- Whether selection is constrained by publication time.
- `Variables.json` key.
- Whether the value appears in the Release Notes SDK table.
- Fallback and blocker policy.

Python, Java, and Node.js may use independent repository tags. Go and REST use explicit server-coupled policies. C# may remain unchanged and excluded from the Release Notes table. The Runner must not pretend these sources share one tag-scanning algorithm.

## Release Date Policy

Initial precedence:

1. GitHub Release `published_at` for the exact Milvus version.
2. Explicit caller-supplied date with recorded justification when GitHub Release evidence is unavailable.

Tag creation dates and the current wall-clock date are not silent fallbacks.

## External Adapters

The Runner does not depend on `feishu-md-sync`.

Production source acquisition uses an adapter backed by the official `lark-cli`. Tests and historical replay use a local snapshot adapter. A local snapshot input also lets callers obtain source Markdown through another tool without coupling that tool to the Runner.

External dependencies are invoked as argument arrays, not shell fragments. Authentication repair is outside the Runner; structured Lark errors are preserved for the caller.

## Task Artifacts

```text
<task-dir>/
  task.json
  source/
    release-notes.remote.md
    evidence.json
  evidence/
    release-date.json
    sdk-versions.json
  plan/
    plan.json
    report.md
    patch.diff
  approvals.json
```

`plan.json` is the machine-readable decision surface. `report.md` explains the same plan to a human. `patch.diff` is the exact proposed change.

The plan hash covers:

- Source identity, revision, and hashes.
- Release-date evidence.
- SDK evidence and registry hash.
- Runner, renderer, policy, and plan-schema versions.
- Target repository identity and base commit.
- Before hashes for both allowlisted files.
- Complete after content and diff for both files.

Changing any covered input invalidates approval.

## Write Safety

Fixed allowlist:

- `site/en/release_notes.md`
- `site/en/Variables.json`

The Runner fails closed when a plan contains another path. It writes no task artifacts into the target repository and does not stage files.

Immediately before replacement, it verifies the expected before hash. Immediately afterward, it verifies the after hash. A partial local write is reported as failure with the affected file identified; success is never claimed.

## Error and Exit Contract

JSON failures contain a stable error type, subtype, message, hint, retryability flag, and relevant structured fields.

Initial exit codes:

- `0`: command succeeded.
- `1`: a complete domain result is available but the plan is blocked.
- `2`: validation or argument failure.
- `3`: authentication, authorization, or configuration failure.
- `4`: retryable external source or evidence acquisition failure.
- `5`: write, verification, or internal failure.
- `10`: approval is required, missing, or invalidated.

The built executable tests every exit category together with its structured JSON failure shape.

Workspace configuration failures use stable subtypes including:

- `milvus_docs_missing`
- `not_git_worktree`
- `repository_identity_mismatch`
- `base_ref_missing`
- `head_not_based_on_release_base`
- `target_file_missing`
- `target_file_dirty`

## Testing Strategy

Tests use the public Runner interface as the primary test surface.

Required coverage:

- Reproduce v2.6.20 from frozen fixtures and generate the expected two-file patch.
- Classify a new release section and Variables updates as `planned_change`.
- Preserve all approved feature text and PR grouping verbatim.
- Resolve independent SDK tags separately from server-coupled and unchanged versions.
- Record and enforce release-date evidence.
- Reject apply after source, evidence, registry, base commit, or target-file drift.
- Reject paths outside the two-file allowlist.
- Reject a missing or non-Git Milvus Docs checkout before creating a plan.
- Reject an unresolved base ref or a HEAD that is not based on the selected release base.
- Reject dirty allowlisted target files while reporting unrelated dirty files as warnings.
- Avoid duplicate release headings across repeated plan/apply runs.
- Verify JSON and final file hashes after apply.
- Exercise JSON output and exit behavior through the built executable.
- Run build, typecheck, unit tests, and fixture replay in CI.

Live Feishu tests are optional and use disposable task directories. Fixture replay is required in normal CI.

## README Requirements

The single English `README.md` should contain:

- One-sentence product outcome.
- Explicit statement that this is not the complete Milvus release workflow.
- Clone/install/build instructions.
- Prerequisites: Node 20+, Git, `lark-cli` for live Feishu acquisition, and access to a Milvus Docs checkout.
- A clone/worktree preparation example and an explanation of the required `--repo` and `--base` arguments.
- The structured failure users see when no Milvus Docs checkout exists.
- A v2.6.20 walkthrough showing source evidence, plan summary, and exact two-file diff.
- Copyable CLI examples for `plan`, `approve`, `apply`, and `status`.
- Safety explanation: no target writes during plan, exact plan approval, drift detection, and two-file allowlist.
- A short repository file map.
- Contribution and license links.
- A future Agent Skill section only after that Skill exists.

## CI and Release Model

Pull-request CI runs on Node 20 and checks:

- Locked dependency installation.
- TypeScript typecheck.
- Unit and integration tests.
- v2.6.20 fixture replay.
- Production build.
- Package/executable smoke test.

v0.1 is installed from source and may be marked with a semantic Git tag and GitHub Release. The first npm publication is a separate later decision based on team usage and Runner stability.

## Runner-First Delivery Phases

### Phase 1: repository and executable contract

- Create the standalone GitHub repository.
- Add package metadata, build, test, and executable skeleton.
- Define JSON result schemas and exit categories.
- Implement workspace preflight and its structured configuration failures.
- Add the frozen v2.6.20 fixture and expected outputs.

### Phase 2: deterministic planning

- Implement source snapshot acquisition.
- Implement release-date and SDK evidence resolution.
- Implement the registry, renderer, Variables planner, findings, report, and plan hash.
- Make v2.6.20 fixture replay pass without target writes.

### Phase 3: approval and verified apply

- Implement approval recording.
- Implement baseline and hash revalidation.
- Implement fixed-allowlist writes and post-write verification.
- Add idempotency and drift tests.

### Phase 4: team release

- Complete README, license, CI, changelog, and package smoke tests.
- Tag and publish a GitHub v0.1 Release.
- Dogfood the Runner on the next Milvus minor release.

### Phase 5: Agent Skill

- Design a thin Skill against the stable Runner contract.
- Add compatibility and capability checks.
- Translate workspace-preflight failures and offer Git preparation only after explicit user authorization.
- Rerun the Runner after any Agent-assisted clone or worktree setup.
- Add the human-approval pause and final verification flow.
- Install the new Skill and only then replace the old installed Skill with a safe deprecation redirect.

## Temporary Design Location and Migration

This design and its research note currently live under `skills-hub/personal/milvus-release-sync/` only because the standalone repository does not yet exist.

After repository creation:

1. Move the design and research note into the standalone repository.
2. Make the standalone repository the only canonical source.
3. Remove the temporary `skills-hub` copies in a dedicated cleanup commit.
4. Do not install or modify either Skill until the Runner contract passes its acceptance tests.

## Acceptance Criteria

- A teammate can clone the GitHub repository, install locked dependencies, build it, and run `milvus-release-sync --help` without an Agent.
- `plan` refuses to run without a valid local Milvus Docs worktree and selected release base.
- Missing workspace errors explain how to prepare the checkout without performing Git operations automatically.
- The v2.6.20 fixture produces only the expected `release_notes.md` and `Variables.json` patch.
- Feature-document files are never inspected or modified.
- Planned release changes do not block approval.
- Approval is invalidated by every plan-covered input change.
- `apply --write` cannot modify a path outside the allowlist.
- The public JSON and exit contract is tested through the built CLI.
- CI passes in a clean checkout.
- v0.1 is shareable through one GitHub repository URL and documented source installation.
- No Agent Skill is required to use the Runner.
- The old installed Skill remains untouched until the new Runner and later Skill are ready.
