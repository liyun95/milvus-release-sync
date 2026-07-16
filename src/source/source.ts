import { stat } from 'node:fs/promises';

import type { SourceEvidence } from '../core/types.js';
import { fetchLarkSource } from './lark-source.js';
import { readLocalSource } from './local-source.js';

export type ProcessRunner = (
  command: string,
  args: string[],
) => Promise<string>;

export async function acquireSource(
  locator: string,
  run: ProcessRunner,
): Promise<SourceEvidence> {
  try {
    if ((await stat(locator)).isFile()) {
      return readLocalSource(locator);
    }
  } catch {
    // Non-filesystem locators are acquired through lark-cli.
  }

  return fetchLarkSource(locator, (args) => run('lark-cli', args));
}
