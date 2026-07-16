import { RunnerError } from '../core/cli-failure.js';
import { sha256 } from '../core/hash.js';
import type { SourceEvidence } from '../core/types.js';

type LarkRunner = (args: string[]) => Promise<string>;

type LarkFetchResponse = {
  data?: {
    content?: unknown;
    document?: {
      content?: unknown;
      revision_id?: unknown;
    };
  };
};

export async function fetchLarkSource(
  locator: string,
  run: LarkRunner,
): Promise<SourceEvidence> {
  const documentId = parseDocumentId(locator);
  let response: LarkFetchResponse;

  try {
    const output = await run([
      'docs',
      '+fetch',
      '--doc',
      documentId,
      '--doc-format',
      'markdown',
      '--format',
      'json',
    ]);
    response = JSON.parse(output) as LarkFetchResponse;
  } catch (error) {
    throw new RunnerError(3, {
      type: 'authentication',
      subtype: 'lark_fetch_failed',
      message: 'Failed to fetch the Feishu source with lark-cli.',
      hint: 'Authenticate lark-cli and verify access to the document.',
      retryable: false,
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const markdown =
    response.data?.document?.content ?? response.data?.content;

  if (typeof markdown !== 'string' || markdown.length === 0) {
    throw new RunnerError(5, {
      type: 'verification',
      subtype: 'lark_content_missing',
      message: 'The Feishu response did not contain Markdown content.',
      retryable: false,
    });
  }

  const revisionId = response.data?.document?.revision_id;

  return {
    kind: 'feishu-docx',
    locator,
    documentId,
    ...(revisionId === undefined || revisionId === null
      ? {}
      : { revision: String(revisionId) }),
    rawHash: sha256(markdown),
    markdown,
  };
}

function parseDocumentId(locator: string): string {
  const documentPath = locator.match(/\/docx\/([^/?#]+)/);
  return documentPath?.[1] ?? locator;
}
