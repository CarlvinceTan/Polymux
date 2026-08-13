//#region node_modules/openai/internal/tslib.mjs
function e(e, t, n, r, i) {
	if (r === "m") throw TypeError("Private method is not writable");
	if (r === "a" && !i) throw TypeError("Private accessor was defined without a setter");
	if (typeof t == "function" ? e !== t || !i : !t.has(e)) throw TypeError("Cannot write private member to an object whose class did not declare it");
	return r === "a" ? i.call(e, n) : i ? i.value = n : t.set(e, n), n;
}
function t(e, t, n, r) {
	if (n === "a" && !r) throw TypeError("Private accessor was defined without a getter");
	if (typeof t == "function" ? e !== t || !r : !t.has(e)) throw TypeError("Cannot read private member from an object whose class did not declare it");
	return n === "m" ? r : n === "a" ? r.call(e) : r ? r.value : t.get(e);
}
//#endregion
//#region node_modules/openai/internal/utils/uuid.mjs
var n = function() {
	let { crypto: e } = globalThis;
	if (e?.randomUUID) return n = e.randomUUID.bind(e), e.randomUUID();
	let t = /* @__PURE__ */ new Uint8Array(1), r = e ? () => e.getRandomValues(t)[0] : () => Math.random() * 255 & 255;
	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (e) => (e ^ r() & 15 >> e / 4).toString(16));
};
//#endregion
//#region node_modules/openai/internal/errors.mjs
function r(e) {
	return typeof e == "object" && !!e && ("name" in e && e.name === "AbortError" || "message" in e && String(e.message).includes("FetchRequestCanceledException"));
}
var i = (e) => {
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
}, a = class extends Error {}, o = class e extends a {
	constructor(t, n, r, i) {
		super(`${e.makeMessage(t, n, r)}`), this.status = t, this.headers = i, this.requestID = i?.get("x-request-id"), this.error = n;
		let a = n;
		this.code = a?.code, this.param = a?.param, this.type = a?.type;
	}
	static makeMessage(e, t, n) {
		let r = t?.message ? typeof t.message == "string" ? t.message : JSON.stringify(t.message) : t ? JSON.stringify(t) : n;
		return e && r ? `${e} ${r}` : e ? `${e} status code (no body)` : r || "(no status code or body)";
	}
	static generate(t, n, r, a) {
		if (!t || !a) return new c({
			message: r,
			cause: i(n)
		});
		let o = n?.error;
		return t === 400 ? new u(t, o, r, a) : t === 401 ? new d(t, o, r, a) : t === 403 ? new f(t, o, r, a) : t === 404 ? new p(t, o, r, a) : t === 409 ? new m(t, o, r, a) : t === 422 ? new h(t, o, r, a) : t === 429 ? new g(t, o, r, a) : t >= 500 ? new _(t, o, r, a) : new e(t, o, r, a);
	}
}, s = class extends o {
	constructor({ message: e } = {}) {
		super(void 0, void 0, e || "Request was aborted.", void 0);
	}
}, c = class extends o {
	constructor({ message: e, cause: t }) {
		super(void 0, void 0, e || "Connection error.", void 0), t && (this.cause = t);
	}
}, l = class extends c {
	constructor({ message: e } = {}) {
		super({ message: e ?? "Request timed out." });
	}
}, u = class extends o {}, d = class extends o {}, f = class extends o {}, p = class extends o {}, m = class extends o {}, h = class extends o {}, g = class extends o {}, _ = class extends o {}, v = class extends a {
	constructor() {
		super("Could not parse response content as the length limit was reached");
	}
}, y = class extends a {
	constructor() {
		super("Could not parse response content as the request was rejected by the content filter");
	}
}, b = class extends Error {
	constructor(e) {
		super(e);
	}
}, ee = /^[a-z][a-z0-9+.-]*:/i, te = (e) => ee.test(e), x = (e) => (x = Array.isArray, x(e)), S = x;
function C(e) {
	return typeof e == "object" ? e ?? {} : {};
}
function ne(e) {
	if (!e) return !0;
	for (let t in e) return !1;
	return !0;
}
function re(e, t) {
	return Object.prototype.hasOwnProperty.call(e, t);
}
function ie(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var ae = (e, t) => {
	if (typeof t != "number" || !Number.isInteger(t)) throw new a(`${e} must be an integer`);
	if (t < 0) throw new a(`${e} must be a positive integer`);
	return t;
}, oe = (e) => {
	try {
		return JSON.parse(e);
	} catch {
		return;
	}
}, se = (e) => new Promise((t) => setTimeout(t, e)), w = "6.26.0", ce = () => typeof window < "u" && window.document !== void 0 && typeof navigator < "u";
function le() {
	return typeof Deno < "u" && Deno.build != null ? "deno" : typeof EdgeRuntime < "u" ? "edge" : Object.prototype.toString.call(globalThis.process === void 0 ? 0 : globalThis.process) === "[object process]" ? "node" : "unknown";
}
var ue = () => {
	let e = le();
	if (e === "deno") return {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": w,
		"X-Stainless-OS": pe(Deno.build.os),
		"X-Stainless-Arch": fe(Deno.build.arch),
		"X-Stainless-Runtime": "deno",
		"X-Stainless-Runtime-Version": typeof Deno.version == "string" ? Deno.version : Deno.version?.deno ?? "unknown"
	};
	if (typeof EdgeRuntime < "u") return {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": w,
		"X-Stainless-OS": "Unknown",
		"X-Stainless-Arch": `other:${EdgeRuntime}`,
		"X-Stainless-Runtime": "edge",
		"X-Stainless-Runtime-Version": globalThis.process.version
	};
	if (e === "node") return {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": w,
		"X-Stainless-OS": pe(globalThis.process.platform ?? "unknown"),
		"X-Stainless-Arch": fe(globalThis.process.arch ?? "unknown"),
		"X-Stainless-Runtime": "node",
		"X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
	};
	let t = de();
	return t ? {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": w,
		"X-Stainless-OS": "Unknown",
		"X-Stainless-Arch": "unknown",
		"X-Stainless-Runtime": `browser:${t.browser}`,
		"X-Stainless-Runtime-Version": t.version
	} : {
		"X-Stainless-Lang": "js",
		"X-Stainless-Package-Version": w,
		"X-Stainless-OS": "Unknown",
		"X-Stainless-Arch": "unknown",
		"X-Stainless-Runtime": "unknown",
		"X-Stainless-Runtime-Version": "unknown"
	};
};
function de() {
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
var fe = (e) => e === "x32" ? "x32" : e === "x86_64" || e === "x64" ? "x64" : e === "arm" ? "arm" : e === "aarch64" || e === "arm64" ? "arm64" : e ? `other:${e}` : "unknown", pe = (e) => (e = e.toLowerCase(), e.includes("ios") ? "iOS" : e === "android" ? "Android" : e === "darwin" ? "MacOS" : e === "win32" ? "Windows" : e === "freebsd" ? "FreeBSD" : e === "openbsd" ? "OpenBSD" : e === "linux" ? "Linux" : e ? `Other:${e}` : "Unknown"), me, he = () => me ??= ue();
//#endregion
//#region node_modules/openai/internal/shims.mjs
function ge() {
	if (typeof fetch < "u") return fetch;
	throw Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function _e(...e) {
	let t = globalThis.ReadableStream;
	if (t === void 0) throw Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
	return new t(...e);
}
function ve(e) {
	let t = Symbol.asyncIterator in e ? e[Symbol.asyncIterator]() : e[Symbol.iterator]();
	return _e({
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
function ye(e) {
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
async function be(e) {
	if (typeof e != "object" || !e) return;
	if (e[Symbol.asyncIterator]) {
		await e[Symbol.asyncIterator]().return?.();
		return;
	}
	let t = e.getReader(), n = t.cancel();
	t.releaseLock(), await n;
}
//#endregion
//#region node_modules/openai/internal/request-options.mjs
var xe = ({ headers: e, body: t }) => ({
	bodyHeaders: { "content-type": "application/json" },
	body: JSON.stringify(t)
}), Se = "RFC3986", Ce = (e) => String(e), we = {
	RFC1738: (e) => String(e).replace(/%20/g, "+"),
	RFC3986: Ce
}, Te = (e, t) => (Te = Object.hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty), Te(e, t)), T = /* @__PURE__ */ (() => {
	let e = [];
	for (let t = 0; t < 256; ++t) e.push("%" + ((t < 16 ? "0" : "") + t.toString(16)).toUpperCase());
	return e;
})(), Ee = 1024, De = (e, t, n, r, i) => {
	if (e.length === 0) return e;
	let a = e;
	if (typeof e == "symbol" ? a = Symbol.prototype.toString.call(e) : typeof e != "string" && (a = String(e)), n === "iso-8859-1") return escape(a).replace(/%u[0-9a-f]{4}/gi, function(e) {
		return "%26%23" + parseInt(e.slice(2), 16) + "%3B";
	});
	let o = "";
	for (let e = 0; e < a.length; e += Ee) {
		let t = a.length >= Ee ? a.slice(e, e + Ee) : a, n = [];
		for (let e = 0; e < t.length; ++e) {
			let r = t.charCodeAt(e);
			if (r === 45 || r === 46 || r === 95 || r === 126 || r >= 48 && r <= 57 || r >= 65 && r <= 90 || r >= 97 && r <= 122 || i === "RFC1738" && (r === 40 || r === 41)) {
				n[n.length] = t.charAt(e);
				continue;
			}
			if (r < 128) {
				n[n.length] = T[r];
				continue;
			}
			if (r < 2048) {
				n[n.length] = T[192 | r >> 6] + T[128 | r & 63];
				continue;
			}
			if (r < 55296 || r >= 57344) {
				n[n.length] = T[224 | r >> 12] + T[128 | r >> 6 & 63] + T[128 | r & 63];
				continue;
			}
			e += 1, r = 65536 + ((r & 1023) << 10 | t.charCodeAt(e) & 1023), n[n.length] = T[240 | r >> 18] + T[128 | r >> 12 & 63] + T[128 | r >> 6 & 63] + T[128 | r & 63];
		}
		o += n.join("");
	}
	return o;
};
function Oe(e) {
	return !e || typeof e != "object" ? !1 : !!(e.constructor && e.constructor.isBuffer && e.constructor.isBuffer(e));
}
function ke(e, t) {
	if (x(e)) {
		let n = [];
		for (let r = 0; r < e.length; r += 1) n.push(t(e[r]));
		return n;
	}
	return t(e);
}
//#endregion
//#region node_modules/openai/internal/qs/stringify.mjs
var Ae = {
	brackets(e) {
		return String(e) + "[]";
	},
	comma: "comma",
	indices(e, t) {
		return String(e) + "[" + t + "]";
	},
	repeat(e) {
		return String(e);
	}
}, je = function(e, t) {
	Array.prototype.push.apply(e, x(t) ? t : [t]);
}, Me, E = {
	addQueryPrefix: !1,
	allowDots: !1,
	allowEmptyArrays: !1,
	arrayFormat: "indices",
	charset: "utf-8",
	charsetSentinel: !1,
	delimiter: "&",
	encode: !0,
	encodeDotInKeys: !1,
	encoder: De,
	encodeValuesOnly: !1,
	format: Se,
	formatter: Ce,
	indices: !1,
	serializeDate(e) {
		return (Me ??= Function.prototype.call.bind(Date.prototype.toISOString))(e);
	},
	skipNulls: !1,
	strictNullHandling: !1
};
function Ne(e) {
	return typeof e == "string" || typeof e == "number" || typeof e == "boolean" || typeof e == "symbol" || typeof e == "bigint";
}
var Pe = {};
function Fe(e, t, n, r, i, a, o, s, c, l, u, d, f, p, m, h, g, _) {
	let v = e, y = _, b = 0, ee = !1;
	for (; (y = y.get(Pe)) !== void 0 && !ee;) {
		let t = y.get(e);
		if (b += 1, t !== void 0) {
			if (t === b) throw RangeError("Cyclic object value");
			ee = !0;
		}
		y.get(Pe) === void 0 && (b = 0);
	}
	if (typeof l == "function" ? v = l(t, v) : v instanceof Date ? v = f?.(v) : n === "comma" && x(v) && (v = ke(v, function(e) {
		return e instanceof Date ? f?.(e) : e;
	})), v === null) {
		if (a) return c && !h ? c(t, E.encoder, g, "key", p) : t;
		v = "";
	}
	if (Ne(v) || Oe(v)) {
		if (c) {
			let e = h ? t : c(t, E.encoder, g, "key", p);
			return [m?.(e) + "=" + m?.(c(v, E.encoder, g, "value", p))];
		}
		return [m?.(t) + "=" + m?.(String(v))];
	}
	let te = [];
	if (v === void 0) return te;
	let S;
	if (n === "comma" && x(v)) h && c && (v = ke(v, c)), S = [{ value: v.length > 0 ? v.join(",") || null : void 0 }];
	else if (x(l)) S = l;
	else {
		let e = Object.keys(v);
		S = u ? e.sort(u) : e;
	}
	let C = s ? String(t).replace(/\./g, "%2E") : String(t), ne = r && x(v) && v.length === 1 ? C + "[]" : C;
	if (i && x(v) && v.length === 0) return ne + "[]";
	for (let t = 0; t < S.length; ++t) {
		let y = S[t], ee = typeof y == "object" && y.value !== void 0 ? y.value : v[y];
		if (o && ee === null) continue;
		let C = d && s ? y.replace(/\./g, "%2E") : y, re = x(v) ? typeof n == "function" ? n(ne, C) : ne : ne + (d ? "." + C : "[" + C + "]");
		_.set(e, b);
		let ie = /* @__PURE__ */ new WeakMap();
		ie.set(Pe, _), je(te, Fe(ee, re, n, r, i, a, o, s, n === "comma" && h && x(v) ? null : c, l, u, d, f, p, m, h, g, ie));
	}
	return te;
}
function Ie(e = E) {
	if (e.allowEmptyArrays !== void 0 && typeof e.allowEmptyArrays != "boolean") throw TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
	if (e.encodeDotInKeys !== void 0 && typeof e.encodeDotInKeys != "boolean") throw TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");
	if (e.encoder !== null && e.encoder !== void 0 && typeof e.encoder != "function") throw TypeError("Encoder has to be a function.");
	let t = e.charset || E.charset;
	if (e.charset !== void 0 && e.charset !== "utf-8" && e.charset !== "iso-8859-1") throw TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
	let n = Se;
	if (e.format !== void 0) {
		if (!Te(we, e.format)) throw TypeError("Unknown format option provided.");
		n = e.format;
	}
	let r = we[n], i = E.filter;
	(typeof e.filter == "function" || x(e.filter)) && (i = e.filter);
	let a;
	if (a = e.arrayFormat && e.arrayFormat in Ae ? e.arrayFormat : "indices" in e ? e.indices ? "indices" : "repeat" : E.arrayFormat, "commaRoundTrip" in e && typeof e.commaRoundTrip != "boolean") throw TypeError("`commaRoundTrip` must be a boolean, or absent");
	let o = e.allowDots === void 0 ? e.encodeDotInKeys ? !0 : E.allowDots : !!e.allowDots;
	return {
		addQueryPrefix: typeof e.addQueryPrefix == "boolean" ? e.addQueryPrefix : E.addQueryPrefix,
		allowDots: o,
		allowEmptyArrays: typeof e.allowEmptyArrays == "boolean" ? !!e.allowEmptyArrays : E.allowEmptyArrays,
		arrayFormat: a,
		charset: t,
		charsetSentinel: typeof e.charsetSentinel == "boolean" ? e.charsetSentinel : E.charsetSentinel,
		commaRoundTrip: !!e.commaRoundTrip,
		delimiter: e.delimiter === void 0 ? E.delimiter : e.delimiter,
		encode: typeof e.encode == "boolean" ? e.encode : E.encode,
		encodeDotInKeys: typeof e.encodeDotInKeys == "boolean" ? e.encodeDotInKeys : E.encodeDotInKeys,
		encoder: typeof e.encoder == "function" ? e.encoder : E.encoder,
		encodeValuesOnly: typeof e.encodeValuesOnly == "boolean" ? e.encodeValuesOnly : E.encodeValuesOnly,
		filter: i,
		format: n,
		formatter: r,
		serializeDate: typeof e.serializeDate == "function" ? e.serializeDate : E.serializeDate,
		skipNulls: typeof e.skipNulls == "boolean" ? e.skipNulls : E.skipNulls,
		sort: typeof e.sort == "function" ? e.sort : null,
		strictNullHandling: typeof e.strictNullHandling == "boolean" ? e.strictNullHandling : E.strictNullHandling
	};
}
function Le(e, t = {}) {
	let n = e, r = Ie(t), i, a;
	typeof r.filter == "function" ? (a = r.filter, n = a("", n)) : x(r.filter) && (a = r.filter, i = a);
	let o = [];
	if (typeof n != "object" || !n) return "";
	let s = Ae[r.arrayFormat], c = s === "comma" && r.commaRoundTrip;
	i ||= Object.keys(n), r.sort && i.sort(r.sort);
	let l = /* @__PURE__ */ new WeakMap();
	for (let e = 0; e < i.length; ++e) {
		let t = i[e];
		r.skipNulls && n[t] === null || je(o, Fe(n[t], t, s, c, r.allowEmptyArrays, r.strictNullHandling, r.skipNulls, r.encodeDotInKeys, r.encode ? r.encoder : null, r.filter, r.sort, r.allowDots, r.serializeDate, r.format, r.formatter, r.encodeValuesOnly, r.charset, l));
	}
	let u = o.join(r.delimiter), d = r.addQueryPrefix === !0 ? "?" : "";
	return r.charsetSentinel && (r.charset === "iso-8859-1" ? d += "utf8=%26%2310003%3B&" : d += "utf8=%E2%9C%93&"), u.length > 0 ? d + u : "";
}
//#endregion
//#region node_modules/openai/internal/utils/query.mjs
function Re(e) {
	return Le(e, { arrayFormat: "brackets" });
}
//#endregion
//#region node_modules/openai/internal/utils/bytes.mjs
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
//#region node_modules/openai/internal/decoders/line.mjs
var D, O, We = class {
	constructor() {
		D.set(this, void 0), O.set(this, void 0), e(this, D, /* @__PURE__ */ new Uint8Array(), "f"), e(this, O, null, "f");
	}
	decode(n) {
		if (n == null) return [];
		let r = n instanceof ArrayBuffer ? new Uint8Array(n) : typeof n == "string" ? Ve(n) : n;
		e(this, D, ze([t(this, D, "f"), r]), "f");
		let i = [], a;
		for (; (a = Ge(t(this, D, "f"), t(this, O, "f"))) != null;) {
			if (a.carriage && t(this, O, "f") == null) {
				e(this, O, a.index, "f");
				continue;
			}
			if (t(this, O, "f") != null && (a.index !== t(this, O, "f") + 1 || a.carriage)) {
				i.push(Ue(t(this, D, "f").subarray(0, t(this, O, "f") - 1))), e(this, D, t(this, D, "f").subarray(t(this, O, "f")), "f"), e(this, O, null, "f");
				continue;
			}
			let n = t(this, O, "f") === null ? a.preceding : a.preceding - 1, r = Ue(t(this, D, "f").subarray(0, n));
			i.push(r), e(this, D, t(this, D, "f").subarray(a.index), "f"), e(this, O, null, "f");
		}
		return i;
	}
	flush() {
		return t(this, D, "f").length ? this.decode("\n") : [];
	}
};
D = /* @__PURE__ */ new WeakMap(), O = /* @__PURE__ */ new WeakMap(), We.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]), We.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
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
//#region node_modules/openai/internal/utils/log.mjs
var qe = {
	off: 0,
	error: 200,
	warn: 300,
	info: 400,
	debug: 500
}, Je = (e, t, n) => {
	if (e) {
		if (re(qe, e)) return e;
		k(n).warn(`${t} was set to ${JSON.stringify(e)}, expected one of ${JSON.stringify(Object.keys(qe))}`);
	}
};
function Ye() {}
function Xe(e, t, n) {
	return !t || qe[e] > qe[n] ? Ye : t[e].bind(t);
}
var Ze = {
	error: Ye,
	warn: Ye,
	info: Ye,
	debug: Ye
}, Qe = /* @__PURE__ */ new WeakMap();
function k(e) {
	let t = e.logger, n = e.logLevel ?? "off";
	if (!t) return Ze;
	let r = Qe.get(t);
	if (r && r[0] === n) return r[1];
	let i = {
		error: Xe("error", t, n),
		warn: Xe("warn", t, n),
		info: Xe("info", t, n),
		debug: Xe("debug", t, n)
	};
	return Qe.set(t, [n, i]), i;
}
var A = (e) => (e.options && (e.options = { ...e.options }, delete e.options.headers), e.headers &&= Object.fromEntries((e.headers instanceof Headers ? [...e.headers] : Object.entries(e.headers)).map(([e, t]) => [e, e.toLowerCase() === "authorization" || e.toLowerCase() === "cookie" || e.toLowerCase() === "set-cookie" ? "***" : t])), "retryOfRequestLogID" in e && (e.retryOfRequestLogID && (e.retryOf = e.retryOfRequestLogID), delete e.retryOfRequestLogID), e), $e, et = class n {
	constructor(t, n, r) {
		this.iterator = t, $e.set(this, void 0), this.controller = n, e(this, $e, r, "f");
	}
	static fromSSEResponse(e, t, i, s) {
		let c = !1, l = i ? k(i) : console;
		async function* u() {
			if (c) throw new a("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
			c = !0;
			let n = !1;
			try {
				for await (let r of tt(e, t)) if (!n) {
					if (r.data.startsWith("[DONE]")) {
						n = !0;
						continue;
					}
					if (r.event === null || !r.event.startsWith("thread.")) {
						let t;
						try {
							t = JSON.parse(r.data);
						} catch (e) {
							throw l.error("Could not parse message into JSON:", r.data), l.error("From chunk:", r.raw), e;
						}
						if (t && t.error) throw new o(void 0, t.error, void 0, e.headers);
						yield s ? {
							event: r.event,
							data: t
						} : t;
					} else {
						let e;
						try {
							e = JSON.parse(r.data);
						} catch (e) {
							throw console.error("Could not parse message into JSON:", r.data), console.error("From chunk:", r.raw), e;
						}
						if (r.event == "error") throw new o(void 0, e.error, e.message, void 0);
						yield {
							event: r.event,
							data: e
						};
					}
				}
				n = !0;
			} catch (e) {
				if (r(e)) return;
				throw e;
			} finally {
				n || t.abort();
			}
		}
		return new n(u, t, i);
	}
	static fromReadableStream(e, t, i) {
		let o = !1;
		async function* s() {
			let t = new We(), n = ye(e);
			for await (let e of n) for (let n of t.decode(e)) yield n;
			for (let e of t.flush()) yield e;
		}
		async function* c() {
			if (o) throw new a("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
			o = !0;
			let e = !1;
			try {
				for await (let t of s()) e || t && (yield JSON.parse(t));
				e = !0;
			} catch (e) {
				if (r(e)) return;
				throw e;
			} finally {
				e || t.abort();
			}
		}
		return new n(c, t, i);
	}
	[($e = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
		return this.iterator();
	}
	tee() {
		let e = [], r = [], i = this.iterator(), a = (t) => ({ next: () => {
			if (t.length === 0) {
				let t = i.next();
				e.push(t), r.push(t);
			}
			return t.shift();
		} });
		return [new n(() => a(e), this.controller, t(this, $e, "f")), new n(() => a(r), this.controller, t(this, $e, "f"))];
	}
	toReadableStream() {
		let e = this, t;
		return _e({
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
async function* tt(e, t) {
	if (!e.body) throw t.abort(), globalThis.navigator !== void 0 && globalThis.navigator.product === "ReactNative" ? new a("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new a("Attempted to iterate over a response with no body");
	let n = new rt(), r = new We(), i = ye(e.body);
	for await (let e of nt(i)) for (let t of r.decode(e)) {
		let e = n.decode(t);
		e && (yield e);
	}
	for (let e of r.flush()) {
		let t = n.decode(e);
		t && (yield t);
	}
}
async function* nt(e) {
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
var rt = class {
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
		let [t, n, r] = it(e, ":");
		return r.startsWith(" ") && (r = r.substring(1)), t === "event" ? this.event = r : t === "data" && this.data.push(r), null;
	}
};
function it(e, t) {
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
//#region node_modules/openai/internal/parse.mjs
async function at(e, t) {
	let { response: n, requestLogID: r, retryOfRequestLogID: i, startTime: a } = t, o = await (async () => {
		if (t.options.stream) return k(e).debug("response", n.status, n.url, n.headers, n.body), t.options.__streamClass ? t.options.__streamClass.fromSSEResponse(n, t.controller, e, t.options.__synthesizeEventData) : et.fromSSEResponse(n, t.controller, e, t.options.__synthesizeEventData);
		if (n.status === 204) return null;
		if (t.options.__binaryResponse) return n;
		let r = n.headers.get("content-type")?.split(";")[0]?.trim();
		return r?.includes("application/json") || r?.endsWith("+json") ? n.headers.get("content-length") === "0" ? void 0 : ot(await n.json(), n) : await n.text();
	})();
	return k(e).debug(`[${r}] response parsed`, A({
		retryOfRequestLogID: i,
		url: n.url,
		status: n.status,
		body: o,
		durationMs: Date.now() - a
	})), o;
}
function ot(e, t) {
	return !e || typeof e != "object" || Array.isArray(e) ? e : Object.defineProperty(e, "_request_id", {
		value: t.headers.get("x-request-id"),
		enumerable: !1
	});
}
//#endregion
//#region node_modules/openai/core/api-promise.mjs
var st, ct = class n extends Promise {
	constructor(t, n, r = at) {
		super((e) => {
			e(null);
		}), this.responsePromise = n, this.parseResponse = r, st.set(this, void 0), e(this, st, t, "f");
	}
	_thenUnwrap(e) {
		return new n(t(this, st, "f"), this.responsePromise, async (t, n) => ot(e(await this.parseResponse(t, n), n), n.response));
	}
	asResponse() {
		return this.responsePromise.then((e) => e.response);
	}
	async withResponse() {
		let [e, t] = await Promise.all([this.parse(), this.asResponse()]);
		return {
			data: e,
			response: t,
			request_id: t.headers.get("x-request-id")
		};
	}
	parse() {
		return this.parsedPromise ||= this.responsePromise.then((e) => this.parseResponse(t(this, st, "f"), e)), this.parsedPromise;
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
st = /* @__PURE__ */ new WeakMap();
//#endregion
//#region node_modules/openai/core/pagination.mjs
var lt, ut = class {
	constructor(t, n, r, i) {
		lt.set(this, void 0), e(this, lt, t, "f"), this.options = i, this.response = n, this.body = r;
	}
	hasNextPage() {
		return this.getPaginatedItems().length ? this.nextPageRequestOptions() != null : !1;
	}
	async getNextPage() {
		let e = this.nextPageRequestOptions();
		if (!e) throw new a("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
		return await t(this, lt, "f").requestAPIList(this.constructor, e);
	}
	async *iterPages() {
		let e = this;
		for (yield e; e.hasNextPage();) e = await e.getNextPage(), yield e;
	}
	async *[(lt = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
		for await (let e of this.iterPages()) for (let t of e.getPaginatedItems()) yield t;
	}
}, dt = class extends ct {
	constructor(e, t, n) {
		super(e, t, async (e, t) => new n(e, t.response, await at(e, t), t.options));
	}
	async *[Symbol.asyncIterator]() {
		let e = await this;
		for await (let t of e) yield t;
	}
}, ft = class extends ut {
	constructor(e, t, n, r) {
		super(e, t, n, r), this.data = n.data || [], this.object = n.object;
	}
	getPaginatedItems() {
		return this.data ?? [];
	}
	nextPageRequestOptions() {
		return null;
	}
}, j = class extends ut {
	constructor(e, t, n, r) {
		super(e, t, n, r), this.data = n.data || [], this.has_more = n.has_more || !1;
	}
	getPaginatedItems() {
		return this.data ?? [];
	}
	hasNextPage() {
		return this.has_more !== !1 && super.hasNextPage();
	}
	nextPageRequestOptions() {
		let e = this.getPaginatedItems(), t = e[e.length - 1]?.id;
		return t ? {
			...this.options,
			query: {
				...C(this.options.query),
				after: t
			}
		} : null;
	}
}, pt = class extends ut {
	constructor(e, t, n, r) {
		super(e, t, n, r), this.data = n.data || [], this.has_more = n.has_more || !1, this.last_id = n.last_id || "";
	}
	getPaginatedItems() {
		return this.data ?? [];
	}
	hasNextPage() {
		return this.has_more !== !1 && super.hasNextPage();
	}
	nextPageRequestOptions() {
		let e = this.last_id;
		return e ? {
			...this.options,
			query: {
				...C(this.options.query),
				after: e
			}
		} : null;
	}
}, mt = () => {
	if (typeof File > "u") {
		let { process: e } = globalThis, t = typeof e?.versions?.node == "string" && parseInt(e.versions.node.split(".")) < 20;
		throw Error("`File` is not defined as a global, which is required for file uploads." + (t ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
	}
};
function ht(e, t, n) {
	return mt(), new File(e, t ?? "unknown_file", n);
}
function gt(e) {
	return (typeof e == "object" && !!e && ("name" in e && e.name && String(e.name) || "url" in e && e.url && String(e.url) || "filename" in e && e.filename && String(e.filename) || "path" in e && e.path && String(e.path)) || "").split(/[\\/]/).pop() || void 0;
}
var _t = (e) => typeof e == "object" && !!e && typeof e[Symbol.asyncIterator] == "function", vt = async (e, t) => wt(e.body) ? {
	...e,
	body: await xt(e.body, t)
} : e, M = async (e, t) => ({
	...e,
	body: await xt(e.body, t)
}), yt = /* @__PURE__ */ new WeakMap();
function bt(e) {
	let t = typeof e == "function" ? e : e.fetch, n = yt.get(t);
	if (n) return n;
	let r = (async () => {
		try {
			let e = "Response" in t ? t.Response : (await t("data:,")).constructor, n = new FormData();
			return n.toString() !== await new e(n).text();
		} catch {
			return !0;
		}
	})();
	return yt.set(t, r), r;
}
var xt = async (e, t) => {
	if (!await bt(t)) throw TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
	let n = new FormData();
	return await Promise.all(Object.entries(e || {}).map(([e, t]) => Tt(n, e, t))), n;
}, St = (e) => e instanceof Blob && "name" in e, Ct = (e) => typeof e == "object" && !!e && (e instanceof Response || _t(e) || St(e)), wt = (e) => {
	if (Ct(e)) return !0;
	if (Array.isArray(e)) return e.some(wt);
	if (e && typeof e == "object") {
		for (let t in e) if (wt(e[t])) return !0;
	}
	return !1;
}, Tt = async (e, t, n) => {
	if (n !== void 0) {
		if (n == null) throw TypeError(`Received null for "${t}"; to pass null in FormData, you must use the string 'null'`);
		if (typeof n == "string" || typeof n == "number" || typeof n == "boolean") e.append(t, String(n));
		else if (n instanceof Response) e.append(t, ht([await n.blob()], gt(n)));
		else if (_t(n)) e.append(t, ht([await new Response(ve(n)).blob()], gt(n)));
		else if (St(n)) e.append(t, n, gt(n));
		else if (Array.isArray(n)) await Promise.all(n.map((n) => Tt(e, t + "[]", n)));
		else if (typeof n == "object") await Promise.all(Object.entries(n).map(([n, r]) => Tt(e, `${t}[${n}]`, r)));
		else throw TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${n} instead`);
	}
}, Et = (e) => typeof e == "object" && !!e && typeof e.size == "number" && typeof e.type == "string" && typeof e.text == "function" && typeof e.slice == "function" && typeof e.arrayBuffer == "function", Dt = (e) => typeof e == "object" && !!e && typeof e.name == "string" && typeof e.lastModified == "number" && Et(e), Ot = (e) => typeof e == "object" && !!e && typeof e.url == "string" && typeof e.blob == "function";
async function kt(e, t, n) {
	if (mt(), e = await e, Dt(e)) return e instanceof File ? e : ht([await e.arrayBuffer()], e.name);
	if (Ot(e)) {
		let r = await e.blob();
		return t ||= new URL(e.url).pathname.split(/[\\/]/).pop(), ht(await At(r), t, n);
	}
	let r = await At(e);
	if (t ||= gt(e), !n?.type) {
		let e = r.find((e) => typeof e == "object" && "type" in e && e.type);
		typeof e == "string" && (n = {
			...n,
			type: e
		});
	}
	return ht(r, t, n);
}
async function At(e) {
	let t = [];
	if (typeof e == "string" || ArrayBuffer.isView(e) || e instanceof ArrayBuffer) t.push(e);
	else if (Et(e)) t.push(e instanceof Blob ? e : await e.arrayBuffer());
	else if (_t(e)) for await (let n of e) t.push(...await At(n));
	else {
		let t = e?.constructor?.name;
		throw Error(`Unexpected data type: ${typeof e}${t ? `; constructor: ${t}` : ""}${jt(e)}`);
	}
	return t;
}
function jt(e) {
	return typeof e != "object" || !e ? "" : `; props: [${Object.getOwnPropertyNames(e).map((e) => `"${e}"`).join(", ")}]`;
}
//#endregion
//#region node_modules/openai/core/resource.mjs
var N = class {
	constructor(e) {
		this._client = e;
	}
};
//#endregion
//#region node_modules/openai/internal/utils/path.mjs
function Mt(e) {
	return e.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var Nt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null)), P = /* @__PURE__ */ ((e = Mt) => function(t, ...n) {
	if (t.length === 1) return t[0];
	let r = !1, i = [], o = t.reduce((t, a, o) => {
		/[?#]/.test(a) && (r = !0);
		let s = n[o], c = (r ? encodeURIComponent : e)("" + s);
		return o !== n.length && (s == null || typeof s == "object" && s.toString === Object.getPrototypeOf(Object.getPrototypeOf(s.hasOwnProperty ?? Nt) ?? Nt)?.toString) && (c = s + "", i.push({
			start: t.length + a.length,
			length: c.length,
			error: `Value of type ${Object.prototype.toString.call(s).slice(8, -1)} is not a valid path parameter`
		})), t + a + (o === n.length ? "" : c);
	}, ""), s = o.split(/[?#]/, 1)[0], c = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi, l;
	for (; (l = c.exec(s)) !== null;) i.push({
		start: l.index,
		length: l[0].length,
		error: `Value "${l[0]}" can\'t be safely passed as a path parameter`
	});
	if (i.sort((e, t) => e.start - t.start), i.length > 0) {
		let e = 0, t = i.reduce((t, n) => {
			let r = " ".repeat(n.start - e), i = "^".repeat(n.length);
			return e = n.start + n.length, t + r + i;
		}, "");
		throw new a(`Path parameters result in path with invalid segments:\n${i.map((e) => e.error).join("\n")}\n${o}\n${t}`);
	}
	return o;
})(Mt), Pt = class extends N {
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/chat/completions/${e}/messages`, j, {
			query: t,
			...n
		});
	}
};
//#endregion
//#region node_modules/openai/lib/parser.mjs
function Ft(e) {
	return e !== void 0 && "function" in e && e.function !== void 0;
}
function It(e) {
	return e?.$brand === "auto-parseable-response-format";
}
function Lt(e) {
	return e?.$brand === "auto-parseable-tool";
}
function Rt(e, t) {
	return !t || !Ut(t) ? {
		...e,
		choices: e.choices.map((e) => (Wt(e.message.tool_calls), {
			...e,
			message: {
				...e.message,
				parsed: null,
				...e.message.tool_calls ? { tool_calls: e.message.tool_calls } : void 0
			}
		}))
	} : zt(e, t);
}
function zt(e, t) {
	let n = e.choices.map((e) => {
		if (e.finish_reason === "length") throw new v();
		if (e.finish_reason === "content_filter") throw new y();
		return Wt(e.message.tool_calls), {
			...e,
			message: {
				...e.message,
				...e.message.tool_calls ? { tool_calls: e.message.tool_calls?.map((e) => Vt(t, e)) ?? void 0 } : void 0,
				parsed: e.message.content && !e.message.refusal ? Bt(t, e.message.content) : null
			}
		};
	});
	return {
		...e,
		choices: n
	};
}
function Bt(e, t) {
	return e.response_format?.type === "json_schema" && e.response_format?.type === "json_schema" ? "$parseRaw" in e.response_format ? e.response_format.$parseRaw(t) : JSON.parse(t) : null;
}
function Vt(e, t) {
	let n = e.tools?.find((e) => Ft(e) && e.function?.name === t.function.name);
	return {
		...t,
		function: {
			...t.function,
			parsed_arguments: Lt(n) ? n.$parseRaw(t.function.arguments) : n?.function.strict ? JSON.parse(t.function.arguments) : null
		}
	};
}
function Ht(e, t) {
	if (!e || !("tools" in e) || !e.tools) return !1;
	let n = e.tools?.find((e) => Ft(e) && e.function?.name === t.function.name);
	return Ft(n) && (Lt(n) || n?.function.strict || !1);
}
function Ut(e) {
	return It(e.response_format) ? !0 : e.tools?.some((e) => Lt(e) || e.type === "function" && e.function.strict === !0) ?? !1;
}
function Wt(e) {
	for (let t of e || []) if (t.type !== "function") throw new a(`Currently only \`function\` tool calls are supported; Received \`${t.type}\``);
}
function Gt(e) {
	for (let t of e ?? []) {
		if (t.type !== "function") throw new a(`Currently only \`function\` tool types support auto-parsing; Received \`${t.type}\``);
		if (t.function.strict !== !0) throw new a(`The \`${t.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
	}
}
//#endregion
//#region node_modules/openai/lib/chatCompletionUtils.mjs
var Kt = (e) => e?.role === "assistant", qt = (e) => e?.role === "tool", Jt, Yt, Xt, Zt, Qt, $t, en, F, tn, nn, rn, an, on, sn = class {
	constructor() {
		Jt.add(this), this.controller = new AbortController(), Yt.set(this, void 0), Xt.set(this, () => {}), Zt.set(this, () => {}), Qt.set(this, void 0), $t.set(this, () => {}), en.set(this, () => {}), F.set(this, {}), tn.set(this, !1), nn.set(this, !1), rn.set(this, !1), an.set(this, !1), e(this, Yt, new Promise((t, n) => {
			e(this, Xt, t, "f"), e(this, Zt, n, "f");
		}), "f"), e(this, Qt, new Promise((t, n) => {
			e(this, $t, t, "f"), e(this, en, n, "f");
		}), "f"), t(this, Yt, "f").catch(() => {}), t(this, Qt, "f").catch(() => {});
	}
	_run(e) {
		setTimeout(() => {
			e().then(() => {
				this._emitFinal(), this._emit("end");
			}, t(this, Jt, "m", on).bind(this));
		}, 0);
	}
	_connected() {
		this.ended || (t(this, Xt, "f").call(this), this._emit("connect"));
	}
	get ended() {
		return t(this, tn, "f");
	}
	get errored() {
		return t(this, nn, "f");
	}
	get aborted() {
		return t(this, rn, "f");
	}
	abort() {
		this.controller.abort();
	}
	on(e, n) {
		return (t(this, F, "f")[e] || (t(this, F, "f")[e] = [])).push({ listener: n }), this;
	}
	off(e, n) {
		let r = t(this, F, "f")[e];
		if (!r) return this;
		let i = r.findIndex((e) => e.listener === n);
		return i >= 0 && r.splice(i, 1), this;
	}
	once(e, n) {
		return (t(this, F, "f")[e] || (t(this, F, "f")[e] = [])).push({
			listener: n,
			once: !0
		}), this;
	}
	emitted(t) {
		return new Promise((n, r) => {
			e(this, an, !0, "f"), t !== "error" && this.once("error", r), this.once(t, n);
		});
	}
	async done() {
		e(this, an, !0, "f"), await t(this, Qt, "f");
	}
	_emit(n, ...r) {
		if (t(this, tn, "f")) return;
		n === "end" && (e(this, tn, !0, "f"), t(this, $t, "f").call(this));
		let i = t(this, F, "f")[n];
		if (i && (t(this, F, "f")[n] = i.filter((e) => !e.once), i.forEach(({ listener: e }) => e(...r))), n === "abort") {
			let e = r[0];
			!t(this, an, "f") && !i?.length && Promise.reject(e), t(this, Zt, "f").call(this, e), t(this, en, "f").call(this, e), this._emit("end");
			return;
		}
		if (n === "error") {
			let e = r[0];
			!t(this, an, "f") && !i?.length && Promise.reject(e), t(this, Zt, "f").call(this, e), t(this, en, "f").call(this, e), this._emit("end");
		}
	}
	_emitFinal() {}
};
Yt = /* @__PURE__ */ new WeakMap(), Xt = /* @__PURE__ */ new WeakMap(), Zt = /* @__PURE__ */ new WeakMap(), Qt = /* @__PURE__ */ new WeakMap(), $t = /* @__PURE__ */ new WeakMap(), en = /* @__PURE__ */ new WeakMap(), F = /* @__PURE__ */ new WeakMap(), tn = /* @__PURE__ */ new WeakMap(), nn = /* @__PURE__ */ new WeakMap(), rn = /* @__PURE__ */ new WeakMap(), an = /* @__PURE__ */ new WeakMap(), Jt = /* @__PURE__ */ new WeakSet(), on = function(t) {
	if (e(this, nn, !0, "f"), t instanceof Error && t.name === "AbortError" && (t = new s()), t instanceof s) return e(this, rn, !0, "f"), this._emit("abort", t);
	if (t instanceof a) return this._emit("error", t);
	if (t instanceof Error) {
		let e = new a(t.message);
		return e.cause = t, this._emit("error", e);
	}
	return this._emit("error", new a(String(t)));
};
//#endregion
//#region node_modules/openai/lib/RunnableFunction.mjs
function cn(e) {
	return typeof e.parse == "function";
}
//#endregion
//#region node_modules/openai/lib/AbstractChatCompletionRunner.mjs
var I, ln, un, dn, fn, pn, mn, hn, gn = 10, _n = class extends sn {
	constructor() {
		super(...arguments), I.add(this), this._chatCompletions = [], this.messages = [];
	}
	_addChatCompletion(e) {
		this._chatCompletions.push(e), this._emit("chatCompletion", e);
		let t = e.choices[0]?.message;
		return t && this._addMessage(t), e;
	}
	_addMessage(e, t = !0) {
		if ("content" in e || (e.content = null), this.messages.push(e), t) {
			if (this._emit("message", e), qt(e) && e.content) this._emit("functionToolCallResult", e.content);
			else if (Kt(e) && e.tool_calls) for (let t of e.tool_calls) t.type === "function" && this._emit("functionToolCall", t.function);
		}
	}
	async finalChatCompletion() {
		await this.done();
		let e = this._chatCompletions[this._chatCompletions.length - 1];
		if (!e) throw new a("stream ended without producing a ChatCompletion");
		return e;
	}
	async finalContent() {
		return await this.done(), t(this, I, "m", ln).call(this);
	}
	async finalMessage() {
		return await this.done(), t(this, I, "m", un).call(this);
	}
	async finalFunctionToolCall() {
		return await this.done(), t(this, I, "m", dn).call(this);
	}
	async finalFunctionToolCallResult() {
		return await this.done(), t(this, I, "m", fn).call(this);
	}
	async totalUsage() {
		return await this.done(), t(this, I, "m", pn).call(this);
	}
	allChatCompletions() {
		return [...this._chatCompletions];
	}
	_emitFinal() {
		let e = this._chatCompletions[this._chatCompletions.length - 1];
		e && this._emit("finalChatCompletion", e);
		let n = t(this, I, "m", un).call(this);
		n && this._emit("finalMessage", n);
		let r = t(this, I, "m", ln).call(this);
		r && this._emit("finalContent", r);
		let i = t(this, I, "m", dn).call(this);
		i && this._emit("finalFunctionToolCall", i);
		let a = t(this, I, "m", fn).call(this);
		a != null && this._emit("finalFunctionToolCallResult", a), this._chatCompletions.some((e) => e.usage) && this._emit("totalUsage", t(this, I, "m", pn).call(this));
	}
	async _createChatCompletion(e, n, r) {
		let i = r?.signal;
		i && (i.aborted && this.controller.abort(), i.addEventListener("abort", () => this.controller.abort())), t(this, I, "m", mn).call(this, n);
		let a = await e.chat.completions.create({
			...n,
			stream: !1
		}, {
			...r,
			signal: this.controller.signal
		});
		return this._connected(), this._addChatCompletion(zt(a, n));
	}
	async _runChatCompletion(e, t, n) {
		for (let e of t.messages) this._addMessage(e, !1);
		return await this._createChatCompletion(e, t, n);
	}
	async _runTools(e, n, r) {
		let i = "tool", { tool_choice: o = "auto", stream: s, ...c } = n, l = typeof o != "string" && o.type === "function" && o?.function?.name, { maxChatCompletions: u = gn } = r || {}, d = n.tools.map((e) => {
			if (Lt(e)) {
				if (!e.$callback) throw new a("Tool given to `.runTools()` that does not have an associated function");
				return {
					type: "function",
					function: {
						function: e.$callback,
						name: e.function.name,
						description: e.function.description || "",
						parameters: e.function.parameters,
						parse: e.$parseRaw,
						strict: !0
					}
				};
			}
			return e;
		}), f = {};
		for (let e of d) e.type === "function" && (f[e.function.name || e.function.function.name] = e.function);
		let p = "tools" in n ? d.map((e) => e.type === "function" ? {
			type: "function",
			function: {
				name: e.function.name || e.function.function.name,
				parameters: e.function.parameters,
				description: e.function.description,
				strict: e.function.strict
			}
		} : e) : void 0;
		for (let e of n.messages) this._addMessage(e, !1);
		for (let n = 0; n < u; ++n) {
			let n = (await this._createChatCompletion(e, {
				...c,
				tool_choice: o,
				tools: p,
				messages: [...this.messages]
			}, r)).choices[0]?.message;
			if (!n) throw new a("missing message in ChatCompletion response");
			if (!n.tool_calls?.length) return;
			for (let e of n.tool_calls) {
				if (e.type !== "function") continue;
				let n = e.id, { name: r, arguments: a } = e.function, o = f[r];
				if (!o) {
					let e = `Invalid tool_call: ${JSON.stringify(r)}. Available options are: ${Object.keys(f).map((e) => JSON.stringify(e)).join(", ")}. Please try again`;
					this._addMessage({
						role: i,
						tool_call_id: n,
						content: e
					});
					continue;
				}
				if (l && l !== r) {
					let e = `Invalid tool_call: ${JSON.stringify(r)}. ${JSON.stringify(l)} requested. Please try again`;
					this._addMessage({
						role: i,
						tool_call_id: n,
						content: e
					});
					continue;
				}
				let s;
				try {
					s = cn(o) ? await o.parse(a) : a;
				} catch (e) {
					let t = e instanceof Error ? e.message : String(e);
					this._addMessage({
						role: i,
						tool_call_id: n,
						content: t
					});
					continue;
				}
				let c = await o.function(s, this), u = t(this, I, "m", hn).call(this, c);
				if (this._addMessage({
					role: i,
					tool_call_id: n,
					content: u
				}), l) return;
			}
		}
	}
};
I = /* @__PURE__ */ new WeakSet(), ln = function() {
	return t(this, I, "m", un).call(this).content ?? null;
}, un = function() {
	let e = this.messages.length;
	for (; e-- > 0;) {
		let t = this.messages[e];
		if (Kt(t)) return {
			...t,
			content: t.content ?? null,
			refusal: t.refusal ?? null
		};
	}
	throw new a("stream ended without producing a ChatCompletionMessage with role=assistant");
}, dn = function() {
	for (let e = this.messages.length - 1; e >= 0; e--) {
		let t = this.messages[e];
		if (Kt(t) && t?.tool_calls?.length) return t.tool_calls.filter((e) => e.type === "function").at(-1)?.function;
	}
}, fn = function() {
	for (let e = this.messages.length - 1; e >= 0; e--) {
		let t = this.messages[e];
		if (qt(t) && t.content != null && typeof t.content == "string" && this.messages.some((e) => e.role === "assistant" && e.tool_calls?.some((e) => e.type === "function" && e.id === t.tool_call_id))) return t.content;
	}
}, pn = function() {
	let e = {
		completion_tokens: 0,
		prompt_tokens: 0,
		total_tokens: 0
	};
	for (let { usage: t } of this._chatCompletions) t && (e.completion_tokens += t.completion_tokens, e.prompt_tokens += t.prompt_tokens, e.total_tokens += t.total_tokens);
	return e;
}, mn = function(e) {
	if (e.n != null && e.n > 1) throw new a("ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.");
}, hn = function(e) {
	return typeof e == "string" ? e : e === void 0 ? "undefined" : JSON.stringify(e);
};
//#endregion
//#region node_modules/openai/lib/ChatCompletionRunner.mjs
var vn = class e extends _n {
	static runTools(t, n, r) {
		let i = new e(), a = {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "runTools"
			}
		};
		return i._run(() => i._runTools(t, n, a)), i;
	}
	_addMessage(e, t = !0) {
		super._addMessage(e, t), Kt(e) && e.content && this._emit("content", e.content);
	}
}, L = {
	STR: 1,
	NUM: 2,
	ARR: 4,
	OBJ: 8,
	NULL: 16,
	BOOL: 32,
	NAN: 64,
	INFINITY: 128,
	MINUS_INFINITY: 256,
	INF: 384,
	SPECIAL: 496,
	ATOM: 499,
	COLLECTION: 12,
	ALL: 511
}, yn = class extends Error {}, bn = class extends Error {};
function xn(e, t = L.ALL) {
	if (typeof e != "string") throw TypeError(`expecting str, got ${typeof e}`);
	if (!e.trim()) throw Error(`${e} is empty`);
	return Sn(e.trim(), t);
}
var Sn = (e, t) => {
	let n = e.length, r = 0, i = (e) => {
		throw new yn(`${e} at position ${r}`);
	}, a = (e) => {
		throw new bn(`${e} at position ${r}`);
	}, o = () => (d(), r >= n && i("Unexpected end of input"), e[r] === "\"" ? s() : e[r] === "{" ? c() : e[r] === "[" ? l() : e.substring(r, r + 4) === "null" || L.NULL & t && n - r < 4 && "null".startsWith(e.substring(r)) ? (r += 4, null) : e.substring(r, r + 4) === "true" || L.BOOL & t && n - r < 4 && "true".startsWith(e.substring(r)) ? (r += 4, !0) : e.substring(r, r + 5) === "false" || L.BOOL & t && n - r < 5 && "false".startsWith(e.substring(r)) ? (r += 5, !1) : e.substring(r, r + 8) === "Infinity" || L.INFINITY & t && n - r < 8 && "Infinity".startsWith(e.substring(r)) ? (r += 8, Infinity) : e.substring(r, r + 9) === "-Infinity" || L.MINUS_INFINITY & t && 1 < n - r && n - r < 9 && "-Infinity".startsWith(e.substring(r)) ? (r += 9, -Infinity) : e.substring(r, r + 3) === "NaN" || L.NAN & t && n - r < 3 && "NaN".startsWith(e.substring(r)) ? (r += 3, NaN) : u()), s = () => {
		let o = r, s = !1;
		for (r++; r < n && (e[r] !== "\"" || s && e[r - 1] === "\\");) s = e[r] === "\\" && !s, r++;
		if (e.charAt(r) == "\"") try {
			return JSON.parse(e.substring(o, ++r - Number(s)));
		} catch (e) {
			a(String(e));
		}
		else if (L.STR & t) try {
			return JSON.parse(e.substring(o, r - Number(s)) + "\"");
		} catch {
			return JSON.parse(e.substring(o, e.lastIndexOf("\\")) + "\"");
		}
		i("Unterminated string literal");
	}, c = () => {
		r++, d();
		let a = {};
		try {
			for (; e[r] !== "}";) {
				if (d(), r >= n && L.OBJ & t) return a;
				let i = s();
				d(), r++;
				try {
					let e = o();
					Object.defineProperty(a, i, {
						value: e,
						writable: !0,
						enumerable: !0,
						configurable: !0
					});
				} catch (e) {
					if (L.OBJ & t) return a;
					throw e;
				}
				d(), e[r] === "," && r++;
			}
		} catch {
			if (L.OBJ & t) return a;
			i("Expected '}' at end of object");
		}
		return r++, a;
	}, l = () => {
		r++;
		let n = [];
		try {
			for (; e[r] !== "]";) n.push(o()), d(), e[r] === "," && r++;
		} catch {
			if (L.ARR & t) return n;
			i("Expected ']' at end of array");
		}
		return r++, n;
	}, u = () => {
		if (r === 0) {
			e === "-" && L.NUM & t && i("Not sure what '-' is");
			try {
				return JSON.parse(e);
			} catch (n) {
				if (L.NUM & t) try {
					return e[e.length - 1] === "." ? JSON.parse(e.substring(0, e.lastIndexOf("."))) : JSON.parse(e.substring(0, e.lastIndexOf("e")));
				} catch {}
				a(String(n));
			}
		}
		let o = r;
		for (e[r] === "-" && r++; e[r] && !",]}".includes(e[r]);) r++;
		r == n && !(L.NUM & t) && i("Unterminated number literal");
		try {
			return JSON.parse(e.substring(o, r));
		} catch {
			e.substring(o, r) === "-" && L.NUM & t && i("Not sure what '-' is");
			try {
				return JSON.parse(e.substring(o, e.lastIndexOf("e")));
			} catch (e) {
				a(String(e));
			}
		}
	}, d = () => {
		for (; r < n && " \n\r	".includes(e[r]);) r++;
	};
	return o();
}, Cn = (e) => xn(e, L.ALL ^ L.NUM), R, z, B, V, wn, Tn, En, Dn, On, kn, An, jn, Mn = class n extends _n {
	constructor(t) {
		super(), R.add(this), z.set(this, void 0), B.set(this, void 0), V.set(this, void 0), e(this, z, t, "f"), e(this, B, [], "f");
	}
	get currentChatCompletionSnapshot() {
		return t(this, V, "f");
	}
	static fromReadableStream(e) {
		let t = new n(null);
		return t._run(() => t._fromReadableStream(e)), t;
	}
	static createChatCompletion(e, t, r) {
		let i = new n(t);
		return i._run(() => i._runChatCompletion(e, {
			...t,
			stream: !0
		}, {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), i;
	}
	async _createChatCompletion(e, n, r) {
		super._createChatCompletion;
		let i = r?.signal;
		i && (i.aborted && this.controller.abort(), i.addEventListener("abort", () => this.controller.abort())), t(this, R, "m", wn).call(this);
		let a = await e.chat.completions.create({
			...n,
			stream: !0
		}, {
			...r,
			signal: this.controller.signal
		});
		this._connected();
		for await (let e of a) t(this, R, "m", En).call(this, e);
		if (a.controller.signal?.aborted) throw new s();
		return this._addChatCompletion(t(this, R, "m", kn).call(this));
	}
	async _fromReadableStream(e, n) {
		let r = n?.signal;
		r && (r.aborted && this.controller.abort(), r.addEventListener("abort", () => this.controller.abort())), t(this, R, "m", wn).call(this), this._connected();
		let i = et.fromReadableStream(e, this.controller), a;
		for await (let e of i) a && a !== e.id && this._addChatCompletion(t(this, R, "m", kn).call(this)), t(this, R, "m", En).call(this, e), a = e.id;
		if (i.controller.signal?.aborted) throw new s();
		return this._addChatCompletion(t(this, R, "m", kn).call(this));
	}
	[(z = /* @__PURE__ */ new WeakMap(), B = /* @__PURE__ */ new WeakMap(), V = /* @__PURE__ */ new WeakMap(), R = /* @__PURE__ */ new WeakSet(), wn = function() {
		this.ended || e(this, V, void 0, "f");
	}, Tn = function(e) {
		let n = t(this, B, "f")[e.index];
		return n || (n = {
			content_done: !1,
			refusal_done: !1,
			logprobs_content_done: !1,
			logprobs_refusal_done: !1,
			done_tool_calls: /* @__PURE__ */ new Set(),
			current_tool_call_index: null
		}, t(this, B, "f")[e.index] = n, n);
	}, En = function(e) {
		if (this.ended) return;
		let n = t(this, R, "m", jn).call(this, e);
		this._emit("chunk", e, n);
		for (let r of e.choices) {
			let e = n.choices[r.index];
			r.delta.content != null && e.message?.role === "assistant" && e.message?.content && (this._emit("content", r.delta.content, e.message.content), this._emit("content.delta", {
				delta: r.delta.content,
				snapshot: e.message.content,
				parsed: e.message.parsed
			})), r.delta.refusal != null && e.message?.role === "assistant" && e.message?.refusal && this._emit("refusal.delta", {
				delta: r.delta.refusal,
				snapshot: e.message.refusal
			}), r.logprobs?.content != null && e.message?.role === "assistant" && this._emit("logprobs.content.delta", {
				content: r.logprobs?.content,
				snapshot: e.logprobs?.content ?? []
			}), r.logprobs?.refusal != null && e.message?.role === "assistant" && this._emit("logprobs.refusal.delta", {
				refusal: r.logprobs?.refusal,
				snapshot: e.logprobs?.refusal ?? []
			});
			let i = t(this, R, "m", Tn).call(this, e);
			e.finish_reason && (t(this, R, "m", On).call(this, e), i.current_tool_call_index != null && t(this, R, "m", Dn).call(this, e, i.current_tool_call_index));
			for (let n of r.delta.tool_calls ?? []) i.current_tool_call_index !== n.index && (t(this, R, "m", On).call(this, e), i.current_tool_call_index != null && t(this, R, "m", Dn).call(this, e, i.current_tool_call_index)), i.current_tool_call_index = n.index;
			for (let t of r.delta.tool_calls ?? []) {
				let n = e.message.tool_calls?.[t.index];
				n?.type && (n?.type === "function" ? this._emit("tool_calls.function.arguments.delta", {
					name: n.function?.name,
					index: t.index,
					arguments: n.function.arguments,
					parsed_arguments: n.function.parsed_arguments,
					arguments_delta: t.function?.arguments ?? ""
				}) : n?.type);
			}
		}
	}, Dn = function(e, n) {
		if (t(this, R, "m", Tn).call(this, e).done_tool_calls.has(n)) return;
		let r = e.message.tool_calls?.[n];
		if (!r) throw Error("no tool call snapshot");
		if (!r.type) throw Error("tool call snapshot missing `type`");
		if (r.type === "function") {
			let e = t(this, z, "f")?.tools?.find((e) => Ft(e) && e.function.name === r.function.name);
			this._emit("tool_calls.function.arguments.done", {
				name: r.function.name,
				index: n,
				arguments: r.function.arguments,
				parsed_arguments: Lt(e) ? e.$parseRaw(r.function.arguments) : e?.function.strict ? JSON.parse(r.function.arguments) : null
			});
		} else r.type;
	}, On = function(e) {
		let n = t(this, R, "m", Tn).call(this, e);
		if (e.message.content && !n.content_done) {
			n.content_done = !0;
			let r = t(this, R, "m", An).call(this);
			this._emit("content.done", {
				content: e.message.content,
				parsed: r ? r.$parseRaw(e.message.content) : null
			});
		}
		e.message.refusal && !n.refusal_done && (n.refusal_done = !0, this._emit("refusal.done", { refusal: e.message.refusal })), e.logprobs?.content && !n.logprobs_content_done && (n.logprobs_content_done = !0, this._emit("logprobs.content.done", { content: e.logprobs.content })), e.logprobs?.refusal && !n.logprobs_refusal_done && (n.logprobs_refusal_done = !0, this._emit("logprobs.refusal.done", { refusal: e.logprobs.refusal }));
	}, kn = function() {
		if (this.ended) throw new a("stream has ended, this shouldn't happen");
		let n = t(this, V, "f");
		if (!n) throw new a("request ended without sending any chunks");
		return e(this, V, void 0, "f"), e(this, B, [], "f"), Nn(n, t(this, z, "f"));
	}, An = function() {
		let e = t(this, z, "f")?.response_format;
		return It(e) ? e : null;
	}, jn = function(n) {
		var r, i, a, o;
		let s = t(this, V, "f"), { choices: c, ...l } = n;
		s ? Object.assign(s, l) : s = e(this, V, {
			...l,
			choices: []
		}, "f");
		for (let { delta: e, finish_reason: c, index: l, logprobs: u = null, ...d } of n.choices) {
			let n = s.choices[l];
			if (n ||= s.choices[l] = {
				finish_reason: c,
				index: l,
				message: {},
				logprobs: u,
				...d
			}, u) {
				if (!n.logprobs) n.logprobs = Object.assign({}, u);
				else {
					let { content: e, refusal: t, ...a } = u;
					Object.assign(n.logprobs, a), e && ((r = n.logprobs).content ?? (r.content = []), n.logprobs.content.push(...e)), t && ((i = n.logprobs).refusal ?? (i.refusal = []), n.logprobs.refusal.push(...t));
				}
			}
			if (c && (n.finish_reason = c, t(this, z, "f") && Ut(t(this, z, "f")))) {
				if (c === "length") throw new v();
				if (c === "content_filter") throw new y();
			}
			if (Object.assign(n, d), !e) continue;
			let { content: f, refusal: p, function_call: m, role: h, tool_calls: g, ..._ } = e;
			if (Object.assign(n.message, _), p && (n.message.refusal = (n.message.refusal || "") + p), h && (n.message.role = h), m && (n.message.function_call ? (m.name && (n.message.function_call.name = m.name), m.arguments && ((a = n.message.function_call).arguments ?? (a.arguments = ""), n.message.function_call.arguments += m.arguments)) : n.message.function_call = m), f && (n.message.content = (n.message.content || "") + f, !n.message.refusal && t(this, R, "m", An).call(this) && (n.message.parsed = Cn(n.message.content))), g) {
				n.message.tool_calls || (n.message.tool_calls = []);
				for (let { index: e, id: r, type: i, function: a, ...s } of g) {
					let c = (o = n.message.tool_calls)[e] ?? (o[e] = {});
					Object.assign(c, s), r && (c.id = r), i && (c.type = i), a && (c.function ??= {
						name: a.name ?? "",
						arguments: ""
					}), a?.name && (c.function.name = a.name), a?.arguments && (c.function.arguments += a.arguments, Ht(t(this, z, "f"), c) && (c.function.parsed_arguments = Cn(c.function.arguments)));
				}
			}
		}
		return s;
	}, Symbol.asyncIterator)]() {
		let e = [], t = [], n = !1;
		return this.on("chunk", (n) => {
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
		return new et(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
	}
};
function Nn(e, t) {
	let { id: n, choices: r, created: i, model: o, system_fingerprint: s, ...c } = e;
	return Rt({
		...c,
		id: n,
		choices: r.map(({ message: t, finish_reason: n, index: r, logprobs: i, ...o }) => {
			if (!n) throw new a(`missing finish_reason for choice ${r}`);
			let { content: s = null, function_call: c, tool_calls: l, ...u } = t, d = t.role;
			if (!d) throw new a(`missing role for choice ${r}`);
			if (c) {
				let { arguments: e, name: l } = c;
				if (e == null) throw new a(`missing function_call.arguments for choice ${r}`);
				if (!l) throw new a(`missing function_call.name for choice ${r}`);
				return {
					...o,
					message: {
						content: s,
						function_call: {
							arguments: e,
							name: l
						},
						role: d,
						refusal: t.refusal ?? null
					},
					finish_reason: n,
					index: r,
					logprobs: i
				};
			}
			return l ? {
				...o,
				index: r,
				finish_reason: n,
				logprobs: i,
				message: {
					...u,
					role: d,
					content: s,
					refusal: t.refusal ?? null,
					tool_calls: l.map((t, n) => {
						let { function: i, type: o, id: s, ...c } = t, { arguments: l, name: u, ...d } = i || {};
						if (s == null) throw new a(`missing choices[${r}].tool_calls[${n}].id\n${Pn(e)}`);
						if (o == null) throw new a(`missing choices[${r}].tool_calls[${n}].type\n${Pn(e)}`);
						if (u == null) throw new a(`missing choices[${r}].tool_calls[${n}].function.name\n${Pn(e)}`);
						if (l == null) throw new a(`missing choices[${r}].tool_calls[${n}].function.arguments\n${Pn(e)}`);
						return {
							...c,
							id: s,
							type: o,
							function: {
								...d,
								name: u,
								arguments: l
							}
						};
					})
				}
			} : {
				...o,
				message: {
					...u,
					content: s,
					role: d,
					refusal: t.refusal ?? null
				},
				finish_reason: n,
				index: r,
				logprobs: i
			};
		}),
		created: i,
		model: o,
		object: "chat.completion",
		...s ? { system_fingerprint: s } : {}
	}, t);
}
function Pn(e) {
	return JSON.stringify(e);
}
//#endregion
//#region node_modules/openai/lib/ChatCompletionStreamingRunner.mjs
var Fn = class e extends Mn {
	static fromReadableStream(t) {
		let n = new e(null);
		return n._run(() => n._fromReadableStream(t)), n;
	}
	static runTools(t, n, r) {
		let i = new e(n), a = {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "runTools"
			}
		};
		return i._run(() => i._runTools(t, n, a)), i;
	}
}, In = class extends N {
	constructor() {
		super(...arguments), this.messages = new Pt(this._client);
	}
	create(e, t) {
		return this._client.post("/chat/completions", {
			body: e,
			...t,
			stream: e.stream ?? !1
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/chat/completions/${e}`, t);
	}
	update(e, t, n) {
		return this._client.post(P`/chat/completions/${e}`, {
			body: t,
			...n
		});
	}
	list(e = {}, t) {
		return this._client.getAPIList("/chat/completions", j, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(P`/chat/completions/${e}`, t);
	}
	parse(e, t) {
		return Gt(e.tools), this._client.chat.completions.create(e, {
			...t,
			headers: {
				...t?.headers,
				"X-Stainless-Helper-Method": "chat.completions.parse"
			}
		})._thenUnwrap((t) => zt(t, e));
	}
	runTools(e, t) {
		return e.stream ? Fn.runTools(this._client, e, t) : vn.runTools(this._client, e, t);
	}
	stream(e, t) {
		return Mn.createChatCompletion(this._client, e, t);
	}
};
In.Messages = Pt;
//#endregion
//#region node_modules/openai/resources/chat/chat.mjs
var Ln = class extends N {
	constructor() {
		super(...arguments), this.completions = new In(this._client);
	}
};
Ln.Completions = In;
//#endregion
//#region node_modules/openai/internal/headers.mjs
var Rn = /* @__PURE__ */ Symbol("brand.privateNullableHeaders");
function* zn(e) {
	if (!e) return;
	if (Rn in e) {
		let { values: t, nulls: n } = e;
		yield* t.entries();
		for (let e of n) yield [e, null];
		return;
	}
	let t = !1, n;
	e instanceof Headers ? n = e.entries() : S(e) ? n = e : (t = !0, n = Object.entries(e ?? {}));
	for (let e of n) {
		let n = e[0];
		if (typeof n != "string") throw TypeError("expected header name to be a string");
		let r = S(e[1]) ? e[1] : [e[1]], i = !1;
		for (let e of r) e !== void 0 && (t && !i && (i = !0, yield [n, null]), yield [n, e]);
	}
}
var H = (e) => {
	let t = new Headers(), n = /* @__PURE__ */ new Set();
	for (let r of e) {
		let e = /* @__PURE__ */ new Set();
		for (let [i, a] of zn(r)) {
			let r = i.toLowerCase();
			e.has(r) || (t.delete(i), e.add(r)), a === null ? (t.delete(i), n.add(r)) : (t.append(i, a), n.delete(r));
		}
	}
	return {
		[Rn]: !0,
		values: t,
		nulls: n
	};
}, Bn = class extends N {
	create(e, t) {
		return this._client.post("/audio/speech", {
			body: e,
			...t,
			headers: H([{ Accept: "application/octet-stream" }, t?.headers]),
			__binaryResponse: !0
		});
	}
}, Vn = class extends N {
	create(e, t) {
		return this._client.post("/audio/transcriptions", M({
			body: e,
			...t,
			stream: e.stream ?? !1,
			__metadata: { model: e.model }
		}, this._client));
	}
}, Hn = class extends N {
	create(e, t) {
		return this._client.post("/audio/translations", M({
			body: e,
			...t,
			__metadata: { model: e.model }
		}, this._client));
	}
}, Un = class extends N {
	constructor() {
		super(...arguments), this.transcriptions = new Vn(this._client), this.translations = new Hn(this._client), this.speech = new Bn(this._client);
	}
};
Un.Transcriptions = Vn, Un.Translations = Hn, Un.Speech = Bn;
//#endregion
//#region node_modules/openai/resources/batches.mjs
var Wn = class extends N {
	create(e, t) {
		return this._client.post("/batches", {
			body: e,
			...t
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/batches/${e}`, t);
	}
	list(e = {}, t) {
		return this._client.getAPIList("/batches", j, {
			query: e,
			...t
		});
	}
	cancel(e, t) {
		return this._client.post(P`/batches/${e}/cancel`, t);
	}
}, Gn = class extends N {
	create(e, t) {
		return this._client.post("/assistants", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/assistants/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	update(e, t, n) {
		return this._client.post(P`/assistants/${e}`, {
			body: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	list(e = {}, t) {
		return this._client.getAPIList("/assistants", j, {
			query: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	delete(e, t) {
		return this._client.delete(P`/assistants/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
}, Kn = class extends N {
	create(e, t) {
		return this._client.post("/realtime/sessions", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
}, qn = class extends N {
	create(e, t) {
		return this._client.post("/realtime/transcription_sessions", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
}, Jn = class extends N {
	constructor() {
		super(...arguments), this.sessions = new Kn(this._client), this.transcriptionSessions = new qn(this._client);
	}
};
Jn.Sessions = Kn, Jn.TranscriptionSessions = qn;
//#endregion
//#region node_modules/openai/resources/beta/chatkit/sessions.mjs
var Yn = class extends N {
	create(e, t) {
		return this._client.post("/chatkit/sessions", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "chatkit_beta=v1" }, t?.headers])
		});
	}
	cancel(e, t) {
		return this._client.post(P`/chatkit/sessions/${e}/cancel`, {
			...t,
			headers: H([{ "OpenAI-Beta": "chatkit_beta=v1" }, t?.headers])
		});
	}
}, Xn = class extends N {
	retrieve(e, t) {
		return this._client.get(P`/chatkit/threads/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "chatkit_beta=v1" }, t?.headers])
		});
	}
	list(e = {}, t) {
		return this._client.getAPIList("/chatkit/threads", pt, {
			query: e,
			...t,
			headers: H([{ "OpenAI-Beta": "chatkit_beta=v1" }, t?.headers])
		});
	}
	delete(e, t) {
		return this._client.delete(P`/chatkit/threads/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "chatkit_beta=v1" }, t?.headers])
		});
	}
	listItems(e, t = {}, n) {
		return this._client.getAPIList(P`/chatkit/threads/${e}/items`, pt, {
			query: t,
			...n,
			headers: H([{ "OpenAI-Beta": "chatkit_beta=v1" }, n?.headers])
		});
	}
}, Zn = class extends N {
	constructor() {
		super(...arguments), this.sessions = new Yn(this._client), this.threads = new Xn(this._client);
	}
};
Zn.Sessions = Yn, Zn.Threads = Xn;
//#endregion
//#region node_modules/openai/resources/beta/threads/messages.mjs
var Qn = class extends N {
	create(e, t, n) {
		return this._client.post(P`/threads/${e}/messages`, {
			body: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	retrieve(e, t, n) {
		let { thread_id: r } = t;
		return this._client.get(P`/threads/${r}/messages/${e}`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	update(e, t, n) {
		let { thread_id: r, ...i } = t;
		return this._client.post(P`/threads/${r}/messages/${e}`, {
			body: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/threads/${e}/messages`, j, {
			query: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	delete(e, t, n) {
		let { thread_id: r } = t;
		return this._client.delete(P`/threads/${r}/messages/${e}`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
}, $n = class extends N {
	retrieve(e, t, n) {
		let { thread_id: r, run_id: i, ...a } = t;
		return this._client.get(P`/threads/${r}/runs/${i}/steps/${e}`, {
			query: a,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	list(e, t, n) {
		let { thread_id: r, ...i } = t;
		return this._client.getAPIList(P`/threads/${r}/runs/${e}/steps`, j, {
			query: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
}, er = (e) => {
	if (typeof Buffer < "u") {
		let t = Buffer.from(e, "base64");
		return Array.from(new Float32Array(t.buffer, t.byteOffset, t.length / Float32Array.BYTES_PER_ELEMENT));
	}
	{
		let t = atob(e), n = t.length, r = new Uint8Array(n);
		for (let e = 0; e < n; e++) r[e] = t.charCodeAt(e);
		return Array.from(new Float32Array(r.buffer));
	}
}, U = (e) => {
	if (globalThis.process !== void 0) return globalThis.process.env?.[e]?.trim() ?? void 0;
	if (globalThis.Deno !== void 0) return globalThis.Deno.env?.get?.(e)?.trim();
}, W, G, tr, K, nr, q, J, rr, Y, ir, X, ar, or, sr, cr, lr, ur, dr, fr, pr, mr, hr, gr, _r = class extends sn {
	constructor() {
		super(...arguments), W.add(this), tr.set(this, []), K.set(this, {}), nr.set(this, {}), q.set(this, void 0), J.set(this, void 0), rr.set(this, void 0), Y.set(this, void 0), ir.set(this, void 0), X.set(this, void 0), ar.set(this, void 0), or.set(this, void 0), sr.set(this, void 0);
	}
	[(tr = /* @__PURE__ */ new WeakMap(), K = /* @__PURE__ */ new WeakMap(), nr = /* @__PURE__ */ new WeakMap(), q = /* @__PURE__ */ new WeakMap(), J = /* @__PURE__ */ new WeakMap(), rr = /* @__PURE__ */ new WeakMap(), Y = /* @__PURE__ */ new WeakMap(), ir = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakMap(), ar = /* @__PURE__ */ new WeakMap(), or = /* @__PURE__ */ new WeakMap(), sr = /* @__PURE__ */ new WeakMap(), W = /* @__PURE__ */ new WeakSet(), Symbol.asyncIterator)]() {
		let e = [], t = [], n = !1;
		return this.on("event", (n) => {
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
	static fromReadableStream(e) {
		let t = new G();
		return t._run(() => t._fromReadableStream(e)), t;
	}
	async _fromReadableStream(e, n) {
		let r = n?.signal;
		r && (r.aborted && this.controller.abort(), r.addEventListener("abort", () => this.controller.abort())), this._connected();
		let i = et.fromReadableStream(e, this.controller);
		for await (let e of i) t(this, W, "m", cr).call(this, e);
		if (i.controller.signal?.aborted) throw new s();
		return this._addRun(t(this, W, "m", lr).call(this));
	}
	toReadableStream() {
		return new et(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
	}
	static createToolAssistantStream(e, t, n, r) {
		let i = new G();
		return i._run(() => i._runToolAssistantStream(e, t, n, {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), i;
	}
	async _createToolAssistantStream(e, n, r, i) {
		let a = i?.signal;
		a && (a.aborted && this.controller.abort(), a.addEventListener("abort", () => this.controller.abort()));
		let o = {
			...r,
			stream: !0
		}, c = await e.submitToolOutputs(n, o, {
			...i,
			signal: this.controller.signal
		});
		this._connected();
		for await (let e of c) t(this, W, "m", cr).call(this, e);
		if (c.controller.signal?.aborted) throw new s();
		return this._addRun(t(this, W, "m", lr).call(this));
	}
	static createThreadAssistantStream(e, t, n) {
		let r = new G();
		return r._run(() => r._threadAssistantStream(e, t, {
			...n,
			headers: {
				...n?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), r;
	}
	static createAssistantStream(e, t, n, r) {
		let i = new G();
		return i._run(() => i._runAssistantStream(e, t, n, {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), i;
	}
	currentEvent() {
		return t(this, ar, "f");
	}
	currentRun() {
		return t(this, or, "f");
	}
	currentMessageSnapshot() {
		return t(this, q, "f");
	}
	currentRunStepSnapshot() {
		return t(this, sr, "f");
	}
	async finalRunSteps() {
		return await this.done(), Object.values(t(this, K, "f"));
	}
	async finalMessages() {
		return await this.done(), Object.values(t(this, nr, "f"));
	}
	async finalRun() {
		if (await this.done(), !t(this, J, "f")) throw Error("Final run was not received.");
		return t(this, J, "f");
	}
	async _createThreadAssistantStream(e, n, r) {
		let i = r?.signal;
		i && (i.aborted && this.controller.abort(), i.addEventListener("abort", () => this.controller.abort()));
		let a = {
			...n,
			stream: !0
		}, o = await e.createAndRun(a, {
			...r,
			signal: this.controller.signal
		});
		this._connected();
		for await (let e of o) t(this, W, "m", cr).call(this, e);
		if (o.controller.signal?.aborted) throw new s();
		return this._addRun(t(this, W, "m", lr).call(this));
	}
	async _createAssistantStream(e, n, r, i) {
		let a = i?.signal;
		a && (a.aborted && this.controller.abort(), a.addEventListener("abort", () => this.controller.abort()));
		let o = {
			...r,
			stream: !0
		}, c = await e.create(n, o, {
			...i,
			signal: this.controller.signal
		});
		this._connected();
		for await (let e of c) t(this, W, "m", cr).call(this, e);
		if (c.controller.signal?.aborted) throw new s();
		return this._addRun(t(this, W, "m", lr).call(this));
	}
	static accumulateDelta(e, t) {
		for (let [n, r] of Object.entries(t)) {
			if (!e.hasOwnProperty(n)) {
				e[n] = r;
				continue;
			}
			let t = e[n];
			if (t == null) {
				e[n] = r;
				continue;
			}
			if (n === "index" || n === "type") {
				e[n] = r;
				continue;
			}
			if (typeof t == "string" && typeof r == "string") t += r;
			else if (typeof t == "number" && typeof r == "number") t += r;
			else if (ie(t) && ie(r)) t = this.accumulateDelta(t, r);
			else if (Array.isArray(t) && Array.isArray(r)) {
				if (t.every((e) => typeof e == "string" || typeof e == "number")) {
					t.push(...r);
					continue;
				}
				for (let e of r) {
					if (!ie(e)) throw Error(`Expected array delta entry to be an object but got: ${e}`);
					let n = e.index;
					if (n == null) throw console.error(e), Error("Expected array delta entry to have an `index` property");
					if (typeof n != "number") throw Error(`Expected array delta entry \`index\` property to be a number but got ${n}`);
					let r = t[n];
					r == null ? t.push(e) : t[n] = this.accumulateDelta(r, e);
				}
				continue;
			} else throw Error(`Unhandled record type: ${n}, deltaValue: ${r}, accValue: ${t}`);
			e[n] = t;
		}
		return e;
	}
	_addRun(e) {
		return e;
	}
	async _threadAssistantStream(e, t, n) {
		return await this._createThreadAssistantStream(t, e, n);
	}
	async _runAssistantStream(e, t, n, r) {
		return await this._createAssistantStream(t, e, n, r);
	}
	async _runToolAssistantStream(e, t, n, r) {
		return await this._createToolAssistantStream(t, e, n, r);
	}
};
G = _r, cr = function(n) {
	if (!this.ended) switch (e(this, ar, n, "f"), t(this, W, "m", fr).call(this, n), n.event) {
		case "thread.created": break;
		case "thread.run.created":
		case "thread.run.queued":
		case "thread.run.in_progress":
		case "thread.run.requires_action":
		case "thread.run.completed":
		case "thread.run.incomplete":
		case "thread.run.failed":
		case "thread.run.cancelling":
		case "thread.run.cancelled":
		case "thread.run.expired":
			t(this, W, "m", gr).call(this, n);
			break;
		case "thread.run.step.created":
		case "thread.run.step.in_progress":
		case "thread.run.step.delta":
		case "thread.run.step.completed":
		case "thread.run.step.failed":
		case "thread.run.step.cancelled":
		case "thread.run.step.expired":
			t(this, W, "m", dr).call(this, n);
			break;
		case "thread.message.created":
		case "thread.message.in_progress":
		case "thread.message.delta":
		case "thread.message.completed":
		case "thread.message.incomplete":
			t(this, W, "m", ur).call(this, n);
			break;
		case "error": throw Error("Encountered an error event in event processing - errors should be processed earlier");
	}
}, lr = function() {
	if (this.ended) throw new a("stream has ended, this shouldn't happen");
	if (!t(this, J, "f")) throw Error("Final run has not been received");
	return t(this, J, "f");
}, ur = function(n) {
	let [r, i] = t(this, W, "m", mr).call(this, n, t(this, q, "f"));
	e(this, q, r, "f"), t(this, nr, "f")[r.id] = r;
	for (let e of i) {
		let t = r.content[e.index];
		t?.type == "text" && this._emit("textCreated", t.text);
	}
	switch (n.event) {
		case "thread.message.created":
			this._emit("messageCreated", n.data);
			break;
		case "thread.message.in_progress": break;
		case "thread.message.delta":
			if (this._emit("messageDelta", n.data.delta, r), n.data.delta.content) for (let i of n.data.delta.content) {
				if (i.type == "text" && i.text) {
					let e = i.text, t = r.content[i.index];
					if (t && t.type == "text") this._emit("textDelta", e, t.text);
					else throw Error("The snapshot associated with this text delta is not text or missing");
				}
				if (i.index != t(this, rr, "f")) {
					if (t(this, Y, "f")) switch (t(this, Y, "f").type) {
						case "text":
							this._emit("textDone", t(this, Y, "f").text, t(this, q, "f"));
							break;
						case "image_file": this._emit("imageFileDone", t(this, Y, "f").image_file, t(this, q, "f"));
					}
					e(this, rr, i.index, "f");
				}
				e(this, Y, r.content[i.index], "f");
			}
			break;
		case "thread.message.completed":
		case "thread.message.incomplete":
			if (t(this, rr, "f") !== void 0) {
				let e = n.data.content[t(this, rr, "f")];
				if (e) switch (e.type) {
					case "image_file":
						this._emit("imageFileDone", e.image_file, t(this, q, "f"));
						break;
					case "text": this._emit("textDone", e.text, t(this, q, "f"));
				}
			}
			t(this, q, "f") && this._emit("messageDone", n.data), e(this, q, void 0, "f");
	}
}, dr = function(n) {
	let r = t(this, W, "m", pr).call(this, n);
	switch (e(this, sr, r, "f"), n.event) {
		case "thread.run.step.created":
			this._emit("runStepCreated", n.data);
			break;
		case "thread.run.step.delta":
			let i = n.data.delta;
			if (i.step_details && i.step_details.type == "tool_calls" && i.step_details.tool_calls && r.step_details.type == "tool_calls") for (let n of i.step_details.tool_calls) n.index == t(this, ir, "f") ? this._emit("toolCallDelta", n, r.step_details.tool_calls[n.index]) : (t(this, X, "f") && this._emit("toolCallDone", t(this, X, "f")), e(this, ir, n.index, "f"), e(this, X, r.step_details.tool_calls[n.index], "f"), t(this, X, "f") && this._emit("toolCallCreated", t(this, X, "f")));
			this._emit("runStepDelta", n.data.delta, r);
			break;
		case "thread.run.step.completed":
		case "thread.run.step.failed":
		case "thread.run.step.cancelled":
		case "thread.run.step.expired": e(this, sr, void 0, "f"), n.data.step_details.type == "tool_calls" && t(this, X, "f") && (this._emit("toolCallDone", t(this, X, "f")), e(this, X, void 0, "f")), this._emit("runStepDone", n.data, r);
	}
}, fr = function(e) {
	t(this, tr, "f").push(e), this._emit("event", e);
}, pr = function(e) {
	switch (e.event) {
		case "thread.run.step.created": return t(this, K, "f")[e.data.id] = e.data, e.data;
		case "thread.run.step.delta":
			let n = t(this, K, "f")[e.data.id];
			if (!n) throw Error("Received a RunStepDelta before creation of a snapshot");
			let r = e.data;
			if (r.delta) {
				let i = G.accumulateDelta(n, r.delta);
				t(this, K, "f")[e.data.id] = i;
			}
			return t(this, K, "f")[e.data.id];
		case "thread.run.step.completed":
		case "thread.run.step.failed":
		case "thread.run.step.cancelled":
		case "thread.run.step.expired":
		case "thread.run.step.in_progress": t(this, K, "f")[e.data.id] = e.data;
	}
	if (t(this, K, "f")[e.data.id]) return t(this, K, "f")[e.data.id];
	throw Error("No snapshot available");
}, mr = function(e, n) {
	let r = [];
	switch (e.event) {
		case "thread.message.created": return [e.data, r];
		case "thread.message.delta":
			if (!n) throw Error("Received a delta with no existing snapshot (there should be one from message creation)");
			let i = e.data;
			if (i.delta.content) for (let e of i.delta.content) if (e.index in n.content) {
				let r = n.content[e.index];
				n.content[e.index] = t(this, W, "m", hr).call(this, e, r);
			} else n.content[e.index] = e, r.push(e);
			return [n, r];
		case "thread.message.in_progress":
		case "thread.message.completed":
		case "thread.message.incomplete":
			if (n) return [n, r];
			throw Error("Received thread message event with no existing snapshot");
	}
	throw Error("Tried to accumulate a non-message event");
}, hr = function(e, t) {
	return G.accumulateDelta(t, e);
}, gr = function(n) {
	switch (e(this, or, n.data, "f"), n.event) {
		case "thread.run.created": break;
		case "thread.run.queued": break;
		case "thread.run.in_progress": break;
		case "thread.run.requires_action":
		case "thread.run.cancelled":
		case "thread.run.failed":
		case "thread.run.completed":
		case "thread.run.expired":
		case "thread.run.incomplete": e(this, J, n.data, "f"), t(this, X, "f") && (this._emit("toolCallDone", t(this, X, "f")), e(this, X, void 0, "f"));
	}
};
//#endregion
//#region node_modules/openai/resources/beta/threads/runs/runs.mjs
var vr = class extends N {
	constructor() {
		super(...arguments), this.steps = new $n(this._client);
	}
	create(e, t, n) {
		let { include: r, ...i } = t;
		return this._client.post(P`/threads/${e}/runs`, {
			query: { include: r },
			body: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers]),
			stream: t.stream ?? !1,
			__synthesizeEventData: !0
		});
	}
	retrieve(e, t, n) {
		let { thread_id: r } = t;
		return this._client.get(P`/threads/${r}/runs/${e}`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	update(e, t, n) {
		let { thread_id: r, ...i } = t;
		return this._client.post(P`/threads/${r}/runs/${e}`, {
			body: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/threads/${e}/runs`, j, {
			query: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	cancel(e, t, n) {
		let { thread_id: r } = t;
		return this._client.post(P`/threads/${r}/runs/${e}/cancel`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	async createAndPoll(e, t, n) {
		let r = await this.create(e, t, n);
		return await this.poll(r.id, { thread_id: e }, n);
	}
	createAndStream(e, t, n) {
		return _r.createAssistantStream(e, this._client.beta.threads.runs, t, n);
	}
	async poll(e, t, n) {
		let r = H([n?.headers, {
			"X-Stainless-Poll-Helper": "true",
			"X-Stainless-Custom-Poll-Interval": n?.pollIntervalMs?.toString() ?? void 0
		}]);
		for (;;) {
			let { data: i, response: a } = await this.retrieve(e, t, {
				...n,
				headers: {
					...n?.headers,
					...r
				}
			}).withResponse();
			switch (i.status) {
				case "queued":
				case "in_progress":
				case "cancelling":
					let e = 5e3;
					if (n?.pollIntervalMs) e = n.pollIntervalMs;
					else {
						let t = a.headers.get("openai-poll-after-ms");
						if (t) {
							let n = parseInt(t);
							isNaN(n) || (e = n);
						}
					}
					await se(e);
					break;
				case "requires_action":
				case "incomplete":
				case "cancelled":
				case "completed":
				case "failed":
				case "expired": return i;
			}
		}
	}
	stream(e, t, n) {
		return _r.createAssistantStream(e, this._client.beta.threads.runs, t, n);
	}
	submitToolOutputs(e, t, n) {
		let { thread_id: r, ...i } = t;
		return this._client.post(P`/threads/${r}/runs/${e}/submit_tool_outputs`, {
			body: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers]),
			stream: t.stream ?? !1,
			__synthesizeEventData: !0
		});
	}
	async submitToolOutputsAndPoll(e, t, n) {
		let r = await this.submitToolOutputs(e, t, n);
		return await this.poll(r.id, t, n);
	}
	submitToolOutputsStream(e, t, n) {
		return _r.createToolAssistantStream(e, this._client.beta.threads.runs, t, n);
	}
};
vr.Steps = $n;
//#endregion
//#region node_modules/openai/resources/beta/threads/threads.mjs
var yr = class extends N {
	constructor() {
		super(...arguments), this.runs = new vr(this._client), this.messages = new Qn(this._client);
	}
	create(e = {}, t) {
		return this._client.post("/threads", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/threads/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	update(e, t, n) {
		return this._client.post(P`/threads/${e}`, {
			body: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	delete(e, t) {
		return this._client.delete(P`/threads/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	createAndRun(e, t) {
		return this._client.post("/threads/runs", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers]),
			stream: e.stream ?? !1,
			__synthesizeEventData: !0
		});
	}
	async createAndRunPoll(e, t) {
		let n = await this.createAndRun(e, t);
		return await this.runs.poll(n.id, { thread_id: n.thread_id }, t);
	}
	createAndRunStream(e, t) {
		return _r.createThreadAssistantStream(e, this._client.beta.threads, t);
	}
};
yr.Runs = vr, yr.Messages = Qn;
//#endregion
//#region node_modules/openai/resources/beta/beta.mjs
var br = class extends N {
	constructor() {
		super(...arguments), this.realtime = new Jn(this._client), this.chatkit = new Zn(this._client), this.assistants = new Gn(this._client), this.threads = new yr(this._client);
	}
};
br.Realtime = Jn, br.ChatKit = Zn, br.Assistants = Gn, br.Threads = yr;
//#endregion
//#region node_modules/openai/resources/completions.mjs
var xr = class extends N {
	create(e, t) {
		return this._client.post("/completions", {
			body: e,
			...t,
			stream: e.stream ?? !1
		});
	}
}, Sr = class extends N {
	retrieve(e, t, n) {
		let { container_id: r } = t;
		return this._client.get(P`/containers/${r}/files/${e}/content`, {
			...n,
			headers: H([{ Accept: "application/binary" }, n?.headers]),
			__binaryResponse: !0
		});
	}
}, Cr = class extends N {
	constructor() {
		super(...arguments), this.content = new Sr(this._client);
	}
	create(e, t, n) {
		return this._client.post(P`/containers/${e}/files`, vt({
			body: t,
			...n
		}, this._client));
	}
	retrieve(e, t, n) {
		let { container_id: r } = t;
		return this._client.get(P`/containers/${r}/files/${e}`, n);
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/containers/${e}/files`, j, {
			query: t,
			...n
		});
	}
	delete(e, t, n) {
		let { container_id: r } = t;
		return this._client.delete(P`/containers/${r}/files/${e}`, {
			...n,
			headers: H([{ Accept: "*/*" }, n?.headers])
		});
	}
};
Cr.Content = Sr;
//#endregion
//#region node_modules/openai/resources/containers/containers.mjs
var wr = class extends N {
	constructor() {
		super(...arguments), this.files = new Cr(this._client);
	}
	create(e, t) {
		return this._client.post("/containers", {
			body: e,
			...t
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/containers/${e}`, t);
	}
	list(e = {}, t) {
		return this._client.getAPIList("/containers", j, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(P`/containers/${e}`, {
			...t,
			headers: H([{ Accept: "*/*" }, t?.headers])
		});
	}
};
wr.Files = Cr;
//#endregion
//#region node_modules/openai/resources/conversations/items.mjs
var Tr = class extends N {
	create(e, t, n) {
		let { include: r, ...i } = t;
		return this._client.post(P`/conversations/${e}/items`, {
			query: { include: r },
			body: i,
			...n
		});
	}
	retrieve(e, t, n) {
		let { conversation_id: r, ...i } = t;
		return this._client.get(P`/conversations/${r}/items/${e}`, {
			query: i,
			...n
		});
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/conversations/${e}/items`, pt, {
			query: t,
			...n
		});
	}
	delete(e, t, n) {
		let { conversation_id: r } = t;
		return this._client.delete(P`/conversations/${r}/items/${e}`, n);
	}
}, Er = class extends N {
	constructor() {
		super(...arguments), this.items = new Tr(this._client);
	}
	create(e = {}, t) {
		return this._client.post("/conversations", {
			body: e,
			...t
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/conversations/${e}`, t);
	}
	update(e, t, n) {
		return this._client.post(P`/conversations/${e}`, {
			body: t,
			...n
		});
	}
	delete(e, t) {
		return this._client.delete(P`/conversations/${e}`, t);
	}
};
Er.Items = Tr;
//#endregion
//#region node_modules/openai/resources/embeddings.mjs
var Dr = class extends N {
	create(e, t) {
		let n = !!e.encoding_format, r = n ? e.encoding_format : "base64";
		n && k(this._client).debug("embeddings/user defined encoding_format:", e.encoding_format);
		let i = this._client.post("/embeddings", {
			body: {
				...e,
				encoding_format: r
			},
			...t
		});
		return n ? i : (k(this._client).debug("embeddings/decoding base64 embeddings from base64"), i._thenUnwrap((e) => (e && e.data && e.data.forEach((e) => {
			let t = e.embedding;
			e.embedding = er(t);
		}), e)));
	}
}, Or = class extends N {
	retrieve(e, t, n) {
		let { eval_id: r, run_id: i } = t;
		return this._client.get(P`/evals/${r}/runs/${i}/output_items/${e}`, n);
	}
	list(e, t, n) {
		let { eval_id: r, ...i } = t;
		return this._client.getAPIList(P`/evals/${r}/runs/${e}/output_items`, j, {
			query: i,
			...n
		});
	}
}, kr = class extends N {
	constructor() {
		super(...arguments), this.outputItems = new Or(this._client);
	}
	create(e, t, n) {
		return this._client.post(P`/evals/${e}/runs`, {
			body: t,
			...n
		});
	}
	retrieve(e, t, n) {
		let { eval_id: r } = t;
		return this._client.get(P`/evals/${r}/runs/${e}`, n);
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/evals/${e}/runs`, j, {
			query: t,
			...n
		});
	}
	delete(e, t, n) {
		let { eval_id: r } = t;
		return this._client.delete(P`/evals/${r}/runs/${e}`, n);
	}
	cancel(e, t, n) {
		let { eval_id: r } = t;
		return this._client.post(P`/evals/${r}/runs/${e}`, n);
	}
};
kr.OutputItems = Or;
//#endregion
//#region node_modules/openai/resources/evals/evals.mjs
var Ar = class extends N {
	constructor() {
		super(...arguments), this.runs = new kr(this._client);
	}
	create(e, t) {
		return this._client.post("/evals", {
			body: e,
			...t
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/evals/${e}`, t);
	}
	update(e, t, n) {
		return this._client.post(P`/evals/${e}`, {
			body: t,
			...n
		});
	}
	list(e = {}, t) {
		return this._client.getAPIList("/evals", j, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(P`/evals/${e}`, t);
	}
};
Ar.Runs = kr;
//#endregion
//#region node_modules/openai/resources/files.mjs
var jr = class extends N {
	create(e, t) {
		return this._client.post("/files", M({
			body: e,
			...t
		}, this._client));
	}
	retrieve(e, t) {
		return this._client.get(P`/files/${e}`, t);
	}
	list(e = {}, t) {
		return this._client.getAPIList("/files", j, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(P`/files/${e}`, t);
	}
	content(e, t) {
		return this._client.get(P`/files/${e}/content`, {
			...t,
			headers: H([{ Accept: "application/binary" }, t?.headers]),
			__binaryResponse: !0
		});
	}
	async waitForProcessing(e, { pollInterval: t = 5e3, maxWait: n = 18e5 } = {}) {
		let r = /* @__PURE__ */ new Set([
			"processed",
			"error",
			"deleted"
		]), i = Date.now(), a = await this.retrieve(e);
		for (; !a.status || !r.has(a.status);) if (await se(t), a = await this.retrieve(e), Date.now() - i > n) throw new l({ message: `Giving up on waiting for file ${e} to finish processing after ${n} milliseconds.` });
		return a;
	}
}, Mr = class extends N {}, Nr = class extends N {
	run(e, t) {
		return this._client.post("/fine_tuning/alpha/graders/run", {
			body: e,
			...t
		});
	}
	validate(e, t) {
		return this._client.post("/fine_tuning/alpha/graders/validate", {
			body: e,
			...t
		});
	}
}, Pr = class extends N {
	constructor() {
		super(...arguments), this.graders = new Nr(this._client);
	}
};
Pr.Graders = Nr;
//#endregion
//#region node_modules/openai/resources/fine-tuning/checkpoints/permissions.mjs
var Fr = class extends N {
	create(e, t, n) {
		return this._client.getAPIList(P`/fine_tuning/checkpoints/${e}/permissions`, ft, {
			body: t,
			method: "post",
			...n
		});
	}
	retrieve(e, t = {}, n) {
		return this._client.get(P`/fine_tuning/checkpoints/${e}/permissions`, {
			query: t,
			...n
		});
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/fine_tuning/checkpoints/${e}/permissions`, pt, {
			query: t,
			...n
		});
	}
	delete(e, t, n) {
		let { fine_tuned_model_checkpoint: r } = t;
		return this._client.delete(P`/fine_tuning/checkpoints/${r}/permissions/${e}`, n);
	}
}, Ir = class extends N {
	constructor() {
		super(...arguments), this.permissions = new Fr(this._client);
	}
};
Ir.Permissions = Fr;
//#endregion
//#region node_modules/openai/resources/fine-tuning/jobs/checkpoints.mjs
var Lr = class extends N {
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/fine_tuning/jobs/${e}/checkpoints`, j, {
			query: t,
			...n
		});
	}
}, Rr = class extends N {
	constructor() {
		super(...arguments), this.checkpoints = new Lr(this._client);
	}
	create(e, t) {
		return this._client.post("/fine_tuning/jobs", {
			body: e,
			...t
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/fine_tuning/jobs/${e}`, t);
	}
	list(e = {}, t) {
		return this._client.getAPIList("/fine_tuning/jobs", j, {
			query: e,
			...t
		});
	}
	cancel(e, t) {
		return this._client.post(P`/fine_tuning/jobs/${e}/cancel`, t);
	}
	listEvents(e, t = {}, n) {
		return this._client.getAPIList(P`/fine_tuning/jobs/${e}/events`, j, {
			query: t,
			...n
		});
	}
	pause(e, t) {
		return this._client.post(P`/fine_tuning/jobs/${e}/pause`, t);
	}
	resume(e, t) {
		return this._client.post(P`/fine_tuning/jobs/${e}/resume`, t);
	}
};
Rr.Checkpoints = Lr;
//#endregion
//#region node_modules/openai/resources/fine-tuning/fine-tuning.mjs
var Z = class extends N {
	constructor() {
		super(...arguments), this.methods = new Mr(this._client), this.jobs = new Rr(this._client), this.checkpoints = new Ir(this._client), this.alpha = new Pr(this._client);
	}
};
Z.Methods = Mr, Z.Jobs = Rr, Z.Checkpoints = Ir, Z.Alpha = Pr;
//#endregion
//#region node_modules/openai/resources/graders/grader-models.mjs
var zr = class extends N {}, Br = class extends N {
	constructor() {
		super(...arguments), this.graderModels = new zr(this._client);
	}
};
Br.GraderModels = zr;
//#endregion
//#region node_modules/openai/resources/images.mjs
var Vr = class extends N {
	createVariation(e, t) {
		return this._client.post("/images/variations", M({
			body: e,
			...t
		}, this._client));
	}
	edit(e, t) {
		return this._client.post("/images/edits", M({
			body: e,
			...t,
			stream: e.stream ?? !1
		}, this._client));
	}
	generate(e, t) {
		return this._client.post("/images/generations", {
			body: e,
			...t,
			stream: e.stream ?? !1
		});
	}
}, Hr = class extends N {
	retrieve(e, t) {
		return this._client.get(P`/models/${e}`, t);
	}
	list(e) {
		return this._client.getAPIList("/models", ft, e);
	}
	delete(e, t) {
		return this._client.delete(P`/models/${e}`, t);
	}
}, Ur = class extends N {
	create(e, t) {
		return this._client.post("/moderations", {
			body: e,
			...t
		});
	}
}, Wr = class extends N {
	accept(e, t, n) {
		return this._client.post(P`/realtime/calls/${e}/accept`, {
			body: t,
			...n,
			headers: H([{ Accept: "*/*" }, n?.headers])
		});
	}
	hangup(e, t) {
		return this._client.post(P`/realtime/calls/${e}/hangup`, {
			...t,
			headers: H([{ Accept: "*/*" }, t?.headers])
		});
	}
	refer(e, t, n) {
		return this._client.post(P`/realtime/calls/${e}/refer`, {
			body: t,
			...n,
			headers: H([{ Accept: "*/*" }, n?.headers])
		});
	}
	reject(e, t = {}, n) {
		return this._client.post(P`/realtime/calls/${e}/reject`, {
			body: t,
			...n,
			headers: H([{ Accept: "*/*" }, n?.headers])
		});
	}
}, Gr = class extends N {
	create(e, t) {
		return this._client.post("/realtime/client_secrets", {
			body: e,
			...t
		});
	}
}, Kr = class extends N {
	constructor() {
		super(...arguments), this.clientSecrets = new Gr(this._client), this.calls = new Wr(this._client);
	}
};
Kr.ClientSecrets = Gr, Kr.Calls = Wr;
//#endregion
//#region node_modules/openai/lib/ResponsesParser.mjs
function qr(e, t) {
	return !t || !Xr(t) ? {
		...e,
		output_parsed: null,
		output: e.output.map((e) => e.type === "function_call" ? {
			...e,
			parsed_arguments: null
		} : e.type === "message" ? {
			...e,
			content: e.content.map((e) => ({
				...e,
				parsed: null
			}))
		} : e)
	} : Jr(e, t);
}
function Jr(e, t) {
	let n = e.output.map((e) => {
		if (e.type === "function_call") return {
			...e,
			parsed_arguments: $r(t, e)
		};
		if (e.type === "message") {
			let n = e.content.map((e) => e.type === "output_text" ? {
				...e,
				parsed: Yr(t, e.text)
			} : e);
			return {
				...e,
				content: n
			};
		}
		return e;
	}), r = Object.assign({}, e, { output: n });
	return Object.getOwnPropertyDescriptor(e, "output_text") || ei(r), Object.defineProperty(r, "output_parsed", {
		enumerable: !0,
		get() {
			for (let e of r.output) if (e.type === "message") {
				for (let t of e.content) if (t.type === "output_text" && t.parsed !== null) return t.parsed;
			}
			return null;
		}
	}), r;
}
function Yr(e, t) {
	return e.text?.format?.type === "json_schema" ? "$parseRaw" in e.text?.format ? (e.text?.format).$parseRaw(t) : JSON.parse(t) : null;
}
function Xr(e) {
	return !!It(e.text?.format);
}
function Zr(e) {
	return e?.$brand === "auto-parseable-tool";
}
function Qr(e, t) {
	return e.find((e) => e.type === "function" && e.name === t);
}
function $r(e, t) {
	let n = Qr(e.tools ?? [], t.name);
	return {
		...t,
		...t,
		parsed_arguments: Zr(n) ? n.$parseRaw(t.arguments) : n?.strict ? JSON.parse(t.arguments) : null
	};
}
function ei(e) {
	let t = [];
	for (let n of e.output) if (n.type === "message") for (let e of n.content) e.type === "output_text" && t.push(e.text);
	e.output_text = t.join("");
}
//#endregion
//#region node_modules/openai/lib/responses/ResponseStream.mjs
var ti, ni, Q, ri, ii, ai, oi, si, ci = class n extends sn {
	constructor(t) {
		super(), ti.add(this), ni.set(this, void 0), Q.set(this, void 0), ri.set(this, void 0), e(this, ni, t, "f");
	}
	static createResponse(e, t, r) {
		let i = new n(t);
		return i._run(() => i._createOrRetrieveResponse(e, t, {
			...r,
			headers: {
				...r?.headers,
				"X-Stainless-Helper-Method": "stream"
			}
		})), i;
	}
	async _createOrRetrieveResponse(e, n, r) {
		let i = r?.signal;
		i && (i.aborted && this.controller.abort(), i.addEventListener("abort", () => this.controller.abort())), t(this, ti, "m", ii).call(this);
		let a, o = null;
		"response_id" in n ? (a = await e.responses.retrieve(n.response_id, { stream: !0 }, {
			...r,
			signal: this.controller.signal,
			stream: !0
		}), o = n.starting_after ?? null) : a = await e.responses.create({
			...n,
			stream: !0
		}, {
			...r,
			signal: this.controller.signal
		}), this._connected();
		for await (let e of a) t(this, ti, "m", ai).call(this, e, o);
		if (a.controller.signal?.aborted) throw new s();
		return t(this, ti, "m", oi).call(this);
	}
	[(ni = /* @__PURE__ */ new WeakMap(), Q = /* @__PURE__ */ new WeakMap(), ri = /* @__PURE__ */ new WeakMap(), ti = /* @__PURE__ */ new WeakSet(), ii = function() {
		this.ended || e(this, Q, void 0, "f");
	}, ai = function(e, n) {
		if (this.ended) return;
		let r = (e, t) => {
			(n == null || t.sequence_number > n) && this._emit(e, t);
		}, i = t(this, ti, "m", si).call(this, e);
		switch (r("event", e), e.type) {
			case "response.output_text.delta": {
				let t = i.output[e.output_index];
				if (!t) throw new a(`missing output at index ${e.output_index}`);
				if (t.type === "message") {
					let n = t.content[e.content_index];
					if (!n) throw new a(`missing content at index ${e.content_index}`);
					if (n.type !== "output_text") throw new a(`expected content to be 'output_text', got ${n.type}`);
					r("response.output_text.delta", {
						...e,
						snapshot: n.text
					});
				}
				break;
			}
			case "response.function_call_arguments.delta": {
				let t = i.output[e.output_index];
				if (!t) throw new a(`missing output at index ${e.output_index}`);
				t.type === "function_call" && r("response.function_call_arguments.delta", {
					...e,
					snapshot: t.arguments
				});
				break;
			}
			default: r(e.type, e);
		}
	}, oi = function() {
		if (this.ended) throw new a("stream has ended, this shouldn't happen");
		let n = t(this, Q, "f");
		if (!n) throw new a("request ended without sending any events");
		e(this, Q, void 0, "f");
		let r = li(n, t(this, ni, "f"));
		return e(this, ri, r, "f"), r;
	}, si = function(n) {
		let r = t(this, Q, "f");
		if (!r) {
			if (n.type !== "response.created") throw new a(`When snapshot hasn't been set yet, expected 'response.created' event, got ${n.type}`);
			return r = e(this, Q, n.response, "f"), r;
		}
		switch (n.type) {
			case "response.output_item.added":
				r.output.push(n.item);
				break;
			case "response.content_part.added": {
				let e = r.output[n.output_index];
				if (!e) throw new a(`missing output at index ${n.output_index}`);
				let t = e.type, i = n.part;
				t === "message" && i.type !== "reasoning_text" ? e.content.push(i) : t === "reasoning" && i.type === "reasoning_text" && (e.content ||= [], e.content.push(i));
				break;
			}
			case "response.output_text.delta": {
				let e = r.output[n.output_index];
				if (!e) throw new a(`missing output at index ${n.output_index}`);
				if (e.type === "message") {
					let t = e.content[n.content_index];
					if (!t) throw new a(`missing content at index ${n.content_index}`);
					if (t.type !== "output_text") throw new a(`expected content to be 'output_text', got ${t.type}`);
					t.text += n.delta;
				}
				break;
			}
			case "response.function_call_arguments.delta": {
				let e = r.output[n.output_index];
				if (!e) throw new a(`missing output at index ${n.output_index}`);
				e.type === "function_call" && (e.arguments += n.delta);
				break;
			}
			case "response.reasoning_text.delta": {
				let e = r.output[n.output_index];
				if (!e) throw new a(`missing output at index ${n.output_index}`);
				if (e.type === "reasoning") {
					let t = e.content?.[n.content_index];
					if (!t) throw new a(`missing content at index ${n.content_index}`);
					if (t.type !== "reasoning_text") throw new a(`expected content to be 'reasoning_text', got ${t.type}`);
					t.text += n.delta;
				}
				break;
			}
			case "response.completed": e(this, Q, n.response, "f");
		}
		return r;
	}, Symbol.asyncIterator)]() {
		let e = [], t = [], n = !1;
		return this.on("event", (n) => {
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
	async finalResponse() {
		await this.done();
		let e = t(this, ri, "f");
		if (!e) throw new a("stream ended without producing a ChatCompletion");
		return e;
	}
};
function li(e, t) {
	return qr(e, t);
}
//#endregion
//#region node_modules/openai/resources/responses/input-items.mjs
var ui = class extends N {
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/responses/${e}/input_items`, j, {
			query: t,
			...n
		});
	}
}, di = class extends N {
	count(e = {}, t) {
		return this._client.post("/responses/input_tokens", {
			body: e,
			...t
		});
	}
}, fi = class extends N {
	constructor() {
		super(...arguments), this.inputItems = new ui(this._client), this.inputTokens = new di(this._client);
	}
	create(e, t) {
		return this._client.post("/responses", {
			body: e,
			...t,
			stream: e.stream ?? !1
		})._thenUnwrap((e) => ("object" in e && e.object === "response" && ei(e), e));
	}
	retrieve(e, t = {}, n) {
		return this._client.get(P`/responses/${e}`, {
			query: t,
			...n,
			stream: t?.stream ?? !1
		})._thenUnwrap((e) => ("object" in e && e.object === "response" && ei(e), e));
	}
	delete(e, t) {
		return this._client.delete(P`/responses/${e}`, {
			...t,
			headers: H([{ Accept: "*/*" }, t?.headers])
		});
	}
	parse(e, t) {
		return this._client.responses.create(e, t)._thenUnwrap((t) => Jr(t, e));
	}
	stream(e, t) {
		return ci.createResponse(this._client, e, t);
	}
	cancel(e, t) {
		return this._client.post(P`/responses/${e}/cancel`, t);
	}
	compact(e, t) {
		return this._client.post("/responses/compact", {
			body: e,
			...t
		});
	}
};
fi.InputItems = ui, fi.InputTokens = di;
//#endregion
//#region node_modules/openai/resources/skills/content.mjs
var pi = class extends N {
	retrieve(e, t) {
		return this._client.get(P`/skills/${e}/content`, {
			...t,
			headers: H([{ Accept: "application/binary" }, t?.headers]),
			__binaryResponse: !0
		});
	}
}, mi = class extends N {
	retrieve(e, t, n) {
		let { skill_id: r } = t;
		return this._client.get(P`/skills/${r}/versions/${e}/content`, {
			...n,
			headers: H([{ Accept: "application/binary" }, n?.headers]),
			__binaryResponse: !0
		});
	}
}, hi = class extends N {
	constructor() {
		super(...arguments), this.content = new mi(this._client);
	}
	create(e, t = {}, n) {
		return this._client.post(P`/skills/${e}/versions`, vt({
			body: t,
			...n
		}, this._client));
	}
	retrieve(e, t, n) {
		let { skill_id: r } = t;
		return this._client.get(P`/skills/${r}/versions/${e}`, n);
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/skills/${e}/versions`, j, {
			query: t,
			...n
		});
	}
	delete(e, t, n) {
		let { skill_id: r } = t;
		return this._client.delete(P`/skills/${r}/versions/${e}`, n);
	}
};
hi.Content = mi;
//#endregion
//#region node_modules/openai/resources/skills/skills.mjs
var gi = class extends N {
	constructor() {
		super(...arguments), this.content = new pi(this._client), this.versions = new hi(this._client);
	}
	create(e = {}, t) {
		return this._client.post("/skills", vt({
			body: e,
			...t
		}, this._client));
	}
	retrieve(e, t) {
		return this._client.get(P`/skills/${e}`, t);
	}
	update(e, t, n) {
		return this._client.post(P`/skills/${e}`, {
			body: t,
			...n
		});
	}
	list(e = {}, t) {
		return this._client.getAPIList("/skills", j, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(P`/skills/${e}`, t);
	}
};
gi.Content = pi, gi.Versions = hi;
//#endregion
//#region node_modules/openai/resources/uploads/parts.mjs
var _i = class extends N {
	create(e, t, n) {
		return this._client.post(P`/uploads/${e}/parts`, M({
			body: t,
			...n
		}, this._client));
	}
}, vi = class extends N {
	constructor() {
		super(...arguments), this.parts = new _i(this._client);
	}
	create(e, t) {
		return this._client.post("/uploads", {
			body: e,
			...t
		});
	}
	cancel(e, t) {
		return this._client.post(P`/uploads/${e}/cancel`, t);
	}
	complete(e, t, n) {
		return this._client.post(P`/uploads/${e}/complete`, {
			body: t,
			...n
		});
	}
};
vi.Parts = _i;
//#endregion
//#region node_modules/openai/lib/Util.mjs
var yi = async (e) => {
	let t = await Promise.allSettled(e), n = t.filter((e) => e.status === "rejected");
	if (n.length) {
		for (let e of n) console.error(e.reason);
		throw Error(`${n.length} promise(s) failed - see the above errors`);
	}
	let r = [];
	for (let e of t) e.status === "fulfilled" && r.push(e.value);
	return r;
}, bi = class extends N {
	create(e, t, n) {
		return this._client.post(P`/vector_stores/${e}/file_batches`, {
			body: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	retrieve(e, t, n) {
		let { vector_store_id: r } = t;
		return this._client.get(P`/vector_stores/${r}/file_batches/${e}`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	cancel(e, t, n) {
		let { vector_store_id: r } = t;
		return this._client.post(P`/vector_stores/${r}/file_batches/${e}/cancel`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	async createAndPoll(e, t, n) {
		let r = await this.create(e, t);
		return await this.poll(e, r.id, n);
	}
	listFiles(e, t, n) {
		let { vector_store_id: r, ...i } = t;
		return this._client.getAPIList(P`/vector_stores/${r}/file_batches/${e}/files`, j, {
			query: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	async poll(e, t, n) {
		let r = H([n?.headers, {
			"X-Stainless-Poll-Helper": "true",
			"X-Stainless-Custom-Poll-Interval": n?.pollIntervalMs?.toString() ?? void 0
		}]);
		for (;;) {
			let { data: i, response: a } = await this.retrieve(t, { vector_store_id: e }, {
				...n,
				headers: r
			}).withResponse();
			switch (i.status) {
				case "in_progress":
					let e = 5e3;
					if (n?.pollIntervalMs) e = n.pollIntervalMs;
					else {
						let t = a.headers.get("openai-poll-after-ms");
						if (t) {
							let n = parseInt(t);
							isNaN(n) || (e = n);
						}
					}
					await se(e);
					break;
				case "failed":
				case "cancelled":
				case "completed": return i;
			}
		}
	}
	async uploadAndPoll(e, { files: t, fileIds: n = [] }, r) {
		if (t == null || t.length == 0) throw Error("No `files` provided to process. If you've already uploaded files you should use `.createAndPoll()` instead");
		let i = r?.maxConcurrency ?? 5, a = Math.min(i, t.length), o = this._client, s = t.values(), c = [...n];
		async function l(e) {
			for (let t of e) {
				let e = await o.files.create({
					file: t,
					purpose: "assistants"
				}, r);
				c.push(e.id);
			}
		}
		return await yi(Array(a).fill(s).map(l)), await this.createAndPoll(e, { file_ids: c });
	}
}, xi = class extends N {
	create(e, t, n) {
		return this._client.post(P`/vector_stores/${e}/files`, {
			body: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	retrieve(e, t, n) {
		let { vector_store_id: r } = t;
		return this._client.get(P`/vector_stores/${r}/files/${e}`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	update(e, t, n) {
		let { vector_store_id: r, ...i } = t;
		return this._client.post(P`/vector_stores/${r}/files/${e}`, {
			body: i,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	list(e, t = {}, n) {
		return this._client.getAPIList(P`/vector_stores/${e}/files`, j, {
			query: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	delete(e, t, n) {
		let { vector_store_id: r } = t;
		return this._client.delete(P`/vector_stores/${r}/files/${e}`, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	async createAndPoll(e, t, n) {
		let r = await this.create(e, t, n);
		return await this.poll(e, r.id, n);
	}
	async poll(e, t, n) {
		let r = H([n?.headers, {
			"X-Stainless-Poll-Helper": "true",
			"X-Stainless-Custom-Poll-Interval": n?.pollIntervalMs?.toString() ?? void 0
		}]);
		for (;;) {
			let i = await this.retrieve(t, { vector_store_id: e }, {
				...n,
				headers: r
			}).withResponse(), a = i.data;
			switch (a.status) {
				case "in_progress":
					let e = 5e3;
					if (n?.pollIntervalMs) e = n.pollIntervalMs;
					else {
						let t = i.response.headers.get("openai-poll-after-ms");
						if (t) {
							let n = parseInt(t);
							isNaN(n) || (e = n);
						}
					}
					await se(e);
					break;
				case "failed":
				case "completed": return a;
			}
		}
	}
	async upload(e, t, n) {
		let r = await this._client.files.create({
			file: t,
			purpose: "assistants"
		}, n);
		return this.create(e, { file_id: r.id }, n);
	}
	async uploadAndPoll(e, t, n) {
		let r = await this.upload(e, t, n);
		return await this.poll(e, r.id, n);
	}
	content(e, t, n) {
		let { vector_store_id: r } = t;
		return this._client.getAPIList(P`/vector_stores/${r}/files/${e}/content`, ft, {
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
}, Si = class extends N {
	constructor() {
		super(...arguments), this.files = new xi(this._client), this.fileBatches = new bi(this._client);
	}
	create(e, t) {
		return this._client.post("/vector_stores", {
			body: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	retrieve(e, t) {
		return this._client.get(P`/vector_stores/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	update(e, t, n) {
		return this._client.post(P`/vector_stores/${e}`, {
			body: t,
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
	list(e = {}, t) {
		return this._client.getAPIList("/vector_stores", j, {
			query: e,
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	delete(e, t) {
		return this._client.delete(P`/vector_stores/${e}`, {
			...t,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, t?.headers])
		});
	}
	search(e, t, n) {
		return this._client.getAPIList(P`/vector_stores/${e}/search`, ft, {
			body: t,
			method: "post",
			...n,
			headers: H([{ "OpenAI-Beta": "assistants=v2" }, n?.headers])
		});
	}
};
Si.Files = xi, Si.FileBatches = bi;
//#endregion
//#region node_modules/openai/resources/videos.mjs
var Ci = class extends N {
	create(e, t) {
		return this._client.post("/videos", vt({
			body: e,
			...t
		}, this._client));
	}
	retrieve(e, t) {
		return this._client.get(P`/videos/${e}`, t);
	}
	list(e = {}, t) {
		return this._client.getAPIList("/videos", pt, {
			query: e,
			...t
		});
	}
	delete(e, t) {
		return this._client.delete(P`/videos/${e}`, t);
	}
	downloadContent(e, t = {}, n) {
		return this._client.get(P`/videos/${e}/content`, {
			query: t,
			...n,
			headers: H([{ Accept: "application/binary" }, n?.headers]),
			__binaryResponse: !0
		});
	}
	remix(e, t, n) {
		return this._client.post(P`/videos/${e}/remix`, vt({
			body: t,
			...n
		}, this._client));
	}
}, wi, Ti, Ei, Di = class extends N {
	constructor() {
		super(...arguments), wi.add(this);
	}
	async unwrap(e, t, n = this._client.webhookSecret, r = 300) {
		return await this.verifySignature(e, t, n, r), JSON.parse(e);
	}
	async verifySignature(e, n, r = this._client.webhookSecret, i = 300) {
		if (typeof crypto > "u" || typeof crypto.subtle.importKey != "function" || typeof crypto.subtle.verify != "function") throw Error("Webhook signature verification is only supported when the `crypto` global is defined");
		t(this, wi, "m", Ti).call(this, r);
		let a = H([n]).values, o = t(this, wi, "m", Ei).call(this, a, "webhook-signature"), s = t(this, wi, "m", Ei).call(this, a, "webhook-timestamp"), c = t(this, wi, "m", Ei).call(this, a, "webhook-id"), l = parseInt(s, 10);
		if (isNaN(l)) throw new b("Invalid webhook timestamp format");
		let u = Math.floor(Date.now() / 1e3);
		if (u - l > i) throw new b("Webhook timestamp is too old");
		if (l > u + i) throw new b("Webhook timestamp is too new");
		let d = o.split(" ").map((e) => e.startsWith("v1,") ? e.substring(3) : e), f = r.startsWith("whsec_") ? Buffer.from(r.replace("whsec_", ""), "base64") : Buffer.from(r, "utf-8"), p = c ? `${c}.${s}.${e}` : `${s}.${e}`, m = await crypto.subtle.importKey("raw", f, {
			name: "HMAC",
			hash: "SHA-256"
		}, !1, ["verify"]);
		for (let e of d) try {
			let t = Buffer.from(e, "base64");
			if (await crypto.subtle.verify("HMAC", m, t, new TextEncoder().encode(p))) return;
		} catch {
			continue;
		}
		throw new b("The given webhook signature does not match the expected signature");
	}
};
wi = /* @__PURE__ */ new WeakSet(), Ti = function(e) {
	if (typeof e != "string" || e.length === 0) throw Error("The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function");
}, Ei = function(e, t) {
	if (!e) throw Error("Headers are required");
	let n = e.get(t);
	if (n == null) throw Error(`Missing required header: ${t}`);
	return n;
};
//#endregion
//#region node_modules/openai/client.mjs
var Oi, ki, Ai, ji, $ = class {
	constructor({ baseURL: t = U("OPENAI_BASE_URL"), apiKey: n = U("OPENAI_API_KEY"), organization: r = U("OPENAI_ORG_ID") ?? null, project: i = U("OPENAI_PROJECT_ID") ?? null, webhookSecret: o = U("OPENAI_WEBHOOK_SECRET") ?? null, ...s } = {}) {
		if (Oi.add(this), Ai.set(this, void 0), this.completions = new xr(this), this.chat = new Ln(this), this.embeddings = new Dr(this), this.files = new jr(this), this.images = new Vr(this), this.audio = new Un(this), this.moderations = new Ur(this), this.models = new Hr(this), this.fineTuning = new Z(this), this.graders = new Br(this), this.vectorStores = new Si(this), this.webhooks = new Di(this), this.beta = new br(this), this.batches = new Wn(this), this.uploads = new vi(this), this.responses = new fi(this), this.realtime = new Kr(this), this.conversations = new Er(this), this.evals = new Ar(this), this.containers = new wr(this), this.skills = new gi(this), this.videos = new Ci(this), n === void 0) throw new a("Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.");
		let c = {
			apiKey: n,
			organization: r,
			project: i,
			webhookSecret: o,
			...s,
			baseURL: t || "https://api.openai.com/v1"
		};
		if (!c.dangerouslyAllowBrowser && ce()) throw new a("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n");
		this.baseURL = c.baseURL, this.timeout = c.timeout ?? ki.DEFAULT_TIMEOUT, this.logger = c.logger ?? console;
		let l = "warn";
		this.logLevel = l, this.logLevel = Je(c.logLevel, "ClientOptions.logLevel", this) ?? Je(U("OPENAI_LOG"), "process.env['OPENAI_LOG']", this) ?? l, this.fetchOptions = c.fetchOptions, this.maxRetries = c.maxRetries ?? 2, this.fetch = c.fetch ?? ge(), e(this, Ai, xe, "f"), this._options = c, this.apiKey = typeof n == "string" ? n : "Missing Key", this.organization = r, this.project = i, this.webhookSecret = o;
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
			organization: this.organization,
			project: this.project,
			webhookSecret: this.webhookSecret,
			...e
		});
	}
	defaultQuery() {
		return this._options.defaultQuery;
	}
	validateHeaders({ values: e, nulls: t }) {}
	async authHeaders(e) {
		return H([{ Authorization: `Bearer ${this.apiKey}` }]);
	}
	stringifyQuery(e) {
		return Re(e);
	}
	getUserAgent() {
		return `${this.constructor.name}/JS ${w}`;
	}
	defaultIdempotencyKey() {
		return `stainless-node-retry-${n()}`;
	}
	makeStatusError(e, t, n, r) {
		return o.generate(e, t, n, r);
	}
	async _callApiKey() {
		let e = this._options.apiKey;
		if (typeof e != "function") return !1;
		let t;
		try {
			t = await e();
		} catch (e) {
			throw e instanceof a ? e : new a(`Failed to get token from 'apiKey' function: ${e.message}`, { cause: e });
		}
		if (typeof t != "string" || !t) throw new a(`Expected 'apiKey' function argument to return a string but it returned ${t}`);
		return this.apiKey = t, !0;
	}
	buildURL(e, n, r) {
		let i = !t(this, Oi, "m", ji).call(this) && r || this.baseURL, a = te(e) ? new URL(e) : new URL(i + (i.endsWith("/") && e.startsWith("/") ? e.slice(1) : e)), o = this.defaultQuery();
		return ne(o) || (n = {
			...o,
			...n
		}), typeof n == "object" && n && !Array.isArray(n) && (a.search = this.stringifyQuery(n)), a.toString();
	}
	async prepareOptions(e) {
		await this._callApiKey();
	}
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
		return new ct(this, this.makeRequest(e, t, void 0));
	}
	async makeRequest(e, t, n) {
		let a = await e, o = a.maxRetries ?? this.maxRetries;
		t ??= o, await this.prepareOptions(a);
		let { req: u, url: d, timeout: f } = await this.buildRequest(a, { retryCount: o - t });
		await this.prepareRequest(u, {
			url: d,
			options: a
		});
		let p = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0"), m = n === void 0 ? "" : `, retryOf: ${n}`, h = Date.now();
		if (k(this).debug(`[${p}] sending request`, A({
			retryOfRequestLogID: n,
			method: a.method,
			url: d,
			options: a,
			headers: u.headers
		})), a.signal?.aborted) throw new s();
		let g = new AbortController(), _ = await this.fetchWithTimeout(d, u, f, g).catch(i), v = Date.now();
		if (_ instanceof globalThis.Error) {
			let e = `retrying, ${t} attempts remaining`;
			if (a.signal?.aborted) throw new s();
			let i = r(_) || /timed? ?out/i.test(String(_) + ("cause" in _ ? String(_.cause) : ""));
			if (t) return k(this).info(`[${p}] connection ${i ? "timed out" : "failed"} - ${e}`), k(this).debug(`[${p}] connection ${i ? "timed out" : "failed"} (${e})`, A({
				retryOfRequestLogID: n,
				url: d,
				durationMs: v - h,
				message: _.message
			})), this.retryRequest(a, t, n ?? p);
			throw k(this).info(`[${p}] connection ${i ? "timed out" : "failed"} - error; no more retries left`), k(this).debug(`[${p}] connection ${i ? "timed out" : "failed"} (error; no more retries left)`, A({
				retryOfRequestLogID: n,
				url: d,
				durationMs: v - h,
				message: _.message
			})), i ? new l() : new c({ cause: _ });
		}
		let y = `[${p}${m}${[..._.headers.entries()].filter(([e]) => e === "x-request-id").map(([e, t]) => ", " + e + ": " + JSON.stringify(t)).join("")}] ${u.method} ${d} ${_.ok ? "succeeded" : "failed"} with status ${_.status} in ${v - h}ms`;
		if (!_.ok) {
			let e = await this.shouldRetry(_);
			if (t && e) {
				let e = `retrying, ${t} attempts remaining`;
				return await be(_.body), k(this).info(`${y} - ${e}`), k(this).debug(`[${p}] response error (${e})`, A({
					retryOfRequestLogID: n,
					url: _.url,
					status: _.status,
					headers: _.headers,
					durationMs: v - h
				})), this.retryRequest(a, t, n ?? p, _.headers);
			}
			let r = e ? "error; no more retries left" : "error; not retryable";
			k(this).info(`${y} - ${r}`);
			let o = await _.text().catch((e) => i(e).message), s = oe(o), c = s ? void 0 : o;
			throw k(this).debug(`[${p}] response error (${r})`, A({
				retryOfRequestLogID: n,
				url: _.url,
				status: _.status,
				headers: _.headers,
				message: c,
				durationMs: Date.now() - h
			})), this.makeStatusError(_.status, s, c, _.headers);
		}
		return k(this).info(y), k(this).debug(`[${p}] response start`, A({
			retryOfRequestLogID: n,
			url: _.url,
			status: _.status,
			headers: _.headers,
			durationMs: v - h
		})), {
			response: _,
			options: a,
			controller: g,
			requestLogID: p,
			retryOfRequestLogID: n,
			startTime: h
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
		return new dt(this, n, e);
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
		return await se(i), this.makeRequest(e, t - 1, n);
	}
	calculateDefaultRetryTimeoutMillis(e, t) {
		let n = t - e;
		return Math.min(.5 * 2 ** n, 8) * (1 - Math.random() * .25) * 1e3;
	}
	async buildRequest(e, { retryCount: t = 0 } = {}) {
		let n = { ...e }, { method: r, path: i, query: a, defaultBaseURL: o } = n, s = this.buildURL(i, a, o);
		"timeout" in n && ae("timeout", n.timeout), n.timeout = n.timeout ?? this.timeout;
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
		let a = H([
			i,
			{
				Accept: "application/json",
				"User-Agent": this.getUserAgent(),
				"X-Stainless-Retry-Count": String(r),
				...e.timeout ? { "X-Stainless-Timeout": String(Math.trunc(e.timeout / 1e3)) } : {},
				...he(),
				"OpenAI-Organization": this.organization,
				"OpenAI-Project": this.project
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
	buildBody({ options: { body: e, headers: n } }) {
		if (!e) return {
			bodyHeaders: void 0,
			body: void 0
		};
		let r = H([n]);
		return ArrayBuffer.isView(e) || e instanceof ArrayBuffer || e instanceof DataView || typeof e == "string" && r.values.has("content-type") || globalThis.Blob && e instanceof globalThis.Blob || e instanceof FormData || e instanceof URLSearchParams || globalThis.ReadableStream && e instanceof globalThis.ReadableStream ? {
			bodyHeaders: void 0,
			body: e
		} : typeof e == "object" && (Symbol.asyncIterator in e || Symbol.iterator in e && "next" in e && typeof e.next == "function") ? {
			bodyHeaders: void 0,
			body: ve(e)
		} : typeof e == "object" && r.values.get("content-type") === "application/x-www-form-urlencoded" ? {
			bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
			body: this.stringifyQuery(e)
		} : t(this, Ai, "f").call(this, {
			body: e,
			headers: r
		});
	}
};
ki = $, Ai = /* @__PURE__ */ new WeakMap(), Oi = /* @__PURE__ */ new WeakSet(), ji = function() {
	return this.baseURL !== "https://api.openai.com/v1";
}, $.OpenAI = ki, $.DEFAULT_TIMEOUT = 6e5, $.OpenAIError = a, $.APIError = o, $.APIConnectionError = c, $.APIConnectionTimeoutError = l, $.APIUserAbortError = s, $.NotFoundError = p, $.ConflictError = m, $.RateLimitError = g, $.BadRequestError = u, $.AuthenticationError = d, $.InternalServerError = _, $.PermissionDeniedError = f, $.UnprocessableEntityError = h, $.InvalidWebhookSignatureError = b, $.toFile = kt, $.Completions = xr, $.Chat = Ln, $.Embeddings = Dr, $.Files = jr, $.Images = Vr, $.Audio = Un, $.Moderations = Ur, $.Models = Hr, $.FineTuning = Z, $.Graders = Br, $.VectorStores = Si, $.Webhooks = Di, $.Beta = br, $.Batches = Wn, $.Uploads = vi, $.Responses = fi, $.Realtime = Kr, $.Conversations = Er, $.Evals = Ar, $.Containers = wr, $.Skills = gi, $.Videos = Ci;
//#endregion
//#region node_modules/openai/azure.mjs
var Mi = class extends $ {
	constructor({ baseURL: e = U("OPENAI_BASE_URL"), apiKey: t = U("AZURE_OPENAI_API_KEY"), apiVersion: n = U("OPENAI_API_VERSION"), endpoint: r, deployment: i, azureADTokenProvider: o, dangerouslyAllowBrowser: s, ...c } = {}) {
		if (!n) throw new a("The OPENAI_API_VERSION environment variable is missing or empty; either provide it, or instantiate the AzureOpenAI client with an apiVersion option, like new AzureOpenAI({ apiVersion: 'My API Version' }).");
		if (typeof o == "function" && (s = !0), !o && !t) throw new a("Missing credentials. Please pass one of `apiKey` and `azureADTokenProvider`, or set the `AZURE_OPENAI_API_KEY` environment variable.");
		if (o && t) throw new a("The `apiKey` and `azureADTokenProvider` arguments are mutually exclusive; only one can be passed at a time.");
		if (c.defaultQuery = {
			...c.defaultQuery,
			"api-version": n
		}, !e) {
			if (r ||= process.env.AZURE_OPENAI_ENDPOINT, !r) throw new a("Must provide one of the `baseURL` or `endpoint` arguments, or the `AZURE_OPENAI_ENDPOINT` environment variable");
			e = `${r}/openai`;
		} else if (r) throw new a("baseURL and endpoint are mutually exclusive");
		super({
			apiKey: o ?? t,
			baseURL: e,
			...c,
			...s === void 0 ? {} : { dangerouslyAllowBrowser: s }
		}), this.apiVersion = "", this.apiVersion = n, this.deploymentName = i;
	}
	async buildRequest(e, t = {}) {
		if (Ni.has(e.path) && e.method === "post" && e.body !== void 0) {
			if (!ie(e.body)) throw Error("Expected request body to be an object");
			let t = this.deploymentName || e.body.model || e.__metadata?.model;
			t !== void 0 && !this.baseURL.includes("/deployments") && (e.path = `/deployments/${t}${e.path}`);
		}
		return super.buildRequest(e, t);
	}
	async authHeaders(e) {
		return typeof this._options.apiKey == "string" ? H([{ "api-key": this.apiKey }]) : super.authHeaders(e);
	}
}, Ni = /* @__PURE__ */ new Set([
	"/completions",
	"/chat/completions",
	"/embeddings",
	"/audio/transcriptions",
	"/audio/translations",
	"/audio/speech",
	"/images/generations",
	"/batches",
	"/images/edits"
]);
//#endregion
export { $ as n, Mi as t };
