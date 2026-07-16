import { z } from 'zod';

export const findingSchema = z.object({
  severity: z.enum(['planned_change', 'warning', 'blocker', 'not_configured']),
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional()
});

export const sourceEvidenceSchema = z.object({
  kind: z.enum(['local-markdown', 'feishu-docx']),
  locator: z.string(),
  documentId: z.string().optional(),
  revision: z.string().optional(),
  rawHash: z.string(),
  markdown: z.string()
});

export const releaseDateEvidenceSchema = z.object({
  source: z.enum(['github-release-published-at', 'explicit']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidenceUrl: z.string().url().optional(),
  reason: z.string().optional()
});

export const sdkVersionRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  sourceType: z.enum(['github-tag', 'release-version', 'unchanged', 'explicit']),
  evidence: z.string(),
  variablesKeys: z.array(z.string()),
  includeInTable: z.boolean()
});

export const plannedPathSchema = z.enum([
  'site/en/release_notes.md',
  'site/en/Variables.json'
]);

export const plannedFileSchema = z.object({
  path: plannedPathSchema,
  beforeHash: z.string(),
  afterHash: z.string(),
  before: z.string(),
  after: z.string(),
  diff: z.string()
});

export const workspaceSnapshotSchema = z.object({
  repoPath: z.string(),
  baseRef: z.string(),
  baseCommit: z.string(),
  headCommit: z.string(),
  canonicalRemote: z.string(),
  targetFilesClean: z.literal(true),
  unrelatedDirtyFiles: z.array(z.string()),
  fileHashes: z.object({
    'site/en/release_notes.md': z.string(),
    'site/en/Variables.json': z.string()
  })
});

export const planSchema = z.object({
  kind: z.literal('milvus-release-sync-plan'),
  schemaVersion: z.literal(1),
  runnerVersion: z.literal('0.1.0'),
  releaseVersion: z.string(),
  releaseLine: z.string(),
  generatedAt: z.string(),
  workspace: workspaceSnapshotSchema,
  source: sourceEvidenceSchema,
  releaseDate: releaseDateEvidenceSchema,
  sdkVersions: z.array(sdkVersionRowSchema),
  findings: z.array(findingSchema),
  files: z.tuple([plannedFileSchema, plannedFileSchema]),
  planHash: z.string()
});

export const approvalSchema = z.object({
  planHash: z.string(),
  approvedBy: z.string().min(1),
  approvedAt: z.string()
});

export const taskSchema = z.object({
  kind: z.literal('milvus-release-sync-task'),
  schemaVersion: z.literal(1),
  status: z.enum(['planned', 'blocked', 'approved', 'applied']),
  releaseVersion: z.string(),
  releaseLine: z.string(),
  createdAt: z.string(),
  planHash: z.string(),
  approval: approvalSchema.nullable()
});
