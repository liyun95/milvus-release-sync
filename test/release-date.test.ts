import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveReleaseDate } from '../src/evidence/release-date.js';

describe('resolveReleaseDate', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('records an explicit date and its required reason without calling GitHub', async () => {
    const fetchJson = vi.fn();

    await expect(
      resolveReleaseDate({
        releaseVersion: '2.6.20',
        explicitDate: '2026-07-14',
        explicitReason: 'GitHub Release publication is delayed.',
        fetchJson,
      }),
    ).resolves.toEqual({
      source: 'explicit',
      date: '2026-07-14',
      reason: 'GitHub Release publication is delayed.',
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('rejects an explicit date without a recorded reason', async () => {
    await expect(
      resolveReleaseDate({
        releaseVersion: '2.6.20',
        explicitDate: '2026-07-14',
      }),
    ).rejects.toMatchObject({
      exitCode: 4,
      failure: { type: 'external', subtype: 'release_date_unavailable' },
    });
  });

  it('resolves the calendar date from the exact GitHub Release published_at', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      published_at: '2026-07-14T12:00:00Z',
      html_url: 'https://github.com/milvus-io/milvus/releases/tag/v2.6.20',
    });

    await expect(
      resolveReleaseDate({ releaseVersion: '2.6.20', fetchJson }),
    ).resolves.toEqual({
      source: 'github-release-published-at',
      date: '2026-07-14',
      evidenceUrl:
        'https://github.com/milvus-io/milvus/releases/tag/v2.6.20',
    });
    expect(fetchJson).toHaveBeenCalledWith(
      'https://api.github.com/repos/milvus-io/milvus/releases/tags/v2.6.20',
    );
  });

  it('maps GitHub acquisition failures to a retryable external error', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('rate limited'));

    await expect(
      resolveReleaseDate({ releaseVersion: '2.6.20', fetchJson }),
    ).rejects.toMatchObject({
      exitCode: 4,
      failure: {
        type: 'external',
        subtype: 'github_release_failed',
        retryable: true,
      },
    });
  });

  it('rejects GitHub Release data without published_at evidence', async () => {
    await expect(
      resolveReleaseDate({
        releaseVersion: '2.6.20',
        fetchJson: async () => ({ html_url: 'https://github.com/milvus-io/milvus' }),
      }),
    ).rejects.toMatchObject({
      exitCode: 4,
      failure: { subtype: 'release_date_unavailable', retryable: false },
    });
  });

  it('sends a GitHub token only when one is configured', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        published_at: '2026-07-14T12:00:00Z',
        html_url: 'https://github.com/milvus-io/milvus/releases/tag/v2.6.20',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await resolveReleaseDate({ releaseVersion: '2.6.20' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/milvus-io/milvus/releases/tags/v2.6.20',
      { headers: { Authorization: 'Bearer test-token' } },
    );

    delete process.env.GITHUB_TOKEN;
    fetchMock.mockClear();
    await resolveReleaseDate({ releaseVersion: '2.6.20' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/milvus-io/milvus/releases/tags/v2.6.20',
      { headers: {} },
    );
  });
});
