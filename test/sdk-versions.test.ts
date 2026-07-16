import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { SdkVersionRow } from '../src/core/types.js';
import { parseSdkRegistry } from '../src/evidence/sdk-registry.js';
import { resolveSdkVersions } from '../src/evidence/sdk-versions.js';

async function registry(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL('../registry/sdk-sources.json', import.meta.url),
      'utf8',
    ),
  );
}

async function completeExplicitEvidence(): Promise<SdkVersionRow[]> {
  const parsed = parseSdkRegistry(await registry());
  return parsed.sources.map((source) => ({
    id: source.id,
    label: source.label,
    value: `${source.id}-version`,
    sourceType: 'explicit' as const,
    evidence: `Frozen evidence for ${source.id}`,
    variablesKeys: source.variablesKeys,
    includeInTable: source.includeInTable,
  }));
}

describe('resolveSdkVersions', () => {
  it('resolves the exact v2.6.20 SDK values by each registry policy', async () => {
    const tagsByRepository: Record<string, string[]> = {
      'milvus-io/pymilvus': [
        'v2.6.15',
        'v2.6.16',
        'v2.6.17-rc1',
        '2.6.99',
        'v2.7.0',
      ],
      'milvus-io/milvus-sdk-node': ['v2.6.9', 'v2.6.17', 'v2.6.18-beta'],
      'milvus-io/milvus-sdk-java': ['v2.6.21', 'v2.6.22', 'v3.6.99'],
    };
    const listTags = vi.fn(async (repository: string) => tagsByRepository[repository] ?? []);

    const rows = await resolveSdkVersions({
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      currentVariables: { milvus_csharp_sdk_real_version: '2.6.4' },
      registry: await registry(),
      listTags,
    });

    expect(rows.map(({ id, value, sourceType }) => ({ id, value, sourceType }))).toEqual([
      { id: 'python', value: '2.6.16', sourceType: 'github-tag' },
      { id: 'nodejs', value: '2.6.17', sourceType: 'github-tag' },
      { id: 'java', value: '2.6.22', sourceType: 'github-tag' },
      { id: 'go', value: '2.6.20', sourceType: 'release-version' },
      { id: 'rest', value: '2.6.20', sourceType: 'release-version' },
      { id: 'csharp', value: '2.6.4', sourceType: 'unchanged' },
    ]);
    expect(listTags.mock.calls.map(([repository]) => repository)).toEqual([
      'milvus-io/pymilvus',
      'milvus-io/milvus-sdk-node',
      'milvus-io/milvus-sdk-java',
    ]);
  });

  it('uses only stable tags that strictly match the requested release line', async () => {
    const parsed = parseSdkRegistry(await registry());
    const pythonOnly = {
      ...parsed,
      sources: parsed.sources.filter(({ id }) => id === 'python'),
    };

    await expect(
      resolveSdkVersions({
        releaseVersion: '2.6.20',
        releaseLine: '2.6.x',
        currentVariables: {},
        registry: pythonOnly,
        listTags: async () => ['v2.6.22-rc1', '2.6.23', 'v2.7.24'],
      }),
    ).rejects.toMatchObject({
      exitCode: 4,
      failure: { type: 'external', subtype: 'sdk_version_unavailable' },
    });
  });

  it('returns validated explicit evidence without looking up live tags', async () => {
    const explicitEvidence = await completeExplicitEvidence();
    const listTags = vi.fn();

    await expect(
      resolveSdkVersions({
        releaseVersion: '2.6.20',
        releaseLine: '2.6.x',
        currentVariables: {},
        registry: await registry(),
        listTags,
        explicitEvidence,
      }),
    ).resolves.toEqual(explicitEvidence);
    expect(listTags).not.toHaveBeenCalled();
  });

  it('rejects explicit evidence that omits a registry source', async () => {
    const explicitEvidence = (await completeExplicitEvidence()).filter(
      ({ id }) => id !== 'rest',
    );

    await expectInvalidExplicitEvidence(explicitEvidence);
  });

  it('rejects duplicate explicit evidence IDs', async () => {
    const explicitEvidence = await completeExplicitEvidence();
    explicitEvidence.push({ ...explicitEvidence[0] });

    await expectInvalidExplicitEvidence(explicitEvidence);
  });

  it('rejects unknown explicit evidence IDs', async () => {
    const explicitEvidence = await completeExplicitEvidence();
    explicitEvidence[0] = { ...explicitEvidence[0], id: 'unknown-sdk' };

    await expectInvalidExplicitEvidence(explicitEvidence);
  });

  it('rejects explicit evidence with tampered registry metadata', async () => {
    const variants: Array<(row: SdkVersionRow) => SdkVersionRow> = [
      (row) => ({ ...row, label: 'Tampered SDK' }),
      (row) => ({ ...row, variablesKeys: ['tampered_version_key'] }),
      (row) => ({ ...row, includeInTable: !row.includeInTable }),
    ];

    for (const mutate of variants) {
      const explicitEvidence = await completeExplicitEvidence();
      explicitEvidence[0] = mutate(explicitEvidence[0]);
      await expectInvalidExplicitEvidence(explicitEvidence);
    }
  });

  it('rejects explicit evidence with an empty value or evidence description', async () => {
    for (const field of ['value', 'evidence'] as const) {
      const explicitEvidence = await completeExplicitEvidence();
      explicitEvidence[0] = { ...explicitEvidence[0], [field]: '' };
      await expectInvalidExplicitEvidence(explicitEvidence);
    }
  });

  it('rejects malformed explicit evidence before any live lookup', async () => {
    const listTags = vi.fn();

    await expect(
      resolveSdkVersions({
        releaseVersion: '2.6.20',
        releaseLine: '2.6.x',
        currentVariables: {},
        registry: await registry(),
        listTags,
        explicitEvidence: [{ id: 'python' }] as SdkVersionRow[],
      }),
    ).rejects.toMatchObject({
      exitCode: 2,
      failure: { type: 'validation', subtype: 'sdk_evidence_invalid' },
    });
    expect(listTags).not.toHaveBeenCalled();
  });
});

async function expectInvalidExplicitEvidence(
  explicitEvidence: SdkVersionRow[],
): Promise<void> {
  const listTags = vi.fn();

  await expect(
    resolveSdkVersions({
      releaseVersion: '2.6.20',
      releaseLine: '2.6.x',
      currentVariables: {},
      registry: await registry(),
      listTags,
      explicitEvidence,
    }),
  ).rejects.toMatchObject({
    exitCode: 2,
    failure: { type: 'validation', subtype: 'sdk_evidence_invalid' },
  });
  expect(listTags).not.toHaveBeenCalled();
}
