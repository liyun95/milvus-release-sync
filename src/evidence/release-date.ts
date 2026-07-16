import { RunnerError } from '../core/cli-failure.js';
import { releaseDateEvidenceSchema } from '../core/schema.js';
import type { ReleaseDateEvidence } from '../core/types.js';

export type ReleaseDateInput = {
  releaseVersion: string;
  explicitDate?: string;
  explicitReason?: string;
  fetchJson?: (url: string) => Promise<unknown>;
};

function unavailable(message: string): RunnerError {
  return new RunnerError(4, {
    type: 'external',
    subtype: 'release_date_unavailable',
    message,
    hint: 'Publish the exact GitHub Release or provide --release-date with --release-date-reason.',
    retryable: false,
  });
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

async function fetchGithubJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN !== undefined) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  return response.json();
}

export async function resolveReleaseDate(
  input: ReleaseDateInput,
): Promise<ReleaseDateEvidence> {
  if (input.explicitDate !== undefined) {
    const reason = input.explicitReason?.trim();
    if (!isCalendarDate(input.explicitDate) || reason === undefined || reason === '') {
      throw unavailable('An explicit release date requires a valid date and a recorded reason.');
    }

    return releaseDateEvidenceSchema.parse({
      source: 'explicit',
      date: input.explicitDate,
      reason,
    });
  }

  const url = `https://api.github.com/repos/milvus-io/milvus/releases/tags/v${input.releaseVersion}`;
  let value: unknown;
  try {
    value = await (input.fetchJson ?? fetchGithubJson)(url);
  } catch (error) {
    throw new RunnerError(4, {
      type: 'external',
      subtype: 'github_release_failed',
      message: `Failed to acquire GitHub Release evidence for ${input.releaseVersion}.`,
      hint: 'Retry the GitHub request or provide an explicit release date and reason.',
      retryable: true,
      details: {
        url,
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (value === null || typeof value !== 'object') {
    throw unavailable(`GitHub Release evidence is unavailable for ${input.releaseVersion}.`);
  }

  const release = value as Record<string, unknown>;
  const publishedAt = release.published_at;
  const evidenceUrl = release.html_url;
  if (
    typeof publishedAt !== 'string' ||
    !isCalendarDate(publishedAt.slice(0, 10)) ||
    typeof evidenceUrl !== 'string'
  ) {
    throw unavailable(`GitHub Release evidence is incomplete for ${input.releaseVersion}.`);
  }

  const parsed = releaseDateEvidenceSchema.safeParse({
    source: 'github-release-published-at',
    date: publishedAt.slice(0, 10),
    evidenceUrl,
  });
  if (!parsed.success) {
    throw unavailable(`GitHub Release evidence is invalid for ${input.releaseVersion}.`);
  }
  return parsed.data;
}
