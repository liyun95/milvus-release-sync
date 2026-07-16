import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEnvironment = { ...process.env, npm_config_dry_run: 'false' };

type PackManifest = {
  filename: string;
  files: Array<{ path: string }>;
};

it(
  'packs only release files and installs a working 0.1.0 executable',
  async () => {
    const packDir = await mkdtemp(join(tmpdir(), 'milvus-release-sync-pack-'));
    const installDir = await mkdtemp(
      join(tmpdir(), 'milvus-release-sync-install-')
    );

    try {
      const packed = await execFileAsync(
        npm,
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          packDir
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: npmEnvironment,
          maxBuffer: 10 * 1024 * 1024
        }
      );
      const manifests = JSON.parse(packed.stdout) as PackManifest[];
      expect(manifests).toHaveLength(1);

      const manifest = manifests[0];
      const paths = new Set(manifest.files.map((file) => file.path));
      expect(paths.has('dist/cli/index.js')).toBe(true);
      expect(paths.has('dist/apply/apply-plan.js')).toBe(true);
      expect(paths.has('registry/sdk-sources.json')).toBe(true);
      expect(paths.has('README.md')).toBe(true);
      expect(paths.has('LICENSE')).toBe(true);
      expect(paths.has('CHANGELOG.md')).toBe(true);
      expect(paths.has('package.json')).toBe(true);
      for (const forbidden of ['src/', 'test/', '.github/', 'docs/']) {
        expect([...paths].some((path) => path.startsWith(forbidden))).toBe(false);
      }

      const tarball = join(packDir, manifest.filename);
      await execFileAsync(npm, ['init', '-y'], {
        cwd: installDir,
        encoding: 'utf8',
        env: npmEnvironment,
        maxBuffer: 10 * 1024 * 1024
      });
      await execFileAsync(
        npm,
        [
          'install',
          tarball,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund'
        ],
        {
          cwd: installDir,
          encoding: 'utf8',
          env: npmEnvironment,
          maxBuffer: 10 * 1024 * 1024
        }
      );

      const executable = join(
        installDir,
        'node_modules',
        '.bin',
        'milvus-release-sync'
      );
      const version = await execFileAsync(executable, ['--version'], {
        cwd: installDir,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      expect(version.stdout).toBe('0.1.0\n');
      expect(version.stderr).toBe('');
    } finally {
      await Promise.all([
        rm(packDir, { recursive: true, force: true }),
        rm(installDir, { recursive: true, force: true })
      ]);
    }
  },
  120_000
);
