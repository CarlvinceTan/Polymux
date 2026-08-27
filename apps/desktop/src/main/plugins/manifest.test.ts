import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pluginMcpServers, pluginViews, readContributions, readManifest } from "./manifest.js";

function plugin(build: (root: string) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), "polymux-plugin-test-"));
  build(root);
  return root;
}

function write(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

test("falls back to the folder name when there is no manifest", () => {
  const root = plugin(() => {});
  try {
    assert.equal(readManifest(root).name, path.basename(root));
    assert.equal(readManifest(root).description, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reads the manifest, flattening an author object", () => {
  const root = plugin((directory) =>
    write(
      path.join(directory, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "notes",
        description: " Takes notes ",
        version: "0.3.1",
        author: { name: "Ada", email: "ada@example.com" },
        homepage: "https://example.com",
      }),
    ),
  );
  try {
    assert.deepEqual(readManifest(root), {
      name: "notes",
      description: "Takes notes",
      version: "0.3.1",
      author: "Ada",
      homepage: "https://example.com",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("counts what it has no surface for and names what it runs", () => {
  const root = plugin((directory) => {
    write(
      path.join(directory, "skills", "summarise", "SKILL.md"),
      "---\nname: summarise\ndescription: Summarises\n---\nBody\n",
    );
    write(
      path.join(directory, "skills", "expand", "SKILL.md"),
      "---\nname: expand\ndescription: Expands\n---\nBody\n",
    );
    write(path.join(directory, "commands", "review.md"), "# review");
    write(path.join(directory, "commands", "nested", "ship.md"), "# ship");
    write(path.join(directory, "agents", "critic.md"), "# critic");
    write(
      path.join(directory, "hooks", "hooks.json"),
      JSON.stringify({ hooks: { PreToolUse: [{}, {}], Stop: [{}] } }),
    );
    write(
      path.join(directory, ".mcp.json"),
      JSON.stringify({ mcpServers: { notes: { command: "node", args: ["server.js"] } } }),
    );
  });
  try {
    assert.deepEqual(readContributions(root), {
      skills: ["expand", "summarise"],
      mcpServers: ["notes"],
      views: [],
      commands: 2,
      agents: 1,
      hooks: 3,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovers bundled workspace views and keeps their entry inside the view folder", () => {
  const root = plugin((directory) => {
    write(path.join(directory, "views", "dashboard", "view.json"), JSON.stringify({name: "Dashboard", description: "Project overview", entry: "index.html"}));
    write(path.join(directory, "views", "dashboard", "index.html"), "<h1>Dashboard</h1>");
    write(path.join(directory, "views", "unsafe", "view.json"), JSON.stringify({entry: "../../outside.html"}));
  });
  try {
    assert.deepEqual(pluginViews(root, "market/plugin"), [{
      id: "market/plugin/dashboard",
      pluginId: "market/plugin",
      name: "Dashboard",
      description: "Project overview",
      entry: path.join(root, "views", "dashboard", "index.html"),
    }]);
    assert.deepEqual(readContributions(root).views, ["Dashboard"]);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("resolves ${CLAUDE_PLUGIN_ROOT} to where the plugin landed", () => {
  const root = plugin((directory) =>
    write(
      path.join(directory, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          notes: {
            command: "node",
            args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
            cwd: "$CLAUDE_PLUGIN_ROOT",
            env: { DATA: "${CLAUDE_PLUGIN_ROOT}/data" },
          },
        },
      }),
    ),
  );
  try {
    const [server] = pluginMcpServers(root);
    assert.ok(server && server.transport === "stdio");
    assert.deepEqual(server.args, [path.join(root, "server.js")]);
    assert.equal(server.cwd, root);
    assert.deepEqual(server.env, { DATA: path.join(root, "data") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed .mcp.json costs the plugin its servers, not the read", () => {
  const root = plugin((directory) => write(path.join(directory, ".mcp.json"), "{ nope"));
  try {
    assert.deepEqual(pluginMcpServers(root), []);
    assert.deepEqual(readContributions(root).mcpServers, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
