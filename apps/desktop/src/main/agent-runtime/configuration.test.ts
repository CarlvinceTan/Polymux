import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {
  externalAgentId,
  externalAgentEnvironment,
  importExternalConfiguration,
  inspectExternalAgentProfiles,
  managedExternalConfigurationDirectory,
} from "./configuration.js";

const CLAUDE = {
  kind: "acp" as const,
  name: "Claude Agent",
  command: "npx",
  args: ["-y", "@agentclientprotocol/claude-agent-acp"],
};

test("discovers separate Claude configurations and summarizes safe assets", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-external-profiles-"));
  const source = path.join(home, ".claude");
  const work = path.join(home, ".claude-work");
  const cwd = path.join(home, "project");
  try {
    await mkdir(path.join(source, "skills", "review"), {recursive: true});
    await mkdir(path.join(source, "plugins"), {recursive: true});
    await mkdir(path.join(source, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory"), {recursive: true});
    await mkdir(work, {recursive: true});
    await writeFile(path.join(source, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review code\n---\n");
    await writeFile(path.join(source, "settings.json"), JSON.stringify({enabledPlugins: {"context@official": true}}));
    await writeFile(path.join(source, "plugins", "installed_plugins.json"), JSON.stringify({plugins: {"design@official": []}}));
    await writeFile(path.join(source, "CLAUDE.md"), "Remember concise answers.\n");
    await writeFile(path.join(source, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory", "MEMORY.md"), "Project note\n");
    await writeFile(`${source}.json`, JSON.stringify({mcpServers: {drive: {command: "drive-mcp"}}}));
    await writeFile(path.join(source, ".credentials.json"), "secret");

    const profiles = inspectExternalAgentProfiles(CLAUDE, undefined, {home, cwd, environment: {}});
    assert.deepEqual(profiles.map((profile) => profile.directory), [source, work]);
    assert.equal(profiles[0]?.supportsSync, true);
    assert.equal(profiles[0]?.summaries.find((item) => item.kind === "skills")?.count, 1);
    assert.equal(profiles[0]?.summaries.find((item) => item.kind === "plugins")?.count, 2);
    assert.deepEqual(profiles[0]?.summaries.find((item) => item.kind === "mcp")?.items, []);
    assert.equal(profiles[0]?.summaries.find((item) => item.kind === "memory")?.count, 2);
    assert.equal(JSON.stringify(profiles).includes("credentials"), false);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("imports selected configuration without credentials or overwriting profile files", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-external-import-"));
  const source = path.join(home, ".claude");
  const profile = path.join(home, ".polymux", "profiles", "imported");
  const runtime = path.join(profile, "agents", "claude-import");
  try {
    await mkdir(path.join(source, "skills", "review"), {recursive: true});
    await mkdir(path.join(source, "plugins"), {recursive: true});
    await mkdir(path.join(profile, "skills", "review"), {recursive: true});
    await writeFile(path.join(profile, "skills", "review", "SKILL.md"), "keep mine\n");
    await writeFile(path.join(source, "skills", "review", "SKILL.md"), "external\n");
    await writeFile(path.join(source, "settings.json"), "{\"model\":\"sonnet\"}\n");
    await writeFile(path.join(source, ".credentials.json"), "secret\n");
    await writeFile(path.join(source, "CLAUDE.md"), "Use short answers.\n");
    await writeFile(`${source}.json`, JSON.stringify({mcpServers: {notion: {command: "notion-mcp"}}}));

    await importExternalConfiguration({
      runtime: CLAUDE,
      sourceDirectory: source,
      profileDirectory: profile,
      runtimeDirectory: runtime,
      sections: ["settings", "skills", "mcp", "memory"],
    });

    assert.equal(await readFile(path.join(profile, "skills", "review", "SKILL.md"), "utf8"), "keep mine\n");
    assert.equal(await readFile(path.join(runtime, "skills", "review", "SKILL.md"), "utf8"), "external\n");
    await assert.rejects(readFile(path.join(profile, "mcp.json"), "utf8"), {code: "ENOENT"});
    assert.match(await readFile(path.join(profile, "memories", "MEMORY.md"), "utf8"), /Use short answers/);
    await assert.rejects(readFile(path.join(runtime, ".credentials.json"), "utf8"), {code: "ENOENT"});
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("uses Claude's explicit configuration variable and a private HOME fallback", () => {
  const claude = externalAgentEnvironment({
    ...CLAUDE,
    registryEnvironment: {
      FAST_AGENT_MODEL: "registry-default",
      HOME: "/untrusted/home",
      SERVICE_TOKEN: "must-not-cross",
    },
  }, "/profiles/claude", "/profiles/home");
  assert.equal(claude.CLAUDE_CONFIG_DIR, "/profiles/claude");
  assert.equal(claude.HOME, "/profiles/home");
  assert.equal(claude.XDG_CONFIG_HOME, "/profiles/home/.config");
  assert.ok(claude.PATH);
  assert.equal(claude.FAST_AGENT_MODEL, "registry-default");
  assert.equal(claude.SERVICE_TOKEN, undefined);
  const generic = externalAgentEnvironment(
    {kind: "acp", name: "Example", command: "example", args: []},
    "/profiles/example",
    "/profiles/home",
  );
  assert.equal(generic.HOME, "/profiles/home");
  assert.ok(generic.npm_config_cache);
});

test("recognizes verified registry families and refuses guessed imports for unknown agents", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-agent-families-"));
  try {
    const families = [
      ["codex-acp", ".codex", "codex", true],
      ["pi-acp", path.join(".pi", "agent"), "pi", true],
      ["opencode", path.join(".config", "opencode"), "opencode", true],
      ["junie", ".junie", "junie", true],
      ["poolside", path.join(".config", "poolside"), "poolside", false],
      ["gemini", ".gemini", "gemini", true],
      ["qwen-code", ".qwen", "qwen", true],
      ["github-copilot-cli", ".copilot", "github-copilot", true],
      ["mistral-vibe", ".vibe", "mistral-vibe", true],
    ] as const;
    for (const [agentId, relative, familyId, supportsSync] of families) {
      const directory = path.join(home, relative);
      await mkdir(directory, {recursive: true});
      const runtime = {kind: "acp" as const, name: agentId, command: agentId, args: [] as string[], agentId};
      assert.equal(externalAgentId(runtime), familyId);
      const [profile] = inspectExternalAgentProfiles(runtime, undefined, {home, environment: {}});
      assert.equal(profile?.directory, directory);
      assert.equal(profile?.supportsImport, true);
      assert.equal(profile?.supportsSync, supportsSync);
    }

    const [unknown] = inspectExternalAgentProfiles(
      {kind: "acp", name: "Auggie", command: "npx", args: [], agentId: "auggie"},
      undefined,
      {home, environment: {}},
    );
    assert.equal(unknown?.directory, "");
    assert.equal(unknown?.supportsImport, false);
    assert.equal(unknown?.supportsSync, false);
    assert.match(unknown?.importUnavailableReason ?? "", /verified configuration adapter/);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("maps managed roots to the exact layout each agent reads", () => {
  assert.equal(
    managedExternalConfigurationDirectory(
      {kind: "acp", name: "Pi", command: "pi", args: [], agentId: "pi-acp"},
      "/profile/agents/pi",
      "/profile/agents/pi/home",
    ),
    "/profile/agents/pi",
  );
  assert.equal(
    managedExternalConfigurationDirectory(
      {kind: "acp", name: "Gemini", command: "gemini", args: [], agentId: "gemini"},
      "/profile/agents/gemini",
      "/profile/agents/gemini/home",
    ),
    "/profile/agents/gemini/.gemini",
  );
  assert.equal(
    managedExternalConfigurationDirectory(
      {kind: "acp", name: "Poolside", command: "pool", args: [], agentId: "poolside"},
      "/profile/agents/pool",
      "/profile/agents/pool/home",
    ),
    "/profile/agents/pool/home/.config/poolside",
  );
});

test("isolates credentials and alternate config roots while retaining required launch variables", () => {
  const previousSecret = process.env.OPENAI_API_KEY;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.OPENAI_API_KEY = "must-not-leak";
  process.env.XDG_CONFIG_HOME = "/host/config";
  try {
    const environment = externalAgentEnvironment(
      {kind: "acp", name: "OpenCode", command: "opencode", args: [], agentId: "opencode"},
      "/profile/opencode",
      "/profile/home",
    );
    assert.equal(environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.XDG_CONFIG_HOME, "/profile/home/.config");
    assert.equal(environment.OPENCODE_CONFIG_DIR, "/profile/opencode");
    assert.equal(environment.OPENCODE_CONFIG, "/profile/opencode/opencode.json");
    assert.ok(environment.PATH);
  } finally {
    if (previousSecret === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousSecret;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
  }
});

test("summarizes only Pi MCP configuration", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-agent-mcp-"));
  try {
    const pi = path.join(home, ".pi", "agent");
    const codex = path.join(home, ".codex");
    const opencode = path.join(home, ".config", "opencode");
    await mkdir(pi, {recursive: true});
    await mkdir(codex, {recursive: true});
    await mkdir(opencode, {recursive: true});
    await writeFile(path.join(pi, "mcp.json"), JSON.stringify({mcpServers: {files: {command: "pi-mcp"}}}));
    await writeFile(path.join(codex, "config.toml"), '[mcp_servers.docs]\ncommand = "docs-mcp"\n');
    await writeFile(path.join(opencode, "opencode.jsonc"), '{\n // comment\n "mcp": {"drive": {"type":"local", "command":["drive-mcp"]},},\n}\n');
    const [piProfile] = inspectExternalAgentProfiles(
      {kind: "acp", name: "Pi", command: "pi", args: [], agentId: "pi-acp"},
      pi,
      {home, environment: {}},
    );
    const [codexProfile] = inspectExternalAgentProfiles(
      {kind: "acp", name: "Codex", command: "codex", args: [], agentId: "codex-acp"},
      codex,
      {home, environment: {}},
    );
    const [opencodeProfile] = inspectExternalAgentProfiles(
      {kind: "acp", name: "OpenCode", command: "opencode", args: [], agentId: "opencode"},
      opencode,
      {home, environment: {}},
    );
    assert.deepEqual(piProfile?.summaries.find((item) => item.kind === "mcp")?.items, ["files"]);
    assert.deepEqual(codexProfile?.summaries.find((item) => item.kind === "mcp")?.items, []);
    assert.deepEqual(opencodeProfile?.summaries.find((item) => item.kind === "mcp")?.items, []);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});
