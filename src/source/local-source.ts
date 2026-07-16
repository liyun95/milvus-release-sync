import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sha256 } from '../core/hash.js';
import type { SourceEvidence } from '../core/types.js';

export async function readLocalSource(path: string): Promise<SourceEvidence> {
  const locator = resolve(path);
  const markdown = await readFile(locator, 'utf8');

  return {
    kind: 'local-markdown',
    locator,
    rawHash: sha256(markdown),
    markdown,
  };
}
