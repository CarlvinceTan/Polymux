import { n as e } from "./models-DVvVP5-a.js";
import { t } from "./event-stream-D07JAHnY.js";
import { t as n } from "./provider-env-Do4NyCk3.js";
import { t as r } from "./headers-CDJ0-DpO.js";
import { t as i } from "./provider-retry-geBRPa4e.js";
import { c as a, i as o } from "./transform-messages-Dy7xZPcj.js";
import { t as s } from "./openai-BiTm5QhP.js";
import { n as c, t as l } from "./error-body-CM5fnCCS.js";
import { t as u } from "./openai-prompt-cache-CfeHqFRG.js";
import { n as d, r as f, t as p } from "./openai-responses-shared-BUD8Dels.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/azure-openai-responses.js
var m = "v1", h = /* @__PURE__ */ new Set([
	"openai",
	"openai-codex",
	"opencode",
	"azure-openai-responses"
]), g = 16;
function _(e) {
	let t = /* @__PURE__ */ new Map();
	if (!e) return t;
	for (let n of e.split(",")) {
		let e = n.trim();
		if (!e) continue;
		let [r, i] = e.split("=", 2);
		!r || !i || t.set(r.trim(), i.trim());
	}
	return t;
}
function v(e, t) {
	return t?.azureDeploymentName ? t.azureDeploymentName : _(n("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", t?.env)).get(e.id) || e.id;
}
function y(e) {
	return l(c(e), "Azure OpenAI API error");
}
var b = (e, n, o) => {
	let s = new t();
	return (async () => {
		let t = v(e, o), c = {
			role: "assistant",
			content: [],
			api: "azure-openai-responses",
			provider: e.provider,
			model: e.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			},
			stopReason: "pending",
			timestamp: Date.now()
		};
		try {
			let l = o?.apiKey;
			if (!l) throw Error(`No API key for provider: ${e.provider}`);
			let u = T(e, l, o), d = a(n.tools, e.compat?.supportsOpenAIGrammarTools ?? !1), p = E(e, n, o, t, d), m = await o?.onPayload?.(p, e);
			m !== void 0 && (p = m);
			let h = {
				...o?.signal ? { signal: o.signal } : {},
				...o?.timeoutMs === void 0 ? {} : { timeout: o.timeoutMs },
				maxRetries: 0
			}, { data: g, response: _ } = await i(() => u.responses.create(p, h).withResponse(), {
				maxRetries: o?.maxRetries,
				maxRetryDelayMs: o?.maxRetryDelayMs,
				signal: o?.signal
			});
			if (await o?.onResponse?.({
				status: _.status,
				headers: r(_.headers)
			}, e), s.push({
				type: "start",
				partial: c
			}), await f(g, c, s, e, { grammarToolInputProperties: d }), o?.signal?.aborted) throw Error("Request was aborted");
			if (c.stopReason === "pending") throw Error("Azure OpenAI Responses stream ended without a stop reason");
			if (c.stopReason === "aborted" || c.stopReason === "error") throw Error(c.errorMessage || "An unknown error occurred");
			s.push({
				type: "done",
				reason: c.stopReason,
				message: c
			}), s.end();
		} catch (e) {
			for (let e of c.content) delete e.index, delete e.partialJson, delete e.customInput;
			c.stopReason = o?.signal?.aborted ? "aborted" : "error", c.errorMessage = y(e), s.push({
				type: "error",
				reason: c.stopReason,
				error: c
			}), s.end();
		}
	})(), s;
}, x = (t, n, r) => {
	let i = r?.apiKey;
	if (!i) throw Error(`No API key for provider: ${t.provider}`);
	let a = o(t, n, r, i), s = r?.reasoning ? e(t, r.reasoning) : void 0, c = s === "off" ? void 0 : s;
	return b(t, n, {
		...a,
		reasoningEffort: c
	});
};
function S(e) {
	let t = e.trim().replace(/\/+$/, ""), n;
	try {
		n = new URL(t);
	} catch {
		throw Error(`Invalid Azure OpenAI base URL: ${e}`);
	}
	let r = n.hostname.endsWith(".openai.azure.com") || n.hostname.endsWith(".cognitiveservices.azure.com") || n.hostname.endsWith(".ai.azure.com"), i = n.pathname.replace(/\/+$/, "");
	return r && (i === "" || i === "/" || i === "/openai" || i === "/openai/v1/responses") && (n.pathname = "/openai/v1", n.search = ""), n.toString().replace(/\/+$/, "");
}
function C(e) {
	return `https://${e}.openai.azure.com/openai/v1`;
}
function w(e, t) {
	let r = t?.azureApiVersion || n("AZURE_OPENAI_API_VERSION", t?.env) || m, i = t?.azureBaseUrl?.trim() || n("AZURE_OPENAI_BASE_URL", t?.env)?.trim() || void 0, a = t?.azureResourceName || n("AZURE_OPENAI_RESOURCE_NAME", t?.env), o = i;
	if (!o && a && (o = C(a)), !o && e.baseUrl && (o = e.baseUrl), !o) throw Error("Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.");
	return {
		baseUrl: S(o),
		apiVersion: r
	};
}
function T(e, t, n) {
	let r = { ...e.headers };
	n?.headers && Object.assign(r, n.headers);
	let { baseUrl: i, apiVersion: a } = w(e, n);
	return new s({
		apiKey: t,
		apiVersion: a,
		dangerouslyAllowBrowser: !0,
		fetch: n?.fetch,
		defaultHeaders: r,
		baseURL: i
	});
}
function E(e, t, n, r, i = a(t.tools, e.compat?.supportsOpenAIGrammarTools ?? !1)) {
	let o = {
		model: r,
		input: p(e, t, h, { grammarToolInputProperties: i }),
		stream: !0,
		prompt_cache_key: u(n?.sessionId),
		store: !1
	};
	return n?.maxTokens && (o.max_output_tokens = Math.max(n.maxTokens, g)), n?.temperature !== void 0 && (o.temperature = n?.temperature), t.tools && t.tools.length > 0 && (o.tools = d(t.tools, {
		supportsStrictMode: e.compat?.supportsStrictMode ?? !0,
		supportsOpenAIGrammarTools: e.compat?.supportsOpenAIGrammarTools ?? !1
	})), e.reasoning && (n?.reasoningEffort || n?.reasoningSummary ? (o.reasoning = {
		effort: n?.reasoningEffort ? e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort : "medium",
		summary: n?.reasoningSummary || "auto"
	}, o.include = ["reasoning.encrypted_content"]) : e.thinkingLevelMap?.off !== null && (o.reasoning = { effort: e.thinkingLevelMap?.off ?? "none" })), n?.samplingParams && Object.assign(o, n.samplingParams), o;
}
//#endregion
export { b as stream, x as streamSimple };
