import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { RunnerError } from '../src/core/cli-failure.js';
import {
  assertVerbatimBody,
  insertOrReplaceReleaseSection,
  renderReleaseSection
} from '../src/render/release-notes.js';
import { blocker, plannedChange, warning } from '../src/plan/findings.js';
import { unifiedDiff } from '../src/plan/diff.js';

const fixture = (path: string) =>
  readFile(new URL('./fixtures/v2.6.20/' + path, import.meta.url), 'utf8');

function extractReleaseSection(markdown: string, version: string): string {
  const start = markdown.indexOf('## v' + version + '\n');
  if (start < 0) {
    throw new Error('Missing release v' + version);
  }
  const remaining = markdown.slice(start);
  const next = remaining.slice(1).search(/\n## v\d+\.\d+\.\d+\n/);
  return next < 0 ? remaining : remaining.slice(0, next + 2);
}

const renderInput = (sourceMarkdown: string) => ({
  releaseVersion: '2.6.20',
  releaseDate: '2026-07-14',
  versions: {
    milvus: '2.6.20',
    python: '2.6.16',
    nodejs: '2.6.17',
    java: '2.6.22',
    go: '2.6.20'
  },
  sourceMarkdown
});

describe('release notes rendering', () => {
  it('reproduces the committed v2.6.20 section byte-for-byte', async () => {
    const [sourceMarkdown, committed] = await Promise.all([
      fixture('source/release-notes.remote.md'),
      fixture('repo-after/site/en/release_notes.md')
    ]);

    const section = renderReleaseSection(renderInput(sourceMarkdown));

    expect(section).toBe(extractReleaseSection(committed, '2.6.20'));
    expect(section).toContain('Release date: July 14, 2026');
    expect(section).toContain(
      '| Milvus Version | Python SDK Version | Node.js SDK Version | Java SDK Version | Go SDK Version |'
    );
    expect(section).toContain('\n### Improvements\n');
    expect(section).toContain('\n### Bug fixes\n');
  });

  it('strips an optional version heading without changing source content', () => {
    const sourceMarkdown = '## v2.6.20\n\nOpening sentence.\n\n## Improvements\n\n- Added X.\n';

    const section = renderReleaseSection(renderInput(sourceMarkdown));

    expect(section.match(/^## v2\.6\.20$/gm)).toHaveLength(1);
    expect(section).toContain('Opening sentence.\n\n### Improvements\n\n- Added X.');
  });

  it('validates verbatim source fidelity and blocks unexpected edits', async () => {
    const sourceMarkdown = await fixture('source/release-notes.remote.md');
    const section = renderReleaseSection(renderInput(sourceMarkdown));

    expect(() => assertVerbatimBody(sourceMarkdown, section)).not.toThrow();

    const edited = section.replace('named C++ thread-pool', 'renamed C++ thread-pool');
    expect(() => assertVerbatimBody(sourceMarkdown, edited)).toThrowError(
      expect.objectContaining<Partial<RunnerError>>({
        exitCode: 1,
        failure: expect.objectContaining({
          type: 'blocked',
          subtype: 'verbatim_content_mismatch'
        })
      })
    );
  });

  it('blocks extra unapproved content inserted before the approved body', () => {
    const sourceMarkdown = '## Improvements\n\n- Added X.\n';
    const section = renderReleaseSection(renderInput(sourceMarkdown));
    const injected = section.replace(
      '### Improvements',
      'Unapproved release-note text.\n\n### Improvements'
    );

    expect(() => assertVerbatimBody(sourceMarkdown, injected)).toThrowError(
      expect.objectContaining<Partial<RunnerError>>({
        exitCode: 1,
        failure: expect.objectContaining({
          type: 'blocked',
          subtype: 'verbatim_content_mismatch'
        })
      })
    );
  });

  it('ignores heading-like lines inside fenced code when normalizing source headings', () => {
    const sourceMarkdown = [
      '## Improvements',
      '',
      '- Added X.',
      '',
      '```markdown',
      '## Improvements',
      '## v2.6.19',
      '```',
      '',
      '## Bug fixes',
      '',
      '- Fixed Y.',
      ''
    ].join('\n');

    const section = renderReleaseSection(renderInput(sourceMarkdown));

    expect(section).toContain('\n### Improvements\n');
    expect(section).toContain('\n### Bug fixes\n');
    expect(section).toContain('```markdown\n## Improvements\n## v2.6.19\n```');
    expect(() => assertVerbatimBody(sourceMarkdown, section)).not.toThrow();
  });

  it('ignores release-like headings inside fenced code when replacing a section', () => {
    const localMarkdown = [
      '# Releases',
      '',
      '## v2.6.20',
      '',
      'Old content.',
      '',
      '```markdown',
      '## v2.6.19',
      'Not a release boundary.',
      '```',
      '',
      'Old trailing content.',
      '',
      '## v2.6.18',
      '',
      'Previous release.',
      ''
    ].join('\n');

    const replaced = insertOrReplaceReleaseSection({
      localMarkdown,
      releaseVersion: '2.6.20',
      section: '## v2.6.20\n\nNew content.\n'
    });

    expect(replaced).toBe(
      '# Releases\n\n## v2.6.20\n\nNew content.\n\n## v2.6.18\n\nPrevious release.\n'
    );
  });

  it('blocks a source version heading that differs from the requested release', () => {
    expect(() =>
      renderReleaseSection(
        renderInput('## v2.6.19\n\n## Improvements\n\n- Added X.\n')
      )
    ).toThrowError(
      expect.objectContaining<Partial<RunnerError>>({
        exitCode: 1,
        failure: expect.objectContaining({
          type: 'blocked',
          subtype: 'source_version_mismatch'
        })
      })
    );
  });

  it('inserts before v2.6.19 and exactly reproduces the successful commit', async () => {
    const [sourceMarkdown, before, after] = await Promise.all([
      fixture('source/release-notes.remote.md'),
      fixture('repo-before/site/en/release_notes.md'),
      fixture('repo-after/site/en/release_notes.md')
    ]);
    const section = renderReleaseSection(renderInput(sourceMarkdown));

    const inserted = insertOrReplaceReleaseSection({
      localMarkdown: before,
      releaseVersion: '2.6.20',
      section
    });

    expect(inserted).toBe(after);
    expect(inserted.indexOf('## v2.6.20')).toBeLessThan(inserted.indexOf('## v2.6.19'));
  });

  it('replaces the exact release section and remains idempotent', async () => {
    const [sourceMarkdown, after] = await Promise.all([
      fixture('source/release-notes.remote.md'),
      fixture('repo-after/site/en/release_notes.md')
    ]);
    const section = renderReleaseSection(renderInput(sourceMarkdown));

    const once = insertOrReplaceReleaseSection({
      localMarkdown: after,
      releaseVersion: '2.6.20',
      section
    });
    const twice = insertOrReplaceReleaseSection({
      localMarkdown: once,
      releaseVersion: '2.6.20',
      section
    });

    expect(once).toBe(after);
    expect(twice).toBe(after);
    expect(twice.match(/^## v2\.6\.20$/gm)).toHaveLength(1);
  });
});

describe('plan helpers', () => {
  it('creates stable finding severities', () => {
    expect(plannedChange('release_section_insert', 'Insert release section')).toEqual({
      severity: 'planned_change',
      code: 'release_section_insert',
      message: 'Insert release section'
    });
    expect(warning('unrelated_dirty', 'Unrelated file is dirty', { path: 'README.md' })).toEqual({
      severity: 'warning',
      code: 'unrelated_dirty',
      message: 'Unrelated file is dirty',
      details: { path: 'README.md' }
    });
    expect(blocker('missing_evidence', 'Evidence is missing')).toEqual({
      severity: 'blocker',
      code: 'missing_evidence',
      message: 'Evidence is missing'
    });
  });

  it('creates a three-line-context unified diff with repository paths', () => {
    const diff = unifiedDiff(
      'site/en/release_notes.md',
      'one\ntwo\nthree\nfour\nfive\n',
      'one\ntwo\nTHREE\nfour\nfive\n'
    );

    expect(diff).toContain('--- a/site/en/release_notes.md');
    expect(diff).toContain('+++ b/site/en/release_notes.md');
    expect(diff).toContain('-three');
    expect(diff).toContain('+THREE');
  });
});
