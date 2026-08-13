import { n as e, t } from "./models-DVvVP5-a.js";
import { t as n } from "./event-stream-D07JAHnY.js";
import { n as r } from "./headers-CDJ0-DpO.js";
import { f as i, i as a } from "./transform-messages-Dy7xZPcj.js";
import { n as o, t as s } from "./error-body-CM5fnCCS.js";
import { a as c, c as l, i as u, l as d, n as f, o as p, r as m, s as h, t as g } from "./google-shared-BhKKPdx9.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js
var _ = 0, v = (e, r, i) => {
	let a = new n();
	return (async () => {
		let n = {
			role: "assistant",
			content: [],
			api: "google-generative-ai",
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
			if (i?.fetch && i.fetch !== globalThis.fetch) throw Error("Custom fetch is not supported by the Google Generative AI adapter");
			let o = i?.apiKey;
			if (!o) throw Error(`No API key for provider: ${e.provider}`);
			let s = b(e, o, i?.headers), c = x(e, r, i), l = await i?.onPayload?.(c, e);
			l !== void 0 && (c = l);
			let d = await h(() => s.models.generateContentStream(c), i);
			a.push({
				type: "start",
				partial: n
			});
			let f = null, g = n.content, v = () => g.length - 1;
			for await (let r of d) {
				n.responseId ||= r.responseId;
				let i = r.candidates?.[0];
				if (i?.content?.parts) for (let e of i.content.parts) {
					if (e.text !== void 0) {
						let t = m(e);
						(!f || t && f.type !== "thinking" || !t && f.type !== "text") && (f && (f.type === "text" ? a.push({
							type: "text_end",
							contentIndex: g.length - 1,
							content: f.text,
							partial: n
						}) : a.push({
							type: "thinking_end",
							contentIndex: v(),
							content: f.thinking,
							partial: n
						})), t ? (f = {
							type: "thinking",
							thinking: "",
							thinkingSignature: void 0
						}, n.content.push(f), a.push({
							type: "thinking_start",
							contentIndex: v(),
							partial: n
						})) : (f = {
							type: "text",
							text: ""
						}, n.content.push(f), a.push({
							type: "text_start",
							contentIndex: v(),
							partial: n
						}))), f.type === "thinking" ? (f.thinking += e.text, f.thinkingSignature = p(f.thinkingSignature, e.thoughtSignature), a.push({
							type: "thinking_delta",
							contentIndex: v(),
							delta: e.text,
							partial: n
						})) : (f.text += e.text, f.textSignature = p(f.textSignature, e.thoughtSignature), a.push({
							type: "text_delta",
							contentIndex: v(),
							delta: e.text,
							partial: n
						}));
					}
					if (e.functionCall) {
						f &&= (f.type === "text" ? a.push({
							type: "text_end",
							contentIndex: v(),
							content: f.text,
							partial: n
						}) : a.push({
							type: "thinking_end",
							contentIndex: v(),
							content: f.thinking,
							partial: n
						}), null);
						let t = e.functionCall.id, r = {
							type: "toolCall",
							id: !t || n.content.some((e) => e.type === "toolCall" && e.id === t) ? `${e.functionCall.name}_${Date.now()}_${++_}` : t,
							name: e.functionCall.name || "",
							arguments: e.functionCall.args ?? {},
							...e.thoughtSignature && { thoughtSignature: e.thoughtSignature }
						};
						n.content.push(r), a.push({
							type: "toolcall_start",
							contentIndex: v(),
							partial: n
						}), a.push({
							type: "toolcall_delta",
							contentIndex: v(),
							delta: JSON.stringify(r.arguments),
							partial: n
						}), a.push({
							type: "toolcall_end",
							contentIndex: v(),
							toolCall: r,
							partial: n
						});
					}
				}
				i?.finishReason && (n.rawStopReason = i.finishReason, n.stopReason = u(i.finishReason), n.content.some((e) => e.type === "toolCall") && (n.stopReason = "toolUse")), r.usageMetadata && (n.usage = {
					input: (r.usageMetadata.promptTokenCount || 0) - (r.usageMetadata.cachedContentTokenCount || 0),
					output: (r.usageMetadata.candidatesTokenCount || 0) + (r.usageMetadata.thoughtsTokenCount || 0),
					cacheRead: r.usageMetadata.cachedContentTokenCount || 0,
					cacheWrite: 0,
					reasoning: r.usageMetadata.thoughtsTokenCount || 0,
					totalTokens: r.usageMetadata.totalTokenCount || 0,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0
					}
				}, t(e, n.usage));
			}
			if (f && (f.type === "text" ? a.push({
				type: "text_end",
				contentIndex: v(),
				content: f.text,
				partial: n
			}) : a.push({
				type: "thinking_end",
				contentIndex: v(),
				content: f.thinking,
				partial: n
			})), i?.signal?.aborted) throw Error("Request was aborted");
			if (n.stopReason === "pending") throw Error("Google stream ended without a finish reason");
			if (n.stopReason === "aborted" || n.stopReason === "error") {
				let e = n.rawStopReason ? `Provider stopped with: ${n.rawStopReason}` : "An unknown error occurred";
				throw Error(e);
			}
			a.push({
				type: "done",
				reason: n.stopReason,
				message: n
			}), a.end();
		} catch (e) {
			for (let e of n.content) "index" in e && delete e.index;
			n.stopReason = i?.signal?.aborted ? "aborted" : "error", n.errorMessage = s(o(e)), a.push({
				type: "error",
				reason: n.stopReason,
				error: n
			}), a.end();
		}
	})(), a;
}, y = (t, n, r) => {
	let i = r?.apiKey;
	if (!i) throw Error(`No API key for provider: ${t.provider}`);
	let o = a(t, n, r, i);
	if (!r?.reasoning) return v(t, n, {
		...o,
		thinking: { enabled: !1 }
	});
	let s = e(t, r.reasoning), c = s === "off" ? "high" : s, l = t;
	return C(l) || w(l) || S(l) ? v(t, n, {
		...o,
		thinking: {
			enabled: !0,
			level: E(c, l)
		}
	}) : v(t, n, {
		...o,
		thinking: {
			enabled: !0,
			budgetTokens: D(l, c, r.thinkingBudgets)
		}
	});
};
function b(e, t, n) {
	let i = {};
	e.baseUrl && (i.baseUrl = e.baseUrl, i.apiVersion = "");
	let a = r({
		...e.headers,
		...n
	});
	return a && (i.headers = a), new d({
		apiKey: t,
		httpOptions: Object.keys(i).length > 0 ? i : void 0
	});
}
function x(e, t, n = {}) {
	let r = g(e, t), a = {};
	n.temperature !== void 0 && (a.temperature = n.temperature), n.maxTokens !== void 0 && (a.maxOutputTokens = n.maxTokens);
	let o = t.tools?.length ? c(t.tools, n.toolChoice, l(e.id)) : void 0, s = {
		...Object.keys(a).length > 0 && a,
		...t.systemPrompt && { systemInstruction: i(t.systemPrompt) },
		...t.tools && t.tools.length > 0 && { tools: f(t.tools) },
		...o !== void 0 && { toolConfig: { functionCallingConfig: { mode: o } } }
	};
	if (n.thinking?.enabled && e.reasoning) {
		let e = { includeThoughts: !0 };
		n.thinking.level === void 0 ? n.thinking.budgetTokens !== void 0 && (e.thinkingBudget = n.thinking.budgetTokens) : e.thinkingLevel = n.thinking.level, s.thinkingConfig = e;
	} else e.reasoning && n.thinking && !n.thinking.enabled && (s.thinkingConfig = T(e));
	if (n.signal) {
		if (n.signal.aborted) throw Error("Request aborted");
		s.abortSignal = n.signal;
	}
	return {
		model: e.id,
		contents: r,
		config: s
	};
}
function S(e) {
	return /gemma-?4/.test(e.id.toLowerCase());
}
function C(e) {
	return /gemini-3(?:\.\d+)?-pro/.test(e.id.toLowerCase());
}
function w(e) {
	let t = e.id.toLowerCase();
	return /gemini-3(?:\.\d+)?-flash/.test(t) || t === "gemini-flash-latest" || t === "gemini-flash-lite-latest";
}
function T(e) {
	return C(e) ? { thinkingLevel: "LOW" } : w(e) || S(e) ? { thinkingLevel: "MINIMAL" } : { thinkingBudget: 0 };
}
function E(e, t) {
	if (C(t)) switch (e) {
		case "minimal":
		case "low": return "LOW";
		case "medium":
		case "high": return "HIGH";
	}
	if (S(t)) switch (e) {
		case "minimal":
		case "low": return "MINIMAL";
		case "medium":
		case "high": return "HIGH";
	}
	switch (e) {
		case "minimal": return "MINIMAL";
		case "low": return "LOW";
		case "medium": return "MEDIUM";
		case "high": return "HIGH";
	}
}
function D(e, t, n) {
	return n?.[t] === void 0 ? e.id.includes("2.5-pro") ? {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 32768
	}[t] : e.id.includes("2.5-flash-lite") ? {
		minimal: 512,
		low: 2048,
		medium: 8192,
		high: 24576
	}[t] : e.id.includes("2.5-flash") ? {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 24576
	}[t] : -1 : n[t];
}
//#endregion
export { v as stream, y as streamSimple };
