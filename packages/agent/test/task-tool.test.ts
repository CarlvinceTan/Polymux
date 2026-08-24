import assert from "node:assert/strict";
import test from "node:test";
import { continuationDispatchError, createTaskTool, dependentDispatchError, type SubagentRequest } from "../src/subagents/task-tool.js";
import { SubagentFleet } from "../src/subagents/fleet.js";

const context = {} as Parameters<ReturnType<typeof createTaskTool>["execute"]>[1];

test("coordination mode expresses independent and dependent work", async () => {
  const requests: SubagentRequest[] = [];
  const tool = createTaskTool(async (request) => {
    requests.push(request);
    return { name: `subagent_${requests.length}` };
  }, { capabilityRouting: true });

  await tool.execute({
    description: "Independent email",
    prompt: "Read personal evidence",
    coordination: "independent",
  }, context);
  await tool.execute({
    description: "Dependent action",
    prompt: "Prepare the resolved item",
    coordination: "dependent",
    depends_on: "subagent_1",
  }, context);

  assert.deepEqual(requests.map(({ coordination }) => coordination), [
    "independent",
    "dependent",
  ]);
  assert.ok(requests.every((request) => request.strictContinuation === true));
  const properties = tool.parameters.properties as Record<string, unknown>;
  assert.ok(properties.coordination);
  assert.equal(properties.ledger, undefined);
  assert.ok(properties.depends_on);
  assert.match(
    (properties.skill_names as { description?: string }).description ?? "",
    /Native ComputerHistory recovery/,
  );
  assert.ok(Array.isArray(tool.parameters.required));
  assert.ok(tool.parameters.required.includes("tool_groups"));
  assert.ok(Array.isArray(tool.parameters.required) && tool.parameters.required.includes("coordination"));
});

test("task preserves an explicit empty skill route", async () => {
  let captured: SubagentRequest | undefined;
  const tool = createTaskTool(async (request) => {
    captured = request;
    return { name: "subagent_1" };
  }, { capabilityRouting: true });

  await tool.execute({
    description: "Native tools only",
    prompt: "Use the routed native capability",
    coordination: "independent",
    tool_groups: ["email-read"],
    skill_names: [],
  }, context);

  assert.deepEqual(captured?.skillNames, []);
});

test("a coordinator's broad all route is narrowed when the task itself is unambiguously read-only", async () => {
  let captured: SubagentRequest | undefined;
  const task = createTaskTool(async (request) => {
    captured = request;
    return {name: "subagent_1"};
  }, {capabilityRouting: true});
  await task.execute({
    description: "Verify current application requirements",
    prompt: "Read official web sources and email correspondence only; do not send, submit, or modify anything.",
    coordination: "independent",
    tool_groups: ["all"],
  }, context);
  assert.deepEqual(captured?.toolGroups, ["browser-research", "email-triage"]);
});

test("a broad all route stays lossless for action and ambiguous work", async () => {
  const captured: SubagentRequest[] = [];
  const task = createTaskTool(async (request) => {
    captured.push(request);
    return {name: `subagent_${captured.length}`};
  }, {capabilityRouting: true});
  await task.execute({
    description: "Prepare the application",
    prompt: "Open the form and fill the verified fields, but do not submit.",
    coordination: "independent",
    tool_groups: ["all"],
  }, context);
  await task.execute({
    description: "Handle this",
    prompt: "Work out what is needed.",
    coordination: "independent",
    tool_groups: ["all"],
  }, context);
  assert.deepEqual(captured.map((request) => request.toolGroups), [["all"], ["all"]]);
});

test("bounded native read routes retain the email router for account coverage", async () => {
  const requests: SubagentRequest[] = [];
  const tool = createTaskTool(async (request) => {
    requests.push(request);
    return {name: `subagent_${requests.length}`};
  }, {capabilityRouting: true});

  const result = await tool.execute({
    description: "Read native sources",
    prompt: "Check public and personal evidence",
    coordination: "independent",
    tool_groups: ["browser-research", "email-triage", "messages-read"],
    skill_names: ["computer-use", "hub-use", "travel-planner"],
  }, context);
  await tool.execute({
    description: "Interactive browser work",
    prompt: "Use the browser workflow",
    coordination: "independent",
    tool_groups: ["browser"],
    skill_names: ["computer-use"],
  }, context);

  assert.deepEqual(requests[0]?.skillNames, ["computer-use", "hub-use", "travel-planner"]);
  assert.deepEqual(requests[1]?.skillNames, ["computer-use"]);
  assert.deepEqual((result.metadata as {effectiveRoute?: unknown} | undefined)?.effectiveRoute, {
    coordination: "independent",
    dependsOn: null,
    continueFrom: null,
    retain: false,
    toolGroups: ["browser-research", "email-triage", "messages-read"],
    skillNames: ["computer-use", "hub-use", "travel-planner"],
  });
});

test("a narrow native route defaults to no skill catalogue", async () => {
  const requests: SubagentRequest[] = [];
  const tool = createTaskTool(async (request) => {
    requests.push(request);
    return { name: `subagent_${requests.length}` };
  }, { capabilityRouting: true });

  await tool.execute({
    description: "Bounded native work",
    prompt: "Read current page",
    coordination: "independent",
    tool_groups: ["browser-read"],
  }, context);
  await tool.execute({
    description: "Ambiguous work",
    prompt: "Resolve unknown workflow",
    coordination: "independent",
    tool_groups: ["all"],
  }, context);

  assert.deepEqual(requests[0]?.skillNames, []);
  assert.equal(requests[1]?.skillNames, undefined);
});

test("dependent dispatch waits for a known successful prerequisite", () => {
  const fleet = new SubagentFleet();
  const prerequisite = fleet.spawn("Find record", "run-1");
  const request = { coordination: "dependent" as const, dependsOn: prerequisite.name };
  assert.match(dependentDispatchError(fleet, request) ?? "", /still running/);
  fleet.settle(prerequisite.name, "failed", "could not read");
  assert.match(dependentDispatchError(fleet, request) ?? "", /failed/);

  const successful = fleet.spawn("Find another", "run-2");
  fleet.settle(successful.name, "completed", "found");
  assert.equal(
    dependentDispatchError(fleet, { coordination: "dependent", dependsOn: successful.name }),
    undefined,
  );
  assert.match(
    dependentDispatchError(fleet, { coordination: "dependent", dependsOn: "subagent_99" }) ?? "",
    /does not exist/,
  );
  assert.match(dependentDispatchError(fleet, { coordination: "dependent" }) ?? "", /requires depends_on/);
  assert.equal(dependentDispatchError(fleet, { coordination: "independent" }), undefined);
});

test("strict continuation refuses silent fresh-worker fallback", () => {
  const fleet = new SubagentFleet();
  assert.match(
    continuationDispatchError(fleet, { continue: "subagent_9", strictContinuation: true }) ?? "",
    /does not exist/,
  );
  const running = fleet.spawn("Research", "run-1");
  assert.match(
    continuationDispatchError(fleet, { continue: running.name, strictContinuation: true }) ?? "",
    /still running/,
  );
  fleet.settle(running.name, "completed", "done");
  assert.match(
    continuationDispatchError(fleet, { continue: running.name, strictContinuation: true }) ?? "",
    /no retained context/,
  );
  fleet.storeRetained(running.name, [{ role: "assistant", content: [{ type: "text", text: "evidence" }] }]);
  assert.equal(
    continuationDispatchError(fleet, { continue: running.name, strictContinuation: true }),
    undefined,
  );
  assert.equal(
    continuationDispatchError(fleet, { continue: "subagent_9", strictContinuation: false }),
    undefined,
    "baseline continuation remains permissive",
  );
});

test("baseline task dispatch has no shared-store controls", async () => {
  let captured: SubagentRequest | undefined;
  const tool = createTaskTool(async (request) => {
    captured = request;
    return { name: "subagent_1" };
  });
  await tool.execute({ description: "Legacy", prompt: "Work" }, context);
  assert.equal(captured?.coordination, undefined);
  assert.equal(captured?.strictContinuation, undefined);
  const properties = tool.parameters.properties as Record<string, unknown>;
  assert.equal(properties.ledger, undefined);
  assert.equal(properties.coordination, undefined);
});

test("the routed task surface exposes no removed shared-store controls", () => {
  const runner = async () => ({ name: "subagent_1" });
  const task = createTaskTool(runner, { capabilityRouting: true });
  const serialized = JSON.stringify({description: task.description, parameters: task.parameters});
  assert.doesNotMatch(serialized, /ledger|shared_pool/i);
  const properties = task.parameters.properties as Record<string, {enum?: string[]}>;
  assert.deepEqual(properties.coordination?.enum, ["independent", "dependent"]);
});
