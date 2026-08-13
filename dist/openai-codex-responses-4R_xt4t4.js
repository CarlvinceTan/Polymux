import { n as e } from "./models-DVvVP5-a.js";
import { i as t, n, r, t as i } from "./event-stream-D07JAHnY.js";
import { t as a } from "./provider-env-Do4NyCk3.js";
import { t as o } from "./deferred-tools-BbPJenDp.js";
import { t as s } from "./headers-CDJ0-DpO.js";
import { c, i as l } from "./transform-messages-Dy7xZPcj.js";
import { n as u, t as d } from "./error-body-CM5fnCCS.js";
import { t as f } from "./openai-prompt-cache-CfeHqFRG.js";
import { n as p, r as m, t as h } from "./openai-responses-shared-BUD8Dels.js";
//#region node_modules/@earendil-works/pi-ai/dist/session-resources.js
var g = /* @__PURE__ */ new Set();
function _(e) {
	return g.add(e), () => {
		g.delete(e);
	};
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/utils/uuid.js
var v = -Infinity, y = 0;
function b(e) {
	if (globalThis.crypto?.getRandomValues) {
		globalThis.crypto.getRandomValues(e);
		return;
	}
	for (let t = 0; t < e.length; t++) e[t] = Math.floor(Math.random() * 256);
}
function x() {
	let e = /* @__PURE__ */ new Uint8Array(16);
	b(e);
	let t = Date.now();
	t > v ? (y = e[6] * 16777216 + e[7] * 65536 + e[8] * 256 + e[9], v = t) : (y = y + 1 >>> 0, y === 0 && v++);
	let n = /* @__PURE__ */ new Uint8Array(16);
	n[0] = v / 1099511627776 & 255, n[1] = v / 4294967296 & 255, n[2] = v / 16777216 & 255, n[3] = v / 65536 & 255, n[4] = v / 256 & 255, n[5] = v & 255, n[6] = 112 | y >>> 28 & 15, n[7] = y >>> 20 & 255, n[8] = 128 | y >>> 14 & 63, n[9] = y >>> 6 & 255, n[10] = (y & 63) << 2 | e[10] & 3, n[11] = e[11], n[12] = e[12], n[13] = e[13], n[14] = e[14], n[15] = e[15];
	let r = Array.from(n, (e) => e.toString(16).padStart(2, "0"));
	return `${r.slice(0, 4).join("")}-${r.slice(4, 6).join("")}-${r.slice(6, 8).join("")}-${r.slice(8, 10).join("")}-${r.slice(10, 16).join("")}`;
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/utils/abort-signals.js
function S(e) {
	let t = e.filter((e) => e !== void 0);
	if (t.length === 0) return { cleanup: () => {} };
	if (t.length === 1) return {
		signal: t[0],
		cleanup: () => {}
	};
	let n = new AbortController(), r = [], i = (e) => {
		n.signal.aborted || n.abort(e.reason);
	};
	for (let e of t) {
		if (e.aborted) {
			i(e);
			break;
		}
		let t = () => i(e);
		e.addEventListener("abort", t, { once: !0 }), r.push({
			signal: e,
			listener: t
		});
	}
	return {
		signal: n.signal,
		cleanup: () => {
			for (let { signal: e, listener: t } of r) e.removeEventListener("abort", t);
		}
	};
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/utils/node-http-proxy.js
var C = {
	ftp: 21,
	gopher: 70,
	http: 80,
	https: 443,
	ws: 80,
	wss: 443
};
function w(e, t) {
	let n = e.toLowerCase(), r = e.toUpperCase();
	return t?.[n] || t?.[r] || a(n) || a(r) || "";
}
function T(e) {
	if (e instanceof URL) return e;
	try {
		return new URL(e);
	} catch {
		return;
	}
}
function E(e, t, n) {
	let r = w("no_proxy", n).toLowerCase();
	return !r || r !== "*" && r.split(/[,\s]/).every((n) => {
		if (!n) return !0;
		let r = n.match(/^(.+):(\d+)$/), i = r ? r[1] : n, a = r ? Number.parseInt(r[2], 10) : 0;
		return a && a !== t ? !0 : /^[.*]/.test(i) ? (i.startsWith("*") && (i = i.slice(1)), !e.endsWith(i)) : e !== i;
	});
}
function D(e, t) {
	let n = T(e);
	if (!n?.protocol || !n.host) return "";
	let r = n.protocol.split(":", 1)[0];
	if (!E(n.host.replace(/:\d*$/, ""), Number.parseInt(n.port, 10) || C[r] || 0, t)) return "";
	let i = w(`${r}_proxy`, t) || w("all_proxy", t);
	return i && !i.includes("://") && (i = `${r}://${i}`), i;
}
var O = "Unsupported proxy protocol. SOCKS and PAC proxy URLs are not supported; use an HTTP or HTTPS proxy URL.";
function k(e, t) {
	let n = D(e, t);
	if (!n) return;
	let r;
	try {
		r = new URL(n);
	} catch (e) {
		throw Error(`Invalid proxy URL ${JSON.stringify(n)}: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (r.protocol !== "http:" && r.protocol !== "https:") throw Error(`${O} Got ${r.protocol}`);
	return r;
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js
function A() {
	return typeof process > "u" || !(process.versions?.node || process.versions?.bun) ? null : process.getBuiltinModule?.("node:os") ?? null;
}
var j = A(), M = "https://chatgpt.com/backend-api", ee = "https://api.openai.com/auth", te = 0, N = 1e3, ne = 6e4, re = 15e3, ie = 3, ae = /* @__PURE__ */ new Set([
	"openai",
	"openai-codex",
	"opencode"
]), oe = 1009, se = "websocket_connection_limit_reached", ce = "previous_response_not_found", le = /* @__PURE__ */ new Set([
	"completed",
	"incomplete",
	"failed",
	"cancelled",
	"queued",
	"in_progress"
]);
function P(e) {
	if (e.stopReason === "pending") throw Error("Codex stream ended without a stop reason");
	if (e.stopReason === "error" || e.stopReason === "aborted") throw Error(e.errorMessage || "An unknown error occurred");
}
function ue(e) {
	return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(e);
}
function de(e, t) {
	return e === 429 && ue(t) ? !1 : e === 429 || e === 500 || e === 502 || e === 503 || e === 504 || /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(t);
}
function fe(e) {
	let t = e.get("retry-after-ms");
	if (t !== null) {
		let e = Number(t);
		if (Number.isFinite(e)) return Math.max(0, e);
	}
	let n = e.get("retry-after");
	if (!n) return;
	let r = Number(n);
	if (Number.isFinite(r)) return Math.max(0, r * 1e3);
	let i = Date.parse(n);
	if (!Number.isNaN(i)) return Math.max(0, i - Date.now());
}
var F = class extends Error {};
function pe(e, t) {
	let n = t?.maxRetryDelayMs ?? ne;
	if (n > 0 && e > n) throw new F(`Server requested ${Math.ceil(e / 1e3)}s retry delay (max: ${Math.ceil(n / 1e3)}s)`);
	return e;
}
function I(e, t) {
	return new Promise((n, r) => {
		if (t?.aborted) {
			r(/* @__PURE__ */ Error("Request was aborted"));
			return;
		}
		let i = setTimeout(n, e);
		t?.addEventListener("abort", () => {
			clearTimeout(i), r(/* @__PURE__ */ Error("Request was aborted"));
		});
	});
}
function L(e) {
	if (e !== void 0) {
		if (!Number.isFinite(e) || e < 0) throw Error(`Invalid timeoutMs: ${String(e)}`);
		return Math.floor(e);
	}
}
function me() {
	return typeof process > "u" || !(process.versions?.node || process.versions?.bun) ? null : process.getBuiltinModule?.("node:zlib") ?? null;
}
function he(e) {
	let t = me();
	if (!t || typeof t.zstdCompressSync != "function") return null;
	try {
		let n = t.zstdCompressSync(e, { params: { [t.constants.ZSTD_c_compressionLevel]: ie } });
		return new Uint8Array(n.buffer, n.byteOffset, n.byteLength);
	} catch {
		return null;
	}
}
var R = (e, t, a) => {
	let o = new i();
	return (async () => {
		let i = {
			role: "assistant",
			content: [],
			api: "openai-codex-responses",
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
			let l = a?.apiKey;
			if (!l) throw Error(`No API key for provider: ${e.provider}`);
			let u = $e(l), d = c(t.tools, e.compat?.supportsOpenAIGrammarTools ?? !1), p = a?.cacheRetention === "none" ? void 0 : a?.sessionId, m = f(p), h = _e(e, t, a, m, d), g = await a?.onPayload?.(h, e);
			g !== void 0 && (h = g);
			let _ = m || x(), v = tt(e.headers, a?.headers, u, l, m), y = nt(e.headers, a?.headers, u, l, _), b = JSON.stringify(h), C = L(a?.timeoutMs), w = L(a?.websocketConnectTimeoutMs), T = a?.transport || "auto", E = !1, D = T !== "sse" && Ne(p);
			if (D && Pe(p), T !== "sse" && !D) {
				let t = !1, s = !1, c = !1;
				for (;;) {
					t = !1;
					try {
						if (await Ze(ye(e.baseUrl), h, y, i, o, e, () => {
							t = !0, E || (E = !0, o.push({
								type: "start",
								partial: i
							}));
						}, C, w, p, u, d, a), a?.signal?.aborted) throw Error("Request was aborted");
						P(i), o.push({
							type: "done",
							reason: i.stopReason,
							message: i
						}), o.end();
						return;
					} catch (e) {
						let o = a?.signal?.aborted, l = !t && Se(e), u = Ce(e);
						if (!o && u && !c) {
							c = !0;
							continue;
						}
						if (!o && l && !s) {
							s = !0;
							continue;
						}
						if (o || xe(e) && !l || (n(i, r("provider_transport_failure", e, {
							configuredTransport: T,
							fallbackTransport: t ? void 0 : "sse",
							eventsEmitted: t,
							phase: t ? "after_message_stream_start" : "before_message_stream_start",
							requestBytes: new TextEncoder().encode(b).byteLength
						})), Fe(p, e), t)) throw e;
						Pe(p);
						break;
					}
				}
			}
			let O = he(b);
			O && v.set("content-encoding", "zstd");
			let k = O ?? b, A, j, M = a?.maxRetries ?? te;
			for (let t = 0; t <= M; t++) {
				if (a?.signal?.aborted) throw Error("Request was aborted");
				try {
					let n = C !== void 0 && C > 0 ? AbortSignal.timeout(C) : void 0, r = S([a?.signal, n]);
					try {
						A = await (a?.fetch ?? globalThis.fetch)(V(e.baseUrl), {
							method: "POST",
							headers: v,
							body: k,
							signal: r.signal
						});
					} catch (e) {
						throw n?.aborted && !a?.signal?.aborted ? Error(`Codex SSE response headers timed out after ${C}ms`) : e;
					} finally {
						r.cleanup();
					}
					if (await a?.onResponse?.({
						status: A.status,
						headers: s(A.headers)
					}, e), A.ok) break;
					let i = await A.text();
					if (t < M && de(A.status, i)) {
						let e = fe(A.headers);
						await I(e === void 0 ? N * 2 ** t : pe(e, a), a?.signal);
						continue;
					}
					let o = await Qe(new Response(i, {
						status: A.status,
						statusText: A.statusText
					}));
					throw Error(o.friendlyMessage || o.message);
				} catch (e) {
					if (e instanceof Error && (e.name === "AbortError" || e.message === "Request was aborted")) throw Error("Request was aborted");
					if (j = e instanceof Error ? e : Error(String(e)), t < M && !(j instanceof F) && !j.message.includes("usage limit")) {
						await I(N * 2 ** t, a?.signal);
						continue;
					}
					throw j;
				}
			}
			if (!A?.ok) throw j ?? /* @__PURE__ */ Error("Failed after retries");
			if (!A.body) throw Error("No response body");
			if (E || (E = !0, o.push({
				type: "start",
				partial: i
			})), await be(A, i, o, e, d, a), a?.signal?.aborted) throw Error("Request was aborted");
			P(i), o.push({
				type: "done",
				reason: i.stopReason,
				message: i
			}), o.end();
		} catch (e) {
			for (let e of i.content) delete e.partialJson, delete e.customInput;
			i.stopReason = a?.signal?.aborted ? "aborted" : "error", i.errorMessage = d(u(e)), o.push({
				type: "error",
				reason: i.stopReason,
				error: i
			}), o.end();
		}
	})(), o;
}, ge = (t, n, r) => {
	let i = r?.apiKey;
	if (!i) throw Error(`No API key for provider: ${t.provider}`);
	let a = l(t, n, r, i), o = r?.reasoning ? e(t, r.reasoning) : void 0, s = o === "off" ? void 0 : o;
	return R(t, n, {
		...a,
		reasoningEffort: s
	});
};
function _e(e, t, n, r, i = c(t.tools, e.compat?.supportsOpenAIGrammarTools ?? !1)) {
	let a = e.compat?.supportsStrictMode ?? !0, s = e.compat?.supportsOpenAIGrammarTools ?? !1, l = o(t, e.compat?.supportsToolSearch ?? !1), u = h(e, t, ae, {
		includeSystemPrompt: !1,
		grammarToolInputProperties: i,
		deferredTools: l.deferred,
		toolOptions: {
			strict: null,
			supportsStrictMode: a,
			supportsOpenAIGrammarTools: s
		}
	}), d = {
		model: e.id,
		store: !1,
		stream: !0,
		instructions: t.systemPrompt || "You are a helpful assistant.",
		input: u,
		text: { verbosity: n?.textVerbosity || "low" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: r,
		tool_choice: n?.toolChoice ?? "auto",
		parallel_tool_calls: !0
	};
	if (n?.temperature !== void 0 && (d.temperature = n.temperature), n?.serviceTier !== void 0 && (d.service_tier = n.serviceTier), l.immediate.length > 0 && (d.tools = p(l.immediate, {
		strict: null,
		supportsStrictMode: a,
		supportsOpenAIGrammarTools: s
	})), n?.reasoningEffort !== void 0) {
		let t = n.reasoningEffort === "none" ? e.thinkingLevelMap?.off ?? "none" : e.thinkingLevelMap?.[n.reasoningEffort] ?? n.reasoningEffort;
		t !== null && (d.reasoning = {
			effort: t,
			summary: n.reasoningSummary ?? "auto"
		});
	}
	return d;
}
function ve(e, t) {
	switch (t) {
		case "flex": return .5;
		case "priority": return e.id === "gpt-5.5" ? 2.5 : 2;
		default: return 1;
	}
}
function z(e, t, n) {
	let r = ve(n, t);
	r !== 1 && (e.cost.input *= r, e.cost.output *= r, e.cost.cacheRead *= r, e.cost.cacheWrite *= r, e.cost.total = e.cost.input + e.cost.output + e.cost.cacheRead + e.cost.cacheWrite);
}
function B(e, t) {
	return e === "default" && (t === "flex" || t === "priority") ? t : e ?? t;
}
function V(e) {
	let t = (e && e.trim().length > 0 ? e : M).replace(/\/+$/, "");
	return t.endsWith("/codex/responses") ? t : t.endsWith("/codex") ? `${t}/responses` : `${t}/codex/responses`;
}
function ye(e) {
	let t = new URL(V(e));
	return t.protocol === "https:" && (t.protocol = "wss:"), t.protocol === "http:" && (t.protocol = "ws:"), t.toString();
}
async function be(e, t, n, r, i, a) {
	await m(W(Ee(e, a?.signal)), t, n, r, {
		serviceTier: a?.serviceTier,
		grammarToolInputProperties: i,
		resolveServiceTier: B,
		applyServiceTierPricing: (e, t) => z(e, t, r)
	});
}
var H = class extends Error {
	code;
	payload;
	constructor(e, t) {
		super(e), this.name = "CodexApiError", this.code = t?.code, this.payload = t?.payload, this.cause = t?.cause;
	}
}, U = class extends Error {
	payload;
	constructor(e, t) {
		super(e), this.name = "CodexProtocolError", this.payload = t?.payload, this.cause = t?.cause;
	}
};
function xe(e) {
	return e instanceof H || e instanceof U;
}
function Se(e) {
	return e instanceof H && e.code === se;
}
function Ce(e) {
	return e instanceof H && e.code === ce;
}
function we(e) {
	let t = e.error && typeof e.error == "object" ? e.error : void 0;
	return {
		code: typeof e.code == "string" ? e.code : typeof t?.code == "string" ? t.code : void 0,
		message: typeof e.message == "string" ? e.message : typeof t?.message == "string" ? t.message : void 0
	};
}
async function* W(e) {
	for await (let t of e) {
		let e = typeof t.type == "string" ? t.type : void 0;
		if (e) {
			if (e === "error") {
				let { code: e, message: n } = we(t);
				throw new H(`Codex error: ${n || e || JSON.stringify(t)}`, {
					code: e,
					payload: t
				});
			}
			if (e === "response.failed") {
				let e = t.response, n = e?.error?.code, r = e?.error?.message;
				throw new H(r || "Codex response failed", {
					code: n,
					payload: t
				});
			}
			if (e === "response.done" || e === "response.completed" || e === "response.incomplete") {
				let e = t.response, n = e && {
					...e,
					status: Te(e.status)
				};
				yield {
					...t,
					type: "response.completed",
					response: n
				};
				return;
			}
			yield t;
		}
	}
}
function Te(e) {
	if (typeof e == "string") return le.has(e) ? e : void 0;
}
async function* Ee(e, n) {
	if (!e.body) return;
	let r = e.body.getReader(), i = new TextDecoder(), a = "", o = () => {
		r.cancel().catch(() => {});
	};
	n?.addEventListener("abort", o, { once: !0 });
	try {
		for (;;) {
			if (n?.aborted) throw Error("Request was aborted");
			let { done: e, value: o } = await r.read();
			if (n?.aborted) throw Error("Request was aborted");
			if (e) break;
			a += i.decode(o, { stream: !0 });
			let s = a.indexOf("\n\n");
			for (; s !== -1;) {
				let e = a.slice(0, s);
				a = a.slice(s + 2);
				let n = e.split("\n").filter((e) => e.startsWith("data:")).map((e) => e.slice(5).trim());
				if (n.length > 0) {
					let e = n.join("\n").trim();
					if (e && e !== "[DONE]") try {
						yield JSON.parse(e);
					} catch (n) {
						throw new U(`Invalid Codex SSE JSON: ${t(n)}`, {
							cause: n,
							payload: e
						});
					}
				}
				s = a.indexOf("\n\n");
			}
		}
	} finally {
		n?.removeEventListener("abort", o);
		try {
			await r.cancel();
		} catch {}
		try {
			r.releaseLock();
		} catch {}
	}
}
var De = "responses_websockets=2026-02-06", Oe = 3e5, ke = 33e5, G = /* @__PURE__ */ new Map(), K = /* @__PURE__ */ new Map(), q = /* @__PURE__ */ new Set();
function J(e) {
	let t = K.get(e);
	return t || (t = {
		requests: 0,
		connectionsCreated: 0,
		connectionsReused: 0,
		cachedContextRequests: 0,
		storeTrueRequests: 0,
		fullContextRequests: 0,
		deltaRequests: 0,
		lastInputItems: 0,
		websocketFailures: 0,
		sseFallbacks: 0
	}, K.set(e, t)), t;
}
function Ae(e) {
	let t = K.get(e);
	return t ? { ...t } : void 0;
}
function je(e) {
	if (e) {
		K.delete(e), q.delete(e);
		return;
	}
	K.clear(), q.clear();
}
function Me(e) {
	let t = (e) => {
		e.idleTimer && clearTimeout(e.idleTimer), Z(e.socket, 1e3, "debug_close");
	};
	if (e) {
		for (let n of G.get(e)?.values() ?? []) t(n);
		G.delete(e);
		return;
	}
	for (let e of G.values()) for (let n of e.values()) t(n);
	G.clear();
}
_(Me);
function Ne(e) {
	return e ? q.has(e) : !1;
}
function Pe(e) {
	if (!e) return;
	let t = J(e);
	t.sseFallbacks++, t.websocketFallbackActive = Ne(e);
}
function Fe(e, n) {
	if (!e) return;
	q.add(e);
	let r = J(e);
	r.websocketFailures++, r.lastWebSocketError = t(n), r.websocketFallbackActive = !0;
}
var Y = null;
async function Ie(e) {
	if (!e && Y) return Y;
	if (typeof process < "u" && process.versions?.bun) {
		let t = class extends WebSocket {
			constructor(t, n) {
				let r = {};
				r = Array.isArray(n) || typeof n == "string" ? { protocols: n } : { ...n };
				let i = k(t.toString().replace(/^wss:/, "https:").replace(/^ws:/, "http:"), e);
				super(t, {
					...r,
					...i ? { proxy: i.toString() } : {}
				});
			}
		};
		return e || (Y = t), t;
	}
	let t = globalThis.WebSocket;
	return typeof t == "function" ? t : null;
}
var Le = class extends Error {
	code;
	reason;
	wasClean;
	constructor(e, t) {
		super(e), this.name = "WebSocketCloseError", this.code = t?.code, this.reason = t?.reason, this.wasClean = t?.wasClean;
	}
};
function Re(e) {
	let t = e.readyState;
	return typeof t == "number" ? t : void 0;
}
function X(e) {
	let t = Re(e);
	return t === void 0 || t === 1;
}
function ze(e) {
	return Date.now() - e.createdAt >= ke;
}
function Z(e, t = 1e3, n = "done") {
	try {
		e.close(t, n);
	} catch {}
}
function Be(e, t, n) {
	n.idleTimer && clearTimeout(n.idleTimer), n.idleTimer = setTimeout(() => {
		if (n.busy) return;
		Z(n.socket, 1e3, "idle_timeout");
		let r = G.get(e);
		r?.get(t) === n && r.delete(t), r?.size === 0 && G.delete(e);
	}, Oe);
}
async function Q(e, t, n, r = re, i) {
	let a = await Ie(i);
	if (!a) throw Error("WebSocket transport is not available in this runtime");
	let o = s(t);
	return delete o["OpenAI-Beta"], new Promise((t, i) => {
		let s = !1, c, l;
		try {
			l = new a(e, { headers: o });
		} catch (e) {
			i(e instanceof Error ? e : Error(String(e)));
			return;
		}
		let u = () => {
			c &&= (clearTimeout(c), void 0), l.removeEventListener("open", f), l.removeEventListener("error", p), l.removeEventListener("close", m), n?.removeEventListener("abort", h);
		}, d = (e, t) => {
			s || (s = !0, u(), t && Z(l, 1e3, t), i(e));
		}, f = () => {
			s || (s = !0, u(), t(l));
		}, p = (e) => {
			d($(e));
		}, m = (e) => {
			d(He(e));
		}, h = () => {
			d(/* @__PURE__ */ Error("Request was aborted"), "aborted");
		};
		l.addEventListener("open", f), l.addEventListener("error", p), l.addEventListener("close", m), n?.addEventListener("abort", h), r > 0 && (c = setTimeout(() => {
			d(/* @__PURE__ */ Error(`WebSocket connect timeout after ${r}ms`), "connect_timeout");
		}, r)), n?.aborted && h();
	});
}
async function Ve(e, t, n, r, i, a, o) {
	if (!n) {
		let n = await Q(e, t, i, a, o);
		return {
			socket: n,
			reused: !1,
			release: () => Z(n)
		};
	}
	let s = G.get(n), c = s?.get(r);
	if (c) {
		if (c.idleTimer &&= (clearTimeout(c.idleTimer), void 0), !c.busy && ze(c)) Z(c.socket, 1e3, "connection_age_limit"), s?.delete(r), s?.size === 0 && G.delete(n);
		else if (!c.busy && X(c.socket)) return c.busy = !0, {
			socket: c.socket,
			entry: c,
			reused: !0,
			release: ({ keep: e } = {}) => {
				if (!e || !X(c.socket)) {
					Z(c.socket);
					let e = G.get(n);
					e?.get(r) === c && e.delete(r), e?.size === 0 && G.delete(n);
					return;
				}
				c.busy = !1, Be(n, r, c);
			}
		};
		if (c.busy) {
			let n = await Q(e, t, i, a, o);
			return {
				socket: n,
				reused: !1,
				release: () => {
					Z(n);
				}
			};
		}
		X(c.socket) || (Z(c.socket), s?.delete(r), s?.size === 0 && G.delete(n));
	}
	let l = await Q(e, t, i, a, o), u = {
		socket: l,
		busy: !0,
		createdAt: Date.now()
	};
	return s = G.get(n), s || (s = /* @__PURE__ */ new Map(), G.set(n, s)), s.set(r, u), {
		socket: l,
		entry: u,
		reused: !1,
		release: ({ keep: e } = {}) => {
			if (!e || !X(u.socket)) {
				Z(u.socket), u.idleTimer && clearTimeout(u.idleTimer);
				let e = G.get(n);
				e?.get(r) === u && e.delete(r), e?.size === 0 && G.delete(n);
				return;
			}
			u.busy = !1, Be(n, r, u);
		}
	};
}
function $(e) {
	if (e && typeof e == "object") {
		let t = "message" in e ? e.message : void 0;
		if (typeof t == "string" && t.length > 0) return Error(t);
		let n = "error" in e ? e.error : void 0;
		if (n instanceof Error && n.message.length > 0) return n;
		if (n && typeof n == "object" && "message" in n) {
			let e = n.message;
			if (typeof e == "string" && e.length > 0) return Error(e);
		}
	}
	return /* @__PURE__ */ Error("WebSocket error");
}
function He(e) {
	if (e && typeof e == "object") {
		let t = "code" in e ? e.code : void 0, n = "reason" in e ? e.reason : void 0, r = "wasClean" in e ? e.wasClean : void 0, i = typeof t == "number" ? ` ${t}` : "", a = typeof n == "string" && n.length > 0 ? ` ${n}` : "";
		return !a && t === oe && (a = " message too big"), new Le(`WebSocket closed${i}${a}`.trim(), {
			code: typeof t == "number" ? t : void 0,
			reason: typeof n == "string" && n.length > 0 ? n : void 0,
			wasClean: typeof r == "boolean" ? r : void 0
		});
	}
	return /* @__PURE__ */ Error("WebSocket closed");
}
async function Ue(e) {
	if (typeof e == "string") return e;
	if (e instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(e));
	if (ArrayBuffer.isView(e)) {
		let t = e;
		return new TextDecoder().decode(new Uint8Array(t.buffer, t.byteOffset, t.byteLength));
	}
	if (e && typeof e == "object" && "arrayBuffer" in e) {
		let t = await e.arrayBuffer();
		return new TextDecoder().decode(new Uint8Array(t));
	}
	return null;
}
async function* We(e, n, r) {
	let i = [], a = null, o = !1, s = null, c = !1, l = () => {
		if (!a) return;
		let e = a;
		a = null, e();
	}, u = (e) => {
		(async () => {
			let n = null;
			try {
				if (!e || typeof e != "object" || !("data" in e) || (n = await Ue(e.data), !n)) return;
				let t = JSON.parse(n), r = typeof t.type == "string" ? t.type : "";
				(r === "response.completed" || r === "response.done" || r === "response.incomplete") && (c = !0, o = !0), i.push(t), l();
			} catch (e) {
				s = new U(`Invalid Codex WebSocket JSON: ${t(e)}`, {
					cause: e,
					payload: n
				}), o = !0, l();
			}
		})();
	}, d = (e) => {
		s = $(e), o = !0, l();
	}, f = (e) => {
		if (c) {
			o = !0, l();
			return;
		}
		s ||= He(e), o = !0, l();
	}, p = () => {
		s = /* @__PURE__ */ Error("Request was aborted"), o = !0, l();
	};
	e.addEventListener("message", u), e.addEventListener("error", d), e.addEventListener("close", f), n?.addEventListener("abort", p);
	try {
		for (;;) {
			if (n?.aborted) throw Error("Request was aborted");
			if (i.length > 0) {
				yield i.shift();
				continue;
			}
			if (o) break;
			let t;
			await new Promise((n, i) => {
				a = n, r !== void 0 && r > 0 && (t = setTimeout(() => {
					let t = /* @__PURE__ */ Error(`WebSocket idle timeout after ${r}ms`);
					s = t, o = !0, a = null, Z(e, 1e3, "idle_timeout"), i(t);
				}, r));
			}).finally(() => {
				t && clearTimeout(t);
			});
		}
		if (s) throw s;
		if (!c) throw Error("WebSocket stream closed before response.completed");
	} finally {
		e.removeEventListener("message", u), e.removeEventListener("error", d), e.removeEventListener("close", f), n?.removeEventListener("abort", p);
	}
}
function Ge(e) {
	let { input: t, previous_response_id: n, ...r } = e;
	return r;
}
function Ke(e, t) {
	return JSON.stringify(e ?? []) === JSON.stringify(t ?? []);
}
function qe(e, t) {
	return JSON.stringify(Ge(e)) === JSON.stringify(Ge(t));
}
function Je(e, t) {
	if (!qe(e, t.lastRequestBody)) return;
	let n = e.input ?? [], r = [...t.lastRequestBody.input ?? [], ...t.lastResponseItems];
	if (!(n.length < r.length) && Ke(n.slice(0, r.length), r)) return n.slice(r.length);
}
function Ye(e, t) {
	let n = e.continuation;
	if (!n) return t;
	let r = Je(t, n);
	return !r || !n.lastResponseId ? (e.continuation = void 0, t) : {
		...t,
		previous_response_id: n.lastResponseId,
		input: r
	};
}
async function* Xe(e, t) {
	let n = !1;
	for await (let r of e) n || (n = !0, t()), yield r;
}
async function Ze(e, t, n, r, i, a, o, s, c, l, u, d, f) {
	let { socket: p, entry: g, reused: _, release: v } = await Ve(e, n, l, u, f?.signal, c, f?.env), y = !0, b = f?.transport === "websocket-cached" || f?.transport === "auto", x = t, S = b && g ? Ye(g, x) : x, C = l ? J(l) : void 0;
	C && (C.requests++, _ ? C.connectionsReused++ : C.connectionsCreated++, b && C.cachedContextRequests++, S.store === !0 && C.storeTrueRequests++, C.lastInputItems = S.input?.length ?? 0, S.previous_response_id ? (C.deltaRequests++, C.lastDeltaInputItems = S.input?.length ?? 0, C.lastPreviousResponseId = S.previous_response_id) : (C.fullContextRequests++, C.lastDeltaInputItems = void 0, C.lastPreviousResponseId = void 0));
	try {
		if (p.send(JSON.stringify({
			type: "response.create",
			...S
		})), await m(Xe(W(We(p, f?.signal, s)), o), r, i, a, {
			serviceTier: f?.serviceTier,
			grammarToolInputProperties: d,
			resolveServiceTier: B,
			applyServiceTierPricing: (e, t) => z(e, t, a)
		}), f?.signal?.aborted) y = !1;
		else if (b && g && r.responseId) {
			let e = h(a, { messages: [r] }, ae, {
				includeSystemPrompt: !1,
				grammarToolInputProperties: d
			}).filter((e) => e.type !== "function_call_output" && e.type !== "custom_tool_call_output");
			g.continuation = {
				lastRequestBody: x,
				lastResponseId: r.responseId,
				lastResponseItems: e
			};
		}
	} catch (e) {
		throw g && (g.continuation = void 0), y = !1, e;
	} finally {
		v({ keep: y });
	}
}
async function Qe(e) {
	let t = await e.text(), n = t || e.statusText || "Request failed", r;
	try {
		let i = JSON.parse(t)?.error;
		if (i) {
			let t = i.code || i.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(t) || e.status === 429) {
				let e = i.plan_type ? ` (${i.plan_type.toLowerCase()} plan)` : "", t = i.resets_at ? Math.max(0, Math.round((i.resets_at * 1e3 - Date.now()) / 6e4)) : void 0;
				r = `You have hit your ChatGPT usage limit${e}.${t === void 0 ? "" : ` Try again in ~${t} min.`}`.trim();
			}
			n = i.message || r || n;
		}
	} catch {}
	return {
		message: n,
		friendlyMessage: r
	};
}
function $e(e) {
	try {
		let t = e.split(".");
		if (t.length !== 3) throw Error("Invalid token");
		let n = JSON.parse(atob(t[1]))?.[ee]?.chatgpt_account_id;
		if (!n) throw Error("No account ID in token");
		return n;
	} catch {
		throw Error("Failed to extract accountId from token");
	}
}
function et(e, t, n, r) {
	let i = new Headers(e);
	for (let [e, n] of Object.entries(t || {})) n === null ? i.delete(e) : i.set(e, n);
	i.set("Authorization", `Bearer ${r}`), i.set("chatgpt-account-id", n), i.set("originator", "pi");
	let a = j ? `pi (${j.platform()} ${j.release()}; ${j.arch()})` : "pi (browser)";
	return i.set("User-Agent", a), i;
}
function tt(e, t, n, r, i) {
	let a = et(e, t, n, r);
	return a.set("OpenAI-Beta", "responses=experimental"), a.set("accept", "text/event-stream"), a.set("content-type", "application/json"), i && (a.set("session-id", i), a.set("x-client-request-id", i)), a;
}
function nt(e, t, n, r, i) {
	let a = et(e, t, n, r);
	return a.delete("accept"), a.delete("content-type"), a.delete("OpenAI-Beta"), a.delete("openai-beta"), a.set("OpenAI-Beta", De), a.set("x-client-request-id", i), a.set("session-id", i), a;
}
//#endregion
export { Me as closeOpenAICodexWebSocketSessions, Ae as getOpenAICodexWebSocketDebugStats, je as resetOpenAICodexWebSocketDebugStats, R as stream, ge as streamSimple };
