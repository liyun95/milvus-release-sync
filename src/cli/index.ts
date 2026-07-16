#!/usr/bin/env node

import { Command, CommanderError } from 'commander';

import { approvePlan } from '../approval/approval.js';
import {
  RunnerError,
  normalizeFailure,
} from '../core/cli-failure.js';
import { buildPlan } from '../plan/build-plan.js';
import { getStatus } from '../status/status.js';
import { printFailure, printSuccess, type OutputFormat } from './output.js';

const program = new Command()
  .name('milvus-release-sync')
  .description('Plan and apply auditable Milvus release metadata updates.')
  .version('0.1.0')
  .addHelpCommand(false)
  .exitOverride()
  .configureOutput({ writeErr: () => undefined });

const formatOption = ['--format <format>', 'output format', 'pretty'] as const;

program
  .command('plan')
  .description('Create an auditable release synchronization plan.')
  .requiredOption('--release-version <version>')
  .requiredOption('--release-line <line>')
  .requiredOption('--source <source>')
  .requiredOption('--repo <path>')
  .requiredOption('--base <ref>')
  .requiredOption('--task-dir <path>')
  .option('--release-date <date>')
  .option('--release-date-reason <reason>')
  .option('--sdk-evidence <path>')
  .option(...formatOption)
  .action(async (options: PlanOptions) => {
    const format = parseOutputFormat(options.format);
    const { plan } = await buildPlan({
      releaseVersion: options.releaseVersion,
      releaseLine: options.releaseLine,
      sourceLocator: options.source,
      repoPath: options.repo,
      baseRef: options.base,
      taskDir: options.taskDir,
      explicitReleaseDate: options.releaseDate,
      explicitReleaseDateReason: options.releaseDateReason,
      sdkEvidencePath: options.sdkEvidence,
    });
    const blocked = plan.findings.some(
      (finding) => finding.severity === 'blocker',
    );

    printSuccess(
      {
        ok: true,
        command: 'plan',
        taskDir: options.taskDir,
        planHash: plan.planHash,
        blocked,
        findings: plan.findings,
        files: plan.files.map((file) => ({
          path: file.path,
          beforeHash: file.beforeHash,
          afterHash: file.afterHash,
          diff: file.diff,
        })),
      },
      format,
    );
    if (blocked) {
      process.exitCode = 1;
    }
  });

program
  .command('approve <task-dir>')
  .description('Approve a release synchronization plan.')
  .requiredOption('--plan-hash <hash>')
  .requiredOption('--by <approver>')
  .option(...formatOption)
  .action(async (taskDir: string, options: ApproveOptions) => {
    const format = parseOutputFormat(options.format);
    const approval = await approvePlan({
      taskDir,
      planHash: options.planHash,
      approvedBy: options.by,
    });
    printSuccess({ ok: true, command: 'approve', approval }, format);
  });

program
  .command('apply <task-dir>')
  .description('Apply or preview an approved release synchronization plan.')
  .option('--write')
  .option(...formatOption)
  .action(placeholder);

program
  .command('status <task-dir>')
  .description('Show the current release synchronization task status.')
  .option(...formatOption)
  .action(async (taskDir: string, options: StatusOptions) => {
    const format = parseOutputFormat(options.format);
    const result = await getStatus(taskDir);
    printSuccess({ ok: true, command: 'status', ...result }, format);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const failure =
      error instanceof CommanderError
        ? invalidArguments(error.message)
        : normalizeFailure(error);

    printFailure({ ok: false, error: failure.failure }, outputFormat(process.argv));
    process.exitCode = failure.exitCode;
  }
}

function placeholder(): never {
  throw invalidArguments('Command is not implemented yet.');
}

type PlanOptions = {
  releaseVersion: string;
  releaseLine: string;
  source: string;
  repo: string;
  base: string;
  taskDir: string;
  releaseDate?: string;
  releaseDateReason?: string;
  sdkEvidence?: string;
  format: string;
};

type ApproveOptions = {
  planHash: string;
  by: string;
  format: string;
};

type StatusOptions = {
  format: string;
};

function invalidArguments(message: string): RunnerError {
  return new RunnerError(2, {
    type: 'validation',
    subtype: 'invalid_arguments',
    message,
    retryable: false,
  });
}

function outputFormat(argv: string[]): OutputFormat {
  return argv.some(
    (argument, index) =>
      argument === '--format=json' ||
      (argument === '--format' && argv[index + 1] === 'json'),
  )
    ? 'json'
    : 'pretty';
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === 'pretty' || value === 'json') {
    return value;
  }
  throw invalidArguments('Output format must be pretty or json.');
}
