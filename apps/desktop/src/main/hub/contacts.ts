import {permissionUsagePlist} from "../system/permission-usage.js";
import {SwiftHelper} from "../system/swift-helper.js";

export interface ContactIdentity { name: string; aliases: string[]; phones: string[] }
export interface ContactLookupResult { status: string; matches: ContactIdentity[] }

export class ContactLookup {
  readonly #helper: SwiftHelper;
  constructor(options: {sourcePath: string; cacheDirectory: string}) {
    this.#helper = new SwiftHelper({
      name: "contacts", sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory, infoPlist: permissionUsagePlist(),
    });
  }
  async find(alias: string): Promise<ContactLookupResult> {
    if (process.platform !== "darwin") return {status: "unavailable", matches: []};
    try {
      const parsed = JSON.parse(await this.#helper.run([alias], 10_000)) as Partial<ContactLookupResult>;
      return {
        status: typeof parsed.status === "string" ? parsed.status : "unknown",
        matches: Array.isArray(parsed.matches)
          ? parsed.matches.filter((match): match is ContactIdentity =>
              typeof match?.name === "string" && Array.isArray(match.aliases) && Array.isArray(match.phones))
          : [],
      };
    } catch { return {status: "unavailable", matches: []}; }
  }
}
