import { RunnerError } from '../core/cli-failure.js';

export type RenderReleaseInput = {
  releaseVersion: string;
  releaseDate: string;
  versions: {
    milvus: string;
    python: string;
    nodejs: string;
    java: string;
    go: string;
  };
  sourceMarkdown: string;
};

export type InsertReleaseInput = {
  localMarkdown: string;
  releaseVersion: string;
  section: string;
};

const normalizedHeadings = new Map([
  ['## Improvements', '### Improvements'],
  ['## Bug fixes', '### Bug fixes']
]);

const restoredHeadings = new Map(
  [...normalizedHeadings.entries()].map(([source, rendered]) => [rendered, source])
);

type Fence = { marker: '`' | '~'; length: number };

function lineContent(line: string): { content: string; ending: string } {
  return line.endsWith('\r')
    ? { content: line.slice(0, -1), ending: '\r' }
    : { content: line, ending: '' };
}

function openingFence(line: string): Fence | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (match === null) {
    return undefined;
  }
  return { marker: match[1][0] as Fence['marker'], length: match[1].length };
}

function closesFence(line: string, fence: Fence): boolean {
  const marker = fence.marker === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${marker}{${fence.length},}[ \\t]*$`).test(line);
}

function transformOutsideFences(
  lines: string[],
  transform: (line: string) => string
): string[] {
  let fence: Fence | undefined;

  return lines.map((line) => {
    const { content, ending } = lineContent(line);
    if (fence !== undefined) {
      if (closesFence(content, fence)) {
        fence = undefined;
      }
      return line;
    }

    fence = openingFence(content);
    return fence === undefined ? transform(content) + ending : line;
  });
}

function blocked(subtype: string, message: string): RunnerError {
  return new RunnerError(1, {
    type: 'blocked',
    subtype,
    message,
    retryable: false
  });
}

function sourceBodyLines(sourceMarkdown: string, releaseVersion?: string): string[] {
  const lines = sourceMarkdown.split('\n');

  while (lines.at(-1) === '') {
    lines.pop();
  }
  while (lines[0] === '') {
    lines.shift();
  }

  const versionHeading = /^## v(\d+\.\d+\.\d+)$/.exec(lines[0] ?? '');
  if (versionHeading !== null) {
    if (releaseVersion !== undefined && versionHeading[1] !== releaseVersion) {
      throw blocked(
        'source_version_mismatch',
        `Approved source is for v${versionHeading[1]}, not v${releaseVersion}.`
      );
    }
    lines.shift();
    while (lines[0] === '') {
      lines.shift();
    }
  }

  return lines;
}

function renderBodyLines(sourceMarkdown: string, releaseVersion: string): string[] {
  return transformOutsideFences(
    sourceBodyLines(sourceMarkdown, releaseVersion),
    (line) => normalizedHeadings.get(line) ?? line
  );
}

function renderTable(versions: RenderReleaseInput['versions']): string[] {
  const headers = [
    'Milvus Version',
    'Python SDK Version',
    'Node.js SDK Version',
    'Java SDK Version',
    'Go SDK Version'
  ];
  const values = [
    versions.milvus,
    versions.python,
    versions.nodejs,
    versions.java,
    versions.go
  ];
  const row = (cells: string[], fill: string) =>
    '| ' +
    cells
      .map((cell, index) => cell.padEnd(headers[index].length, fill))
      .join(' | ') +
    ' |';

  return [row(headers, ' '), row(headers.map(() => ''), '-'), row(values, ' ')];
}

function formatReleaseDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(date + 'T00:00:00Z'));
}

export function renderReleaseSection(input: RenderReleaseInput): string {
  return [
    '## v' + input.releaseVersion,
    '',
    'Release date: ' + formatReleaseDate(input.releaseDate),
    '',
    ...renderTable(input.versions),
    '',
    ...renderBodyLines(input.sourceMarkdown, input.releaseVersion),
    '',
    ''
  ].join('\n');
}

export function assertVerbatimBody(sourceMarkdown: string, renderedSection: string): void {
  const renderedLines = renderedSection.split('\n');

  while (renderedLines.at(-1) === '') {
    renderedLines.pop();
  }

  const renderedVersion = /^## v(\d+\.\d+\.\d+)$/.exec(renderedLines[0] ?? '')?.[1];
  const expected = sourceBodyLines(sourceMarkdown, renderedVersion);
  const actual = transformOutsideFences(
    renderedLines.slice(8),
    (line) => restoredHeadings.get(line) ?? line
  );

  if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) {
    throw blocked(
      'verbatim_content_mismatch',
      'Rendered release notes changed approved source content.'
    );
  }
}

function normalizeSectionSpacing(section: string): string {
  return section.replace(/\n+$/, '') + '\n\n';
}

function releaseHeadings(markdown: string): Array<{ version: string; index: number }> {
  const headings: Array<{ version: string; index: number }> = [];
  const lines = markdown.split('\n');
  let fence: Fence | undefined;
  let index = 0;

  for (const line of lines) {
    const { content } = lineContent(line);
    if (fence !== undefined) {
      if (closesFence(content, fence)) {
        fence = undefined;
      }
    } else {
      fence = openingFence(content);
      if (fence === undefined) {
        const heading = /^## v(\d+\.\d+\.\d+)$/.exec(content);
        if (heading !== null) {
          headings.push({ version: heading[1], index });
        }
      }
    }
    index += line.length + 1;
  }

  return headings;
}

export function insertOrReplaceReleaseSection(input: InsertReleaseInput): string {
  const section = normalizeSectionSpacing(input.section);
  const headings = releaseHeadings(input.localMarkdown);
  const existingIndex = headings.findIndex((heading) => heading.version === input.releaseVersion);

  if (existingIndex >= 0) {
    const start = headings[existingIndex].index;
    const end = headings[existingIndex + 1]?.index ?? input.localMarkdown.length;
    return input.localMarkdown.slice(0, start) + section + input.localMarkdown.slice(end);
  }

  if (headings[0] !== undefined) {
    const insertionPoint = headings[0].index;
    return (
      input.localMarkdown.slice(0, insertionPoint) +
      section +
      input.localMarkdown.slice(insertionPoint)
    );
  }

  const prefix = input.localMarkdown.replace(/\n+$/, '');
  return (prefix === '' ? '' : prefix + '\n\n') + section;
}
