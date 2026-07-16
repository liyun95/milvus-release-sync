import { z } from 'zod';

const registrySourceBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  variablesKeys: z.array(z.string().min(1)).min(1),
  includeInTable: z.boolean(),
});

export const sdkRegistrySourceSchema = z.discriminatedUnion('sourceType', [
  registrySourceBaseSchema.extend({
    sourceType: z.literal('github-tag'),
    repository: z.string().regex(/^[^/]+\/[^/]+$/),
  }),
  registrySourceBaseSchema.extend({
    sourceType: z.literal('release-version'),
  }),
  registrySourceBaseSchema.extend({
    sourceType: z.literal('unchanged'),
  }),
]);

export const sdkRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(sdkRegistrySourceSchema),
  releaseVariables: z.record(z.string()),
});

export type SdkRegistry = z.infer<typeof sdkRegistrySchema>;
export type SdkRegistrySource = z.infer<typeof sdkRegistrySourceSchema>;

export function parseSdkRegistry(value: unknown): SdkRegistry {
  return sdkRegistrySchema.parse(value);
}
