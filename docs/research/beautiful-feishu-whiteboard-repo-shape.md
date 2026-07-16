# `beautiful-feishu-whiteboard` Repository Shape

Date: 2026-07-16
Reference snapshot: [`6989843`](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/tree/6989843b355ac92ebbd4f66166189a001e61e9b5)

## Executive conclusion

[`beautiful-feishu-whiteboard`](https://github.com/zarazhangrui/beautiful-feishu-whiteboard) is a strong reference for how to **present and distribute an Agent Skill as a small public GitHub product**, but it is not a reference implementation for a deterministic standalone runner.

Its product is primarily a collection of agent instructions and curated data. The repository tells an Agent how to choose a visual style, construct an SVG, call external Lark tools, inspect the result, and deliver it. The only bundled executable is a prerequisite-checking shell script; the actual render and write operations are performed by third-party CLIs. The repository snapshot contains no package manifest, in-repo application source, test suite, CI workflow, tags, or GitHub releases. Sources: [README introduction](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L5-L17), [repository tree](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/tree/6989843b355ac92ebbd4f66166189a001e61e9b5), [`SKILL.md`](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/SKILL.md#L14-L21), [`scripts/preflight.sh`](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/scripts/preflight.sh).

For `milvus-release-sync`, the transferable idea is the approachable public-facing shell: clear positioning, easy installation, plain-language examples, visible outputs, a concise file map, and an open-source license. The internal architecture should be deliberately different: **Runner first, Skill second**.

## What the reference repository contains

The repository is flat and skill-oriented:

```text
README.md
README.zh.md
SKILL.md
RULES.md
CATALOG.md
LICENSE
scripts/
  preflight.sh
templates/
  <35 style slugs>/design.md
assets/
  styles/<35 preview images>.png
```

The complete tree has no `package.json`, lockfile, `src/`, `bin/`, `test/`, or `.github/workflows/` directory. The only file GitHub classifies as program source is the shell preflight script. Sources: [immutable repository tree](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/tree/6989843b355ac92ebbd4f66166189a001e61e9b5), [recursive Git tree API](https://api.github.com/repos/zarazhangrui/beautiful-feishu-whiteboard/git/trees/6989843b355ac92ebbd4f66166189a001e61e9b5?recursive=1), [languages API](https://api.github.com/repos/zarazhangrui/beautiful-feishu-whiteboard/languages).

The files have clear instructional roles:

- `SKILL.md` is the Agent entry point: intent matching, prerequisite checks, questions to ask, style selection, build loop, and delivery behavior. It explicitly says the Agent composes the layout rather than calling an in-repo generator. Sources: [`SKILL.md` frontmatter and scope](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/SKILL.md#L1-L21), [`SKILL.md` workflow](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/SKILL.md#L44-L74).
- `CATALOG.md` helps the Agent select one of the palettes; each `templates/<slug>/design.md` supplies the chosen palette and mood. `SKILL.md` uses progressive disclosure by telling the Agent to choose from the catalogue and open only the selected template. Source: [`SKILL.md` style-selection steps](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/SKILL.md#L51-L56).
- `RULES.md` records the medium's constraints and exact commands for rendering, checking, updating, and querying a whiteboard. Those commands invoke external `@larksuite/whiteboard-cli` and `lark-cli` executables. Source: [`RULES.md` workflow](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/RULES.md#L85-L114).
- `scripts/preflight.sh` checks Node, the presence and authentication state of `lark-cli`, and whether `@larksuite/whiteboard-cli` is reachable through `npx`; it does not create a board. Source: [`scripts/preflight.sh`](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/scripts/preflight.sh#L1-L48).

The executable boundary is therefore:

```text
User prompt
  -> Agent reads Skill instructions and templates
  -> Agent authors an SVG and runs documented shell commands
  -> external whiteboard-cli renders/converts it
  -> external lark-cli writes/reads Feishu
```

There is no repository-owned runner that accepts a stable input contract and returns a stable machine-readable result.

## Installation, distribution, and invocation

The README offers three installation paths:

1. Tell an Agent to install the Skill from the GitHub repository.
2. Run `npx skills add zarazhangrui/beautiful-feishu-whiteboard`, optionally with `-g`.
3. Clone the repository directly into an Agent's skills directory.

Source: [README installation section](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L115-L137).

`npx skills add` is an external Skill installer consuming the GitHub repository; it is not an npm package published by this repository. The repository itself has no npm metadata or `bin` declaration. After installation, users do not run a repository-owned command. They invoke the capability in plain language, for example by asking an Agent to make a Feishu whiteboard in a named style. Source: [README usage examples](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L139-L165).

The README is effective product packaging because it quickly communicates:

- the one-sentence outcome;
- a visual gallery showing the same content across styles;
- installation choices;
- prerequisites and one preflight command;
- copyable plain-language prompts;
- a short explanation of each important repository file;
- an MIT license.

Sources: [README gallery framing](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L19-L23), [README requirements and use](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L139-L165), [README file map and license](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L167-L182), [MIT license](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/LICENSE).

## Testing, validation, and versioning

The repository has operational validation, not a software test and release system:

- `preflight.sh` validates the local environment.
- `RULES.md` tells the Agent to render, run the external CLI's `--check`, view the image, correct layout defects, write to Feishu, and inspect the live result. This is a useful human/Agent QA loop, but it is not an automated in-repo test suite. Source: [`RULES.md` render-and-inspect loop](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/RULES.md#L85-L114).
- `SKILL.md` declares `version: 1.1.1` in frontmatter. The latest commit explicitly says it bumped that value from `1.1.0` to `1.1.1`. Sources: [`SKILL.md` frontmatter](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/SKILL.md#L1-L12), [version-bump commit](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/commit/6989843b355ac92ebbd4f66166189a001e61e9b5).
- At the inspected snapshot, there are no Git tags, GitHub Releases, or GitHub Actions workflows. Sources: [tags API](https://api.github.com/repos/zarazhangrui/beautiful-feishu-whiteboard/tags), [releases API](https://api.github.com/repos/zarazhangrui/beautiful-feishu-whiteboard/releases), [workflows API](https://api.github.com/repos/zarazhangrui/beautiful-feishu-whiteboard/actions/workflows).

This is adequate for a Markdown-based style library whose core behavior remains Agent judgment plus external tools. It is not adequate for a release-critical runner that computes evidence, hashes an approved plan, and writes two repository files under strict safety invariants.

## Patterns to copy

### 1. Treat the GitHub repository as the shareable product page

Use a memorable repository name, a one-sentence value proposition, a concise explanation of the outcome, examples that can be copied immediately, and an open-source license. The reference repository makes the result understandable before explaining its internals.

For `milvus-release-sync`, the first screen should say that the tool prepares an auditable Milvus release-notes patch from approved source material and SDK/release evidence, without implying that it owns the full release process.

### 2. Show the result, not only the architecture

The reference gallery lets a visitor see value immediately and holds the content constant so the styles are comparable. Source: [README gallery framing](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L19-L23).

The equivalent for `milvus-release-sync` should be an audit-friendly v2.6.20 demonstration:

- frozen input snapshot;
- resolved release-date and SDK evidence;
- representative `plan.json` summary;
- human-readable report excerpt;
- exact two-file diff;
- expected no-write-before-approval behavior.

This can be presented as a short README walkthrough linking to checked-in fixtures rather than as an image-heavy gallery.

### 3. Make installation and first use explicit

Copy the reference's low-friction pattern of one obvious install command, a prerequisites section, a preflight/doctor command, and several examples. Keep separate examples for humans invoking the CLI and humans asking an Agent to use it.

### 4. Keep the file map short and intentional

The reference explains the role of `SKILL.md`, `CATALOG.md`, `RULES.md`, and templates in a few lines. Source: [README “How it works”](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L167-L176).

The new repository should likewise explain the stable command surface, policy/registry data, fixtures, task artifacts, and later Skill adapter without exposing every internal module.

### 5. Use progressive disclosure in the later Skill

The reference Skill chooses from a catalogue before loading one detailed template. Source: [`SKILL.md` selection flow](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/SKILL.md#L51-L56).

For `milvus-release-sync`, the Skill should stay even thinner: inspect runner capabilities, collect required inputs, call `plan`, present the report and patch, pause for approval, then call `approve` and optionally `apply --write`. It should not repeat the evidence, rendering, hashing, or write-safety algorithms in prose.

### 6. Consider bilingual documentation if it matches the team's audience

The reference keeps English and Chinese READMEs with a language switch at the top. Sources: [English README](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.md#L1-L8), [Chinese README](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/README.zh.md).

This is useful only when both versions can be kept current. The `milvus-release-sync` project has explicitly chosen one English `README.md`, so this presentation pattern will not be adopted.

## Patterns not to copy

### 1. Do not make the Skill the implementation

The reference delegates core creative work to the Agent and puts the operational recipe in Markdown. That is appropriate for palette-guided diagram composition. It would make release-note generation non-deterministic and hard to audit.

For this project, `plan -> approve -> apply -> status`, evidence resolution, content preservation, plan hashing, file allowlisting, drift detection, and post-write verification must live in the Runner. The Skill is only an invocation and approval adapter.

### 2. Do not omit package and executable metadata

Unlike the reference, the new repository needs a real package manifest, lockfile, executable entry point, supported Node version, and reproducible installation. A user must be able to run the tool directly without installing an Agent Skill.

### 3. Do not rely on prose recipes or floating runtime downloads

The reference documents long shell pipelines and invokes `@larksuite/whiteboard-cli@^0.2.11` through `npx`. Sources: [`RULES.md` commands](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/RULES.md#L85-L114), [`preflight.sh` dependency check](https://github.com/zarazhangrui/beautiful-feishu-whiteboard/blob/6989843b355ac92ebbd4f66166189a001e61e9b5/scripts/preflight.sh#L35-L40).

A release-critical runner should lock library dependencies, own its orchestration in typed code, emit structured JSON, and use stable exit codes. External CLIs such as `lark-cli` can remain explicit adapters, but their availability and compatible versions should be checked deterministically.

### 4. Do not use `SKILL.md` as the canonical version source

The Runner/package version and plan schema/policy versions should be canonical. A later Skill should declare or check a compatible Runner capability/version range. Git tags and GitHub Releases should correspond to Runner releases.

### 5. Do not ship without tests and CI

The reference has no test suite or Actions workflow in the inspected tree. That should not be copied. The new Runner needs fixture replay, unit tests for policies and rendering, integration tests over the public CLI, write-safety tests, typechecking, and CI on pull requests.

### 6. Do not make Agent installation the only distribution path

`npx skills add` is suitable for a Skill repository, but the Runner must be independently installable. Skill installation should come later and should either bundle no implementation or depend on a clearly versioned Runner package.

## Recommended standalone `milvus-release-sync` repository shape

The repository should present one product with two layers, developed in this order:

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
      main.ts
      plan.ts
      approve.ts
      apply.ts
      status.ts
    core/                     # hashing, schemas, paths, task state
    evidence/                 # release-date and SDK resolvers
    source/                   # local snapshot and Lark adapters
    render/                   # release_notes + Variables planning
    validation/               # blockers, warnings, invariants
    write/                    # allowlist, drift checks, verified writes

  registry/
    sdk-sources.json

  test/
    fixtures/
      v2.6.20/
    *.test.ts

  docs/
    architecture.md
    task-artifacts.md
    examples/

  scripts/
    preflight.sh              # or a Runner-owned `doctor` command

  skill/                      # added after Runner behavior is stable
    milvus-release-sync/
      SKILL.md

  .github/
    workflows/
      ci.yml
      release.yml             # when automated publishing is adopted
```

Important boundaries:

- `package.json` exposes the `milvus-release-sync` executable and is the canonical product version.
- The four public commands are the supported API; internal scan/acquisition phases are not separate user-facing commands.
- `test/fixtures/v2.6.20/` is both an acceptance fixture and the README's concrete proof of behavior.
- `skill/` is intentionally absent or minimal during Runner development. When added, its `SKILL.md` calls the installed executable and checks compatibility rather than reimplementing policy.
- CI runs tests, fixture replay, typechecking, and build checks. Releases use semantic Git tags and publish immutable release notes/artifacts.

## Distribution recommendation

Use GitHub as the canonical source, collaboration, issue, and release location. For a Node/TypeScript Runner, expose a standard npm-compatible CLI package so teammates can install and invoke it directly. A practical progression is:

1. During development: clone the GitHub repository, install locked dependencies, and run the local CLI.
2. First team release: create a semantic Git tag and GitHub Release; publish the CLI to the agreed npm registry if team policy allows it.
3. After the Runner contract is stable: add the thin Skill directory and document Agent installation separately.
4. Keep Runner releases and Skill compatibility explicit; never require users to infer compatibility from a mutable branch.

This retains the reference repository's biggest strength—one easy-to-share GitHub URL—while giving `milvus-release-sync` the deterministic execution, testing, auditability, and release discipline its domain requires.
