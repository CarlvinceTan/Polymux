//#region node_modules/@earendil-works/pi-ai/dist/utils/sanitize-unicode.js
function e(e) {
	return e.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js
function t(e, t, n) {
	let r = t[n];
	if (typeof r != "string") throw Error(`Grammar tool call "${e}" requires argument "${n}" to be a string.`);
	return r;
}
function n(e, t, n, r) {
	if (e.closed) {
		if (r && n === e.input) return;
		throw Error(`grammar tool input for property "${t}" changed after it was closed`);
	}
	if (!n.startsWith(e.input)) throw Error(`grammar tool input for property "${t}" changed non-monotonically`);
	let i = n.slice(e.input.length);
	if (!r && i.length === 0) return;
	let a = "";
	return e.started ||= (a += `{${JSON.stringify(t)}:"`, !0), a += JSON.stringify(i).slice(1, -1), e.input = n, r && (a += "\"}", e.closed = !0), a;
}
function r(e) {
	let t = e.parameters;
	if (t.type !== "object") throw Error("grammar constrained sampling requires an object parameter schema");
	if (!Array.isArray(t.required) || t.required.length !== 1 || typeof t.required[0] != "string") throw Error("grammar constrained sampling requires exactly one required string property");
	let n = t.required[0];
	if (!t.properties?.[n]) throw Error(`grammar constrained sampling requires a properties entry for ${n}`);
	if (t.properties[n]?.type !== "string") throw Error(`grammar constrained sampling property ${n} must have type string`);
	return n;
}
function i(e, t) {
	let n = e.constrainedSampling;
	if (!(!n || n.type !== "json_schema")) {
		if (t) return !0;
		if (n.strict === "require") throw Error(`Tool "${e.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`);
	}
}
function a(e, t) {
	let n = e.constrainedSampling;
	if (!n || n.type !== "grammar" || !t) return;
	let i = n.variants.openai_lark, a = n.variants.openai_regex, o = typeof i == "string" && i.trim().length > 0, s = typeof a == "string" && a.trim().length > 0;
	if (!o && !s) throw Error(`Tool "${e.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`);
	try {
		return {
			format: o ? "lark" : "regex",
			definition: o ? i : a,
			inputProperty: r(e)
		};
	} catch (t) {
		let n = t instanceof Error ? t.message : String(t);
		throw Error(`Tool "${e.name}" cannot use grammar constrained sampling: ${n}.`);
	}
}
function o(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r of e ?? []) {
		let e = a(r, t);
		e && n.set(r.name, e.inputProperty);
	}
	return n;
}
function s(e) {
	return e.totalTokens || e.input + e.output + e.cacheRead + e.cacheWrite;
}
function c(e) {
	try {
		return JSON.stringify(e) ?? "undefined";
	} catch {
		return "[unserializable]";
	}
}
function l(e) {
	if (typeof e == "string") return e.length;
	let t = 0;
	for (let n of e) t += n.type === "text" ? n.text.length : 4800;
	return t;
}
function u(e) {
	return Math.ceil(e.length / 4);
}
function d(e) {
	return Math.ceil(l(e) / 4);
}
function f(e) {
	let t = 0;
	if (e.role === "user" || e.role === "toolResult") return d(e.content);
	for (let n of e.content) n.type === "text" ? t += n.text.length : n.type === "thinking" ? t += n.thinking.length : t += n.name.length + c(n.arguments).length;
	return Math.ceil(t / 4);
}
function p(e) {
	let t = -Infinity, n;
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		if (i.role === "assistant") {
			let e = i;
			e.timestamp >= t && e.stopReason !== "aborted" && e.stopReason !== "error" && s(e.usage) > 0 && (n = {
				usage: e.usage,
				index: r
			});
		}
		t = Math.max(t, i.timestamp);
	}
	return n;
}
function m(e) {
	let t = p(e);
	if (t) {
		let n = s(t.usage), r = 0;
		for (let n = t.index + 1; n < e.length; n++) r += f(e[n]);
		return {
			tokens: n + r,
			usageTokens: n,
			trailingTokens: r,
			lastUsageIndex: t.index
		};
	}
	let n = 0;
	for (let t of e) n += f(t);
	return {
		tokens: n,
		usageTokens: 0,
		trailingTokens: n,
		lastUsageIndex: null
	};
}
function h(e) {
	return !e || e.length === 0 ? 0 : u(c(e));
}
function g(e) {
	return Array.isArray(e);
}
function _(e) {
	if (g(e)) return m(e);
	let t = m(e.messages);
	if (t.lastUsageIndex !== null) {
		let n = new Set(e.messages.slice(t.lastUsageIndex + 1).filter((e) => e.role === "toolResult").flatMap((e) => e.addedToolNames ?? [])), r = h(e.tools?.filter((e) => n.has(e.name)));
		return {
			tokens: t.tokens + r,
			usageTokens: t.usageTokens,
			trailingTokens: t.trailingTokens + r,
			lastUsageIndex: t.lastUsageIndex
		};
	}
	let n = (e.systemPrompt ? u(e.systemPrompt) : 0) + h(e.tools);
	return {
		tokens: t.tokens + n,
		usageTokens: t.usageTokens,
		trailingTokens: t.trailingTokens + n,
		lastUsageIndex: t.lastUsageIndex
	};
}
function v(e, t, n) {
	if (e.contextWindow <= 0) return Math.max(1, n);
	let r = e.contextWindow - _(t).tokens - 4096;
	return Math.min(n, Math.max(1, r));
}
function y(e, t, n, r) {
	let i = e.samplingParams || n?.samplingParams ? {
		...e.samplingParams,
		...n?.samplingParams
	} : void 0;
	return {
		temperature: n?.temperature,
		samplingParams: i,
		maxTokens: v(e, t, n?.maxTokens ?? e.maxTokens),
		signal: n?.signal,
		telemetryContext: n?.telemetryContext,
		apiKey: r || n?.apiKey,
		fetch: n?.fetch,
		transport: n?.transport,
		cacheRetention: n?.cacheRetention,
		sessionId: n?.sessionId,
		headers: n?.headers,
		onPayload: n?.onPayload,
		onResponse: n?.onResponse,
		timeoutMs: n?.timeoutMs,
		websocketConnectTimeoutMs: n?.websocketConnectTimeoutMs,
		maxRetries: n?.maxRetries,
		maxRetryDelayMs: n?.maxRetryDelayMs,
		metadata: n?.metadata,
		env: n?.env
	};
}
var b = 1024;
function x(e) {
	return e === "xhigh" || e === "max" ? "high" : e;
}
function S(e, t, n, r) {
	let i = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
		...r
	}[x(n)], a = e === void 0 ? t : Math.min(e + i, t);
	return a <= i && (i = Math.max(0, a - b)), {
		maxTokens: a,
		thinkingBudget: i
	};
}
function C(e, t) {
	let n = [], r = !1;
	for (let i of e) {
		if (i.type === "image") {
			r || n.push({
				type: "text",
				text: t
			}), r = !0;
			continue;
		}
		n.push(i), r = i.text === t;
	}
	return n;
}
function w(e, t) {
	return t.input.includes("image") ? e : e.map((e) => e.role === "user" && Array.isArray(e.content) ? {
		...e,
		content: C(e.content, "(image omitted: model does not support images)")
	} : e.role === "toolResult" ? {
		...e,
		content: C(e.content, "(tool image omitted: model does not support images)")
	} : e);
}
function T(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i = w(e.map((e) => e.content == null ? {
		...e,
		content: []
	} : e), t).map((e) => {
		if (e.role === "user") return e;
		if (e.role === "toolResult") {
			let t = r.get(e.toolCallId);
			return t && t !== e.toolCallId ? {
				...e,
				toolCallId: t
			} : e;
		}
		if (e.role === "assistant") {
			let i = e, a = i.provider === t.provider && i.api === t.api && i.model === t.id, o = i.content.flatMap((e) => {
				if (e.type === "thinking") return e.redacted ? a ? e : [] : a && e.thinkingSignature ? e : !e.thinking || e.thinking.trim() === "" ? [] : a ? e : {
					type: "text",
					text: e.thinking
				};
				if (e.type === "text") return a ? e : {
					type: "text",
					text: e.text
				};
				if (e.type === "toolCall") {
					let o = e, s = o;
					if (!a && o.thoughtSignature && (s = { ...o }, delete s.thoughtSignature), !a && n) {
						let e = n(o.id, t, i);
						e !== o.id && (r.set(o.id, e), s = {
							...s,
							id: e
						});
					}
					return s;
				}
				return e;
			});
			return {
				...i,
				content: o
			};
		}
		return e;
	}), a = [], o = [], s = /* @__PURE__ */ new Set(), c = () => {
		if (o.length > 0) {
			for (let e of o) s.has(e.id) || a.push({
				role: "toolResult",
				toolCallId: e.id,
				toolName: e.name,
				content: [{
					type: "text",
					text: "No result provided"
				}],
				isError: !0,
				timestamp: Date.now()
			});
			o = [], s = /* @__PURE__ */ new Set();
		}
	};
	for (let e = 0; e < i.length; e++) {
		let t = i[e];
		if (t.role === "assistant") {
			c();
			let e = t;
			if (e.stopReason === "error" || e.stopReason === "aborted") continue;
			let n = e.content.filter((e) => e.type === "toolCall");
			n.length > 0 && (o = n, s = /* @__PURE__ */ new Set()), a.push(t);
		} else t.role === "toolResult" ? (s.add(t.toolCallId), a.push(t)) : (t.role === "user" && c(), a.push(t));
	}
	return c(), a;
}
//#endregion
export { v as a, o as c, i as d, e as f, y as i, t as l, b as n, x as o, S as r, n as s, T as t, a as u };
