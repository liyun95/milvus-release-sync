import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256 } from '../src/core/hash.js';
import { acquireSource } from '../src/source/source.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('local source acquisition', () => {
  it('preserves local Markdown bytes and records its absolute locator and hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'milvus-release-sync-source-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'release.md');
    const markdown = '## Improvements\r\n\r\n- Added X.\r\n';
    await writeFile(sourcePath, markdown, 'utf8');
    const run = vi.fn();

    const result = await acquireSource(sourcePath, run);

    expect(result).toEqual({
      kind: 'local-markdown',
      locator: resolve(sourcePath),
      rawHash: sha256(markdown),
      markdown,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Feishu source acquisition', () => {
  it('extracts a document token from a Feishu URL and records its revision', async () => {
    const markdown = '## Improvements\n';
    const run = vi.fn().mockResolvedValue(
      JSON.stringify({
        data: {
          document: {
            content: markdown,
            revision_id: 7,
          },
        },
      }),
    );
    const locator = 'https://example.feishu.cn/docx/DocToken?from=release';

    const result = await acquireSource(locator, run);

    expect(run).toHaveBeenCalledExactlyOnceWith('lark-cli', [
      'docs',
      '+fetch',
      '--doc',
      'DocToken',
      '--doc-format',
      'markdown',
      '--format',
      'json',
    ]);
    expect(result).toEqual({
      kind: 'feishu-docx',
      locator,
      documentId: 'DocToken',
      revision: '7',
      rawHash: sha256(markdown),
      markdown,
    });
  });

  it('accepts a raw document token and top-level data content', async () => {
    const markdown = '## Bug fixes\n';
    const run = vi.fn().mockResolvedValue(
      JSON.stringify({ data: { content: markdown } }),
    );

    const result = await acquireSource('RawDocToken', run);

    expect(run).toHaveBeenCalledExactlyOnceWith('lark-cli', [
      'docs',
      '+fetch',
      '--doc',
      'RawDocToken',
      '--doc-format',
      'markdown',
      '--format',
      'json',
    ]);
    expect(result).toEqual({
      kind: 'feishu-docx',
      locator: 'RawDocToken',
      documentId: 'RawDocToken',
      rawHash: sha256(markdown),
      markdown,
    });
  });

  it('rejects a response without Markdown content', async () => {
    const run = vi.fn().mockResolvedValue(
      JSON.stringify({ data: { document: { revision_id: 7 } } }),
    );

    await expect(acquireSource('DocToken', run)).rejects.toMatchObject({
      exitCode: 5,
      failure: {
        subtype: 'lark_content_missing',
        retryable: false,
      },
    });
  });

  it('maps lark-cli authentication failures to a stable runner error', async () => {
    const run = vi.fn().mockRejectedValue(new Error('authentication required'));

    await expect(acquireSource('DocToken', run)).rejects.toMatchObject({
      exitCode: 3,
      failure: {
        type: 'authentication',
        subtype: 'lark_fetch_failed',
        retryable: false,
      },
    });
  });
});
