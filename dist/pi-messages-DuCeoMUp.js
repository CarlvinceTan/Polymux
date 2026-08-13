import { n as e, r as t, t as n } from "./event-stream-D07JAHnY.js";
import { t as r } from "./provider-env-Do4NyCk3.js";
import { n as i } from "./json-parse-XC7hUTqJ.js";
import { n as a, t as o } from "./headers-CDJ0-DpO.js";
//#region node_modules/@earendil-works/pi-ai/dist/api/pi-messages.js
var s = class extends Error {
	code;
	diagnosticDetails;
	constructor(e, t, n) {
		super(e), this.name = "PiMessagesResponseError", this.code = t, this.diagnosticDetails = n;
	}
};
function c(e) {
	try {
		let t = JSON.parse(e), n = t?.error;
		return t && typeof n == "object" && n && !Array.isArray(n) ? t : void 0;
	} catch {
		return;
	}
}
function l(e) {
	let t = 8192;
	return e.length > t ? `${e.slice(0, t)}…` : e;
}
function u(e, t, n) {
	let r = typeof n?.error?.message == "string" ? n.error.message : void 0, i = typeof n?.error?.code == "string" ? n.error.code : void 0, a = r ?? t, o = i ? ` (${i})` : "";
	return `${e.status} ${e.statusText}: ${a}${o}`;
}
function d(e, t, n, r) {
	let i = c(r), a = typeof i?.error?.code == "string" ? i.error.code : void 0;
	return new s(u(n, r, i), a, {
		version: 1,
		provider: e.provider,
		model: e.id,
		url: t.toString(),
		status: n.status,
		statusText: n.statusText,
		error: i?.error,
		body: i ? void 0 : l(r),
		timestampMs: Date.now()
	});
}
function f() {
	return {
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
	};
}
function p(t, n) {
	n && e(t, {
		type: "pi_messages_rewrite",
		timestamp: Date.now(),
		details: { ...n }
	});
}
function m(e) {
	let t = {
		role: "assistant",
		content: [],
		api: e.api,
		provider: e.provider,
		model: e.id,
		usage: f(),
		stopReason: "pending",
		timestamp: Date.now()
	}, n = /* @__PURE__ */ new Map();
	return (e) => {
		switch (e.type) {
			case "done": return Object.assign(t, {
				stopReason: e.reason,
				usage: e.usage,
				responseId: e.responseId
			}), p(t, e.rewrite), {
				type: "done",
				reason: e.reason,
				message: t
			};
			case "error": return Object.assign(t, {
				stopReason: e.reason,
				usage: e.usage,
				errorMessage: e.errorMessage,
				responseId: e.responseId
			}), p(t, e.rewrite), {
				type: "error",
				reason: e.reason,
				error: t
			};
			case "start": break;
			case "text_start":
				t.content[e.contentIndex] = {
					type: "text",
					text: ""
				};
				break;
			case "text_delta":
				t.content[e.contentIndex].text += e.delta;
				break;
			case "text_end":
				Object.assign(t.content[e.contentIndex], {
					text: e.content,
					textSignature: e.contentSignature
				});
				break;
			case "thinking_start":
				t.content[e.contentIndex] = {
					type: "thinking",
					thinking: ""
				};
				break;
			case "thinking_delta":
				t.content[e.contentIndex].thinking += e.delta;
				break;
			case "thinking_end":
				Object.assign(t.content[e.contentIndex], {
					thinking: e.content,
					thinkingSignature: e.contentSignature,
					redacted: e.redacted
				});
				break;
			case "toolcall_start":
				t.content[e.contentIndex] = {
					type: "toolCall",
					id: e.id,
					name: e.toolName,
					arguments: {}
				}, n.set(e.contentIndex, "");
				break;
			case "toolcall_delta": {
				let r = `${n.get(e.contentIndex) ?? ""}${e.delta}`;
				n.set(e.contentIndex, r), t.content[e.contentIndex].arguments = i(r);
				break;
			}
			case "toolcall_end": return Object.assign(t.content[e.contentIndex], e.toolCall), n.delete(e.contentIndex), {
				type: "toolcall_end",
				contentIndex: e.contentIndex,
				toolCall: t.content[e.contentIndex],
				partial: t
			};
		}
		return {
			...e,
			partial: t
		};
	};
}
async function* h(e) {
	let t = new TextDecoder(), n = e.getReader(), r = "";
	try {
		for (;;) {
			let { done: e, value: i } = await n.read();
			r += e ? t.decode() : t.decode(i, { stream: !0 }), r = r.replace(/\r\n/g, "\n");
			let a = r.indexOf("\n\n");
			for (; a !== -1;) {
				let e = g(r.slice(0, a));
				e && (yield e), r = r.slice(a + 2), a = r.indexOf("\n\n");
			}
			if (e) break;
		}
		if (r.trim()) {
			let e = g(r);
			e && (yield e);
		}
	} finally {
		n.releaseLock();
	}
}
function g(e) {
	let t = e.split("\n").find((e) => e.startsWith("data:"))?.slice(5).trim();
	return t && t !== "[DONE]" ? JSON.parse(t) : void 0;
}
function _(n, r, i) {
	let a = i ? "aborted" : "error", o = {
		role: "assistant",
		content: [],
		api: n.api,
		provider: n.provider,
		model: n.id,
		usage: f(),
		stopReason: a,
		errorMessage: r instanceof Error ? r.message : String(r),
		timestamp: Date.now()
	};
	return !i && r instanceof s && e(o, t("pi_messages_response_failure", r, r.diagnosticDetails)), {
		type: "error",
		reason: a,
		error: o
	};
}
function v(e, t) {
	return e || (r("PI_CACHE_RETENTION", t) === "long" ? "long" : void 0);
}
var y = (e, t, r) => {
	let i = new n(), s = m(e);
	return (async () => {
		try {
			let n = r?.apiKey;
			if (!n) throw Error(`No API key provided for provider "${e.provider}"`);
			let c = new URL(`${e.baseUrl.replace(/\/+$/u, "")}/messages`);
			r?.debug && c.searchParams.set("debug", "1");
			let l = {
				model: e.id,
				context: t,
				options: {
					temperature: r?.temperature,
					maxTokens: r?.maxTokens,
					reasoning: r?.reasoning,
					cacheRetention: v(r?.cacheRetention, r?.env),
					sessionId: r?.sessionId,
					toolChoice: r?.toolChoice
				}
			}, u = await r?.onPayload?.(l, e);
			u !== void 0 && (l = u);
			let f = await (r?.fetch ?? globalThis.fetch)(c, {
				method: "POST",
				headers: {
					authorization: `Bearer ${n}`,
					accept: "text/event-stream",
					"content-type": "application/json",
					...a(r?.headers)
				},
				body: JSON.stringify(l),
				signal: r?.signal
			});
			if (await r?.onResponse?.({
				status: f.status,
				headers: o(f.headers)
			}, e), !f.ok) throw d(e, c, f, await f.text());
			if (!f.body) throw Error(`${e.provider} response has no body`);
			for await (let e of h(f.body)) {
				let t = s(e);
				if (i.push(t), t.type === "done" || t.type === "error") return;
			}
			throw Error(`${e.provider} stream ended without a terminal event`);
		} catch (t) {
			i.push(_(e, t, r?.signal?.aborted ?? !1));
		}
	})(), i;
}, b = (e, t, n) => {
	let r = n;
	return y(e, t, {
		...n,
		reasoning: n?.reasoning,
		toolChoice: r?.toolChoice,
		debug: r?.debug
	});
};
//#endregion
export { s as PiMessagesResponseError, y as stream, b as streamSimple };
