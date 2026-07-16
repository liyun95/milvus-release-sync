import { createTwoFilesPatch } from 'diff';

export function unifiedDiff(path: string, before: string, after: string): string {
  return createTwoFilesPatch('a/' + path, 'b/' + path, before, after, '', '', {
    context: 3
  });
}
