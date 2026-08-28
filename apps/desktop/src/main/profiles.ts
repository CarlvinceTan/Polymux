import {randomUUID} from "node:crypto";
import {cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {cp, mkdir, rm} from "node:fs/promises";
import path from "node:path";
import type {JsonValue, Storage} from "@polymux/storage";

export interface ProfileRecord { id: string; name: string; isDefault: boolean; }
export interface ProfilesSnapshot { activeId: string; profiles: ProfileRecord[]; }

const DEFAULT_PROFILE: ProfileRecord = {id: "default", name: "Default Profile", isDefault: true};
const REGISTRY_KEY = "profiles.registry";
const ACTIVE_KEY = "profiles.active";
const DEFAULT_KEY = "profiles.default";
const CONFIG_LAYOUT_MIGRATION_KEY = "profiles.config-layout-v1";
const PROFILE_PREFERENCE_KEYS = new Set([
  "model", "model-roles", "agent-runtime", "custom-providers", "mcp-enabled",
  "mcp-capabilities", "skill-enabled", "plugin-enabled",
]);

export class ProfileManager {
  constructor(
    private readonly storage: Storage,
    private readonly dataDirectory: string,
    private readonly defaultConfigDirectory = dataDirectory,
    private readonly profilesDirectory = path.join(defaultConfigDirectory, "profiles"),
  ) {
    mkdirSync(this.profilesDirectory, {recursive: true});
    mkdirSync(this.directory(DEFAULT_PROFILE.id), {recursive: true});
    if (this.storage.getPreference(CONFIG_LAYOUT_MIGRATION_KEY)?.value !== true) {
      this.migrateProfileDirectories();
      this.storage.setPreference(CONFIG_LAYOUT_MIGRATION_KEY, true);
    } else if (!existsSync(path.join(this.profilesDirectory, "index.json"))) {
      this.writeIndex(this.snapshot());
    }
  }

  snapshot(): ProfilesSnapshot {
    const stored = this.storage.getPreference(REGISTRY_KEY)?.value;
    const records: Array<Record<string, JsonValue> & {id: string; name: string}> = Array.isArray(stored)
      ? stored.filter(validProfile)
      : [];
    const savedDefault = records.find(profile => profile.id === DEFAULT_PROFILE.id);
    const defaultProfile = savedDefault
      ? {...DEFAULT_PROFILE, name: savedDefault.name}
      : DEFAULT_PROFILE;
    const storedProfiles = [
      defaultProfile,
      ...records.filter(profile => profile.id !== DEFAULT_PROFILE.id)
        .map(({id, name}) => ({id, name, isDefault: false})),
    ];
    const requestedDefault = this.storage.getPreference(DEFAULT_KEY)?.value;
    const defaultId = typeof requestedDefault === "string" && storedProfiles.some(profile => profile.id === requestedDefault)
      ? requestedDefault : DEFAULT_PROFILE.id;
    const profiles = storedProfiles.map(profile => ({...profile, isDefault: profile.id === defaultId}));
    const requested = this.storage.getPreference(ACTIVE_KEY)?.value;
    const activeId = typeof requested === "string" && profiles.some(profile => profile.id === requested)
      ? requested : DEFAULT_PROFILE.id;
    return {activeId, profiles};
  }

  key(key: string, profileId = this.snapshot().activeId): string {
    return profileId === DEFAULT_PROFILE.id ? key : `profile:${profileId}:${key}`;
  }

  preference(key: string, profileId = this.snapshot().activeId): {value: JsonValue} | null {
    const settings = this.readSettings(profileId);
    if (key in settings) return {value: settings[key]};
    const legacy = this.storage.getPreference(this.key(key, profileId));
    if (!legacy) return null;
    this.setPreference(key, legacy.value, profileId);
    return {value: legacy.value};
  }

  setPreference(key: string, value: JsonValue, profileId = this.snapshot().activeId): void {
    const settings = this.readSettings(profileId);
    settings[key] = value;
    const file = path.join(this.directory(profileId), "settings.json");
    mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(settings, null, 2), {encoding: "utf8", mode: 0o600});
    renameSync(temporary, file);
  }

  directory(profileId = this.snapshot().activeId): string {
    return path.join(this.profilesDirectory, profileId);
  }

  create(name: string): ProfilesSnapshot {
    const snapshot = this.snapshot();
    const profileName = requestedName(name);
    assertNameAvailable(profileName, snapshot.profiles);
    const profile = {id: randomUUID(), name: profileName, isDefault: false};
    this.save([...snapshot.profiles, profile]);
    return this.snapshot();
  }

  rename(id: string, name: string): ProfilesSnapshot {
    const snapshot = this.snapshot();
    if (!snapshot.profiles.some(profile => profile.id === id)) throw new Error("Unknown profile");
    const profileName = requestedName(name);
    assertNameAvailable(profileName, snapshot.profiles.filter(profile => profile.id !== id));
    const profiles = snapshot.profiles.map(profile => profile.id === id
      ? {...profile, name: profileName}
      : profile);
    this.save(profiles);
    return this.snapshot();
  }

  async duplicate(id: string): Promise<ProfilesSnapshot> {
    const snapshot = this.snapshot();
    const source = snapshot.profiles.find(profile => profile.id === id);
    if (!source) throw new Error("Unknown profile");
    const duplicate = {id: randomUUID(), name: uniqueName(`${source.name} copy`, snapshot.profiles), isDefault: false};
    const prefix = id === DEFAULT_PROFILE.id ? "" : `profile:${id}:`;
    for (const preference of this.storage.listPreferences()) {
      if (id === DEFAULT_PROFILE.id) {
        if (preference.key.startsWith("profile:") || preference.key.startsWith("profiles.")) continue;
      } else if (!preference.key.startsWith(prefix)) continue;
      const bareKey = id === DEFAULT_PROFILE.id ? preference.key : preference.key.slice(prefix.length);
      if (!PROFILE_PREFERENCE_KEYS.has(bareKey)) continue;
      this.setPreference(bareKey, preference.value, id);
    }
    const destination = this.directory(duplicate.id);
    await mkdir(destination, {recursive: true});
    await cp(this.directory(id), destination, {recursive: true, force: false}).catch(() => {});
    this.save([...snapshot.profiles, duplicate]);
    return this.snapshot();
  }

  async remove(id: string): Promise<ProfilesSnapshot> {
    const snapshot = this.snapshot();
    const profile = snapshot.profiles.find(profile => profile.id === id);
    if (!profile) throw new Error("Unknown profile");
    if (profile.isDefault || id === DEFAULT_PROFILE.id) throw new Error("The default profile cannot be deleted");
    this.save(snapshot.profiles.filter(profile => profile.id !== id));
    if (snapshot.activeId === id) this.storage.setPreference(ACTIVE_KEY, snapshot.profiles.find(profile => profile.isDefault)!.id);
    await rm(this.directory(id), {recursive: true, force: true});
    const result = this.snapshot();
    this.writeIndex(result);
    return result;
  }

  select(id: string): ProfilesSnapshot {
    if (!this.snapshot().profiles.some(profile => profile.id === id)) throw new Error("Unknown profile");
    this.storage.setPreference(ACTIVE_KEY, id);
    const snapshot = this.snapshot();
    this.writeIndex(snapshot);
    return snapshot;
  }

  setDefault(id: string): ProfilesSnapshot {
    if (!this.snapshot().profiles.some(profile => profile.id === id)) throw new Error("Unknown profile");
    this.storage.setPreference(DEFAULT_KEY, id);
    const snapshot = this.snapshot();
    this.writeIndex(snapshot);
    return snapshot;
  }

  selectDefault(): ProfilesSnapshot {
    const profile = this.snapshot().profiles.find(candidate => candidate.isDefault)!;
    return this.select(profile.id);
  }

  private save(profiles: ProfileRecord[]): void {
    this.storage.setPreference(REGISTRY_KEY, profiles as unknown as JsonValue);
    this.writeIndex(this.snapshot());
  }

  private writeIndex(snapshot: ProfilesSnapshot): void {
    mkdirSync(this.profilesDirectory, {recursive: true});
    const file = path.join(this.profilesDirectory, "index.json");
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(snapshot, null, 2), {encoding: "utf8", mode: 0o600});
    renameSync(temporary, file);
  }

  private readSettings(profileId: string): Record<string, JsonValue> {
    const file = path.join(this.directory(profileId), "settings.json");
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, JsonValue>
        : {};
    } catch { return {}; }
  }

  /**
   * Older builds split profile state between Electron userData and ~/.polymux.
   * Copy the default into its own directory and move named profile directories
   * once, preserving the old default files as a recoverable fallback.
   */
  private migrateProfileDirectories(): void {
    const defaultDirectory = this.directory(DEFAULT_PROFILE.id);
    for (const file of ["credentials.json", "api-keys.json"]) {
      const source = path.join(this.dataDirectory, file);
      const destination = path.join(defaultDirectory, file);
      if (!existsSync(destination) && existsSync(source)) cpSync(source, destination, {errorOnExist: false});
    }
    const defaultAssets = [["mcp.json"], ["skills"]] as const;
    for (const [name] of defaultAssets) {
      const source = path.join(this.defaultConfigDirectory, name);
      const destination = path.join(defaultDirectory, name);
      if (!existsSync(destination) && existsSync(source))
        cpSync(source, destination, {recursive: true, errorOnExist: false});
    }
    // Some early builds kept MCP configuration in Electron userData rather
    // than ~/.polymux. That global configuration belonged to the only profile
    // those builds had: the default. Never seed it into whichever named
    // profile happens to be active during a later launch.
    const legacyMcp = path.join(this.dataDirectory, "mcp.json");
    const defaultMcp = path.join(defaultDirectory, "mcp.json");
    if (!existsSync(defaultMcp) && existsSync(legacyMcp))
      cpSync(legacyMcp, defaultMcp, {errorOnExist: false});
    const legacyRoot = path.join(this.dataDirectory, "profiles");
    if (path.resolve(legacyRoot) !== path.resolve(this.profilesDirectory) && existsSync(legacyRoot)) {
      for (const profile of this.snapshot().profiles) {
        if (profile.id === DEFAULT_PROFILE.id) continue;
        const source = path.join(legacyRoot, profile.id);
        const destination = this.directory(profile.id);
        if (!existsSync(source) || existsSync(destination)) continue;
        try { renameSync(source, destination); }
        catch { cpSync(source, destination, {recursive: true, errorOnExist: false}); }
      }
    }
    this.writeIndex(this.snapshot());
  }
}

function validProfile(value: unknown): value is Record<string, JsonValue> & {id: string; name: string} {
  return !!value && typeof value === "object" && typeof (value as any).id === "string" && typeof (value as any).name === "string";
}


function uniqueName(value: string, profiles: ProfileRecord[]): string {
  const base = requestedName(value);
  const names = new Set(profiles.map(profile => profile.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix++;
  return `${base} ${suffix}`;
}

function requestedName(value: string): string {
  return value.trim() || "New profile";
}

function assertNameAvailable(name: string, profiles: ProfileRecord[]): void {
  if (profiles.some(profile => profile.name.localeCompare(name, undefined, {sensitivity: "accent"}) === 0)) {
    throw new Error("A profile with this name already exists.");
  }
}
