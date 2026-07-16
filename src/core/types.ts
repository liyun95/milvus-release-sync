import type { z } from 'zod';
import {
  approvalSchema,
  findingSchema,
  planSchema,
  plannedFileSchema,
  releaseDateEvidenceSchema,
  sdkVersionRowSchema,
  sourceEvidenceSchema,
  taskSchema,
  workspaceSnapshotSchema
} from './schema.js';

export type Approval = z.infer<typeof approvalSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type PlannedFile = z.infer<typeof plannedFileSchema>;
export type ReleaseDateEvidence = z.infer<typeof releaseDateEvidenceSchema>;
export type ReleasePlan = z.infer<typeof planSchema>;
export type ReleaseTask = z.infer<typeof taskSchema>;
export type SdkVersionRow = z.infer<typeof sdkVersionRowSchema>;
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
