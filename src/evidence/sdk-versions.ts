import { z } from 'zod';
import { RunnerError } from '../core/cli-failure.js';
import { sdkVersionRowSchema } from '../core/schema.js';
import type { SdkVersionRow } from '../core/types.js';
import { runProcess } from '../process/run-process.js';
import {
  parseSdkRegistry,
  type SdkRegistrySource,
} from './sdk-registry.js';

export type SdkVersionInput = {
  releaseVersion: string;
  releaseLine: string;
  currentVariables: Record<string, unknown>;
  registry: unknown;
  listTags: (repository: string) => Promise<string[]>;
  explicitEvidence?: SdkVersionRow[];
};

const explicitEvidenceSchema = z.array(sdkVersionRowSchema).min(1);

function validationError(subtype: string, message: string): RunnerError {
  return new RunnerError(2, {
    type: 'validation',
    subtype,
    message,
    retryable: false,
  });
}

function unavailable(
  source: SdkRegistrySource,
  releaseLine: string,
  retryable: boolean,
  cause?: unknown,
): RunnerError {
  return new RunnerError(4, {
    type: 'external',
    subtype: 'sdk_version_unavailable',
    message: `SDK version evidence is unavailable for ${source.label}.`,
    hint: 'Provide validated explicit SDK evidence or make the configured source available.',
    retryable,
    details: {
      id: source.id,
      releaseLine,
      ...(cause === undefined
        ? {}
        : { cause: cause instanceof Error ? cause.message : String(cause) }),
    },
  });
}

function releaseLineParts(releaseLine: string): [number, number] {
  const match = /^(\d+)\.(\d+)\.x$/.exec(releaseLine);
  if (match === null) {
    throw validationError(
      'sdk_release_line_invalid',
      `SDK release line must use MAJOR.MINOR.x: ${releaseLine}`,
    );
  }
  return [Number(match[1]), Number(match[2])];
}

function tagName(value: string): string {
  const ref = value.includes('\t') ? value.slice(value.lastIndexOf('\t') + 1) : value;
  return ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
}

function highestStrictTag(tags: string[], releaseLine: string): string | undefined {
  const [major, minor] = releaseLineParts(releaseLine);
  const pattern = new RegExp(`^v${major}\\.${minor}\\.(\\d+)$`);
  let highestPatch: number | undefined;

  for (const candidate of tags) {
    const match = pattern.exec(tagName(candidate));
    if (match === null) {
      continue;
    }
    const patch = Number(match[1]);
    if (highestPatch === undefined || patch > highestPatch) {
      highestPatch = patch;
    }
  }

  return highestPatch === undefined ? undefined : `${major}.${minor}.${highestPatch}`;
}

function row(
  source: SdkRegistrySource,
  value: string,
  evidence: string,
): SdkVersionRow {
  return sdkVersionRowSchema.parse({
    id: source.id,
    label: source.label,
    value,
    sourceType: source.sourceType,
    evidence,
    variablesKeys: source.variablesKeys,
    includeInTable: source.includeInTable,
  });
}

export async function listGithubTags(repository: string): Promise<string[]> {
  const output = await runProcess('git', [
    'ls-remote',
    '--tags',
    `https://github.com/${repository}.git`,
  ]);
  return output
    .split('\n')
    .filter((line) => line !== '')
    .map(tagName);
}

export async function resolveSdkVersions(
  input: SdkVersionInput,
): Promise<SdkVersionRow[]> {
  let registry;
  try {
    registry = parseSdkRegistry(input.registry);
  } catch {
    throw validationError(
      'sdk_registry_invalid',
      'SDK source registry does not match schema version 1.',
    );
  }

  if (input.explicitEvidence !== undefined) {
    const parsed = explicitEvidenceSchema.safeParse(input.explicitEvidence);
    if (
      !parsed.success ||
      !matchesRegistry(parsed.data, registry.sources)
    ) {
      throw validationError(
        'sdk_evidence_invalid',
        'Explicit SDK evidence is incomplete or inconsistent with the registry.',
      );
    }
    return parsed.data;
  }

  releaseLineParts(input.releaseLine);
  const rows: SdkVersionRow[] = [];
  for (const source of registry.sources) {
    if (source.sourceType === 'github-tag') {
      let tags: string[];
      try {
        tags = await input.listTags(source.repository);
      } catch (error) {
        throw unavailable(source, input.releaseLine, true, error);
      }
      const value = highestStrictTag(tags, input.releaseLine);
      if (value === undefined) {
        throw unavailable(source, input.releaseLine, false);
      }
      rows.push(
        row(
          source,
          value,
          `https://github.com/${source.repository}/releases/tag/v${value}`,
        ),
      );
      continue;
    }

    if (source.sourceType === 'release-version') {
      rows.push(
        row(
          source,
          input.releaseVersion,
          `Milvus release ${input.releaseVersion}`,
        ),
      );
      continue;
    }

    const key = source.variablesKeys[0];
    const value = input.currentVariables[key];
    if (typeof value !== 'string' || value === '') {
      throw unavailable(source, input.releaseLine, false);
    }
    rows.push(row(source, value, `Variables.json:${key}`));
  }

  return rows;
}

function matchesRegistry(
  rows: SdkVersionRow[],
  sources: SdkRegistrySource[],
): boolean {
  if (rows.length !== sources.length) {
    return false;
  }

  const rowsById = new Map<string, SdkVersionRow>();
  for (const row of rows) {
    if (
      rowsById.has(row.id) ||
      row.value.trim() === '' ||
      row.evidence.trim() === ''
    ) {
      return false;
    }
    rowsById.set(row.id, row);
  }

  return sources.every((source) => {
    const row = rowsById.get(source.id);
    return (
      row !== undefined &&
      row.label === source.label &&
      row.includeInTable === source.includeInTable &&
      arraysEqual(row.variablesKeys, source.variablesKeys) &&
      row.sourceType === 'explicit'
    );
  });
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
