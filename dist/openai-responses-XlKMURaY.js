import { n as e } from "./models-DVvVP5-a.js";
import { t } from "./event-stream-D07JAHnY.js";
import { t as n } from "./provider-env-Do4NyCk3.js";
import { t as r } from "./deferred-tools-BbPJenDp.js";
import { t as i } from "./headers-CDJ0-DpO.js";
import { t as a } from "./provider-retry-geBRPa4e.js";
import { c as o, i as s } from "./transform-messages-Dy7xZPcj.js";
import { n as c, t as l } from "./github-copilot-headers-BzlktqJ_.js";
import { n as u } from "./openai-BiTm5QhP.js";
import { n as d, t as f } from "./error-body-CM5fnCCS.js";
import { t as p } from "./openai-prompt-cache-CfeHqFRG.js";
import { n as m, r as h, t as g } from "./openai-responses-shared-BUD8Dels.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js
var _ = /* @__PURE__ */ new Set([
	"openai",
	"openai-codex",
	"opencode"
]), v = 16;
function y(e, t) {
	if (!e) return !1;
	let n = t.toLowerCase();
	for (let [t, r] of Object.entries(e)) if (t.toLowerCase() === n && r !== null && r.trim().length > 0) return !0;
	return !1;
}
function b(e, t, n) {
	if (t) return t;
	if (y(n, "authorization") || y(n, "cf-aig-authorization")) return "unused";
	throw Error(`No API key for provider: ${e}`);
}
function x(e) {
	return e.provider === "openrouter" || e.baseUrl.includes("openrouter.ai") ? "openrouter" : "openai";
}
function S(e, t) {
	return e || (n("PI_CACHE_RETENTION", t) === "long" ? "long" : "short");
}
function C(e) {
	return {
		supportsDeveloperRole: e.compat?.supportsDeveloperRole ?? !0,
		sessionAffinityFormat: e.compat?.sessionAffinityFormat ?? x(e),
		supportsLongCacheRetention: e.compat?.supportsLongCacheRetention ?? !0,
		supportsStrictMode: e.compat?.supportsStrictMode ?? !1,
		supportsOpenAIGrammarTools: e.compat?.supportsOpenAIGrammarTools ?? !1,
		supportsToolSearch: e.compat?.supportsToolSearch ?? !1,
		supportsExplicitPromptCacheMode: e.compat?.supportsExplicitPromptCacheMode ?? !1
	};
}
function w(e, t) {
	return t === "long" && e.supportsLongCacheRetention ? "24h" : void 0;
}
function T(e) {
	return f(d(e), "OpenAI API error");
}
var E = (e, n, r) => {
	let s = new t();
	return (async () => {
		let t = {
			role: "assistant",
			content: [],
			api: e.api,
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
			let c = b(e.provider, r?.apiKey, r?.headers), l = S(r?.cacheRetention, r?.env) === "none" ? void 0 : r?.sessionId, u = C(e), d = o(n.tools, u.supportsOpenAIGrammarTools), f = O(e, n, c, r?.headers, r?.fetch, l), p = k(e, n, r, u, d), m = await r?.onPayload?.(p, e);
			m !== void 0 && (p = m);
			let g = {
				...r?.signal ? { signal: r.signal } : {},
				...r?.timeoutMs === void 0 ? {} : { timeout: r.timeoutMs },
				maxRetries: 0
			}, { data: _, response: v } = await a(() => f.responses.create(p, g).withResponse(), {
				maxRetries: r?.maxRetries,
				maxRetryDelayMs: r?.maxRetryDelayMs,
				signal: r?.signal
			});
			if (await r?.onResponse?.({
				status: v.status,
				headers: i(v.headers)
			}, e), s.push({
				type: "start",
				partial: t
			}), await h(_, t, s, e, {
				serviceTier: r?.serviceTier,
				grammarToolInputProperties: d,
				applyServiceTierPricing: (t, n) => j(t, n, e)
			}), r?.signal?.aborted) throw Error("Request was aborted");
			if (t.stopReason === "pending") throw Error("OpenAI Responses stream ended without a stop reason");
			if (t.stopReason === "aborted" || t.stopReason === "error") throw Error(t.errorMessage || "An unknown error occurred");
			s.push({
				type: "done",
				reason: t.stopReason,
				message: t
			}), s.end();
		} catch (e) {
			for (let e of t.content) delete e.index, delete e.partialJson, delete e.customInput;
			t.stopReason = r?.signal?.aborted ? "aborted" : "error", t.errorMessage = T(e), s.push({
				type: "error",
				reason: t.stopReason,
				error: t
			}), s.end();
		}
	})(), s;
}, D = (t, n, r) => {
	b(t.provider, r?.apiKey, r?.headers);
	let i = s(t, n, r, r?.apiKey), a = r?.reasoning ? e(t, r.reasoning) : void 0, o = a === "off" ? void 0 : a;
	return E(t, n, {
		...i,
		reasoningEffort: o
	});
};
function O(e, t, n, r, i, a) {
	let o = C(e), s = { ...e.headers };
	if (e.provider === "github-copilot") {
		let e = c(t.messages), n = l({
			messages: t.messages,
			hasImages: e
		});
		Object.assign(s, n);
	}
	return a && (o.sessionAffinityFormat === "openrouter" ? s["x-session-id"] = a : (o.sessionAffinityFormat === "openai" && (s.session_id = a), s["x-client-request-id"] = a)), r && Object.assign(s, r), new u({
		apiKey: n,
		baseURL: e.baseUrl,
		dangerouslyAllowBrowser: !0,
		fetch: i,
		defaultHeaders: s
	});
}
function k(e, t, n, i = C(e), a = o(t.tools, i.supportsOpenAIGrammarTools)) {
	let s = r(t, i.supportsToolSearch), c = g(e, t, _, {
		grammarToolInputProperties: a,
		deferredTools: s.deferred,
		toolOptions: {
			supportsStrictMode: i.supportsStrictMode,
			supportsOpenAIGrammarTools: i.supportsOpenAIGrammarTools
		}
	}), l = S(n?.cacheRetention, n?.env), u = l === "none" && i.supportsExplicitPromptCacheMode, d = {
		model: e.id,
		input: c,
		stream: !0,
		prompt_cache_key: l === "none" ? void 0 : p(n?.sessionId),
		prompt_cache_retention: w(i, l),
		prompt_cache_options: u ? { mode: "explicit" } : void 0,
		store: !1
	};
	return n?.maxTokens && (d.max_output_tokens = Math.max(n.maxTokens, v)), n?.temperature !== void 0 && (d.temperature = n?.temperature), n?.serviceTier !== void 0 && (d.service_tier = n.serviceTier), s.immediate.length > 0 && (d.tools = m(s.immediate, {
		supportsStrictMode: i.supportsStrictMode,
		supportsOpenAIGrammarTools: i.supportsOpenAIGrammarTools
	})), n?.toolChoice !== void 0 && (d.tool_choice = n.toolChoice), e.reasoning && (n?.reasoningEffort || n?.reasoningSummary ? (d.reasoning = {
		effort: n?.reasoningEffort ? e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort : "medium",
		summary: n?.reasoningSummary || "auto"
	}, d.include = ["reasoning.encrypted_content"]) : e.provider !== "github-copilot" && e.thinkingLevelMap?.off !== null && (d.reasoning = { effort: e.thinkingLevelMap?.off ?? "none" }), e.provider === "xai" && (d.include = ["reasoning.encrypted_content"])), n?.samplingParams && Object.assign(d, n.samplingParams), d;
}
function A(e, t) {
	switch (t) {
		case "flex": return .5;
		case "priority": return e.id === "gpt-5.5" ? 2.5 : 2;
		default: return 1;
	}
}
function j(e, t, n) {
	let r = A(n, t);
	r !== 1 && (e.cost.input *= r, e.cost.output *= r, e.cost.cacheRead *= r, e.cost.cacheWrite *= r, e.cost.total = e.cost.input + e.cost.output + e.cost.cacheRead + e.cost.cacheWrite);
}
//#endregion
export { E as stream, D as streamSimple };
