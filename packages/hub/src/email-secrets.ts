import type {StoredAccount} from "./email-config.js";

/** Runs a command with no shell. `input` is written to stdin and closed. */
export type CommandRunner = (
  command: string,
  args: string[],
  input?: string,
) => Promise<{code: number; stdout: string; stderr: string}>;

/**
 * The keychain service every FlareAI mailbox secret is filed under. Changing
 * it orphans every credential already stored, so it is a contract with the
 * user's keychain rather than a name.
 */
export const EMAIL_KEYCHAIN_SERVICE = "FlareAI Email";

export function keychainService(accountId: string): string {
  return `${EMAIL_KEYCHAIN_SERVICE}: ${accountId}`;
}

/** Which of an account's secrets is meant; one keychain entry each. */
export type SecretKind = "password" | "access-token" | "refresh-token" | "client-secret";

/**
 * The user's mailbox credentials, in the OS keychain.
 *
 * Nothing here ever passes a secret as a command-line argument — `security`
 * takes its instructions on stdin, so no password appears in the process table
 * where any other process on the machine could read it.
 */
export class EmailSecrets {
  readonly #run: CommandRunner;

  constructor(run: CommandRunner) {
    this.#run = run;
  }

  async read(accountId: string, login: string, kind: SecretKind): Promise<string | null> {
    const result = await this.#run(
      "security",
      ["-i"],
      `find-generic-password -s ${quote(keychainService(accountId))} -a ${quote(entry(login, kind))} -w\n`,
    ).catch((): null => null);
    if (!result || result.code !== 0) return null;
    // `security` prints the secret with a trailing newline and nothing else.
    const value = result.stdout.replace(/\n$/, "");
    return value || null;
  }

  async write(accountId: string, login: string, kind: SecretKind, secret: string): Promise<void> {
    const result = await this.#run(
      "security",
      ["-i"],
      `add-generic-password -U -s ${quote(keychainService(accountId))} -a ${quote(entry(login, kind))} -w ${quote(secret)}\n`,
    );
    if (result.code !== 0)
      throw new Error(
        `Could not save the mailbox credential to the keychain: ${result.stderr.trim() || `security exited ${result.code}`}`,
      );
  }

  async remove(accountId: string, login: string, kind: SecretKind): Promise<void> {
    await this.#run(
      "security",
      ["-i"],
      `delete-generic-password -s ${quote(keychainService(accountId))} -a ${quote(entry(login, kind))}\n`,
    ).catch((): undefined => undefined);
  }

  /** Every secret an account can hold, dropped together when it is deleted. */
  async removeAll(accountId: string, login: string): Promise<void> {
    for (const kind of SECRET_KINDS) await this.remove(accountId, login, kind);
  }

  /** Carries an account's secrets to a new id, for a rename. */
  async rename(fromId: string, toId: string, login: string): Promise<void> {
    for (const kind of SECRET_KINDS) {
      const secret = await this.read(fromId, login, kind);
      if (secret === null) continue;
      await this.write(toId, login, kind, secret);
      await this.remove(fromId, login, kind);
    }
  }

  /** Whether the account has anything at all filed under it. */
  async held(accountId: string, login: string): Promise<boolean> {
    for (const kind of SECRET_KINDS) if (await this.read(accountId, login, kind)) return true;
    return false;
  }
}

export const SECRET_KINDS = [
  "password",
  "access-token",
  "refresh-token",
  "client-secret",
] as const satisfies readonly SecretKind[];

/**
 * One keychain entry per secret. The account name carries the kind, because a
 * generic-password entry is keyed by service and account together and an
 * OAuth account holds two secrets at once for the same login.
 */
function entry(login: string, kind: SecretKind): string {
  return kind === "password" ? login : `${login} (${kind})`;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
