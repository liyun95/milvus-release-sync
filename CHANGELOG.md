# Changelog

## 0.1.0 - 2026-07-16

- Add the `plan`, `approve`, `apply`, and `status` commands.
- Validate canonical Milvus Docs worktrees, release bases, target files, and repository identity.
- Record release-date, SDK, source, registry, and workspace evidence in stable plans.
- Require exact plan-hash approval and detect plan, evidence, registry, workspace, and target drift.
- Apply verified writes only to `site/en/release_notes.md` and `site/en/Variables.json`.
- Reproduce the Milvus v2.6.20 release update byte for byte from frozen fixtures.
