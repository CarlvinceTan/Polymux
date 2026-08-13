import { t as e } from "./models-DVvVP5-a.js";
import { t } from "./event-stream-D07JAHnY.js";
import { t as n } from "./provider-env-Do4NyCk3.js";
import { n as r, t as i } from "./json-parse-XC7hUTqJ.js";
import { t as a } from "./deferred-tools-BbPJenDp.js";
import { t as o } from "./headers-CDJ0-DpO.js";
import { t as s } from "./provider-retry-geBRPa4e.js";
import { a as c, d as l, f as u, i as d, r as f, t as p } from "./transform-messages-Dy7xZPcj.js";
import { n as ee, t as m } from "./github-copilot-headers-BzlktqJ_.js";
//#region node_modules/@anthropic-ai/sdk/internal/tslib.mjs
function h(e, t, n, r, i) {
	if (r === "m") throw TypeError("Private method is not writable");
	if (r === "a" && !i) throw TypeError("Private accessor was defined without a setter");
	if (typeof t == "function" ? e !== t || !i : !t.has(e)) throw TypeError("Cannot write private member to an object whose class did not declare it");
	return r === "a" ? i.call(e, n) : i ? i.value = n : t.set(e, n), n;
}
function g(e, t, n, r) {
	if (n === "a" && !r) throw TypeError("Private accessor was defined without a getter");
	if (typeof t == "function" ? e !== t || !r : !t.has(e)) throw TypeError("Cannot read private member from an object whose class did not declare it");
	return n === "m" ? r : n === "a" ? r.call(e) : r ? r.value : t.get(e);
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/utils/uuid.mjs
var te = function() {
	let { crypto: e } = globalThis;
	if (e?.randomUUID) return te = e.randomUUID.bind(e), e.randomUUID();
	let t = /* @__PURE__ */ new Uint8Array(1), n = e ? () => e.getRandomValues(t)[0] : () => Math.random() * 255 & 255;
	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (e) => (e ^ n() & 15 >> e / 4).toString(16));
};
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/errors.mjs
function ne(e) {
	return typeof e == "object" && !!e && ("name" in e && e.name === "AbortError" || "message" in e && String(e.message).includes("FetchRequestCanceledException"));
}
var re = (e) => {
	if (e instanceof Error) return e;
	if (typeof e == "object" && e) {
		try {
			if (Object.prototype.toString.call(e) === "[object Error]") {
				let t = Error(e.message, e.cause ? { cause: e.cause } : {});
				return e.stack && (t.stack = e.stack), e.cause && !t.cause && (t.cause = e.cause), e.name && (t.name = e.name), t;
			}
		} catch {}
		try {
			return Error(JSON.stringify(e));
		} catch {}
	}
	return Error(e);
}, _ = class extends Error {}, v = class e extends _ {
	constructor(t, n, r, i, a) {
		super(`${e.makeMessage(t, n, r)}`), this.status = t, this.headers = i, this.requestID = i?.get("request-id"), this.error = n, this.type = a ?? null;
	}
	static makeMessage(e, t, n) {
		let r = t?.message ? typeof t.message == "string" ? t.message : JSON.stringify(t.message) : t ? JSON.stringify(t) : n;
		return e && r ? `${e} ${r}` : e ? `${e} status code (no body)` : r || "(no status code or body)";
	}
	static generate(t, n, r, i) {
		if (!t || !i) return new ie({
			message: r,
			cause: re(n)
		});
		let a = n, o = a?.error?.type;
		return t === 400 ? new oe(t, a, r, i, o) : t === 401 ? new se(t, a, r, i, o) : t === 403 ? new ce(t, a, r, i, o) : t === 404 ? new le(t, a, r, i, o) : t === 409 ? new ue(t, a, r, i, o) : t === 422 ? new de(t, a, r, i, o) : t === 429 ? new fe(t, a, r, i, o) : t >= 500 ? new pe(t, a, r, i, o) : new e(t, a, r, i, o);
	}
}, y = class extends v {
	constructor({ message: e } = {}) {
		super(void 0, void 0, e || "Request was aborted.", void 0);
	}
}, ie = class extends v {
	constructor({ message: e, cause: t }) {
		super(void 0, void 0, e || "Connection error.", void 0), t && (this.cause = t);
	}
}, ae = class extends ie {
	constructor({ message: e } = {}) {
		super({ message: e ?? "Request timed out." });
	}
}, oe = class extends v {}, se = class extends v {}, ce = class extends v {}, le = class extends v {}, ue = class extends v {}, de = class extends v {}, fe = class extends v {}, pe = class extends v {}, me = /^[a-z][a-z0-9+.-]*:/i, he = (e) => me.test(e), ge = (e) => (ge = Array.isArray, ge(e)), _e = ge;
function ve(e) {
	return typeof e == "object" ? e ?? {} : {};
}
function ye(e) {
	if (!e) return !0;
	for (let t in e) return !1;
	return !0;
}
function be(e, t) {
	return Object.prototype.hasOwnProperty.call(e, t);
}
var xe = (e, t) => {
	if (typeof t != "number" || !Number.isInteger(t)) throw new _(`${e} must be an integer`);
	if (t < 0) throw new _(`${e} must be a positive integer`);
	return t;
}, Se = (e) => {
	try {
		return JSON.parse(e);
	} catch {
		return;
	}
}, Ce = (e) => new Promise((t) => setTimeout(t, e)), b = "0.91.1", we = () => typeof window < "u" && window.document !== void 0 && typeof navigator < "u";
function Te() {
	return typeof Deno < "u" && Deno.build != null ? "deno" : typeof EdgeRuntime < "u" ? "edge" : Object.prototype.toString.call(globalThis.process === void 0 ? 0 : globalThis.process) === "[object process]" ? "node" : "unknown";
}
var Ee = () => {
	let e = Te();
	if (e === "deno") return {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": b,
		"X-Stainless-OS": ke(Deno.build.os),
		"X-Stainless-Arch": Oe(Deno.build.arch),
		"X-Stainless-Runtime": "deno",
		"X-Stainless-Runtime-Version": typeof Deno.version == "string" ? Deno.version : Deno.version?.deno ?? "unknown"
	};
	if (typeof EdgeRuntime < "u") return {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": b,
		"X-Stainless-OS": "Unknown",
		"X-Stainless-Arch": `other:${EdgeRuntime}`,
		"X-Stainless-Runtime": "edge",
		"X-Stainless-Runtime-Version": globalThis.process.version
	};
	if (e === "node") return {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": b,
		"X-Stainless-OS": ke(globalThis.process.platform ?? "unknown"),
		"X-Stainless-Arch": Oe(globalThis.process.arch ?? "unknown"),
		"X-Stainless-Runtime": "node",
		"X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
	};
	let t = De();
	return t ? {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": b,
		"X-Stainless-OS": "Unknown",
		"X-Stainless-Arch": "unknown",
		"X-Stainless-Runtime": `browser:${t.browser}`,
		"X-Stainless-Runtime-Version": t.version
	} : {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": b,
		"X-Stainless-OS": "Unknown",
		"X-Stainless-Arch": "unknown",
		"X-Stainless-Runtime": "unknown",
		"X-Stainless-Runtime-Version": "unknown"
	};
};
function De() {
	if (typeof navigator > "u" || !navigator) return null;
	for (let { key: e, pattern: t } of [
		{
			key: "edge",
			pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/
		},
		{
			key: "ie",
			pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/
		},
		{
			key: "ie",
			pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/
		},
		{
			key: "chrome",
			pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/
		},
		{
			key: "firefox",
			pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/
		},
		{
			key: "safari",
			pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/
		}
	]) {
		let n = t.exec(navigator.userAgent);
		if (n) return {
			browser: e,
			version: `${n[1] || 0}.${n[2] || 0}.${n[3] || 0}`
		};
	}
	return null;
}
var Oe = (e) => e === "x32" ? "x32" : e === "x86_64" || e === "x64" ? "x64" : e === "arm" ? "arm" : e === "aarch64" || e === "arm64" ? "arm64" : e ? `other:${e}` : "unknown", ke = (e) => (e = e.toLowerCase(), e.includes("ios") ? "iOS" : e === "android" ? "Android" : e === "darwin" ? "MacOS" : e === "win32" ? "Windows" : e === "freebsd" ? "FreeBSD" : e === "openbsd" ? "OpenBSD" : e === "linux" ? "Linux" : e ? `Other:${e}` : "Unknown"), Ae, je = () => Ae ??= Ee();
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/shims.mjs
function Me() {
	if (typeof fetch < "u") return fetch;
	throw Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new Anthropic({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function Ne(...e) {
	let t = globalThis.ReadableStream;
	if (t === void 0) throw Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
	return new t(...e);
}
function Pe(e) {
	let t = Symbol.asyncIterator in e ? e[Symbol.asyncIterator]() : e[Symbol.iterator]();
	return Ne({
		start() {},
		async pull(e) {
			let { done: n, value: r } = await t.next();
			n ? e.close() : e.enqueue(r);
		},
		async cancel() {
			await t.return?.();
		}
	});
}
function Fe(e) {
	if (e[Symbol.asyncIterator]) return e;
	let t = e.getReader();
	return {
		async next() {
			try {
				let e = await t.read();
				return e?.done && t.releaseLock(), e;
			} catch (e) {
				throw t.releaseLock(), e;
			}
		},
		async return() {
			let e = t.cancel();
			return t.releaseLock(), await e, {
				done: !0,
				value: void 0
			};
		},
		[Symbol.asyncIterator]() {
			return this;
		}
	};
}
async function Ie(e) {
	if (typeof e != "object" || !e) return;
	if (e[Symbol.asyncIterator]) {
		await e[Symbol.asyncIterator]().return?.();
		return;
	}
	let t = e.getReader(), n = t.cancel();
	t.releaseLock(), await n;
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/request-options.mjs
var Le = ({ headers: e, body: t }) => ({
	bodyHeaders: { "content-type": "application/json" },
	body: JSON.stringify(t)
});
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/utils/query.mjs
function Re(e) {
	return Object.entries(e).filter(([e, t]) => t !== void 0).map(([e, t]) => {
		if (typeof t == "string" || typeof t == "number" || typeof t == "boolean") return `${encodeURIComponent(e)}=${encodeURIComponent(t)}`;
		if (t === null) return `${encodeURIComponent(e)}=`;
		throw new _(`Cannot stringify type ${typeof t}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
	}).join("&");
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/utils/bytes.mjs
function ze(e) {
	let t = 0;
	for (let n of e) t += n.length;
	let n = new Uint8Array(t), r = 0;
	for (let t of e) n.set(t, r), r += t.length;
	return n;
}
var Be;
function Ve(e) {
	let t;
	return (Be ??= (t = new globalThis.TextEncoder(), t.encode.bind(t)))(e);
}
var He;
function Ue(e) {
	let t;
	return (He ??= (t = new globalThis.TextDecoder(), t.decode.bind(t)))(e);
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/decoders/line.mjs
var x, S, We = class {
	constructor() {
		x.set(this, void 0), S.set(this, void 0), h(this, x, /* @__PURE__ */ new Uint8Array(), "f"), h(this, S, null, "f");
	}
	decode(e) {
		if (e == null) return [];
		let t = e instanceof ArrayBuffer ? new Uint8Array(e) : typeof e == "string" ? Ve(e) : e;
		h(this, x, ze([g(this, x, "f"), t]), "f");
		let n = [], r;
		for (; (r = Ge(g(this, x, "f"), g(this, S, "f"))) != null;) {
			if (r.carriage && g(this, S, "f") == null) {
				h(this, S, r.index, "f");
				continue;
			}
			if (g(this, S, "f") != null && (r.index !== g(this, S, "f") + 1 || r.carriage)) {
				n.push(Ue(g(this, x, "f").subarray(0, g(this, S, "f") - 1))), h(this, x, g(this, x, "f").subarray(g(this, S, "f")), "f"), h(this, S, null, "f");
				continue;
			}
			let e = g(this, S, "f") === null ? r.preceding : r.preceding - 1, t = Ue(g(this, x, "f").subarray(0, e));
			n.push(t), h(this, x, g(this, x, "f").subarray(r.index), "f"), h(this, S, null, "f");
		}
		return n;
	}
	flush() {
		return g(this, x, "f").length ? this.decode("\n") : [];
	}
};
x = /* @__PURE__ */ new WeakMap(), S = /* @__PURE__ */ new WeakMap(), We.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]), We.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function Ge(e, t) {
	for (let n = t ?? 0; n < e.length; n++) {
		if (e[n] === 10) return {
			preceding: n,
			index: n + 1,
			carriage: !1
		};
		if (e[n] === 13) return {
			preceding: n,
			index: n + 1,
			carriage: !0
		};
	}
	return null;
}
function Ke(e) {
	for (let t = 0; t < e.length - 1; t++) {
		if (e[t] === 10 && e[t + 1] === 10 || e[t] === 13 && e[t + 1] === 13) return t + 2;
		if (e[t] === 13 && e[t + 1] === 10 && t + 3 < e.length && e[t + 2] === 13 && e[t + 3] === 10) return t + 4;
	}
	return -1;
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/utils/log.mjs
var qe = {
	off: 0,
	error: 200,
	warn: 300,
	info: 400,
	debug: 500
}, Je = (e, t, n) => {
	if (e) {
		if (be(qe, e)) return e;
		w(n).warn(`${t} was set to ${JSON.stringify(e)}, expected one of ${JSON.stringify(Object.keys(qe))}`);
	}
};
function C() {}
function Ye(e, t, n) {
	return !t || qe[e] > qe[n] ? C : t[e].bind(t);
}
var Xe = {
	error: C,
	warn: C,
	info: C,
	debug: C
}, Ze = /* @__PURE__ */ new WeakMap();
function w(e) {
	let t = e.logger, n = e.logLevel ?? "off";
	if (!t) return Xe;
	let r = Ze.get(t);
	if (r && r[0] === n) return r[1];
	let i = {
		error: Ye("error", t, n),
		warn: Ye("warn", t, n),
		info: Ye("info", t, n),
		debug: Ye("debug", t, n)
	};
	return Ze.set(t, [n, i]), i;
}
var T = (e) => (e.options && (e.options = { ...e.options }, delete e.options.headers), e.headers &&= Object.fromEntries((e.headers instanceof Headers ? [...e.headers] : Object.entries(e.headers)).map(([e, t]) => [e, e.toLowerCase() === "x-api-key" || e.toLowerCase() === "authorization" || e.toLowerCase() === "cookie" || e.toLowerCase() === "set-cookie" ? "***" : t])), "retryOfRequestLogID" in e && (e.retryOfRequestLogID && (e.retryOf = e.retryOfRequestLogID), delete e.retryOfRequestLogID), e), E, Qe = class e {
	constructor(e, t, n) {
		this.iterator = e, E.set(this, void 0), this.controller = t, h(this, E, n, "f");
	}
	static fromSSEResponse(t, n, r) {
		let i = !1, a = r ? w(r) : console;
		async function* o() {
			if (i) throw new _("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
			i = !0;
			let e = !1;
			try {
				for await (let e of $e(t, n)) {
					if (e.event === "completion") try {
						yield JSON.parse(e.data);
					} catch (t) {
						throw a.error("Could not parse message into JSON:", e.data), a.error("From chunk:", e.raw), t;
					}
					if (e.event === "message_start" || e.event === "message_delta" || e.event === "message_stop" || e.event === "content_block_start" || e.event === "content_block_delta" || e.event === "content_block_stop" || e.event === "message" || e.event === "user.message" || e.event === "user.interrupt" || e.event === "user.tool_confirmation" || e.event === "user.custom_tool_result" || e.event === "agent.message" || e.event === "agent.thinking" || e.event === "agent.tool_use" || e.event === "agent.tool_result" || e.event === "agent.mcp_tool_use" || e.event === "agent.mcp_tool_result" || e.event === "agent.custom_tool_use" || e.event === "agent.thread_context_compacted" || e.event === "session.status_running" || e.event === "session.status_idle" || e.event === "session.status_rescheduled" || e.event === "session.status_terminated" || e.event === "session.error" || e.event === "session.deleted" || e.event === "span.model_request_start" || e.event === "span.model_request_end") try {
						yield JSON.parse(e.data);
					} catch (t) {
						throw a.error("Could not parse message into JSON:", e.data), a.error("From chunk:", e.raw), t;
					}
					if (e.event !== "ping" && e.event === "error") {
						let n = Se(e.data) ?? e.data, r = n?.error?.type;
						throw new v(void 0, n, void 0, t.headers, r);
					}
				}
				e = !0;
			} catch (e) {
				if (ne(e)) return;
				throw e;
			} finally {
				e || n.abort();
			}
		}
		return new e(o, n, r);
	}
	static fromReadableStream(t, n, r) {
		let i = !1;
		async function* a() {
			let e = new We(), n = Fe(t);
			for await (let t of n) for (let n of e.decode(t)) yield n;
			for (let t of e.flush()) yield t;
		}
		async function* o() {
			if (i) throw new _("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
			i = !0;
			let e = !1;
			try {
				for await (let t of a()) e || t && (yield JSON.parse(t));
				e = !0;
			} catch (e) {
				if (ne(e)) return;
				throw e;
			} finally {
				e || n.abort();
			}
		}
		return new e(o, n, r);
	}
	[(E = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
		return this.iterator();
	}
	tee() {
		let t = [], n = [], r = this.iterator(), i = (e) => ({ next: () => {
			if (e.length === 0) {
				let e = r.next();
				t.push(e), n.push(e);
			}
			return e.shift();
		} });
		return [new e(() => i(t), this.controller, g(this, E, "f")), new e(() => i(n), this.controller, g(this, E, "f"))];
	}
	toReadableStream() {
		let e = this, t;
		return Ne({
			async start() {
				t = e[Symbol.asyncIterator]();
			},
			async pull(e) {
				try {
					let { value: n, done: r } = await t.next();
					if (r) return e.close();
					let i = Ve(JSON.stringify(n) + "\n");
					e.enqueue(i);
				} catch (t) {
					e.error(t);
				}
			},
			async cancel() {
				await t.return?.();
			}
		});
	}
};
async function* $e(e, t) {
	if (!e.body) throw t.abort(), globalThis.navigator !== void 0 && globalThis.navigator.product === "ReactNative" ? new _("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new _("Attempted to iterate over a response with no body");
	let n = new tt(), r = new We(), i = Fe(e.body);
	for await (let e of et(i)) for (let t of r.decode(e)) {
		let e = n.decode(t);
		e && (yield e);
	}
	for (let e of r.flush()) {
		let t = n.decode(e);
		t && (yield t);
	}
}
async function* et(e) {
	let t = /* @__PURE__ */ new Uint8Array();
	for await (let n of e) {
		if (n == null) continue;
		let e = n instanceof ArrayBuffer ? new Uint8Array(n) : typeof n == "string" ? Ve(n) : n, r = new Uint8Array(t.length + e.length);
		r.set(t), r.set(e, t.length), t = r;
		let i;
		for (; (i = Ke(t)) !== -1;) yield t.slice(0, i), t = t.slice(i);
	}
	t.length > 0 && (yield t);
}
var tt = class {
	constructor() {
		this.event = null, this.data = [], this.chunks = [];
	}
	decode(e) {
		if (e.endsWith("\r") && (e = e.substring(0, e.length - 1)), !e) {
			if (!this.event && !this.data.length) return null;
			let e = {
				event: this.event,
				data: this.data.join("\n"),
				raw: this.chunks
			};
			return this.event = null, this.data = [], this.chunks = [], e;
		}
		if (this.chunks.push(e), e.startsWith(":")) return null;
		let [t, n, r] = nt(e, ":");
		return r.startsWith(" ") && (r = r.substring(1)), t === "event" ? this.event = r : t === "data" && this.data.push(r), null;
	}
};
function nt(e, t) {
	let n = e.indexOf(t);
	return n === -1 ? [
		e,
		"",
		""
	] : [
		e.substring(0, n),
		t,
		e.substring(n + t.length)
	];
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/parse.mjs
async function rt(e, t) {
	let { response: n, requestLogID: r, retryOfRequestLogID: i, startTime: a } = t, o = await (async () => {
		if (t.options.stream) return w(e).debug("response", n.status, n.url, n.headers, n.body), t.options.__streamClass ? t.options.__streamClass.fromSSEResponse(n, t.controller) : Qe.fromSSEResponse(n, t.controller);
		if (n.status === 204) return null;
		if (t.options.__binaryResponse) return n;
		let r = n.headers.get("content-type")?.split(";")[0]?.trim();
		return r?.includes("application/json") || r?.endsWith("+json") ? n.headers.get("content-length") === "0" ? void 0 : it(await n.json(), n) : await n.text();
	})();
	return w(e).debug(`[${r}] response parsed`, T({
		retryOfRequestLogID: i,
		url: n.url,
		status: n.status,
		body: o,
		durationMs: Date.now() - a
	})), o;
}
function it(e, t) {
	return !e || typeof e != "object" || Array.isArray(e) ? e : Object.defineProperty(e, "_request_id", {
		value: t.headers.get("request-id"),
		enumerable: !1
	});
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/core/api-promise.mjs
var at, ot = class e extends Promise {
	constructor(e, t, n = rt) {
		super((e) => {
			e(null);
		}), this.responsePromise = t, this.parseResponse = n, at.set(this, void 0), h(this, at, e, "f");
	}
	_thenUnwrap(t) {
		return new e(g(this, at, "f"), this.responsePromise, async (e, n) => it(t(await this.parseResponse(e, n), n), n.response));
	}
	asResponse() {
		return this.responsePromise.then((e) => e.response);
	}
	async withResponse() {
		let [e, t] = await Promise.all([this.parse(), this.asResponse()]);
		return {
			data: e,
			response: t,
			request_id: t.headers.get("request-id")
		};
	}
	parse() {
		return this.parsedPromise ||= this.responsePromise.then((e) => this.parseResponse(g(this, at, "f"), e)), this.parsedPromise;
	}
	then(e, t) {
		return this.parse().then(e, t);
	}
	catch(e) {
		return this.parse().catch(e);
	}
	finally(e) {
		return this.parse().finally(e);
	}
};
at = /* @__PURE__ */ new WeakMap();
//#endregion
//#region node_modules/@anthropic-ai/sdk/core/pagination.mjs
var st, ct = class {
	constructor(e, t, n, r) {
		st.set(this, void 0), h(this, st, e, "f"), this.options = r, this.response = t, this.body = n;
	}
	hasNextPage() {
		return this.getPaginatedItems().length ? this.nextPageRequestOptions() != null : !1;
	}
	async getNextPage() {
		let e = this.nextPageRequestOptions();
		if (!e) throw new _("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
		return await g(this, st, "f").requestAPIList(this.constructor, e);
	}
	async *iterPages() {
		let e = this;
		for (yield e; e.hasNextPage();) e = await e.getNextPage(), yield e;
	}
	async *[(st = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
		for await (let e of this.iterPages()) for (let t of e.getPaginatedItems()) yield t;
	}
}, lt = class extends ot {
	constructor(e, t, n) {
		super(e, t, async (e, t) => new n(e, t.response, await rt(e, t), t.options));
	}
	async *[Symbol.asyncIterator]() {
		let e = await this;
		for await (let t of e) yield t;
	}
}, ut = class extends ct {
	constructor(e, t, n, r) {
		super(e, t, n, r), this.data = n.data || [], this.has_more = n.has_more || !1, this.first_id = n.first_id || null, this.last_id = n.last_id || null;
	}
	getPaginatedItems() {
		return this.data ?? [];
	}
	hasNextPage() {
		return this.has_more !== !1 && super.hasNextPage();
	}
	nextPageRequestOptions() {
		if (this.options.query?.before_id) {
			let e = this.first_id;
			return e ? {
				...this.options,
				query: {
					...ve(this.options.query),
					before_id: e
				}
			} : null;
		}
		let e = this.last_id;
		return e ? {
			...this.options,
			query: {
				...ve(this.options.query),
				after_id: e
			}
		} : null;
	}
}, D = class extends ct {
	constructor(e, t, n, r) {
		super(e, t, n, r), this.data = n.data || [], this.next_page = n.next_page || null;
	}
	getPaginatedItems() {
		return this.data ?? [];
	}
	nextPageRequestOptions() {
		let e = this.next_page;
		return e ? {
			...this.options,
			query: {
				...ve(this.options.query),
				page: e
			}
		} : null;
	}
}, dt = () => {
	if (typeof File > "u") {
		let { process: e } = globalThis, t = typeof e?.versions?.node == "string" && parseInt(e.versions.node.split(".")) < 20;
		throw Error("`File` is not defined as a global, which is required for file uploads." + (t ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
	}
};
function O(e, t, n) {
	return dt(), new File(e, t ?? "unknown_file", n);
}
function ft(e, t) {
	let n = typeof e == "object" && !!e && ("name" in e && e.name && String(e.name) || "url" in e && e.url && String(e.url) || "filename" in e && e.filename && String(e.filename) || "path" in e && e.path && String(e.path)) || "";
	return t ? n.split(/[\\/]/).pop() || void 0 : n;
}
var pt = (e) => typeof e == "object" && !!e && typeof e[Symbol.asyncIterator] == "function", mt = async (e, t, n = !0) => ({
	...e,
	body: await _t(e.body, t, n)
}), ht = /* @__PURE__ */ new WeakMap();
function gt(e) {
	let t = typeof e == "function" ? e : e.fetch, n = ht.get(t);
	if (n) return n;
	let r = (async () => {
		try {
			let e = "Response" in t ? t.Response : (await t("data:,")).constructor, n = new FormData();
			return n.toString() !== await new e(n).text();
		} catch {
			return !0;
		}
	})();
	return ht.set(t, r), r;
}
var _t = async (e, t, n = !0) => {
	if (!await gt(t)) throw TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
	let r = new FormData();
	return await Promise.all(Object.entries(e || {}).map(([e, t]) => yt(r, e, t, n))), r;
}, vt = (e) => e instanceof Blob && "name" in e, yt = async (e, t, n, r) => {
	if (n !== void 0) {
		if (n == null) throw TypeError(`Received null for "${t}"; to pass null in FormData, you must use the string 'null'`);
		if (typeof n == "string" || typeof n == "number" || typeof n == "boolean") e.append(t, String(n));
		else if (n instanceof Response) {
			let i = {}, a = n.headers.get("Content-Type");
			a && (i = { type: a }), e.append(t, O([await n.blob()], ft(n, r), i));
		} else if (pt(n)) e.append(t, O([await new Response(Pe(n)).blob()], ft(n, r)));
		else if (vt(n)) e.append(t, O([n], ft(n, r), { type: n.type }));
		else if (Array.isArray(n)) await Promise.all(n.map((n) => yt(e, t + "[]", n, r)));
		else if (typeof n == "object") await Promise.all(Object.entries(n).map(([n, i]) => yt(e, `${t}[${n}]`, i, r)));
		else throw TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${n} instead`);
	}
}, bt = (e) => typeof e == "object" && !!e && typeof e.size == "number" && typeof e.type == "string" && typeof e.text == "function" && typeof e.slice == "function" && typeof e.arrayBuffer == "function", xt = (e) => typeof e == "object" && !!e && typeof e.name == "string" && typeof e.lastModified == "number" && bt(e), St = (e) => typeof e == "object" && !!e && typeof e.url == "string" && typeof e.blob == "function";
async function Ct(e, t, n) {
	if (dt(), e = await e, t ||= ft(e, !0), xt(e)) return e instanceof File && t == null && n == null ? e : O([await e.arrayBuffer()], t ?? e.name, {
		type: e.type,
		lastModified: e.lastModified,
		...n
	});
	if (St(e)) {
		let r = await e.blob();
		return t ||= new URL(e.url).pathname.split(/[\\/]/).pop(), O(await wt(r), t, n);
	}
	let r = await wt(e);
	if (!n?.type) {
		let e = r.find((e) => typeof e == "object" && "type" in e && e.type);
		typeof e == "string" && (n = {
			...n,
			type: e
		});
	}
	return O(r, t, n);
}
async function wt(e) {
	let t = [];
	if (typeof e == "string" || ArrayBuffer.isView(e) || e instanceof ArrayBuffer) t.push(e);
	else if (bt(e)) t.push(e instanceof Blob ? e : await e.arrayBuffer());
	else if (pt(e)) for await (let n of e) t.push(...await wt(n));
	else {
		let t = e?.constructor?.name;
		throw Error(`Unexpected data type: ${typeof e}${t ? `; constructor: ${t}` : ""}${Tt(e)}`);
	}
	return t;
}
function Tt(e) {
	return typeof e != "object" || !e ? "" : `; props: [${Object.getOwnPropertyNames(e).map((e) => `"${e}"`).join(", ")}]`;
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/core/resource.mjs
var k = class {
	constructor(e) {
		this._client = e;
	}
}, Et = Symbol.for("brand.privateNullableHeaders");
function* Dt(e) {
	if (!e) return;
	if (Et in e) {
		let { values: t, nulls: n } = e;
		yield* t.entries();
		for (let e of n) yield [e, null];
		return;
	}
	let t = !1, n;
	e instanceof Headers ? n = e.entries() : _e(e) ? n = e : (t = !0, n = Object.entries(e ?? {}));
	for (let e of n) {
		let n = e[0];
		if (typeof n != "string") throw TypeError("expected header name to be a string");
		let r = _e(e[1]) ? e[1] : [e[1]], i = !1;
		for (let e of r) e !== void 0 && (t && !i && (i = !0, yield [n, null]), yield [n, e]);
	}
}
var A = (e) => {
	let t = new Headers(), n = /* @__PURE__ */ new Set();
	for (let r of e) {
		let e = /* @__PURE__ */ new Set();
		for (let [i, a] of Dt(r)) {
			let r = i.toLowerCase();
			e.has(r) || (t.delete(i), e.add(r)), a === null ? (t.delete(i), n.add(r)) : (t.append(i, a), n.delete(r));
		}
	}
	return {
		[Et]: !0,
		values: t,
		nulls: n
	};
};
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/utils/path.mjs
function Ot(e) {
	return e.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var kt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null)), j = /* @__PURE__ */ ((e = Ot) => function(t, ...n) {
	if (t.length === 1) return t[0];
	let r = !1, i = [], a = t.reduce((t, a, o) => {
		/[?#]/.test(a) && (r = !0);
		let s = n[o], c = (r ? encodeURIComponent : e)("" + s);
		return o !== n.length && (s == null || typeof s == "object" && s.toString === Object.getPrototypeOf(Object.getPrototypeOf(s.hasOwnProperty ?? kt) ?? kt)?.toString) && (c = s + "", i.push({
			start: t.length + a.length,
			length: c.length,
			error: `Value of type ${Object.prototype.toString.call(s).slice(8, -1)} is not a valid path parameter`
		})), t + a + (o === n.length ? "" : c);
	}, ""), o = a.split(/[?#]/, 1)[0], s = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi, c;
	for (; (c = s.exec(o)) !== null;) i.push({
		start: c.index,
		length: c[0].length,
		error: `Value "${c[0]}" can\'t be safely passed as a path parameter`
	});
	if (i.sort((e, t) => e.start - t.start), i.length > 0) {
		let e = 0, t = i.reduce((t, n) => {
			let r = " ".repeat(n.start - e), i = "^".repeat(n.length);
			return e = n.start + n.length, t + r + i;
		}, "");
		throw new _(`Path parameters result in path with invalid segments:\n${i.map((e) => e.error).join("\n")}\n${a}\n${t}`);
	}
	return a;
})(Ot), At = class extends k {
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/environments?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/environments/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/environments/${e}?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/environments?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/environments/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	archive(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/environments/${e}/archive?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
}, M = Symbol("anthropic.sdk.stainlessHelper");
function jt(e) {
	return typeof e == "object" && !!e && M in e;
}
function Mt(e, t) {
	let n = /* @__PURE__ */ new Set();
	if (e) for (let t of e) jt(t) && n.add(t[M]);
	if (t) {
		for (let e of t) if (jt(e) && n.add(e[M]), Array.isArray(e.content)) for (let t of e.content) jt(t) && n.add(t[M]);
	}
	return Array.from(n);
}
function Nt(e, t) {
	let n = Mt(e, t);
	return n.length === 0 ? {} : { "x-stainless-helper": n.join(", ") };
}
function Pt(e) {
	return jt(e) ? { "x-stainless-helper": e[M] } : {};
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/beta/files.mjs
var Ft = class extends k {
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/files?beta=true", ut, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "files-api-2025-04-14"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/files/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "files-api-2025-04-14"].toString() }, n?.headers])
		});
	}
	download(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/files/${e}/content?beta=true`, {
			...n,
			headers: A([{
				"anthropic-beta": [...r ?? [], "files-api-2025-04-14"].toString(),
				Accept: "application/binary"
			}, n?.headers]),
			__binaryResponse: !0
		});
	}
	retrieveMetadata(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/files/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "files-api-2025-04-14"].toString() }, n?.headers])
		});
	}
	upload(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/files?beta=true", mt({
			body: r,
			...t,
			headers: A([
				{ "anthropic-beta": [...n ?? [], "files-api-2025-04-14"].toString() },
				Pt(r.file),
				t?.headers
			])
		}, this._client));
	}
}, It = class extends k {
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/models/${e}?beta=true`, {
			...n,
			headers: A([{ ...r?.toString() == null ? void 0 : { "anthropic-beta": r?.toString() } }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/models?beta=true", ut, {
			query: r,
			...t,
			headers: A([{ ...n?.toString() == null ? void 0 : { "anthropic-beta": n?.toString() } }, t?.headers])
		});
	}
}, Lt = class extends k {
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/user_profiles?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "user-profiles-2026-03-24"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/user_profiles/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "user-profiles-2026-03-24"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/user_profiles/${e}?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "user-profiles-2026-03-24"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/user_profiles?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "user-profiles-2026-03-24"].toString() }, t?.headers])
		});
	}
	createEnrollmentURL(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/user_profiles/${e}/enrollment_url?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "user-profiles-2026-03-24"].toString() }, n?.headers])
		});
	}
}, Rt = class extends k {
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/agents/${e}/versions?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
}, zt = class extends k {
	constructor() {
		super(...arguments), this.versions = new Rt(this._client);
	}
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/agents?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.get(j`/v1/agents/${e}?beta=true`, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/agents/${e}?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/agents?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	archive(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/agents/${e}/archive?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
};
zt.Versions = Rt;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/beta/memory-stores/memories.mjs
var Bt = class extends k {
	create(e, t, n) {
		let { view: r, betas: i, ...a } = t;
		return this._client.post(j`/v1/memory_stores/${e}/memories?beta=true`, {
			query: { view: r },
			body: a,
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	retrieve(e, t, n) {
		let { memory_store_id: r, betas: i, ...a } = t;
		return this._client.get(j`/v1/memory_stores/${r}/memories/${e}?beta=true`, {
			query: a,
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { memory_store_id: r, view: i, betas: a, ...o } = t;
		return this._client.post(j`/v1/memory_stores/${r}/memories/${e}?beta=true`, {
			query: { view: i },
			body: o,
			...n,
			headers: A([{ "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/memory_stores/${e}/memories?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	delete(e, t, n) {
		let { memory_store_id: r, expected_content_sha256: i, betas: a } = t;
		return this._client.delete(j`/v1/memory_stores/${r}/memories/${e}?beta=true`, {
			query: { expected_content_sha256: i },
			...n,
			headers: A([{ "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
}, Vt = class extends k {
	retrieve(e, t, n) {
		let { memory_store_id: r, betas: i, ...a } = t;
		return this._client.get(j`/v1/memory_stores/${r}/memory_versions/${e}?beta=true`, {
			query: a,
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/memory_stores/${e}/memory_versions?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	redact(e, t, n) {
		let { memory_store_id: r, betas: i } = t;
		return this._client.post(j`/v1/memory_stores/${r}/memory_versions/${e}/redact?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
}, Ht = class extends k {
	constructor() {
		super(...arguments), this.memories = new Bt(this._client), this.memoryVersions = new Vt(this._client);
	}
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/memory_stores?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/memory_stores/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/memory_stores/${e}?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/memory_stores?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/memory_stores/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	archive(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/memory_stores/${e}/archive?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
};
Ht.Memories = Bt, Ht.MemoryVersions = Vt;
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/constants.mjs
var Ut = {
	"claude-opus-4-20250514": 8192,
	"claude-opus-4-0": 8192,
	"claude-4-opus-20250514": 8192,
	"anthropic.claude-opus-4-20250514-v1:0": 8192,
	"claude-opus-4@20250514": 8192,
	"claude-opus-4-1-20250805": 8192,
	"anthropic.claude-opus-4-1-20250805-v1:0": 8192,
	"claude-opus-4-1@20250805": 8192
};
//#endregion
//#region node_modules/@anthropic-ai/sdk/lib/beta-parser.mjs
function Wt(e) {
	return e?.output_format ?? e?.output_config?.format;
}
function Gt(e, t, n) {
	let r = Wt(t);
	return !t || !("parse" in (r ?? {})) ? {
		...e,
		content: e.content.map((e) => {
			if (e.type === "text") {
				let t = Object.defineProperty({ ...e }, "parsed_output", {
					value: null,
					enumerable: !1
				});
				return Object.defineProperty(t, "parsed", {
					get() {
						return n.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."), null;
					},
					enumerable: !1
				});
			}
			return e;
		}),
		parsed_output: null
	} : Kt(e, t, n);
}
function Kt(e, t, n) {
	let r = null, i = e.content.map((e) => {
		if (e.type === "text") {
			let i = qt(t, e.text);
			r === null && (r = i);
			let a = Object.defineProperty({ ...e }, "parsed_output", {
				value: i,
				enumerable: !1
			});
			return Object.defineProperty(a, "parsed", {
				get() {
					return n.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."), i;
				},
				enumerable: !1
			});
		}
		return e;
	});
	return {
		...e,
		content: i,
		parsed_output: r
	};
}
function qt(e, t) {
	let n = Wt(e);
	if (n?.type !== "json_schema") return null;
	try {
		return "parse" in n ? n.parse(t) : JSON.parse(t);
	} catch (e) {
		throw new _(`Failed to parse structured output: ${e}`);
	}
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/_vendor/partial-json-parser/parser.mjs
var Jt = (e) => {
	let t = 0, n = [];
	for (; t < e.length;) {
		let r = e[t];
		if (r === "\\") {
			t++;
			continue;
		}
		if (r === "{") {
			n.push({
				type: "brace",
				value: "{"
			}), t++;
			continue;
		}
		if (r === "}") {
			n.push({
				type: "brace",
				value: "}"
			}), t++;
			continue;
		}
		if (r === "[") {
			n.push({
				type: "paren",
				value: "["
			}), t++;
			continue;
		}
		if (r === "]") {
			n.push({
				type: "paren",
				value: "]"
			}), t++;
			continue;
		}
		if (r === ":") {
			n.push({
				type: "separator",
				value: ":"
			}), t++;
			continue;
		}
		if (r === ",") {
			n.push({
				type: "delimiter",
				value: ","
			}), t++;
			continue;
		}
		if (r === "\"") {
			let i = "", a = !1;
			for (r = e[++t]; r !== "\"";) {
				if (t === e.length) {
					a = !0;
					break;
				}
				if (r === "\\") {
					if (t++, t === e.length) {
						a = !0;
						break;
					}
					i += r + e[t], r = e[++t];
				} else i += r, r = e[++t];
			}
			r = e[++t], a || n.push({
				type: "string",
				value: i
			});
			continue;
		}
		if (r && /\s/.test(r)) {
			t++;
			continue;
		}
		let i = /[0-9]/;
		if (r && i.test(r) || r === "-" || r === ".") {
			let a = "";
			for (r === "-" && (a += r, r = e[++t]); r && i.test(r) || r === ".";) a += r, r = e[++t];
			n.push({
				type: "number",
				value: a
			});
			continue;
		}
		let a = /[a-z]/i;
		if (r && a.test(r)) {
			let i = "";
			for (; r && a.test(r) && t !== e.length;) i += r, r = e[++t];
			if (i == "true" || i == "false" || i === "null") n.push({
				type: "name",
				value: i
			});
			else {
				t++;
				continue;
			}
			continue;
		}
		t++;
	}
	return n;
}, Yt = (e) => {
	if (e.length === 0) return e;
	let t = e[e.length - 1];
	switch (t.type) {
		case "separator": return e = e.slice(0, e.length - 1), Yt(e);
		case "number":
			let n = t.value[t.value.length - 1];
			if (n === "." || n === "-") return e = e.slice(0, e.length - 1), Yt(e);
		case "string":
			let r = e[e.length - 2];
			if (r?.type === "delimiter" || r?.type === "brace" && r.value === "{") return e = e.slice(0, e.length - 1), Yt(e);
			break;
		case "delimiter": return e = e.slice(0, e.length - 1), Yt(e);
	}
	return e;
}, Xt = (e) => {
	let t = [];
	return e.map((e) => {
		e.type === "brace" && (e.value === "{" ? t.push("}") : t.splice(t.lastIndexOf("}"), 1)), e.type === "paren" && (e.value === "[" ? t.push("]") : t.splice(t.lastIndexOf("]"), 1));
	}), t.length > 0 && t.reverse().map((t) => {
		t === "}" ? e.push({
			type: "brace",
			value: "}"
		}) : t === "]" && e.push({
			type: "paren",
			value: "]"
		});
	}), e;
}, Zt = (e) => {
	let t = "";
	return e.map((e) => {
		switch (e.type) {
			case "string":
				t += "\"" + e.value + "\"";
				break;
			default: t += e.value;
		}
	}), t;
}, Qt = (e) => JSON.parse(Zt(Xt(Yt(Jt(e))))), N, P, F, $t, en, tn, nn, rn, an, I, L, on, sn, R, cn, ln, un, dn, fn, pn, mn, hn, gn, _n, vn = "__json_buf";
function yn(e) {
	return e.type === "tool_use" || e.type === "server_tool_use" || e.type === "mcp_tool_use";
}
var bn = class e {
	constructor(e, t) {
		N.add(this), this.messages = [], this.receivedMessages = [], P.set(this, void 0), F.set(this, null), this.controller = new AbortController(), $t.set(this, void 0), en.set(this, () => {}), tn.set(this, () => {}), nn.set(this, void 0), rn.set(this, () => {}), an.set(this, () => {}), I.set(this, {}), L.set(this, !1), on.set(this, !1), sn.set(this, !1), R.set(this, !1), cn.set(this, void 0), ln.set(this, void 0), un.set(this, void 0), pn.set(this, (e) => {
			if (h(this, on, !0, "f"), ne(e) && (e = new y()), e instanceof y) return h(this, sn, !0, "f"), this._emit("abort", e);
			if (e instanceof _) return this._emit("error", e);
			if (e instanceof Error) {
				let t = new _(e.message);
				return t.cause = e, this._emit("error", t);
			}
			return this._emit("error", new _(String(e)));
		}), h(this, $t, new Promise((e, t) => {
			h(this, en, e, "f"), h(this, tn, t, "f");
		}), "f"), h(this, nn, new Promise((e, t) => {
			h(this, rn, e, "f"), h(this, an, t, "f");
		}), "f"), g(this, $t, "f").catch(() => {}), g(this, nn, "f").catch(() => {}), h(this, F, e, "f"), h(this, un, t?.logger ?? console, "f");
	}
	get response() {
		return g(this, cn, "f");
	}
	get request_id() {
		return g(this, ln, "f");
	}
	async withResponse() {
		h(this, R, !0, "f");
		let e = await g(this, $t, "f");
		if (!e) throw Error("Could not resolve a `Response` object");
		return {
			data: this,
			response: e,
			request_id: e.headers.get("request-id")
		};
	}
	static fromReadableStream(t) {
		let n = new e(null);
		return n._run(() => n._fromReadableStream(t)), n;
	}
	static createMessage(t, n, r, { logger: i } = {}) {
		let a = new e(n, { logger: i });
		for (let e of n.messages) a._addMessageParam(e);
		return h(a, F, {
			...n,
			stream: !0
		}, "f"), a._run(() => a._createMessage(t, {
			...n,
			stream: !0
		}, {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), a;
	}
	_run(e) {
		e().then(() => {
			this._emitFinal(), this._emit("end");
		}, g(this, pn, "f"));
	}
	_addMessageParam(e) {
		this.messages.push(e);
	}
	_addMessage(e, t = !0) {
		this.receivedMessages.push(e), t && this._emit("message", e);
	}
	async _createMessage(e, t, n) {
		let r = n?.signal, i;
		r && (r.aborted && this.controller.abort(), i = this.controller.abort.bind(this.controller), r.addEventListener("abort", i));
		try {
			g(this, N, "m", mn).call(this);
			let { response: r, data: i } = await e.create({
				...t,
				stream: !0
			}, {
				...n,
				signal: this.controller.signal
			}).withResponse();
			this._connected(r);
			for await (let e of i) g(this, N, "m", hn).call(this, e);
			if (i.controller.signal?.aborted) throw new y();
			g(this, N, "m", gn).call(this);
		} finally {
			r && i && r.removeEventListener("abort", i);
		}
	}
	_connected(e) {
		this.ended || (h(this, cn, e, "f"), h(this, ln, e?.headers.get("request-id"), "f"), g(this, en, "f").call(this, e), this._emit("connect"));
	}
	get ended() {
		return g(this, L, "f");
	}
	get errored() {
		return g(this, on, "f");
	}
	get aborted() {
		return g(this, sn, "f");
	}
	abort() {
		this.controller.abort();
	}
	on(e, t) {
		return (g(this, I, "f")[e] || (g(this, I, "f")[e] = [])).push({ listener: t }), this;
	}
	off(e, t) {
		let n = g(this, I, "f")[e];
		if (!n) return this;
		let r = n.findIndex((e) => e.listener === t);
		return r >= 0 && n.splice(r, 1), this;
	}
	once(e, t) {
		return (g(this, I, "f")[e] || (g(this, I, "f")[e] = [])).push({
			listener: t,
			once: !0
		}), this;
	}
	emitted(e) {
		return new Promise((t, n) => {
			h(this, R, !0, "f"), e !== "error" && this.once("error", n), this.once(e, t);
		});
	}
	async done() {
		h(this, R, !0, "f"), await g(this, nn, "f");
	}
	get currentMessage() {
		return g(this, P, "f");
	}
	async finalMessage() {
		return await this.done(), g(this, N, "m", dn).call(this);
	}
	async finalText() {
		return await this.done(), g(this, N, "m", fn).call(this);
	}
	_emit(e, ...t) {
		if (g(this, L, "f")) return;
		e === "end" && (h(this, L, !0, "f"), g(this, rn, "f").call(this));
		let n = g(this, I, "f")[e];
		if (n && (g(this, I, "f")[e] = n.filter((e) => !e.once), n.forEach(({ listener: e }) => e(...t))), e === "abort") {
			let e = t[0];
			!g(this, R, "f") && !n?.length && Promise.reject(e), g(this, tn, "f").call(this, e), g(this, an, "f").call(this, e), this._emit("end");
			return;
		}
		if (e === "error") {
			let e = t[0];
			!g(this, R, "f") && !n?.length && Promise.reject(e), g(this, tn, "f").call(this, e), g(this, an, "f").call(this, e), this._emit("end");
		}
	}
	_emitFinal() {
		this.receivedMessages.at(-1) && this._emit("finalMessage", g(this, N, "m", dn).call(this));
	}
	async _fromReadableStream(e, t) {
		let n = t?.signal, r;
		n && (n.aborted && this.controller.abort(), r = this.controller.abort.bind(this.controller), n.addEventListener("abort", r));
		try {
			g(this, N, "m", mn).call(this), this._connected(null);
			let t = Qe.fromReadableStream(e, this.controller);
			for await (let e of t) g(this, N, "m", hn).call(this, e);
			if (t.controller.signal?.aborted) throw new y();
			g(this, N, "m", gn).call(this);
		} finally {
			n && r && n.removeEventListener("abort", r);
		}
	}
	[(P = /* @__PURE__ */ new WeakMap(), F = /* @__PURE__ */ new WeakMap(), $t = /* @__PURE__ */ new WeakMap(), en = /* @__PURE__ */ new WeakMap(), tn = /* @__PURE__ */ new WeakMap(), nn = /* @__PURE__ */ new WeakMap(), rn = /* @__PURE__ */ new WeakMap(), an = /* @__PURE__ */ new WeakMap(), I = /* @__PURE__ */ new WeakMap(), L = /* @__PURE__ */ new WeakMap(), on = /* @__PURE__ */ new WeakMap(), sn = /* @__PURE__ */ new WeakMap(), R = /* @__PURE__ */ new WeakMap(), cn = /* @__PURE__ */ new WeakMap(), ln = /* @__PURE__ */ new WeakMap(), un = /* @__PURE__ */ new WeakMap(), pn = /* @__PURE__ */ new WeakMap(), N = /* @__PURE__ */ new WeakSet(), dn = function() {
		if (this.receivedMessages.length === 0) throw new _("stream ended without producing a Message with role=assistant");
		return this.receivedMessages.at(-1);
	}, fn = function() {
		if (this.receivedMessages.length === 0) throw new _("stream ended without producing a Message with role=assistant");
		let e = this.receivedMessages.at(-1).content.filter((e) => e.type === "text").map((e) => e.text);
		if (e.length === 0) throw new _("stream ended without producing a content block with type=text");
		return e.join(" ");
	}, mn = function() {
		this.ended || h(this, P, void 0, "f");
	}, hn = function(e) {
		if (this.ended) return;
		let t = g(this, N, "m", _n).call(this, e);
		switch (this._emit("streamEvent", e, t), e.type) {
			case "content_block_delta": {
				let n = t.content.at(-1);
				switch (e.delta.type) {
					case "text_delta":
						n.type === "text" && this._emit("text", e.delta.text, n.text || "");
						break;
					case "citations_delta":
						n.type === "text" && this._emit("citation", e.delta.citation, n.citations ?? []);
						break;
					case "input_json_delta":
						yn(n) && n.input && this._emit("inputJson", e.delta.partial_json, n.input);
						break;
					case "thinking_delta":
						n.type === "thinking" && this._emit("thinking", e.delta.thinking, n.thinking);
						break;
					case "signature_delta":
						n.type === "thinking" && this._emit("signature", n.signature);
						break;
					case "compaction_delta":
						n.type === "compaction" && n.content && this._emit("compaction", n.content);
						break;
					default: e.delta;
				}
				break;
			}
			case "message_stop":
				this._addMessageParam(t), this._addMessage(Gt(t, g(this, F, "f"), { logger: g(this, un, "f") }), !0);
				break;
			case "content_block_stop":
				this._emit("contentBlock", t.content.at(-1));
				break;
			case "message_start": h(this, P, t, "f");
		}
	}, gn = function() {
		if (this.ended) throw new _("stream has ended, this shouldn't happen");
		let e = g(this, P, "f");
		if (!e) throw new _("request ended without sending any chunks");
		return h(this, P, void 0, "f"), Gt(e, g(this, F, "f"), { logger: g(this, un, "f") });
	}, _n = function(e) {
		let t = g(this, P, "f");
		if (e.type === "message_start") {
			if (t) throw new _(`Unexpected event order, got ${e.type} before receiving "message_stop"`);
			return e.message;
		}
		if (!t) throw new _(`Unexpected event order, got ${e.type} before "message_start"`);
		switch (e.type) {
			case "message_stop": return t;
			case "message_delta": return t.container = e.delta.container, t.stop_reason = e.delta.stop_reason, t.stop_sequence = e.delta.stop_sequence, t.usage.output_tokens = e.usage.output_tokens, t.context_management = e.context_management, e.usage.input_tokens != null && (t.usage.input_tokens = e.usage.input_tokens), e.usage.cache_creation_input_tokens != null && (t.usage.cache_creation_input_tokens = e.usage.cache_creation_input_tokens), e.usage.cache_read_input_tokens != null && (t.usage.cache_read_input_tokens = e.usage.cache_read_input_tokens), e.usage.server_tool_use != null && (t.usage.server_tool_use = e.usage.server_tool_use), e.usage.iterations != null && (t.usage.iterations = e.usage.iterations), t;
			case "content_block_start": return t.content.push(e.content_block), t;
			case "content_block_delta": {
				let n = t.content.at(e.index);
				switch (e.delta.type) {
					case "text_delta":
						n?.type === "text" && (t.content[e.index] = {
							...n,
							text: (n.text || "") + e.delta.text
						});
						break;
					case "citations_delta":
						n?.type === "text" && (t.content[e.index] = {
							...n,
							citations: [...n.citations ?? [], e.delta.citation]
						});
						break;
					case "input_json_delta":
						if (n && yn(n)) {
							let r = n[vn] || "";
							r += e.delta.partial_json;
							let i = { ...n };
							if (Object.defineProperty(i, vn, {
								value: r,
								enumerable: !1,
								writable: !0
							}), r) try {
								i.input = Qt(r);
							} catch (e) {
								let t = new _(`Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: ${e}. JSON: ${r}`);
								g(this, pn, "f").call(this, t);
							}
							t.content[e.index] = i;
						}
						break;
					case "thinking_delta":
						n?.type === "thinking" && (t.content[e.index] = {
							...n,
							thinking: n.thinking + e.delta.thinking
						});
						break;
					case "signature_delta":
						n?.type === "thinking" && (t.content[e.index] = {
							...n,
							signature: e.delta.signature
						});
						break;
					case "compaction_delta":
						n?.type === "compaction" && (t.content[e.index] = {
							...n,
							content: (n.content || "") + e.delta.content
						});
						break;
					default: e.delta;
				}
				return t;
			}
			case "content_block_stop": return t;
		}
	}, Symbol.asyncIterator)]() {
		let e = [], t = [], n = !1;
		return this.on("streamEvent", (n) => {
			let r = t.shift();
			r ? r.resolve(n) : e.push(n);
		}), this.on("end", () => {
			n = !0;
			for (let e of t) e.resolve(void 0);
			t.length = 0;
		}), this.on("abort", (e) => {
			n = !0;
			for (let n of t) n.reject(e);
			t.length = 0;
		}), this.on("error", (e) => {
			n = !0;
			for (let n of t) n.reject(e);
			t.length = 0;
		}), {
			next: async () => e.length ? {
				value: e.shift(),
				done: !1
			} : n ? {
				value: void 0,
				done: !0
			} : new Promise((e, n) => t.push({
				resolve: e,
				reject: n
			})).then((e) => e ? {
				value: e,
				done: !1
			} : {
				value: void 0,
				done: !0
			}),
			return: async () => (this.abort(), {
				value: void 0,
				done: !0
			})
		};
	}
	toReadableStream() {
		return new Qe(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
	}
}, xn = class extends Error {
	constructor(e) {
		let t = typeof e == "string" ? e : e.map((e) => e.type === "text" ? e.text : `[${e.type}]`).join(" ");
		super(t), this.name = "ToolError", this.content = e;
	}
}, Sn = "You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:\n1. Task Overview\nThe user's core request and success criteria\nAny clarifications or constraints they specified\n2. Current State\nWhat has been completed so far\nFiles created, modified, or analyzed (with paths if relevant)\nKey outputs or artifacts produced\n3. Important Discoveries\nTechnical constraints or requirements uncovered\nDecisions made and their rationale\nErrors encountered and how they were resolved\nWhat approaches were tried that didn't work (and why)\n4. Next Steps\nSpecific actions needed to complete the task\nAny blockers or open questions to resolve\nPriority order if multiple steps remain\n5. Context to Preserve\nUser preferences or style requirements\nDomain-specific details that aren't obvious\nAny promises made to the user\nBe concise but complete—err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.\nWrap your summary in <summary></summary> tags.", Cn, z, B, V, H, U, W, G, wn, Tn, En;
function Dn() {
	let e, t;
	return {
		promise: new Promise((n, r) => {
			e = n, t = r;
		}),
		resolve: e,
		reject: t
	};
}
var On = class {
	constructor(e, t, n) {
		Cn.add(this), this.client = e, z.set(this, !1), B.set(this, !1), V.set(this, void 0), H.set(this, void 0), U.set(this, void 0), W.set(this, void 0), G.set(this, void 0), wn.set(this, 0), h(this, V, { params: {
			...t,
			messages: structuredClone(t.messages)
		} }, "f");
		let r = ["BetaToolRunner", ...Mt(t.tools, t.messages)].join(", ");
		h(this, H, {
			...n,
			headers: A([{ "x-stainless-helper": r }, n?.headers])
		}, "f"), h(this, G, Dn(), "f"), t.compactionControl?.enabled && console.warn("Anthropic: The `compactionControl` parameter is deprecated and will be removed in a future version. Use server-side compaction instead by passing `edits: [{ type: \"compact_20260112\" }]` in the params passed to `toolRunner()`. See https://platform.claude.com/docs/en/build-with-claude/compaction");
	}
	async *[(z = /* @__PURE__ */ new WeakMap(), B = /* @__PURE__ */ new WeakMap(), V = /* @__PURE__ */ new WeakMap(), H = /* @__PURE__ */ new WeakMap(), U = /* @__PURE__ */ new WeakMap(), W = /* @__PURE__ */ new WeakMap(), G = /* @__PURE__ */ new WeakMap(), wn = /* @__PURE__ */ new WeakMap(), Cn = /* @__PURE__ */ new WeakSet(), Tn = async function() {
		let e = g(this, V, "f").params.compactionControl;
		if (!e || !e.enabled) return !1;
		let t = 0;
		if (g(this, U, "f") !== void 0) try {
			let e = await g(this, U, "f");
			t = e.usage.input_tokens + (e.usage.cache_creation_input_tokens ?? 0) + (e.usage.cache_read_input_tokens ?? 0) + e.usage.output_tokens;
		} catch {
			return !1;
		}
		let n = e.contextTokenThreshold ?? 1e5;
		if (t < n) return !1;
		let r = e.model ?? g(this, V, "f").params.model, i = e.summaryPrompt ?? Sn, a = g(this, V, "f").params.messages;
		if (a[a.length - 1].role === "assistant") {
			let e = a[a.length - 1];
			if (Array.isArray(e.content)) {
				let t = e.content.filter((e) => e.type !== "tool_use");
				t.length === 0 ? a.pop() : e.content = t;
			}
		}
		let o = await this.client.beta.messages.create({
			model: r,
			messages: [...a, {
				role: "user",
				content: [{
					type: "text",
					text: i
				}]
			}],
			max_tokens: g(this, V, "f").params.max_tokens
		}, {
			signal: g(this, H, "f").signal,
			headers: A([g(this, H, "f").headers, { "x-stainless-helper": "compaction" }])
		});
		if (o.content[0]?.type !== "text") throw new _("Expected text response for compaction");
		return g(this, V, "f").params.messages = [{
			role: "user",
			content: o.content
		}], !0;
	}, Symbol.asyncIterator)]() {
		var e;
		if (g(this, z, "f")) throw new _("Cannot iterate over a consumed stream");
		h(this, z, !0, "f"), h(this, B, !0, "f"), h(this, W, void 0, "f");
		try {
			for (;;) {
				let t;
				try {
					if (g(this, V, "f").params.max_iterations && g(this, wn, "f") >= g(this, V, "f").params.max_iterations) break;
					h(this, B, !1, "f"), h(this, W, void 0, "f"), h(this, wn, (e = g(this, wn, "f"), e++, e), "f"), h(this, U, void 0, "f");
					let { max_iterations: n, compactionControl: r, ...i } = g(this, V, "f").params;
					if (i.stream ? (t = this.client.beta.messages.stream({ ...i }, g(this, H, "f")), h(this, U, t.finalMessage(), "f"), g(this, U, "f").catch(() => {}), yield t) : (h(this, U, this.client.beta.messages.create({
						...i,
						stream: !1
					}, g(this, H, "f")), "f"), yield g(this, U, "f")), !await g(this, Cn, "m", Tn).call(this)) {
						if (!g(this, B, "f")) {
							let { role: e, content: t } = await g(this, U, "f");
							g(this, V, "f").params.messages.push({
								role: e,
								content: t
							});
						}
						let e = await g(this, Cn, "m", En).call(this, g(this, V, "f").params.messages.at(-1));
						if (e) g(this, V, "f").params.messages.push(e);
						else if (!g(this, B, "f")) break;
					}
				} finally {
					t && t.abort();
				}
			}
			if (!g(this, U, "f")) throw new _("ToolRunner concluded without a message from the server");
			g(this, G, "f").resolve(await g(this, U, "f"));
		} catch (e) {
			throw h(this, z, !1, "f"), g(this, G, "f").promise.catch(() => {}), g(this, G, "f").reject(e), h(this, G, Dn(), "f"), e;
		}
	}
	setMessagesParams(e) {
		typeof e == "function" ? g(this, V, "f").params = e(g(this, V, "f").params) : g(this, V, "f").params = e, h(this, B, !0, "f"), h(this, W, void 0, "f");
	}
	setRequestOptions(e) {
		typeof e == "function" ? h(this, H, e(g(this, H, "f")), "f") : h(this, H, {
			...g(this, H, "f"),
			...e
		}, "f");
	}
	async generateToolResponse(e = g(this, H, "f").signal) {
		let t = await g(this, U, "f") ?? this.params.messages.at(-1);
		return t ? g(this, Cn, "m", En).call(this, t, e) : null;
	}
	done() {
		return g(this, G, "f").promise;
	}
	async runUntilDone() {
		if (!g(this, z, "f")) for await (let e of this);
		return this.done();
	}
	get params() {
		return g(this, V, "f").params;
	}
	pushMessages(...e) {
		this.setMessagesParams((t) => ({
			...t,
			messages: [...t.messages, ...e]
		}));
	}
	then(e, t) {
		return this.runUntilDone().then(e, t);
	}
};
En = async function(e, t = g(this, H, "f").signal) {
	return g(this, W, "f") === void 0 && h(this, W, kn(g(this, V, "f").params, e, {
		...g(this, H, "f"),
		signal: t
	}), "f"), g(this, W, "f");
};
async function kn(e, t = e.messages.at(-1), n) {
	if (!t || t.role !== "assistant" || !t.content || typeof t.content == "string") return null;
	let r = t.content.filter((e) => e.type === "tool_use");
	return r.length === 0 ? null : {
		role: "user",
		content: await Promise.all(r.map(async (t) => {
			let r = e.tools.find((e) => ("name" in e ? e.name : e.mcp_server_name) === t.name);
			if (!r || !("run" in r)) return {
				type: "tool_result",
				tool_use_id: t.id,
				content: `Error: Tool '${t.name}' not found`,
				is_error: !0
			};
			try {
				let e = t.input;
				"parse" in r && r.parse && (e = r.parse(e));
				let i = await r.run(e, {
					toolUseBlock: t,
					signal: n?.signal
				});
				return {
					type: "tool_result",
					tool_use_id: t.id,
					content: i
				};
			} catch (e) {
				return {
					type: "tool_result",
					tool_use_id: t.id,
					content: e instanceof xn ? e.content : `Error: ${e instanceof Error ? e.message : String(e)}`,
					is_error: !0
				};
			}
		}))
	};
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/internal/decoders/jsonl.mjs
var An = class e {
	constructor(e, t) {
		this.iterator = e, this.controller = t;
	}
	async *decoder() {
		let e = new We();
		for await (let t of this.iterator) for (let n of e.decode(t)) yield JSON.parse(n);
		for (let t of e.flush()) yield JSON.parse(t);
	}
	[Symbol.asyncIterator]() {
		return this.decoder();
	}
	static fromResponse(t, n) {
		if (!t.body) throw n.abort(), globalThis.navigator !== void 0 && globalThis.navigator.product === "ReactNative" ? new _("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new _("Attempted to iterate over a response with no body");
		return new e(Fe(t.body), n);
	}
}, jn = class extends k {
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/messages/batches?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/messages/batches/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "message-batches-2024-09-24"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/messages/batches?beta=true", ut, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/messages/batches/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "message-batches-2024-09-24"].toString() }, n?.headers])
		});
	}
	cancel(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/messages/batches/${e}/cancel?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "message-batches-2024-09-24"].toString() }, n?.headers])
		});
	}
	async results(e, t = {}, n) {
		let r = await this.retrieve(e);
		if (!r.results_url) throw new _(`No batch \`results_url\`; Has it finished processing? ${r.processing_status} - ${r.id}`);
		let { betas: i } = t ?? {};
		return this._client.get(r.results_url, {
			...n,
			headers: A([{
				"anthropic-beta": [...i ?? [], "message-batches-2024-09-24"].toString(),
				Accept: "application/binary"
			}, n?.headers]),
			stream: !0,
			__binaryResponse: !0
		})._thenUnwrap((e, t) => An.fromResponse(t.response, t.controller));
	}
}, Mn = {
	"claude-1.3": "November 6th, 2024",
	"claude-1.3-100k": "November 6th, 2024",
	"claude-instant-1.1": "November 6th, 2024",
	"claude-instant-1.1-100k": "November 6th, 2024",
	"claude-instant-1.2": "November 6th, 2024",
	"claude-3-sonnet-20240229": "July 21st, 2025",
	"claude-3-opus-20240229": "January 5th, 2026",
	"claude-2.1": "July 21st, 2025",
	"claude-2.0": "July 21st, 2025",
	"claude-3-7-sonnet-latest": "February 19th, 2026",
	"claude-3-7-sonnet-20250219": "February 19th, 2026"
}, Nn = ["claude-mythos-preview", "claude-opus-4-6"], Pn = class extends k {
	constructor() {
		super(...arguments), this.batches = new jn(this._client);
	}
	create(e, t) {
		let n = Fn(e), { betas: r, ...i } = n;
		i.model in Mn && console.warn(`The model '${i.model}' is deprecated and will reach end-of-life on ${Mn[i.model]}\nPlease migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`), Nn.includes(i.model) && i.thinking && i.thinking.type === "enabled" && console.warn(`Using Claude with ${i.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
		let a = this._client._options.timeout;
		if (!i.stream && a == null) {
			let e = Ut[i.model] ?? void 0;
			a = this._client.calculateNonstreamingTimeout(i.max_tokens, e);
		}
		let o = Nt(i.tools, i.messages);
		return this._client.post("/v1/messages?beta=true", {
			body: i,
			timeout: a ?? 6e5,
			...t,
			headers: A([
				{ ...r?.toString() == null ? void 0 : { "anthropic-beta": r?.toString() } },
				o,
				t?.headers
			]),
			stream: n.stream ?? !1
		});
	}
	parse(e, t) {
		return t = {
			...t,
			headers: A([{ "anthropic-beta": [...e.betas ?? [], "structured-outputs-2025-12-15"].toString() }, t?.headers])
		}, this.create(e, t).then((t) => Kt(t, e, { logger: this._client.logger ?? console }));
	}
	stream(e, t) {
		return bn.createMessage(this, e, t);
	}
	countTokens(e, t) {
		let { betas: n, ...r } = Fn(e);
		return this._client.post("/v1/messages/count_tokens?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "token-counting-2024-11-01"].toString() }, t?.headers])
		});
	}
	toolRunner(e, t) {
		return new On(this._client, e, t);
	}
};
function Fn(e) {
	if (!e.output_format) return e;
	if (e.output_config?.format) throw new _("Both output_format and output_config.format were provided. Please use only output_config.format (output_format is deprecated).");
	let { output_format: t, ...n } = e;
	return {
		...n,
		output_config: {
			...e.output_config,
			format: t
		}
	};
}
Pn.Batches = jn, Pn.BetaToolRunner = On, Pn.ToolError = xn;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/beta/sessions/events.mjs
var In = class extends k {
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/sessions/${e}/events?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	send(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/sessions/${e}/events?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	stream(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/sessions/${e}/events/stream?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers]),
			stream: !0
		});
	}
}, Ln = class extends k {
	retrieve(e, t, n) {
		let { session_id: r, betas: i } = t;
		return this._client.get(j`/v1/sessions/${r}/resources/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { session_id: r, betas: i, ...a } = t;
		return this._client.post(j`/v1/sessions/${r}/resources/${e}?beta=true`, {
			body: a,
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/sessions/${e}/resources?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	delete(e, t, n) {
		let { session_id: r, betas: i } = t;
		return this._client.delete(j`/v1/sessions/${r}/resources/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	add(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/sessions/${e}/resources?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
}, Rn = class extends k {
	constructor() {
		super(...arguments), this.events = new In(this._client), this.resources = new Ln(this._client);
	}
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/sessions?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/sessions/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/sessions/${e}?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/sessions?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/sessions/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	archive(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/sessions/${e}/archive?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
};
Rn.Events = In, Rn.Resources = Ln;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/beta/skills/versions.mjs
var zn = class extends k {
	create(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.post(j`/v1/skills/${e}/versions?beta=true`, mt({
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "skills-2025-10-02"].toString() }, n?.headers])
		}, this._client));
	}
	retrieve(e, t, n) {
		let { skill_id: r, betas: i } = t;
		return this._client.get(j`/v1/skills/${r}/versions/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "skills-2025-10-02"].toString() }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/skills/${e}/versions?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "skills-2025-10-02"].toString() }, n?.headers])
		});
	}
	delete(e, t, n) {
		let { skill_id: r, betas: i } = t;
		return this._client.delete(j`/v1/skills/${r}/versions/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "skills-2025-10-02"].toString() }, n?.headers])
		});
	}
}, Bn = class extends k {
	constructor() {
		super(...arguments), this.versions = new zn(this._client);
	}
	create(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.post("/v1/skills?beta=true", mt({
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "skills-2025-10-02"].toString() }, t?.headers])
		}, this._client, !1));
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/skills/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "skills-2025-10-02"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/skills?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "skills-2025-10-02"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/skills/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "skills-2025-10-02"].toString() }, n?.headers])
		});
	}
};
Bn.Versions = zn;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/beta/vaults/credentials.mjs
var Vn = class extends k {
	create(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/vaults/${e}/credentials?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	retrieve(e, t, n) {
		let { vault_id: r, betas: i } = t;
		return this._client.get(j`/v1/vaults/${r}/credentials/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { vault_id: r, betas: i, ...a } = t;
		return this._client.post(j`/v1/vaults/${r}/credentials/${e}?beta=true`, {
			body: a,
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		let { betas: r, ...i } = t ?? {};
		return this._client.getAPIList(j`/v1/vaults/${e}/credentials?beta=true`, D, {
			query: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	delete(e, t, n) {
		let { vault_id: r, betas: i } = t;
		return this._client.delete(j`/v1/vaults/${r}/credentials/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	archive(e, t, n) {
		let { vault_id: r, betas: i } = t;
		return this._client.post(j`/v1/vaults/${r}/credentials/${e}/archive?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
}, Hn = class extends k {
	constructor() {
		super(...arguments), this.credentials = new Vn(this._client);
	}
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/vaults?beta=true", {
			body: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/vaults/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	update(e, t, n) {
		let { betas: r, ...i } = t;
		return this._client.post(j`/v1/vaults/${e}?beta=true`, {
			body: i,
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/vaults?beta=true", D, {
			query: r,
			...t,
			headers: A([{ "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() }, t?.headers])
		});
	}
	delete(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.delete(j`/v1/vaults/${e}?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
	archive(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.post(j`/v1/vaults/${e}/archive?beta=true`, {
			...n,
			headers: A([{ "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() }, n?.headers])
		});
	}
};
Hn.Credentials = Vn;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/beta/beta.mjs
var K = class extends k {
	constructor() {
		super(...arguments), this.models = new It(this._client), this.messages = new Pn(this._client), this.agents = new zt(this._client), this.environments = new At(this._client), this.sessions = new Rn(this._client), this.vaults = new Hn(this._client), this.memoryStores = new Ht(this._client), this.files = new Ft(this._client), this.skills = new Bn(this._client), this.userProfiles = new Lt(this._client);
	}
};
K.Models = It, K.Messages = Pn, K.Agents = zt, K.Environments = At, K.Sessions = Rn, K.Vaults = Hn, K.MemoryStores = Ht, K.Files = Ft, K.Skills = Bn, K.UserProfiles = Lt;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/completions.mjs
var Un = class extends k {
	create(e, t) {
		let { betas: n, ...r } = e;
		return this._client.post("/v1/complete", {
			body: r,
			timeout: this._client._options.timeout ?? 6e5,
			...t,
			headers: A([{ ...n?.toString() == null ? void 0 : { "anthropic-beta": n?.toString() } }, t?.headers]),
			stream: e.stream ?? !1
		});
	}
};
//#endregion
//#region node_modules/@anthropic-ai/sdk/lib/parser.mjs
function Wn(e) {
	return e?.output_config?.format;
}
function Gn(e, t, n) {
	let r = Wn(t);
	return !t || !("parse" in (r ?? {})) ? {
		...e,
		content: e.content.map((e) => e.type === "text" ? Object.defineProperty({ ...e }, "parsed_output", {
			value: null,
			enumerable: !1
		}) : e),
		parsed_output: null
	} : Kn(e, t, n);
}
function Kn(e, t, n) {
	let r = null, i = e.content.map((e) => {
		if (e.type === "text") {
			let n = qn(t, e.text);
			return r === null && (r = n), Object.defineProperty({ ...e }, "parsed_output", {
				value: n,
				enumerable: !1
			});
		}
		return e;
	});
	return {
		...e,
		content: i,
		parsed_output: r
	};
}
function qn(e, t) {
	let n = Wn(e);
	if (n?.type !== "json_schema") return null;
	try {
		return "parse" in n ? n.parse(t) : JSON.parse(t);
	} catch (e) {
		throw new _(`Failed to parse structured output: ${e}`);
	}
}
//#endregion
//#region node_modules/@anthropic-ai/sdk/lib/MessageStream.mjs
var q, J, Y, Jn, Yn, Xn, Zn, Qn, $n, X, er, tr, nr, Z, rr, ir, ar, or, sr, cr, lr, ur, dr, fr, pr = "__json_buf";
function mr(e) {
	return e.type === "tool_use" || e.type === "server_tool_use";
}
var hr = class e {
	constructor(e, t) {
		q.add(this), this.messages = [], this.receivedMessages = [], J.set(this, void 0), Y.set(this, null), this.controller = new AbortController(), Jn.set(this, void 0), Yn.set(this, () => {}), Xn.set(this, () => {}), Zn.set(this, void 0), Qn.set(this, () => {}), $n.set(this, () => {}), X.set(this, {}), er.set(this, !1), tr.set(this, !1), nr.set(this, !1), Z.set(this, !1), rr.set(this, void 0), ir.set(this, void 0), ar.set(this, void 0), cr.set(this, (e) => {
			if (h(this, tr, !0, "f"), ne(e) && (e = new y()), e instanceof y) return h(this, nr, !0, "f"), this._emit("abort", e);
			if (e instanceof _) return this._emit("error", e);
			if (e instanceof Error) {
				let t = new _(e.message);
				return t.cause = e, this._emit("error", t);
			}
			return this._emit("error", new _(String(e)));
		}), h(this, Jn, new Promise((e, t) => {
			h(this, Yn, e, "f"), h(this, Xn, t, "f");
		}), "f"), h(this, Zn, new Promise((e, t) => {
			h(this, Qn, e, "f"), h(this, $n, t, "f");
		}), "f"), g(this, Jn, "f").catch(() => {}), g(this, Zn, "f").catch(() => {}), h(this, Y, e, "f"), h(this, ar, t?.logger ?? console, "f");
	}
	get response() {
		return g(this, rr, "f");
	}
	get request_id() {
		return g(this, ir, "f");
	}
	async withResponse() {
		h(this, Z, !0, "f");
		let e = await g(this, Jn, "f");
		if (!e) throw Error("Could not resolve a `Response` object");
		return {
			data: this,
			response: e,
			request_id: e.headers.get("request-id")
		};
	}
	static fromReadableStream(t) {
		let n = new e(null);
		return n._run(() => n._fromReadableStream(t)), n;
	}
	static createMessage(t, n, r, { logger: i } = {}) {
		let a = new e(n, { logger: i });
		for (let e of n.messages) a._addMessageParam(e);
		return h(a, Y, {
			...n,
			stream: !0
		}, "f"), a._run(() => a._createMessage(t, {
			...n,
			stream: !0
		}, {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), a;
	}
	_run(e) {
		e().then(() => {
			this._emitFinal(), this._emit("end");
		}, g(this, cr, "f"));
	}
	_addMessageParam(e) {
		this.messages.push(e);
	}
	_addMessage(e, t = !0) {
		this.receivedMessages.push(e), t && this._emit("message", e);
	}
	async _createMessage(e, t, n) {
		let r = n?.signal, i;
		r && (r.aborted && this.controller.abort(), i = this.controller.abort.bind(this.controller), r.addEventListener("abort", i));
		try {
			g(this, q, "m", lr).call(this);
			let { response: r, data: i } = await e.create({
				...t,
				stream: !0
			}, {
				...n,
				signal: this.controller.signal
			}).withResponse();
			this._connected(r);
			for await (let e of i) g(this, q, "m", ur).call(this, e);
			if (i.controller.signal?.aborted) throw new y();
			g(this, q, "m", dr).call(this);
		} finally {
			r && i && r.removeEventListener("abort", i);
		}
	}
	_connected(e) {
		this.ended || (h(this, rr, e, "f"), h(this, ir, e?.headers.get("request-id"), "f"), g(this, Yn, "f").call(this, e), this._emit("connect"));
	}
	get ended() {
		return g(this, er, "f");
	}
	get errored() {
		return g(this, tr, "f");
	}
	get aborted() {
		return g(this, nr, "f");
	}
	abort() {
		this.controller.abort();
	}
	on(e, t) {
		return (g(this, X, "f")[e] || (g(this, X, "f")[e] = [])).push({ listener: t }), this;
	}
	off(e, t) {
		let n = g(this, X, "f")[e];
		if (!n) return this;
		let r = n.findIndex((e) => e.listener === t);
		return r >= 0 && n.splice(r, 1), this;
	}
	once(e, t) {
		return (g(this, X, "f")[e] || (g(this, X, "f")[e] = [])).push({
			listener: t,
			once: !0
		}), this;
	}
	emitted(e) {
		return new Promise((t, n) => {
			h(this, Z, !0, "f"), e !== "error" && this.once("error", n), this.once(e, t);
		});
	}
	async done() {
		h(this, Z, !0, "f"), await g(this, Zn, "f");
	}
	get currentMessage() {
		return g(this, J, "f");
	}
	async finalMessage() {
		return await this.done(), g(this, q, "m", or).call(this);
	}
	async finalText() {
		return await this.done(), g(this, q, "m", sr).call(this);
	}
	_emit(e, ...t) {
		if (g(this, er, "f")) return;
		e === "end" && (h(this, er, !0, "f"), g(this, Qn, "f").call(this));
		let n = g(this, X, "f")[e];
		if (n && (g(this, X, "f")[e] = n.filter((e) => !e.once), n.forEach(({ listener: e }) => e(...t))), e === "abort") {
			let e = t[0];
			!g(this, Z, "f") && !n?.length && Promise.reject(e), g(this, Xn, "f").call(this, e), g(this, $n, "f").call(this, e), this._emit("end");
			return;
		}
		if (e === "error") {
			let e = t[0];
			!g(this, Z, "f") && !n?.length && Promise.reject(e), g(this, Xn, "f").call(this, e), g(this, $n, "f").call(this, e), this._emit("end");
		}
	}
	_emitFinal() {
		this.receivedMessages.at(-1) && this._emit("finalMessage", g(this, q, "m", or).call(this));
	}
	async _fromReadableStream(e, t) {
		let n = t?.signal, r;
		n && (n.aborted && this.controller.abort(), r = this.controller.abort.bind(this.controller), n.addEventListener("abort", r));
		try {
			g(this, q, "m", lr).call(this), this._connected(null);
			let t = Qe.fromReadableStream(e, this.controller);
			for await (let e of t) g(this, q, "m", ur).call(this, e);
			if (t.controller.signal?.aborted) throw new y();
			g(this, q, "m", dr).call(this);
		} finally {
			n && r && n.removeEventListener("abort", r);
		}
	}
	[(J = /* @__PURE__ */ new WeakMap(), Y = /* @__PURE__ */ new WeakMap(), Jn = /* @__PURE__ */ new WeakMap(), Yn = /* @__PURE__ */ new WeakMap(), Xn = /* @__PURE__ */ new WeakMap(), Zn = /* @__PURE__ */ new WeakMap(), Qn = /* @__PURE__ */ new WeakMap(), $n = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakMap(), er = /* @__PURE__ */ new WeakMap(), tr = /* @__PURE__ */ new WeakMap(), nr = /* @__PURE__ */ new WeakMap(), Z = /* @__PURE__ */ new WeakMap(), rr = /* @__PURE__ */ new WeakMap(), ir = /* @__PURE__ */ new WeakMap(), ar = /* @__PURE__ */ new WeakMap(), cr = /* @__PURE__ */ new WeakMap(), q = /* @__PURE__ */ new WeakSet(), or = function() {
		if (this.receivedMessages.length === 0) throw new _("stream ended without producing a Message with role=assistant");
		return this.receivedMessages.at(-1);
	}, sr = function() {
		if (this.receivedMessages.length === 0) throw new _("stream ended without producing a Message with role=assistant");
		let e = this.receivedMessages.at(-1).content.filter((e) => e.type === "text").map((e) => e.text);
		if (e.length === 0) throw new _("stream ended without producing a content block with type=text");
		return e.join(" ");
	}, lr = function() {
		this.ended || h(this, J, void 0, "f");
	}, ur = function(e) {
		if (this.ended) return;
		let t = g(this, q, "m", fr).call(this, e);
		switch (this._emit("streamEvent", e, t), e.type) {
			case "content_block_delta": {
				let n = t.content.at(-1);
				switch (e.delta.type) {
					case "text_delta":
						n.type === "text" && this._emit("text", e.delta.text, n.text || "");
						break;
					case "citations_delta":
						n.type === "text" && this._emit("citation", e.delta.citation, n.citations ?? []);
						break;
					case "input_json_delta":
						mr(n) && n.input && this._emit("inputJson", e.delta.partial_json, n.input);
						break;
					case "thinking_delta":
						n.type === "thinking" && this._emit("thinking", e.delta.thinking, n.thinking);
						break;
					case "signature_delta":
						n.type === "thinking" && this._emit("signature", n.signature);
						break;
					default: e.delta;
				}
				break;
			}
			case "message_stop":
				this._addMessageParam(t), this._addMessage(Gn(t, g(this, Y, "f"), { logger: g(this, ar, "f") }), !0);
				break;
			case "content_block_stop":
				this._emit("contentBlock", t.content.at(-1));
				break;
			case "message_start": h(this, J, t, "f");
		}
	}, dr = function() {
		if (this.ended) throw new _("stream has ended, this shouldn't happen");
		let e = g(this, J, "f");
		if (!e) throw new _("request ended without sending any chunks");
		return h(this, J, void 0, "f"), Gn(e, g(this, Y, "f"), { logger: g(this, ar, "f") });
	}, fr = function(e) {
		let t = g(this, J, "f");
		if (e.type === "message_start") {
			if (t) throw new _(`Unexpected event order, got ${e.type} before receiving "message_stop"`);
			return e.message;
		}
		if (!t) throw new _(`Unexpected event order, got ${e.type} before "message_start"`);
		switch (e.type) {
			case "message_stop": return t;
			case "message_delta": return t.stop_reason = e.delta.stop_reason, t.stop_sequence = e.delta.stop_sequence, t.usage.output_tokens = e.usage.output_tokens, e.usage.input_tokens != null && (t.usage.input_tokens = e.usage.input_tokens), e.usage.cache_creation_input_tokens != null && (t.usage.cache_creation_input_tokens = e.usage.cache_creation_input_tokens), e.usage.cache_read_input_tokens != null && (t.usage.cache_read_input_tokens = e.usage.cache_read_input_tokens), e.usage.server_tool_use != null && (t.usage.server_tool_use = e.usage.server_tool_use), t;
			case "content_block_start": return t.content.push({ ...e.content_block }), t;
			case "content_block_delta": {
				let n = t.content.at(e.index);
				switch (e.delta.type) {
					case "text_delta":
						n?.type === "text" && (t.content[e.index] = {
							...n,
							text: (n.text || "") + e.delta.text
						});
						break;
					case "citations_delta":
						n?.type === "text" && (t.content[e.index] = {
							...n,
							citations: [...n.citations ?? [], e.delta.citation]
						});
						break;
					case "input_json_delta":
						if (n && mr(n)) {
							let r = n[pr] || "";
							r += e.delta.partial_json;
							let i = { ...n };
							Object.defineProperty(i, pr, {
								value: r,
								enumerable: !1,
								writable: !0
							}), r && (i.input = Qt(r)), t.content[e.index] = i;
						}
						break;
					case "thinking_delta":
						n?.type === "thinking" && (t.content[e.index] = {
							...n,
							thinking: n.thinking + e.delta.thinking
						});
						break;
					case "signature_delta":
						n?.type === "thinking" && (t.content[e.index] = {
							...n,
							signature: e.delta.signature
						});
						break;
					default: e.delta;
				}
				return t;
			}
			case "content_block_stop": return t;
		}
	}, Symbol.asyncIterator)]() {
		let e = [], t = [], n = !1;
		return this.on("streamEvent", (n) => {
			let r = t.shift();
			r ? r.resolve(n) : e.push(n);
		}), this.on("end", () => {
			n = !0;
			for (let e of t) e.resolve(void 0);
			t.length = 0;
		}), this.on("abort", (e) => {
			n = !0;
			for (let n of t) n.reject(e);
			t.length = 0;
		}), this.on("error", (e) => {
			n = !0;
			for (let n of t) n.reject(e);
			t.length = 0;
		}), {
			next: async () => e.length ? {
				value: e.shift(),
				done: !1
			} : n ? {
				value: void 0,
				done: !0
			} : new Promise((e, n) => t.push({
				resolve: e,
				reject: n
			})).then((e) => e ? {
				value: e,
				done: !1
			} : {
				value: void 0,
				done: !0
			}),
			return: async () => (this.abort(), {
				value: void 0,
				done: !0
			})
		};
	}
	toReadableStream() {
		return new Qe(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
	}
}, gr = class extends k {
	create(e, t) {
		return this._client.post("/v1/messages/batches", {
			body: e,
			...t
		});
	}
	retrieve(e, t) {
		return this._client.get(j`/v1/messages/batches/${e}`, t);
	}
	list(e = {}, t) {
		return this._client.getAPIList("/v1/messages/batches", ut, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(j`/v1/messages/batches/${e}`, t);
	}
	cancel(e, t) {
		return this._client.post(j`/v1/messages/batches/${e}/cancel`, t);
	}
	async results(e, t) {
		let n = await this.retrieve(e);
		if (!n.results_url) throw new _(`No batch \`results_url\`; Has it finished processing? ${n.processing_status} - ${n.id}`);
		return this._client.get(n.results_url, {
			...t,
			headers: A([{ Accept: "application/binary" }, t?.headers]),
			stream: !0,
			__binaryResponse: !0
		})._thenUnwrap((e, t) => An.fromResponse(t.response, t.controller));
	}
}, _r = class extends k {
	constructor() {
		super(...arguments), this.batches = new gr(this._client);
	}
	create(e, t) {
		e.model in vr && console.warn(`The model '${e.model}' is deprecated and will reach end-of-life on ${vr[e.model]}\nPlease migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`), yr.includes(e.model) && e.thinking && e.thinking.type === "enabled" && console.warn(`Using Claude with ${e.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
		let n = this._client._options.timeout;
		if (!e.stream && n == null) {
			let t = Ut[e.model] ?? void 0;
			n = this._client.calculateNonstreamingTimeout(e.max_tokens, t);
		}
		let r = Nt(e.tools, e.messages);
		return this._client.post("/v1/messages", {
			body: e,
			timeout: n ?? 6e5,
			...t,
			headers: A([r, t?.headers]),
			stream: e.stream ?? !1
		});
	}
	parse(e, t) {
		return this.create(e, t).then((t) => Kn(t, e, { logger: this._client.logger ?? console }));
	}
	stream(e, t) {
		return hr.createMessage(this, e, t, { logger: this._client.logger ?? console });
	}
	countTokens(e, t) {
		return this._client.post("/v1/messages/count_tokens", {
			body: e,
			...t
		});
	}
}, vr = {
	"claude-1.3": "November 6th, 2024",
	"claude-1.3-100k": "November 6th, 2024",
	"claude-instant-1.1": "November 6th, 2024",
	"claude-instant-1.1-100k": "November 6th, 2024",
	"claude-instant-1.2": "November 6th, 2024",
	"claude-3-sonnet-20240229": "July 21st, 2025",
	"claude-3-opus-20240229": "January 5th, 2026",
	"claude-2.1": "July 21st, 2025",
	"claude-2.0": "July 21st, 2025",
	"claude-3-7-sonnet-latest": "February 19th, 2026",
	"claude-3-7-sonnet-20250219": "February 19th, 2026",
	"claude-3-5-haiku-latest": "February 19th, 2026",
	"claude-3-5-haiku-20241022": "February 19th, 2026",
	"claude-opus-4-0": "June 15th, 2026",
	"claude-opus-4-20250514": "June 15th, 2026",
	"claude-sonnet-4-0": "June 15th, 2026",
	"claude-sonnet-4-20250514": "June 15th, 2026"
}, yr = ["claude-mythos-preview", "claude-opus-4-6"];
_r.Batches = gr;
//#endregion
//#region node_modules/@anthropic-ai/sdk/resources/models.mjs
var br = class extends k {
	retrieve(e, t = {}, n) {
		let { betas: r } = t ?? {};
		return this._client.get(j`/v1/models/${e}`, {
			...n,
			headers: A([{ ...r?.toString() == null ? void 0 : { "anthropic-beta": r?.toString() } }, n?.headers])
		});
	}
	list(e = {}, t) {
		let { betas: n, ...r } = e ?? {};
		return this._client.getAPIList("/v1/models", ut, {
			query: r,
			...t,
			headers: A([{ ...n?.toString() == null ? void 0 : { "anthropic-beta": n?.toString() } }, t?.headers])
		});
	}
}, xr = (e) => {
	if (globalThis.process !== void 0) return globalThis.process.env?.[e]?.trim() || void 0;
	if (globalThis.Deno !== void 0) return globalThis.Deno.env?.get?.(e)?.trim() || void 0;
}, Sr, Cr, wr, Tr, Er = "\\n\\nHuman:", Dr = "\\n\\nAssistant:", Q = class {
	constructor({ baseURL: e = xr("ANTHROPIC_BASE_URL"), apiKey: t = xr("ANTHROPIC_API_KEY") ?? null, authToken: n = xr("ANTHROPIC_AUTH_TOKEN") ?? null, ...r } = {}) {
		Sr.add(this), wr.set(this, void 0);
		let i = {
			apiKey: t,
			authToken: n,
			...r,
			baseURL: e || "https://api.anthropic.com"
		};
		if (!i.dangerouslyAllowBrowser && we()) throw new _("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew Anthropic({ apiKey, dangerouslyAllowBrowser: true });\n");
		this.baseURL = i.baseURL, this.timeout = i.timeout ?? Cr.DEFAULT_TIMEOUT, this.logger = i.logger ?? console;
		let a = "warn";
		this.logLevel = a, this.logLevel = Je(i.logLevel, "ClientOptions.logLevel", this) ?? Je(xr("ANTHROPIC_LOG"), "process.env['ANTHROPIC_LOG']", this) ?? a, this.fetchOptions = i.fetchOptions, this.maxRetries = i.maxRetries ?? 2, this.fetch = i.fetch ?? Me(), h(this, wr, Le, "f"), this._options = i, this.apiKey = typeof t == "string" ? t : null, this.authToken = n;
	}
	withOptions(e) {
		return new this.constructor({
			...this._options,
			baseURL: this.baseURL,
			maxRetries: this.maxRetries,
			timeout: this.timeout,
			logger: this.logger,
			logLevel: this.logLevel,
			fetch: this.fetch,
			fetchOptions: this.fetchOptions,
			apiKey: this.apiKey,
			authToken: this.authToken,
			...e
		});
	}
	defaultQuery() {
		return this._options.defaultQuery;
	}
	validateHeaders({ values: e, nulls: t }) {
		if (!(e.get("x-api-key") || e.get("authorization")) && !(this.apiKey && e.get("x-api-key")) && !t.has("x-api-key") && !(this.authToken && e.get("authorization")) && !t.has("authorization")) throw Error("Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the \"X-Api-Key\" or \"Authorization\" headers to be explicitly omitted");
	}
	async authHeaders(e) {
		return A([await this.apiKeyAuth(e), await this.bearerAuth(e)]);
	}
	async apiKeyAuth(e) {
		if (this.apiKey != null) return A([{ "X-Api-Key": this.apiKey }]);
	}
	async bearerAuth(e) {
		if (this.authToken != null) return A([{ Authorization: `Bearer ${this.authToken}` }]);
	}
	stringifyQuery(e) {
		return Re(e);
	}
	getUserAgent() {
		return `${this.constructor.name}/JS ${b}`;
	}
	defaultIdempotencyKey() {
		return `stainless-node-retry-${te()}`;
	}
	makeStatusError(e, t, n, r) {
		return v.generate(e, t, n, r);
	}
	buildURL(e, t, n) {
		let r = !g(this, Sr, "m", Tr).call(this) && n || this.baseURL, i = he(e) ? new URL(e) : new URL(r + (r.endsWith("/") && e.startsWith("/") ? e.slice(1) : e)), a = this.defaultQuery(), o = Object.fromEntries(i.searchParams);
		return (!ye(a) || !ye(o)) && (t = {
			...o,
			...a,
			...t
		}), typeof t == "object" && t && !Array.isArray(t) && (i.search = this.stringifyQuery(t)), i.toString();
	}
	_calculateNonstreamingTimeout(e) {
		if (3600 * e / 128e3 > 600) throw new _("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#streaming-responses for more details");
		return 6e5;
	}
	async prepareOptions(e) {}
	async prepareRequest(e, { url: t, options: n }) {}
	get(e, t) {
		return this.methodRequest("get", e, t);
	}
	post(e, t) {
		return this.methodRequest("post", e, t);
	}
	patch(e, t) {
		return this.methodRequest("patch", e, t);
	}
	put(e, t) {
		return this.methodRequest("put", e, t);
	}
	delete(e, t) {
		return this.methodRequest("delete", e, t);
	}
	methodRequest(e, t, n) {
		return this.request(Promise.resolve(n).then((n) => ({
			method: e,
			path: t,
			...n
		})));
	}
	request(e, t = null) {
		return new ot(this, this.makeRequest(e, t, void 0));
	}
	async makeRequest(e, t, n) {
		let r = await e, i = r.maxRetries ?? this.maxRetries;
		t ??= i, await this.prepareOptions(r);
		let { req: a, url: o, timeout: s } = await this.buildRequest(r, { retryCount: i - t });
		await this.prepareRequest(a, {
			url: o,
			options: r
		});
		let c = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0"), l = n === void 0 ? "" : `, retryOf: ${n}`, u = Date.now();
		if (w(this).debug(`[${c}] sending request`, T({
			retryOfRequestLogID: n,
			method: r.method,
			url: o,
			options: r,
			headers: a.headers
		})), r.signal?.aborted) throw new y();
		let d = new AbortController(), f = await this.fetchWithTimeout(o, a, s, d).catch(re), p = Date.now();
		if (f instanceof globalThis.Error) {
			let e = `retrying, ${t} attempts remaining`;
			if (r.signal?.aborted) throw new y();
			let i = ne(f) || /timed? ?out/i.test(String(f) + ("cause" in f ? String(f.cause) : ""));
			if (t) return w(this).info(`[${c}] connection ${i ? "timed out" : "failed"} - ${e}`), w(this).debug(`[${c}] connection ${i ? "timed out" : "failed"} (${e})`, T({
				retryOfRequestLogID: n,
				url: o,
				durationMs: p - u,
				message: f.message
			})), this.retryRequest(r, t, n ?? c);
			throw w(this).info(`[${c}] connection ${i ? "timed out" : "failed"} - error; no more retries left`), w(this).debug(`[${c}] connection ${i ? "timed out" : "failed"} (error; no more retries left)`, T({
				retryOfRequestLogID: n,
				url: o,
				durationMs: p - u,
				message: f.message
			})), i ? new ae() : new ie({ cause: f });
		}
		let ee = `[${c}${l}${[...f.headers.entries()].filter(([e]) => e === "request-id").map(([e, t]) => ", " + e + ": " + JSON.stringify(t)).join("")}] ${a.method} ${o} ${f.ok ? "succeeded" : "failed"} with status ${f.status} in ${p - u}ms`;
		if (!f.ok) {
			let e = await this.shouldRetry(f);
			if (t && e) {
				let e = `retrying, ${t} attempts remaining`;
				return await Ie(f.body), w(this).info(`${ee} - ${e}`), w(this).debug(`[${c}] response error (${e})`, T({
					retryOfRequestLogID: n,
					url: f.url,
					status: f.status,
					headers: f.headers,
					durationMs: p - u
				})), this.retryRequest(r, t, n ?? c, f.headers);
			}
			let i = e ? "error; no more retries left" : "error; not retryable";
			w(this).info(`${ee} - ${i}`);
			let a = await f.text().catch((e) => re(e).message), o = Se(a), s = o ? void 0 : a;
			throw w(this).debug(`[${c}] response error (${i})`, T({
				retryOfRequestLogID: n,
				url: f.url,
				status: f.status,
				headers: f.headers,
				message: s,
				durationMs: Date.now() - u
			})), this.makeStatusError(f.status, o, s, f.headers);
		}
		return w(this).info(ee), w(this).debug(`[${c}] response start`, T({
			retryOfRequestLogID: n,
			url: f.url,
			status: f.status,
			headers: f.headers,
			durationMs: p - u
		})), {
			response: f,
			options: r,
			controller: d,
			requestLogID: c,
			retryOfRequestLogID: n,
			startTime: u
		};
	}
	getAPIList(e, t, n) {
		return this.requestAPIList(t, n && "then" in n ? n.then((t) => ({
			method: "get",
			path: e,
			...t
		})) : {
			method: "get",
			path: e,
			...n
		});
	}
	requestAPIList(e, t) {
		let n = this.makeRequest(t, null, void 0);
		return new lt(this, n, e);
	}
	async fetchWithTimeout(e, t, n, r) {
		let { signal: i, method: a, ...o } = t || {}, s = this._makeAbort(r);
		i && i.addEventListener("abort", s, { once: !0 });
		let c = setTimeout(s, n), l = globalThis.ReadableStream && o.body instanceof globalThis.ReadableStream || typeof o.body == "object" && o.body !== null && Symbol.asyncIterator in o.body, u = {
			signal: r.signal,
			...l ? { duplex: "half" } : {},
			method: "GET",
			...o
		};
		a && (u.method = a.toUpperCase());
		try {
			return await this.fetch.call(void 0, e, u);
		} finally {
			clearTimeout(c);
		}
	}
	async shouldRetry(e) {
		let t = e.headers.get("x-should-retry");
		return t === "true" ? !0 : t === "false" ? !1 : e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
	}
	async retryRequest(e, t, n, r) {
		let i, a = r?.get("retry-after-ms");
		if (a) {
			let e = parseFloat(a);
			Number.isNaN(e) || (i = e);
		}
		let o = r?.get("retry-after");
		if (o && !i) {
			let e = parseFloat(o);
			i = Number.isNaN(e) ? Date.parse(o) - Date.now() : e * 1e3;
		}
		if (i === void 0) {
			let n = e.maxRetries ?? this.maxRetries;
			i = this.calculateDefaultRetryTimeoutMillis(t, n);
		}
		return await Ce(i), this.makeRequest(e, t - 1, n);
	}
	calculateDefaultRetryTimeoutMillis(e, t) {
		let n = t - e;
		return Math.min(.5 * 2 ** n, 8) * (1 - Math.random() * .25) * 1e3;
	}
	calculateNonstreamingTimeout(e, t) {
		let n = 6e5;
		if (36e5 * e / 128e3 > n || t != null && e > t) throw new _("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details");
		return n;
	}
	async buildRequest(e, { retryCount: t = 0 } = {}) {
		let n = { ...e }, { method: r, path: i, query: a, defaultBaseURL: o } = n, s = this.buildURL(i, a, o);
		"timeout" in n && xe("timeout", n.timeout), n.timeout = n.timeout ?? this.timeout;
		let { bodyHeaders: c, body: l } = this.buildBody({ options: n });
		return {
			req: {
				method: r,
				headers: await this.buildHeaders({
					options: e,
					method: r,
					bodyHeaders: c,
					retryCount: t
				}),
				...n.signal && { signal: n.signal },
				...globalThis.ReadableStream && l instanceof globalThis.ReadableStream && { duplex: "half" },
				...l && { body: l },
				...this.fetchOptions ?? {},
				...n.fetchOptions ?? {}
			},
			url: s,
			timeout: n.timeout
		};
	}
	async buildHeaders({ options: e, method: t, bodyHeaders: n, retryCount: r }) {
		let i = {};
		this.idempotencyHeader && t !== "get" && (e.idempotencyKey ||= this.defaultIdempotencyKey(), i[this.idempotencyHeader] = e.idempotencyKey);
		let a = A([
			i,
			{
				Accept: "application/json",
				"User-Agent": this.getUserAgent(),
				"X-Stainless-Retry-Count": String(r),
				...e.timeout ? { "X-Stainless-Timeout": String(Math.trunc(e.timeout / 1e3)) } : {},
				...je(),
				...this._options.dangerouslyAllowBrowser ? { "anthropic-dangerous-direct-browser-access": "true" } : void 0,
				"anthropic-version": "2023-06-01"
			},
			await this.authHeaders(e),
			this._options.defaultHeaders,
			n,
			e.headers
		]);
		return this.validateHeaders(a), a.values;
	}
	_makeAbort(e) {
		return () => e.abort();
	}
	buildBody({ options: { body: e, headers: t } }) {
		if (!e) return {
			bodyHeaders: void 0,
			body: void 0
		};
		let n = A([t]);
		return ArrayBuffer.isView(e) || e instanceof ArrayBuffer || e instanceof DataView || typeof e == "string" && n.values.has("content-type") || globalThis.Blob && e instanceof globalThis.Blob || e instanceof FormData || e instanceof URLSearchParams || globalThis.ReadableStream && e instanceof globalThis.ReadableStream ? {
			bodyHeaders: void 0,
			body: e
		} : typeof e == "object" && (Symbol.asyncIterator in e || Symbol.iterator in e && "next" in e && typeof e.next == "function") ? {
			bodyHeaders: void 0,
			body: Pe(e)
		} : typeof e == "object" && n.values.get("content-type") === "application/x-www-form-urlencoded" ? {
			bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
			body: this.stringifyQuery(e)
		} : g(this, wr, "f").call(this, {
			body: e,
			headers: n
		});
	}
};
Cr = Q, wr = /* @__PURE__ */ new WeakMap(), Sr = /* @__PURE__ */ new WeakSet(), Tr = function() {
	return this.baseURL !== "https://api.anthropic.com";
}, Q.Anthropic = Cr, Q.HUMAN_PROMPT = Er, Q.AI_PROMPT = Dr, Q.DEFAULT_TIMEOUT = 6e5, Q.AnthropicError = _, Q.APIError = v, Q.APIConnectionError = ie, Q.APIConnectionTimeoutError = ae, Q.APIUserAbortError = y, Q.NotFoundError = le, Q.ConflictError = ue, Q.RateLimitError = fe, Q.BadRequestError = oe, Q.AuthenticationError = se, Q.InternalServerError = pe, Q.PermissionDeniedError = ce, Q.UnprocessableEntityError = de, Q.toFile = Ct;
var $ = class extends Q {
	constructor() {
		super(...arguments), this.completions = new Un(this), this.messages = new _r(this), this.models = new br(this), this.beta = new K(this);
	}
};
$.Completions = Un, $.Messages = _r, $.Models = br, $.Beta = K;
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js
function Or(e, t) {
	return e || (n("PI_CACHE_RETENTION", t) === "long" ? "long" : "short");
}
function kr(e, t, n) {
	let r = Or(t, n);
	if (r === "none") return { retention: r };
	let i = r === "long" && Lr(e).supportsLongCacheRetention ? "1h" : void 0;
	return {
		retention: r,
		cacheControl: {
			type: "ephemeral",
			...i && { ttl: i }
		}
	};
}
var Ar = "2.1.75", jr = new Map([
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"KillShell",
	"NotebookEdit",
	"Skill",
	"Task",
	"TaskOutput",
	"TodoWrite",
	"WebFetch",
	"WebSearch"
].map((e) => [e.toLowerCase(), e])), Mr = (e) => jr.get(e.toLowerCase()) ?? e, Nr = (e, t) => {
	if (t && t.length > 0) {
		let n = e.toLowerCase(), r = t.find((e) => e.name.toLowerCase() === n);
		if (r) return r.name;
	}
	return e;
};
function Pr(e) {
	if (!e.some((e) => e.type === "image")) return u(e.map((e) => e.text).join("\n"));
	let t = e.map((e) => e.type === "text" ? {
		type: "text",
		text: u(e.text)
	} : {
		type: "image",
		source: {
			type: "base64",
			media_type: e.mimeType,
			data: e.data
		}
	});
	return t.some((e) => e.type === "text") || t.unshift({
		type: "text",
		text: "(see attached image)"
	}), t;
}
var Fr = "fine-grained-tool-streaming-2025-05-14", Ir = "interleaved-thinking-2025-05-14";
function Lr(e) {
	return {
		supportsEagerToolInputStreaming: e.compat?.supportsEagerToolInputStreaming ?? !0,
		supportsLongCacheRetention: e.compat?.supportsLongCacheRetention ?? !0,
		sendSessionAffinityHeaders: e.compat?.sendSessionAffinityHeaders ?? !1,
		supportsCacheControlOnTools: e.compat?.supportsCacheControlOnTools ?? !0,
		supportsTemperature: e.compat?.supportsTemperature ?? !0,
		allowEmptySignature: e.compat?.allowEmptySignature ?? !1,
		supportsStrictTools: e.compat?.supportsStrictTools ?? !1,
		supportsToolReferences: e.compat?.supportsToolReferences ?? Rr(e)
	};
}
function Rr(e) {
	if (e.provider !== "anthropic" || e.id.includes("haiku")) return !1;
	let t = e.id.match(/^claude-(?:opus|sonnet|fable)-(\d+)(?:-(\d+))?(?:-|$)/);
	if (!t) return !1;
	let n = Number(t[1]), r = t[2] && t[2].length < 8 ? Number(t[2]) : 0;
	return n > 4 || n === 4 && r >= 5;
}
function zr(...e) {
	let t = {};
	for (let n of e) n && Object.assign(t, n);
	return t;
}
function Br(e, t) {
	if (!e) return !1;
	let n = t.toLowerCase();
	for (let [t, r] of Object.entries(e)) if (t.toLowerCase() === n && r !== null && r.trim().length > 0) return !0;
	return !1;
}
function Vr(e, t, n) {
	if (!t && !(Br(n, "authorization") || Br(n, "x-api-key") || Br(n, "cf-aig-authorization"))) throw Error(`No API key for provider: ${e}`);
}
var Hr = /* @__PURE__ */ new Set([
	"message_start",
	"message_delta",
	"message_stop",
	"content_block_start",
	"content_block_delta",
	"content_block_stop"
]);
function Ur(e) {
	if (!e.event && e.data.length === 0) return null;
	let t = {
		event: e.event,
		data: e.data.join("\n"),
		raw: [...e.raw]
	};
	return e.event = null, e.data = [], e.raw = [], t;
}
function Wr(e, t) {
	if (e === "") return Ur(t);
	if (t.raw.push(e), e.startsWith(":")) return null;
	let n = e.indexOf(":"), r = n === -1 ? e : e.slice(0, n), i = n === -1 ? "" : e.slice(n + 1);
	return i.startsWith(" ") && (i = i.slice(1)), r === "event" ? t.event = i : r === "data" && t.data.push(i), null;
}
function Gr(e) {
	let t = e.indexOf("\r"), n = e.indexOf("\n");
	return t === -1 ? n : n === -1 ? t : Math.min(t, n);
}
function Kr(e) {
	let t = Gr(e);
	if (t === -1) return null;
	let n = t + 1;
	return e[t] === "\r" && e[n] === "\n" && (n += 1), {
		line: e.slice(0, t),
		rest: e.slice(n)
	};
}
async function* qr(e, t) {
	let n = e.getReader(), r = new TextDecoder(), i = {
		event: null,
		data: [],
		raw: []
	}, a = "";
	try {
		for (;;) {
			if (t?.aborted) throw Error("Request was aborted");
			let { value: e, done: o } = await n.read();
			if (o) break;
			a += r.decode(e, { stream: !0 });
			let s = Kr(a);
			for (; s;) {
				a = s.rest;
				let e = Wr(s.line, i);
				e && (yield e), s = Kr(a);
			}
		}
		a += r.decode();
		let e = Kr(a);
		for (; e;) {
			a = e.rest;
			let t = Wr(e.line, i);
			t && (yield t), e = Kr(a);
		}
		if (a.length > 0) {
			let e = Wr(a, i);
			e && (yield e);
		}
		let o = Ur(i);
		o && (yield o);
	} finally {
		n.releaseLock();
	}
}
async function* Jr(e, t) {
	if (!e.body) throw Error("Attempted to iterate over an Anthropic response with no body");
	let n = !1, r = !1;
	for await (let a of qr(e.body, t)) {
		if (a.event === "error") throw Error(a.data);
		if (Hr.has(a.event ?? "")) try {
			let e = i(a.data);
			e.type === "message_start" ? n = !0 : e.type === "message_stop" && (r = !0), yield e;
		} catch (e) {
			let t = e instanceof Error ? e.message : String(e);
			throw Error(`Could not parse Anthropic SSE event ${a.event}: ${t}; data=${a.data}; raw=${a.raw.join("\\n")}`);
		}
	}
	if (n && !r) throw Error("Anthropic stream ended before message_stop");
}
var Yr = (n, i, a) => {
	let c = new t();
	return (async () => {
		let t = {
			role: "assistant",
			content: [],
			api: n.api,
			provider: n.provider,
			model: n.id,
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
			let l, u;
			if (a?.client) l = a.client, u = !1;
			else {
				let e = a?.apiKey;
				Vr(n.provider, e, a?.headers);
				let t;
				if (n.provider === "github-copilot") {
					let e = ee(i.messages);
					t = m({
						messages: i.messages,
						hasImages: e
					});
				}
				let r = Or(a?.cacheRetention, a?.env) === "none" ? void 0 : a?.sessionId, o = $r(n, e, a?.interleavedThinking ?? !0, ii(n, i), a?.headers, a?.fetch, t, r);
				l = o.client, u = o.isOAuthToken;
			}
			let d = ei(n, i, u, a), f = await a?.onPayload?.(d, n);
			f !== void 0 && (d = f);
			let p = {
				...a?.signal ? { signal: a.signal } : {},
				...a?.timeoutMs === void 0 ? {} : { timeout: a.timeoutMs },
				maxRetries: 0
			}, h = await s(() => l.messages.create({
				...d,
				stream: !0
			}, p).asResponse(), {
				maxRetries: a?.maxRetries,
				maxRetryDelayMs: a?.maxRetryDelayMs,
				signal: a?.signal
			});
			await a?.onResponse?.({
				status: h.status,
				headers: o(h.headers)
			}, n), c.push({
				type: "start",
				partial: t
			});
			let g = t.content;
			for await (let o of Jr(h, a?.signal)) if (o.type === "message_start") t.responseId = o.message.id, t.usage.input = o.message.usage.input_tokens || 0, t.usage.output = o.message.usage.output_tokens || 0, t.usage.cacheRead = o.message.usage.cache_read_input_tokens || 0, t.usage.cacheWrite = o.message.usage.cache_creation_input_tokens || 0, t.usage.cacheWrite1h = o.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0, t.usage.totalTokens = t.usage.input + t.usage.output + t.usage.cacheRead + t.usage.cacheWrite, e(n, t.usage);
			else if (o.type === "content_block_start") {
				if (o.content_block.type === "text") {
					let e = {
						type: "text",
						text: o.content_block.text ?? "",
						index: o.index
					};
					t.content.push(e), c.push({
						type: "text_start",
						contentIndex: t.content.length - 1,
						partial: t
					});
				} else if (o.content_block.type === "thinking") {
					let e = {
						type: "thinking",
						thinking: o.content_block.thinking ?? "",
						thinkingSignature: o.content_block.signature ?? "",
						index: o.index
					};
					t.content.push(e), c.push({
						type: "thinking_start",
						contentIndex: t.content.length - 1,
						partial: t
					});
				} else if (o.content_block.type === "redacted_thinking") {
					let e = {
						type: "thinking",
						thinking: "[Reasoning redacted]",
						thinkingSignature: o.content_block.data,
						redacted: !0,
						index: o.index
					};
					t.content.push(e), c.push({
						type: "thinking_start",
						contentIndex: t.content.length - 1,
						partial: t
					});
				} else if (o.content_block.type === "tool_use") {
					let e = {
						type: "toolCall",
						id: o.content_block.id,
						name: u ? Nr(o.content_block.name, i.tools) : o.content_block.name,
						arguments: o.content_block.input ?? {},
						partialJson: "",
						index: o.index
					};
					t.content.push(e), c.push({
						type: "toolcall_start",
						contentIndex: t.content.length - 1,
						partial: t
					});
				}
			} else if (o.type === "content_block_delta") {
				if (o.delta.type === "text_delta") {
					let e = g.findIndex((e) => e.index === o.index), n = g[e];
					n && n.type === "text" && (n.text += o.delta.text, c.push({
						type: "text_delta",
						contentIndex: e,
						delta: o.delta.text,
						partial: t
					}));
				} else if (o.delta.type === "thinking_delta") {
					let e = g.findIndex((e) => e.index === o.index), n = g[e];
					n && n.type === "thinking" && (n.thinking += o.delta.thinking, c.push({
						type: "thinking_delta",
						contentIndex: e,
						delta: o.delta.thinking,
						partial: t
					}));
				} else if (o.delta.type === "input_json_delta") {
					let e = g.findIndex((e) => e.index === o.index), n = g[e];
					n && n.type === "toolCall" && (n.partialJson += o.delta.partial_json, n.arguments = r(n.partialJson), c.push({
						type: "toolcall_delta",
						contentIndex: e,
						delta: o.delta.partial_json,
						partial: t
					}));
				} else if (o.delta.type === "signature_delta") {
					let e = g[g.findIndex((e) => e.index === o.index)];
					e && e.type === "thinking" && (e.thinkingSignature = e.thinkingSignature || "", e.thinkingSignature += o.delta.signature);
				}
			} else if (o.type === "content_block_stop") {
				let e = g.findIndex((e) => e.index === o.index), n = g[e];
				n && (delete n.index, n.type === "text" ? c.push({
					type: "text_end",
					contentIndex: e,
					content: n.text,
					partial: t
				}) : n.type === "thinking" ? c.push({
					type: "thinking_end",
					contentIndex: e,
					content: n.thinking,
					partial: t
				}) : n.type === "toolCall" && (n.arguments = r(n.partialJson), delete n.partialJson, c.push({
					type: "toolcall_end",
					contentIndex: e,
					toolCall: n,
					partial: t
				})));
			} else if (o.type === "message_delta") {
				if (o.delta.stop_reason) {
					t.rawStopReason = o.delta.stop_reason;
					let e = oi(o.delta.stop_reason, o.delta.stop_details);
					t.stopReason = e.stopReason, e.errorMessage && (t.errorMessage = e.errorMessage);
				}
				if (o.usage) {
					o.usage.input_tokens != null && (t.usage.input = o.usage.input_tokens), o.usage.output_tokens != null && (t.usage.output = o.usage.output_tokens), o.usage.cache_read_input_tokens != null && (t.usage.cacheRead = o.usage.cache_read_input_tokens), o.usage.cache_creation_input_tokens != null && (t.usage.cacheWrite = o.usage.cache_creation_input_tokens);
					let e = o.usage.output_tokens_details?.thinking_tokens;
					e != null && (t.usage.reasoning = e);
				}
				t.usage.totalTokens = t.usage.input + t.usage.output + t.usage.cacheRead + t.usage.cacheWrite, e(n, t.usage);
			}
			if (a?.signal?.aborted) throw Error("Request was aborted");
			if (t.stopReason === "pending") throw Error("Anthropic stream ended without a stop reason");
			if (t.stopReason === "aborted" || t.stopReason === "error") throw Error(t.errorMessage || "An unknown error occurred");
			c.push({
				type: "done",
				reason: t.stopReason,
				message: t
			}), c.end();
		} catch (e) {
			for (let e of t.content) delete e.index, delete e.partialJson;
			t.stopReason = a?.signal?.aborted ? "aborted" : "error", t.errorMessage = e instanceof Error ? e.message : JSON.stringify(e), c.push({
				type: "error",
				reason: t.stopReason,
				error: t
			}), c.end();
		}
	})(), c;
};
function Xr(e, t) {
	let n = t ? e.thinkingLevelMap?.[t] : void 0;
	if (typeof n == "string") return n;
	switch (t) {
		case "minimal":
		case "low": return "low";
		case "medium": return "medium";
		case "high": return "high";
		default: return "high";
	}
}
var Zr = (e, t, n) => {
	Vr(e.provider, n?.apiKey, n?.headers);
	let r = d(e, t, n, n?.apiKey);
	if (!n?.reasoning) return Yr(e, t, {
		...r,
		thinkingEnabled: !1
	});
	if (e.compat?.forceAdaptiveThinking === !0) {
		let i = Xr(e, n.reasoning);
		return Yr(e, t, {
			...r,
			thinkingEnabled: !0,
			effort: i
		});
	}
	let i = f(r.maxTokens, e.maxTokens, n.reasoning, n.thinkingBudgets), a = c(e, t, i.maxTokens);
	return Yr(e, t, {
		...r,
		maxTokens: a,
		thinkingEnabled: !0,
		thinkingBudgetTokens: Math.min(i.thinkingBudget, Math.max(0, a - 1024))
	});
};
function Qr(e) {
	return e.includes("sk-ant-oat");
}
function $r(e, t, n, r, i, a, o, s) {
	let c = n && e.compat?.forceAdaptiveThinking !== !0, l = [];
	if (r && l.push(Fr), c && l.push(Ir), e.provider === "github-copilot") return {
		client: new $({
			apiKey: null,
			authToken: t ?? null,
			baseURL: e.baseUrl,
			dangerouslyAllowBrowser: !0,
			fetch: a,
			defaultHeaders: zr({
				accept: "application/json",
				"anthropic-dangerous-direct-browser-access": "true",
				...l.length > 0 ? { "anthropic-beta": l.join(",") } : {}
			}, e.headers, o, i)
		}),
		isOAuthToken: !1
	};
	if (t && Qr(t)) return {
		client: new $({
			apiKey: null,
			authToken: t,
			baseURL: e.baseUrl,
			dangerouslyAllowBrowser: !0,
			fetch: a,
			defaultHeaders: zr({
				accept: "application/json",
				"anthropic-dangerous-direct-browser-access": "true",
				"anthropic-beta": [
					"claude-code-20250219",
					"oauth-2025-04-20",
					...l
				].join(","),
				"user-agent": `claude-cli/${Ar}`,
				"x-app": "cli"
			}, e.headers, i)
		}),
		isOAuthToken: !0
	};
	let u = s && Lr(e).sendSessionAffinityHeaders ? { "x-session-affinity": s } : {}, d = zr({
		accept: "application/json",
		"anthropic-dangerous-direct-browser-access": "true",
		...l.length > 0 ? { "anthropic-beta": l.join(",") } : {}
	}, u, e.headers, i);
	return {
		client: new $({
			apiKey: t ?? null,
			authToken: null,
			baseURL: e.baseUrl,
			dangerouslyAllowBrowser: !0,
			fetch: a,
			defaultHeaders: d
		}),
		isOAuthToken: !1
	};
}
function ei(e, t, n, r) {
	let { cacheControl: i } = kr(e, r?.cacheRetention, r?.env), o = Lr(e), s = p(t.messages, e, ti), c = n ? Mr : (e) => e, l = a({
		...t,
		messages: s
	}, o.supportsToolReferences, c), d = l.immediate, f = [...l.deferred.values()];
	d.length === 0 && f.length > 0 && (d = f, f = []);
	let ee = new Set(f.map((e) => c(e.name))), m = {
		model: e.id,
		messages: ri(s, n, i, o.allowEmptySignature, ee, c),
		max_tokens: r?.maxTokens ?? e.maxTokens,
		stream: !0
	};
	if (n ? (m.system = [{
		type: "text",
		text: "You are Claude Code, Anthropic's official CLI for Claude.",
		...i ? { cache_control: i } : {}
	}], t.systemPrompt && m.system.push({
		type: "text",
		text: u(t.systemPrompt),
		...i ? { cache_control: i } : {}
	})) : t.systemPrompt && (m.system = [{
		type: "text",
		text: u(t.systemPrompt),
		...i ? { cache_control: i } : {}
	}]), r?.temperature !== void 0 && !r?.thinkingEnabled && o.supportsTemperature && (m.temperature = r.temperature), (d.length > 0 || f.length > 0) && (m.tools = [...ai(d, n, o.supportsEagerToolInputStreaming, o.supportsStrictTools, o.supportsCacheControlOnTools ? i : void 0), ...ai(f, n, o.supportsEagerToolInputStreaming, o.supportsStrictTools, void 0, !0)]), e.reasoning) {
		if (r?.thinkingEnabled) {
			let t = r.thinkingDisplay ?? "summarized";
			e.compat?.forceAdaptiveThinking === !0 ? (m.thinking = {
				type: "adaptive",
				display: t
			}, r.effort && (m.output_config = (r.effort, { effort: r.effort }))) : m.thinking = {
				type: "enabled",
				budget_tokens: r.thinkingBudgetTokens || 1024,
				display: t
			};
		} else r?.thinkingEnabled === !1 && e.thinkingLevelMap?.off !== null && (m.thinking = { type: "disabled" });
	}
	if (r?.metadata) {
		let e = r.metadata.user_id;
		typeof e == "string" && (m.metadata = { user_id: e });
	}
	return r?.toolChoice && (m.tool_choice = typeof r.toolChoice == "string" ? { type: r.toolChoice } : r.toolChoice), m;
}
function ti(e) {
	return e.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
function ni(e, t, n, r, i) {
	let a = [];
	for (let o of e.addedToolNames ?? []) {
		let e = i(o);
		!n.has(e) || r.has(e) || (r.add(e), a.push({
			type: "tool_reference",
			tool_name: t ? Mr(o) : o
		}));
	}
	let o = Pr(e.content);
	return {
		toolResult: {
			type: "tool_result",
			tool_use_id: e.toolCallId,
			content: a.length > 0 ? a : o,
			is_error: e.isError
		},
		siblingContent: a.length === 0 ? [] : typeof o == "string" ? [{
			type: "text",
			text: o
		}] : o
	};
}
function ri(e, t, n, r = !1, i = /* @__PURE__ */ new Set(), a = (e) => e) {
	let o = [], s = /* @__PURE__ */ new Set();
	for (let n = 0; n < e.length; n++) {
		let c = e[n];
		if (c.role === "user") {
			if (typeof c.content == "string") c.content.trim().length > 0 && o.push({
				role: "user",
				content: u(c.content)
			});
			else {
				let e = c.content.map((e) => e.type === "text" ? {
					type: "text",
					text: u(e.text)
				} : {
					type: "image",
					source: {
						type: "base64",
						media_type: e.mimeType,
						data: e.data
					}
				}).filter((e) => e.type !== "text" || e.text.trim().length > 0);
				if (e.length === 0) continue;
				o.push({
					role: "user",
					content: e
				});
			}
		} else if (c.role === "assistant") {
			let e = [];
			for (let n of c.content) if (n.type === "text") {
				if (n.text.trim().length === 0) continue;
				e.push({
					type: "text",
					text: u(n.text)
				});
			} else if (n.type === "thinking") {
				if (n.redacted) {
					e.push({
						type: "redacted_thinking",
						data: n.thinkingSignature
					});
					continue;
				}
				let t = n.thinkingSignature, i = !!t && t.trim().length > 0;
				if (n.thinking.trim().length === 0 && !i) continue;
				i ? e.push({
					type: "thinking",
					thinking: u(n.thinking),
					signature: t
				}) : e.push(r ? {
					type: "thinking",
					thinking: u(n.thinking),
					signature: ""
				} : {
					type: "text",
					text: u(n.thinking)
				});
			} else n.type === "toolCall" && e.push({
				type: "tool_use",
				id: n.id,
				name: t ? Mr(n.name) : n.name,
				input: n.arguments ?? {}
			});
			if (e.length === 0) continue;
			o.push({
				role: "assistant",
				content: e
			});
		} else if (c.role === "toolResult") {
			let r = [], c = [], l = n;
			for (; l < e.length && e[l].role === "toolResult";) {
				let n = ni(e[l], t, i, s, a);
				r.push(n.toolResult), c.push(...n.siblingContent), l++;
			}
			n = l - 1, o.push({
				role: "user",
				content: [...r, ...c]
			});
		}
	}
	if (n && o.length > 0) {
		let e = o[o.length - 1];
		if (e.role === "user") {
			if (Array.isArray(e.content)) {
				let t = e.content[e.content.length - 1];
				t && (t.type === "text" || t.type === "image" || t.type === "tool_result") && (t.cache_control = n);
			} else typeof e.content == "string" && (e.content = [{
				type: "text",
				text: e.content,
				cache_control: n
			}]);
		}
	}
	return o;
}
function ii(e, t) {
	return !!t.tools?.length && !Lr(e).supportsEagerToolInputStreaming;
}
function ai(e, t, n, r, i, a = !1) {
	return e ? e.map((o, s) => {
		let c = l(o, r), u = o.parameters, d = {
			type: "object",
			properties: u.properties ?? {},
			required: u.required ?? []
		}, f = c === !0 ? {
			...o.parameters,
			...d
		} : d;
		return {
			name: t ? Mr(o.name) : o.name,
			description: o.description,
			...n ? { eager_input_streaming: !0 } : {},
			...c === !0 ? { strict: !0 } : {},
			input_schema: f,
			...a ? { defer_loading: !0 } : {},
			...i && s === e.length - 1 ? { cache_control: i } : {}
		};
	}) : [];
}
function oi(e, t) {
	switch (e) {
		case "end_turn": return { stopReason: "stop" };
		case "max_tokens": return { stopReason: "length" };
		case "tool_use": return { stopReason: "toolUse" };
		case "refusal": return {
			stopReason: "error",
			errorMessage: t?.explanation || "The model refused to complete the request"
		};
		case "pause_turn": return { stopReason: "stop" };
		case "stop_sequence": return { stopReason: "stop" };
		case "sensitive": return {
			stopReason: "error",
			errorMessage: "Provider stopped with: sensitive"
		};
		default: throw Error(`Unhandled stop reason: ${e}`);
	}
}
//#endregion
export { Yr as stream, Zr as streamSimple };
