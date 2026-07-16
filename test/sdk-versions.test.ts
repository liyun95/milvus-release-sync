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
    const explicitEvidence: SdkVersionRow[] = [
      {
        id: 'python',
        label: 'Python SDK',
        value: '2.6.16',
        sourceType: 'explicit',
        evidence: 'Frozen evidence for the v2.6.20 replay',
        variablesKeys: ['milvus_python_sdk_real_version'],
        includeInTable: true,
      },
    ];
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
