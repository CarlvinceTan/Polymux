import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [targetArgument, ...targetArguments] = process.argv.slice(2);
const targets = {
  ios: {args: ['run', 'ios:dev', '--']},
  android: {args: ['run', 'android:dev', '--']},
  web: {args: ['run', 'dev']},
  desktop: {args: ['run', 'tauri', '--', 'dev']},
};

function usage() {
  console.log(`Usage: npm run mobile -- <target> [device]\n\nTargets:\n  ios [device]      iOS device or simulator\n  android [device]  Android device or emulator\n  web               Browser preview\n  desktop           Desktop-sized Tauri shell\n\nWith no target, this command prompts for one. Tauri prompts for the exact iOS or Android device when it is omitted.`);
}

if (targetArgument === '--help' || targetArgument === '-h' || targetArgument === 'help') {
  usage();
  process.exit(0);
}

let target = targetArgument?.toLowerCase();
if (!target) {
  if (!input.isTTY) {
    usage();
    process.exit(1);
  }
  const prompt = createInterface({input, output});
  const answer = (await prompt.question('Run Polymux Mobile on:\n  1. iOS device or simulator\n  2. Android device or emulator\n  3. Browser preview\n  4. Desktop-sized Tauri shell\n\nChoose 1-4: ')).trim();
  prompt.close();
  target = {'1': 'ios', '2': 'android', '3': 'web', '4': 'desktop'}[answer];
}

const selection = target ? targets[target] : undefined;
if (!selection) {
  console.error(`Unknown mobile target: ${targetArgument ?? target ?? ''}`);
  usage();
  process.exit(1);
}

const npmArguments = ['--prefix', 'apps/mobile', ...selection.args];
if (target === 'ios' || target === 'android') npmArguments.push(...targetArguments);
const result = spawnSync('npm', npmArguments, {cwd: root, stdio: 'inherit'});
process.exit(result.status ?? 1);
