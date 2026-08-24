import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('./compiled-launch-identity.sh', import.meta.url));

function zsh(expression, ...args) {
  return execFileSync('/bin/zsh', ['-c', `source "$1"; shift; ${expression}`, 'test', helper, ...args], {encoding: 'utf8'}).trim();
}

test('recognises only an exact compiled route argument', () => {
  assert.equal(zsh('compiled_args_contain "$1" "${@:2}" && print yes || print no', '--polymux-background', '--args', '--polymux-background', '--remote-debugging-port=9334'), 'yes');
  assert.equal(zsh('compiled_args_contain "$1" "${@:2}" && print yes || print no', 'polymux-background', '--args', '--polymux-background'), 'no');
});

test('returns only numeric bundle PIDs absent from the pre-launch snapshot', () => {
  assert.equal(zsh('new_csv_pids "$1" "$2"', '100,200', '100,200,301,302'), '301,302');
  assert.equal(zsh('new_csv_pids "$1" "$2"', '', '401,bad,402'), '401,402');
  assert.equal(zsh('new_csv_pids "$1" "$2"', '100,200', '100,200'), '');
});

test('accepts exactly one new bundle PID and rejects ambiguous launches', () => {
  assert.equal(zsh('unique_new_csv_pid "$1" "$2" || print blocked', '100,200', '100,200,301'), '301');
  assert.equal(zsh('unique_new_csv_pid "$1" "$2" || print blocked', '100,200', '100,200'), 'blocked');
  assert.equal(zsh('unique_new_csv_pid "$1" "$2" || print blocked', '100,200', '100,200,301,302'), 'blocked');
});
