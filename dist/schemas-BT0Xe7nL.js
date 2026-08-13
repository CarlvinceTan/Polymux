//#region node_modules/zod/v4/core/core.js
var e, t = /*@__PURE__*/ Object.freeze({ status: "aborted" });
function n(e, t, n) {
	function r(n, r) {
		if (n._zod || Object.defineProperty(n, "_zod", {
			value: {
				def: r,
				constr: o,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: !1
		}), n._zod.traits.has(e)) return;
		n._zod.traits.add(e), t(n, r);
		let i = o.prototype, a = Object.keys(i);
		for (let e = 0; e < a.length; e++) {
			let t = a[e];
			t in n || (n[t] = i[t].bind(n));
		}
	}
	let i = n?.Parent ?? Object;
	class a extends i {}
	Object.defineProperty(a, "name", { value: e });
	function o(e) {
		var t;
		let i = n?.Parent ? new a() : this;
		r(i, e), (t = i._zod).deferred ?? (t.deferred = []);
		for (let e of i._zod.deferred) e();
		return i;
	}
	return Object.defineProperty(o, "init", { value: r }), Object.defineProperty(o, Symbol.hasInstance, { value: (t) => n?.Parent && t instanceof n.Parent ? !0 : t?._zod?.traits?.has(e) }), Object.defineProperty(o, "name", { value: e }), o;
}
var r = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, i = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(e = globalThis).__zod_globalConfig ?? (e.__zod_globalConfig = {});
var a = globalThis.__zod_globalConfig;
function o(e) {
	return e && Object.assign(a, e), a;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function s(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function c(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
function l(e) {
	return { get value() {
		{
			let t = e();
			return Object.defineProperty(this, "value", { value: t }), t;
		}
	} };
}
function u(e) {
	return e == null;
}
function d(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function f(e, t) {
	let n = e / t, r = Math.round(n), i = 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
var p = /* @__PURE__*/ Symbol("evaluating");
function m(e, t, n) {
	let r;
	Object.defineProperty(e, t, {
		get() {
			if (r !== p) return r === void 0 && (r = p, r = n()), r;
		},
		set(n) {
			Object.defineProperty(e, t, { value: n });
		},
		configurable: !0
	});
}
function h(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function g(...e) {
	let t = {};
	for (let n of e) {
		let e = Object.getOwnPropertyDescriptors(n);
		Object.assign(t, e);
	}
	return Object.defineProperties({}, t);
}
function ee(e) {
	return JSON.stringify(e);
}
function te(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var ne = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function _(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var re = /* @__PURE__*/ l(() => {
	if (a.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function v(e) {
	if (_(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return _(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function ie(e) {
	return v(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var ae = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function y(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function b(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function x(e) {
	let t = e;
	if (!t) return {};
	if (typeof t == "string") return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
		t.error = t.message;
	}
	return delete t.message, typeof t.error == "string" ? {
		...t,
		error: () => t.error
	} : t;
}
function oe(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
var se = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function ce(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	return b(e, g(e._zod.def, {
		get shape() {
			let e = {};
			for (let r in t) {
				if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`);
				t[r] && (e[r] = n.shape[r]);
			}
			return h(this, "shape", e), e;
		},
		checks: []
	}));
}
function le(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	return b(e, g(e._zod.def, {
		get shape() {
			let r = { ...e._zod.def.shape };
			for (let e in t) {
				if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`);
				t[e] && delete r[e];
			}
			return h(this, "shape", r), r;
		},
		checks: []
	}));
}
function ue(e, t) {
	if (!v(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = e._zod.def.shape;
		for (let e in t) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return b(e, g(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return h(this, "shape", n), n;
	} }));
}
function de(e, t) {
	if (!v(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return b(e, g(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return h(this, "shape", n), n;
	} }));
}
function fe(e, t) {
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return b(e, g(e._zod.def, {
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t._zod.def.shape
			};
			return h(this, "shape", n), n;
		},
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function pe(e, t, n) {
	let r = t._zod.def.checks;
	if (r && r.length > 0) throw Error(".partial() cannot be used on object schemas containing refinements");
	return b(t, g(t._zod.def, {
		get shape() {
			let r = t._zod.def.shape, i = { ...r };
			if (n) for (let t in n) {
				if (!(t in r)) throw Error(`Unrecognized key: "${t}"`);
				n[t] && (i[t] = e ? new e({
					type: "optional",
					innerType: r[t]
				}) : r[t]);
			}
			else for (let t in r) i[t] = e ? new e({
				type: "optional",
				innerType: r[t]
			}) : r[t];
			return h(this, "shape", i), i;
		},
		checks: []
	}));
}
function me(e, t, n) {
	return b(t, g(t._zod.def, { get shape() {
		let r = t._zod.def.shape, i = { ...r };
		if (n) for (let t in n) {
			if (!(t in i)) throw Error(`Unrecognized key: "${t}"`);
			n[t] && (i[t] = new e({
				type: "nonoptional",
				innerType: r[t]
			}));
		}
		else for (let t in r) i[t] = new e({
			type: "nonoptional",
			innerType: r[t]
		});
		return h(this, "shape", i), i;
	} }));
}
function S(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function he(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function C(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function w(e) {
	return typeof e == "string" ? e : e?.message;
}
function T(e, t, n) {
	let r = e.message ? e.message : w(e.inst?._zod.def?.error?.(e)) ?? w(t?.error?.(e)) ?? w(n.customError?.(e)) ?? w(n.localeError?.(e)) ?? "Invalid input", { inst: i, continue: a, input: o, ...s } = e;
	return s.path ??= [], s.message = r, t?.reportInput && (s.input = o), s;
}
function ge(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function E(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
//#endregion
//#region node_modules/zod/v4/core/errors.js
var _e = (e, t) => {
	e.name = "$ZodError", Object.defineProperty(e, "_zod", {
		value: e._zod,
		enumerable: !1
	}), Object.defineProperty(e, "issues", {
		value: t,
		enumerable: !1
	}), e.message = JSON.stringify(t, c, 2), Object.defineProperty(e, "toString", {
		value: () => e.message,
		enumerable: !1
	});
}, ve = n("$ZodError", _e), ye = n("$ZodError", _e, { Parent: Error });
function be(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? (n[i.path[0]] = n[i.path[0]] || [], n[i.path[0]].push(t(i))) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function xe(e, t = (e) => e.message) {
	let n = { _errors: [] }, r = (e, i = []) => {
		for (let a of e.issues) if (a.code === "invalid_union" && a.errors.length) a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
		else if (a.code === "invalid_key") r({ issues: a.issues }, [...i, ...a.path]);
		else if (a.code === "invalid_element") r({ issues: a.issues }, [...i, ...a.path]);
		else {
			let e = [...i, ...a.path];
			if (e.length === 0) n._errors.push(t(a));
			else {
				let r = n, i = 0;
				for (; i < e.length;) {
					let n = e[i];
					i === e.length - 1 ? (r[n] = r[n] || { _errors: [] }, r[n]._errors.push(t(a))) : r[n] = r[n] || { _errors: [] }, r = r[n], i++;
				}
			}
		}
	};
	return r(e), n;
}
function Se(e) {
	let t = [], n = e.map((e) => typeof e == "object" ? e.key : e);
	for (let e of n) typeof e == "number" ? t.push(`[${e}]`) : typeof e == "symbol" ? t.push(`[${JSON.stringify(String(e))}]`) : /[^\w$]/.test(e) ? t.push(`[${JSON.stringify(e)}]`) : (t.length && t.push("."), t.push(e));
	return t.join("");
}
function Ce(e) {
	let t = [], n = [...e.issues].sort((e, t) => (e.path ?? []).length - (t.path ?? []).length);
	for (let e of n) t.push(`✖ ${e.message}`), e.path?.length && t.push(`  → at ${Se(e.path)}`);
	return t.join("\n");
}
//#endregion
//#region node_modules/zod/v4/core/parse.js
var we = (e) => (t, n, i, a) => {
	let s = i ? {
		...i,
		async: !1
	} : { async: !1 }, c = t._zod.run({
		value: n,
		issues: []
	}, s);
	if (c instanceof Promise) throw new r();
	if (c.issues.length) {
		let t = new ((a?.Err) ?? e)(c.issues.map((e) => T(e, s, o())));
		throw ne(t, a?.callee), t;
	}
	return c.value;
}, Te = (e) => async (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !0
	} : { async: !0 }, s = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (s instanceof Promise && (s = await s), s.issues.length) {
		let t = new ((i?.Err) ?? e)(s.issues.map((e) => T(e, a, o())));
		throw ne(t, i?.callee), t;
	}
	return s.value;
}, D = (e) => (t, n, i) => {
	let a = i ? {
		...i,
		async: !1
	} : { async: !1 }, s = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (s instanceof Promise) throw new r();
	return s.issues.length ? {
		success: !1,
		error: new (e ?? ve)(s.issues.map((e) => T(e, a, o())))
	} : {
		success: !0,
		data: s.value
	};
}, Ee = /* @__PURE__*/ D(ye), O = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? {
		success: !1,
		error: new e(a.issues.map((e) => T(e, i, o())))
	} : {
		success: !0,
		data: a.value
	};
}, De = /* @__PURE__*/ O(ye), Oe = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return we(e)(t, n, i);
}, ke = (e) => (t, n, r) => we(e)(t, n, r), Ae = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Te(e)(t, n, i);
}, je = (e) => async (t, n, r) => Te(e)(t, n, r), Me = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return D(e)(t, n, i);
}, Ne = (e) => (t, n, r) => D(e)(t, n, r), Pe = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return O(e)(t, n, i);
}, Fe = (e) => async (t, n, r) => O(e)(t, n, r), Ie = /^[cC][0-9a-z]{6,}$/, Le = /^[0-9a-z]+$/, Re = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, ze = /^[0-9a-vA-V]{20}$/, Be = /^[A-Za-z0-9]{27}$/, Ve = /^[a-zA-Z0-9_-]{21}$/, He = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Ue = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, We = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Ge = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, Ke = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function qe() {
	return new RegExp(Ke, "u");
}
var Je = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Ye = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, Xe = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, Ze = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, Qe = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, $e = /^[A-Za-z0-9_-]*$/, et = /^https?$/, tt = /^\+[1-9]\d{6,14}$/, nt = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", rt = /*@__PURE__*/ RegExp(`^${nt}$`);
function it(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function at(e) {
	return RegExp(`^${it(e)}$`);
}
function ot(e) {
	let t = it({ precision: e.precision }), n = ["Z"];
	e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let r = `${t}(?:${n.join("|")})`;
	return RegExp(`^${nt}T(?:${r})$`);
}
var st = (e) => {
	let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
	return RegExp(`^${t}$`);
}, ct = /^-?\d+$/, lt = /^-?\d+(?:\.\d+)?$/, ut = /^(?:true|false)$/i, dt = /^null$/i, ft = /^[^A-Z]*$/, pt = /^[^a-z]*$/, k = /*@__PURE__*/ n("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), mt = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, ht = /*@__PURE__*/ n("$ZodCheckLessThan", (e, t) => {
	k.init(e, t);
	let n = mt[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.maximum : n.exclusiveMaximum) ?? Infinity;
		t.value < r && (t.inclusive ? n.maximum = t.value : n.exclusiveMaximum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), gt = /*@__PURE__*/ n("$ZodCheckGreaterThan", (e, t) => {
	k.init(e, t);
	let n = mt[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.minimum : n.exclusiveMinimum) ?? -Infinity;
		t.value > r && (t.inclusive ? n.minimum = t.value : n.exclusiveMinimum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), _t = /*@__PURE__*/ n("$ZodCheckMultipleOf", (e, t) => {
	k.init(e, t), e._zod.onattach.push((e) => {
		var n;
		(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value);
	}), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : f(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), vt = /*@__PURE__*/ n("$ZodCheckNumberFormat", (e, t) => {
	k.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = se[t.format];
	e._zod.onattach.push((e) => {
		let r = e._zod.bag;
		r.format = t.format, r.minimum = i, r.maximum = a, n && (r.pattern = ct);
	}), e._zod.check = (o) => {
		let s = o.value;
		if (n) {
			if (!Number.isInteger(s)) {
				o.issues.push({
					expected: r,
					format: t.format,
					code: "invalid_type",
					continue: !1,
					input: s,
					inst: e
				});
				return;
			}
			if (!Number.isSafeInteger(s)) {
				s > 0 ? o.issues.push({
					input: s,
					code: "too_big",
					maximum: 2 ** 53 - 1,
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				}) : o.issues.push({
					input: s,
					code: "too_small",
					minimum: -(2 ** 53 - 1),
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				});
				return;
			}
		}
		s < i && o.issues.push({
			origin: "number",
			input: s,
			code: "too_small",
			minimum: i,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		}), s > a && o.issues.push({
			origin: "number",
			input: s,
			code: "too_big",
			maximum: a,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		});
	};
}), yt = /*@__PURE__*/ n("$ZodCheckMaxLength", (e, t) => {
	var n;
	k.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !u(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.maximum ?? Infinity;
		t.maximum < n && (e._zod.bag.maximum = t.maximum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length <= t.maximum) return;
		let i = ge(r);
		n.issues.push({
			origin: i,
			code: "too_big",
			maximum: t.maximum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), bt = /*@__PURE__*/ n("$ZodCheckMinLength", (e, t) => {
	var n;
	k.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !u(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.minimum ?? -Infinity;
		t.minimum > n && (e._zod.bag.minimum = t.minimum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length >= t.minimum) return;
		let i = ge(r);
		n.issues.push({
			origin: i,
			code: "too_small",
			minimum: t.minimum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), xt = /*@__PURE__*/ n("$ZodCheckLengthEquals", (e, t) => {
	var n;
	k.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !u(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.minimum = t.length, n.maximum = t.length, n.length = t.length;
	}), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if (i === t.length) return;
		let a = ge(r), o = i > t.length;
		n.issues.push({
			origin: a,
			...o ? {
				code: "too_big",
				maximum: t.length
			} : {
				code: "too_small",
				minimum: t.length
			},
			inclusive: !0,
			exact: !0,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), A = /*@__PURE__*/ n("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	k.init(e, t), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.format = t.format, t.pattern && (n.patterns ??= /* @__PURE__ */ new Set(), n.patterns.add(t.pattern));
	}), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: t.format,
			input: n.value,
			...t.pattern ? { pattern: t.pattern.toString() } : {},
			inst: e,
			continue: !t.abort
		});
	}) : (r = e._zod).check ?? (r.check = () => {});
}), St = /*@__PURE__*/ n("$ZodCheckRegex", (e, t) => {
	A.init(e, t), e._zod.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: n.value,
			pattern: t.pattern.toString(),
			inst: e,
			continue: !t.abort
		});
	};
}), Ct = /*@__PURE__*/ n("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= ft, A.init(e, t);
}), wt = /*@__PURE__*/ n("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= pt, A.init(e, t);
}), Tt = /*@__PURE__*/ n("$ZodCheckIncludes", (e, t) => {
	k.init(e, t);
	let n = y(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
	t.pattern = r, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(r);
	}), e._zod.check = (n) => {
		n.value.includes(t.includes, t.position) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: t.includes,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Et = /*@__PURE__*/ n("$ZodCheckStartsWith", (e, t) => {
	k.init(e, t);
	let n = RegExp(`^${y(t.prefix)}.*`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.startsWith(t.prefix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: t.prefix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Dt = /*@__PURE__*/ n("$ZodCheckEndsWith", (e, t) => {
	k.init(e, t);
	let n = RegExp(`.*${y(t.suffix)}$`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.endsWith(t.suffix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: t.suffix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Ot = /*@__PURE__*/ n("$ZodCheckOverwrite", (e, t) => {
	k.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), kt = class {
	constructor(e = []) {
		this.content = [], this.indent = 0, this && (this.args = e);
	}
	indented(e) {
		this.indent += 1, e(this), --this.indent;
	}
	write(e) {
		if (typeof e == "function") {
			e(this, { execution: "sync" }), e(this, { execution: "async" });
			return;
		}
		let t = e.split("\n").filter((e) => e), n = Math.min(...t.map((e) => e.length - e.trimStart().length)), r = t.map((e) => e.slice(n)).map((e) => " ".repeat(this.indent * 2) + e);
		for (let e of r) this.content.push(e);
	}
	compile() {
		let e = Function, t = this?.args, n = [...(this?.content ?? [""]).map((e) => `  ${e}`)];
		return new e(...t, n.join("\n"));
	}
}, At = {
	major: 4,
	minor: 4,
	patch: 3
}, j = /*@__PURE__*/ n("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = At;
	let i = [...e._zod.def.checks ?? []];
	e._zod.traits.has("$ZodCheck") && i.unshift(e);
	for (let t of i) for (let n of t._zod.onattach) n(e);
	if (i.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (e, t, n) => {
			let i = S(e), a;
			for (let o of t) {
				if (o._zod.def.when) {
					if (he(e) || !o._zod.def.when(e)) continue;
				} else if (i) continue;
				let t = e.issues.length, s = o._zod.check(e);
				if (s instanceof Promise && n?.async === !1) throw new r();
				if (a || s instanceof Promise) a = (a ?? Promise.resolve()).then(async () => {
					await s, e.issues.length !== t && (i ||= S(e, t));
				});
				else {
					if (e.issues.length === t) continue;
					i ||= S(e, t);
				}
			}
			return a ? a.then(() => e) : e;
		}, n = (n, a, o) => {
			if (S(n)) return n.aborted = !0, n;
			let s = t(a, i, o);
			if (s instanceof Promise) {
				if (o.async === !1) throw new r();
				return s.then((t) => e._zod.parse(t, o));
			}
			return e._zod.parse(s, o);
		};
		e._zod.run = (a, o) => {
			if (o.skipChecks) return e._zod.parse(a, o);
			if (o.direction === "backward") {
				let t = e._zod.parse({
					value: a.value,
					issues: []
				}, {
					...o,
					skipChecks: !0
				});
				return t instanceof Promise ? t.then((e) => n(e, a, o)) : n(t, a, o);
			}
			let s = e._zod.parse(a, o);
			if (s instanceof Promise) {
				if (o.async === !1) throw new r();
				return s.then((e) => t(e, i, o));
			}
			return t(s, i, o);
		};
	}
	m(e, "~standard", () => ({
		validate: (t) => {
			try {
				let n = Ee(e, t);
				return n.success ? { value: n.data } : { issues: n.error?.issues };
			} catch {
				return De(e, t).then((e) => e.success ? { value: e.data } : { issues: e.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
}), jt = /*@__PURE__*/ n("$ZodString", (e, t) => {
	j.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? st(e._zod.bag), e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = String(n.value);
		} catch {}
		return typeof n.value == "string" || n.issues.push({
			expected: "string",
			code: "invalid_type",
			input: n.value,
			inst: e
		}), n;
	};
}), M = /*@__PURE__*/ n("$ZodStringFormat", (e, t) => {
	A.init(e, t), jt.init(e, t);
}), Mt = /*@__PURE__*/ n("$ZodGUID", (e, t) => {
	t.pattern ??= Ue, M.init(e, t);
}), Nt = /*@__PURE__*/ n("$ZodUUID", (e, t) => {
	if (t.version) {
		let e = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[t.version];
		if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
		t.pattern ??= We(e);
	} else t.pattern ??= We();
	M.init(e, t);
}), Pt = /*@__PURE__*/ n("$ZodEmail", (e, t) => {
	t.pattern ??= Ge, M.init(e, t);
}), Ft = /*@__PURE__*/ n("$ZodURL", (e, t) => {
	M.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim();
			if (!t.normalize && t.protocol?.source === et.source && !/^https?:\/\//i.test(r)) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			let i = new URL(r);
			t.hostname && (t.hostname.lastIndex = 0, t.hostname.test(i.hostname) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), t.protocol && (t.protocol.lastIndex = 0, t.protocol.test(i.protocol.endsWith(":") ? i.protocol.slice(0, -1) : i.protocol) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), n.value = t.normalize ? i.href : r;
			return;
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "url",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), It = /*@__PURE__*/ n("$ZodEmoji", (e, t) => {
	t.pattern ??= qe(), M.init(e, t);
}), Lt = /*@__PURE__*/ n("$ZodNanoID", (e, t) => {
	t.pattern ??= Ve, M.init(e, t);
}), Rt = /*@__PURE__*/ n("$ZodCUID", (e, t) => {
	t.pattern ??= Ie, M.init(e, t);
}), zt = /*@__PURE__*/ n("$ZodCUID2", (e, t) => {
	t.pattern ??= Le, M.init(e, t);
}), Bt = /*@__PURE__*/ n("$ZodULID", (e, t) => {
	t.pattern ??= Re, M.init(e, t);
}), Vt = /*@__PURE__*/ n("$ZodXID", (e, t) => {
	t.pattern ??= ze, M.init(e, t);
}), Ht = /*@__PURE__*/ n("$ZodKSUID", (e, t) => {
	t.pattern ??= Be, M.init(e, t);
}), Ut = /*@__PURE__*/ n("$ZodISODateTime", (e, t) => {
	t.pattern ??= ot(t), M.init(e, t);
}), Wt = /*@__PURE__*/ n("$ZodISODate", (e, t) => {
	t.pattern ??= rt, M.init(e, t);
}), Gt = /*@__PURE__*/ n("$ZodISOTime", (e, t) => {
	t.pattern ??= at(t), M.init(e, t);
}), Kt = /*@__PURE__*/ n("$ZodISODuration", (e, t) => {
	t.pattern ??= He, M.init(e, t);
}), qt = /*@__PURE__*/ n("$ZodIPv4", (e, t) => {
	t.pattern ??= Je, M.init(e, t), e._zod.bag.format = "ipv4";
}), Jt = /*@__PURE__*/ n("$ZodIPv6", (e, t) => {
	t.pattern ??= Ye, M.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
		try {
			new URL(`http://[${n.value}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), Yt = /*@__PURE__*/ n("$ZodCIDRv4", (e, t) => {
	t.pattern ??= Xe, M.init(e, t);
}), Xt = /*@__PURE__*/ n("$ZodCIDRv6", (e, t) => {
	t.pattern ??= Ze, M.init(e, t), e._zod.check = (n) => {
		let r = n.value.split("/");
		try {
			if (r.length !== 2) throw Error();
			let [e, t] = r;
			if (!t) throw Error();
			let n = Number(t);
			if (`${n}` !== t || n < 0 || n > 128) throw Error();
			new URL(`http://[${e}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
});
function Zt(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Qt = /*@__PURE__*/ n("$ZodBase64", (e, t) => {
	t.pattern ??= Qe, M.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
		Zt(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function $t(e) {
	if (!$e.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return Zt(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var en = /*@__PURE__*/ n("$ZodBase64URL", (e, t) => {
	t.pattern ??= $e, M.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
		$t(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), tn = /*@__PURE__*/ n("$ZodE164", (e, t) => {
	t.pattern ??= tt, M.init(e, t);
});
function nn(e, t = null) {
	try {
		let n = e.split(".");
		if (n.length !== 3) return !1;
		let [r] = n;
		if (!r) return !1;
		let i = JSON.parse(atob(r));
		return !("typ" in i && i?.typ !== "JWT" || !i.alg || t && (!("alg" in i) || i.alg !== t));
	} catch {
		return !1;
	}
}
var rn = /*@__PURE__*/ n("$ZodJWT", (e, t) => {
	M.init(e, t), e._zod.check = (n) => {
		nn(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), an = /*@__PURE__*/ n("$ZodNumber", (e, t) => {
	j.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? lt, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = Number(n.value);
		} catch {}
		let i = n.value;
		if (typeof i == "number" && !Number.isNaN(i) && Number.isFinite(i)) return n;
		let a = typeof i == "number" ? Number.isNaN(i) ? "NaN" : Number.isFinite(i) ? void 0 : "Infinity" : void 0;
		return n.issues.push({
			expected: "number",
			code: "invalid_type",
			input: i,
			inst: e,
			...a ? { received: a } : {}
		}), n;
	};
}), on = /*@__PURE__*/ n("$ZodNumberFormat", (e, t) => {
	vt.init(e, t), an.init(e, t);
}), sn = /*@__PURE__*/ n("$ZodBoolean", (e, t) => {
	j.init(e, t), e._zod.pattern = ut, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = !!n.value;
		} catch {}
		let i = n.value;
		return typeof i == "boolean" || n.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
	};
}), cn = /*@__PURE__*/ n("$ZodNull", (e, t) => {
	j.init(e, t), e._zod.pattern = dt, e._zod.values = /* @__PURE__ */ new Set([null]), e._zod.parse = (t, n) => {
		let r = t.value;
		return r === null || t.issues.push({
			expected: "null",
			code: "invalid_type",
			input: r,
			inst: e
		}), t;
	};
}), ln = /*@__PURE__*/ n("$ZodAny", (e, t) => {
	j.init(e, t), e._zod.parse = (e) => e;
}), un = /*@__PURE__*/ n("$ZodUnknown", (e, t) => {
	j.init(e, t), e._zod.parse = (e) => e;
}), dn = /*@__PURE__*/ n("$ZodNever", (e, t) => {
	j.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
}), fn = /*@__PURE__*/ n("$ZodVoid", (e, t) => {
	j.init(e, t), e._zod.parse = (t, n) => {
		let r = t.value;
		return r === void 0 || t.issues.push({
			expected: "void",
			code: "invalid_type",
			input: r,
			inst: e
		}), t;
	};
}), pn = /*@__PURE__*/ n("$ZodDate", (e, t) => {
	j.init(e, t), e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = new Date(n.value);
		} catch {}
		let i = n.value, a = i instanceof Date;
		return a && !Number.isNaN(i.getTime()) || n.issues.push({
			expected: "date",
			code: "invalid_type",
			input: i,
			...a ? { received: "Invalid Date" } : {},
			inst: e
		}), n;
	};
});
function mn(e, t, n) {
	e.issues.length && t.issues.push(...C(n, e.issues)), t.value[n] = e.value;
}
var hn = /*@__PURE__*/ n("$ZodArray", (e, t) => {
	j.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!Array.isArray(i)) return n.issues.push({
			expected: "array",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		n.value = Array(i.length);
		let a = [];
		for (let e = 0; e < i.length; e++) {
			let o = i[e], s = t.element._zod.run({
				value: o,
				issues: []
			}, r);
			s instanceof Promise ? a.push(s.then((t) => mn(t, n, e))) : mn(s, n, e);
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
});
function N(e, t, n, r, i, a) {
	let o = n in r;
	if (e.issues.length) {
		if (i && a && !o) return;
		t.issues.push(...C(n, e.issues));
	}
	if (!o && !i) {
		e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		});
		return;
	}
	e.value === void 0 ? o && (t.value[n] = void 0) : t.value[n] = e.value;
}
function gn(e) {
	let t = Object.keys(e.shape);
	for (let n of t) if (!e.shape?.[n]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${n}": expected a Zod schema`);
	let n = oe(e.shape);
	return {
		...e,
		keys: t,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(n)
	};
}
function _n(e, t, n, r, i, a) {
	let o = [], s = i.keySet, c = i.catchall._zod, l = c.def.type, u = c.optin === "optional", d = c.optout === "optional";
	for (let i in t) {
		if (i === "__proto__" || s.has(i)) continue;
		if (l === "never") {
			o.push(i);
			continue;
		}
		let a = c.run({
			value: t[i],
			issues: []
		}, r);
		a instanceof Promise ? e.push(a.then((e) => N(e, n, i, t, u, d))) : N(a, n, i, t, u, d);
	}
	return o.length && n.issues.push({
		code: "unrecognized_keys",
		keys: o,
		input: t,
		inst: a
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var vn = /*@__PURE__*/ n("$ZodObject", (e, t) => {
	if (j.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
		let e = t.shape;
		Object.defineProperty(t, "shape", { get: () => {
			let n = { ...e };
			return Object.defineProperty(t, "shape", { value: n }), n;
		} });
	}
	let n = l(() => gn(t));
	m(e._zod, "propValues", () => {
		let e = t.shape, n = {};
		for (let t in e) {
			let r = e[t]._zod;
			if (r.values) {
				n[t] ?? (n[t] = /* @__PURE__ */ new Set());
				for (let e of r.values) n[t].add(e);
			}
		}
		return n;
	});
	let r = _, i = t.catchall, a;
	e._zod.parse = (t, o) => {
		a ??= n.value;
		let s = t.value;
		if (!r(s)) return t.issues.push({
			expected: "object",
			code: "invalid_type",
			input: s,
			inst: e
		}), t;
		t.value = {};
		let c = [], l = a.shape;
		for (let e of a.keys) {
			let n = l[e], r = n._zod.optin === "optional", i = n._zod.optout === "optional", a = n._zod.run({
				value: s[e],
				issues: []
			}, o);
			a instanceof Promise ? c.push(a.then((n) => N(n, t, e, s, r, i))) : N(a, t, e, s, r, i);
		}
		return i ? _n(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t;
	};
}), yn = /*@__PURE__*/ n("$ZodObjectJIT", (e, t) => {
	vn.init(e, t);
	let n = e._zod.parse, r = l(() => gn(t)), i = (e) => {
		let t = new kt([
			"shape",
			"payload",
			"ctx"
		]), n = r.value, i = (e) => {
			let t = ee(e);
			return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`;
		};
		t.write("const input = payload.value;");
		let a = Object.create(null), o = 0;
		for (let e of n.keys) a[e] = `key_${o++}`;
		t.write("const newResult = {};");
		for (let r of n.keys) {
			let n = a[r], o = ee(r), s = e[r], c = s?._zod?.optin === "optional", l = s?._zod?.optout === "optional";
			t.write(`const ${n} = ${i(r)};`), c && l ? t.write(`
        if (${n}.issues.length) {
          if (${o} in input) {
            payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${o}, ...iss.path] : [${o}]
            })));
          }
        }
        
        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }
        
      `) : c ? t.write(`
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        
        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }
        
      `) : t.write(`
        const ${n}_present = ${o} in input;
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${o}]
          });
        }

        if (${n}_present) {
          if (${n}.value === undefined) {
            newResult[${o}] = undefined;
          } else {
            newResult[${o}] = ${n}.value;
          }
        }

      `);
		}
		t.write("payload.value = newResult;"), t.write("return payload;");
		let s = t.compile();
		return (t, n) => s(e, t, n);
	}, o, s = _, c = !a.jitless, u = c && re.value, d = t.catchall, f;
	e._zod.parse = (a, l) => {
		f ??= r.value;
		let p = a.value;
		return s(p) ? c && u && l?.async === !1 && l.jitless !== !0 ? (o ||= i(t.shape), a = o(a, l), d ? _n([], p, a, l, f, e) : a) : n(a, l) : (a.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), a);
	};
});
function bn(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !S(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => T(e, r, o())))
	}), t);
}
var xn = /*@__PURE__*/ n("$ZodUnion", (e, t) => {
	j.init(e, t), m(e._zod, "optin", () => t.options.some((e) => e._zod.optin === "optional") ? "optional" : void 0), m(e._zod, "optout", () => t.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), m(e._zod, "values", () => {
		if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)));
	}), m(e._zod, "pattern", () => {
		if (t.options.every((e) => e._zod.pattern)) {
			let e = t.options.map((e) => e._zod.pattern);
			return RegExp(`^(${e.map((e) => d(e.source)).join("|")})$`);
		}
	});
	let n = t.options.length === 1 ? t.options[0]._zod.run : null;
	e._zod.parse = (r, i) => {
		if (n) return n(r, i);
		let a = !1, o = [];
		for (let e of t.options) {
			let t = e._zod.run({
				value: r.value,
				issues: []
			}, i);
			if (t instanceof Promise) o.push(t), a = !0;
			else {
				if (t.issues.length === 0) return t;
				o.push(t);
			}
		}
		return a ? Promise.all(o).then((t) => bn(t, r, e, i)) : bn(o, r, e, i);
	};
}), Sn = /*@__PURE__*/ n("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, xn.init(e, t);
	let n = e._zod.parse;
	m(e._zod, "propValues", () => {
		let e = {};
		for (let n of t.options) {
			let r = n._zod.propValues;
			if (!r || Object.keys(r).length === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(n)}"`);
			for (let [t, n] of Object.entries(r)) {
				e[t] || (e[t] = /* @__PURE__ */ new Set());
				for (let r of n) e[t].add(r);
			}
		}
		return e;
	});
	let r = l(() => {
		let e = t.options, n = /* @__PURE__ */ new Map();
		for (let r of e) {
			let e = r._zod.propValues?.[t.discriminator];
			if (!e || e.size === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(r)}"`);
			for (let t of e) {
				if (n.has(t)) throw Error(`Duplicate discriminator value "${String(t)}"`);
				n.set(t, r);
			}
		}
		return n;
	});
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!_(o)) return i.issues.push({
			code: "invalid_type",
			expected: "object",
			input: o,
			inst: e
		}), i;
		let s = r.value.get(o?.[t.discriminator]);
		return s ? s._zod.run(i, a) : t.unionFallback || a.direction === "backward" ? n(i, a) : (i.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: t.discriminator,
			options: Array.from(r.value.keys()),
			input: o,
			path: [t.discriminator],
			inst: e
		}), i);
	};
}), Cn = /*@__PURE__*/ n("$ZodIntersection", (e, t) => {
	j.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => Tn(e, t, n)) : Tn(e, i, a);
	};
});
function wn(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (v(e) && v(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = wn(e[n], t[n]);
			if (!r.valid) return {
				valid: !1,
				mergeErrorPath: [n, ...r.mergeErrorPath]
			};
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return {
			valid: !1,
			mergeErrorPath: []
		};
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = wn(i, a);
			if (!o.valid) return {
				valid: !1,
				mergeErrorPath: [r, ...o.mergeErrorPath]
			};
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return {
		valid: !1,
		mergeErrorPath: []
	};
}
function Tn(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i;
	for (let n of t.issues) if (n.code === "unrecognized_keys") {
		i ??= n;
		for (let e of n.keys) r.has(e) || r.set(e, {}), r.get(e).l = !0;
	} else e.issues.push(n);
	for (let t of n.issues) if (t.code === "unrecognized_keys") for (let e of t.keys) r.has(e) || r.set(e, {}), r.get(e).r = !0;
	else e.issues.push(t);
	let a = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
	if (a.length && i && e.issues.push({
		...i,
		keys: a
	}), S(e)) return e;
	let o = wn(t.value, n.value);
	if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`);
	return e.value = o.data, e;
}
var En = /*@__PURE__*/ n("$ZodRecord", (e, t) => {
	j.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!v(i)) return n.issues.push({
			expected: "record",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		let a = [], s = t.keyType._zod.values;
		if (s) {
			n.value = {};
			let c = /* @__PURE__ */ new Set();
			for (let l of s) if (typeof l == "string" || typeof l == "number" || typeof l == "symbol") {
				c.add(typeof l == "number" ? l.toString() : l);
				let s = t.keyType._zod.run({
					value: l,
					issues: []
				}, r);
				if (s instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (s.issues.length) {
					n.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: s.issues.map((e) => T(e, r, o())),
						input: l,
						path: [l],
						inst: e
					});
					continue;
				}
				let u = s.value, d = t.valueType._zod.run({
					value: i[l],
					issues: []
				}, r);
				d instanceof Promise ? a.push(d.then((e) => {
					e.issues.length && n.issues.push(...C(l, e.issues)), n.value[u] = e.value;
				})) : (d.issues.length && n.issues.push(...C(l, d.issues)), n.value[u] = d.value);
			}
			let l;
			for (let e in i) c.has(e) || (l ??= [], l.push(e));
			l && l.length > 0 && n.issues.push({
				code: "unrecognized_keys",
				input: i,
				inst: e,
				keys: l
			});
		} else {
			n.value = {};
			for (let s of Reflect.ownKeys(i)) {
				if (s === "__proto__" || !Object.prototype.propertyIsEnumerable.call(i, s)) continue;
				let c = t.keyType._zod.run({
					value: s,
					issues: []
				}, r);
				if (c instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (typeof s == "string" && lt.test(s) && c.issues.length) {
					let e = t.keyType._zod.run({
						value: Number(s),
						issues: []
					}, r);
					if (e instanceof Promise) throw Error("Async schemas not supported in object keys currently");
					e.issues.length === 0 && (c = e);
				}
				if (c.issues.length) {
					t.mode === "loose" ? n.value[s] = i[s] : n.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: c.issues.map((e) => T(e, r, o())),
						input: s,
						path: [s],
						inst: e
					});
					continue;
				}
				let l = t.valueType._zod.run({
					value: i[s],
					issues: []
				}, r);
				l instanceof Promise ? a.push(l.then((e) => {
					e.issues.length && n.issues.push(...C(s, e.issues)), n.value[c.value] = e.value;
				})) : (l.issues.length && n.issues.push(...C(s, l.issues)), n.value[c.value] = l.value);
			}
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
}), Dn = /*@__PURE__*/ n("$ZodEnum", (e, t) => {
	j.init(e, t);
	let n = s(t.entries), r = new Set(n);
	e._zod.values = r, e._zod.pattern = RegExp(`^(${n.filter((e) => ae.has(typeof e)).map((e) => typeof e == "string" ? y(e) : e.toString()).join("|")})$`), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), On = /*@__PURE__*/ n("$ZodLiteral", (e, t) => {
	if (j.init(e, t), t.values.length === 0) throw Error("Cannot create literal schema with no valid values");
	let n = new Set(t.values);
	e._zod.values = n, e._zod.pattern = RegExp(`^(${t.values.map((e) => typeof e == "string" ? y(e) : e ? y(e.toString()) : String(e)).join("|")})$`), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), kn = /*@__PURE__*/ n("$ZodTransform", (e, t) => {
	j.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, a) => {
		if (a.direction === "backward") throw new i(e.constructor.name);
		let o = t.transform(n.value, n);
		if (a.async) return (o instanceof Promise ? o : Promise.resolve(o)).then((e) => (n.value = e, n.fallback = !0, n));
		if (o instanceof Promise) throw new r();
		return n.value = o, n.fallback = !0, n;
	};
});
function An(e, t) {
	return t === void 0 && (e.issues.length || e.fallback) ? {
		issues: [],
		value: void 0
	} : e;
}
var jn = /*@__PURE__*/ n("$ZodOptional", (e, t) => {
	j.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", m(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), m(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${d(e.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (t.innerType._zod.optin === "optional") {
			let r = e.value, i = t.innerType._zod.run(e, n);
			return i instanceof Promise ? i.then((e) => An(e, r)) : An(i, r);
		}
		return e.value === void 0 ? e : t.innerType._zod.run(e, n);
	};
}), Mn = /*@__PURE__*/ n("$ZodExactOptional", (e, t) => {
	jn.init(e, t), m(e._zod, "values", () => t.innerType._zod.values), m(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), Nn = /*@__PURE__*/ n("$ZodNullable", (e, t) => {
	j.init(e, t), m(e._zod, "optin", () => t.innerType._zod.optin), m(e._zod, "optout", () => t.innerType._zod.optout), m(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${d(e.source)}|null)$`) : void 0;
	}), m(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), Pn = /*@__PURE__*/ n("$ZodDefault", (e, t) => {
	j.init(e, t), e._zod.optin = "optional", m(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Fn(e, t)) : Fn(r, t);
	};
});
function Fn(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var In = /*@__PURE__*/ n("$ZodPrefault", (e, t) => {
	j.init(e, t), e._zod.optin = "optional", m(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), Ln = /*@__PURE__*/ n("$ZodNonOptional", (e, t) => {
	j.init(e, t), m(e._zod, "values", () => {
		let e = t.innerType._zod.values;
		return e ? new Set([...e].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => Rn(t, e)) : Rn(i, e);
	};
});
function Rn(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
var zn = /*@__PURE__*/ n("$ZodCatch", (e, t) => {
	j.init(e, t), e._zod.optin = "optional", m(e._zod, "optout", () => t.innerType._zod.optout), m(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((r) => (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => T(e, n, o())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e)) : (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => T(e, n, o())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e);
	};
}), Bn = /*@__PURE__*/ n("$ZodPipe", (e, t) => {
	j.init(e, t), m(e._zod, "values", () => t.in._zod.values), m(e._zod, "optin", () => t.in._zod.optin), m(e._zod, "optout", () => t.out._zod.optout), m(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => P(e, t.in, n)) : P(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => P(e, t.out, n)) : P(r, t.out, n);
	};
});
function P(e, t, n) {
	return e.issues.length ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues,
		fallback: e.fallback
	}, n);
}
var Vn = /*@__PURE__*/ n("$ZodPreprocess", (e, t) => {
	Bn.init(e, t);
}), Hn = /*@__PURE__*/ n("$ZodReadonly", (e, t) => {
	j.init(e, t), m(e._zod, "propValues", () => t.innerType._zod.propValues), m(e._zod, "values", () => t.innerType._zod.values), m(e._zod, "optin", () => t.innerType?._zod?.optin), m(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(Un) : Un(r);
	};
});
function Un(e) {
	return e.value = Object.freeze(e.value), e;
}
var Wn = /*@__PURE__*/ n("$ZodLazy", (e, t) => {
	j.init(e, t), m(e._zod, "innerType", () => {
		let e = t;
		return e._cachedInner ||= t.getter(), e._cachedInner;
	}), m(e._zod, "pattern", () => e._zod.innerType?._zod?.pattern), m(e._zod, "propValues", () => e._zod.innerType?._zod?.propValues), m(e._zod, "optin", () => e._zod.innerType?._zod?.optin ?? void 0), m(e._zod, "optout", () => e._zod.innerType?._zod?.optout ?? void 0), e._zod.parse = (t, n) => e._zod.innerType._zod.run(t, n);
}), Gn = /*@__PURE__*/ n("$ZodCustom", (e, t) => {
	k.init(e, t), j.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => Kn(t, n, r, e));
		Kn(i, n, r, e);
	};
});
function Kn(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(E(e));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var qn, Jn = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
	}
	add(e, ...t) {
		let n = t[0];
		return this._map.set(e, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, e), this;
	}
	clear() {
		return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let n = { ...this.get(t) ?? {} };
			delete n.id;
			let r = {
				...n,
				...this._map.get(e)
			};
			return Object.keys(r).length ? r : void 0;
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
};
function Yn() {
	return new Jn();
}
(qn = globalThis).__zod_globalRegistry ?? (qn.__zod_globalRegistry = Yn());
var F = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function Xn(e, t) {
	return new e({
		type: "string",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Zn(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Qn(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function $n(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function er(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function tr(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function nr(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function rr(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ir(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ar(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function or(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function sr(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function cr(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function lr(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ur(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function dr(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function fr(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function pr(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function mr(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function hr(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function gr(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function _r(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function vr(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function yr(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function br(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function xr(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Sr(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Cr(e, t) {
	return new e({
		type: "number",
		checks: [],
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function wr(e, t) {
	return new e({
		type: "number",
		coerce: !0,
		checks: [],
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Tr(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Er(e, t) {
	return new e({
		type: "boolean",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Dr(e, t) {
	return new e({
		type: "boolean",
		coerce: !0,
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Or(e, t) {
	return new e({
		type: "null",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function kr(e) {
	return new e({ type: "any" });
}
// @__NO_SIDE_EFFECTS__
function Ar(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function jr(e, t) {
	return new e({
		type: "never",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Mr(e, t) {
	return new e({
		type: "void",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Nr(e, t) {
	return new e({
		type: "date",
		...x(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Pr(e, t) {
	return new ht({
		check: "less_than",
		...x(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function I(e, t) {
	return new ht({
		check: "less_than",
		...x(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Fr(e, t) {
	return new gt({
		check: "greater_than",
		...x(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function L(e, t) {
	return new gt({
		check: "greater_than",
		...x(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function Ir(e, t) {
	return new _t({
		check: "multiple_of",
		...x(t),
		value: e
	});
}
// @__NO_SIDE_EFFECTS__
function Lr(e, t) {
	return new yt({
		check: "max_length",
		...x(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function R(e, t) {
	return new bt({
		check: "min_length",
		...x(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function Rr(e, t) {
	return new xt({
		check: "length_equals",
		...x(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function zr(e, t) {
	return new St({
		check: "string_format",
		format: "regex",
		...x(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function Br(e) {
	return new Ct({
		check: "string_format",
		format: "lowercase",
		...x(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Vr(e) {
	return new wt({
		check: "string_format",
		format: "uppercase",
		...x(e)
	});
}
// @__NO_SIDE_EFFECTS__
function Hr(e, t) {
	return new Tt({
		check: "string_format",
		format: "includes",
		...x(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function Ur(e, t) {
	return new Et({
		check: "string_format",
		format: "starts_with",
		...x(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function Wr(e, t) {
	return new Dt({
		check: "string_format",
		format: "ends_with",
		...x(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function z(e) {
	return new Ot({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function Gr(e) {
	return /* @__PURE__ */ z((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function Kr() {
	return /* @__PURE__ */ z((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function qr() {
	return /* @__PURE__ */ z((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function Jr() {
	return /* @__PURE__ */ z((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function Yr() {
	return /* @__PURE__ */ z((e) => te(e));
}
// @__NO_SIDE_EFFECTS__
function Xr(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...x(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Zr(e, t, n) {
	let r = x(n);
	return r.abort ??= !0, new e({
		type: "custom",
		check: "custom",
		fn: t,
		...r
	});
}
// @__NO_SIDE_EFFECTS__
function Qr(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...x(n)
	});
}
// @__NO_SIDE_EFFECTS__
function $r(e, t) {
	let n = /* @__PURE__ */ ei((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(E(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", r.input ??= t.value, r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(E(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function ei(e, t) {
	let n = new k({
		check: "custom",
		...x(t)
	});
	return n._zod.check = e, n;
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
function B(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? F,
		target: t,
		unrepresentable: e?.unrepresentable ?? "throw",
		override: e?.override ?? (() => {}),
		io: e?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: e?.cycles ?? "ref",
		reused: e?.reused ?? "inline",
		external: e?.external ?? void 0
	};
}
function V(e, t, n = {
	path: [],
	schemaPath: []
}) {
	var r;
	let i = e._zod.def, a = t.seen.get(e);
	if (a) return a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema;
	let o = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: n.path
	};
	t.seen.set(e, o);
	let s = e._zod.toJSONSchema?.();
	if (s) o.schema = s;
	else {
		let r = {
			...n,
			schemaPath: [...n.schemaPath, e],
			path: n.path
		};
		if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
		else {
			let n = o.schema, a = t.processors[i.type];
			if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
			a(e, t, n, r);
		}
		let a = e._zod.parent;
		a && (o.ref ||= a, V(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Object.assign(o.schema, c), t.io === "input" && W(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function H(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = /* @__PURE__ */ new Map();
	for (let t of e.seen.entries()) {
		let n = e.metadataRegistry.get(t[0])?.id;
		if (n) {
			let e = r.get(n);
			if (e && e !== t[0]) throw Error(`Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			r.set(n, t[0]);
		}
	}
	let i = (t) => {
		let r = e.target === "draft-2020-12" ? "$defs" : "definitions";
		if (e.external) {
			let n = e.external.registry.get(t[0])?.id, i = e.external.uri ?? ((e) => e);
			if (n) return { ref: i(n) };
			let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
			return t[1].defId = a, {
				defId: a,
				ref: `${i("__shared")}#/${r}/${a}`
			};
		}
		if (t[1] === n) return { ref: "#" };
		let i = `#/${r}/`, a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + a
		};
	}, a = (e) => {
		if (e[1].schema.$ref) return;
		let t = e[1], { ref: n, defId: r } = i(e);
		t.def = { ...t.schema }, r && (t.defId = r);
		let a = t.schema;
		for (let e in a) delete a[e];
		a.$ref = n;
	};
	if (e.cycles === "throw") for (let t of e.seen.entries()) {
		let e = t[1];
		if (e.cycle) throw Error(`Cycle detected: #/${e.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (let n of e.seen.entries()) {
		let r = n[1];
		if (t === n[0]) {
			a(n);
			continue;
		}
		if (e.external) {
			let r = e.external.registry.get(n[0])?.id;
			if (t !== n[0] && r) {
				a(n);
				continue;
			}
		}
		if (e.metadataRegistry.get(n[0])?.id) {
			a(n);
			continue;
		}
		if (r.cycle) {
			a(n);
			continue;
		}
		if (r.count > 1 && e.reused === "ref") {
			a(n);
			continue;
		}
	}
}
function U(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : Object.assign(i, s), Object.assign(i, a), t._zod.parent === o) for (let e in i) e !== "$ref" && e !== "allOf" && (e in a || delete i[e]);
			if (s.$ref && n.def) for (let e in i) e !== "$ref" && e !== "allOf" && e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e];
		}
		let s = t._zod.parent;
		if (s && s !== o) {
			r(s);
			let t = e.seen.get(s);
			if (t?.schema.$ref && (i.$ref = t.schema.$ref, t.def)) for (let e in i) e !== "$ref" && e !== "allOf" && e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e];
		}
		e.override({
			zodSchema: t,
			jsonSchema: i,
			path: n.path ?? []
		});
	};
	for (let t of [...e.seen.entries()].reverse()) r(t[0]);
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	Object.assign(i, n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, o[e.defId] = e.def);
	}
	e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: G(t, "input", e.processors),
					output: G(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function W(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return W(r.element, n);
	if (r.type === "set") return W(r.valueType, n);
	if (r.type === "lazy") return W(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault") return W(r.innerType, n);
	if (r.type === "intersection") return W(r.left, n) || W(r.right, n);
	if (r.type === "record" || r.type === "map") return W(r.keyType, n) || W(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : W(r.in, n) || W(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (W(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (W(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (W(e, n)) return !0;
		return !!(r.rest && W(r.rest, n));
	}
	return !1;
}
var ti = (e, t = {}) => (n) => {
	let r = B({
		...n,
		processors: t
	});
	return V(e, r), H(r, e), U(r, e);
}, G = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = B({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return V(e, o), H(o, e), U(o, e);
}, ni = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, ri = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag;
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = ni[s] ?? s, i.format === "" && delete i.format, s === "time" && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c];
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, ii = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, format: s, multipleOf: c, exclusiveMaximum: l, exclusiveMinimum: u } = e._zod.bag;
	i.type = typeof s == "string" && s.includes("int") ? "integer" : "number";
	let d = typeof u == "number" && u >= (a ?? -Infinity), f = typeof l == "number" && l <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	d ? p ? (i.minimum = u, i.exclusiveMinimum = !0) : i.exclusiveMinimum = u : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = l, i.exclusiveMaximum = !0) : i.exclusiveMaximum = l : typeof o == "number" && (i.maximum = o), typeof c == "number" && (i.multipleOf = c);
}, ai = (e, t, n, r) => {
	n.type = "boolean";
}, oi = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("BigInt cannot be represented in JSON Schema");
}, si = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Symbols cannot be represented in JSON Schema");
}, ci = (e, t, n, r) => {
	t.target === "openapi-3.0" ? (n.type = "string", n.nullable = !0, n.enum = [null]) : n.type = "null";
}, li = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Undefined cannot be represented in JSON Schema");
}, ui = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Void cannot be represented in JSON Schema");
}, di = (e, t, n, r) => {
	n.not = {};
}, fi = (e, t, n, r) => {}, pi = (e, t, n, r) => {}, mi = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Date cannot be represented in JSON Schema");
}, hi = (e, t, n, r) => {
	let i = e._zod.def, a = s(i.entries);
	a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a;
}, gi = (e, t, n, r) => {
	let i = e._zod.def, a = [];
	for (let e of i.values) if (e === void 0) {
		if (t.unrepresentable === "throw") throw Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof e == "bigint") {
		if (t.unrepresentable === "throw") throw Error("BigInt literals cannot be represented in JSON Schema");
		a.push(Number(e));
	} else a.push(e);
	if (a.length !== 0) {
		if (a.length === 1) {
			let e = a[0];
			n.type = e === null ? "null" : typeof e, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [e] : n.const = e;
		} else a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), a.every((e) => typeof e == "boolean") && (n.type = "boolean"), a.every((e) => e === null) && (n.type = "null"), n.enum = a;
	}
}, _i = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("NaN cannot be represented in JSON Schema");
}, vi = (e, t, n, r) => {
	let i = n, a = e._zod.pattern;
	if (!a) throw Error("Pattern not found in template literal");
	i.type = "string", i.pattern = a.source;
}, yi = (e, t, n, r) => {
	let i = n, a = {
		type: "string",
		format: "binary",
		contentEncoding: "binary"
	}, { minimum: o, maximum: s, mime: c } = e._zod.bag;
	o !== void 0 && (a.minLength = o), s !== void 0 && (a.maxLength = s), c ? c.length === 1 ? (a.contentMediaType = c[0], Object.assign(i, a)) : (Object.assign(i, a), i.anyOf = c.map((e) => ({ contentMediaType: e }))) : Object.assign(i, a);
}, bi = (e, t, n, r) => {
	n.type = "boolean";
}, xi = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
}, Si = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Function types cannot be represented in JSON Schema");
}, Ci = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
}, wi = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Map cannot be represented in JSON Schema");
}, Ti = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Set cannot be represented in JSON Schema");
}, Ei = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = e._zod.bag;
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = V(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
}, Di = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object", i.properties = {};
	let o = a.shape;
	for (let e in o) i.properties[e] = V(o[e], t, {
		...r,
		path: [
			...r.path,
			"properties",
			e
		]
	});
	let s = new Set(Object.keys(o)), c = new Set([...s].filter((e) => {
		let n = a.shape[e]._zod;
		return t.io === "input" ? n.optin === void 0 : n.optout === void 0;
	}));
	c.size > 0 && (i.required = Array.from(c)), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = V(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Oi = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => V(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, ki = (e, t, n, r) => {
	let i = e._zod.def, a = V(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = V(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1;
	n.allOf = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
}, Ai = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "array";
	let o = t.target === "draft-2020-12" ? "prefixItems" : "items", s = t.target === "draft-2020-12" || t.target === "openapi-3.0" ? "items" : "additionalItems", c = a.items.map((e, n) => V(e, t, {
		...r,
		path: [
			...r.path,
			o,
			n
		]
	})), l = a.rest ? V(a.rest, t, {
		...r,
		path: [
			...r.path,
			s,
			...t.target === "openapi-3.0" ? [a.items.length] : []
		]
	}) : null;
	t.target === "draft-2020-12" ? (i.prefixItems = c, l && (i.items = l)) : t.target === "openapi-3.0" ? (i.items = { anyOf: c }, l && i.items.anyOf.push(l), i.minItems = c.length, l || (i.maxItems = c.length)) : (i.items = c, l && (i.additionalItems = l));
	let { minimum: u, maximum: d } = e._zod.bag;
	typeof u == "number" && (i.minItems = u), typeof d == "number" && (i.maxItems = d);
}, ji = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object";
	let o = a.keyType, s = o._zod.bag?.patterns;
	if (a.mode === "loose" && s && s.size > 0) {
		let e = V(a.valueType, t, {
			...r,
			path: [
				...r.path,
				"patternProperties",
				"*"
			]
		});
		i.patternProperties = {};
		for (let t of s) i.patternProperties[t.source] = e;
	} else (t.target === "draft-07" || t.target === "draft-2020-12") && (i.propertyNames = V(a.keyType, t, {
		...r,
		path: [...r.path, "propertyNames"]
	})), i.additionalProperties = V(a.valueType, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	});
	let c = o._zod.values;
	if (c) {
		let e = [...c].filter((e) => typeof e == "string" || typeof e == "number");
		e.length > 0 && (i.required = e);
	}
}, Mi = (e, t, n, r) => {
	let i = e._zod.def, a = V(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Ni = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Pi = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.default = JSON.parse(JSON.stringify(i.defaultValue));
}, Fi = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)));
}, Ii = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		throw Error("Dynamic catch values are not supported in JSON Schema");
	}
	n.default = o;
}, Li = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	V(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Ri = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, zi = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Bi = (e, t, n, r) => {
	let i = e._zod.def;
	V(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Vi = (e, t, n, r) => {
	let i = e._zod.innerType;
	V(i, t, r);
	let a = t.seen.get(e);
	a.ref = i;
}, Hi = {
	string: ri,
	number: ii,
	boolean: ai,
	bigint: oi,
	symbol: si,
	null: ci,
	undefined: li,
	void: ui,
	never: di,
	any: fi,
	unknown: pi,
	date: mi,
	enum: hi,
	literal: gi,
	nan: _i,
	template_literal: vi,
	file: yi,
	success: bi,
	custom: xi,
	function: Si,
	transform: Ci,
	map: wi,
	set: Ti,
	array: Ei,
	object: Di,
	union: Oi,
	intersection: ki,
	tuple: Ai,
	record: ji,
	nullable: Mi,
	nonoptional: Ni,
	default: Pi,
	prefault: Fi,
	catch: Ii,
	pipe: Li,
	readonly: Ri,
	promise: zi,
	optional: Bi,
	lazy: Vi
};
function Ui(e, t) {
	if ("_idmap" in e) {
		let n = e, r = B({
			...t,
			processors: Hi
		}), i = {};
		for (let e of n._idmap.entries()) {
			let [t, n] = e;
			V(n, r);
		}
		let a = {};
		r.external = {
			registry: n,
			uri: t?.uri,
			defs: i
		};
		for (let e of n._idmap.entries()) {
			let [t, n] = e;
			H(r, n), a[t] = U(r, n);
		}
		return Object.keys(i).length > 0 && (a.__shared = { [r.target === "draft-2020-12" ? "$defs" : "definitions"]: i }), { schemas: a };
	}
	let n = B({
		...t,
		processors: Hi
	});
	return V(e, n), H(n, e), U(n, e);
}
//#endregion
//#region node_modules/zod/v4/classic/iso.js
var Wi = /*@__PURE__*/ n("ZodISODateTime", (e, t) => {
	Ut.init(e, t), Y.init(e, t);
});
function Gi(e) {
	return /* @__PURE__ */ yr(Wi, e);
}
var Ki = /*@__PURE__*/ n("ZodISODate", (e, t) => {
	Wt.init(e, t), Y.init(e, t);
});
function qi(e) {
	return /* @__PURE__ */ br(Ki, e);
}
var Ji = /*@__PURE__*/ n("ZodISOTime", (e, t) => {
	Gt.init(e, t), Y.init(e, t);
});
function Yi(e) {
	return /* @__PURE__ */ xr(Ji, e);
}
var Xi = /*@__PURE__*/ n("ZodISODuration", (e, t) => {
	Kt.init(e, t), Y.init(e, t);
});
function Zi(e) {
	return /* @__PURE__ */ Sr(Xi, e);
}
var K = /*@__PURE__*/ n("ZodError", (e, t) => {
	ve.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
		format: { value: (t) => xe(e, t) },
		flatten: { value: (t) => be(e, t) },
		addIssue: { value: (t) => {
			e.issues.push(t), e.message = JSON.stringify(e.issues, c, 2);
		} },
		addIssues: { value: (t) => {
			e.issues.push(...t), e.message = JSON.stringify(e.issues, c, 2);
		} },
		isEmpty: { get() {
			return e.issues.length === 0;
		} }
	});
}, { Parent: Error }), Qi = /* @__PURE__ */ we(K), $i = /* @__PURE__ */ Te(K), ea = /* @__PURE__ */ D(K), ta = /* @__PURE__ */ O(K), na = /* @__PURE__ */ Oe(K), ra = /* @__PURE__ */ ke(K), ia = /* @__PURE__ */ Ae(K), aa = /* @__PURE__ */ je(K), oa = /* @__PURE__ */ Me(K), sa = /* @__PURE__ */ Ne(K), ca = /* @__PURE__ */ Pe(K), la = /* @__PURE__ */ Fe(K), ua = /* @__PURE__ */ new WeakMap();
function q(e, t, n) {
	let r = Object.getPrototypeOf(e), i = ua.get(r);
	if (i || (i = /* @__PURE__ */ new Set(), ua.set(r, i)), !i.has(t)) {
		i.add(t);
		for (let e in n) {
			let t = n[e];
			Object.defineProperty(r, e, {
				configurable: !0,
				enumerable: !1,
				get() {
					let n = t.bind(this);
					return Object.defineProperty(this, e, {
						configurable: !0,
						writable: !0,
						enumerable: !0,
						value: n
					}), n;
				},
				set(t) {
					Object.defineProperty(this, e, {
						configurable: !0,
						writable: !0,
						enumerable: !0,
						value: t
					});
				}
			});
		}
	}
}
var J = /*@__PURE__*/ n("ZodType", (e, t) => (j.init(e, t), Object.assign(e["~standard"], { jsonSchema: {
	input: G(e, "input"),
	output: G(e, "output")
} }), e.toJSONSchema = ti(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (t, n) => Qi(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => ea(e, t, n), e.parseAsync = async (t, n) => $i(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => ta(e, t, n), e.spa = e.safeParseAsync, e.encode = (t, n) => na(e, t, n), e.decode = (t, n) => ra(e, t, n), e.encodeAsync = async (t, n) => ia(e, t, n), e.decodeAsync = async (t, n) => aa(e, t, n), e.safeEncode = (t, n) => oa(e, t, n), e.safeDecode = (t, n) => sa(e, t, n), e.safeEncodeAsync = async (t, n) => ca(e, t, n), e.safeDecodeAsync = async (t, n) => la(e, t, n), q(e, "ZodType", {
	check(...e) {
		let t = this.def;
		return this.clone(g(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return b(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(Lo(e, t));
	},
	superRefine(e, t) {
		return this.check(Ro(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ z(e));
	},
	optional() {
		return go(this);
	},
	exactOptional() {
		return vo(this);
	},
	nullable() {
		return $(this);
	},
	nullish() {
		return go($(this));
	},
	nonoptional(e) {
		return To(this, e);
	},
	array() {
		return Xa(this);
	},
	or(e) {
		return to([this, e]);
	},
	and(e) {
		return ao(this, e);
	},
	transform(e) {
		return ko(this, mo(e));
	},
	default(e) {
		return xo(this, e);
	},
	prefault(e) {
		return Co(this, e);
	},
	catch(e) {
		return Do(this, e);
	},
	pipe(e) {
		return ko(this, e);
	},
	readonly() {
		return Mo(this);
	},
	describe(e) {
		let t = this.clone();
		return F.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return F.get(this);
		let t = this.clone();
		return F.add(t, e[0]), t;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(e) {
		return e(this);
	}
}), Object.defineProperty(e, "description", {
	get() {
		return F.get(e)?.description;
	},
	configurable: !0
}), e)), da = /*@__PURE__*/ n("_ZodString", (e, t) => {
	jt.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ri(e, t, n, r);
	let n = e._zod.bag;
	e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, q(e, "_ZodString", {
		regex(...e) {
			return this.check(/* @__PURE__ */ zr(...e));
		},
		includes(...e) {
			return this.check(/* @__PURE__ */ Hr(...e));
		},
		startsWith(...e) {
			return this.check(/* @__PURE__ */ Ur(...e));
		},
		endsWith(...e) {
			return this.check(/* @__PURE__ */ Wr(...e));
		},
		min(...e) {
			return this.check(/* @__PURE__ */ R(...e));
		},
		max(...e) {
			return this.check(/* @__PURE__ */ Lr(...e));
		},
		length(...e) {
			return this.check(/* @__PURE__ */ Rr(...e));
		},
		nonempty(...e) {
			return this.check(/* @__PURE__ */ R(1, ...e));
		},
		lowercase(e) {
			return this.check(/* @__PURE__ */ Br(e));
		},
		uppercase(e) {
			return this.check(/* @__PURE__ */ Vr(e));
		},
		trim() {
			return this.check(/* @__PURE__ */ Kr());
		},
		normalize(...e) {
			return this.check(/* @__PURE__ */ Gr(...e));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ qr());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ Jr());
		},
		slugify() {
			return this.check(/* @__PURE__ */ Yr());
		}
	});
}), fa = /*@__PURE__*/ n("ZodString", (e, t) => {
	jt.init(e, t), da.init(e, t), e.email = (t) => e.check(/* @__PURE__ */ Zn(ma, t)), e.url = (t) => e.check(/* @__PURE__ */ rr(ga, t)), e.jwt = (t) => e.check(/* @__PURE__ */ vr(Ma, t)), e.emoji = (t) => e.check(/* @__PURE__ */ ir(va, t)), e.guid = (t) => e.check(/* @__PURE__ */ Qn(ha, t)), e.uuid = (t) => e.check(/* @__PURE__ */ $n(X, t)), e.uuidv4 = (t) => e.check(/* @__PURE__ */ er(X, t)), e.uuidv6 = (t) => e.check(/* @__PURE__ */ tr(X, t)), e.uuidv7 = (t) => e.check(/* @__PURE__ */ nr(X, t)), e.nanoid = (t) => e.check(/* @__PURE__ */ ar(ya, t)), e.guid = (t) => e.check(/* @__PURE__ */ Qn(ha, t)), e.cuid = (t) => e.check(/* @__PURE__ */ or(ba, t)), e.cuid2 = (t) => e.check(/* @__PURE__ */ sr(xa, t)), e.ulid = (t) => e.check(/* @__PURE__ */ cr(Sa, t)), e.base64 = (t) => e.check(/* @__PURE__ */ hr(ka, t)), e.base64url = (t) => e.check(/* @__PURE__ */ gr(Aa, t)), e.xid = (t) => e.check(/* @__PURE__ */ lr(Ca, t)), e.ksuid = (t) => e.check(/* @__PURE__ */ ur(wa, t)), e.ipv4 = (t) => e.check(/* @__PURE__ */ dr(Ta, t)), e.ipv6 = (t) => e.check(/* @__PURE__ */ fr(Ea, t)), e.cidrv4 = (t) => e.check(/* @__PURE__ */ pr(Da, t)), e.cidrv6 = (t) => e.check(/* @__PURE__ */ mr(Oa, t)), e.e164 = (t) => e.check(/* @__PURE__ */ _r(ja, t)), e.datetime = (t) => e.check(Gi(t)), e.date = (t) => e.check(qi(t)), e.time = (t) => e.check(Yi(t)), e.duration = (t) => e.check(Zi(t));
});
function pa(e) {
	return /* @__PURE__ */ Xn(fa, e);
}
var Y = /*@__PURE__*/ n("ZodStringFormat", (e, t) => {
	M.init(e, t), da.init(e, t);
}), ma = /*@__PURE__*/ n("ZodEmail", (e, t) => {
	Pt.init(e, t), Y.init(e, t);
}), ha = /*@__PURE__*/ n("ZodGUID", (e, t) => {
	Mt.init(e, t), Y.init(e, t);
}), X = /*@__PURE__*/ n("ZodUUID", (e, t) => {
	Nt.init(e, t), Y.init(e, t);
}), ga = /*@__PURE__*/ n("ZodURL", (e, t) => {
	Ft.init(e, t), Y.init(e, t);
});
function _a(e) {
	return /* @__PURE__ */ rr(ga, e);
}
var va = /*@__PURE__*/ n("ZodEmoji", (e, t) => {
	It.init(e, t), Y.init(e, t);
}), ya = /*@__PURE__*/ n("ZodNanoID", (e, t) => {
	Lt.init(e, t), Y.init(e, t);
}), ba = /*@__PURE__*/ n("ZodCUID", (e, t) => {
	Rt.init(e, t), Y.init(e, t);
}), xa = /*@__PURE__*/ n("ZodCUID2", (e, t) => {
	zt.init(e, t), Y.init(e, t);
}), Sa = /*@__PURE__*/ n("ZodULID", (e, t) => {
	Bt.init(e, t), Y.init(e, t);
}), Ca = /*@__PURE__*/ n("ZodXID", (e, t) => {
	Vt.init(e, t), Y.init(e, t);
}), wa = /*@__PURE__*/ n("ZodKSUID", (e, t) => {
	Ht.init(e, t), Y.init(e, t);
}), Ta = /*@__PURE__*/ n("ZodIPv4", (e, t) => {
	qt.init(e, t), Y.init(e, t);
}), Ea = /*@__PURE__*/ n("ZodIPv6", (e, t) => {
	Jt.init(e, t), Y.init(e, t);
}), Da = /*@__PURE__*/ n("ZodCIDRv4", (e, t) => {
	Yt.init(e, t), Y.init(e, t);
}), Oa = /*@__PURE__*/ n("ZodCIDRv6", (e, t) => {
	Xt.init(e, t), Y.init(e, t);
}), ka = /*@__PURE__*/ n("ZodBase64", (e, t) => {
	Qt.init(e, t), Y.init(e, t);
}), Aa = /*@__PURE__*/ n("ZodBase64URL", (e, t) => {
	en.init(e, t), Y.init(e, t);
}), ja = /*@__PURE__*/ n("ZodE164", (e, t) => {
	tn.init(e, t), Y.init(e, t);
}), Ma = /*@__PURE__*/ n("ZodJWT", (e, t) => {
	rn.init(e, t), Y.init(e, t);
}), Na = /*@__PURE__*/ n("ZodNumber", (e, t) => {
	an.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ii(e, t, n, r), q(e, "ZodNumber", {
		gt(e, t) {
			return this.check(/* @__PURE__ */ Fr(e, t));
		},
		gte(e, t) {
			return this.check(/* @__PURE__ */ L(e, t));
		},
		min(e, t) {
			return this.check(/* @__PURE__ */ L(e, t));
		},
		lt(e, t) {
			return this.check(/* @__PURE__ */ Pr(e, t));
		},
		lte(e, t) {
			return this.check(/* @__PURE__ */ I(e, t));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ I(e, t));
		},
		int(e) {
			return this.check(Z(e));
		},
		safe(e) {
			return this.check(Z(e));
		},
		positive(e) {
			return this.check(/* @__PURE__ */ Fr(0, e));
		},
		nonnegative(e) {
			return this.check(/* @__PURE__ */ L(0, e));
		},
		negative(e) {
			return this.check(/* @__PURE__ */ Pr(0, e));
		},
		nonpositive(e) {
			return this.check(/* @__PURE__ */ I(0, e));
		},
		multipleOf(e, t) {
			return this.check(/* @__PURE__ */ Ir(e, t));
		},
		step(e, t) {
			return this.check(/* @__PURE__ */ Ir(e, t));
		},
		finite() {
			return this;
		}
	});
	let n = e._zod.bag;
	e.minValue = Math.max(n.minimum ?? -Infinity, n.exclusiveMinimum ?? -Infinity) ?? null, e.maxValue = Math.min(n.maximum ?? Infinity, n.exclusiveMaximum ?? Infinity) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? .5), e.isFinite = !0, e.format = n.format ?? null;
});
function Pa(e) {
	return /* @__PURE__ */ Cr(Na, e);
}
var Fa = /*@__PURE__*/ n("ZodNumberFormat", (e, t) => {
	on.init(e, t), Na.init(e, t);
});
function Z(e) {
	return /* @__PURE__ */ Tr(Fa, e);
}
var Ia = /*@__PURE__*/ n("ZodBoolean", (e, t) => {
	sn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ai(e, t, n, r);
});
function La(e) {
	return /* @__PURE__ */ Er(Ia, e);
}
var Ra = /*@__PURE__*/ n("ZodNull", (e, t) => {
	cn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ci(e, t, n, r);
});
function za(e) {
	return /* @__PURE__ */ Or(Ra, e);
}
var Ba = /*@__PURE__*/ n("ZodAny", (e, t) => {
	ln.init(e, t), J.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Va() {
	return /* @__PURE__ */ kr(Ba);
}
var Ha = /*@__PURE__*/ n("ZodUnknown", (e, t) => {
	un.init(e, t), J.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Q() {
	return /* @__PURE__ */ Ar(Ha);
}
var Ua = /*@__PURE__*/ n("ZodNever", (e, t) => {
	dn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => di(e, t, n, r);
});
function Wa(e) {
	return /* @__PURE__ */ jr(Ua, e);
}
var Ga = /*@__PURE__*/ n("ZodVoid", (e, t) => {
	fn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ui(e, t, n, r);
});
function Ka(e) {
	return /* @__PURE__ */ Mr(Ga, e);
}
var qa = /*@__PURE__*/ n("ZodDate", (e, t) => {
	pn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => mi(e, t, n, r), e.min = (t, n) => e.check(/* @__PURE__ */ L(t, n)), e.max = (t, n) => e.check(/* @__PURE__ */ I(t, n));
	let n = e._zod.bag;
	e.minDate = n.minimum ? new Date(n.minimum) : null, e.maxDate = n.maximum ? new Date(n.maximum) : null;
});
function Ja(e) {
	return /* @__PURE__ */ Nr(qa, e);
}
var Ya = /*@__PURE__*/ n("ZodArray", (e, t) => {
	hn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ei(e, t, n, r), e.element = t.element, q(e, "ZodArray", {
		min(e, t) {
			return this.check(/* @__PURE__ */ R(e, t));
		},
		nonempty(e) {
			return this.check(/* @__PURE__ */ R(1, e));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ Lr(e, t));
		},
		length(e, t) {
			return this.check(/* @__PURE__ */ Rr(e, t));
		},
		unwrap() {
			return this.element;
		}
	});
});
function Xa(e, t) {
	return /* @__PURE__ */ Xr(Ya, e, t);
}
var Za = /*@__PURE__*/ n("ZodObject", (e, t) => {
	yn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Di(e, t, n, r), m(e, "shape", () => t.shape), q(e, "ZodObject", {
		keyof() {
			return lo(Object.keys(this._zod.def.shape));
		},
		catchall(e) {
			return this.clone({
				...this._zod.def,
				catchall: e
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: Q()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: Q()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: Wa()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(e) {
			return ue(this, e);
		},
		safeExtend(e) {
			return de(this, e);
		},
		merge(e) {
			return fe(this, e);
		},
		pick(e) {
			return ce(this, e);
		},
		omit(e) {
			return le(this, e);
		},
		partial(...e) {
			return pe(ho, this, e[0]);
		},
		required(...e) {
			return me(wo, this, e[0]);
		}
	});
});
function Qa(e, t) {
	return new Za({
		type: "object",
		shape: e ?? {},
		...x(t)
	});
}
function $a(e, t) {
	return new Za({
		type: "object",
		shape: e,
		catchall: Q(),
		...x(t)
	});
}
var eo = /*@__PURE__*/ n("ZodUnion", (e, t) => {
	xn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Oi(e, t, n, r), e.options = t.options;
});
function to(e, t) {
	return new eo({
		type: "union",
		options: e,
		...x(t)
	});
}
var no = /*@__PURE__*/ n("ZodDiscriminatedUnion", (e, t) => {
	eo.init(e, t), Sn.init(e, t);
});
function ro(e, t, n) {
	return new no({
		type: "union",
		options: t,
		discriminator: e,
		...x(n)
	});
}
var io = /*@__PURE__*/ n("ZodIntersection", (e, t) => {
	Cn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ki(e, t, n, r);
});
function ao(e, t) {
	return new io({
		type: "intersection",
		left: e,
		right: t
	});
}
var oo = /*@__PURE__*/ n("ZodRecord", (e, t) => {
	En.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => ji(e, t, n, r), e.keyType = t.keyType, e.valueType = t.valueType;
});
function so(e, t, n) {
	return !t || !t._zod ? new oo({
		type: "record",
		keyType: pa(),
		valueType: e,
		...x(t)
	}) : new oo({
		type: "record",
		keyType: e,
		valueType: t,
		...x(n)
	});
}
var co = /*@__PURE__*/ n("ZodEnum", (e, t) => {
	Dn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => hi(e, t, n, r), e.enum = t.entries, e.options = Object.values(t.entries);
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new co({
			...t,
			checks: [],
			...x(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new co({
			...t,
			checks: [],
			...x(r),
			entries: i
		});
	};
});
function lo(e, t) {
	return new co({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...x(t)
	});
}
var uo = /*@__PURE__*/ n("ZodLiteral", (e, t) => {
	On.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => gi(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function fo(e, t) {
	return new uo({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...x(t)
	});
}
var po = /*@__PURE__*/ n("ZodTransform", (e, t) => {
	kn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ci(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new i(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(E(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", t.input ??= n.value, t.inst ??= e, n.issues.push(E(t));
			}
		};
		let a = t.transform(n.value, n);
		return a instanceof Promise ? a.then((e) => (n.value = e, n.fallback = !0, n)) : (n.value = a, n.fallback = !0, n);
	};
});
function mo(e) {
	return new po({
		type: "transform",
		transform: e
	});
}
var ho = /*@__PURE__*/ n("ZodOptional", (e, t) => {
	jn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Bi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function go(e) {
	return new ho({
		type: "optional",
		innerType: e
	});
}
var _o = /*@__PURE__*/ n("ZodExactOptional", (e, t) => {
	Mn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Bi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function vo(e) {
	return new _o({
		type: "optional",
		innerType: e
	});
}
var yo = /*@__PURE__*/ n("ZodNullable", (e, t) => {
	Nn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Mi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function $(e) {
	return new yo({
		type: "nullable",
		innerType: e
	});
}
var bo = /*@__PURE__*/ n("ZodDefault", (e, t) => {
	Pn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Pi(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function xo(e, t) {
	return new bo({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : ie(t);
		}
	});
}
var So = /*@__PURE__*/ n("ZodPrefault", (e, t) => {
	In.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Fi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Co(e, t) {
	return new So({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : ie(t);
		}
	});
}
var wo = /*@__PURE__*/ n("ZodNonOptional", (e, t) => {
	Ln.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ni(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function To(e, t) {
	return new wo({
		type: "nonoptional",
		innerType: e,
		...x(t)
	});
}
var Eo = /*@__PURE__*/ n("ZodCatch", (e, t) => {
	zn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ii(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Do(e, t) {
	return new Eo({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : () => t
	});
}
var Oo = /*@__PURE__*/ n("ZodPipe", (e, t) => {
	Bn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Li(e, t, n, r), e.in = t.in, e.out = t.out;
});
function ko(e, t) {
	return new Oo({
		type: "pipe",
		in: e,
		out: t
	});
}
var Ao = /*@__PURE__*/ n("ZodPreprocess", (e, t) => {
	Oo.init(e, t), Vn.init(e, t);
}), jo = /*@__PURE__*/ n("ZodReadonly", (e, t) => {
	Hn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ri(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Mo(e) {
	return new jo({
		type: "readonly",
		innerType: e
	});
}
var No = /*@__PURE__*/ n("ZodLazy", (e, t) => {
	Wn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => Vi(e, t, n, r), e.unwrap = () => e._zod.def.getter();
});
function Po(e) {
	return new No({
		type: "lazy",
		getter: e
	});
}
var Fo = /*@__PURE__*/ n("ZodCustom", (e, t) => {
	Gn.init(e, t), J.init(e, t), e._zod.processJSONSchema = (t, n, r) => xi(e, t, n, r);
});
function Io(e, t) {
	return /* @__PURE__ */ Zr(Fo, e ?? (() => !0), t);
}
function Lo(e, t = {}) {
	return /* @__PURE__ */ Qr(Fo, e, t);
}
function Ro(e, t) {
	return /* @__PURE__ */ $r(e, t);
}
function zo(e, t) {
	return new Ao({
		type: "pipe",
		in: mo(e),
		out: t
	});
}
//#endregion
export { wr as A, pa as C, Gi as D, _a as E, ve as M, Ce as N, Ui as O, t as P, so as S, Q as T, $ as _, Ka as a, go as b, La as c, ro as d, Z as f, $a as g, fo as h, za as i, Ee as j, Dr as k, Io as l, Po as m, Na as n, Va as o, ao as p, lo as r, Xa as s, Ia as t, Ja as u, Pa as v, to as w, zo as x, Qa as y };
