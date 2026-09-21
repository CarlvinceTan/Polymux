import {homedir as nativeHomedir} from 'node:os';

// os.homedir() consults native process environment even in a Worker. Read the
// worker-local environment explicitly so synthetic homes remain isolated.
export function homedir(): string {
  return (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || nativeHomedir();
}
