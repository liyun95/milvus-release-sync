import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { planVariables } from '../src/render/variables.js';

const fixture = (path: string) =>
  readFile(new URL('./fixtures/v2.6.20/' + path, import.meta.url), 'utf8');

const releaseTemplates = {
  milvus_release_version: '{version}',
  milvus_release_tag: '{version}',
  milvus_deb_release: '{version}',
  milvus_deb_amd64: 'milvus_{version}-1_amd64.deb',
  milvus_rpm_amd64: 'milvus_{version}-1_amd64.rpm',
  milvus_deb_arm64: 'milvus_{version}-1_arm64.deb',
  milvus_rpm_arm64: 'milvus_{version}-1_arm64.rpm',
  milvus_image: '{version}'
};

const sdkValues = {
  milvus_python_sdk_real_version: '2.6.16',
  milvus_node_sdk_real_version: '2.6.17',
  milvus_java_sdk_real_version: '2.6.22',
  milvus_go_sdk_real_version: '2.6.20',
  milvus_restful_sdk_real_version: '2.6.20',
  milvus_csharp_sdk_real_version: '2.6.4'
};

describe('Variables.json planning', () => {
  it('reproduces the exact Variables.json from commit 01a787a2', async () => {
    const [before, after] = await Promise.all([
      fixture('repo-before/site/en/Variables.json'),
      fixture('repo-after/site/en/Variables.json')
    ]);

    const result = planVariables({
      variablesJson: before,
      releaseVersion: '2.6.20',
      sdkValues,
      releaseTemplates
    });

    expect(result.after).toBe(after);
    expect(result.after.endsWith('\n')).toBe(true);
    expect(result.after.endsWith('\n\n')).toBe(false);
    expect(result.changedKeys).toEqual([
      'milvus_release_version',
      'milvus_release_tag',
      'milvus_deb_release',
      'milvus_deb_amd64',
      'milvus_rpm_amd64',
      'milvus_deb_arm64',
      'milvus_rpm_arm64',
      'milvus_go_sdk_real_version',
      'milvus_restful_sdk_real_version',
      'milvus_image'
    ]);
  });

  it('does not report unchanged independent and C# SDK values', async () => {
    const before = await fixture('repo-before/site/en/Variables.json');

    const result = planVariables({
      variablesJson: before,
      releaseVersion: '2.6.20',
      sdkValues,
      releaseTemplates
    });

    expect(result.changedKeys).not.toContain('milvus_python_sdk_real_version');
    expect(result.changedKeys).not.toContain('milvus_node_sdk_real_version');
    expect(result.changedKeys).not.toContain('milvus_java_sdk_real_version');
    expect(result.changedKeys).not.toContain('milvus_csharp_sdk_real_version');
  });
});
