import { n as e, t } from "./models-DVvVP5-a.js";
import { t as n } from "./event-stream-D07JAHnY.js";
import { t as r } from "./provider-env-Do4NyCk3.js";
import { n as i } from "./headers-CDJ0-DpO.js";
import { f as a, i as o } from "./transform-messages-Dy7xZPcj.js";
import { n as s, t as c } from "./error-body-CM5fnCCS.js";
import { a as l, c as u, d, i as f, l as p, n as m, o as h, r as g, s as _, t as v, u as y } from "./google-shared-BhKKPdx9.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/google-vertex.js
var b = "v1", x = "gcp-vertex-credentials", S = {
	THINKING_LEVEL_UNSPECIFIED: d.THINKING_LEVEL_UNSPECIFIED,
	MINIMAL: d.MINIMAL,
	LOW: d.LOW,
	MEDIUM: d.MEDIUM,
	HIGH: d.HIGH
}, C = 0, w = (e, r, i) => {
	let a = new n();
	return (async () => {
		let n = {
			role: "assistant",
			content: [],
			api: "google-vertex",
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
			if (i?.fetch && i.fetch !== globalThis.fetch) throw Error("Custom fetch is not supported by the Google Vertex adapter");
			let o = M(i), s = o ? D(e, o, i?.headers) : E(e, P(i), F(i), i?.headers, i?.env), c = I(e, r, i), l = await i?.onPayload?.(c, e);
			l !== void 0 && (c = l);
			let u = await _(() => s.models.generateContentStream(c), i);
			a.push({
				type: "start",
				partial: n
			});
			let d = null, p = n.content, m = () => p.length - 1;
			for await (let r of u) {
				n.responseId ||= r.responseId;
				let i = r.candidates?.[0];
				if (i?.content?.parts) for (let e of i.content.parts) {
					if (e.text !== void 0) {
						let t = g(e);
						(!d || t && d.type !== "thinking" || !t && d.type !== "text") && (d && (d.type === "text" ? a.push({
							type: "text_end",
							contentIndex: p.length - 1,
							content: d.text,
							partial: n
						}) : a.push({
							type: "thinking_end",
							contentIndex: m(),
							content: d.thinking,
							partial: n
						})), t ? (d = {
							type: "thinking",
							thinking: "",
							thinkingSignature: void 0
						}, n.content.push(d), a.push({
							type: "thinking_start",
							contentIndex: m(),
							partial: n
						})) : (d = {
							type: "text",
							text: ""
						}, n.content.push(d), a.push({
							type: "text_start",
							contentIndex: m(),
							partial: n
						}))), d.type === "thinking" ? (d.thinking += e.text, d.thinkingSignature = h(d.thinkingSignature, e.thoughtSignature), a.push({
							type: "thinking_delta",
							contentIndex: m(),
							delta: e.text,
							partial: n
						})) : (d.text += e.text, d.textSignature = h(d.textSignature, e.thoughtSignature), a.push({
							type: "text_delta",
							contentIndex: m(),
							delta: e.text,
							partial: n
						}));
					}
					if (e.functionCall) {
						d &&= (d.type === "text" ? a.push({
							type: "text_end",
							contentIndex: m(),
							content: d.text,
							partial: n
						}) : a.push({
							type: "thinking_end",
							contentIndex: m(),
							content: d.thinking,
							partial: n
						}), null);
						let t = e.functionCall.id, r = {
							type: "toolCall",
							id: !t || n.content.some((e) => e.type === "toolCall" && e.id === t) ? `${e.functionCall.name}_${Date.now()}_${++C}` : t,
							name: e.functionCall.name || "",
							arguments: e.functionCall.args ?? {},
							...e.thoughtSignature && { thoughtSignature: e.thoughtSignature }
						};
						n.content.push(r), a.push({
							type: "toolcall_start",
							contentIndex: m(),
							partial: n
						}), a.push({
							type: "toolcall_delta",
							contentIndex: m(),
							delta: JSON.stringify(r.arguments),
							partial: n
						}), a.push({
							type: "toolcall_end",
							contentIndex: m(),
							toolCall: r,
							partial: n
						});
					}
				}
				i?.finishReason && (n.rawStopReason = i.finishReason, n.stopReason = f(i.finishReason), n.content.some((e) => e.type === "toolCall") && (n.stopReason = "toolUse")), r.usageMetadata && (n.usage = {
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
			if (d && (d.type === "text" ? a.push({
				type: "text_end",
				contentIndex: m(),
				content: d.text,
				partial: n
			}) : a.push({
				type: "thinking_end",
				contentIndex: m(),
				content: d.thinking,
				partial: n
			})), i?.signal?.aborted) throw Error("Request was aborted");
			if (n.stopReason === "pending") throw Error("Google Vertex stream ended without a finish reason");
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
			n.stopReason = i?.signal?.aborted ? "aborted" : "error", n.errorMessage = c(s(e)), a.push({
				type: "error",
				reason: n.stopReason,
				error: n
			}), a.end();
		}
	})(), a;
}, T = (t, n, r) => {
	let i = o(t, n, r, void 0);
	if (!r?.reasoning) return w(t, n, {
		...i,
		thinking: { enabled: !1 }
	});
	let a = e(t, r.reasoning), s = a === "off" ? "high" : a, c = t;
	return L(c) || R(c) ? w(t, n, {
		...i,
		thinking: {
			enabled: !0,
			level: B(s, c)
		}
	}) : w(t, n, {
		...i,
		thinking: {
			enabled: !0,
			budgetTokens: V(c, s, r.thinkingBudgets)
		}
	});
};
function E(e, t, n, r, i) {
	let a = j(i);
	return new p({
		vertexai: !0,
		project: t,
		location: n,
		apiVersion: b,
		...a ? { googleAuthOptions: a } : {},
		httpOptions: O(e, r)
	});
}
function D(e, t, n) {
	return new p({
		vertexai: !0,
		apiKey: t,
		apiVersion: b,
		httpOptions: O(e, n)
	});
}
function O(e, t) {
	let n = {}, r = k(e.baseUrl);
	r && (n.baseUrl = r, n.baseUrlResourceScope = y.COLLECTION, A(r) && (n.apiVersion = ""));
	let a = i({
		...e.headers,
		...t
	});
	return a && (n.headers = a), Object.keys(n).length > 0 ? n : void 0;
}
function k(e) {
	let t = e.trim();
	if (!(!t || t.includes("{location}"))) return t;
}
function A(e) {
	try {
		return new URL(e).pathname.split("/").some((e) => /^v\d+(?:beta\d*)?$/.test(e));
	} catch {
		return /(?:^|\/)v\d+(?:beta\d*)?(?:\/|$)/.test(e);
	}
}
function j(e) {
	let t = r("GOOGLE_APPLICATION_CREDENTIALS", e);
	return t ? { keyFilename: t } : void 0;
}
function M(e) {
	let t = e?.apiKey?.trim();
	if (!(!t || t === x || N(t))) return t;
}
function N(e) {
	return /^<[^>]+>$/.test(e);
}
function P(e) {
	let t = e?.project || r("GOOGLE_CLOUD_PROJECT", e?.env) || r("GCLOUD_PROJECT", e?.env);
	if (!t) throw Error("Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.");
	return t;
}
function F(e) {
	let t = e?.location || r("GOOGLE_CLOUD_LOCATION", e?.env);
	if (!t) throw Error("Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.");
	return t;
}
function I(e, t, n = {}) {
	let r = v(e, t), i = {};
	n.temperature !== void 0 && (i.temperature = n.temperature), n.maxTokens !== void 0 && (i.maxOutputTokens = n.maxTokens);
	let o = t.tools?.length ? l(t.tools, n.toolChoice, u(e.id)) : void 0, s = {
		...Object.keys(i).length > 0 && i,
		...t.systemPrompt && { systemInstruction: a(t.systemPrompt) },
		...t.tools && t.tools.length > 0 && { tools: m(t.tools) },
		...o !== void 0 && { toolConfig: { functionCallingConfig: { mode: o } } }
	};
	if (n.thinking?.enabled && e.reasoning) {
		let e = { includeThoughts: !0 };
		n.thinking.level === void 0 ? n.thinking.budgetTokens !== void 0 && (e.thinkingBudget = n.thinking.budgetTokens) : e.thinkingLevel = S[n.thinking.level], s.thinkingConfig = e;
	} else e.reasoning && n.thinking && !n.thinking.enabled && (s.thinkingConfig = z(e));
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
function L(e) {
	return /gemini-3(?:\.\d+)?-pro/.test(e.id.toLowerCase());
}
function R(e) {
	let t = e.id.toLowerCase();
	return /gemini-3(?:\.\d+)?-flash/.test(t) || t === "gemini-flash-latest" || t === "gemini-flash-lite-latest";
}
function z(e) {
	let t = e;
	return L(t) ? { thinkingLevel: d.LOW } : R(t) ? { thinkingLevel: d.MINIMAL } : { thinkingBudget: 0 };
}
function B(e, t) {
	if (L(t)) switch (e) {
		case "minimal":
		case "low": return "LOW";
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
function V(e, t, n) {
	return n?.[t] === void 0 ? e.id.includes("2.5-pro") ? {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 32768
	}[t] : e.id.includes("2.5-flash") ? {
		minimal: 128,
		low: 2048,
		medium: 8192,
		high: 24576
	}[t] : -1 : n[t];
}
//#endregion
export { w as stream, T as streamSimple };
