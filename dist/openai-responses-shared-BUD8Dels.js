import { t as e } from "./models-DVvVP5-a.js";
import { n as t } from "./json-parse-XC7hUTqJ.js";
import { d as n, f as r, l as i, s as a, t as o, u as s } from "./transform-messages-Dy7xZPcj.js";
import { t as c } from "./hash-BiTt2yhT.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js
function l(e, t) {
	let n = {
		v: 1,
		id: e
	};
	return t && (n.phase = t), JSON.stringify(n);
}
function u(e) {
	if (e) {
		if (e.startsWith("{")) try {
			let t = JSON.parse(e);
			if (t.v === 1 && typeof t.id == "string") return t.phase === "commentary" || t.phase === "final_answer" ? {
				id: t.id,
				phase: t.phase
			} : { id: t.id };
		} catch {}
		return { id: e };
	}
}
function d(e, t) {
	let n = t.filter((e) => e.type === "text").map((e) => e.text).join("\n"), i = t.filter((e) => e.type === "image"), a = n.length > 0;
	if (i.length === 0 || !e.input.includes("image")) return r(a ? n : i.length > 0 ? "(see attached image)" : "(no tool output)");
	let o = [];
	a && o.push({
		type: "input_text",
		text: r(n)
	});
	for (let e of i) o.push({
		type: "input_image",
		detail: "auto",
		image_url: `data:${e.mimeType};base64,${e.data}`
	});
	return o;
}
function f(e, t, n, a) {
	let s = [], l = /* @__PURE__ */ new Set(), f = (e) => {
		let t = e.replace(/[^a-zA-Z0-9_-]/g, "_");
		return (t.length > 64 ? t.slice(0, 64) : t).replace(/_+$/, "");
	}, m = (e) => {
		let t = `fc_${c(e)}`;
		return t.length > 64 ? t.slice(0, 64) : t;
	}, h = o(t.messages, e, (t, r, i) => {
		if (!n.has(e.provider) || !t.includes("|")) return f(t);
		let [a, o] = t.split("|"), s = f(a), c = i.provider !== e.provider || i.api !== e.api ? m(o) : f(o);
		return c.startsWith("fc_") || (c = f(`fc_${c}`)), `${s}|${c}`;
	});
	if ((a?.includeSystemPrompt ?? !0) && t.systemPrompt) {
		let n = e.compat, i = e.reasoning && n?.supportsDeveloperRole !== !1 ? "developer" : "system";
		s.push({
			role: i,
			content: r(t.systemPrompt)
		});
	}
	let g = 0;
	for (let t of h) {
		if (t.role === "user") {
			if (typeof t.content == "string") s.push({
				role: "user",
				content: [{
					type: "input_text",
					text: r(t.content)
				}]
			});
			else {
				let e = t.content.map((e) => e.type === "text" ? {
					type: "input_text",
					text: r(e.text)
				} : {
					type: "input_image",
					detail: "auto",
					image_url: `data:${e.mimeType};base64,${e.data}`
				});
				if (e.length === 0) continue;
				s.push({
					role: "user",
					content: e
				});
			}
		} else if (t.role === "assistant") {
			let n = [], o = t, l = o.model !== e.id && o.provider === e.provider && o.api === e.api, d = 0;
			for (let e of t.content) if (e.type === "thinking") {
				if (e.thinkingSignature) {
					let t = JSON.parse(e.thinkingSignature);
					n.push(t);
				}
			} else if (e.type === "text") {
				let t = e, i = u(t.textSignature), a = d === 0 ? `msg_pi_${g}` : `msg_pi_${g}_${d}`;
				d++;
				let o = i?.id;
				o ? o.length > 64 && (o = `msg_${c(o)}`) : o = a, n.push({
					type: "message",
					role: "assistant",
					content: [{
						type: "output_text",
						text: r(t.text),
						annotations: []
					}],
					status: "completed",
					id: o,
					phase: i?.phase
				});
			} else if (e.type === "toolCall") {
				let t = e, [o, s] = t.id.split("|"), c = a?.grammarToolInputProperties?.get(t.name), u = s;
				(l && u?.startsWith("fc_") || c === void 0 && !u?.startsWith("fc_")) && (u = void 0), c === void 0 ? n.push({
					type: "function_call",
					id: u,
					call_id: o,
					name: t.name,
					arguments: JSON.stringify(t.arguments)
				}) : n.push({
					type: "custom_tool_call",
					id: u,
					call_id: o,
					name: t.name,
					input: r(i(t.name, t.arguments, c))
				});
			}
			if (n.length === 0) continue;
			s.push(...n);
		} else if (t.role === "toolResult") {
			let [n] = t.toolCallId.split("|"), r = d(e, t.content);
			a?.grammarToolInputProperties?.has(t.toolName) ? s.push({
				type: "custom_tool_call_output",
				call_id: n,
				output: r
			}) : s.push({
				type: "function_call_output",
				call_id: n,
				output: r
			});
			let i = [];
			for (let e of t.addedToolNames ?? []) {
				let t = a?.deferredTools?.get(e);
				!t || l.has(e) || (l.add(e), i.push(t));
			}
			if (i.length > 0) {
				let e = i.map((e) => e.name), n = `pi_tool_load_${c(`${t.toolCallId}:${e.join(",")}`)}`;
				s.push({
					type: "tool_search_call",
					call_id: n,
					execution: "client",
					status: "completed",
					arguments: {
						query: e.join(" "),
						limit: e.length
					}
				}), s.push({
					type: "tool_search_output",
					call_id: n,
					execution: "client",
					status: "completed",
					tools: p(i, {
						...a?.toolOptions,
						deferLoading: !0
					})
				});
			}
		}
		g++;
	}
	return s;
}
function p(e, t) {
	let r = t?.strict !== void 0 && t.strict, i = t?.supportsStrictMode ?? !0, a = t?.supportsOpenAIGrammarTools ?? !1;
	return e.map((e) => {
		let o = s(e, a);
		if (o) return {
			type: "custom",
			name: e.name,
			description: e.description,
			format: {
				type: "grammar",
				syntax: o.format,
				definition: o.definition
			},
			...t?.deferLoading ? { defer_loading: !0 } : {}
		};
		let c = n(e, i), l = {
			type: "function",
			name: e.name,
			description: e.description,
			parameters: e.parameters,
			...t?.deferLoading ? { defer_loading: !0 } : {}
		};
		return i && (l.strict = c ?? r), l;
	});
}
function m(e) {
	let t = e.customInput?.property;
	if (t === void 0) return "";
	let n = e.arguments[t];
	return typeof n == "string" ? n : "";
}
function h(e, t, n) {
	let r = e.customInput;
	if (!r) return;
	let i = a(r.jsonBuffer, r.property, t, n);
	return e.arguments = { [r.property]: t }, i;
}
async function g(n, r, i, a, o) {
	let s = !1, c = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), d = (e) => {
		e.type === "message" && e.phase === "final_answer" && (r.stopReason = "stop");
	}, f = (e, t) => {
		let n = c.get(e);
		return n?.type === t ? n : void 0;
	}, p = (e, t) => {
		t !== void 0 && i.push({
			type: "toolcall_delta",
			contentIndex: e.contentIndex,
			delta: t,
			partial: r
		});
	}, g = (e, t) => {
		if (t.type === "reasoning") {
			let t = {
				type: "thinking",
				thinking: ""
			};
			r.content.push(t);
			let n = {
				type: "thinking",
				block: t,
				contentIndex: r.content.length - 1
			};
			return c.set(e, n), i.push({
				type: "thinking_start",
				contentIndex: n.contentIndex,
				partial: r
			}), n;
		}
		if (t.type === "message") {
			d(t);
			let n = {
				type: "text",
				text: ""
			};
			r.content.push(n);
			let a = {
				type: "text",
				block: n,
				contentIndex: r.content.length - 1
			};
			return c.set(e, a), i.push({
				type: "text_start",
				contentIndex: a.contentIndex,
				partial: r
			}), a;
		}
		if (t.type === "function_call") {
			let n = {
				type: "toolCall",
				id: `${t.call_id}|${t.id}`,
				name: t.name,
				arguments: {},
				partialJson: t.arguments || ""
			};
			r.content.push(n);
			let a = {
				type: "toolCall",
				block: n,
				contentIndex: r.content.length - 1
			};
			return c.set(e, a), i.push({
				type: "toolcall_start",
				contentIndex: a.contentIndex,
				partial: r
			}), a;
		}
		if (t.type === "custom_tool_call") {
			let n = o?.grammarToolInputProperties?.get(t.name) ?? "input", a = t.input || "", s = {
				type: "toolCall",
				id: `${t.call_id}|${t.id}`,
				name: t.name,
				arguments: { [n]: a },
				customInput: {
					property: n,
					jsonBuffer: {
						input: "",
						started: !1,
						closed: !1
					}
				}
			};
			r.content.push(s);
			let l = {
				type: "toolCall",
				block: s,
				contentIndex: r.content.length - 1
			};
			return c.set(e, l), i.push({
				type: "toolcall_start",
				contentIndex: l.contentIndex,
				partial: r
			}), l;
		}
	}, v = (e, t) => c.get(e) ?? g(e, t), y = (e) => {
		for (let t of e) {
			if (t.type !== "reasoning" || !t.encrypted_content) continue;
			let e = u.get(t.id);
			if (!e?.thinkingSignature) continue;
			let n = JSON.parse(e.thinkingSignature);
			n.encrypted_content || (e.thinkingSignature = JSON.stringify({
				...n,
				encrypted_content: t.encrypted_content
			}));
		}
	}, b = (t) => {
		if (s = !0, y(t.output ?? []), t?.id && (r.responseId = t.id), t?.usage) {
			let e = t.usage.input_tokens_details, n = e?.cached_tokens || 0, i = e?.cache_write_tokens || 0;
			r.usage = {
				input: Math.max(0, (t.usage.input_tokens || 0) - n - i),
				output: t.usage.output_tokens || 0,
				cacheRead: n,
				cacheWrite: i,
				reasoning: t.usage.output_tokens_details?.reasoning_tokens || 0,
				totalTokens: t.usage.total_tokens || 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			};
		}
		if (e(a, r.usage), o?.applyServiceTierPricing) {
			let e = o.resolveServiceTier ? o.resolveServiceTier(t?.service_tier, o.serviceTier) : t?.service_tier ?? o.serviceTier;
			o.applyServiceTierPricing(r.usage, e);
		}
		let n = t?.status, i = t?.incomplete_details, c = typeof i?.reason == "string" ? i.reason : void 0;
		r.rawStopReason = c ? `${n}.${c}` : n;
		let l = _(n, c);
		r.stopReason = l.stopReason, r.errorMessage = l.errorMessage, r.content.some((e) => e.type === "toolCall") && r.stopReason === "stop" && (r.stopReason = "toolUse");
	};
	for await (let e of n) if (e.type === "response.created") r.responseId = e.response.id;
	else if (e.type === "response.output_item.added") g(e.output_index, e.item);
	else if (e.type === "response.reasoning_summary_text.delta") {
		let t = f(e.output_index, "thinking");
		if (!t) continue;
		t.block.thinking += e.delta, i.push({
			type: "thinking_delta",
			contentIndex: t.contentIndex,
			delta: e.delta,
			partial: r
		});
	} else if (e.type === "response.reasoning_summary_part.done") {
		let t = f(e.output_index, "thinking");
		if (!t) continue;
		t.block.thinking += "\n\n", i.push({
			type: "thinking_delta",
			contentIndex: t.contentIndex,
			delta: "\n\n",
			partial: r
		});
	} else if (e.type === "response.reasoning_text.delta") {
		let t = f(e.output_index, "thinking");
		if (!t) continue;
		t.block.thinking += e.delta, i.push({
			type: "thinking_delta",
			contentIndex: t.contentIndex,
			delta: e.delta,
			partial: r
		});
	} else if (e.type === "response.output_text.delta") {
		let t = f(e.output_index, "text");
		if (!t) continue;
		t.block.text += e.delta, i.push({
			type: "text_delta",
			contentIndex: t.contentIndex,
			delta: e.delta,
			partial: r
		});
	} else if (e.type === "response.refusal.delta") {
		let t = f(e.output_index, "text");
		if (!t) continue;
		t.block.text += e.delta, i.push({
			type: "text_delta",
			contentIndex: t.contentIndex,
			delta: e.delta,
			partial: r
		});
	} else if (e.type === "response.function_call_arguments.delta") {
		let n = f(e.output_index, "toolCall");
		if (!n || n.block.partialJson === void 0) continue;
		n.block.partialJson += e.delta, n.block.arguments = t(n.block.partialJson), p(n, e.delta);
	} else if (e.type === "response.function_call_arguments.done") {
		let n = f(e.output_index, "toolCall");
		if (!n || n.block.partialJson === void 0) continue;
		let r = n.block.partialJson;
		if (n.block.partialJson = e.arguments, n.block.arguments = t(n.block.partialJson), e.arguments.startsWith(r)) {
			let t = e.arguments.slice(r.length);
			t.length > 0 && p(n, t);
		}
	} else if (e.type === "response.custom_tool_call_input.delta") {
		let t = f(e.output_index, "toolCall");
		if (!t || !t.block.customInput) continue;
		p(t, h(t.block, m(t.block) + e.delta, !1));
	} else if (e.type === "response.custom_tool_call_input.done") {
		let t = f(e.output_index, "toolCall");
		if (!t || !t.block.customInput) continue;
		p(t, h(t.block, e.input, !0));
	} else if (e.type === "response.output_item.done") {
		let n = e.item;
		d(n);
		let a = v(e.output_index, n);
		if (n.type === "reasoning" && a?.type === "thinking") {
			let t = n.summary?.map((e) => e.text).join("\n\n") || "", o = n.content?.map((e) => e.text).join("\n\n") || "";
			a.block.thinking = t || o || a.block.thinking, a.block.thinkingSignature = JSON.stringify(n), u.set(n.id, a.block), i.push({
				type: "thinking_end",
				contentIndex: a.contentIndex,
				content: a.block.thinking,
				partial: r
			}), c.delete(e.output_index);
		} else n.type === "message" && a?.type === "text" ? (a.block.text = n.content?.map((e) => e.type === "output_text" ? e.text : e.refusal).join("") || "", a.block.textSignature = l(n.id, n.phase ?? void 0), i.push({
			type: "text_end",
			contentIndex: a.contentIndex,
			content: a.block.text,
			partial: r
		}), c.delete(e.output_index)) : n.type === "function_call" && a?.type === "toolCall" && a.block.partialJson !== void 0 ? (a.block.arguments = t(n.arguments || a.block.partialJson || "{}"), delete a.block.partialJson, i.push({
			type: "toolcall_end",
			contentIndex: a.contentIndex,
			toolCall: a.block,
			partial: r
		}), c.delete(e.output_index)) : n.type === "custom_tool_call" && a?.type === "toolCall" && a.block.customInput && (p(a, h(a.block, n.input ?? m(a.block), !0)), delete a.block.customInput, i.push({
			type: "toolcall_end",
			contentIndex: a.contentIndex,
			toolCall: a.block,
			partial: r
		}), c.delete(e.output_index));
	} else if (e.type === "response.completed" || e.type === "response.incomplete") b(e.response);
	else if (e.type === "error") throw Error(`Error Code ${e.code}: ${e.message}` || "Unknown error");
	else if (e.type === "response.failed") {
		s = !0, r.rawStopReason = e.response?.status;
		let t = e.response?.error, n = e.response?.incomplete_details, i = t ? `${t.code || "unknown"}: ${t.message || "no message"}` : n?.reason ? `incomplete: ${n.reason}` : "Unknown error (no error details in response)";
		throw Error(i);
	}
	if (!s) throw Error("OpenAI Responses stream ended before a terminal response event");
}
function _(e, t) {
	if (!e) return { stopReason: "stop" };
	switch (e) {
		case "completed": return { stopReason: "stop" };
		case "incomplete": return t === "max_output_tokens" ? { stopReason: "length" } : {
			stopReason: "error",
			errorMessage: t ? `Response incomplete: ${t}` : "Response incomplete without a provider reason"
		};
		case "failed":
		case "cancelled": return { stopReason: "error" };
		case "in_progress":
		case "queued": return { stopReason: "stop" };
		default: throw Error(`Unhandled stop reason: ${e}`);
	}
}
//#endregion
export { p as n, g as r, f as t };
