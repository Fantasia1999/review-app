#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bunCommand = process.argv[0];

function run(args: string[]): void {
  const result = spawnSync(bunCommand, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(`error: failed to run Bun: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(join(rootDir, 'node_modules'))) {
  console.log('Installing dependencies...');
  run(['install']);
}

console.log('Building client and agent...');
run(['run', 'build']);

const agentEntry = join(rootDir, 'packages', 'agent', 'dist', 'index.js');
if (!existsSync(agentEntry)) {
  console.error(`error: expected build output was not found: ${agentEntry}`);
  process.exit(1);
}

console.log('Starting review-app...');
const passthroughArgs = process.argv.slice(2);
run([agentEntry, ...passthroughArgs]);
