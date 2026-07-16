#!/usr/bin/env node

import { Command, CommanderError } from 'commander';

import {
  RunnerError,
  normalizeFailure,
} from '../core/cli-failure.js';
import { printFailure, type OutputFormat } from './output.js';

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
  .option(...formatOption)
  .action(placeholder);

program
  .command('approve <task-dir>')
  .description('Approve a release synchronization plan.')
  .requiredOption('--plan-hash <hash>')
  .requiredOption('--by <approver>')
  .option(...formatOption)
  .action(placeholder);

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
  .action(placeholder);

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
