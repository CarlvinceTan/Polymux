import { n as e, t } from "./models-DVvVP5-a.js";
import { t as n } from "./event-stream-D07JAHnY.js";
import { t as r } from "./provider-env-Do4NyCk3.js";
import { n as i } from "./json-parse-XC7hUTqJ.js";
import { t as a } from "./headers-CDJ0-DpO.js";
import { t as o } from "./provider-retry-geBRPa4e.js";
import { c as s, d as c, f as l, i as u, l as d, n as f, o as p, s as m, t as h, u as g } from "./transform-messages-Dy7xZPcj.js";
import { n as _, t as v } from "./github-copilot-headers-BzlktqJ_.js";
import { n as y } from "./openai-BiTm5QhP.js";
import { n as b, t as x } from "./error-body-CM5fnCCS.js";
import { t as S } from "./openai-prompt-cache-CfeHqFRG.js";
import { t as C } from "./hash-BiTt2yhT.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js
function w(e, t) {
	if (!e) return !1;
	let n = t.toLowerCase();
	for (let [t, r] of Object.entries(e)) if (t.toLowerCase() === n && r !== null && r.trim().length > 0) return !0;
	return !1;
}
function T(e, t, n) {
	if (t) return t;
	if (w(n, "authorization") || w(n, "cf-aig-authorization")) return "unused";
	throw Error(`No API key for provider: ${e}`);
}
function E(e) {
	for (let t of e) if (t.role === "toolResult" || t.role === "assistant" && t.content.some((e) => e.type === "toolCall")) return !0;
	return !1;
}
function D(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (n.role === "toolResult") for (let e of n.addedToolNames ?? []) t.add(e);
	return t;
}
function O(e, t) {
	if (!e) return [];
	let n = new Map(e.map((e) => [e.name, e]));
	return Array.from(t).map((e) => n.get(e)).filter((e) => e !== void 0);
}
function k(e) {
	return e.type === "text";
}
function A(e) {
	return e.type === "thinking";
}
function j(e) {
	return e.type === "toolCall";
}
function M(e) {
	return e.type === "image";
}
function N(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e;
	return t.type === "reasoning.encrypted" && typeof t.id == "string" && t.id.length > 0 && typeof t.data == "string" && t.data.length > 0;
}
function P(e, t) {
	return e || (r("PI_CACHE_RETENTION", t) === "long" ? "long" : "short");
}
var F = (e, t, r) => {
	let c = new n();
	return (async () => {
		let n = {
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
			let l = T(e.provider, r?.apiKey, r?.headers), u = $(e), d = s(t.tools, u.supportsOpenAIGrammarTools), f = P(r?.cacheRetention, r?.env), p = f === "none" ? void 0 : r?.sessionId, h = L(e, t, l, r?.headers, r?.fetch, p, u), g = R(e, t, r, u, f, d), _ = await r?.onPayload?.(g, e);
			_ !== void 0 && (g = _);
			let v = {
				...r?.signal ? { signal: r.signal } : {},
				...r?.timeoutMs === void 0 ? {} : { timeout: r.timeoutMs },
				maxRetries: 0
			}, { data: y, response: b } = await o(() => h.chat.completions.create(g, v).withResponse(), {
				maxRetries: r?.maxRetries,
				maxRetryDelayMs: r?.maxRetryDelayMs,
				signal: r?.signal
			});
			await r?.onResponse?.({
				status: b.status,
				headers: a(b.headers)
			}, e), c.push({
				type: "start",
				partial: n
			});
			let x = null, S = null, C = !1, w = /* @__PURE__ */ new Map(), E = /* @__PURE__ */ new Map(), D = /* @__PURE__ */ new Map(), O = n.content, k = (e) => O.indexOf(e), A = (e) => {
				let t = e.customInput?.property;
				if (t === void 0) return "";
				let n = e.arguments[t];
				return typeof n == "string" ? n : "";
			}, j = (e, t, n) => {
				let r = e.customInput;
				if (!r) return;
				let i = m(r.jsonBuffer, r.property, t, n);
				return e.arguments = { [r.property]: t }, i;
			}, M = (e) => {
				let t = k(e);
				if (t !== -1) {
					if (e.type === "text") c.push({
						type: "text_end",
						contentIndex: t,
						content: e.text,
						partial: n
					});
					else if (e.type === "thinking") c.push({
						type: "thinking_end",
						contentIndex: t,
						content: e.thinking,
						partial: n
					});
					else if (e.type === "toolCall") {
						if (e.customInput) {
							let r = j(e, A(e), !0);
							r !== void 0 && c.push({
								type: "toolcall_delta",
								contentIndex: t,
								delta: r,
								partial: n
							});
						} else e.arguments = i(e.partialArgs);
						delete e.partialArgs, delete e.customInput, delete e.streamIndex, c.push({
							type: "toolcall_end",
							contentIndex: t,
							toolCall: e,
							partial: n
						});
					}
				}
			}, F = () => (x || (x = {
				type: "text",
				text: ""
			}, O.push(x), c.push({
				type: "text_start",
				contentIndex: k(x),
				partial: n
			})), x), I = (e) => (S || (S = {
				type: "thinking",
				thinking: "",
				thinkingSignature: e
			}, O.push(S), c.push({
				type: "thinking_start",
				contentIndex: k(S),
				partial: n
			})), S), z = (e) => {
				if (!e.id) return;
				let t = D.get(e.id);
				t && (e.thoughtSignature = t, D.delete(e.id));
			}, B = (e) => {
				let t = typeof e.index == "number" ? e.index : void 0, r = e.function?.name ?? e.custom?.name ?? "", i = t === void 0 ? void 0 : w.get(t);
				if (!i && e.id && (i = E.get(e.id)), !i) {
					let a = e.custom && !e.function ? d.get(r) ?? "input" : void 0, o = a !== void 0;
					i = {
						type: "toolCall",
						id: e.id || "",
						name: r,
						arguments: o ? { [a]: "" } : {},
						partialArgs: o ? void 0 : "",
						customInput: o ? {
							property: a,
							jsonBuffer: {
								input: "",
								started: !1,
								closed: !1
							}
						} : void 0,
						streamIndex: t
					}, t !== void 0 && w.set(t, i), e.id && E.set(e.id, i), O.push(i), c.push({
						type: "toolcall_start",
						contentIndex: k(i),
						partial: n
					});
				}
				if (t !== void 0 && i.streamIndex === void 0 && (i.streamIndex = t, w.set(t, i)), e.id && E.set(e.id, i), !i.name && r && (i.name = r), e.custom && !e.function && !i.customInput) {
					let e = d.get(i.name) ?? "input";
					i.arguments = { [e]: "" }, i.customInput = {
						property: e,
						jsonBuffer: {
							input: "",
							started: !1,
							closed: !1
						}
					}, delete i.partialArgs;
				}
				return z(i), i;
			};
			for await (let t of y) {
				if (!t || typeof t != "object") continue;
				n.responseId ||= t.id, typeof t.model == "string" && t.model.length > 0 && t.model !== e.id && (n.responseModel ||= t.model), t.usage && (n.usage = Z(t.usage, e));
				let r = Array.isArray(t.choices) ? t.choices[0] : void 0;
				if (r) {
					if (!t.usage && r.usage && (n.usage = Z(r.usage, e)), r.finish_reason) {
						n.rawStopReason = r.finish_reason;
						let e = Q(r.finish_reason);
						n.stopReason = e.stopReason, e.errorMessage && (n.errorMessage = e.errorMessage), C = !0;
					}
					if (r.delta) {
						if (r.delta.content !== null && r.delta.content !== void 0 && r.delta.content.length > 0) {
							let e = F();
							e.text += r.delta.content, c.push({
								type: "text_delta",
								contentIndex: k(e),
								delta: r.delta.content,
								partial: n
							});
						}
						let t = [
							"reasoning_content",
							"reasoning",
							"reasoning_text"
						], a = r.delta, o = null;
						for (let e of t) {
							let t = a[e];
							if (typeof t == "string" && t.length > 0) {
								o = e;
								break;
							}
						}
						if (o) {
							let t = a[o];
							if (typeof t == "string" && t.length > 0) {
								let r = I(e.provider === "opencode-go" && o === "reasoning" ? "reasoning_content" : o);
								r.thinking += t, c.push({
									type: "thinking_delta",
									contentIndex: k(r),
									delta: t,
									partial: n
								});
							}
						}
						if (r?.delta?.tool_calls) for (let e of r.delta.tool_calls) {
							let t = B(e);
							!t.id && e.id && (t.id = e.id, E.set(e.id, t));
							let r = e.function?.name ?? e.custom?.name;
							!t.name && r && (t.name = r);
							let a = "";
							e.function?.arguments ? (a = e.function.arguments, t.partialArgs = (t.partialArgs ?? "") + e.function.arguments, t.arguments = i(t.partialArgs)) : e.custom?.input && (a = j(t, A(t) + e.custom.input, !1) ?? ""), c.push({
								type: "toolcall_delta",
								contentIndex: k(t),
								delta: a,
								partial: n
							});
						}
						let s = r.delta.reasoning_details;
						if (Array.isArray(s)) {
							for (let e of s) if (N(e)) {
								let t = JSON.stringify(e), n = E.get(e.id);
								n ? n.thoughtSignature = t : D.set(e.id, t);
							}
						}
					}
				}
			}
			for (let e of O) M(e);
			if (r?.signal?.aborted || n.stopReason === "aborted") throw Error("Request was aborted");
			if (!C && !u.supportsFinishReason && (n.stopReason = n.content.some((e) => e.type === "toolCall") ? "toolUse" : "stop"), n.stopReason === "error") throw Error(n.errorMessage || "Provider returned an error stop reason");
			if (u.supportsFinishReason && !C || n.stopReason === "pending") throw Error("Stream ended without finish_reason");
			c.push({
				type: "done",
				reason: n.stopReason,
				message: n
			}), c.end();
		} catch (e) {
			for (let e of n.content) delete e.index, delete e.partialArgs, delete e.customInput, delete e.streamIndex;
			n.stopReason = r?.signal?.aborted ? "aborted" : "error", n.errorMessage = x(b(e));
			let t = e?.error?.metadata?.raw;
			t && !n.errorMessage.includes(String(t)) && (n.errorMessage += `\n${t}`), c.push({
				type: "error",
				reason: n.stopReason,
				error: n
			}), c.end();
		}
	})(), c;
}, I = (t, n, r) => {
	T(t.provider, r?.apiKey, r?.headers);
	let i = u(t, n, r, r?.apiKey), a = r?.reasoning ? e(t, r.reasoning) : void 0, o = a === "off" ? void 0 : a, s = r?.toolChoice;
	return F(t, n, {
		...i,
		reasoningEffort: o,
		toolChoice: s,
		thinkingBudgets: r?.thinkingBudgets
	});
};
function L(e, t, n, r, i, a, o = $(e)) {
	let s = { ...e.headers };
	if (e.provider === "github-copilot") {
		let e = _(t.messages), n = v({
			messages: t.messages,
			hasImages: e
		});
		Object.assign(s, n);
	}
	return a && o.sendSessionAffinityHeaders && (o.sessionAffinityFormat === "openrouter" ? s["x-session-id"] = a : (o.sessionAffinityFormat === "openai" && (s.session_id = a), s["x-client-request-id"] = a, s["x-session-affinity"] = a)), r && Object.assign(s, r), new y({
		apiKey: n,
		baseURL: e.baseUrl,
		dangerouslyAllowBrowser: !0,
		fetch: i,
		defaultHeaders: s
	});
}
function R(e, t, n, r = $(e), i = P(n?.cacheRetention, n?.env), a = s(t.tools, r.supportsOpenAIGrammarTools)) {
	let o = Y(e, t, r, { grammarToolInputProperties: a }), c = V(r, i), l = {
		model: e.id,
		messages: o,
		stream: !0,
		prompt_cache_key: e.baseUrl.includes("api.openai.com") && i !== "none" || i === "long" && r.supportsLongCacheRetention ? S(n?.sessionId) : void 0,
		prompt_cache_retention: i === "long" && r.supportsLongCacheRetention ? "24h" : void 0
	};
	r.supportsUsageInStreaming !== !1 && (l.stream_options = { include_usage: !0 }), r.supportsStore && (l.store = !1), n?.maxTokens && (r.maxTokensField === "max_tokens" ? l.max_tokens = n.maxTokens : l.max_completion_tokens = n.maxTokens), n?.temperature !== void 0 && (l.temperature = n.temperature);
	let u = r.deferredToolsMode === "kimi" ? D(t.messages) : /* @__PURE__ */ new Set(), d = t.tools?.filter((e) => !u.has(e.name));
	if (d && d.length > 0 ? (l.tools = X(d, r), r.zaiToolStream && (l.tool_stream = !0)) : E(t.messages) && (l.tools = []), c && H(o, l.tools, c), n?.toolChoice && (l.tool_choice = n.toolChoice), r.thinkingFormat === "zai" && e.reasoning) {
		let t = l;
		if (t.thinking = n?.reasoningEffort ? {
			type: "enabled",
			clear_thinking: !1
		} : { type: "disabled" }, n?.reasoningEffort && r.supportsReasoningEffort) {
			let r = e.thinkingLevelMap?.[n.reasoningEffort], i = r === void 0 ? n.reasoningEffort : r;
			typeof i == "string" && (t.reasoning_effort = i);
		}
	} else if (r.thinkingFormat === "qwen" && e.reasoning) {
		if (l.enable_thinking = !!n?.reasoningEffort, n?.reasoningEffort && r.supportsReasoningEffort) {
			let t = e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort;
			typeof t == "string" && (l.reasoning_effort = t);
		}
	} else if (r.thinkingFormat === "qwen-chat-template" && e.reasoning) l.chat_template_kwargs = {
		enable_thinking: !!n?.reasoningEffort,
		preserve_thinking: !0
	};
	else if (r.thinkingFormat === "chat-template" && e.reasoning) {
		let t = z(e, n, r.chatTemplateKwargs);
		t && (l.chat_template_kwargs = t);
	} else if (r.thinkingFormat === "baseten" && e.reasoning) {
		let t = l, i = z(e, n, r.chatTemplateArgs);
		if (i && (t.chat_template_args = i), r.supportsReasoningEffort) {
			let r = n?.reasoningEffort, i = r ? e.thinkingLevelMap?.[r] : e.thinkingLevelMap?.off, a = i === void 0 ? r : i;
			typeof a == "string" && (t.reasoning_effort = a);
		}
	} else if (r.thinkingFormat === "deepseek" && e.reasoning) n?.reasoningEffort ? l.thinking = { type: "enabled" } : e.thinkingLevelMap?.off !== null && (l.thinking = { type: "disabled" }), n?.reasoningEffort && r.supportsReasoningEffort && (l.reasoning_effort = e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort);
	else if (r.thinkingFormat === "openrouter" && e.reasoning) {
		let t = l;
		n?.reasoningEffort ? t.reasoning = { effort: e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort } : e.thinkingLevelMap?.off !== null && (t.reasoning = { effort: e.thinkingLevelMap?.off ?? "none" });
	} else if (r.thinkingFormat === "ant-ling" && e.reasoning && n?.reasoningEffort) {
		let t = e.thinkingLevelMap?.[n.reasoningEffort];
		typeof t == "string" && (l.reasoning = { effort: t });
	} else if (r.thinkingFormat === "together" && e.reasoning) {
		let t = l;
		t.reasoning = { enabled: !!n?.reasoningEffort }, n?.reasoningEffort && r.supportsReasoningEffort && (t.reasoning_effort = e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort);
	} else if (r.thinkingFormat === "string-thinking" && e.reasoning) {
		let t = l;
		n?.reasoningEffort ? t.thinking = e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort : e.thinkingLevelMap?.off !== null && (t.thinking = e.thinkingLevelMap?.off ?? "none");
	} else if (n?.reasoningEffort && e.reasoning && r.supportsReasoningEffort) l.reasoning_effort = e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort;
	else if (!n?.reasoningEffort && e.reasoning && r.supportsReasoningEffort) {
		let t = e.thinkingLevelMap?.off;
		typeof t == "string" && (l.reasoning_effort = t);
	}
	if (r.supportsThinkingTokenBudget && n?.reasoningEffort && e.reasoning) {
		let t = p(n.reasoningEffort), r = {
			minimal: 1024,
			low: 2048,
			medium: 8192,
			high: 16384,
			...n.thinkingBudgets
		}, i = l.max_tokens ?? l.max_completion_tokens ?? e.maxTokens, a = Math.min(r[t], Math.max(0, i - f));
		a > 0 && (l.thinking_token_budget = a);
	}
	if (e.compat?.openRouterRouting && (l.provider = e.compat.openRouterRouting), e.compat?.vercelGatewayRouting) {
		let t = e.compat.vercelGatewayRouting;
		if (t.only || t.order) {
			let e = {};
			t.only && (e.only = t.only), t.order && (e.order = t.order), l.providerOptions = { gateway: e };
		}
	}
	return n?.samplingParams && Object.assign(l, n.samplingParams), l;
}
function z(e, t, n) {
	let r = {};
	for (let [i, a] of Object.entries(n)) {
		let n = B(e, t, a);
		n !== void 0 && (r[i] = n);
	}
	return Object.keys(r).length > 0 ? r : void 0;
}
function B(e, t, n) {
	if (typeof n != "object" || !n) return n;
	let r = t?.reasoningEffort;
	if (!r && n.omitWhenOff) return;
	if (n.$var === "thinking.enabled") return !!r;
	let i = r ? e.thinkingLevelMap?.[r] : e.thinkingLevelMap?.off;
	return i === void 0 ? r : typeof i == "string" ? i : void 0;
}
function V(e, t) {
	if (e.cacheControlFormat !== "anthropic" || t === "none") return;
	let n = t === "long" && e.supportsLongCacheRetention ? "1h" : void 0;
	return {
		type: "ephemeral",
		...n ? { ttl: n } : {}
	};
}
function H(e, t, n) {
	U(e, n), G(t, n), W(e, n);
}
function U(e, t) {
	for (let n of e) if (n.role === "system" || n.role === "developer") {
		K(n, t);
		return;
	}
}
function W(e, t) {
	for (let n = e.length - 1; n >= 0; n--) {
		let r = e[n];
		if ((r.role === "user" || r.role === "assistant" || r.role === "tool") && q(r, t)) return;
	}
}
function G(e, t) {
	if (!e || e.length === 0) return;
	let n = e[e.length - 1];
	n.cache_control = t;
}
function K(e, t) {
	return J(e, t);
}
function q(e, t) {
	return e.role === "user" || e.role === "assistant" || e.role === "tool" ? J(e, t) : !1;
}
function J(e, t) {
	let n = e.content;
	if (typeof n == "string") return n.length !== 0 && (e.content = [{
		type: "text",
		text: n,
		cache_control: t
	}], !0);
	if (!Array.isArray(n)) return !1;
	for (let e = n.length - 1; e >= 0; e--) {
		let r = n[e];
		if (r?.type === "text") {
			let e = r;
			return e.cache_control = t, !0;
		}
	}
	return !1;
}
function Y(e, t, n, r) {
	let i = [], a = (t) => {
		if (t.includes("|")) {
			let e = t.indexOf("|"), n = t.slice(0, e).replace(/[^a-zA-Z0-9_-]/g, "_"), r = t.slice(e + 1).replace(/[^a-zA-Z0-9_-]/g, "_"), i = r.length > 0 ? `${n}_${r}` : n;
			if (i.length <= 40) return i;
			let a = C(t).slice(0, 8);
			return `${n.slice(0, Math.max(1, 40 - a.length - 1))}_${a}`;
		}
		return e.provider === "openai" && t.length > 40 ? t.slice(0, 40) : t;
	}, o = h(t.messages, e, (e) => a(e));
	if (t.systemPrompt) {
		let r = e.reasoning && n.supportsDeveloperRole ? "developer" : "system";
		i.push({
			role: r,
			content: l(t.systemPrompt)
		});
	}
	let s = null;
	for (let a = 0; a < o.length; a++) {
		let c = o[a];
		if (n.requiresAssistantAfterToolResult && s === "toolResult" && c.role === "user" && i.push({
			role: "assistant",
			content: "I have processed the tool results."
		}), c.role === "user") {
			if (typeof c.content == "string") i.push({
				role: "user",
				content: l(c.content)
			});
			else {
				let e = c.content.map((e) => e.type === "text" ? {
					type: "text",
					text: l(e.text)
				} : {
					type: "image_url",
					image_url: { url: `data:${e.mimeType};base64,${e.data}` }
				});
				if (e.length === 0) continue;
				i.push({
					role: "user",
					content: e
				});
			}
		} else if (c.role === "assistant") {
			let t = {
				role: "assistant",
				content: n.requiresAssistantAfterToolResult ? "" : null
			}, a = c.content.filter(k).filter((e) => e.text.trim().length > 0).map((e) => ({
				type: "text",
				text: l(e.text)
			})), o = a.map((e) => e.text).join(""), s = c.content.filter(A).filter((e) => e.thinking.trim().length > 0);
			if (s.length > 0) {
				if (n.requiresThinkingAsText) t.content = [{
					type: "text",
					text: s.map((e) => l(e.thinking)).join("\n\n")
				}, ...a];
				else {
					o.length > 0 && (t.content = o);
					let n = s[0].thinkingSignature;
					e.provider === "opencode-go" && n === "reasoning" && (n = "reasoning_content"), n && n.length > 0 && (t[n] = s.map((e) => e.thinking).join("\n"));
				}
			} else o.length > 0 && (t.content = o);
			let u = c.content.filter(j);
			if (u.length > 0) {
				t.tool_calls = u.map((e) => {
					let t = r?.grammarToolInputProperties?.get(e.name);
					return t === void 0 ? {
						id: e.id,
						type: "function",
						function: {
							name: e.name,
							arguments: JSON.stringify(e.arguments)
						}
					} : {
						id: e.id,
						type: "custom",
						custom: {
							name: e.name,
							input: l(d(e.name, e.arguments, t))
						}
					};
				});
				let e = u.filter((e) => e.thoughtSignature).map((e) => {
					try {
						return JSON.parse(e.thoughtSignature);
					} catch {
						return null;
					}
				}).filter(Boolean);
				e.length > 0 && (t.reasoning_details = e);
			}
			n.requiresReasoningContentOnAssistantMessages && e.reasoning && t.reasoning_content === void 0 && (t.reasoning_content = "");
			let f = t.content;
			if (!(f != null && f.length > 0) && !t.tool_calls) continue;
			i.push(t);
		} else if (c.role === "toolResult") {
			let r = [], c = /* @__PURE__ */ new Set(), u = a;
			for (; u < o.length && o[u].role === "toolResult"; u++) {
				let t = o[u], a = t.content.filter(k).map((e) => e.text).join("\n"), s = t.content.some((e) => e.type === "image"), d = a.length > 0 ? a : s ? "(see attached image)" : "(no tool output)", f = {
					role: "tool",
					content: l(d),
					tool_call_id: t.toolCallId
				};
				if (n.requiresToolResultName && t.toolName && (f.name = t.toolName), i.push(f), n.deferredToolsMode === "kimi") for (let e of t.addedToolNames ?? []) c.add(e);
				if (s && e.input.includes("image")) for (let e of t.content) M(e) && r.push({
					type: "image_url",
					image_url: { url: `data:${e.mimeType};base64,${e.data}` }
				});
			}
			if (a = u - 1, r.length > 0 ? (n.requiresAssistantAfterToolResult && i.push({
				role: "assistant",
				content: "I have processed the tool results."
			}), i.push({
				role: "user",
				content: [{
					type: "text",
					text: "Attached image(s) from tool result:"
				}, ...r]
			}), s = "user") : s = "toolResult", c.size > 0) {
				let e = O(t.tools, c);
				if (e.length > 0) {
					let t = {
						role: "system",
						tools: X(e, n)
					};
					i.push(t);
				}
			}
			continue;
		}
		s = c.role;
	}
	return i;
}
function X(e, t) {
	return e.map((e) => {
		let n = g(e, t.supportsOpenAIGrammarTools);
		if (n) return {
			type: "custom",
			custom: {
				name: e.name,
				description: e.description,
				format: {
					type: "grammar",
					grammar: {
						syntax: n.format,
						definition: n.definition
					}
				}
			}
		};
		let r = c(e, t.supportsStrictMode !== !1);
		return {
			type: "function",
			function: {
				name: e.name,
				description: e.description,
				parameters: e.parameters,
				...t.supportsStrictMode !== !1 && { strict: r ?? !1 }
			}
		};
	});
}
function Z(e, n) {
	let r = e.prompt_tokens || 0, i = e.prompt_tokens_details?.cached_tokens ?? e.prompt_cache_hit_tokens ?? 0, a = e.prompt_tokens_details?.cache_write_tokens || 0, o = Math.max(0, r - i - a), s = e.completion_tokens || 0, c = {
		input: o,
		output: s,
		cacheRead: i,
		cacheWrite: a,
		reasoning: e.completion_tokens_details?.reasoning_tokens || 0,
		totalTokens: o + s + i + a,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
	return t(n, c), c;
}
function Q(e) {
	if (e === null) return { stopReason: "stop" };
	switch (e) {
		case "stop":
		case "end": return { stopReason: "stop" };
		case "length": return { stopReason: "length" };
		case "function_call":
		case "tool_calls": return { stopReason: "toolUse" };
		case "content_filter": return {
			stopReason: "error",
			errorMessage: "Provider finish_reason: content_filter"
		};
		case "network_error": return {
			stopReason: "error",
			errorMessage: "Provider finish_reason: network_error"
		};
		default: return {
			stopReason: "error",
			errorMessage: `Provider finish_reason: ${e}`
		};
	}
}
function ee(e) {
	let t = e.provider, n = e.baseUrl, r = t === "zai" || t === "zai-coding-cn" || n.includes("api.z.ai") || n.includes("open.bigmodel.cn"), i = t === "together" || n.includes("api.together.ai") || n.includes("api.together.xyz"), a = t === "moonshotai" || t === "moonshotai-cn" || n.includes("api.moonshot."), o = t === "openrouter" || n.includes("openrouter.ai"), s = t === "cloudflare-workers-ai" || n.includes("api.cloudflare.com"), c = t === "cloudflare-ai-gateway" || n.includes("gateway.ai.cloudflare.com"), l = t === "nvidia" || n.includes("integrate.api.nvidia.com"), u = t === "ant-ling" || n.includes("api.ant-ling.com"), d = l || t === "cerebras" || n.includes("cerebras.ai") || t === "xai" || n.includes("api.x.ai") || i || n.includes("chutes.ai") || n.includes("deepseek.com") || r || a || t === "opencode" || n.includes("opencode.ai") || s || c || u, f = n.includes("chutes.ai") || a || c || i || l || u || r, p = t === "xai" || n.includes("api.x.ai"), m = t === "deepseek" || n.includes("deepseek.com"), h = o && (e.id.startsWith("anthropic/") || e.id.startsWith("openai/")), g = t === "openrouter" && e.id.startsWith("anthropic/") ? "anthropic" : void 0;
	return {
		supportsStore: !d,
		supportsDeveloperRole: h || !d && !o,
		supportsReasoningEffort: !p && !r && !a && !i && !c && !l && !u,
		supportsUsageInStreaming: !0,
		supportsFinishReason: !0,
		maxTokensField: f ? "max_tokens" : "max_completion_tokens",
		requiresToolResultName: !1,
		requiresAssistantAfterToolResult: !1,
		requiresThinkingAsText: !1,
		requiresReasoningContentOnAssistantMessages: m,
		thinkingFormat: m ? "deepseek" : r ? "zai" : i ? "together" : u ? "ant-ling" : o ? "openrouter" : "openai",
		openRouterRouting: {},
		vercelGatewayRouting: {},
		chatTemplateKwargs: {},
		chatTemplateArgs: {},
		zaiToolStream: !1,
		supportsThinkingTokenBudget: !1,
		supportsStrictMode: !a && !i && !c && !l,
		supportsOpenAIGrammarTools: !1,
		cacheControlFormat: g,
		sendSessionAffinityHeaders: !1,
		deferredToolsMode: void 0,
		sessionAffinityFormat: o ? "openrouter" : "openai",
		supportsLongCacheRetention: !(i || s || c || l || u)
	};
}
function $(e) {
	let t = ee(e);
	return e.compat ? {
		supportsStore: e.compat.supportsStore ?? t.supportsStore,
		supportsDeveloperRole: e.compat.supportsDeveloperRole ?? t.supportsDeveloperRole,
		supportsReasoningEffort: e.compat.supportsReasoningEffort ?? t.supportsReasoningEffort,
		supportsUsageInStreaming: e.compat.supportsUsageInStreaming ?? t.supportsUsageInStreaming,
		supportsFinishReason: e.compat.supportsFinishReason ?? t.supportsFinishReason,
		maxTokensField: e.compat.maxTokensField ?? t.maxTokensField,
		requiresToolResultName: e.compat.requiresToolResultName ?? t.requiresToolResultName,
		requiresAssistantAfterToolResult: e.compat.requiresAssistantAfterToolResult ?? t.requiresAssistantAfterToolResult,
		requiresThinkingAsText: e.compat.requiresThinkingAsText ?? t.requiresThinkingAsText,
		requiresReasoningContentOnAssistantMessages: e.compat.requiresReasoningContentOnAssistantMessages ?? t.requiresReasoningContentOnAssistantMessages,
		thinkingFormat: e.compat.thinkingFormat ?? t.thinkingFormat,
		openRouterRouting: e.compat.openRouterRouting ?? {},
		vercelGatewayRouting: e.compat.vercelGatewayRouting ?? t.vercelGatewayRouting,
		chatTemplateKwargs: e.compat.chatTemplateKwargs ?? t.chatTemplateKwargs,
		chatTemplateArgs: e.compat.chatTemplateArgs ?? t.chatTemplateArgs,
		zaiToolStream: e.compat.zaiToolStream ?? t.zaiToolStream,
		supportsThinkingTokenBudget: e.compat.supportsThinkingTokenBudget ?? t.supportsThinkingTokenBudget,
		supportsStrictMode: e.compat.supportsStrictMode ?? t.supportsStrictMode,
		supportsOpenAIGrammarTools: e.compat.supportsOpenAIGrammarTools ?? t.supportsOpenAIGrammarTools,
		cacheControlFormat: e.compat.cacheControlFormat ?? t.cacheControlFormat,
		sendSessionAffinityHeaders: e.compat.sendSessionAffinityHeaders ?? t.sendSessionAffinityHeaders,
		deferredToolsMode: e.compat.deferredToolsMode ?? t.deferredToolsMode,
		sessionAffinityFormat: e.compat.sessionAffinityFormat ?? t.sessionAffinityFormat,
		supportsLongCacheRetention: e.compat.supportsLongCacheRetention ?? t.supportsLongCacheRetention
	} : t;
}
//#endregion
export { Y as convertMessages, F as stream, I as streamSimple };
