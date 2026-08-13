import { r as e } from "./rolldown-runtime-CJfroGDQ.js";
import { C as t, D as n, M as r, N as i, O as a, P as o, S as s, T as c, _ as l, a as u, c as d, f, h as p, l as m, m as h, o as g, r as _, s as v, u as y, v as b, w as x, y as S } from "./schemas-BT0Xe7nL.js";
import { t as ee } from "./coerce-BtUTJmLo.js";
import { n as te, t as ne } from "./models-DVvVP5-a.js";
import { t as re } from "./event-stream-D07JAHnY.js";
import { n as ie } from "./json-parse-XC7hUTqJ.js";
import { d as ae, f as oe, i as se, t as ce } from "./transform-messages-Dy7xZPcj.js";
import { t as le } from "./hash-BiTt2yhT.js";
//#region node_modules/zod/v3/helpers/util.js
var C;
(function(e) {
	e.assertEqual = (e) => {};
	function t(e) {}
	e.assertIs = t;
	function n(e) {
		throw Error();
	}
	e.assertNever = n, e.arrayToEnum = (e) => {
		let t = {};
		for (let n of e) t[n] = n;
		return t;
	}, e.getValidEnumValues = (t) => {
		let n = e.objectKeys(t).filter((e) => typeof t[t[e]] != "number"), r = {};
		for (let e of n) r[e] = t[e];
		return e.objectValues(r);
	}, e.objectValues = (t) => e.objectKeys(t).map(function(e) {
		return t[e];
	}), e.objectKeys = typeof Object.keys == "function" ? (e) => Object.keys(e) : (e) => {
		let t = [];
		for (let n in e) Object.prototype.hasOwnProperty.call(e, n) && t.push(n);
		return t;
	}, e.find = (e, t) => {
		for (let n of e) if (t(n)) return n;
	}, e.isInteger = typeof Number.isInteger == "function" ? (e) => Number.isInteger(e) : (e) => typeof e == "number" && Number.isFinite(e) && Math.floor(e) === e;
	function r(e, t = " | ") {
		return e.map((e) => typeof e == "string" ? `'${e}'` : e).join(t);
	}
	e.joinValues = r, e.jsonStringifyReplacer = (e, t) => typeof t == "bigint" ? t.toString() : t;
})(C ||= {});
var ue;
(function(e) {
	e.mergeShapes = (e, t) => ({
		...e,
		...t
	});
})(ue ||= {});
var w = C.arrayToEnum([
	"string",
	"nan",
	"number",
	"integer",
	"float",
	"boolean",
	"date",
	"bigint",
	"symbol",
	"function",
	"undefined",
	"null",
	"array",
	"object",
	"unknown",
	"promise",
	"void",
	"never",
	"map",
	"set"
]), de = (e) => {
	switch (typeof e) {
		case "undefined": return w.undefined;
		case "string": return w.string;
		case "number": return Number.isNaN(e) ? w.nan : w.number;
		case "boolean": return w.boolean;
		case "function": return w.function;
		case "bigint": return w.bigint;
		case "symbol": return w.symbol;
		case "object": return Array.isArray(e) ? w.array : e === null ? w.null : e.then && typeof e.then == "function" && e.catch && typeof e.catch == "function" ? w.promise : typeof Map < "u" && e instanceof Map ? w.map : typeof Set < "u" && e instanceof Set ? w.set : typeof Date < "u" && e instanceof Date ? w.date : w.object;
		default: return w.unknown;
	}
}, T = C.arrayToEnum([
	"invalid_type",
	"invalid_literal",
	"custom",
	"invalid_union",
	"invalid_union_discriminator",
	"invalid_enum_value",
	"unrecognized_keys",
	"invalid_arguments",
	"invalid_return_type",
	"invalid_date",
	"invalid_string",
	"too_small",
	"too_big",
	"invalid_intersection_types",
	"not_multiple_of",
	"not_finite"
]), fe = class e extends Error {
	get errors() {
		return this.issues;
	}
	constructor(e) {
		super(), this.issues = [], this.addIssue = (e) => {
			this.issues = [...this.issues, e];
		}, this.addIssues = (e = []) => {
			this.issues = [...this.issues, ...e];
		};
		let t = new.target.prototype;
		Object.setPrototypeOf ? Object.setPrototypeOf(this, t) : this.__proto__ = t, this.name = "ZodError", this.issues = e;
	}
	format(e) {
		let t = e || function(e) {
			return e.message;
		}, n = { _errors: [] }, r = (e) => {
			for (let i of e.issues) if (i.code === "invalid_union") i.unionErrors.map(r);
			else if (i.code === "invalid_return_type") r(i.returnTypeError);
			else if (i.code === "invalid_arguments") r(i.argumentsError);
			else if (i.path.length === 0) n._errors.push(t(i));
			else {
				let e = n, r = 0;
				for (; r < i.path.length;) {
					let n = i.path[r];
					r === i.path.length - 1 ? (e[n] = e[n] || { _errors: [] }, e[n]._errors.push(t(i))) : e[n] = e[n] || { _errors: [] }, e = e[n], r++;
				}
			}
		};
		return r(this), n;
	}
	static assert(t) {
		if (!(t instanceof e)) throw Error(`Not a ZodError: ${t}`);
	}
	toString() {
		return this.message;
	}
	get message() {
		return JSON.stringify(this.issues, C.jsonStringifyReplacer, 2);
	}
	get isEmpty() {
		return this.issues.length === 0;
	}
	flatten(e = (e) => e.message) {
		let t = Object.create(null), n = [];
		for (let r of this.issues) if (r.path.length > 0) {
			let n = r.path[0];
			t[n] = t[n] || [], t[n].push(e(r));
		} else n.push(e(r));
		return {
			formErrors: n,
			fieldErrors: t
		};
	}
	get formErrors() {
		return this.flatten();
	}
};
fe.create = (e) => new fe(e);
//#endregion
//#region node_modules/zod/v3/locales/en.js
var pe = (e, t) => {
	let n;
	switch (e.code) {
		case T.invalid_type:
			n = e.received === w.undefined ? "Required" : `Expected ${e.expected}, received ${e.received}`;
			break;
		case T.invalid_literal:
			n = `Invalid literal value, expected ${JSON.stringify(e.expected, C.jsonStringifyReplacer)}`;
			break;
		case T.unrecognized_keys:
			n = `Unrecognized key(s) in object: ${C.joinValues(e.keys, ", ")}`;
			break;
		case T.invalid_union:
			n = "Invalid input";
			break;
		case T.invalid_union_discriminator:
			n = `Invalid discriminator value. Expected ${C.joinValues(e.options)}`;
			break;
		case T.invalid_enum_value:
			n = `Invalid enum value. Expected ${C.joinValues(e.options)}, received '${e.received}'`;
			break;
		case T.invalid_arguments:
			n = "Invalid function arguments";
			break;
		case T.invalid_return_type:
			n = "Invalid function return type";
			break;
		case T.invalid_date:
			n = "Invalid date";
			break;
		case T.invalid_string:
			typeof e.validation == "object" ? "includes" in e.validation ? (n = `Invalid input: must include "${e.validation.includes}"`, typeof e.validation.position == "number" && (n = `${n} at one or more positions greater than or equal to ${e.validation.position}`)) : "startsWith" in e.validation ? n = `Invalid input: must start with "${e.validation.startsWith}"` : "endsWith" in e.validation ? n = `Invalid input: must end with "${e.validation.endsWith}"` : C.assertNever(e.validation) : n = e.validation === "regex" ? "Invalid" : `Invalid ${e.validation}`;
			break;
		case T.too_small:
			n = e.type === "array" ? `Array must contain ${e.exact ? "exactly" : e.inclusive ? "at least" : "more than"} ${e.minimum} element(s)` : e.type === "string" ? `String must contain ${e.exact ? "exactly" : e.inclusive ? "at least" : "over"} ${e.minimum} character(s)` : e.type === "number" || e.type === "bigint" ? `Number must be ${e.exact ? "exactly equal to " : e.inclusive ? "greater than or equal to " : "greater than "}${e.minimum}` : e.type === "date" ? `Date must be ${e.exact ? "exactly equal to " : e.inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(e.minimum))}` : "Invalid input";
			break;
		case T.too_big:
			n = e.type === "array" ? `Array must contain ${e.exact ? "exactly" : e.inclusive ? "at most" : "less than"} ${e.maximum} element(s)` : e.type === "string" ? `String must contain ${e.exact ? "exactly" : e.inclusive ? "at most" : "under"} ${e.maximum} character(s)` : e.type === "number" ? `Number must be ${e.exact ? "exactly" : e.inclusive ? "less than or equal to" : "less than"} ${e.maximum}` : e.type === "bigint" ? `BigInt must be ${e.exact ? "exactly" : e.inclusive ? "less than or equal to" : "less than"} ${e.maximum}` : e.type === "date" ? `Date must be ${e.exact ? "exactly" : e.inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(e.maximum))}` : "Invalid input";
			break;
		case T.custom:
			n = "Invalid input";
			break;
		case T.invalid_intersection_types:
			n = "Intersection results could not be merged";
			break;
		case T.not_multiple_of:
			n = `Number must be a multiple of ${e.multipleOf}`;
			break;
		case T.not_finite:
			n = "Number must be finite";
			break;
		default: n = t.defaultError, C.assertNever(e);
	}
	return { message: n };
}, me = pe;
function he() {
	return me;
}
//#endregion
//#region node_modules/zod/v3/helpers/parseUtil.js
var ge = (e) => {
	let { data: t, path: n, errorMaps: r, issueData: i } = e, a = [...n, ...i.path || []], o = {
		...i,
		path: a
	};
	if (i.message !== void 0) return {
		...i,
		path: a,
		message: i.message
	};
	let s = "", c = r.filter((e) => !!e).slice().reverse();
	for (let e of c) s = e(o, {
		data: t,
		defaultError: s
	}).message;
	return {
		...i,
		path: a,
		message: s
	};
};
function E(e, t) {
	let n = he(), r = ge({
		issueData: t,
		data: e.data,
		path: e.path,
		errorMaps: [
			e.common.contextualErrorMap,
			e.schemaErrorMap,
			n,
			n === pe ? void 0 : pe
		].filter((e) => !!e)
	});
	e.common.issues.push(r);
}
var _e = class e {
	constructor() {
		this.value = "valid";
	}
	dirty() {
		this.value === "valid" && (this.value = "dirty");
	}
	abort() {
		this.value !== "aborted" && (this.value = "aborted");
	}
	static mergeArray(e, t) {
		let n = [];
		for (let r of t) {
			if (r.status === "aborted") return D;
			r.status === "dirty" && e.dirty(), n.push(r.value);
		}
		return {
			status: e.value,
			value: n
		};
	}
	static async mergeObjectAsync(t, n) {
		let r = [];
		for (let e of n) {
			let t = await e.key, n = await e.value;
			r.push({
				key: t,
				value: n
			});
		}
		return e.mergeObjectSync(t, r);
	}
	static mergeObjectSync(e, t) {
		let n = {};
		for (let r of t) {
			let { key: t, value: i } = r;
			if (t.status === "aborted" || i.status === "aborted") return D;
			t.status === "dirty" && e.dirty(), i.status === "dirty" && e.dirty(), t.value !== "__proto__" && (i.value !== void 0 || r.alwaysSet) && (n[t.value] = i.value);
		}
		return {
			status: e.value,
			value: n
		};
	}
}, D = Object.freeze({ status: "aborted" }), ve = (e) => ({
	status: "dirty",
	value: e
}), ye = (e) => ({
	status: "valid",
	value: e
}), be = (e) => e.status === "aborted", xe = (e) => e.status === "dirty", Se = (e) => e.status === "valid", Ce = (e) => typeof Promise < "u" && e instanceof Promise, O;
(function(e) {
	e.errToObj = (e) => typeof e == "string" ? { message: e } : e || {}, e.toString = (e) => typeof e == "string" ? e : e?.message;
})(O ||= {});
//#endregion
//#region node_modules/zod/v3/types.js
var we = class {
	constructor(e, t, n, r) {
		this._cachedPath = [], this.parent = e, this.data = t, this._path = n, this._key = r;
	}
	get path() {
		return this._cachedPath.length || (Array.isArray(this._key) ? this._cachedPath.push(...this._path, ...this._key) : this._cachedPath.push(...this._path, this._key)), this._cachedPath;
	}
}, Te = (e, t) => {
	if (Se(t)) return {
		success: !0,
		data: t.value
	};
	if (!e.common.issues.length) throw Error("Validation failed but no issues detected.");
	return {
		success: !1,
		get error() {
			if (this._error) return this._error;
			let t = new fe(e.common.issues);
			return this._error = t, this._error;
		}
	};
};
function k(e) {
	if (!e) return {};
	let { errorMap: t, invalid_type_error: n, required_error: r, description: i } = e;
	if (t && (n || r)) throw Error("Can't use \"invalid_type_error\" or \"required_error\" in conjunction with custom error map.");
	return t ? {
		errorMap: t,
		description: i
	} : {
		errorMap: (t, i) => {
			let { message: a } = e;
			return t.code === "invalid_enum_value" ? { message: a ?? i.defaultError } : i.data === void 0 ? { message: a ?? r ?? i.defaultError } : t.code === "invalid_type" ? { message: a ?? n ?? i.defaultError } : { message: i.defaultError };
		},
		description: i
	};
}
var A = class {
	get description() {
		return this._def.description;
	}
	_getType(e) {
		return de(e.data);
	}
	_getOrReturnCtx(e, t) {
		return t || {
			common: e.parent.common,
			data: e.data,
			parsedType: de(e.data),
			schemaErrorMap: this._def.errorMap,
			path: e.path,
			parent: e.parent
		};
	}
	_processInputParams(e) {
		return {
			status: new _e(),
			ctx: {
				common: e.parent.common,
				data: e.data,
				parsedType: de(e.data),
				schemaErrorMap: this._def.errorMap,
				path: e.path,
				parent: e.parent
			}
		};
	}
	_parseSync(e) {
		let t = this._parse(e);
		if (Ce(t)) throw Error("Synchronous parse encountered promise.");
		return t;
	}
	_parseAsync(e) {
		let t = this._parse(e);
		return Promise.resolve(t);
	}
	parse(e, t) {
		let n = this.safeParse(e, t);
		if (n.success) return n.data;
		throw n.error;
	}
	safeParse(e, t) {
		let n = {
			common: {
				issues: [],
				async: t?.async ?? !1,
				contextualErrorMap: t?.errorMap
			},
			path: t?.path || [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data: e,
			parsedType: de(e)
		};
		return Te(n, this._parseSync({
			data: e,
			path: n.path,
			parent: n
		}));
	}
	"~validate"(e) {
		let t = {
			common: {
				issues: [],
				async: !!this["~standard"].async
			},
			path: [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data: e,
			parsedType: de(e)
		};
		if (!this["~standard"].async) try {
			let n = this._parseSync({
				data: e,
				path: [],
				parent: t
			});
			return Se(n) ? { value: n.value } : { issues: t.common.issues };
		} catch (e) {
			e?.message?.toLowerCase()?.includes("encountered") && (this["~standard"].async = !0), t.common = {
				issues: [],
				async: !0
			};
		}
		return this._parseAsync({
			data: e,
			path: [],
			parent: t
		}).then((e) => Se(e) ? { value: e.value } : { issues: t.common.issues });
	}
	async parseAsync(e, t) {
		let n = await this.safeParseAsync(e, t);
		if (n.success) return n.data;
		throw n.error;
	}
	async safeParseAsync(e, t) {
		let n = {
			common: {
				issues: [],
				contextualErrorMap: t?.errorMap,
				async: !0
			},
			path: t?.path || [],
			schemaErrorMap: this._def.errorMap,
			parent: null,
			data: e,
			parsedType: de(e)
		}, r = this._parse({
			data: e,
			path: n.path,
			parent: n
		});
		return Te(n, await (Ce(r) ? r : Promise.resolve(r)));
	}
	refine(e, t) {
		let n = (e) => typeof t == "string" || t === void 0 ? { message: t } : typeof t == "function" ? t(e) : t;
		return this._refinement((t, r) => {
			let i = e(t), a = () => r.addIssue({
				code: T.custom,
				...n(t)
			});
			return typeof Promise < "u" && i instanceof Promise ? i.then((e) => e ? !0 : (a(), !1)) : i ? !0 : (a(), !1);
		});
	}
	refinement(e, t) {
		return this._refinement((n, r) => e(n) ? !0 : (r.addIssue(typeof t == "function" ? t(n, r) : t), !1));
	}
	_refinement(e) {
		return new Ot({
			schema: this,
			typeName: j.ZodEffects,
			effect: {
				type: "refinement",
				refinement: e
			}
		});
	}
	superRefine(e) {
		return this._refinement(e);
	}
	constructor(e) {
		this.spa = this.safeParseAsync, this._def = e, this.parse = this.parse.bind(this), this.safeParse = this.safeParse.bind(this), this.parseAsync = this.parseAsync.bind(this), this.safeParseAsync = this.safeParseAsync.bind(this), this.spa = this.spa.bind(this), this.refine = this.refine.bind(this), this.refinement = this.refinement.bind(this), this.superRefine = this.superRefine.bind(this), this.optional = this.optional.bind(this), this.nullable = this.nullable.bind(this), this.nullish = this.nullish.bind(this), this.array = this.array.bind(this), this.promise = this.promise.bind(this), this.or = this.or.bind(this), this.and = this.and.bind(this), this.transform = this.transform.bind(this), this.brand = this.brand.bind(this), this.default = this.default.bind(this), this.catch = this.catch.bind(this), this.describe = this.describe.bind(this), this.pipe = this.pipe.bind(this), this.readonly = this.readonly.bind(this), this.isNullable = this.isNullable.bind(this), this.isOptional = this.isOptional.bind(this), this["~standard"] = {
			version: 1,
			vendor: "zod",
			validate: (e) => this["~validate"](e)
		};
	}
	optional() {
		return kt.create(this, this._def);
	}
	nullable() {
		return At.create(this, this._def);
	}
	nullish() {
		return this.nullable().optional();
	}
	array() {
		return lt.create(this);
	}
	promise() {
		return Dt.create(this, this._def);
	}
	or(e) {
		return ft.create([this, e], this._def);
	}
	and(e) {
		return gt.create(this, e, this._def);
	}
	transform(e) {
		return new Ot({
			...k(this._def),
			schema: this,
			typeName: j.ZodEffects,
			effect: {
				type: "transform",
				transform: e
			}
		});
	}
	default(e) {
		let t = typeof e == "function" ? e : () => e;
		return new jt({
			...k(this._def),
			innerType: this,
			defaultValue: t,
			typeName: j.ZodDefault
		});
	}
	brand() {
		return new Pt({
			typeName: j.ZodBranded,
			type: this,
			...k(this._def)
		});
	}
	catch(e) {
		let t = typeof e == "function" ? e : () => e;
		return new Mt({
			...k(this._def),
			innerType: this,
			catchValue: t,
			typeName: j.ZodCatch
		});
	}
	describe(e) {
		let t = this.constructor;
		return new t({
			...this._def,
			description: e
		});
	}
	pipe(e) {
		return Ft.create(this, e);
	}
	readonly() {
		return It.create(this);
	}
	isOptional() {
		return this.safeParse(void 0).success;
	}
	isNullable() {
		return this.safeParse(null).success;
	}
}, Ee = /^c[^\s-]{8,}$/i, De = /^[0-9a-z]+$/, Oe = /^[0-9A-HJKMNP-TV-Z]{26}$/i, ke = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i, Ae = /^[a-z0-9_-]{21}$/i, je = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/, Me = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/, Ne = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i, Pe = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", Fe, Ie = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Le = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/, Re = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/, ze = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, Be = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/, Ve = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/, He = "((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))", Ue = RegExp(`^${He}$`);
function We(e) {
	let t = "[0-5]\\d";
	e.precision ? t = `${t}\\.\\d{${e.precision}}` : e.precision ?? (t = `${t}(\\.\\d+)?`);
	let n = e.precision ? "+" : "?";
	return `([01]\\d|2[0-3]):[0-5]\\d(:${t})${n}`;
}
function Ge(e) {
	return RegExp(`^${We(e)}$`);
}
function Ke(e) {
	let t = `${He}T${We(e)}`, n = [];
	return n.push(e.local ? "Z?" : "Z"), e.offset && n.push("([+-]\\d{2}:?\\d{2})"), t = `${t}(${n.join("|")})`, RegExp(`^${t}$`);
}
function qe(e, t) {
	return !!((t === "v4" || !t) && Ie.test(e) || (t === "v6" || !t) && Re.test(e));
}
function Je(e, t) {
	if (!je.test(e)) return !1;
	try {
		let [n] = e.split(".");
		if (!n) return !1;
		let r = n.replace(/-/g, "+").replace(/_/g, "/").padEnd(n.length + (4 - n.length % 4) % 4, "="), i = JSON.parse(atob(r));
		return !(typeof i != "object" || !i || "typ" in i && i?.typ !== "JWT" || !i.alg || t && i.alg !== t);
	} catch {
		return !1;
	}
}
function Ye(e, t) {
	return !!((t === "v4" || !t) && Le.test(e) || (t === "v6" || !t) && ze.test(e));
}
var Xe = class e extends A {
	_parse(e) {
		if (this._def.coerce && (e.data = String(e.data)), this._getType(e) !== w.string) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.string,
				received: t.parsedType
			}), D;
		}
		let t = new _e(), n;
		for (let r of this._def.checks) if (r.kind === "min") e.data.length < r.value && (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.too_small,
			minimum: r.value,
			type: "string",
			inclusive: !0,
			exact: !1,
			message: r.message
		}), t.dirty());
		else if (r.kind === "max") e.data.length > r.value && (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.too_big,
			maximum: r.value,
			type: "string",
			inclusive: !0,
			exact: !1,
			message: r.message
		}), t.dirty());
		else if (r.kind === "length") {
			let i = e.data.length > r.value, a = e.data.length < r.value;
			(i || a) && (n = this._getOrReturnCtx(e, n), i ? E(n, {
				code: T.too_big,
				maximum: r.value,
				type: "string",
				inclusive: !0,
				exact: !0,
				message: r.message
			}) : a && E(n, {
				code: T.too_small,
				minimum: r.value,
				type: "string",
				inclusive: !0,
				exact: !0,
				message: r.message
			}), t.dirty());
		} else if (r.kind === "email") Ne.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "email",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "emoji") Fe ||= new RegExp(Pe, "u"), Fe.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "emoji",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "uuid") ke.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "uuid",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "nanoid") Ae.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "nanoid",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "cuid") Ee.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "cuid",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "cuid2") De.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "cuid2",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "ulid") Oe.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "ulid",
			code: T.invalid_string,
			message: r.message
		}), t.dirty());
		else if (r.kind === "url") try {
			new URL(e.data);
		} catch {
			n = this._getOrReturnCtx(e, n), E(n, {
				validation: "url",
				code: T.invalid_string,
				message: r.message
			}), t.dirty();
		}
		else r.kind === "regex" ? (r.regex.lastIndex = 0, r.regex.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "regex",
			code: T.invalid_string,
			message: r.message
		}), t.dirty())) : r.kind === "trim" ? e.data = e.data.trim() : r.kind === "includes" ? e.data.includes(r.value, r.position) || (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.invalid_string,
			validation: {
				includes: r.value,
				position: r.position
			},
			message: r.message
		}), t.dirty()) : r.kind === "toLowerCase" ? e.data = e.data.toLowerCase() : r.kind === "toUpperCase" ? e.data = e.data.toUpperCase() : r.kind === "startsWith" ? e.data.startsWith(r.value) || (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.invalid_string,
			validation: { startsWith: r.value },
			message: r.message
		}), t.dirty()) : r.kind === "endsWith" ? e.data.endsWith(r.value) || (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.invalid_string,
			validation: { endsWith: r.value },
			message: r.message
		}), t.dirty()) : r.kind === "datetime" ? Ke(r).test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.invalid_string,
			validation: "datetime",
			message: r.message
		}), t.dirty()) : r.kind === "date" ? Ue.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.invalid_string,
			validation: "date",
			message: r.message
		}), t.dirty()) : r.kind === "time" ? Ge(r).test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.invalid_string,
			validation: "time",
			message: r.message
		}), t.dirty()) : r.kind === "duration" ? Me.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "duration",
			code: T.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "ip" ? qe(e.data, r.version) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "ip",
			code: T.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "jwt" ? Je(e.data, r.alg) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "jwt",
			code: T.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "cidr" ? Ye(e.data, r.version) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "cidr",
			code: T.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "base64" ? Be.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "base64",
			code: T.invalid_string,
			message: r.message
		}), t.dirty()) : r.kind === "base64url" ? Ve.test(e.data) || (n = this._getOrReturnCtx(e, n), E(n, {
			validation: "base64url",
			code: T.invalid_string,
			message: r.message
		}), t.dirty()) : C.assertNever(r);
		return {
			status: t.value,
			value: e.data
		};
	}
	_regex(e, t, n) {
		return this.refinement((t) => e.test(t), {
			validation: t,
			code: T.invalid_string,
			...O.errToObj(n)
		});
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	email(e) {
		return this._addCheck({
			kind: "email",
			...O.errToObj(e)
		});
	}
	url(e) {
		return this._addCheck({
			kind: "url",
			...O.errToObj(e)
		});
	}
	emoji(e) {
		return this._addCheck({
			kind: "emoji",
			...O.errToObj(e)
		});
	}
	uuid(e) {
		return this._addCheck({
			kind: "uuid",
			...O.errToObj(e)
		});
	}
	nanoid(e) {
		return this._addCheck({
			kind: "nanoid",
			...O.errToObj(e)
		});
	}
	cuid(e) {
		return this._addCheck({
			kind: "cuid",
			...O.errToObj(e)
		});
	}
	cuid2(e) {
		return this._addCheck({
			kind: "cuid2",
			...O.errToObj(e)
		});
	}
	ulid(e) {
		return this._addCheck({
			kind: "ulid",
			...O.errToObj(e)
		});
	}
	base64(e) {
		return this._addCheck({
			kind: "base64",
			...O.errToObj(e)
		});
	}
	base64url(e) {
		return this._addCheck({
			kind: "base64url",
			...O.errToObj(e)
		});
	}
	jwt(e) {
		return this._addCheck({
			kind: "jwt",
			...O.errToObj(e)
		});
	}
	ip(e) {
		return this._addCheck({
			kind: "ip",
			...O.errToObj(e)
		});
	}
	cidr(e) {
		return this._addCheck({
			kind: "cidr",
			...O.errToObj(e)
		});
	}
	datetime(e) {
		return typeof e == "string" ? this._addCheck({
			kind: "datetime",
			precision: null,
			offset: !1,
			local: !1,
			message: e
		}) : this._addCheck({
			kind: "datetime",
			precision: e?.precision === void 0 ? null : e?.precision,
			offset: e?.offset ?? !1,
			local: e?.local ?? !1,
			...O.errToObj(e?.message)
		});
	}
	date(e) {
		return this._addCheck({
			kind: "date",
			message: e
		});
	}
	time(e) {
		return typeof e == "string" ? this._addCheck({
			kind: "time",
			precision: null,
			message: e
		}) : this._addCheck({
			kind: "time",
			precision: e?.precision === void 0 ? null : e?.precision,
			...O.errToObj(e?.message)
		});
	}
	duration(e) {
		return this._addCheck({
			kind: "duration",
			...O.errToObj(e)
		});
	}
	regex(e, t) {
		return this._addCheck({
			kind: "regex",
			regex: e,
			...O.errToObj(t)
		});
	}
	includes(e, t) {
		return this._addCheck({
			kind: "includes",
			value: e,
			position: t?.position,
			...O.errToObj(t?.message)
		});
	}
	startsWith(e, t) {
		return this._addCheck({
			kind: "startsWith",
			value: e,
			...O.errToObj(t)
		});
	}
	endsWith(e, t) {
		return this._addCheck({
			kind: "endsWith",
			value: e,
			...O.errToObj(t)
		});
	}
	min(e, t) {
		return this._addCheck({
			kind: "min",
			value: e,
			...O.errToObj(t)
		});
	}
	max(e, t) {
		return this._addCheck({
			kind: "max",
			value: e,
			...O.errToObj(t)
		});
	}
	length(e, t) {
		return this._addCheck({
			kind: "length",
			value: e,
			...O.errToObj(t)
		});
	}
	nonempty(e) {
		return this.min(1, O.errToObj(e));
	}
	trim() {
		return new e({
			...this._def,
			checks: [...this._def.checks, { kind: "trim" }]
		});
	}
	toLowerCase() {
		return new e({
			...this._def,
			checks: [...this._def.checks, { kind: "toLowerCase" }]
		});
	}
	toUpperCase() {
		return new e({
			...this._def,
			checks: [...this._def.checks, { kind: "toUpperCase" }]
		});
	}
	get isDatetime() {
		return !!this._def.checks.find((e) => e.kind === "datetime");
	}
	get isDate() {
		return !!this._def.checks.find((e) => e.kind === "date");
	}
	get isTime() {
		return !!this._def.checks.find((e) => e.kind === "time");
	}
	get isDuration() {
		return !!this._def.checks.find((e) => e.kind === "duration");
	}
	get isEmail() {
		return !!this._def.checks.find((e) => e.kind === "email");
	}
	get isURL() {
		return !!this._def.checks.find((e) => e.kind === "url");
	}
	get isEmoji() {
		return !!this._def.checks.find((e) => e.kind === "emoji");
	}
	get isUUID() {
		return !!this._def.checks.find((e) => e.kind === "uuid");
	}
	get isNANOID() {
		return !!this._def.checks.find((e) => e.kind === "nanoid");
	}
	get isCUID() {
		return !!this._def.checks.find((e) => e.kind === "cuid");
	}
	get isCUID2() {
		return !!this._def.checks.find((e) => e.kind === "cuid2");
	}
	get isULID() {
		return !!this._def.checks.find((e) => e.kind === "ulid");
	}
	get isIP() {
		return !!this._def.checks.find((e) => e.kind === "ip");
	}
	get isCIDR() {
		return !!this._def.checks.find((e) => e.kind === "cidr");
	}
	get isBase64() {
		return !!this._def.checks.find((e) => e.kind === "base64");
	}
	get isBase64url() {
		return !!this._def.checks.find((e) => e.kind === "base64url");
	}
	get minLength() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e;
	}
	get maxLength() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e;
	}
};
Xe.create = (e) => new Xe({
	checks: [],
	typeName: j.ZodString,
	coerce: e?.coerce ?? !1,
	...k(e)
});
function Ze(e, t) {
	let n = (e.toString().split(".")[1] || "").length, r = (t.toString().split(".")[1] || "").length, i = n > r ? n : r;
	return Number.parseInt(e.toFixed(i).replace(".", "")) % Number.parseInt(t.toFixed(i).replace(".", "")) / 10 ** i;
}
var Qe = class e extends A {
	constructor() {
		super(...arguments), this.min = this.gte, this.max = this.lte, this.step = this.multipleOf;
	}
	_parse(e) {
		if (this._def.coerce && (e.data = Number(e.data)), this._getType(e) !== w.number) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.number,
				received: t.parsedType
			}), D;
		}
		let t, n = new _e();
		for (let r of this._def.checks) r.kind === "int" ? C.isInteger(e.data) || (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.invalid_type,
			expected: "integer",
			received: "float",
			message: r.message
		}), n.dirty()) : r.kind === "min" ? (r.inclusive ? e.data < r.value : e.data <= r.value) && (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.too_small,
			minimum: r.value,
			type: "number",
			inclusive: r.inclusive,
			exact: !1,
			message: r.message
		}), n.dirty()) : r.kind === "max" ? (r.inclusive ? e.data > r.value : e.data >= r.value) && (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.too_big,
			maximum: r.value,
			type: "number",
			inclusive: r.inclusive,
			exact: !1,
			message: r.message
		}), n.dirty()) : r.kind === "multipleOf" ? Ze(e.data, r.value) !== 0 && (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.not_multiple_of,
			multipleOf: r.value,
			message: r.message
		}), n.dirty()) : r.kind === "finite" ? Number.isFinite(e.data) || (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.not_finite,
			message: r.message
		}), n.dirty()) : C.assertNever(r);
		return {
			status: n.value,
			value: e.data
		};
	}
	gte(e, t) {
		return this.setLimit("min", e, !0, O.toString(t));
	}
	gt(e, t) {
		return this.setLimit("min", e, !1, O.toString(t));
	}
	lte(e, t) {
		return this.setLimit("max", e, !0, O.toString(t));
	}
	lt(e, t) {
		return this.setLimit("max", e, !1, O.toString(t));
	}
	setLimit(t, n, r, i) {
		return new e({
			...this._def,
			checks: [...this._def.checks, {
				kind: t,
				value: n,
				inclusive: r,
				message: O.toString(i)
			}]
		});
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	int(e) {
		return this._addCheck({
			kind: "int",
			message: O.toString(e)
		});
	}
	positive(e) {
		return this._addCheck({
			kind: "min",
			value: 0,
			inclusive: !1,
			message: O.toString(e)
		});
	}
	negative(e) {
		return this._addCheck({
			kind: "max",
			value: 0,
			inclusive: !1,
			message: O.toString(e)
		});
	}
	nonpositive(e) {
		return this._addCheck({
			kind: "max",
			value: 0,
			inclusive: !0,
			message: O.toString(e)
		});
	}
	nonnegative(e) {
		return this._addCheck({
			kind: "min",
			value: 0,
			inclusive: !0,
			message: O.toString(e)
		});
	}
	multipleOf(e, t) {
		return this._addCheck({
			kind: "multipleOf",
			value: e,
			message: O.toString(t)
		});
	}
	finite(e) {
		return this._addCheck({
			kind: "finite",
			message: O.toString(e)
		});
	}
	safe(e) {
		return this._addCheck({
			kind: "min",
			inclusive: !0,
			value: -(2 ** 53 - 1),
			message: O.toString(e)
		})._addCheck({
			kind: "max",
			inclusive: !0,
			value: 2 ** 53 - 1,
			message: O.toString(e)
		});
	}
	get minValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e;
	}
	get maxValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e;
	}
	get isInt() {
		return !!this._def.checks.find((e) => e.kind === "int" || e.kind === "multipleOf" && C.isInteger(e.value));
	}
	get isFinite() {
		let e = null, t = null;
		for (let n of this._def.checks) if (n.kind === "finite" || n.kind === "int" || n.kind === "multipleOf") return !0;
		else n.kind === "min" ? (t === null || n.value > t) && (t = n.value) : n.kind === "max" && (e === null || n.value < e) && (e = n.value);
		return Number.isFinite(t) && Number.isFinite(e);
	}
};
Qe.create = (e) => new Qe({
	checks: [],
	typeName: j.ZodNumber,
	coerce: e?.coerce || !1,
	...k(e)
});
var $e = class e extends A {
	constructor() {
		super(...arguments), this.min = this.gte, this.max = this.lte;
	}
	_parse(e) {
		if (this._def.coerce) try {
			e.data = BigInt(e.data);
		} catch {
			return this._getInvalidInput(e);
		}
		if (this._getType(e) !== w.bigint) return this._getInvalidInput(e);
		let t, n = new _e();
		for (let r of this._def.checks) r.kind === "min" ? (r.inclusive ? e.data < r.value : e.data <= r.value) && (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.too_small,
			type: "bigint",
			minimum: r.value,
			inclusive: r.inclusive,
			message: r.message
		}), n.dirty()) : r.kind === "max" ? (r.inclusive ? e.data > r.value : e.data >= r.value) && (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.too_big,
			type: "bigint",
			maximum: r.value,
			inclusive: r.inclusive,
			message: r.message
		}), n.dirty()) : r.kind === "multipleOf" ? e.data % r.value !== BigInt(0) && (t = this._getOrReturnCtx(e, t), E(t, {
			code: T.not_multiple_of,
			multipleOf: r.value,
			message: r.message
		}), n.dirty()) : C.assertNever(r);
		return {
			status: n.value,
			value: e.data
		};
	}
	_getInvalidInput(e) {
		let t = this._getOrReturnCtx(e);
		return E(t, {
			code: T.invalid_type,
			expected: w.bigint,
			received: t.parsedType
		}), D;
	}
	gte(e, t) {
		return this.setLimit("min", e, !0, O.toString(t));
	}
	gt(e, t) {
		return this.setLimit("min", e, !1, O.toString(t));
	}
	lte(e, t) {
		return this.setLimit("max", e, !0, O.toString(t));
	}
	lt(e, t) {
		return this.setLimit("max", e, !1, O.toString(t));
	}
	setLimit(t, n, r, i) {
		return new e({
			...this._def,
			checks: [...this._def.checks, {
				kind: t,
				value: n,
				inclusive: r,
				message: O.toString(i)
			}]
		});
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	positive(e) {
		return this._addCheck({
			kind: "min",
			value: BigInt(0),
			inclusive: !1,
			message: O.toString(e)
		});
	}
	negative(e) {
		return this._addCheck({
			kind: "max",
			value: BigInt(0),
			inclusive: !1,
			message: O.toString(e)
		});
	}
	nonpositive(e) {
		return this._addCheck({
			kind: "max",
			value: BigInt(0),
			inclusive: !0,
			message: O.toString(e)
		});
	}
	nonnegative(e) {
		return this._addCheck({
			kind: "min",
			value: BigInt(0),
			inclusive: !0,
			message: O.toString(e)
		});
	}
	multipleOf(e, t) {
		return this._addCheck({
			kind: "multipleOf",
			value: e,
			message: O.toString(t)
		});
	}
	get minValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e;
	}
	get maxValue() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e;
	}
};
$e.create = (e) => new $e({
	checks: [],
	typeName: j.ZodBigInt,
	coerce: e?.coerce ?? !1,
	...k(e)
});
var et = class extends A {
	_parse(e) {
		if (this._def.coerce && (e.data = !!e.data), this._getType(e) !== w.boolean) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.boolean,
				received: t.parsedType
			}), D;
		}
		return ye(e.data);
	}
};
et.create = (e) => new et({
	typeName: j.ZodBoolean,
	coerce: e?.coerce || !1,
	...k(e)
});
var tt = class e extends A {
	_parse(e) {
		if (this._def.coerce && (e.data = new Date(e.data)), this._getType(e) !== w.date) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.date,
				received: t.parsedType
			}), D;
		}
		if (Number.isNaN(e.data.getTime())) return E(this._getOrReturnCtx(e), { code: T.invalid_date }), D;
		let t = new _e(), n;
		for (let r of this._def.checks) r.kind === "min" ? e.data.getTime() < r.value && (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.too_small,
			message: r.message,
			inclusive: !0,
			exact: !1,
			minimum: r.value,
			type: "date"
		}), t.dirty()) : r.kind === "max" ? e.data.getTime() > r.value && (n = this._getOrReturnCtx(e, n), E(n, {
			code: T.too_big,
			message: r.message,
			inclusive: !0,
			exact: !1,
			maximum: r.value,
			type: "date"
		}), t.dirty()) : C.assertNever(r);
		return {
			status: t.value,
			value: new Date(e.data.getTime())
		};
	}
	_addCheck(t) {
		return new e({
			...this._def,
			checks: [...this._def.checks, t]
		});
	}
	min(e, t) {
		return this._addCheck({
			kind: "min",
			value: e.getTime(),
			message: O.toString(t)
		});
	}
	max(e, t) {
		return this._addCheck({
			kind: "max",
			value: e.getTime(),
			message: O.toString(t)
		});
	}
	get minDate() {
		let e = null;
		for (let t of this._def.checks) t.kind === "min" && (e === null || t.value > e) && (e = t.value);
		return e == null ? null : new Date(e);
	}
	get maxDate() {
		let e = null;
		for (let t of this._def.checks) t.kind === "max" && (e === null || t.value < e) && (e = t.value);
		return e == null ? null : new Date(e);
	}
};
tt.create = (e) => new tt({
	checks: [],
	coerce: e?.coerce || !1,
	typeName: j.ZodDate,
	...k(e)
});
var nt = class extends A {
	_parse(e) {
		if (this._getType(e) !== w.symbol) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.symbol,
				received: t.parsedType
			}), D;
		}
		return ye(e.data);
	}
};
nt.create = (e) => new nt({
	typeName: j.ZodSymbol,
	...k(e)
});
var rt = class extends A {
	_parse(e) {
		if (this._getType(e) !== w.undefined) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.undefined,
				received: t.parsedType
			}), D;
		}
		return ye(e.data);
	}
};
rt.create = (e) => new rt({
	typeName: j.ZodUndefined,
	...k(e)
});
var it = class extends A {
	_parse(e) {
		if (this._getType(e) !== w.null) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.null,
				received: t.parsedType
			}), D;
		}
		return ye(e.data);
	}
};
it.create = (e) => new it({
	typeName: j.ZodNull,
	...k(e)
});
var at = class extends A {
	constructor() {
		super(...arguments), this._any = !0;
	}
	_parse(e) {
		return ye(e.data);
	}
};
at.create = (e) => new at({
	typeName: j.ZodAny,
	...k(e)
});
var ot = class extends A {
	constructor() {
		super(...arguments), this._unknown = !0;
	}
	_parse(e) {
		return ye(e.data);
	}
};
ot.create = (e) => new ot({
	typeName: j.ZodUnknown,
	...k(e)
});
var st = class extends A {
	_parse(e) {
		let t = this._getOrReturnCtx(e);
		return E(t, {
			code: T.invalid_type,
			expected: w.never,
			received: t.parsedType
		}), D;
	}
};
st.create = (e) => new st({
	typeName: j.ZodNever,
	...k(e)
});
var ct = class extends A {
	_parse(e) {
		if (this._getType(e) !== w.undefined) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.void,
				received: t.parsedType
			}), D;
		}
		return ye(e.data);
	}
};
ct.create = (e) => new ct({
	typeName: j.ZodVoid,
	...k(e)
});
var lt = class e extends A {
	_parse(e) {
		let { ctx: t, status: n } = this._processInputParams(e), r = this._def;
		if (t.parsedType !== w.array) return E(t, {
			code: T.invalid_type,
			expected: w.array,
			received: t.parsedType
		}), D;
		if (r.exactLength !== null) {
			let e = t.data.length > r.exactLength.value, i = t.data.length < r.exactLength.value;
			(e || i) && (E(t, {
				code: e ? T.too_big : T.too_small,
				minimum: i ? r.exactLength.value : void 0,
				maximum: e ? r.exactLength.value : void 0,
				type: "array",
				inclusive: !0,
				exact: !0,
				message: r.exactLength.message
			}), n.dirty());
		}
		if (r.minLength !== null && t.data.length < r.minLength.value && (E(t, {
			code: T.too_small,
			minimum: r.minLength.value,
			type: "array",
			inclusive: !0,
			exact: !1,
			message: r.minLength.message
		}), n.dirty()), r.maxLength !== null && t.data.length > r.maxLength.value && (E(t, {
			code: T.too_big,
			maximum: r.maxLength.value,
			type: "array",
			inclusive: !0,
			exact: !1,
			message: r.maxLength.message
		}), n.dirty()), t.common.async) return Promise.all([...t.data].map((e, n) => r.type._parseAsync(new we(t, e, t.path, n)))).then((e) => _e.mergeArray(n, e));
		let i = [...t.data].map((e, n) => r.type._parseSync(new we(t, e, t.path, n)));
		return _e.mergeArray(n, i);
	}
	get element() {
		return this._def.type;
	}
	min(t, n) {
		return new e({
			...this._def,
			minLength: {
				value: t,
				message: O.toString(n)
			}
		});
	}
	max(t, n) {
		return new e({
			...this._def,
			maxLength: {
				value: t,
				message: O.toString(n)
			}
		});
	}
	length(t, n) {
		return new e({
			...this._def,
			exactLength: {
				value: t,
				message: O.toString(n)
			}
		});
	}
	nonempty(e) {
		return this.min(1, e);
	}
};
lt.create = (e, t) => new lt({
	type: e,
	minLength: null,
	maxLength: null,
	exactLength: null,
	typeName: j.ZodArray,
	...k(t)
});
function ut(e) {
	if (e instanceof dt) {
		let t = {};
		for (let n in e.shape) {
			let r = e.shape[n];
			t[n] = kt.create(ut(r));
		}
		return new dt({
			...e._def,
			shape: () => t
		});
	}
	return e instanceof lt ? new lt({
		...e._def,
		type: ut(e.element)
	}) : e instanceof kt ? kt.create(ut(e.unwrap())) : e instanceof At ? At.create(ut(e.unwrap())) : e instanceof _t ? _t.create(e.items.map((e) => ut(e))) : e;
}
var dt = class e extends A {
	constructor() {
		super(...arguments), this._cached = null, this.nonstrict = this.passthrough, this.augment = this.extend;
	}
	_getCached() {
		if (this._cached !== null) return this._cached;
		let e = this._def.shape(), t = C.objectKeys(e);
		return this._cached = {
			shape: e,
			keys: t
		}, this._cached;
	}
	_parse(e) {
		if (this._getType(e) !== w.object) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.object,
				received: t.parsedType
			}), D;
		}
		let { status: t, ctx: n } = this._processInputParams(e), { shape: r, keys: i } = this._getCached(), a = [];
		if (!(this._def.catchall instanceof st && this._def.unknownKeys === "strip")) for (let e in n.data) i.includes(e) || a.push(e);
		let o = [];
		for (let e of i) {
			let t = r[e], i = n.data[e];
			o.push({
				key: {
					status: "valid",
					value: e
				},
				value: t._parse(new we(n, i, n.path, e)),
				alwaysSet: e in n.data
			});
		}
		if (this._def.catchall instanceof st) {
			let e = this._def.unknownKeys;
			if (e === "passthrough") for (let e of a) o.push({
				key: {
					status: "valid",
					value: e
				},
				value: {
					status: "valid",
					value: n.data[e]
				}
			});
			else if (e === "strict") a.length > 0 && (E(n, {
				code: T.unrecognized_keys,
				keys: a
			}), t.dirty());
			else if (e !== "strip") throw Error("Internal ZodObject error: invalid unknownKeys value.");
		} else {
			let e = this._def.catchall;
			for (let t of a) {
				let r = n.data[t];
				o.push({
					key: {
						status: "valid",
						value: t
					},
					value: e._parse(new we(n, r, n.path, t)),
					alwaysSet: t in n.data
				});
			}
		}
		return n.common.async ? Promise.resolve().then(async () => {
			let e = [];
			for (let t of o) {
				let n = await t.key, r = await t.value;
				e.push({
					key: n,
					value: r,
					alwaysSet: t.alwaysSet
				});
			}
			return e;
		}).then((e) => _e.mergeObjectSync(t, e)) : _e.mergeObjectSync(t, o);
	}
	get shape() {
		return this._def.shape();
	}
	strict(t) {
		return O.errToObj, new e({
			...this._def,
			unknownKeys: "strict",
			...t === void 0 ? {} : { errorMap: (e, n) => {
				let r = this._def.errorMap?.(e, n).message ?? n.defaultError;
				return e.code === "unrecognized_keys" ? { message: O.errToObj(t).message ?? r } : { message: r };
			} }
		});
	}
	strip() {
		return new e({
			...this._def,
			unknownKeys: "strip"
		});
	}
	passthrough() {
		return new e({
			...this._def,
			unknownKeys: "passthrough"
		});
	}
	extend(t) {
		return new e({
			...this._def,
			shape: () => ({
				...this._def.shape(),
				...t
			})
		});
	}
	merge(t) {
		return new e({
			unknownKeys: t._def.unknownKeys,
			catchall: t._def.catchall,
			shape: () => ({
				...this._def.shape(),
				...t._def.shape()
			}),
			typeName: j.ZodObject
		});
	}
	setKey(e, t) {
		return this.augment({ [e]: t });
	}
	catchall(t) {
		return new e({
			...this._def,
			catchall: t
		});
	}
	pick(t) {
		let n = {};
		for (let e of C.objectKeys(t)) t[e] && this.shape[e] && (n[e] = this.shape[e]);
		return new e({
			...this._def,
			shape: () => n
		});
	}
	omit(t) {
		let n = {};
		for (let e of C.objectKeys(this.shape)) t[e] || (n[e] = this.shape[e]);
		return new e({
			...this._def,
			shape: () => n
		});
	}
	deepPartial() {
		return ut(this);
	}
	partial(t) {
		let n = {};
		for (let e of C.objectKeys(this.shape)) {
			let r = this.shape[e];
			n[e] = t && !t[e] ? r : r.optional();
		}
		return new e({
			...this._def,
			shape: () => n
		});
	}
	required(t) {
		let n = {};
		for (let e of C.objectKeys(this.shape)) if (t && !t[e]) n[e] = this.shape[e];
		else {
			let t = this.shape[e];
			for (; t instanceof kt;) t = t._def.innerType;
			n[e] = t;
		}
		return new e({
			...this._def,
			shape: () => n
		});
	}
	keyof() {
		return wt(C.objectKeys(this.shape));
	}
};
dt.create = (e, t) => new dt({
	shape: () => e,
	unknownKeys: "strip",
	catchall: st.create(),
	typeName: j.ZodObject,
	...k(t)
}), dt.strictCreate = (e, t) => new dt({
	shape: () => e,
	unknownKeys: "strict",
	catchall: st.create(),
	typeName: j.ZodObject,
	...k(t)
}), dt.lazycreate = (e, t) => new dt({
	shape: e,
	unknownKeys: "strip",
	catchall: st.create(),
	typeName: j.ZodObject,
	...k(t)
});
var ft = class extends A {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = this._def.options;
		function r(e) {
			for (let t of e) if (t.result.status === "valid") return t.result;
			for (let n of e) if (n.result.status === "dirty") return t.common.issues.push(...n.ctx.common.issues), n.result;
			let n = e.map((e) => new fe(e.ctx.common.issues));
			return E(t, {
				code: T.invalid_union,
				unionErrors: n
			}), D;
		}
		if (t.common.async) return Promise.all(n.map(async (e) => {
			let n = {
				...t,
				common: {
					...t.common,
					issues: []
				},
				parent: null
			};
			return {
				result: await e._parseAsync({
					data: t.data,
					path: t.path,
					parent: n
				}),
				ctx: n
			};
		})).then(r);
		{
			let e, r = [];
			for (let i of n) {
				let n = {
					...t,
					common: {
						...t.common,
						issues: []
					},
					parent: null
				}, a = i._parseSync({
					data: t.data,
					path: t.path,
					parent: n
				});
				if (a.status === "valid") return a;
				a.status === "dirty" && !e && (e = {
					result: a,
					ctx: n
				}), n.common.issues.length && r.push(n.common.issues);
			}
			if (e) return t.common.issues.push(...e.ctx.common.issues), e.result;
			let i = r.map((e) => new fe(e));
			return E(t, {
				code: T.invalid_union,
				unionErrors: i
			}), D;
		}
	}
	get options() {
		return this._def.options;
	}
};
ft.create = (e, t) => new ft({
	options: e,
	typeName: j.ZodUnion,
	...k(t)
});
var pt = (e) => e instanceof St ? pt(e.schema) : e instanceof Ot ? pt(e.innerType()) : e instanceof Ct ? [e.value] : e instanceof Tt ? e.options : e instanceof Et ? C.objectValues(e.enum) : e instanceof jt ? pt(e._def.innerType) : e instanceof rt ? [void 0] : e instanceof it ? [null] : e instanceof kt ? [void 0, ...pt(e.unwrap())] : e instanceof At ? [null, ...pt(e.unwrap())] : e instanceof Pt || e instanceof It ? pt(e.unwrap()) : e instanceof Mt ? pt(e._def.innerType) : [], mt = class e extends A {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		if (t.parsedType !== w.object) return E(t, {
			code: T.invalid_type,
			expected: w.object,
			received: t.parsedType
		}), D;
		let n = this.discriminator, r = t.data[n], i = this.optionsMap.get(r);
		return i ? t.common.async ? i._parseAsync({
			data: t.data,
			path: t.path,
			parent: t
		}) : i._parseSync({
			data: t.data,
			path: t.path,
			parent: t
		}) : (E(t, {
			code: T.invalid_union_discriminator,
			options: Array.from(this.optionsMap.keys()),
			path: [n]
		}), D);
	}
	get discriminator() {
		return this._def.discriminator;
	}
	get options() {
		return this._def.options;
	}
	get optionsMap() {
		return this._def.optionsMap;
	}
	static create(t, n, r) {
		let i = /* @__PURE__ */ new Map();
		for (let e of n) {
			let n = pt(e.shape[t]);
			if (!n.length) throw Error(`A discriminator value for key \`${t}\` could not be extracted from all schema options`);
			for (let r of n) {
				if (i.has(r)) throw Error(`Discriminator property ${String(t)} has duplicate value ${String(r)}`);
				i.set(r, e);
			}
		}
		return new e({
			typeName: j.ZodDiscriminatedUnion,
			discriminator: t,
			options: n,
			optionsMap: i,
			...k(r)
		});
	}
};
function ht(e, t) {
	let n = de(e), r = de(t);
	if (e === t) return {
		valid: !0,
		data: e
	};
	if (n === w.object && r === w.object) {
		let n = C.objectKeys(t), r = C.objectKeys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = ht(e[n], t[n]);
			if (!r.valid) return { valid: !1 };
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (n === w.array && r === w.array) {
		if (e.length !== t.length) return { valid: !1 };
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = ht(i, a);
			if (!o.valid) return { valid: !1 };
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return n === w.date && r === w.date && +e == +t ? {
		valid: !0,
		data: e
	} : { valid: !1 };
}
var gt = class extends A {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e), r = (e, r) => {
			if (be(e) || be(r)) return D;
			let i = ht(e.value, r.value);
			return i.valid ? ((xe(e) || xe(r)) && t.dirty(), {
				status: t.value,
				value: i.data
			}) : (E(n, { code: T.invalid_intersection_types }), D);
		};
		return n.common.async ? Promise.all([this._def.left._parseAsync({
			data: n.data,
			path: n.path,
			parent: n
		}), this._def.right._parseAsync({
			data: n.data,
			path: n.path,
			parent: n
		})]).then(([e, t]) => r(e, t)) : r(this._def.left._parseSync({
			data: n.data,
			path: n.path,
			parent: n
		}), this._def.right._parseSync({
			data: n.data,
			path: n.path,
			parent: n
		}));
	}
};
gt.create = (e, t, n) => new gt({
	left: e,
	right: t,
	typeName: j.ZodIntersection,
	...k(n)
});
var _t = class e extends A {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== w.array) return E(n, {
			code: T.invalid_type,
			expected: w.array,
			received: n.parsedType
		}), D;
		if (n.data.length < this._def.items.length) return E(n, {
			code: T.too_small,
			minimum: this._def.items.length,
			inclusive: !0,
			exact: !1,
			type: "array"
		}), D;
		!this._def.rest && n.data.length > this._def.items.length && (E(n, {
			code: T.too_big,
			maximum: this._def.items.length,
			inclusive: !0,
			exact: !1,
			type: "array"
		}), t.dirty());
		let r = [...n.data].map((e, t) => {
			let r = this._def.items[t] || this._def.rest;
			return r ? r._parse(new we(n, e, n.path, t)) : null;
		}).filter((e) => !!e);
		return n.common.async ? Promise.all(r).then((e) => _e.mergeArray(t, e)) : _e.mergeArray(t, r);
	}
	get items() {
		return this._def.items;
	}
	rest(t) {
		return new e({
			...this._def,
			rest: t
		});
	}
};
_t.create = (e, t) => {
	if (!Array.isArray(e)) throw Error("You must pass an array of schemas to z.tuple([ ... ])");
	return new _t({
		items: e,
		typeName: j.ZodTuple,
		rest: null,
		...k(t)
	});
};
var vt = class e extends A {
	get keySchema() {
		return this._def.keyType;
	}
	get valueSchema() {
		return this._def.valueType;
	}
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== w.object) return E(n, {
			code: T.invalid_type,
			expected: w.object,
			received: n.parsedType
		}), D;
		let r = [], i = this._def.keyType, a = this._def.valueType;
		for (let e in n.data) r.push({
			key: i._parse(new we(n, e, n.path, e)),
			value: a._parse(new we(n, n.data[e], n.path, e)),
			alwaysSet: e in n.data
		});
		return n.common.async ? _e.mergeObjectAsync(t, r) : _e.mergeObjectSync(t, r);
	}
	get element() {
		return this._def.valueType;
	}
	static create(t, n, r) {
		return n instanceof A ? new e({
			keyType: t,
			valueType: n,
			typeName: j.ZodRecord,
			...k(r)
		}) : new e({
			keyType: Xe.create(),
			valueType: t,
			typeName: j.ZodRecord,
			...k(n)
		});
	}
}, yt = class extends A {
	get keySchema() {
		return this._def.keyType;
	}
	get valueSchema() {
		return this._def.valueType;
	}
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== w.map) return E(n, {
			code: T.invalid_type,
			expected: w.map,
			received: n.parsedType
		}), D;
		let r = this._def.keyType, i = this._def.valueType, a = [...n.data.entries()].map(([e, t], a) => ({
			key: r._parse(new we(n, e, n.path, [a, "key"])),
			value: i._parse(new we(n, t, n.path, [a, "value"]))
		}));
		if (n.common.async) {
			let e = /* @__PURE__ */ new Map();
			return Promise.resolve().then(async () => {
				for (let n of a) {
					let r = await n.key, i = await n.value;
					if (r.status === "aborted" || i.status === "aborted") return D;
					(r.status === "dirty" || i.status === "dirty") && t.dirty(), e.set(r.value, i.value);
				}
				return {
					status: t.value,
					value: e
				};
			});
		}
		{
			let e = /* @__PURE__ */ new Map();
			for (let n of a) {
				let r = n.key, i = n.value;
				if (r.status === "aborted" || i.status === "aborted") return D;
				(r.status === "dirty" || i.status === "dirty") && t.dirty(), e.set(r.value, i.value);
			}
			return {
				status: t.value,
				value: e
			};
		}
	}
};
yt.create = (e, t, n) => new yt({
	valueType: t,
	keyType: e,
	typeName: j.ZodMap,
	...k(n)
});
var bt = class e extends A {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.parsedType !== w.set) return E(n, {
			code: T.invalid_type,
			expected: w.set,
			received: n.parsedType
		}), D;
		let r = this._def;
		r.minSize !== null && n.data.size < r.minSize.value && (E(n, {
			code: T.too_small,
			minimum: r.minSize.value,
			type: "set",
			inclusive: !0,
			exact: !1,
			message: r.minSize.message
		}), t.dirty()), r.maxSize !== null && n.data.size > r.maxSize.value && (E(n, {
			code: T.too_big,
			maximum: r.maxSize.value,
			type: "set",
			inclusive: !0,
			exact: !1,
			message: r.maxSize.message
		}), t.dirty());
		let i = this._def.valueType;
		function a(e) {
			let n = /* @__PURE__ */ new Set();
			for (let r of e) {
				if (r.status === "aborted") return D;
				r.status === "dirty" && t.dirty(), n.add(r.value);
			}
			return {
				status: t.value,
				value: n
			};
		}
		let o = [...n.data.values()].map((e, t) => i._parse(new we(n, e, n.path, t)));
		return n.common.async ? Promise.all(o).then((e) => a(e)) : a(o);
	}
	min(t, n) {
		return new e({
			...this._def,
			minSize: {
				value: t,
				message: O.toString(n)
			}
		});
	}
	max(t, n) {
		return new e({
			...this._def,
			maxSize: {
				value: t,
				message: O.toString(n)
			}
		});
	}
	size(e, t) {
		return this.min(e, t).max(e, t);
	}
	nonempty(e) {
		return this.min(1, e);
	}
};
bt.create = (e, t) => new bt({
	valueType: e,
	minSize: null,
	maxSize: null,
	typeName: j.ZodSet,
	...k(t)
});
var xt = class e extends A {
	constructor() {
		super(...arguments), this.validate = this.implement;
	}
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		if (t.parsedType !== w.function) return E(t, {
			code: T.invalid_type,
			expected: w.function,
			received: t.parsedType
		}), D;
		function n(e, n) {
			return ge({
				data: e,
				path: t.path,
				errorMaps: [
					t.common.contextualErrorMap,
					t.schemaErrorMap,
					he(),
					pe
				].filter((e) => !!e),
				issueData: {
					code: T.invalid_arguments,
					argumentsError: n
				}
			});
		}
		function r(e, n) {
			return ge({
				data: e,
				path: t.path,
				errorMaps: [
					t.common.contextualErrorMap,
					t.schemaErrorMap,
					he(),
					pe
				].filter((e) => !!e),
				issueData: {
					code: T.invalid_return_type,
					returnTypeError: n
				}
			});
		}
		let i = { errorMap: t.common.contextualErrorMap }, a = t.data;
		if (this._def.returns instanceof Dt) {
			let e = this;
			return ye(async function(...t) {
				let o = new fe([]), s = await e._def.args.parseAsync(t, i).catch((e) => {
					throw o.addIssue(n(t, e)), o;
				}), c = await Reflect.apply(a, this, s);
				return await e._def.returns._def.type.parseAsync(c, i).catch((e) => {
					throw o.addIssue(r(c, e)), o;
				});
			});
		}
		{
			let e = this;
			return ye(function(...t) {
				let o = e._def.args.safeParse(t, i);
				if (!o.success) throw new fe([n(t, o.error)]);
				let s = Reflect.apply(a, this, o.data), c = e._def.returns.safeParse(s, i);
				if (!c.success) throw new fe([r(s, c.error)]);
				return c.data;
			});
		}
	}
	parameters() {
		return this._def.args;
	}
	returnType() {
		return this._def.returns;
	}
	args(...t) {
		return new e({
			...this._def,
			args: _t.create(t).rest(ot.create())
		});
	}
	returns(t) {
		return new e({
			...this._def,
			returns: t
		});
	}
	implement(e) {
		return this.parse(e);
	}
	strictImplement(e) {
		return this.parse(e);
	}
	static create(t, n, r) {
		return new e({
			args: t || _t.create([]).rest(ot.create()),
			returns: n || ot.create(),
			typeName: j.ZodFunction,
			...k(r)
		});
	}
}, St = class extends A {
	get schema() {
		return this._def.getter();
	}
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		return this._def.getter()._parse({
			data: t.data,
			path: t.path,
			parent: t
		});
	}
};
St.create = (e, t) => new St({
	getter: e,
	typeName: j.ZodLazy,
	...k(t)
});
var Ct = class extends A {
	_parse(e) {
		if (e.data !== this._def.value) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				received: t.data,
				code: T.invalid_literal,
				expected: this._def.value
			}), D;
		}
		return {
			status: "valid",
			value: e.data
		};
	}
	get value() {
		return this._def.value;
	}
};
Ct.create = (e, t) => new Ct({
	value: e,
	typeName: j.ZodLiteral,
	...k(t)
});
function wt(e, t) {
	return new Tt({
		values: e,
		typeName: j.ZodEnum,
		...k(t)
	});
}
var Tt = class e extends A {
	_parse(e) {
		if (typeof e.data != "string") {
			let t = this._getOrReturnCtx(e), n = this._def.values;
			return E(t, {
				expected: C.joinValues(n),
				received: t.parsedType,
				code: T.invalid_type
			}), D;
		}
		if (this._cache ||= new Set(this._def.values), !this._cache.has(e.data)) {
			let t = this._getOrReturnCtx(e), n = this._def.values;
			return E(t, {
				received: t.data,
				code: T.invalid_enum_value,
				options: n
			}), D;
		}
		return ye(e.data);
	}
	get options() {
		return this._def.values;
	}
	get enum() {
		let e = {};
		for (let t of this._def.values) e[t] = t;
		return e;
	}
	get Values() {
		let e = {};
		for (let t of this._def.values) e[t] = t;
		return e;
	}
	get Enum() {
		let e = {};
		for (let t of this._def.values) e[t] = t;
		return e;
	}
	extract(t, n = this._def) {
		return e.create(t, {
			...this._def,
			...n
		});
	}
	exclude(t, n = this._def) {
		return e.create(this.options.filter((e) => !t.includes(e)), {
			...this._def,
			...n
		});
	}
};
Tt.create = wt;
var Et = class extends A {
	_parse(e) {
		let t = C.getValidEnumValues(this._def.values), n = this._getOrReturnCtx(e);
		if (n.parsedType !== w.string && n.parsedType !== w.number) {
			let e = C.objectValues(t);
			return E(n, {
				expected: C.joinValues(e),
				received: n.parsedType,
				code: T.invalid_type
			}), D;
		}
		if (this._cache ||= new Set(C.getValidEnumValues(this._def.values)), !this._cache.has(e.data)) {
			let e = C.objectValues(t);
			return E(n, {
				received: n.data,
				code: T.invalid_enum_value,
				options: e
			}), D;
		}
		return ye(e.data);
	}
	get enum() {
		return this._def.values;
	}
};
Et.create = (e, t) => new Et({
	values: e,
	typeName: j.ZodNativeEnum,
	...k(t)
});
var Dt = class extends A {
	unwrap() {
		return this._def.type;
	}
	_parse(e) {
		let { ctx: t } = this._processInputParams(e);
		return t.parsedType !== w.promise && t.common.async === !1 ? (E(t, {
			code: T.invalid_type,
			expected: w.promise,
			received: t.parsedType
		}), D) : ye((t.parsedType === w.promise ? t.data : Promise.resolve(t.data)).then((e) => this._def.type.parseAsync(e, {
			path: t.path,
			errorMap: t.common.contextualErrorMap
		})));
	}
};
Dt.create = (e, t) => new Dt({
	type: e,
	typeName: j.ZodPromise,
	...k(t)
});
var Ot = class extends A {
	innerType() {
		return this._def.schema;
	}
	sourceType() {
		return this._def.schema._def.typeName === j.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
	}
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e), r = this._def.effect || null, i = {
			addIssue: (e) => {
				E(n, e), e.fatal ? t.abort() : t.dirty();
			},
			get path() {
				return n.path;
			}
		};
		if (i.addIssue = i.addIssue.bind(i), r.type === "preprocess") {
			let e = r.transform(n.data, i);
			if (n.common.async) return Promise.resolve(e).then(async (e) => {
				if (t.value === "aborted") return D;
				let r = await this._def.schema._parseAsync({
					data: e,
					path: n.path,
					parent: n
				});
				return r.status === "aborted" ? D : r.status === "dirty" || t.value === "dirty" ? ve(r.value) : r;
			});
			{
				if (t.value === "aborted") return D;
				let r = this._def.schema._parseSync({
					data: e,
					path: n.path,
					parent: n
				});
				return r.status === "aborted" ? D : r.status === "dirty" || t.value === "dirty" ? ve(r.value) : r;
			}
		}
		if (r.type === "refinement") {
			let e = (e) => {
				let t = r.refinement(e, i);
				if (n.common.async) return Promise.resolve(t);
				if (t instanceof Promise) throw Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
				return e;
			};
			if (n.common.async === !1) {
				let r = this._def.schema._parseSync({
					data: n.data,
					path: n.path,
					parent: n
				});
				return r.status === "aborted" ? D : (r.status === "dirty" && t.dirty(), e(r.value), {
					status: t.value,
					value: r.value
				});
			}
			return this._def.schema._parseAsync({
				data: n.data,
				path: n.path,
				parent: n
			}).then((n) => n.status === "aborted" ? D : (n.status === "dirty" && t.dirty(), e(n.value).then(() => ({
				status: t.value,
				value: n.value
			}))));
		}
		if (r.type === "transform") {
			if (n.common.async === !1) {
				let e = this._def.schema._parseSync({
					data: n.data,
					path: n.path,
					parent: n
				});
				if (!Se(e)) return D;
				let a = r.transform(e.value, i);
				if (a instanceof Promise) throw Error("Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.");
				return {
					status: t.value,
					value: a
				};
			}
			return this._def.schema._parseAsync({
				data: n.data,
				path: n.path,
				parent: n
			}).then((e) => Se(e) ? Promise.resolve(r.transform(e.value, i)).then((e) => ({
				status: t.value,
				value: e
			})) : D);
		}
		C.assertNever(r);
	}
};
Ot.create = (e, t, n) => new Ot({
	schema: e,
	typeName: j.ZodEffects,
	effect: t,
	...k(n)
}), Ot.createWithPreprocess = (e, t, n) => new Ot({
	schema: t,
	effect: {
		type: "preprocess",
		transform: e
	},
	typeName: j.ZodEffects,
	...k(n)
});
var kt = class extends A {
	_parse(e) {
		return this._getType(e) === w.undefined ? ye(void 0) : this._def.innerType._parse(e);
	}
	unwrap() {
		return this._def.innerType;
	}
};
kt.create = (e, t) => new kt({
	innerType: e,
	typeName: j.ZodOptional,
	...k(t)
});
var At = class extends A {
	_parse(e) {
		return this._getType(e) === w.null ? ye(null) : this._def.innerType._parse(e);
	}
	unwrap() {
		return this._def.innerType;
	}
};
At.create = (e, t) => new At({
	innerType: e,
	typeName: j.ZodNullable,
	...k(t)
});
var jt = class extends A {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = t.data;
		return t.parsedType === w.undefined && (n = this._def.defaultValue()), this._def.innerType._parse({
			data: n,
			path: t.path,
			parent: t
		});
	}
	removeDefault() {
		return this._def.innerType;
	}
};
jt.create = (e, t) => new jt({
	innerType: e,
	typeName: j.ZodDefault,
	defaultValue: typeof t.default == "function" ? t.default : () => t.default,
	...k(t)
});
var Mt = class extends A {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = {
			...t,
			common: {
				...t.common,
				issues: []
			}
		}, r = this._def.innerType._parse({
			data: n.data,
			path: n.path,
			parent: { ...n }
		});
		return Ce(r) ? r.then((e) => ({
			status: "valid",
			value: e.status === "valid" ? e.value : this._def.catchValue({
				get error() {
					return new fe(n.common.issues);
				},
				input: n.data
			})
		})) : {
			status: "valid",
			value: r.status === "valid" ? r.value : this._def.catchValue({
				get error() {
					return new fe(n.common.issues);
				},
				input: n.data
			})
		};
	}
	removeCatch() {
		return this._def.innerType;
	}
};
Mt.create = (e, t) => new Mt({
	innerType: e,
	typeName: j.ZodCatch,
	catchValue: typeof t.catch == "function" ? t.catch : () => t.catch,
	...k(t)
});
var Nt = class extends A {
	_parse(e) {
		if (this._getType(e) !== w.nan) {
			let t = this._getOrReturnCtx(e);
			return E(t, {
				code: T.invalid_type,
				expected: w.nan,
				received: t.parsedType
			}), D;
		}
		return {
			status: "valid",
			value: e.data
		};
	}
};
Nt.create = (e) => new Nt({
	typeName: j.ZodNaN,
	...k(e)
});
var Pt = class extends A {
	_parse(e) {
		let { ctx: t } = this._processInputParams(e), n = t.data;
		return this._def.type._parse({
			data: n,
			path: t.path,
			parent: t
		});
	}
	unwrap() {
		return this._def.type;
	}
}, Ft = class e extends A {
	_parse(e) {
		let { status: t, ctx: n } = this._processInputParams(e);
		if (n.common.async) return (async () => {
			let e = await this._def.in._parseAsync({
				data: n.data,
				path: n.path,
				parent: n
			});
			return e.status === "aborted" ? D : e.status === "dirty" ? (t.dirty(), ve(e.value)) : this._def.out._parseAsync({
				data: e.value,
				path: n.path,
				parent: n
			});
		})();
		{
			let e = this._def.in._parseSync({
				data: n.data,
				path: n.path,
				parent: n
			});
			return e.status === "aborted" ? D : e.status === "dirty" ? (t.dirty(), {
				status: "dirty",
				value: e.value
			}) : this._def.out._parseSync({
				data: e.value,
				path: n.path,
				parent: n
			});
		}
	}
	static create(t, n) {
		return new e({
			in: t,
			out: n,
			typeName: j.ZodPipeline
		});
	}
}, It = class extends A {
	_parse(e) {
		let t = this._def.innerType._parse(e), n = (e) => (Se(e) && (e.value = Object.freeze(e.value)), e);
		return Ce(t) ? t.then((e) => n(e)) : n(t);
	}
	unwrap() {
		return this._def.innerType;
	}
};
It.create = (e, t) => new It({
	innerType: e,
	typeName: j.ZodReadonly,
	...k(t)
}), dt.lazycreate;
var j;
(function(e) {
	e.ZodString = "ZodString", e.ZodNumber = "ZodNumber", e.ZodNaN = "ZodNaN", e.ZodBigInt = "ZodBigInt", e.ZodBoolean = "ZodBoolean", e.ZodDate = "ZodDate", e.ZodSymbol = "ZodSymbol", e.ZodUndefined = "ZodUndefined", e.ZodNull = "ZodNull", e.ZodAny = "ZodAny", e.ZodUnknown = "ZodUnknown", e.ZodNever = "ZodNever", e.ZodVoid = "ZodVoid", e.ZodArray = "ZodArray", e.ZodObject = "ZodObject", e.ZodUnion = "ZodUnion", e.ZodDiscriminatedUnion = "ZodDiscriminatedUnion", e.ZodIntersection = "ZodIntersection", e.ZodTuple = "ZodTuple", e.ZodRecord = "ZodRecord", e.ZodMap = "ZodMap", e.ZodSet = "ZodSet", e.ZodFunction = "ZodFunction", e.ZodLazy = "ZodLazy", e.ZodLiteral = "ZodLiteral", e.ZodEnum = "ZodEnum", e.ZodEffects = "ZodEffects", e.ZodNativeEnum = "ZodNativeEnum", e.ZodOptional = "ZodOptional", e.ZodNullable = "ZodNullable", e.ZodDefault = "ZodDefault", e.ZodCatch = "ZodCatch", e.ZodPromise = "ZodPromise", e.ZodBranded = "ZodBranded", e.ZodPipeline = "ZodPipeline", e.ZodReadonly = "ZodReadonly";
})(j ||= {}), Xe.create, Qe.create, Nt.create, $e.create, et.create, tt.create, nt.create, rt.create, it.create, at.create, ot.create, st.create, ct.create, lt.create, dt.create, dt.strictCreate, ft.create, mt.create, gt.create, _t.create, vt.create, yt.create, bt.create, xt.create, St.create, Ct.create, Tt.create, Et.create, Dt.create, Ot.create, kt.create, At.create, Ot.createWithPreprocess, Ft.create;
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/Options.js
var Lt = Symbol("Let zodToJsonSchema decide on which parser to use"), Rt = {
	name: void 0,
	$refStrategy: "root",
	basePath: ["#"],
	effectStrategy: "input",
	pipeStrategy: "all",
	dateStrategy: "format:date-time",
	mapStrategy: "entries",
	removeAdditionalStrategy: "passthrough",
	allowedAdditionalProperties: !0,
	rejectedAdditionalProperties: !1,
	definitionPath: "definitions",
	target: "jsonSchema7",
	strictUnions: !1,
	definitions: {},
	errorMessages: !1,
	markdownDescription: !1,
	patternStrategy: "escape",
	applyRegexFlags: !1,
	emailStrategy: "format:email",
	base64Strategy: "contentEncoding:base64",
	nameStrategy: "ref",
	openAiAnyTypeName: "OpenAiAnyType"
}, zt = (e) => typeof e == "string" ? {
	...Rt,
	name: e
} : {
	...Rt,
	...e
}, Bt = (e) => {
	let t = zt(e), n = t.name === void 0 ? t.basePath : [
		...t.basePath,
		t.definitionPath,
		t.name
	];
	return {
		...t,
		flags: { hasReferencedOpenAiAnyType: !1 },
		currentPath: n,
		propertyPath: void 0,
		seen: new Map(Object.entries(t.definitions).map(([e, n]) => [n._def, {
			def: n._def,
			path: [
				...t.basePath,
				t.definitionPath,
				e
			],
			jsonSchema: void 0
		}]))
	};
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/errorMessages.js
function Vt(e, t, n, r) {
	r?.errorMessages && n && (e.errorMessage = {
		...e.errorMessage,
		[t]: n
	});
}
function Ht(e, t, n, r, i) {
	e[t] = n, Vt(e, t, r, i);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/getRelativePath.js
var Ut = (e, t) => {
	let n = 0;
	for (; n < e.length && n < t.length && e[n] === t[n]; n++);
	return [(e.length - n).toString(), ...t.slice(n)].join("/");
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/any.js
function Wt(e) {
	if (e.target !== "openAi") return {};
	let t = [
		...e.basePath,
		e.definitionPath,
		e.openAiAnyTypeName
	];
	return e.flags.hasReferencedOpenAiAnyType = !0, { $ref: e.$refStrategy === "relative" ? Ut(t, e.currentPath) : t.join("/") };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/array.js
function Gt(e, t) {
	let n = { type: "array" };
	return e.type?._def && e.type?._def?.typeName !== j.ZodAny && (n.items = In(e.type._def, {
		...t,
		currentPath: [...t.currentPath, "items"]
	})), e.minLength && Ht(n, "minItems", e.minLength.value, e.minLength.message, t), e.maxLength && Ht(n, "maxItems", e.maxLength.value, e.maxLength.message, t), e.exactLength && (Ht(n, "minItems", e.exactLength.value, e.exactLength.message, t), Ht(n, "maxItems", e.exactLength.value, e.exactLength.message, t)), n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
function Kt(e, t) {
	let n = {
		type: "integer",
		format: "int64"
	};
	if (!e.checks) return n;
	for (let r of e.checks) switch (r.kind) {
		case "min":
			t.target === "jsonSchema7" ? r.inclusive ? Ht(n, "minimum", r.value, r.message, t) : Ht(n, "exclusiveMinimum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMinimum = !0), Ht(n, "minimum", r.value, r.message, t));
			break;
		case "max":
			t.target === "jsonSchema7" ? r.inclusive ? Ht(n, "maximum", r.value, r.message, t) : Ht(n, "exclusiveMaximum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMaximum = !0), Ht(n, "maximum", r.value, r.message, t));
			break;
		case "multipleOf": Ht(n, "multipleOf", r.value, r.message, t);
	}
	return n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js
function qt() {
	return { type: "boolean" };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
function Jt(e, t) {
	return In(e.type._def, t);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var Yt = (e, t) => In(e.innerType._def, t);
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/date.js
function Xt(e, t, n) {
	let r = n ?? t.dateStrategy;
	if (Array.isArray(r)) return { anyOf: r.map((n, r) => Xt(e, t, n)) };
	switch (r) {
		case "string":
		case "format:date-time": return {
			type: "string",
			format: "date-time"
		};
		case "format:date": return {
			type: "string",
			format: "date"
		};
		case "integer": return Zt(e, t);
	}
}
var Zt = (e, t) => {
	let n = {
		type: "integer",
		format: "unix-time"
	};
	if (t.target === "openApi3") return n;
	for (let r of e.checks) switch (r.kind) {
		case "min":
			Ht(n, "minimum", r.value, r.message, t);
			break;
		case "max": Ht(n, "maximum", r.value, r.message, t);
	}
	return n;
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/default.js
function Qt(e, t) {
	return {
		...In(e.innerType._def, t),
		default: e.defaultValue()
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
function $t(e, t) {
	return t.effectStrategy === "input" ? In(e.schema._def, t) : Wt(t);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/enum.js
function en(e) {
	return {
		type: "string",
		enum: Array.from(e.values)
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
var tn = (e) => "type" in e && e.type === "string" ? !1 : "allOf" in e;
function nn(e, t) {
	let n = [In(e.left._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			"0"
		]
	}), In(e.right._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			"1"
		]
	})].filter((e) => !!e), r = t.target === "jsonSchema2019-09" ? { unevaluatedProperties: !1 } : void 0, i = [];
	return n.forEach((e) => {
		if (tn(e)) i.push(...e.allOf), e.unevaluatedProperties === void 0 && (r = void 0);
		else {
			let t = e;
			if ("additionalProperties" in e && e.additionalProperties === !1) {
				let { additionalProperties: n, ...r } = e;
				t = r;
			} else r = void 0;
			i.push(t);
		}
	}), i.length ? {
		allOf: i,
		...r
	} : void 0;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/literal.js
function rn(e, t) {
	let n = typeof e.value;
	return n !== "bigint" && n !== "number" && n !== "boolean" && n !== "string" ? { type: Array.isArray(e.value) ? "array" : "object" } : t.target === "openApi3" ? {
		type: n === "bigint" ? "integer" : n,
		enum: [e.value]
	} : {
		type: n === "bigint" ? "integer" : n,
		const: e.value
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var an = void 0, on = {
	cuid: /^[cC][^\s-]{8,}$/,
	cuid2: /^[0-9a-z]+$/,
	ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
	email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
	emoji: () => (an === void 0 && (an = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u")), an),
	uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
	ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
	ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
	ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
	ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
	base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
	base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
	nanoid: /^[a-zA-Z0-9_-]{21}$/,
	jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
};
function sn(e, t) {
	let n = { type: "string" };
	if (e.checks) for (let r of e.checks) switch (r.kind) {
		case "min":
			Ht(n, "minLength", typeof n.minLength == "number" ? Math.max(n.minLength, r.value) : r.value, r.message, t);
			break;
		case "max":
			Ht(n, "maxLength", typeof n.maxLength == "number" ? Math.min(n.maxLength, r.value) : r.value, r.message, t);
			break;
		case "email":
			switch (t.emailStrategy) {
				case "format:email":
					dn(n, "email", r.message, t);
					break;
				case "format:idn-email":
					dn(n, "idn-email", r.message, t);
					break;
				case "pattern:zod": fn(n, on.email, r.message, t);
			}
			break;
		case "url":
			dn(n, "uri", r.message, t);
			break;
		case "uuid":
			dn(n, "uuid", r.message, t);
			break;
		case "regex":
			fn(n, r.regex, r.message, t);
			break;
		case "cuid":
			fn(n, on.cuid, r.message, t);
			break;
		case "cuid2":
			fn(n, on.cuid2, r.message, t);
			break;
		case "startsWith":
			fn(n, RegExp(`^${cn(r.value, t)}`), r.message, t);
			break;
		case "endsWith":
			fn(n, RegExp(`${cn(r.value, t)}$`), r.message, t);
			break;
		case "datetime":
			dn(n, "date-time", r.message, t);
			break;
		case "date":
			dn(n, "date", r.message, t);
			break;
		case "time":
			dn(n, "time", r.message, t);
			break;
		case "duration":
			dn(n, "duration", r.message, t);
			break;
		case "length":
			Ht(n, "minLength", typeof n.minLength == "number" ? Math.max(n.minLength, r.value) : r.value, r.message, t), Ht(n, "maxLength", typeof n.maxLength == "number" ? Math.min(n.maxLength, r.value) : r.value, r.message, t);
			break;
		case "includes":
			fn(n, RegExp(cn(r.value, t)), r.message, t);
			break;
		case "ip":
			r.version !== "v6" && dn(n, "ipv4", r.message, t), r.version !== "v4" && dn(n, "ipv6", r.message, t);
			break;
		case "base64url":
			fn(n, on.base64url, r.message, t);
			break;
		case "jwt":
			fn(n, on.jwt, r.message, t);
			break;
		case "cidr":
			r.version !== "v6" && fn(n, on.ipv4Cidr, r.message, t), r.version !== "v4" && fn(n, on.ipv6Cidr, r.message, t);
			break;
		case "emoji":
			fn(n, on.emoji(), r.message, t);
			break;
		case "ulid":
			fn(n, on.ulid, r.message, t);
			break;
		case "base64":
			switch (t.base64Strategy) {
				case "format:binary":
					dn(n, "binary", r.message, t);
					break;
				case "contentEncoding:base64":
					Ht(n, "contentEncoding", "base64", r.message, t);
					break;
				case "pattern:zod": fn(n, on.base64, r.message, t);
			}
			break;
		case "nanoid": fn(n, on.nanoid, r.message, t);
	}
	return n;
}
function cn(e, t) {
	return t.patternStrategy === "escape" ? un(e) : e;
}
var ln = /* @__PURE__ */ new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
function un(e) {
	let t = "";
	for (let n = 0; n < e.length; n++) ln.has(e[n]) || (t += "\\"), t += e[n];
	return t;
}
function dn(e, t, n, r) {
	e.format || e.anyOf?.some((e) => e.format) ? (e.anyOf ||= [], e.format && (e.anyOf.push({
		format: e.format,
		...e.errorMessage && r.errorMessages && { errorMessage: { format: e.errorMessage.format } }
	}), delete e.format, e.errorMessage && (delete e.errorMessage.format, Object.keys(e.errorMessage).length === 0 && delete e.errorMessage)), e.anyOf.push({
		format: t,
		...n && r.errorMessages && { errorMessage: { format: n } }
	})) : Ht(e, "format", t, n, r);
}
function fn(e, t, n, r) {
	e.pattern || e.allOf?.some((e) => e.pattern) ? (e.allOf ||= [], e.pattern && (e.allOf.push({
		pattern: e.pattern,
		...e.errorMessage && r.errorMessages && { errorMessage: { pattern: e.errorMessage.pattern } }
	}), delete e.pattern, e.errorMessage && (delete e.errorMessage.pattern, Object.keys(e.errorMessage).length === 0 && delete e.errorMessage)), e.allOf.push({
		pattern: pn(t, r),
		...n && r.errorMessages && { errorMessage: { pattern: n } }
	})) : Ht(e, "pattern", pn(t, r), n, r);
}
function pn(e, t) {
	if (!t.applyRegexFlags || !e.flags) return e.source;
	let n = {
		i: e.flags.includes("i"),
		m: e.flags.includes("m"),
		s: e.flags.includes("s")
	}, r = n.i ? e.source.toLowerCase() : e.source, i = "", a = !1, o = !1, s = !1;
	for (let e = 0; e < r.length; e++) {
		if (a) {
			i += r[e], a = !1;
			continue;
		}
		if (n.i) {
			if (o) {
				if (r[e].match(/[a-z]/)) {
					s ? (i += r[e], i += `${r[e - 2]}-${r[e]}`.toUpperCase(), s = !1) : r[e + 1] === "-" && r[e + 2]?.match(/[a-z]/) ? (i += r[e], s = !0) : i += `${r[e]}${r[e].toUpperCase()}`;
					continue;
				}
			} else if (r[e].match(/[a-z]/)) {
				i += `[${r[e]}${r[e].toUpperCase()}]`;
				continue;
			}
		}
		if (n.m) {
			if (r[e] === "^") {
				i += "(^|(?<=[\r\n]))";
				continue;
			}
			if (r[e] === "$") {
				i += "($|(?=[\r\n]))";
				continue;
			}
		}
		if (n.s && r[e] === ".") {
			i += o ? `${r[e]}\r\n` : `[${r[e]}\r\n]`;
			continue;
		}
		i += r[e], r[e] === "\\" ? a = !0 : o && r[e] === "]" ? o = !1 : !o && r[e] === "[" && (o = !0);
	}
	try {
		new RegExp(i);
	} catch {
		return console.warn(`Could not convert regex pattern at ${t.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`), e.source;
	}
	return i;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/record.js
function mn(e, t) {
	if (t.target === "openAi" && console.warn("Warning: OpenAI may not support records in schemas! Try an array of key-value pairs instead."), t.target === "openApi3" && e.keyType?._def.typeName === j.ZodEnum) return {
		type: "object",
		required: e.keyType._def.values,
		properties: e.keyType._def.values.reduce((n, r) => ({
			...n,
			[r]: In(e.valueType._def, {
				...t,
				currentPath: [
					...t.currentPath,
					"properties",
					r
				]
			}) ?? Wt(t)
		}), {}),
		additionalProperties: t.rejectedAdditionalProperties
	};
	let n = {
		type: "object",
		additionalProperties: In(e.valueType._def, {
			...t,
			currentPath: [...t.currentPath, "additionalProperties"]
		}) ?? t.allowedAdditionalProperties
	};
	if (t.target === "openApi3") return n;
	if (e.keyType?._def.typeName === j.ZodString && e.keyType._def.checks?.length) {
		let { type: r, ...i } = sn(e.keyType._def, t);
		return {
			...n,
			propertyNames: i
		};
	}
	if (e.keyType?._def.typeName === j.ZodEnum) return {
		...n,
		propertyNames: { enum: e.keyType._def.values }
	};
	if (e.keyType?._def.typeName === j.ZodBranded && e.keyType._def.type._def.typeName === j.ZodString && e.keyType._def.type._def.checks?.length) {
		let { type: r, ...i } = Jt(e.keyType._def, t);
		return {
			...n,
			propertyNames: i
		};
	}
	return n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/map.js
function hn(e, t) {
	return t.mapStrategy === "record" ? mn(e, t) : {
		type: "array",
		maxItems: 125,
		items: {
			type: "array",
			items: [In(e.keyType._def, {
				...t,
				currentPath: [
					...t.currentPath,
					"items",
					"items",
					"0"
				]
			}) || Wt(t), In(e.valueType._def, {
				...t,
				currentPath: [
					...t.currentPath,
					"items",
					"items",
					"1"
				]
			}) || Wt(t)],
			minItems: 2,
			maxItems: 2
		}
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js
function gn(e) {
	let t = e.values, n = Object.keys(e.values).filter((e) => typeof t[t[e]] != "number").map((e) => t[e]), r = Array.from(new Set(n.map((e) => typeof e)));
	return {
		type: r.length === 1 ? r[0] === "string" ? "string" : "number" : ["string", "number"],
		enum: n
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/never.js
function _n(e) {
	return e.target === "openAi" ? void 0 : { not: Wt({
		...e,
		currentPath: [...e.currentPath, "not"]
	}) };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/null.js
function vn(e) {
	return e.target === "openApi3" ? {
		enum: ["null"],
		nullable: !0
	} : { type: "null" };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/union.js
var yn = {
	ZodString: "string",
	ZodNumber: "number",
	ZodBigInt: "integer",
	ZodBoolean: "boolean",
	ZodNull: "null"
};
function bn(e, t) {
	if (t.target === "openApi3") return xn(e, t);
	let n = e.options instanceof Map ? Array.from(e.options.values()) : e.options;
	if (n.every((e) => e._def.typeName in yn && (!e._def.checks || !e._def.checks.length))) {
		let e = n.reduce((e, t) => {
			let n = yn[t._def.typeName];
			return n && !e.includes(n) ? [...e, n] : e;
		}, []);
		return { type: e.length > 1 ? e : e[0] };
	}
	if (n.every((e) => e._def.typeName === "ZodLiteral" && !e.description)) {
		let e = n.reduce((e, t) => {
			let n = typeof t._def.value;
			switch (n) {
				case "string":
				case "number":
				case "boolean": return [...e, n];
				case "bigint": return [...e, "integer"];
				case "object": if (t._def.value === null) return [...e, "null"];
				default: return e;
			}
		}, []);
		if (e.length === n.length) {
			let t = e.filter((e, t, n) => n.indexOf(e) === t);
			return {
				type: t.length > 1 ? t : t[0],
				enum: n.reduce((e, t) => e.includes(t._def.value) ? e : [...e, t._def.value], [])
			};
		}
	} else if (n.every((e) => e._def.typeName === "ZodEnum")) return {
		type: "string",
		enum: n.reduce((e, t) => [...e, ...t._def.values.filter((t) => !e.includes(t))], [])
	};
	return xn(e, t);
}
var xn = (e, t) => {
	let n = (e.options instanceof Map ? Array.from(e.options.values()) : e.options).map((e, n) => In(e._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"anyOf",
			`${n}`
		]
	})).filter((e) => !!e && (!t.strictUnions || typeof e == "object" && Object.keys(e).length > 0));
	return n.length ? { anyOf: n } : void 0;
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
function Sn(e, t) {
	if ([
		"ZodString",
		"ZodNumber",
		"ZodBigInt",
		"ZodBoolean",
		"ZodNull"
	].includes(e.innerType._def.typeName) && (!e.innerType._def.checks || !e.innerType._def.checks.length)) return t.target === "openApi3" ? {
		type: yn[e.innerType._def.typeName],
		nullable: !0
	} : { type: [yn[e.innerType._def.typeName], "null"] };
	if (t.target === "openApi3") {
		let n = In(e.innerType._def, {
			...t,
			currentPath: [...t.currentPath]
		});
		return n && "$ref" in n ? {
			allOf: [n],
			nullable: !0
		} : n && {
			...n,
			nullable: !0
		};
	}
	let n = In(e.innerType._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"anyOf",
			"0"
		]
	});
	return n && { anyOf: [n, { type: "null" }] };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/number.js
function Cn(e, t) {
	let n = { type: "number" };
	if (!e.checks) return n;
	for (let r of e.checks) switch (r.kind) {
		case "int":
			n.type = "integer", Vt(n, "type", r.message, t);
			break;
		case "min":
			t.target === "jsonSchema7" ? r.inclusive ? Ht(n, "minimum", r.value, r.message, t) : Ht(n, "exclusiveMinimum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMinimum = !0), Ht(n, "minimum", r.value, r.message, t));
			break;
		case "max":
			t.target === "jsonSchema7" ? r.inclusive ? Ht(n, "maximum", r.value, r.message, t) : Ht(n, "exclusiveMaximum", r.value, r.message, t) : (r.inclusive || (n.exclusiveMaximum = !0), Ht(n, "maximum", r.value, r.message, t));
			break;
		case "multipleOf": Ht(n, "multipleOf", r.value, r.message, t);
	}
	return n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/object.js
function wn(e, t) {
	let n = t.target === "openAi", r = {
		type: "object",
		properties: {}
	}, i = [], a = e.shape();
	for (let e in a) {
		let o = a[e];
		if (o === void 0 || o._def === void 0) continue;
		let s = En(o);
		s && n && (o._def.typeName === "ZodOptional" && (o = o._def.innerType), o.isNullable() || (o = o.nullable()), s = !1);
		let c = In(o._def, {
			...t,
			currentPath: [
				...t.currentPath,
				"properties",
				e
			],
			propertyPath: [
				...t.currentPath,
				"properties",
				e
			]
		});
		c !== void 0 && (r.properties[e] = c, s || i.push(e));
	}
	i.length && (r.required = i);
	let o = Tn(e, t);
	return o !== void 0 && (r.additionalProperties = o), r;
}
function Tn(e, t) {
	if (e.catchall._def.typeName !== "ZodNever") return In(e.catchall._def, {
		...t,
		currentPath: [...t.currentPath, "additionalProperties"]
	});
	switch (e.unknownKeys) {
		case "passthrough": return t.allowedAdditionalProperties;
		case "strict": return t.rejectedAdditionalProperties;
		case "strip": return t.removeAdditionalStrategy === "strict" ? t.allowedAdditionalProperties : t.rejectedAdditionalProperties;
	}
}
function En(e) {
	try {
		return e.isOptional();
	} catch {
		return !0;
	}
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var Dn = (e, t) => {
	if (t.currentPath.toString() === t.propertyPath?.toString()) return In(e.innerType._def, t);
	let n = In(e.innerType._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"anyOf",
			"1"
		]
	});
	return n ? { anyOf: [{ not: Wt(t) }, n] } : Wt(t);
}, On = (e, t) => {
	if (t.pipeStrategy === "input") return In(e.in._def, t);
	if (t.pipeStrategy === "output") return In(e.out._def, t);
	let n = In(e.in._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			"0"
		]
	});
	return { allOf: [n, In(e.out._def, {
		...t,
		currentPath: [
			...t.currentPath,
			"allOf",
			n ? "1" : "0"
		]
	})].filter((e) => e !== void 0) };
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
function kn(e, t) {
	return In(e.type._def, t);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/set.js
function An(e, t) {
	let n = {
		type: "array",
		uniqueItems: !0,
		items: In(e.valueType._def, {
			...t,
			currentPath: [...t.currentPath, "items"]
		})
	};
	return e.minSize && Ht(n, "minItems", e.minSize.value, e.minSize.message, t), e.maxSize && Ht(n, "maxItems", e.maxSize.value, e.maxSize.message, t), n;
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
function jn(e, t) {
	return e.rest ? {
		type: "array",
		minItems: e.items.length,
		items: e.items.map((e, n) => In(e._def, {
			...t,
			currentPath: [
				...t.currentPath,
				"items",
				`${n}`
			]
		})).reduce((e, t) => t === void 0 ? e : [...e, t], []),
		additionalItems: In(e.rest._def, {
			...t,
			currentPath: [...t.currentPath, "additionalItems"]
		})
	} : {
		type: "array",
		minItems: e.items.length,
		maxItems: e.items.length,
		items: e.items.map((e, n) => In(e._def, {
			...t,
			currentPath: [
				...t.currentPath,
				"items",
				`${n}`
			]
		})).reduce((e, t) => t === void 0 ? e : [...e, t], [])
	};
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
function Mn(e) {
	return { not: Wt(e) };
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
function Nn(e) {
	return Wt(e);
}
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var Pn = (e, t) => In(e.innerType._def, t), Fn = (e, t, n) => {
	switch (t) {
		case j.ZodString: return sn(e, n);
		case j.ZodNumber: return Cn(e, n);
		case j.ZodObject: return wn(e, n);
		case j.ZodBigInt: return Kt(e, n);
		case j.ZodBoolean: return qt();
		case j.ZodDate: return Xt(e, n);
		case j.ZodUndefined: return Mn(n);
		case j.ZodNull: return vn(n);
		case j.ZodArray: return Gt(e, n);
		case j.ZodUnion:
		case j.ZodDiscriminatedUnion: return bn(e, n);
		case j.ZodIntersection: return nn(e, n);
		case j.ZodTuple: return jn(e, n);
		case j.ZodRecord: return mn(e, n);
		case j.ZodLiteral: return rn(e, n);
		case j.ZodEnum: return en(e);
		case j.ZodNativeEnum: return gn(e);
		case j.ZodNullable: return Sn(e, n);
		case j.ZodOptional: return Dn(e, n);
		case j.ZodMap: return hn(e, n);
		case j.ZodSet: return An(e, n);
		case j.ZodLazy: return () => e.getter()._def;
		case j.ZodPromise: return kn(e, n);
		case j.ZodNaN:
		case j.ZodNever: return _n(n);
		case j.ZodEffects: return $t(e, n);
		case j.ZodAny: return Wt(n);
		case j.ZodUnknown: return Nn(n);
		case j.ZodDefault: return Qt(e, n);
		case j.ZodBranded: return Jt(e, n);
		case j.ZodReadonly: return Pn(e, n);
		case j.ZodCatch: return Yt(e, n);
		case j.ZodPipeline: return On(e, n);
		case j.ZodFunction:
		case j.ZodVoid:
		case j.ZodSymbol: return;
		default: return ((e) => void 0)(t);
	}
};
//#endregion
//#region node_modules/zod-to-json-schema/dist/esm/parseDef.js
function In(e, t, n = !1) {
	let r = t.seen.get(e);
	if (t.override) {
		let i = t.override?.(e, t, r, n);
		if (i !== Lt) return i;
	}
	if (r && !n) {
		let e = Ln(r, t);
		if (e !== void 0) return e;
	}
	let i = {
		def: e,
		path: t.currentPath,
		jsonSchema: void 0
	};
	t.seen.set(e, i);
	let a = Fn(e, e.typeName, t), o = typeof a == "function" ? In(a(), t) : a;
	if (o && Rn(e, t, o), t.postProcess) {
		let n = t.postProcess(o, e, t);
		return i.jsonSchema = o, n;
	}
	return i.jsonSchema = o, o;
}
var Ln = (e, t) => {
	switch (t.$refStrategy) {
		case "root": return { $ref: e.path.join("/") };
		case "relative": return { $ref: Ut(t.currentPath, e.path) };
		case "none":
		case "seen": return e.path.length < t.currentPath.length && e.path.every((e, n) => t.currentPath[n] === e) ? (console.warn(`Recursive reference detected at ${t.currentPath.join("/")}! Defaulting to any`), Wt(t)) : t.$refStrategy === "seen" ? Wt(t) : void 0;
	}
}, Rn = (e, t, n) => (e.description && (n.description = e.description, t.markdownDescription && (n.markdownDescription = e.description)), n), zn = (e, t) => {
	let n = Bt(t), r = typeof t == "object" && t.definitions ? Object.entries(t.definitions).reduce((e, [t, r]) => ({
		...e,
		[t]: In(r._def, {
			...n,
			currentPath: [
				...n.basePath,
				n.definitionPath,
				t
			]
		}, !0) ?? Wt(n)
	}), {}) : void 0, i = typeof t == "string" ? t : t?.nameStrategy === "title" ? void 0 : t?.name, a = In(e._def, i === void 0 ? n : {
		...n,
		currentPath: [
			...n.basePath,
			n.definitionPath,
			i
		]
	}, !1) ?? Wt(n), o = typeof t == "object" && t.name !== void 0 && t.nameStrategy === "title" ? t.name : void 0;
	o !== void 0 && (a.title = o), n.flags.hasReferencedOpenAiAnyType && (r ||= {}, r[n.openAiAnyTypeName] || (r[n.openAiAnyTypeName] = {
		type: [
			"string",
			"number",
			"integer",
			"boolean",
			"array",
			"null"
		],
		items: { $ref: n.$refStrategy === "relative" ? "1" : [
			...n.basePath,
			n.definitionPath,
			n.openAiAnyTypeName
		].join("/") }
	}));
	let s = i === void 0 ? r ? {
		...a,
		[n.definitionPath]: r
	} : a : {
		$ref: [
			...n.$refStrategy === "relative" ? [] : n.basePath,
			n.definitionPath,
			i
		].join("/"),
		[n.definitionPath]: {
			...r,
			[i]: a
		}
	};
	return n.target === "jsonSchema7" ? s.$schema = "http://json-schema.org/draft-07/schema#" : (n.target === "jsonSchema2019-09" || n.target === "openAi") && (s.$schema = "https://json-schema.org/draft/2019-09/schema#"), n.target === "openAi" && ("anyOf" in s || "oneOf" in s || "allOf" in s || "type" in s && Array.isArray(s.type)) && console.warn("Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property."), s;
}, Bn = Object.prototype.hasOwnProperty;
function M(e, t) {
	let n = /\{([a-zA-Z0-9_][a-zA-Z0-9_-]*?)\}/g;
	return function(r = {}) {
		return e.replace(n, function(e, n) {
			if (!Bn.call(r, n)) throw Error(`Parameter '${n}' is required`);
			let i = r[n];
			if (typeof i != "string" && typeof i != "number") throw Error(`Parameter '${n}' must be a string or number`);
			return t?.charEncoding === "percent" ? encodeURIComponent(`${i}`) : `${i}`;
		}).replace(/^\/+/, "");
	};
}
var Vn = { eu: "https://api.mistral.ai" };
function Hn(e) {
	let t = e.serverURL, n = {};
	t ||= Vn[e.server ?? "eu"] || "";
	let r = M(t)(n);
	return new URL(r);
}
var Un = {
	language: "typescript",
	openapiDocVersion: "1.0.0",
	sdkVersion: "2.2.6",
	genVersion: "2.884.13",
	userAgent: "speakeasy-sdk/typescript 2.2.6 2.884.13 1.0.0 @mistralai/mistralai"
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/files.js
async function Wn(e) {
	let t = e.getReader(), n = [], r = 0, i = !1;
	for (; !i;) {
		let { value: e, done: a } = await t.read();
		a ? i = !0 : (n.push(e), r += e.length);
	}
	let a = new Uint8Array(r), o = 0;
	for (let e of n) a.set(e, o), o += e.length;
	return a.buffer;
}
function Gn(e) {
	if (!e) return null;
	let t = e.toLowerCase().split(".").pop();
	return t && {
		json: "application/json",
		xml: "application/xml",
		html: "text/html",
		htm: "text/html",
		txt: "text/plain",
		csv: "text/csv",
		pdf: "application/pdf",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
		js: "application/javascript",
		css: "text/css",
		zip: "application/zip",
		tar: "application/x-tar",
		gz: "application/gzip",
		mp4: "video/mp4",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		webp: "image/webp",
		ico: "image/x-icon",
		woff: "font/woff",
		woff2: "font/woff2",
		ttf: "font/ttf",
		otf: "font/otf"
	}[t] || null;
}
function Kn(e, t) {
	return e instanceof Uint8Array ? new Blob([new Uint8Array(e)], { type: t }) : new Blob([e], { type: t });
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/http.js
var qn = (e, t) => t == null ? fetch(e) : fetch(e, t), Jn = class e {
	options;
	fetcher;
	requestHooks = [];
	requestErrorHooks = [];
	responseHooks = [];
	constructor(e = {}) {
		this.options = e, this.fetcher = e.fetcher || qn;
	}
	async request(e) {
		let t = e;
		for (let e of this.requestHooks) {
			let n = await e(t);
			n && (t = n);
		}
		try {
			let e = await this.fetcher(t);
			for (let n of this.responseHooks) await n(e, t);
			return e;
		} catch (e) {
			for (let n of this.requestErrorHooks) await n(e, t);
			throw e;
		}
	}
	addHook(...e) {
		if (e[0] === "beforeRequest") this.requestHooks.push(e[1]);
		else if (e[0] === "requestError") this.requestErrorHooks.push(e[1]);
		else if (e[0] === "response") this.responseHooks.push(e[1]);
		else throw Error(`Invalid hook type: ${e[0]}`);
		return this;
	}
	removeHook(...e) {
		let t;
		if (e[0] === "beforeRequest") t = this.requestHooks;
		else if (e[0] === "requestError") t = this.requestErrorHooks;
		else if (e[0] === "response") t = this.responseHooks;
		else throw Error(`Invalid hook type: ${e[0]}`);
		let n = t.findIndex((t) => t === e[1]);
		return n >= 0 && t.splice(n, 1), this;
	}
	clone() {
		let t = new e(this.options);
		return t.requestHooks = this.requestHooks.slice(), t.requestErrorHooks = this.requestErrorHooks.slice(), t.responseHooks = this.responseHooks.slice(), t;
	}
}, Yn = /\s*;\s*/g;
function Xn(e, t) {
	if (t === "*") return !0;
	let n = e.headers.get("content-type")?.trim() || "application/octet-stream";
	n = n.toLowerCase();
	let [r = "", ...i] = t.toLowerCase().trim().split(Yn);
	if (r.split("/").length !== 2) return !1;
	let [a = "", ...o] = n.split(Yn), [s = "", c = ""] = a.split("/");
	if (!s || !c || r !== "*/*" && a !== r && `${s}/*` !== r && `*/${c}` !== r || o.length < i.length) return !1;
	let l = new Set(o);
	for (let e of i) if (!l.has(e)) return !1;
	return !0;
}
var Zn = /* @__PURE__ */ RegExp("^[0-9]xx$", "i");
function N(e, t) {
	let n = `${e.status}`, r = Array.isArray(t) ? t : [t];
	return r.length ? r.some((e) => {
		let t = `${e}`;
		if (t === "default") return !0;
		if (!Zn.test(`${t}`)) return t === n;
		let r = t.charAt(0);
		if (!r) throw Error("Invalid status code range");
		let i = n.charAt(0);
		if (!i) throw Error(`Invalid response status code: ${n}`);
		return i === r;
	}) : !1;
}
function Qn(e, t, n) {
	return N(e, t) && Xn(e, n);
}
function $n(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e instanceof TypeError && e.message.toLowerCase().startsWith("failed to fetch"), n = e instanceof TypeError && e.message.toLowerCase().startsWith("fetch failed"), r = "name" in e && e.name === "ConnectionError", i = "code" in e && typeof e.code == "string" && e.code.toLowerCase() === "econnreset";
	return t || n || i || r;
}
function er(e) {
	if (typeof e != "object" || !e) return !1;
	let t = "name" in e && e.name === "TimeoutError", n = "code" in e && e.code === 23, r = "code" in e && typeof e.code == "string" && e.code.toLowerCase() === "econnaborted";
	return t || n || r;
}
function tr(e) {
	if (typeof e != "object" || !e) return !1;
	let t = "name" in e && e.name === "AbortError", n = "code" in e && e.code === 20, r = "code" in e && typeof e.code == "string" && e.code.toLowerCase() === "econnaborted";
	return t || n || r;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/hooks/custom_user_agent.js
var nr = class {
	beforeRequest(e, t) {
		let n = `mistral-client-typescript/${Un.sdkVersion}`;
		return t.headers.set("user-agent", n), t.headers.get("user-agent") || t.headers.set("x-mistral-user-agent", n), t;
	}
}, rr = "x-model-deprecation-timestamp", ir = class {
	afterSuccess(e, t) {
		return t.headers.has(rr) && t.clone().json().then((e) => {
			let n = e.model;
			console.warn(`WARNING: The model ${n} is deprecated and will be removed on ${t.headers.get(rr)}. Please refer to https://docs.mistral.ai/getting-started/models/#api-versioning for more information.`);
		}).catch(() => {}), t;
	}
}, ar;
async function or() {
	if (ar !== void 0) return ar;
	try {
		ar = await import("./otel-Ovx6Bt4T.js");
	} catch {
		ar = null;
	}
	return ar;
}
var sr = "_tracingSpan", cr = "_tracingBody", lr = "_tracingTracer", ur = class e extends Jn {
	wrappedClient;
	requestContexts;
	constructor(e, t) {
		super(), this.wrappedClient = e, this.requestContexts = t;
	}
	async request(e) {
		let t = this.requestContexts.get(e);
		if (!t) return this.wrappedClient.request(e);
		let n = null;
		try {
			return n = await or(), n ? await n.runWithContext(t, () => this.wrappedClient.request(e)) : await this.wrappedClient.request(e);
		} catch (e) {
			throw n && await n.recordRequestError(t, e), e;
		} finally {
			this.requestContexts.delete(e);
		}
	}
	clone() {
		return new e(this.wrappedClient.clone(), this.requestContexts);
	}
}, dr = class {
	#e = /* @__PURE__ */ new WeakMap();
	sdkInit(e) {
		return {
			...e,
			client: new ur(e.client, this.#e)
		};
	}
	async beforeRequest(e, t) {
		let n = e, r = await or();
		if (!r) return t;
		let i = r.getOrCreateOtelTracer(), { request: a, span: o, body: s } = await r.getTracedRequestAndSpan(i, e.operationID, t);
		return n[lr] = i, n[sr] = o, n[cr] = s, this.#e.set(a, r.getSpanContext(o)), a;
	}
	async afterSuccess(e, t) {
		let n = e, r = n[sr], i = n[lr];
		if (!r || !i) return t;
		let a = await or();
		return a ? a.getTracedResponse(i, r, e.operationID, t) : t;
	}
	async afterError(e, t, n) {
		let r = e[sr];
		if (!r) return {
			response: t,
			error: n
		};
		let i = await or();
		return i ? i.getResponseAndError(r, t, n) : {
			response: t,
			error: n
		};
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/hooks/registration.js
function fr(e) {
	let t = new nr();
	e.registerBeforeRequestHook(t);
	let n = new ir();
	e.registerAfterSuccessHook(n);
	let r = new dr();
	e.registerBeforeRequestHook(r), e.registerAfterSuccessHook(r), e.registerAfterErrorHook(r), e.registerSDKInitHook(r);
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/hooks/hooks.js
var pr = class {
	sdkInitHooks = [];
	beforeCreateRequestHooks = [];
	beforeRequestHooks = [];
	afterSuccessHooks = [];
	afterErrorHooks = [];
	constructor() {
		for (let e of []) "sdkInit" in e && this.registerSDKInitHook(e), "beforeCreateRequest" in e && this.registerBeforeCreateRequestHook(e), "beforeRequest" in e && this.registerBeforeRequestHook(e), "afterSuccess" in e && this.registerAfterSuccessHook(e), "afterError" in e && this.registerAfterErrorHook(e);
		fr(this);
	}
	registerSDKInitHook(e) {
		this.sdkInitHooks.push(e);
	}
	registerBeforeCreateRequestHook(e) {
		this.beforeCreateRequestHooks.push(e);
	}
	registerBeforeRequestHook(e) {
		this.beforeRequestHooks.push(e);
	}
	registerAfterSuccessHook(e) {
		this.afterSuccessHooks.push(e);
	}
	registerAfterErrorHook(e) {
		this.afterErrorHooks.push(e);
	}
	sdkInit(e) {
		return this.sdkInitHooks.reduce((e, t) => t.sdkInit(e), e);
	}
	beforeCreateRequest(e, t) {
		let n = t;
		for (let t of this.beforeCreateRequestHooks) n = t.beforeCreateRequest(e, n);
		return n;
	}
	async beforeRequest(e, t) {
		let n = t;
		for (let t of this.beforeRequestHooks) n = await t.beforeRequest(e, n);
		return n;
	}
	async afterSuccess(e, t) {
		let n = t;
		for (let t of this.afterSuccessHooks) n = await t.afterSuccess(e, n);
		return n;
	}
	async afterError(e, t, n) {
		let r = t, i = n;
		for (let t of this.afterErrorHooks) {
			let n = await t.afterError(e, r, i);
			r = n.response, i = n.error;
		}
		return {
			response: r,
			error: i
		};
	}
}, mr = class extends Error {
	cause;
	name = "HTTPClientError";
	constructor(e, t) {
		let n = e;
		t?.cause && (n += `: ${t.cause}`), super(n, t), this.cause === void 0 && (this.cause = t?.cause);
	}
}, hr = class extends mr {
	name = "UnexpectedClientError";
}, gr = class extends mr {
	name = "InvalidRequestError";
}, _r = class extends mr {
	name = "RequestAbortedError";
}, vr = class extends mr {
	name = "RequestTimeoutError";
}, yr = class extends mr {
	name = "ConnectionError";
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/types/fp.js
function br(e) {
	return {
		ok: !0,
		value: e
	};
}
function xr(e) {
	return {
		ok: !1,
		error: e
	};
}
async function P(e) {
	let t = await e;
	if (!t.ok) throw t.error;
	return t.value;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/base64.js
function Sr(e) {
	return btoa(String.fromCodePoint(...e));
}
function Cr(e) {
	return Uint8Array.from(atob(e), (e) => e.charCodeAt(0));
}
function wr(e) {
	return new TextEncoder().encode(e);
}
function Tr(e) {
	return Sr(wr(e));
}
m((e) => e instanceof Uint8Array).or(t().transform(wr)), m((e) => e instanceof Uint8Array).or(t().transform(Cr));
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/is-plain-object.js
function Er(e) {
	if (typeof e != "object" || !e) return !1;
	let t = Object.getPrototypeOf(e);
	return (t === null || t === Object.prototype || Object.getPrototypeOf(t) === null) && !(Symbol.toStringTag in e) && !(Symbol.iterator in e);
}
function Dr(e) {
	return (t, n, r) => {
		let i = "", a = r?.explode ? kr(t, n) : [[t, n]];
		if (a.every(([e, t]) => t == null)) return;
		let o = (e) => r?.charEncoding === "percent" ? encodeURIComponent(e) : e, s = (e) => o(Ar(e)), c = o(e);
		return a.forEach(([e, t]) => {
			let n = "", r = null;
			t != null && (r = Array.isArray(t) ? Mr(t, (e) => `${s(e)}`)?.join(c) : Er(t) ? Nr(Object.entries(t), ([e, t]) => `${o(e)}${c}${s(t)}`)?.join(c) : `${s(t)}`, r != null && (n = `${o(e)}=${r}`, !(!n || n === "=") && (i += `&${n}`)));
		}), i.slice(1);
	};
}
var Or = Dr(",");
function F(e, t, n) {
	if (t === void 0) return;
	let r = (e) => n?.charEncoding === "percent" ? encodeURIComponent(e) : e, i = r(JSON.stringify(t, jr));
	return n?.explode ? i : `${r(e)}=${i}`;
}
var I = (e, t, n) => {
	let r = "", i = n?.explode ? kr(e, t) : [[e, t]];
	if (i.every(([e, t]) => t == null)) return;
	let a = (e) => n?.charEncoding === "percent" ? encodeURIComponent(e) : e, o = (e) => a(Ar(e));
	return i.forEach(([e, i]) => {
		let s = "";
		i != null && (s = Array.isArray(i) ? Mr(i, (e) => `${o(e)}`)?.join(",") : Er(i) ? Nr(Object.entries(i), ([e, t]) => `,${a(e)},${o(t)}`)?.join("").slice(1) : `${n?.explode && Er(t) ? `${e}=` : ""}${o(i)}`, r += s ? `,${s}` : "");
	}), r.slice(1);
};
function kr(e, t) {
	return Array.isArray(t) ? t.map((t) => [e, t]) : Er(t) ? Object.entries(t ?? {}).map(([e, t]) => [e, t]) : [[e, t]];
}
function Ar(e) {
	return e == null ? "" : e instanceof Date ? e.toISOString() : e instanceof Uint8Array ? Sr(e) : typeof e == "object" ? JSON.stringify(e, jr) : `${e}`;
}
function jr(e, t) {
	return t instanceof Uint8Array ? Sr(t) : t;
}
function Mr(e, t) {
	let n = e.reduce((e, n) => {
		if (n == null) return e;
		let r = t(n);
		return r == null || e.push(r), e;
	}, []);
	return n.length ? n : null;
}
function Nr(e, t) {
	let n = [];
	for (let [r, i] of e) {
		if (i == null) continue;
		let e = t([r, i]);
		e != null && n.push(e);
	}
	return n.length ? n : null;
}
function Pr(...e) {
	return e.filter(Boolean).join("&");
}
function Fr(e) {
	return function(t, n) {
		let r = {
			...n,
			explode: n?.explode ?? !0,
			charEncoding: n?.charEncoding ?? "percent"
		}, i = new Set(n?.allowEmptyValue ?? []);
		return Pr(...Object.entries(t).map(([t, n]) => i.has(t) && (n == null || n === "" || Array.isArray(n) && n.length === 0) ? `${encodeURIComponent(t)}=` : e(t, n, r)));
	};
}
var Ir = Fr(F), L = Fr(Or);
function Lr(e) {
	if (e instanceof Blob) return !0;
	if (typeof e != "object" || !e || !(Symbol.toStringTag in e)) return !1;
	let t = e[Symbol.toStringTag];
	return t !== "Blob" && t !== "File" ? !1 : "stream" in e && typeof e.stream == "function";
}
function R(e, t, n, r) {
	n != null && (Lr(n) ? r ? e.append(t, n, r) : e.append(t, n) : Array.isArray(n) ? n.forEach((n) => {
		R(e, t, n);
	}) : e.append(t, String(n)));
}
async function Rr(e) {
	return e instanceof Blob ? e : new Blob([await e.arrayBuffer()], { type: e.type });
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/dlv.js
function zr(e, t, n, r, i) {
	for (t = Array.isArray(t) ? t : t.split("."), r = 0; r < t.length; r++) {
		let n = t[r];
		e = n != null && e ? e[n] : i;
	}
	return e === i ? n : e;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/env.js
var Br = S({
	MISTRAL_API_KEY: t().optional(),
	MISTRAL_DEBUG: ee().optional()
});
function Vr() {
	return "Deno" in globalThis;
}
var Hr = void 0;
function Ur() {
	if (Hr) return Hr;
	let e = {};
	return e = Vr() ? globalThis.Deno?.env?.toObject?.() ?? {} : zr(globalThis, "process.env") ?? {}, Hr = Br.parse(e), Hr;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/retries.js
var Wr = {
	initialInterval: 500,
	maxInterval: 6e4,
	exponent: 1.5,
	maxElapsedTime: 36e5
}, Gr = class e extends Error {
	cause;
	constructor(t, n) {
		let r = t;
		n?.cause && (r += `: ${n.cause}`), super(r, n), this.name = "PermanentError", this.cause === void 0 && (this.cause = n?.cause), Object.setPrototypeOf(this, e.prototype);
	}
}, Kr = class e extends Error {
	response;
	constructor(t, n) {
		super(t), this.response = n, this.name = "TemporaryError", Object.setPrototypeOf(this, e.prototype);
	}
};
async function qr(e, t) {
	switch (t.config.strategy) {
		case "backoff": return Zr(Jr(e, {
			statusCodes: t.statusCodes,
			retryConnectionErrors: !!t.config.retryConnectionErrors
		}), t.config.backoff ?? Wr);
		default: return await e();
	}
}
function Jr(e, t) {
	return async () => {
		try {
			let n = await e();
			if (Xr(n, t.statusCodes)) throw new Kr("Response failed with retryable status code", n);
			return n;
		} catch (e) {
			throw e instanceof Kr || t.retryConnectionErrors && (er(e) || $n(e)) ? e : new Gr("Permanent error", { cause: e });
		}
	};
}
var Yr = /* @__PURE__ */ RegExp("^[0-9]xx$", "i");
function Xr(e, t) {
	let n = `${e.status}`;
	return t.some((e) => {
		if (!Yr.test(e)) return e === n;
		let t = e.charAt(0);
		if (!t) throw Error("Invalid status code range");
		let r = n.charAt(0);
		if (!r) throw Error(`Invalid response status code: ${n}`);
		return r === t;
	});
}
async function Zr(e, t) {
	let { maxElapsedTime: n, initialInterval: r, exponent: i, maxInterval: a } = t, o = Date.now(), s = 0;
	for (;;) try {
		return await e();
	} catch (e) {
		if (e instanceof Gr) throw e.cause;
		if (Date.now() - o > n) {
			if (e instanceof Kr) return e.response;
			throw e;
		}
		let t = 0;
		e instanceof Kr && (t = Qr(e.response)), t <= 0 && (t = r * s ** +i + Math.random() * 1e3), await $r(Math.min(t, a)), s++;
	}
}
function Qr(e) {
	let t = e.headers.get("retry-after") || "";
	if (!t) return 0;
	let n = Number(t);
	if (Number.isInteger(n)) return n * 1e3;
	let r = Date.parse(t);
	if (Number.isInteger(r)) {
		let e = r - Date.now();
		return e > 0 ? Math.ceil(e) : 0;
	}
	return 0;
}
async function $r(e) {
	return new Promise((t) => setTimeout(t, e));
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/sdks.js
var ei = typeof globalThis > "u" ? null : globalThis, ti = typeof ei == "object" && !!ei && "importScripts" in ei && typeof ei.importScripts == "function" || typeof navigator < "u" && "serviceWorker" in navigator || typeof window == "object" && window.document !== void 0, z = class {
	#e;
	#t;
	#n;
	_baseURL;
	_options;
	constructor(e = {}) {
		let t = e;
		this.#t = typeof t == "object" && t && "hooks" in t && t.hooks instanceof pr ? t.hooks : new pr();
		let n = Hn(e);
		n && (n.pathname = n.pathname.replace(/\/+$/, "") + "/");
		let { baseURL: r, client: i } = this.#t.sdkInit({
			baseURL: n,
			client: e.httpClient || new Jn()
		});
		this._baseURL = r, this.#e = i, this._options = {
			...e,
			hooks: this.#t
		}, this.#n = this._options.debugLogger, !this.#n && Ur().MISTRAL_DEBUG && (this.#n = console);
	}
	_createRequest(e, t, n) {
		let { method: r, path: i, query: a, headers: o, security: s } = t, c = t.baseURL ?? this._baseURL;
		if (!c) return xr(new gr("No base URL provided for operation"));
		let l = new URL(c), u;
		i ? (l.pathname = l.pathname.replace(/\/+$/, "") + "/", u = new URL(i, l)) : u = l, u.hash = "";
		let d = a || "", f = [];
		for (let [e, t] of Object.entries(s?.queryParams || {})) {
			let n = Or(e, t, { charEncoding: "percent" });
			n !== void 0 && f.push(n);
		}
		if (f.length && (d += `&${f.join("&")}`), d) {
			let e = d.startsWith("&") ? d.slice(1) : d;
			u.search = `?${e}`;
		}
		let p = new Headers(o), m = s?.basic.username, h = s?.basic.password;
		if (m != null || h != null) {
			let e = Tr([m || "", h || ""].join(":"));
			p.set("Authorization", `Basic ${e}`);
		}
		let g = new Headers(s?.headers || {});
		for (let [e, t] of g) p.set(e, t);
		let _ = p.get("cookie") || "";
		for (let [e, t] of Object.entries(s?.cookies || {})) _ += `; ${e}=${t}`;
		_ = _.startsWith("; ") ? _.slice(2) : _, p.set("cookie", _);
		let v = new Headers(n?.headers ?? n?.fetchOptions?.headers);
		for (let [e, t] of v) p.set(e, t);
		ti || p.set(t.uaHeader ?? "user-agent", t.userAgent ?? Un.userAgent);
		let y = {
			...n?.fetchOptions,
			...n
		};
		!y?.signal && t.timeoutMs && t.timeoutMs > 0 && (y.signal = AbortSignal.timeout(t.timeoutMs)), t.body instanceof ReadableStream && Object.assign(y, { duplex: "half" });
		let b;
		try {
			b = this.#t.beforeCreateRequest(e, {
				url: u,
				options: {
					...y,
					body: t.body ?? null,
					headers: p,
					method: r
				}
			});
		} catch (e) {
			return xr(new hr("Create request hook failed to execute", { cause: e }));
		}
		return br(new Request(b.url, b.options));
	}
	async _do(e, t) {
		let { context: n, isErrorStatusCode: r } = t;
		return qr(async () => {
			let t = await this.#t.beforeRequest(n, e.clone());
			await ii(this.#n, t).catch((e) => this.#n?.log("Failed to log request:", e));
			let i = await this.#e.request(t);
			try {
				if (r(i.status)) {
					let e = await this.#t.afterError(n, i, null);
					if (e.error) throw e.error;
					i = e.response || i;
				} else i = await this.#t.afterSuccess(n, i);
			} finally {
				await ai(this.#n, i, t).catch((e) => this.#n?.log("Failed to log response:", e));
			}
			return i;
		}, {
			config: t.retryConfig,
			statusCodes: t.retryCodes
		}).then((e) => br(e), (e) => {
			switch (!0) {
				case tr(e): return xr(new _r("Request aborted by client", { cause: e }));
				case er(e): return xr(new vr("Request timed out", { cause: e }));
				case $n(e): return xr(new yr("Unable to make request", { cause: e }));
				default: return xr(new hr("Unexpected HTTP client error", { cause: e }));
			}
		});
	}
}, ni = /^(application|text)\/([^+]+\+)*json.*/, ri = /^(application|text)\/([^+]+\+)*(jsonl|x-ndjson)\b.*/;
async function ii(e, t) {
	if (!e) return;
	let n = t.headers.get("content-type"), r = n?.split(";")[0] || "";
	e.group(`> Request: ${t.method} ${t.url}`), e.group("Headers:");
	for (let [n, r] of t.headers.entries()) e.log(`${n}: ${r}`);
	switch (e.groupEnd(), e.group("Body:"), !0) {
		case ni.test(r):
			e.log(await t.clone().json());
			break;
		case r.startsWith("text/"):
			e.log(await t.clone().text());
			break;
		case r === "multipart/form-data": {
			let n = await t.clone().formData();
			for (let [t, r] of n) {
				let n = r instanceof Blob ? "<Blob>" : r;
				e.log(`${t}: ${n}`);
			}
			break;
		}
		default: e.log(`<${n}>`);
	}
	e.groupEnd(), e.groupEnd();
}
async function ai(e, t, n) {
	if (!e) return;
	let r = t.headers.get("content-type"), i = r?.split(";")[0] || "";
	e.group(`< Response: ${n.method} ${n.url}`), e.log("Status Code:", t.status, t.statusText), e.group("Headers:");
	for (let [n, r] of t.headers.entries()) e.log(`${n}: ${r}`);
	switch (e.groupEnd(), e.group("Body:"), !0) {
		case Xn(t, "application/json") || ni.test(i) && !ri.test(i):
			e.log(await t.clone().json());
			break;
		case Xn(t, "application/jsonl") || ri.test(i):
		case Xn(t, "text/event-stream"):
			e.log(`<${r}>`);
			break;
		case Xn(t, "text/*"):
			e.log(await t.clone().text());
			break;
		case Xn(t, "multipart/form-data"): {
			let n = await t.clone().formData();
			for (let [t, r] of n) {
				let n = r instanceof Blob ? "<Blob>" : r;
				e.log(`${t}: ${n}`);
			}
			break;
		}
		default: e.log(`<${r}>`);
	}
	e.groupEnd(), e.groupEnd();
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/errors/mistralerror.js
var oi = class extends Error {
	statusCode;
	body;
	headers;
	contentType;
	rawResponse;
	constructor(e, t) {
		super(e), this.statusCode = t.response.status, this.body = t.body, this.headers = t.response.headers, this.contentType = t.response.headers.get("content-type") || "", this.rawResponse = t.response, this.name = "MistralError";
	}
}, si = class extends Error {
	rawValue;
	rawMessage;
	static [Symbol.hasInstance](e) {
		return !(!(e instanceof Error) || !("rawValue" in e) || !("rawMessage" in e) || !("pretty" in e) || typeof e.pretty != "function");
	}
	constructor(e, t, n) {
		super(`${e}: ${t}`), this.name = "SDKValidationError", this.cause = t, this.rawValue = n, this.rawMessage = e;
	}
	pretty() {
		return this.cause instanceof r ? `${this.rawMessage}\n${ci(this.cause)}` : this.toString();
	}
};
function ci(e) {
	return i(e);
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/errors/responsevalidationerror.js
var li = class extends oi {
	rawValue;
	rawMessage;
	constructor(e, t) {
		super(e, t), this.name = "ResponseValidationError", this.cause = t.cause, this.rawValue = t.rawValue, this.rawMessage = t.rawMessage;
	}
	pretty() {
		return this.cause instanceof r ? `${this.rawMessage}\n${ci(this.cause)}` : this.toString();
	}
}, ui = class extends oi {
	constructor(e, t) {
		e && (e += ": "), e += `Status ${t.response.status}`;
		let n = t.response.headers.get("content-type") || "\"\"";
		n !== "application/json" && (e += ` Content-Type ${n.includes(" ") ? `"${n}"` : n}`);
		let r = t.body || "\"\"";
		e += r.length > 100 ? "\n" : ". ";
		let i = r;
		r.length > 1e4 && (i = `${r.substring(0, 1e4)}...and ${r.length - 1e4} more chars`), e += `Body: ${i}`, e = e.trim(), super(e, t), this.name = "SDKError";
	}
}, di = {
	jsonl: "application/jsonl",
	json: "application/json",
	text: "text/plain",
	bytes: "application/octet-stream",
	stream: "application/octet-stream",
	sse: "text/event-stream",
	nil: "*",
	fail: "*"
};
function B(e, t, n) {
	return {
		...n,
		err: !0,
		enc: "json",
		codes: e,
		schema: t
	};
}
function V(e, t, n) {
	return {
		...n,
		enc: "json",
		codes: e,
		schema: t
	};
}
function fi(e, t, n) {
	return {
		...n,
		enc: "stream",
		codes: e,
		schema: t
	};
}
function pi(e, t, n) {
	return {
		...n,
		enc: "sse",
		codes: e,
		schema: t
	};
}
function mi(e, t, n) {
	return {
		...n,
		enc: "nil",
		codes: e,
		schema: t
	};
}
function H(e) {
	return {
		enc: "fail",
		codes: e
	};
}
function U(...e) {
	return async function(t, n, r) {
		let i, a;
		for (let n of e) {
			let { codes: e } = n, r = "ctype" in n ? n.ctype : di[n.enc];
			if (r && Qn(t, e, r)) {
				a = n;
				break;
			}
			if (!r && N(t, e)) {
				a = n;
				break;
			}
		}
		if (!a) return [{
			ok: !1,
			error: new ui("Unexpected Status or Content-Type", {
				response: t,
				request: n,
				body: await t.text().catch(() => "")
			})
		}, i];
		let o = a.enc, s = "";
		switch (o) {
			case "json":
				s = await t.text(), i = JSON.parse(s);
				break;
			case "jsonl":
				i = t.body;
				break;
			case "bytes":
				i = new Uint8Array(await t.arrayBuffer());
				break;
			case "stream":
				i = t.body;
				break;
			case "text":
				s = await t.text(), i = s;
				break;
			case "sse":
				i = t.body;
				break;
			case "nil":
				s = await t.text(), i = void 0;
				break;
			case "fail":
				s = await t.text(), i = s;
				break;
			default: throw Error(`Unsupported response type: ${o}`);
		}
		if (a.enc === "fail") return [{
			ok: !1,
			error: new ui("API error occurred", {
				request: n,
				response: t,
				body: s
			})
		}, i];
		let c = a.key || r?.resultKey, l;
		if (l = "err" in a ? {
			...r?.extraFields,
			...a.hdrs ? { Headers: gi(t.headers) } : null,
			...Er(i) ? i : null,
			request$: n,
			response$: t,
			body$: s
		} : c ? {
			...r?.extraFields,
			...a.hdrs ? { Headers: gi(t.headers) } : null,
			[c]: i
		} : a.hdrs ? {
			...r?.extraFields,
			...a.hdrs ? { Headers: gi(t.headers) } : null,
			...Er(i) ? i : null
		} : i, "err" in a) {
			let e = _i(l, (e) => a.schema.parse(e), "Response validation failed", {
				request: n,
				response: t,
				body: s
			});
			return [e.ok ? {
				ok: !1,
				error: e.value
			} : e, i];
		}
		return [_i(l, (e) => a.schema.parse(e), "Response validation failed", {
			request: n,
			response: t,
			body: s
		}), i];
	};
}
var hi = /, */;
function gi(e) {
	let t = {};
	for (let [n, r] of e.entries()) t[n] = r.split(hi);
	return t;
}
function _i(e, t, n, r) {
	try {
		return br(t(e));
	} catch (t) {
		return xr(new li(n, {
			cause: t,
			rawValue: e,
			rawMessage: n,
			...r
		}));
	}
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/primitives.js
function W(e, t) {
	let n = {};
	if (!Object.keys(t).length) return n = e, n;
	for (let [r, i] of Object.entries(e)) {
		let e = t[r];
		e !== null && (n[e ?? r] = i);
	}
	return n;
}
function G(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== void 0 && (t[n] = r);
	return t;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/schemas.js
function K(e, t, n) {
	try {
		return br(t(e));
	} catch (t) {
		return xr(new si(n, t, e));
	}
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/security.js
var vi;
(function(e) {
	e.Incomplete = "incomplete", e.UnrecognisedSecurityType = "unrecognized_security_type";
})(vi ||= {});
var yi = class e extends Error {
	code;
	constructor(e, t) {
		super(t), this.code = e, this.name = "SecurityError";
	}
	static incomplete() {
		return new e(vi.Incomplete, "Security requirements not met in order to perform the operation");
	}
	static unrecognizedType(t) {
		return new e(vi.UnrecognisedSecurityType, `Unrecognised security type: ${t}`);
	}
};
function bi(...e) {
	let t = {
		basic: {},
		headers: {},
		queryParams: {},
		cookies: {},
		oauth2: { type: "none" }
	}, n = e.find((e) => e.every((e) => {
		if (e.value == null) return !1;
		if (e.type === "http:basic") return e.value.username != null || e.value.password != null;
		if (e.type === "http:custom") return null;
		if (e.type === "oauth2:password") return typeof e.value == "string" && !!e.value;
		if (e.type === "oauth2:client_credentials") return typeof e.value == "string" ? !!e.value : e.value.clientID != null || e.value.clientSecret != null;
		if (typeof e.value == "string") return !!e.value;
		throw Error(`Unrecognized security type: ${e.type} (value type: ${typeof e.value})`);
	}));
	return n == null ? null : (n.forEach((e) => {
		if (e.value == null) return;
		let { type: n } = e;
		switch (n) {
			case "apiKey:header":
				t.headers[e.fieldName] = e.value;
				break;
			case "apiKey:query":
				t.queryParams[e.fieldName] = e.value;
				break;
			case "apiKey:cookie":
				t.cookies[e.fieldName] = e.value;
				break;
			case "http:basic":
				xi(t, e);
				break;
			case "http:custom": break;
			case "http:bearer":
				Si(t, e);
				break;
			case "oauth2":
				Si(t, e);
				break;
			case "oauth2:password":
				Si(t, e);
				break;
			case "oauth2:client_credentials": break;
			case "openIdConnect":
				Si(t, e);
				break;
			default: throw yi.unrecognizedType(n);
		}
	}), t);
}
function xi(e, t) {
	t.value != null && (e.basic = t.value);
}
function Si(e, t) {
	if (typeof t.value != "string" || !t.value) return;
	let n = t.value;
	n.slice(0, 7).toLowerCase() !== "bearer " && (n = `Bearer ${n}`), t.fieldName !== void 0 && (e.headers[t.fieldName] = n);
}
function q(e, t) {
	let n = [[{
		fieldName: "Authorization",
		type: "http:bearer",
		value: e?.apiKey ?? Ur().MISTRAL_API_KEY
	}]];
	return t && (n = t.map((e) => {
		if (e < 0 || e >= n.length) throw RangeError(`invalid allowedFields index ${e}`);
		return n[e];
	})), bi(...n);
}
async function J(e) {
	if (e != null) return typeof e == "function" ? e() : e;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/types/unrecognized.js
function Ci(e) {
	return wi++, e;
}
var wi = 0, Ti = 0;
function Ei() {
	Ti++;
	let e = wi;
	return { end: (t) => {
		let n = wi - e;
		return wi = e + (t ?? n), --Ti === 0 && (wi = 0), n;
	} };
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/types/enums.js
function Y(e) {
	let n = Object.values(e);
	return x([...n.map((e) => p(e)), t().transform((e) => Ci(e))]);
}
function Di(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return x([...t.map((e) => p(e)), f().transform((e) => Ci(e))]);
}
function Oi(e) {
	return t();
}
function ki(e) {
	return f();
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/encodedpayloadoptions.js
var Ai = {
	Offloaded: "offloaded",
	Encrypted: "encrypted",
	EncryptedPartial: "encrypted-partial",
	Compressed: "compressed"
}, ji = Y(Ai), Mi = Oi(Ai), Ni = S({
	type: p("json").default("json"),
	value: g(),
	encoding_options: l(v(ji)).optional()
}).transform((e) => W(e, { encoding_options: "encodingOptions" })), Pi = S({
	task_id: t(),
	activity_name: t(),
	result: Ni
}).transform((e) => W(e, {
	task_id: "taskId",
	activity_name: "activityName"
})), Fi = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("ACTIVITY_TASK_COMPLETED").default("ACTIVITY_TASK_COMPLETED"),
	attributes: Pi
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), Ii = S({ message: t() }), Li = S({
	task_id: t(),
	activity_name: t(),
	attempt: f(),
	failure: Ii
}).transform((e) => W(e, {
	task_id: "taskId",
	activity_name: "activityName"
})), Ri = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("ACTIVITY_TASK_FAILED").default("ACTIVITY_TASK_FAILED"),
	attributes: Li
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), zi = S({
	task_id: t(),
	activity_name: t(),
	attempt: f(),
	failure: Ii
}).transform((e) => W(e, {
	task_id: "taskId",
	activity_name: "activityName"
})), Bi = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("ACTIVITY_TASK_RETRYING").default("ACTIVITY_TASK_RETRYING"),
	attributes: zi
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), Vi = S({
	task_id: t(),
	activity_name: t(),
	input: Ni
}).transform((e) => W(e, {
	task_id: "taskId",
	activity_name: "activityName"
})), Hi = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("ACTIVITY_TASK_STARTED").default("ACTIVITY_TASK_STARTED"),
	attributes: Vi
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), Ui = Symbol("UNKNOWN");
function Wi(e) {
	return typeof e == "object" && !!e && Ui in e;
}
function Gi(e, t, n = {}) {
	let { unknownValue: r = "UNKNOWN", outputPropertyName: i } = n;
	return c().transform((n) => {
		let a = Object.defineProperties({
			raw: n,
			[i ?? e]: r,
			isUnknown: !0
		}, { [Ui]: {
			value: !0,
			enumerable: !1,
			configurable: !1
		} });
		if (!(typeof n == "object" && n)) return a;
		let o = n[e];
		if (typeof o != "string" || !(o in t)) return a;
		let s = t[o];
		if (!s) return a;
		let c = Ei(), l = s.safeParse(n);
		return l.success ? (c.end(), i && (l.data[i] = o), l.data) : (c.end(0), a);
	});
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/toolconfiguration.js
var Ki = S({
	exclude: l(v(t())).optional(),
	include: l(v(t())).optional(),
	requires_confirmation: l(v(t())).optional()
}).transform((e) => W(e, { requires_confirmation: "requiresConfirmation" })), qi = S({
	exclude: l(v(t())).optional(),
	include: l(v(t())).optional(),
	requiresConfirmation: l(v(t())).optional()
}).transform((e) => W(e, { requiresConfirmation: "requires_confirmation" })), Ji = S({
	tool_configuration: l(Ki).optional(),
	type: p("code_interpreter")
}).transform((e) => W(e, { tool_configuration: "toolConfiguration" })), Yi = S({
	toolConfiguration: l(qi).optional(),
	type: p("code_interpreter")
}).transform((e) => W(e, { toolConfiguration: "tool_configuration" })), Xi = /^\d{4}-\d{2}-\d{2}$/, Zi = class e {
	serialized;
	static today() {
		return new e(/* @__PURE__ */ new Date());
	}
	constructor(e) {
		if (typeof e == "string" && !Xi.test(e)) throw RangeError("RFCDate: date strings must be in the format YYYY-MM-DD: " + e);
		let t = new Date(e);
		if (isNaN(+t)) throw RangeError("RFCDate: invalid date provided: " + e);
		if (this.serialized = t.toISOString().slice(0, 10), !Xi.test(this.serialized)) throw TypeError(`RFCDate: failed to build valid date with given value: ${e} serialized to ${this.serialized}`);
	}
	toJSON() {
		return this.toString();
	}
	toString() {
		return this.serialized;
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/types/smartUnion.js
function X(e) {
	return c().transform((t, n) => {
		let r = [], i = e.map(() => []), a = Ei();
		for (let [n, a] of e.entries()) {
			let e = Ei(), o = a.safeParse(t), s = e.end();
			if (o.success) {
				r.push({
					data: o.data,
					inexactCount: s,
					zeroDefaultCount: 0,
					fieldCount: -1
				});
				continue;
			}
			i[n].push(...o.error.issues);
		}
		if (r.length === 0) return a.end(0), n.addIssue({
			input: t,
			code: "invalid_union",
			errors: i
		}), o;
		let s = r[0];
		for (let e of r) r.length > 1 && (e.fieldCount = $i(e.data)), s = Qi(e, s);
		return a.end(s.inexactCount), s.data;
	});
}
function Qi(e, t) {
	let n = e.inexactCount === 0;
	if (n !== (t.inexactCount === 0)) return n ? e : t;
	let r = e.fieldCount - e.zeroDefaultCount, i = t.fieldCount - t.zeroDefaultCount;
	return r === i ? e.inexactCount < t.inexactCount ? e : t : r > i ? e : t;
}
function $i(e) {
	let t = 0, n = [e], r = 0;
	for (; r < n.length;) {
		let e = n[r++];
		if (e === void 0 || Wi(e)) continue;
		let i = typeof e;
		if (e === null || i === "number" || i === "string" || i === "boolean" || i === "bigint" || e instanceof Date || e instanceof Zi) {
			t++;
			continue;
		}
		if (Array.isArray(e)) {
			n.push(...e);
			continue;
		}
		i === "object" && n.push(...Object.values(e));
	}
	return t;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/completionargsstop.js
var ea = X([t(), v(t())]), ta = X([t(), v(t())]), na = S({
	type: p("content").default("content"),
	content: t().default("")
}), ra = S({
	type: p("content").default("content"),
	content: t().default("")
}), ia = {
	None: "none",
	Minimal: "minimal",
	Low: "low",
	Medium: "medium",
	High: "high",
	Xhigh: "xhigh"
}, aa = Y(ia), oa = Oi(ia), sa = S({
	name: t(),
	description: l(t()).optional(),
	schema: s(t(), g()),
	strict: d().optional()
}).transform((e) => W(e, { schema: "schemaDefinition" })), ca = S({
	name: t(),
	description: l(t()).optional(),
	schemaDefinition: s(t(), g()),
	strict: d().optional()
}).transform((e) => W(e, { schemaDefinition: "schema" })), la = {
	Text: "text",
	JsonObject: "json_object",
	JsonSchema: "json_schema"
}, ua = Y(la), da = Oi(la), fa = S({
	type: ua.optional(),
	json_schema: l(sa).optional()
}).transform((e) => W(e, { json_schema: "jsonSchema" })), pa = S({
	type: da.optional(),
	jsonSchema: l(ca).optional()
}).transform((e) => W(e, { jsonSchema: "json_schema" })), ma = {
	Auto: "auto",
	None: "none",
	Any: "any",
	Required: "required"
}, ha = Y(ma), ga = Oi(ma), _a = S({
	stop: l(ea).optional(),
	presence_penalty: l(b()).optional(),
	frequency_penalty: l(b()).optional(),
	temperature: l(b()).optional(),
	top_p: l(b()).optional(),
	max_tokens: l(f()).optional(),
	random_seed: l(f()).optional(),
	prediction: l(na).optional(),
	response_format: l(fa).optional(),
	tool_choice: ha.optional(),
	reasoning_effort: l(aa).optional()
}).transform((e) => W(e, {
	presence_penalty: "presencePenalty",
	frequency_penalty: "frequencyPenalty",
	top_p: "topP",
	max_tokens: "maxTokens",
	random_seed: "randomSeed",
	response_format: "responseFormat",
	tool_choice: "toolChoice",
	reasoning_effort: "reasoningEffort"
})), va = S({
	stop: l(ta).optional(),
	presencePenalty: l(b()).optional(),
	frequencyPenalty: l(b()).optional(),
	temperature: l(b()).optional(),
	topP: l(b()).optional(),
	maxTokens: l(f()).optional(),
	randomSeed: l(f()).optional(),
	prediction: l(ra).optional(),
	responseFormat: l(pa).optional(),
	toolChoice: ga.optional(),
	reasoningEffort: l(oa).optional()
}).transform((e) => W(e, {
	presencePenalty: "presence_penalty",
	frequencyPenalty: "frequency_penalty",
	topP: "top_p",
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	responseFormat: "response_format",
	toolChoice: "tool_choice",
	reasoningEffort: "reasoning_effort"
})), ya = S({
	type: p("api-key"),
	value: t()
}), ba = S({
	type: p("api-key"),
	value: t()
}), xa = S({
	type: p("oauth2-token"),
	value: t()
}), Sa = S({
	type: p("oauth2-token"),
	value: t()
});
Gi("type", {
	"api-key": ya,
	"oauth2-token": xa
}), x([ba, Sa]);
var Ca = S({
	type: p("connector"),
	connector_id: t(),
	authorization: l(Gi("type", {
		"api-key": ya,
		"oauth2-token": xa
	})).optional(),
	tool_configuration: l(Ki).optional()
}).transform((e) => W(e, {
	connector_id: "connectorId",
	tool_configuration: "toolConfiguration"
})), wa = S({
	type: p("connector"),
	connectorId: t(),
	authorization: l(x([ba, Sa])).optional(),
	toolConfiguration: l(qi).optional()
}).transform((e) => W(e, {
	connectorId: "connector_id",
	toolConfiguration: "tool_configuration"
})), Ta = S({
	tool_configuration: l(Ki).optional(),
	type: p("document_library"),
	library_ids: v(t())
}).transform((e) => W(e, {
	tool_configuration: "toolConfiguration",
	library_ids: "libraryIds"
})), Ea = S({
	toolConfiguration: l(qi).optional(),
	type: p("document_library"),
	libraryIds: v(t())
}).transform((e) => W(e, {
	toolConfiguration: "tool_configuration",
	libraryIds: "library_ids"
})), Da = S({
	name: t(),
	description: t().optional(),
	strict: d().optional(),
	parameters: s(t(), g())
}), Oa = S({
	name: t(),
	description: t().optional(),
	strict: d().optional(),
	parameters: s(t(), g())
}), ka = S({
	type: p("function"),
	function: Da
}), Aa = S({
	type: p("function"),
	function: Oa
}), ja = {
	None: "none",
	Block: "block"
}, Ma = Y(ja), Na = Oi(ja), Pa = S({
	sexual: l(b()).optional(),
	hate_and_discrimination: l(b()).optional(),
	violence_and_threats: l(b()).optional(),
	dangerous_and_criminal_content: l(b()).optional(),
	selfharm: l(b()).optional(),
	health: l(b()).optional(),
	financial: l(b()).optional(),
	law: l(b()).optional(),
	pii: l(b()).optional()
}).transform((e) => W(e, {
	hate_and_discrimination: "hateAndDiscrimination",
	violence_and_threats: "violenceAndThreats",
	dangerous_and_criminal_content: "dangerousAndCriminalContent"
})), Fa = S({
	sexual: l(b()).optional(),
	hateAndDiscrimination: l(b()).optional(),
	violenceAndThreats: l(b()).optional(),
	dangerousAndCriminalContent: l(b()).optional(),
	selfharm: l(b()).optional(),
	health: l(b()).optional(),
	financial: l(b()).optional(),
	law: l(b()).optional(),
	pii: l(b()).optional()
}).transform((e) => W(e, {
	hateAndDiscrimination: "hate_and_discrimination",
	violenceAndThreats: "violence_and_threats",
	dangerousAndCriminalContent: "dangerous_and_criminal_content"
})), Ia = S({
	model_name: t().default("mistral-moderation-2411"),
	custom_category_thresholds: l(Pa).optional(),
	ignore_other_categories: d().default(!1),
	action: Ma.optional()
}).transform((e) => W(e, {
	model_name: "modelName",
	custom_category_thresholds: "customCategoryThresholds",
	ignore_other_categories: "ignoreOtherCategories"
})), La = S({
	modelName: t().default("mistral-moderation-2411"),
	customCategoryThresholds: l(Fa).optional(),
	ignoreOtherCategories: d().default(!1),
	action: Na.optional()
}).transform((e) => W(e, {
	modelName: "model_name",
	customCategoryThresholds: "custom_category_thresholds",
	ignoreOtherCategories: "ignore_other_categories"
})), Ra = S({
	sexual: l(b()).optional(),
	hate_and_discrimination: l(b()).optional(),
	violence_and_threats: l(b()).optional(),
	dangerous: l(b()).optional(),
	criminal: l(b()).optional(),
	selfharm: l(b()).optional(),
	health: l(b()).optional(),
	financial: l(b()).optional(),
	law: l(b()).optional(),
	pii: l(b()).optional(),
	jailbreaking: l(b()).optional()
}).transform((e) => W(e, {
	hate_and_discrimination: "hateAndDiscrimination",
	violence_and_threats: "violenceAndThreats"
})), za = S({
	sexual: l(b()).optional(),
	hateAndDiscrimination: l(b()).optional(),
	violenceAndThreats: l(b()).optional(),
	dangerous: l(b()).optional(),
	criminal: l(b()).optional(),
	selfharm: l(b()).optional(),
	health: l(b()).optional(),
	financial: l(b()).optional(),
	law: l(b()).optional(),
	pii: l(b()).optional(),
	jailbreaking: l(b()).optional()
}).transform((e) => W(e, {
	hateAndDiscrimination: "hate_and_discrimination",
	violenceAndThreats: "violence_and_threats"
})), Ba = S({
	model_name: t().default("mistral-moderation-2603"),
	custom_category_thresholds: l(Ra).optional(),
	ignore_other_categories: d().default(!1),
	action: Ma.optional()
}).transform((e) => W(e, {
	model_name: "modelName",
	custom_category_thresholds: "customCategoryThresholds",
	ignore_other_categories: "ignoreOtherCategories"
})), Va = S({
	modelName: t().default("mistral-moderation-2603"),
	customCategoryThresholds: l(za).optional(),
	ignoreOtherCategories: d().default(!1),
	action: Na.optional()
}).transform((e) => W(e, {
	modelName: "model_name",
	customCategoryThresholds: "custom_category_thresholds",
	ignoreOtherCategories: "ignore_other_categories"
})), Ha = S({
	block_on_error: d().default(!1),
	moderation_llm_v1: l(Ia).optional(),
	moderation_llm_v2: l(Ba).optional()
}).transform((e) => W(e, {
	block_on_error: "blockOnError",
	moderation_llm_v1: "moderationLlmV1",
	moderation_llm_v2: "moderationLlmV2"
})), Ua = S({
	blockOnError: d().default(!1),
	moderationLlmV1: l(La).optional(),
	moderationLlmV2: l(Va).optional()
}).transform((e) => W(e, {
	blockOnError: "block_on_error",
	moderationLlmV1: "moderation_llm_v1",
	moderationLlmV2: "moderation_llm_v2"
})), Wa = S({
	tool_configuration: l(Ki).optional(),
	type: p("image_generation")
}).transform((e) => W(e, { tool_configuration: "toolConfiguration" })), Ga = S({
	toolConfiguration: l(qi).optional(),
	type: p("image_generation")
}).transform((e) => W(e, { toolConfiguration: "tool_configuration" })), Ka = S({
	tool_configuration: l(Ki).optional(),
	type: p("web_search_premium")
}).transform((e) => W(e, { tool_configuration: "toolConfiguration" })), qa = S({
	toolConfiguration: l(qi).optional(),
	type: p("web_search_premium")
}).transform((e) => W(e, { toolConfiguration: "tool_configuration" })), Ja = S({
	tool_configuration: l(Ki).optional(),
	type: p("web_search")
}).transform((e) => W(e, { tool_configuration: "toolConfiguration" })), Ya = S({
	toolConfiguration: l(qi).optional(),
	type: p("web_search")
}).transform((e) => W(e, { toolConfiguration: "tool_configuration" }));
Gi("type", {
	code_interpreter: Ji,
	connector: Ca,
	document_library: Ta,
	function: ka,
	image_generation: Wa,
	web_search: Ja,
	web_search_premium: Ka
});
var Xa = S({
	instructions: l(t()).optional(),
	tools: v(Gi("type", {
		code_interpreter: Ji,
		connector: Ca,
		document_library: Ta,
		function: ka,
		image_generation: Wa,
		web_search: Ja,
		web_search_premium: Ka
	})).optional(),
	completion_args: _a.optional(),
	guardrails: l(v(Ha)).optional(),
	model: t(),
	name: t(),
	description: l(t()).optional(),
	handoffs: l(v(t())).optional(),
	metadata: l(s(t(), g())).optional(),
	object: p("agent").default("agent"),
	id: t(),
	version: f(),
	versions: v(f()),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deployment_chat: d(),
	source: t(),
	version_message: l(t()).optional()
}).transform((e) => W(e, {
	completion_args: "completionArgs",
	created_at: "createdAt",
	updated_at: "updatedAt",
	deployment_chat: "deploymentChat",
	version_message: "versionMessage"
})), Za = S({
	alias: t(),
	version: f(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e))
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt"
}));
X([t(), f()]);
var Qa = S({
	name: l(t()).optional(),
	description: l(t()).optional(),
	metadata: l(s(t(), g())).optional(),
	object: p("conversation").default("conversation"),
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	agent_id: t(),
	agent_version: l(X([t(), f()])).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	agent_id: "agentId",
	agent_version: "agentVersion"
})), $a = S({
	type: p("agent.handoff.done"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	next_agent_id: t(),
	next_agent_name: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex",
	next_agent_id: "nextAgentId",
	next_agent_name: "nextAgentName"
})), eo = S({
	object: p("entry").default("entry"),
	type: p("agent.handoff").default("agent.handoff"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	completed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	id: t().optional(),
	previous_agent_id: t(),
	previous_agent_name: t(),
	next_agent_id: t(),
	next_agent_name: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	completed_at: "completedAt",
	previous_agent_id: "previousAgentId",
	previous_agent_name: "previousAgentName",
	next_agent_id: "nextAgentId",
	next_agent_name: "nextAgentName"
})), to = S({
	object: p("entry").default("entry"),
	type: p("agent.handoff").default("agent.handoff"),
	createdAt: y().transform((e) => e.toISOString()).optional(),
	completedAt: l(y().transform((e) => e.toISOString())).optional(),
	id: t().optional(),
	previousAgentId: t(),
	previousAgentName: t(),
	nextAgentId: t(),
	nextAgentName: t()
}).transform((e) => W(e, {
	createdAt: "created_at",
	completedAt: "completed_at",
	previousAgentId: "previous_agent_id",
	previousAgentName: "previous_agent_name",
	nextAgentId: "next_agent_id",
	nextAgentName: "next_agent_name"
})), no = S({
	type: p("agent.handoff.started"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	previous_agent_id: t(),
	previous_agent_name: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex",
	previous_agent_id: "previousAgentId",
	previous_agent_name: "previousAgentName"
})), ro = S({
	type: p("input_audio"),
	input_audio: t()
}).transform((e) => W(e, { input_audio: "inputAudio" })), io = S({
	type: p("input_audio"),
	inputAudio: t()
}).transform((e) => W(e, { inputAudio: "input_audio" })), ao = S({
	type: p("document_url").default("document_url"),
	document_url: t(),
	document_name: l(t()).optional()
}).transform((e) => W(e, {
	document_url: "documentUrl",
	document_name: "documentName"
})), oo = S({
	type: p("document_url").default("document_url"),
	documentUrl: t(),
	documentName: l(t()).optional()
}).transform((e) => W(e, {
	documentUrl: "document_url",
	documentName: "document_name"
})), so = S({
	type: p("file").default("file"),
	file_id: t()
}).transform((e) => W(e, { file_id: "fileId" })), co = S({
	type: p("file").default("file"),
	fileId: t()
}).transform((e) => W(e, { fileId: "file_id" })), lo = {
	Low: "low",
	Auto: "auto",
	High: "high"
}, uo = Y(lo), fo = Oi(lo), po = S({
	url: t(),
	detail: l(uo).optional()
}), mo = S({
	url: t(),
	detail: l(fo).optional()
});
X([po, t()]), X([mo, t()]);
var ho = S({
	type: p("image_url").default("image_url"),
	image_url: X([po, t()])
}).transform((e) => W(e, { image_url: "imageUrl" })), go = S({
	type: p("image_url").default("image_url"),
	imageUrl: X([mo, t()])
}).transform((e) => W(e, { imageUrl: "image_url" }));
X([f(), t()]), X([f(), t()]);
var _o = S({
	type: p("reference").default("reference"),
	reference_ids: v(X([f(), t()]))
}).transform((e) => W(e, { reference_ids: "referenceIds" })), vo = S({
	type: p("reference").default("reference"),
	referenceIds: v(X([f(), t()]))
}).transform((e) => W(e, { referenceIds: "reference_ids" })), yo = S({
	type: p("text").default("text"),
	text: t()
}), bo = S({
	type: p("text").default("text"),
	text: t()
}), xo = {
	WebSearch: "web_search",
	WebSearchPremium: "web_search_premium",
	CodeInterpreter: "code_interpreter",
	ImageGeneration: "image_generation",
	DocumentLibrary: "document_library"
}, So = Y(xo), Co = Oi(xo);
X([So, t()]), X([Co, t()]);
var wo = S({
	type: p("tool_reference").default("tool_reference"),
	tool: X([So, t()]),
	title: t(),
	url: l(t()).optional(),
	favicon: l(t()).optional(),
	description: l(t()).optional()
}), To = S({
	type: p("tool_reference").default("tool_reference"),
	tool: X([Co, t()]),
	title: t(),
	url: l(t()).optional(),
	favicon: l(t()).optional(),
	description: l(t()).optional()
});
X([
	wo,
	yo,
	_o
]), X([
	To,
	bo,
	vo
]);
var Eo = S({
	type: p("thinking").default("thinking"),
	thinking: v(X([
		wo,
		yo,
		_o
	])),
	signature: l(t()).optional(),
	closed: d().optional()
}), Do = S({
	type: p("thinking").default("thinking"),
	thinking: v(X([
		To,
		bo,
		vo
	])),
	signature: l(t()).optional(),
	closed: d().optional()
}), Oo = Gi("type", {
	image_url: ho.and(S({ type: p("image_url") })),
	document_url: ao.and(S({ type: p("document_url") })),
	text: yo.and(S({ type: p("text") })),
	reference: _o.and(S({ type: p("reference") })),
	file: so.and(S({ type: p("file") })),
	thinking: Eo.and(S({ type: p("thinking") })),
	input_audio: ro
}), ko = x([
	go.and(S({ type: p("image_url") })),
	oo.and(S({ type: p("document_url") })),
	bo.and(S({ type: p("text") })),
	vo.and(S({ type: p("reference") })),
	co.and(S({ type: p("file") })),
	Do.and(S({ type: p("thinking") })),
	io
]);
X([s(t(), g()), t()]), X([s(t(), g()), t()]);
var Ao = S({
	name: t(),
	arguments: X([s(t(), g()), t()])
}), jo = S({
	name: t(),
	arguments: X([s(t(), g()), t()])
}), Mo = S({
	id: t().default("null"),
	type: t().optional(),
	function: Ao,
	index: f().default(0)
}), No = S({
	id: t().default("null"),
	type: t().optional(),
	function: jo,
	index: f().default(0)
});
X([t(), v(Oo)]), X([t(), v(ko)]);
var Po = S({
	role: p("assistant").default("assistant"),
	content: l(X([t(), v(Oo)])).optional(),
	tool_calls: l(v(Mo)).optional(),
	prefix: d().default(!1)
}).transform((e) => W(e, { tool_calls: "toolCalls" })), Fo = S({
	role: p("assistant").default("assistant"),
	content: l(X([t(), v(ko)])).optional(),
	toolCalls: l(v(No)).optional(),
	prefix: d().default(!1)
}).transform((e) => W(e, { toolCalls: "tool_calls" })), Io = Oi({ Reasoning: "reasoning" }), Lo = x([bo.and(S({ type: p("text") })), Do.and(S({ type: p("thinking") }))]);
X([t(), v(Lo)]);
var Ro = S({
	role: p("system"),
	content: X([t(), v(Lo)])
}), zo = S({
	type: p("function"),
	function: Oa
}), Bo = S({ name: t() }), Vo = S({
	type: t().optional(),
	function: Bo
});
X([t(), v(ko)]);
var Ho = S({
	role: p("tool"),
	content: l(X([t(), v(ko)])),
	toolCallId: l(t()).optional(),
	name: l(t()).optional()
}).transform((e) => W(e, { toolCallId: "tool_call_id" }));
X([t(), v(ko)]);
var Uo = S({
	role: p("user"),
	content: l(X([t(), v(ko)]))
});
X([t(), v(t())]), x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]), x([
	zo,
	Ya,
	qa,
	Yi,
	Ga,
	Ea,
	wa
]), X([Vo, ga]);
var Wo = S({
	maxTokens: l(f()).optional(),
	stream: d().default(!1),
	stop: l(X([t(), v(t())])).optional(),
	randomSeed: l(f()).optional(),
	metadata: l(s(t(), g())).optional(),
	messages: v(x([
		Fo.and(S({ role: p("assistant") })),
		Ro,
		Ho,
		Uo
	])),
	responseFormat: pa.optional(),
	tools: l(v(x([
		zo,
		Ya,
		qa,
		Yi,
		Ga,
		Ea,
		wa
	]))).optional(),
	toolChoice: X([Vo, ga]).optional(),
	presencePenalty: l(b()).optional(),
	frequencyPenalty: l(b()).optional(),
	n: l(f()).optional(),
	prediction: ra.optional(),
	parallelToolCalls: d().optional(),
	reasoningEffort: l(oa).optional(),
	promptMode: l(Io).optional(),
	guardrails: l(v(Ua)).optional(),
	promptCacheKey: l(t()).optional(),
	agentId: t()
}).transform((e) => W(e, {
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	responseFormat: "response_format",
	toolChoice: "tool_choice",
	presencePenalty: "presence_penalty",
	frequencyPenalty: "frequency_penalty",
	parallelToolCalls: "parallel_tool_calls",
	reasoningEffort: "reasoning_effort",
	promptMode: "prompt_mode",
	promptCacheKey: "prompt_cache_key",
	agentId: "agent_id"
}));
X([t(), v(t())]), x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]), x([
	zo,
	Ya,
	qa,
	Yi,
	Ga,
	Ea,
	wa
]), X([Vo, ga]);
var Go = S({
	maxTokens: l(f()).optional(),
	stream: d().default(!0),
	stop: l(X([t(), v(t())])).optional(),
	randomSeed: l(f()).optional(),
	metadata: l(s(t(), g())).optional(),
	messages: v(x([
		Fo.and(S({ role: p("assistant") })),
		Ro,
		Ho,
		Uo
	])),
	responseFormat: pa.optional(),
	tools: l(v(x([
		zo,
		Ya,
		qa,
		Yi,
		Ga,
		Ea,
		wa
	]))).optional(),
	toolChoice: X([Vo, ga]).optional(),
	presencePenalty: l(b()).optional(),
	frequencyPenalty: l(b()).optional(),
	n: l(f()).optional(),
	prediction: ra.optional(),
	parallelToolCalls: d().optional(),
	reasoningEffort: l(oa).optional(),
	promptMode: l(Io).optional(),
	guardrails: l(v(Ua)).optional(),
	promptCacheKey: l(t()).optional(),
	agentId: t()
}).transform((e) => W(e, {
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	responseFormat: "response_format",
	toolChoice: "tool_choice",
	presencePenalty: "presence_penalty",
	frequencyPenalty: "frequency_penalty",
	parallelToolCalls: "parallel_tool_calls",
	reasoningEffort: "reasoning_effort",
	promptMode: "prompt_mode",
	promptCacheKey: "prompt_cache_key",
	agentId: "agent_id"
})), Ko = Y({
	User: "user",
	Assistant: "assistant"
}), qo = S({
	audience: l(v(Ko)).optional(),
	priority: l(b()).optional()
}).catchall(g()), Jo = Oi({
	RootV1ChatCompletions: "/v1/chat/completions",
	RootV1Embeddings: "/v1/embeddings",
	RootV1FimCompletions: "/v1/fim/completions",
	RootV1Moderations: "/v1/moderations",
	RootV1ChatModerations: "/v1/chat/moderations",
	RootV1Ocr: "/v1/ocr",
	RootV1Classifications: "/v1/classifications",
	RootV1ChatClassifications: "/v1/chat/classifications",
	RootV1Conversations: "/v1/conversations",
	RootV1AudioTranscriptions: "/v1/audio/transcriptions"
}), Yo = S({
	id: t(),
	object: p("model").default("model"),
	archived: d().default(!0)
}), Xo = S({
	type: p("audio"),
	data: t(),
	mimeType: t(),
	annotations: l(qo).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), Zo = m(Qo, {
	message: "expected a Blob, File or Blob-like object",
	abort: !0
});
function Qo(e) {
	if (e instanceof Blob) return !0;
	if (typeof e != "object" || !e || !(Symbol.toStringTag in e)) return !1;
	let t = e[Symbol.toStringTag];
	return typeof t != "string" || t !== "Blob" && t !== "File" ? !1 : "stream" in e && typeof e.stream == "function";
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/file.js
var $o = S({
	fileName: t(),
	content: x([
		m((e) => e instanceof ReadableStream),
		m((e) => e instanceof Blob),
		m((e) => e instanceof ArrayBuffer),
		m((e) => e instanceof Uint8Array)
	])
}), es = _({
	Segment: "segment",
	Word: "word"
}), ts = S({
	model: t(),
	file: $o.or(Zo).optional(),
	fileUrl: l(t()).optional(),
	fileId: l(t()).optional(),
	language: l(t()).optional(),
	temperature: l(b()).optional(),
	stream: p(!1).default(!1),
	diarize: d().default(!1),
	contextBias: v(t()).optional(),
	timestampGranularities: v(es).optional()
}).transform((e) => W(e, {
	fileUrl: "file_url",
	fileId: "file_id",
	contextBias: "context_bias",
	timestampGranularities: "timestamp_granularities"
})), ns = S({
	model: t(),
	file: $o.or(Zo).optional(),
	fileUrl: l(t()).optional(),
	fileId: l(t()).optional(),
	language: l(t()).optional(),
	temperature: l(b()).optional(),
	stream: p(!0).default(!0),
	diarize: d().default(!1),
	contextBias: v(t()).optional(),
	timestampGranularities: v(es).optional()
}).transform((e) => W(e, {
	fileUrl: "file_url",
	fileId: "file_id",
	contextBias: "context_bias",
	timestampGranularities: "timestamp_granularities"
})), rs = S({
	clientId: t(),
	clientSecret: l(t()).optional()
}).transform((e) => W(e, {
	clientId: "client_id",
	clientSecret: "client_secret"
})), is = Y({
	User: "user",
	Org: "org",
	Workspace: "workspace",
	System: "system"
}), as = Y({
	Valid: "valid",
	Invalid: "invalid",
	Error: "error"
}), os = Di({
	OneHundred: 100,
	OneHundredAndOne: 101,
	OneHundredAndTwo: 102,
	OneHundredAndThree: 103,
	TwoHundred: 200,
	TwoHundredAndOne: 201,
	TwoHundredAndTwo: 202,
	TwoHundredAndThree: 203,
	TwoHundredAndFour: 204,
	TwoHundredAndFive: 205,
	TwoHundredAndSix: 206,
	TwoHundredAndSeven: 207,
	TwoHundredAndEight: 208,
	TwoHundredAndTwentySix: 226,
	ThreeHundred: 300,
	ThreeHundredAndOne: 301,
	ThreeHundredAndTwo: 302,
	ThreeHundredAndThree: 303,
	ThreeHundredAndFour: 304,
	ThreeHundredAndFive: 305,
	ThreeHundredAndSeven: 307,
	ThreeHundredAndEight: 308,
	FourHundred: 400,
	FourHundredAndOne: 401,
	FourHundredAndTwo: 402,
	FourHundredAndThree: 403,
	FourHundredAndFour: 404,
	FourHundredAndFive: 405,
	FourHundredAndSix: 406,
	FourHundredAndSeven: 407,
	FourHundredAndEight: 408,
	FourHundredAndNine: 409,
	FourHundredAndTen: 410,
	FourHundredAndEleven: 411,
	FourHundredAndTwelve: 412,
	FourHundredAndThirteen: 413,
	FourHundredAndFourteen: 414,
	FourHundredAndFifteen: 415,
	FourHundredAndSixteen: 416,
	FourHundredAndSeventeen: 417,
	FourHundredAndEighteen: 418,
	FourHundredAndTwentyOne: 421,
	FourHundredAndTwentyTwo: 422,
	FourHundredAndTwentyThree: 423,
	FourHundredAndTwentyFour: 424,
	FourHundredAndTwentyFive: 425,
	FourHundredAndTwentySix: 426,
	FourHundredAndTwentyEight: 428,
	FourHundredAndTwentyNine: 429,
	FourHundredAndThirtyOne: 431,
	FourHundredAndFiftyOne: 451,
	FiveHundred: 500,
	FiveHundredAndOne: 501,
	FiveHundredAndTwo: 502,
	FiveHundredAndThree: 503,
	FiveHundredAndFour: 504,
	FiveHundredAndFive: 505,
	FiveHundredAndSix: 506,
	FiveHundredAndSeven: 507,
	FiveHundredAndEight: 508,
	FiveHundredAndTen: 510,
	FiveHundredAndEleven: 511
}), ss = S({
	status_type: as,
	last_checked_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	error_http_code: l(os).optional(),
	error_message: l(t()).optional()
}).transform((e) => W(e, {
	status_type: "statusType",
	last_checked_at: "lastCheckedAt",
	error_http_code: "errorHttpCode",
	error_message: "errorMessage"
})), cs = {
	Oauth2: "oauth2",
	Bearer: "bearer",
	None: "none",
	GithubApp: "github_app",
	SlackApp: "slack_app"
}, ls = Y(cs), us = Oi(cs), ds = S({
	name: t(),
	authentication_type: ls,
	scope: is,
	status: l(ss).optional(),
	is_default: d().default(!1)
}).transform((e) => W(e, {
	authentication_type: "authenticationType",
	is_default: "isDefault"
})), fs = S({
	auth_url: t(),
	ttl: f()
}).transform((e) => W(e, { auth_url: "authUrl" })), ps = {
	Enum: "ENUM",
	Text: "TEXT",
	Int: "INT",
	Float: "FLOAT",
	Bool: "BOOL",
	Timestamp: "TIMESTAMP",
	Array: "ARRAY",
	Map: "MAP"
}, ms = {
	Lt: "lt",
	Lte: "lte",
	Gt: "gt",
	Gte: "gte",
	Startswith: "startswith",
	Istartswith: "istartswith",
	Endswith: "endswith",
	Iendswith: "iendswith",
	Contains: "contains",
	Icontains: "icontains",
	Matches: "matches",
	Notcontains: "notcontains",
	Inotcontains: "inotcontains",
	Eq: "eq",
	Neq: "neq",
	Isnull: "isnull",
	Includes: "includes",
	Excludes: "excludes",
	LenEq: "len_eq"
}, hs = Y(ps), gs = Y(ms), _s = S({
	name: t(),
	label: t(),
	type: hs,
	group: l(t()).optional(),
	supported_operators: v(gs)
}).transform((e) => W(e, { supported_operators: "supportedOperators" })), vs = S({
	completion_chat: d().default(!1),
	function_calling: d().default(!1),
	reasoning: d().default(!1),
	completion_fim: d().default(!1),
	fine_tuning: d().default(!1),
	vision: d().default(!1),
	ocr: d().default(!1),
	classification: d().default(!1),
	moderation: d().default(!1),
	audio: d().default(!1),
	audio_transcription: d().default(!1),
	audio_transcription_realtime: d().default(!1),
	audio_speech: d().default(!1)
}).transform((e) => W(e, {
	completion_chat: "completionChat",
	function_calling: "functionCalling",
	completion_fim: "completionFim",
	fine_tuning: "fineTuning",
	audio_transcription: "audioTranscription",
	audio_transcription_realtime: "audioTranscriptionRealtime",
	audio_speech: "audioSpeech"
})), ys = S({
	id: t(),
	object: t().default("model"),
	created: f().optional(),
	owned_by: t().default("mistralai"),
	capabilities: vs,
	name: l(t()).optional(),
	description: l(t()).optional(),
	max_context_length: f().default(32768),
	aliases: v(t()).optional(),
	deprecation: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	deprecation_replacement_model: l(t()).optional(),
	default_model_temperature: l(b()).optional(),
	type: p("base")
}).transform((e) => W(e, {
	owned_by: "ownedBy",
	max_context_length: "maxContextLength",
	deprecation_replacement_model: "deprecationReplacementModel",
	default_model_temperature: "defaultModelTemperature"
})), bs = Y({
	Running: "RUNNING",
	Completed: "COMPLETED",
	Failed: "FAILED",
	Canceled: "CANCELED",
	Terminated: "TERMINATED",
	ContinuedAsNew: "CONTINUED_AS_NEW",
	TimedOut: "TIMED_OUT",
	Unknown: "UNKNOWN"
}), xs = S({
	message: t(),
	count: f().default(1)
}), Ss = S({ executionIds: v(t()) }).transform((e) => W(e, { executionIds: "execution_ids" })), Cs = S({
	status: t(),
	error: l(t()).optional()
}), ws = S({ results: s(t(), Cs).optional() }), Ts = {
	Queued: "QUEUED",
	Running: "RUNNING",
	Success: "SUCCESS",
	Failed: "FAILED",
	TimeoutExceeded: "TIMEOUT_EXCEEDED",
	CancellationRequested: "CANCELLATION_REQUESTED",
	Cancelled: "CANCELLED"
}, Es = Y(Ts), Ds = Oi(Ts), Os = S({
	id: t(),
	object: p("batch").default("batch"),
	input_files: v(t()),
	metadata: l(s(t(), g())).optional(),
	endpoint: t(),
	model: l(t()).optional(),
	agent_id: l(t()).optional(),
	output_file: l(t()).optional(),
	error_file: l(t()).optional(),
	errors: v(xs),
	outputs: l(v(s(t(), g()))).optional(),
	status: Es,
	created_at: f(),
	total_requests: f(),
	completed_requests: f(),
	succeeded_requests: f(),
	failed_requests: f(),
	started_at: l(f()).optional(),
	completed_at: l(f()).optional()
}).transform((e) => W(e, {
	input_files: "inputFiles",
	agent_id: "agentId",
	output_file: "outputFile",
	error_file: "errorFile",
	created_at: "createdAt",
	total_requests: "totalRequests",
	completed_requests: "completedRequests",
	succeeded_requests: "succeededRequests",
	failed_requests: "failedRequests",
	started_at: "startedAt",
	completed_at: "completedAt"
})), ks = S({
	customId: l(t()).optional(),
	body: s(t(), g())
}).transform((e) => W(e, { customId: "custom_id" })), As = S({
	uri: t(),
	mimeType: l(t()).optional(),
	_meta: l(s(t(), g())).optional(),
	blob: t()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), js = {
	Lt: "lt",
	Lte: "lte",
	Gt: "gt",
	Gte: "gte",
	Startswith: "startswith",
	Istartswith: "istartswith",
	Endswith: "endswith",
	Iendswith: "iendswith",
	Contains: "contains",
	Icontains: "icontains",
	Matches: "matches",
	Notcontains: "notcontains",
	Inotcontains: "inotcontains",
	Eq: "eq",
	Neq: "neq",
	Isnull: "isnull",
	Includes: "includes",
	Excludes: "excludes",
	LenEq: "len_eq"
}, Ms = Y(js), Ns = Oi(js), Ps = S({
	field: t(),
	op: Ms,
	value: g()
}), Fs = S({
	field: t(),
	op: Ns,
	value: g()
});
X([Ps, h(() => Is)]), X([Fs, h(() => Ls)]);
var Is = S({
	AND: l(v(X([Ps, h(() => Is)]))).optional(),
	OR: l(v(X([Ps, h(() => Is)]))).optional()
}).transform((e) => W(e, {
	AND: "and",
	OR: "or"
})), Ls = S({
	and: l(v(X([Fs, h(() => Ls)]))).optional(),
	or: l(v(X([Fs, h(() => Ls)]))).optional()
}).transform((e) => W(e, {
	and: "AND",
	or: "OR"
}));
X([Ps, h(() => Is)]), X([Fs, h(() => Ls)]), X([Ps, Is]), X([Fs, Ls]);
var Rs = S({ filters: l(X([Ps, Is])) }), zs = S({ filters: l(X([Fs, Ls])) }), Bs = S({
	value: t(),
	description: t()
}), Vs = S({
	value: t(),
	description: t()
}), Hs = S({
	type: p("CLASSIFICATION"),
	options: v(Bs)
}), Us = S({
	type: p("CLASSIFICATION"),
	options: v(Vs)
}), Ws = S({
	type: p("REGRESSION"),
	min: b().default(0),
	min_description: t(),
	max: b().default(1),
	max_description: t()
}).transform((e) => W(e, {
	min_description: "minDescription",
	max_description: "maxDescription"
})), Gs = S({
	type: p("REGRESSION"),
	min: b().default(0),
	minDescription: t(),
	max: b().default(1),
	maxDescription: t()
}).transform((e) => W(e, {
	minDescription: "min_description",
	maxDescription: "max_description"
}));
Gi("type", {
	CLASSIFICATION: Hs,
	REGRESSION: Ws
});
var Ks = S({
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deleted_at: l(n({ offset: !0 }).transform((e) => new Date(e))),
	owner_id: t(),
	workspace_id: t(),
	name: t(),
	description: t(),
	model_name: t(),
	output: Gi("type", {
		CLASSIFICATION: Hs,
		REGRESSION: Ws
	}),
	instructions: t(),
	tools: v(t()),
	up_revision: l(t()).optional(),
	down_revision: l(t()).optional(),
	base_revision: l(t()).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	deleted_at: "deletedAt",
	owner_id: "ownerId",
	workspace_id: "workspaceId",
	model_name: "modelName",
	up_revision: "upRevision",
	down_revision: "downRevision",
	base_revision: "baseRevision"
})), qs = S({
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deleted_at: l(n({ offset: !0 }).transform((e) => new Date(e))),
	name: t(),
	owner_id: t(),
	workspace_id: t(),
	description: t(),
	max_nb_events: f(),
	search_params: Rs,
	judge: Ks
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	deleted_at: "deletedAt",
	owner_id: "ownerId",
	workspace_id: "workspaceId",
	max_nb_events: "maxNbEvents",
	search_params: "searchParams"
}));
x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]);
var Js = S({ messages: v(x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
])) }), Ys = X([Js, v(Js)]), Xs = S({
	model: t(),
	input: Ys
});
X([t(), v(Oo)]);
var Zs = S({
	role: l(t()).optional(),
	content: l(X([t(), v(Oo)])).optional(),
	tool_calls: l(v(Mo)).optional(),
	tool_call_id: l(t()).optional(),
	index: l(f()).optional(),
	metadata: l(s(t(), g())).optional()
}).transform((e) => W(e, {
	tool_calls: "toolCalls",
	tool_call_id: "toolCallId"
})), Qs = Y({
	Stop: "stop",
	Length: "length",
	ModelLength: "model_length",
	Error: "error",
	ToolCalls: "tool_calls"
}), $s = S({
	index: f(),
	message: Po.optional(),
	messages: v(Zs).optional(),
	finish_reason: Qs
}).transform((e) => W(e, { finish_reason: "finishReason" })), ec = S({
	audio_url: t(),
	model: t(),
	response_message: s(t(), g())
}).transform((e) => W(e, {
	audio_url: "audioUrl",
	response_message: "responseMessage"
}));
X([
	d(),
	f(),
	b(),
	t(),
	n({ offset: !0 }).transform((e) => new Date(e)),
	v(t()),
	s(t(), t())
]);
var tc = S({
	event_id: t(),
	correlation_id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	extra_fields: s(t(), l(X([
		d(),
		f(),
		b(),
		t(),
		n({ offset: !0 }).transform((e) => new Date(e)),
		v(t()),
		s(t(), t())
	]))),
	nb_input_tokens: f(),
	nb_output_tokens: f(),
	enabled_tools: v(s(t(), g())),
	request_messages: v(s(t(), g())),
	response_messages: v(s(t(), g())),
	nb_messages: f(),
	chat_transcription_events: v(ec)
}).transform((e) => W(e, {
	event_id: "eventId",
	correlation_id: "correlationId",
	created_at: "createdAt",
	extra_fields: "extraFields",
	nb_input_tokens: "nbInputTokens",
	nb_output_tokens: "nbOutputTokens",
	enabled_tools: "enabledTools",
	request_messages: "requestMessages",
	response_messages: "responseMessages",
	nb_messages: "nbMessages",
	chat_transcription_events: "chatTranscriptionEvents"
}));
X([
	d(),
	f(),
	b(),
	t(),
	n({ offset: !0 }).transform((e) => new Date(e)),
	v(t()),
	s(t(), t())
]);
var nc = S({
	event_id: t(),
	correlation_id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	extra_fields: s(t(), l(X([
		d(),
		f(),
		b(),
		t(),
		n({ offset: !0 }).transform((e) => new Date(e)),
		v(t()),
		s(t(), t())
	]))),
	nb_input_tokens: f(),
	nb_output_tokens: f()
}).transform((e) => W(e, {
	event_id: "eventId",
	correlation_id: "correlationId",
	created_at: "createdAt",
	extra_fields: "extraFields",
	nb_input_tokens: "nbInputTokens",
	nb_output_tokens: "nbOutputTokens"
}));
X([t(), v(t())]), x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]), x([
	zo,
	Ya,
	qa,
	Yi,
	Ga,
	Ea,
	wa
]), X([Vo, ga]);
var rc = S({
	model: t(),
	temperature: l(b()).optional(),
	topP: l(b()).optional(),
	maxTokens: l(f()).optional(),
	stream: d().default(!1),
	stop: l(X([t(), v(t())])).optional(),
	randomSeed: l(f()).optional(),
	metadata: l(s(t(), g())).optional(),
	messages: v(x([
		Fo.and(S({ role: p("assistant") })),
		Ro,
		Ho,
		Uo
	])),
	responseFormat: pa.optional(),
	tools: l(v(x([
		zo,
		Ya,
		qa,
		Yi,
		Ga,
		Ea,
		wa
	]))).optional(),
	toolChoice: X([Vo, ga]).optional(),
	presencePenalty: l(b()).optional(),
	frequencyPenalty: l(b()).optional(),
	n: l(f()).optional(),
	prediction: ra.optional(),
	parallelToolCalls: d().optional(),
	reasoningEffort: l(oa).optional(),
	promptMode: l(Io).optional(),
	guardrails: l(v(Ua)).optional(),
	promptCacheKey: l(t()).optional(),
	safePrompt: d().optional()
}).transform((e) => W(e, {
	topP: "top_p",
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	responseFormat: "response_format",
	toolChoice: "tool_choice",
	presencePenalty: "presence_penalty",
	frequencyPenalty: "frequency_penalty",
	parallelToolCalls: "parallel_tool_calls",
	reasoningEffort: "reasoning_effort",
	promptMode: "prompt_mode",
	promptCacheKey: "prompt_cache_key",
	safePrompt: "safe_prompt"
})), ic = S({
	prompt_tokens: f().default(0),
	completion_tokens: f().default(0),
	total_tokens: f().default(0),
	prompt_audio_seconds: l(f()).optional()
}).catchall(g()).transform((e) => W(e, {
	prompt_tokens: "promptTokens",
	completion_tokens: "completionTokens",
	total_tokens: "totalTokens",
	prompt_audio_seconds: "promptAudioSeconds"
})), ac = S({
	promptTokens: f().default(0),
	completionTokens: f().default(0),
	totalTokens: f().default(0),
	promptAudioSeconds: l(f()).optional()
}).catchall(g()).transform((e) => ({ ...W(e, {
	promptTokens: "prompt_tokens",
	completionTokens: "completion_tokens",
	totalTokens: "total_tokens",
	promptAudioSeconds: "prompt_audio_seconds"
}) })), oc = S({
	id: t(),
	object: t(),
	model: t(),
	usage: ic,
	created: f(),
	choices: v($s)
});
X([t(), v(t())]), x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]), x([
	zo,
	Ya,
	qa,
	Yi,
	Ga,
	Ea,
	wa
]), X([Vo, ga]);
var sc = S({
	model: t(),
	temperature: l(b()).optional(),
	topP: l(b()).optional(),
	maxTokens: l(f()).optional(),
	stream: d().default(!0),
	stop: l(X([t(), v(t())])).optional(),
	randomSeed: l(f()).optional(),
	metadata: l(s(t(), g())).optional(),
	messages: v(x([
		Fo.and(S({ role: p("assistant") })),
		Ro,
		Ho,
		Uo
	])),
	responseFormat: pa.optional(),
	tools: l(v(x([
		zo,
		Ya,
		qa,
		Yi,
		Ga,
		Ea,
		wa
	]))).optional(),
	toolChoice: X([Vo, ga]).optional(),
	presencePenalty: l(b()).optional(),
	frequencyPenalty: l(b()).optional(),
	n: l(f()).optional(),
	prediction: ra.optional(),
	parallelToolCalls: d().optional(),
	reasoningEffort: l(oa).optional(),
	promptMode: l(Io).optional(),
	guardrails: l(v(Ua)).optional(),
	promptCacheKey: l(t()).optional(),
	safePrompt: d().optional()
}).transform((e) => W(e, {
	topP: "top_p",
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	responseFormat: "response_format",
	toolChoice: "tool_choice",
	presencePenalty: "presence_penalty",
	frequencyPenalty: "frequency_penalty",
	parallelToolCalls: "parallel_tool_calls",
	reasoningEffort: "reasoning_effort",
	promptMode: "prompt_mode",
	promptCacheKey: "prompt_cache_key",
	safePrompt: "safe_prompt"
}));
x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]), x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
]), X([v(x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
])), v(v(x([
	Fo.and(S({ role: p("assistant") })),
	Ro,
	Ho,
	Uo
])))]);
var cc = S({
	inputs: X([v(x([
		Fo.and(S({ role: p("assistant") })),
		Ro,
		Ho,
		Uo
	])), v(v(x([
		Fo.and(S({ role: p("assistant") })),
		Ro,
		Ho,
		Uo
	])))]),
	model: t()
}).transform((e) => W(e, { inputs: "input" })), lc = S({
	train_loss: l(b()).optional(),
	valid_loss: l(b()).optional(),
	valid_mean_token_accuracy: l(b()).optional()
}).transform((e) => W(e, {
	train_loss: "trainLoss",
	valid_loss: "validLoss",
	valid_mean_token_accuracy: "validMeanTokenAccuracy"
})), uc = S({
	metrics: lc,
	step_number: f(),
	created_at: f()
}).transform((e) => W(e, {
	step_number: "stepNumber",
	created_at: "createdAt"
}));
X([t(), v(t())]);
var dc = S({
	model: t(),
	metadata: l(s(t(), g())).optional(),
	inputs: X([t(), v(t())])
}).transform((e) => W(e, { inputs: "input" })), fc = S({ scores: s(t(), b()) }), pc = S({
	id: t(),
	model: t(),
	results: v(s(t(), fc))
}), mc = {
	SingleClass: "single_class",
	MultiClass: "multi_class"
}, hc = Y(mc), gc = Oi(mc), _c = S({
	name: t(),
	labels: v(t()),
	weight: b(),
	loss_function: hc
}).transform((e) => W(e, { loss_function: "lossFunction" })), vc = S({
	completion_chat: d().default(!0),
	completion_fim: d().default(!1),
	function_calling: d().default(!1),
	fine_tuning: d().default(!1),
	classification: d().default(!1)
}).transform((e) => W(e, {
	completion_chat: "completionChat",
	completion_fim: "completionFim",
	function_calling: "functionCalling",
	fine_tuning: "fineTuning"
})), yc = S({
	id: t(),
	object: p("model").default("model"),
	created: f(),
	owned_by: t(),
	workspace_id: t(),
	root: t(),
	root_version: t(),
	archived: d(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	capabilities: vc,
	max_context_length: f().default(32768),
	aliases: v(t()).optional(),
	job: l(t()).optional(),
	classifier_targets: v(_c),
	model_type: p("classifier")
}).transform((e) => W(e, {
	owned_by: "ownedBy",
	workspace_id: "workspaceId",
	root_version: "rootVersion",
	max_context_length: "maxContextLength",
	classifier_targets: "classifierTargets",
	model_type: "modelType"
})), bc = S({
	training_steps: l(f()).optional(),
	learning_rate: b().default(1e-4),
	weight_decay: l(b()).optional(),
	warmup_fraction: l(b()).optional(),
	epochs: l(b()).optional(),
	seq_len: l(f()).optional()
}).transform((e) => W(e, {
	training_steps: "trainingSteps",
	learning_rate: "learningRate",
	weight_decay: "weightDecay",
	warmup_fraction: "warmupFraction",
	seq_len: "seqLen"
})), xc = S({
	trainingSteps: l(f()).optional(),
	learningRate: b().default(1e-4),
	weightDecay: l(b()).optional(),
	warmupFraction: l(b()).optional(),
	epochs: l(b()).optional(),
	seqLen: l(f()).optional()
}).transform((e) => W(e, {
	trainingSteps: "training_steps",
	learningRate: "learning_rate",
	weightDecay: "weight_decay",
	warmupFraction: "warmup_fraction",
	seqLen: "seq_len"
})), Sc = S({
	expected_duration_seconds: l(f()).optional(),
	cost: l(b()).optional(),
	cost_currency: l(t()).optional(),
	train_tokens_per_step: l(f()).optional(),
	train_tokens: l(f()).optional(),
	data_tokens: l(f()).optional(),
	estimated_start_time: l(f()).optional()
}).transform((e) => W(e, {
	expected_duration_seconds: "expectedDurationSeconds",
	cost_currency: "costCurrency",
	train_tokens_per_step: "trainTokensPerStep",
	train_tokens: "trainTokens",
	data_tokens: "dataTokens",
	estimated_start_time: "estimatedStartTime"
})), Cc = S({
	type: p("wandb"),
	project: t(),
	name: l(t()).optional(),
	run_name: l(t()).optional(),
	url: l(t()).optional()
}).transform((e) => W(e, { run_name: "runName" })), wc = Y({
	Queued: "QUEUED",
	Started: "STARTED",
	Validating: "VALIDATING",
	Validated: "VALIDATED",
	Running: "RUNNING",
	FailedValidation: "FAILED_VALIDATION",
	Failed: "FAILED",
	Success: "SUCCESS",
	Cancelled: "CANCELLED",
	CancellationRequested: "CANCELLATION_REQUESTED"
}), Tc = S({
	id: t(),
	auto_start: d(),
	model: t(),
	status: wc,
	created_at: f(),
	modified_at: f(),
	training_files: v(t()),
	validation_files: l(v(t())).optional(),
	object: p("job").default("job"),
	fine_tuned_model: l(t()).optional(),
	suffix: l(t()).optional(),
	integrations: l(v(Cc)).optional(),
	trained_tokens: l(f()).optional(),
	metadata: l(Sc).optional(),
	job_type: p("classifier"),
	hyperparameters: bc
}).transform((e) => W(e, {
	auto_start: "autoStart",
	created_at: "createdAt",
	modified_at: "modifiedAt",
	training_files: "trainingFiles",
	validation_files: "validationFiles",
	fine_tuned_model: "fineTunedModel",
	trained_tokens: "trainedTokens",
	job_type: "jobType"
})), Ec = S({
	name: t(),
	data: l(s(t(), g())).optional(),
	created_at: f()
}).transform((e) => W(e, { created_at: "createdAt" })), Dc = Y({
	Queued: "QUEUED",
	Started: "STARTED",
	Validating: "VALIDATING",
	Validated: "VALIDATED",
	Running: "RUNNING",
	FailedValidation: "FAILED_VALIDATION",
	Failed: "FAILED",
	Success: "SUCCESS",
	Cancelled: "CANCELLED",
	CancellationRequested: "CANCELLATION_REQUESTED"
}), Oc = S({
	id: t(),
	auto_start: d(),
	model: t(),
	status: Dc,
	created_at: f(),
	modified_at: f(),
	training_files: v(t()),
	validation_files: l(v(t())).optional(),
	object: p("job").default("job"),
	fine_tuned_model: l(t()).optional(),
	suffix: l(t()).optional(),
	integrations: l(v(Cc)).optional(),
	trained_tokens: l(f()).optional(),
	metadata: l(Sc).optional(),
	job_type: p("classifier"),
	hyperparameters: bc,
	events: v(Ec).optional(),
	checkpoints: v(uc).optional(),
	classifier_targets: v(_c)
}).transform((e) => W(e, {
	auto_start: "autoStart",
	created_at: "createdAt",
	modified_at: "modifiedAt",
	training_files: "trainingFiles",
	validation_files: "validationFiles",
	fine_tuned_model: "fineTunedModel",
	trained_tokens: "trainedTokens",
	job_type: "jobType",
	classifier_targets: "classifierTargets"
})), kc = S({
	name: t(),
	labels: v(t()),
	weight: b().default(1),
	lossFunction: l(gc).optional()
}).transform((e) => W(e, { lossFunction: "loss_function" })), Ac = S({ create: l(s(t(), g())).optional() }).catchall(g()), jc = S({ createMessage: l(s(t(), g())).optional() }).catchall(g()), Mc = S({
	sampling: l(jc).optional(),
	elicitation: l(Ac).optional()
}).catchall(g()), Nc = S({
	list: l(s(t(), g())).optional(),
	cancel: l(s(t(), g())).optional(),
	requests: l(Mc).optional()
}).catchall(g()), Pc = S({
	form: l(s(t(), g())).optional(),
	url: l(s(t(), g())).optional()
}).catchall(g()), Fc = S({ listChanged: l(d()).optional() }).catchall(g()), Ic = S({
	context: l(s(t(), g())).optional(),
	tools: l(s(t(), g())).optional()
}).catchall(g()), Lc = S({
	experimental: l(s(t(), s(t(), g()))).optional(),
	sampling: l(Ic).optional(),
	elicitation: l(Pc).optional(),
	roots: l(Fc).optional(),
	tasks: l(Nc).optional()
}).catchall(g()), Rc = Y({
	Stop: "stop",
	Length: "length",
	Error: "error",
	ToolCalls: "tool_calls"
}), zc = S({
	index: f(),
	delta: Zs,
	finish_reason: l(Rc)
}).transform((e) => W(e, { finish_reason: "finishReason" })), Bc = S({
	id: t(),
	object: t().optional(),
	created: f().optional(),
	model: t(),
	usage: ic.optional(),
	choices: v(zc)
});
function Vc(e) {
	return K(e, (e) => Bc.parse(JSON.parse(e)), "Failed to parse 'CompletionChunk' from JSON");
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/completionevent.js
var Hc = S({ data: t().transform((e, t) => {
	try {
		return JSON.parse(e);
	} catch (n) {
		return t.addIssue({
			input: e,
			code: "custom",
			message: `malformed json: ${n}`
		}), o;
	}
}).pipe(Bc) }), Uc = S({
	id: t(),
	object: p("model").default("model"),
	created: f(),
	owned_by: t(),
	workspace_id: t(),
	root: t(),
	root_version: t(),
	archived: d(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	capabilities: vc,
	max_context_length: f().default(32768),
	aliases: v(t()).optional(),
	job: l(t()).optional(),
	model_type: p("completion")
}).transform((e) => W(e, {
	owned_by: "ownedBy",
	workspace_id: "workspaceId",
	root_version: "rootVersion",
	max_context_length: "maxContextLength",
	model_type: "modelType"
})), Wc = S({
	training_steps: l(f()).optional(),
	learning_rate: b().default(1e-4),
	weight_decay: l(b()).optional(),
	warmup_fraction: l(b()).optional(),
	epochs: l(b()).optional(),
	seq_len: l(f()).optional(),
	fim_ratio: l(b()).optional()
}).transform((e) => W(e, {
	training_steps: "trainingSteps",
	learning_rate: "learningRate",
	weight_decay: "weightDecay",
	warmup_fraction: "warmupFraction",
	seq_len: "seqLen",
	fim_ratio: "fimRatio"
})), Gc = S({
	trainingSteps: l(f()).optional(),
	learningRate: b().default(1e-4),
	weightDecay: l(b()).optional(),
	warmupFraction: l(b()).optional(),
	epochs: l(b()).optional(),
	seqLen: l(f()).optional(),
	fimRatio: l(b()).optional()
}).transform((e) => W(e, {
	trainingSteps: "training_steps",
	learningRate: "learning_rate",
	weightDecay: "weight_decay",
	warmupFraction: "warmup_fraction",
	seqLen: "seq_len",
	fimRatio: "fim_ratio"
})), Kc = S({
	type: p("github"),
	name: t(),
	owner: t(),
	ref: l(t()).optional(),
	weight: b().default(1),
	commit_id: t()
}).transform((e) => W(e, { commit_id: "commitId" })), qc = Y({
	Queued: "QUEUED",
	Started: "STARTED",
	Validating: "VALIDATING",
	Validated: "VALIDATED",
	Running: "RUNNING",
	FailedValidation: "FAILED_VALIDATION",
	Failed: "FAILED",
	Success: "SUCCESS",
	Cancelled: "CANCELLED",
	CancellationRequested: "CANCELLATION_REQUESTED"
}), Jc = S({
	id: t(),
	auto_start: d(),
	model: t(),
	status: qc,
	created_at: f(),
	modified_at: f(),
	training_files: v(t()),
	validation_files: l(v(t())).optional(),
	object: p("job").default("job"),
	fine_tuned_model: l(t()).optional(),
	suffix: l(t()).optional(),
	integrations: l(v(Cc)).optional(),
	trained_tokens: l(f()).optional(),
	metadata: l(Sc).optional(),
	job_type: p("completion"),
	hyperparameters: Wc,
	repositories: v(Kc).optional()
}).transform((e) => W(e, {
	auto_start: "autoStart",
	created_at: "createdAt",
	modified_at: "modifiedAt",
	training_files: "trainingFiles",
	validation_files: "validationFiles",
	fine_tuned_model: "fineTunedModel",
	trained_tokens: "trainedTokens",
	job_type: "jobType"
})), Yc = Y({
	Queued: "QUEUED",
	Started: "STARTED",
	Validating: "VALIDATING",
	Validated: "VALIDATED",
	Running: "RUNNING",
	FailedValidation: "FAILED_VALIDATION",
	Failed: "FAILED",
	Success: "SUCCESS",
	Cancelled: "CANCELLED",
	CancellationRequested: "CANCELLATION_REQUESTED"
}), Xc = S({
	id: t(),
	auto_start: d(),
	model: t(),
	status: Yc,
	created_at: f(),
	modified_at: f(),
	training_files: v(t()),
	validation_files: l(v(t())).optional(),
	object: p("job").default("job"),
	fine_tuned_model: l(t()).optional(),
	suffix: l(t()).optional(),
	integrations: l(v(Cc)).optional(),
	trained_tokens: l(f()).optional(),
	metadata: l(Sc).optional(),
	job_type: p("completion"),
	hyperparameters: Wc,
	repositories: v(Kc).optional(),
	events: v(Ec).optional(),
	checkpoints: v(uc).optional()
}).transform((e) => W(e, {
	auto_start: "autoStart",
	created_at: "createdAt",
	modified_at: "modifiedAt",
	training_files: "trainingFiles",
	validation_files: "validationFiles",
	fine_tuned_model: "fineTunedModel",
	trained_tokens: "trainedTokens",
	job_type: "jobType"
})), Zc = S({ reasoning_tokens: f().default(0) }).transform((e) => W(e, { reasoning_tokens: "reasoningTokens" })), Qc = Y({
	Mcp: "mcp",
	Turbine: "turbine",
	Eolienne: "eolienne"
}), $c = S({
	accessToken: t(),
	tokenType: p("Bearer").default("Bearer"),
	expiresIn: l(f()).optional(),
	scope: l(t()).optional(),
	refreshToken: l(t()).optional(),
	expiresAt: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, {
	accessToken: "access_token",
	tokenType: "token_type",
	expiresIn: "expires_in",
	refreshToken: "refresh_token",
	expiresAt: "expires_at"
})), el = S({
	oauth: l($c).optional(),
	headers: l(s(t(), t())).optional(),
	bearerToken: l(t()).optional(),
	githubInstallationId: l(t()).optional()
}).transform((e) => W(e, {
	bearerToken: "bearer_token",
	githubInstallationId: "github_installation_id"
})), tl = S({ read_only: l(d()) }).transform((e) => W(e, { read_only: "readOnly" })), nl = S({ readOnly: l(d()) }).transform((e) => W(e, { readOnly: "read_only" })), rl = {
	And: "and",
	Or: "or"
}, il = Y(rl), al = Oi(rl), ol = S({
	type: il,
	expressions: v(X([
		h(() => ol),
		tl,
		v(t())
	]))
}), sl = S({
	type: al,
	expressions: v(X([
		h(() => sl),
		nl,
		v(t())
	]))
});
X([
	h(() => ol),
	tl,
	v(t())
]), X([
	h(() => sl),
	nl,
	v(t())
]), X([
	ol,
	tl,
	v(t())
]), X([
	sl,
	nl,
	v(t())
]), X([
	ol,
	tl,
	v(t())
]), X([
	sl,
	nl,
	v(t())
]);
var cl = S({
	requires_confirmation: l(X([
		ol,
		tl,
		v(t())
	])).optional(),
	skip_confirmation: l(X([
		ol,
		tl,
		v(t())
	])).optional(),
	include: l(v(t())).optional(),
	exclude: l(v(t())).optional()
}).transform((e) => W(e, {
	requires_confirmation: "requiresConfirmation",
	skip_confirmation: "skipConfirmation"
})), ll = S({
	requiresConfirmation: l(X([
		sl,
		nl,
		v(t())
	])).optional(),
	skipConfirmation: l(X([
		sl,
		nl,
		v(t())
	])).optional(),
	include: l(v(t())).optional(),
	exclude: l(v(t())).optional()
}).transform((e) => W(e, {
	requiresConfirmation: "requires_confirmation",
	skipConfirmation: "skip_confirmation"
})), ul = S({
	name: t(),
	tool_configuration: cl,
	is_default: l(d()).optional(),
	consumer_type: l(is).optional()
}).transform((e) => W(e, {
	tool_configuration: "toolConfiguration",
	is_default: "isDefault",
	consumer_type: "consumerType"
})), dl = S({
	name: s(t(), t()),
	description: s(t(), t()),
	usage_sentence: s(t(), t())
}).transform((e) => W(e, { usage_sentence: "usageSentence" })), fl = Y({
	Mcp: "mcp",
	Http: "http",
	Turbine: "turbine"
}), pl = S({
	name: s(t(), t()),
	description: s(t(), t()),
	usage_sentence: s(t(), t())
}).transform((e) => W(e, { usage_sentence: "usageSentence" })), ml = S({ type: t() }).catchall(g()), hl = {
	SharedGlobal: "shared_global",
	SharedOrg: "shared_org",
	SharedWorkspace: "shared_workspace",
	Private: "private"
}, gl = Y(hl), _l = Oi(hl), vl = S({
	id: t(),
	name: t(),
	description: t(),
	system_prompt: l(t()).optional(),
	locale: l(pl).optional(),
	jsonschema: l(s(t(), g())).optional(),
	execution_config: l(ml),
	visibility: gl,
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	modified_at: n({ offset: !0 }).transform((e) => new Date(e)),
	active: l(d()).optional()
}).transform((e) => W(e, {
	system_prompt: "systemPrompt",
	execution_config: "executionConfig",
	created_at: "createdAt",
	modified_at: "modifiedAt"
})), yl = S({
	src: t(),
	mimeType: l(t()).optional(),
	sizes: l(v(t())).optional()
}).catchall(g()), bl = S({
	name: t(),
	description: l(t()).optional(),
	required: l(d()).optional()
}).catchall(g()), xl = S({
	name: t(),
	title: l(t()).optional(),
	description: l(t()).optional(),
	arguments: l(v(bl)).optional(),
	icons: l(v(yl)).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), Sl = S({
	name: t(),
	title: l(t()).optional(),
	uri: t(),
	description: l(t()).optional(),
	mimeType: l(t()).optional(),
	size: l(f()).optional(),
	icons: l(v(yl)).optional(),
	annotations: l(qo).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), Cl = S({
	name: l(s(t(), t())).optional(),
	description: l(s(t(), t())).optional(),
	usage_sentence: l(s(t(), t())).optional(),
	working_description: l(s(t(), t())).optional(),
	done_description: l(s(t(), t())).optional()
}).transform((e) => W(e, {
	usage_sentence: "usageSentence",
	working_description: "workingDescription",
	done_description: "doneDescription"
})), wl = S({
	system_prompt_name: l(t()).optional(),
	locale: l(Cl).optional()
}).transform((e) => W(e, { system_prompt_name: "systemPromptName" })), Tl = S({ "ai.mistral/turbine": l(wl).optional() }).catchall(g()).transform((e) => W(e, { "ai.mistral/turbine": "aiMistralTurbine" })), El = Y({
	Model: "model",
	App: "app"
}), Dl = S({
	resourceUri: l(t()).optional(),
	visibility: l(v(El)).optional()
}).catchall(g()), Ol = Y({
	Rag: "rag",
	Image: "image",
	Code: "code",
	Event: "event"
}), kl = S({
	name: l(s(t(), t())).optional(),
	description: l(s(t(), t())).optional(),
	usage_sentence: l(s(t(), t())).optional(),
	working_description: l(s(t(), t())).optional(),
	done_description: l(s(t(), t())).optional()
}).transform((e) => W(e, {
	usage_sentence: "usageSentence",
	working_description: "workingDescription",
	done_description: "doneDescription"
})), Al = S({
	locale: l(kl).optional(),
	tool_type: l(Ol).optional(),
	timeout: l(b()).optional(),
	private_execution: l(d()).optional()
}).transform((e) => W(e, {
	tool_type: "toolType",
	private_execution: "privateExecution"
})), jl = S({
	ui: l(Dl).optional(),
	"ai.mistral/turbine": l(Al).optional()
}).catchall(g()).transform((e) => W(e, { "ai.mistral/turbine": "aiMistralTurbine" })), Ml = S({
	title: l(t()).optional(),
	readOnlyHint: l(d()).optional(),
	destructiveHint: l(d()).optional(),
	idempotentHint: l(d()).optional(),
	openWorldHint: l(d()).optional()
}).catchall(g()), Nl = Y({
	Forbidden: "forbidden",
	Optional: "optional",
	Required: "required"
}), Pl = S({ taskSupport: l(Nl).optional() }).catchall(g()), Fl = S({
	name: t(),
	title: l(t()).optional(),
	description: l(t()).optional(),
	inputSchema: s(t(), g()),
	outputSchema: l(s(t(), g())).optional(),
	icons: l(v(yl)).optional(),
	annotations: l(Ml).optional(),
	_meta: l(jl).optional(),
	execution: l(Pl).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), Il = S({
	required: d(),
	schemes: v(t()).optional()
}), Ll = S({
	name: t(),
	description: t(),
	isRequired: l(d()).optional(),
	isSecret: l(d()).optional(),
	default: l(t()).optional(),
	choices: l(v(t())).optional()
}), Rl = Y({
	StreamableHttp: "streamable-http",
	Sse: "sse"
}), zl = S({
	type: Rl,
	url: t(),
	supportedProtocolVersions: l(v(t())).optional(),
	headers: l(v(Ll)).optional(),
	authentication: l(Il).optional()
}), Bl = S({
	url: t(),
	source: t(),
	subfolder: l(t()).optional()
}), Vl = S({ listChanged: l(d()).optional() }).catchall(g()), Hl = S({
	subscribe: l(d()).optional(),
	listChanged: l(d()).optional()
}).catchall(g()), Ul = S({ call: l(s(t(), g())).optional() }).catchall(g()), Wl = S({ tools: l(Ul).optional() }).catchall(g()), Gl = S({
	list: l(s(t(), g())).optional(),
	cancel: l(s(t(), g())).optional(),
	requests: l(Wl).optional()
}).catchall(g()), Kl = S({ listChanged: l(d()).optional() }).catchall(g()), ql = S({
	experimental: l(s(t(), s(t(), g()))).optional(),
	logging: l(s(t(), g())).optional(),
	prompts: l(Vl).optional(),
	resources: l(Hl).optional(),
	tools: l(Kl).optional(),
	completions: l(s(t(), g())).optional(),
	tasks: l(Gl).optional()
}).catchall(g());
X([t(), v(Sl)]), X([t(), v(Fl)]), X([t(), v(xl)]);
var Jl = S({
	$schema: l(t()).optional(),
	name: t(),
	version: t(),
	capabilities: ql.optional(),
	title: l(t()).optional(),
	description: l(t()).optional(),
	websiteUrl: l(t()).optional(),
	repository: l(Bl).optional(),
	icons: l(v(yl)).optional(),
	remotes: l(v(zl)).optional(),
	requires: l(Lc).optional(),
	resources: l(X([t(), v(Sl)])).optional(),
	tools: l(X([t(), v(Fl)])).optional(),
	prompts: l(X([t(), v(xl)])).optional(),
	_meta: l(Tl).optional()
}).catchall(g()).transform((e) => W(e, {
	$schema: "dollarSchema",
	_meta: "meta"
})), Yl = S({
	name: t(),
	is_required: d().default(!0),
	is_secret: d().default(!0)
}).transform((e) => W(e, {
	is_required: "isRequired",
	is_secret: "isSecret"
})), Xl = S({
	method_type: ls,
	headers: l(v(Yl)).optional(),
	has_default_credentials: d()
}).transform((e) => W(e, {
	method_type: "methodType",
	has_default_credentials: "hasDefaultCredentials"
})), Zl = S({
	type: Qc.optional(),
	base_url: l(t()).optional(),
	headers: l(s(t(), t())).optional(),
	signed: l(d()).optional()
}).transform((e) => W(e, { base_url: "baseUrl" })), Ql = Di({
	One: 1,
	Two: 2,
	Three: 3,
	Four: 4
}), $l = S({
	id: t(),
	name: t(),
	title: l(t()).optional(),
	description: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	modified_at: n({ offset: !0 }).transform((e) => new Date(e)),
	server: l(t()).optional(),
	protocol: fl.optional(),
	icon_url: l(t()).optional(),
	server_card: l(Jl).optional(),
	owner_id: l(t()).optional(),
	owner_type: Ql,
	visibility: gl,
	locale: l(dl).optional(),
	system_prompt: l(t()).optional(),
	supported_auth_methods: l(v(Xl)).optional(),
	connection_preferences: l(v(ul)).optional(),
	connection_credentials: l(v(ds)).optional(),
	active: l(d()).optional(),
	private_tool_execution: d(),
	mistral: d().default(!1),
	is_authenticated: l(d()).optional(),
	tools: l(v(vl)).optional(),
	system_prompt_route: l(t()).optional(),
	connection_config: l(Zl).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	modified_at: "modifiedAt",
	icon_url: "iconUrl",
	server_card: "serverCard",
	owner_id: "ownerId",
	owner_type: "ownerType",
	system_prompt: "systemPrompt",
	supported_auth_methods: "supportedAuthMethods",
	connection_preferences: "connectionPreferences",
	connection_credentials: "connectionCredentials",
	private_tool_execution: "privateToolExecution",
	is_authenticated: "isAuthenticated",
	system_prompt_route: "systemPromptRoute",
	connection_config: "connectionConfig"
})), eu = S({ arguments: s(t(), g()).optional() }), tu = S({ active: l(d()).optional() }), nu = S({
	isError: d().default(!1),
	structuredContent: l(s(t(), g())).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), ru = S({ mcp_meta: l(nu).optional() }).catchall(g()).transform((e) => W(e, { mcp_meta: "mcpMeta" })), iu = S({
	uri: t(),
	mimeType: l(t()).optional(),
	_meta: l(s(t(), g())).optional(),
	text: t()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" }));
X([iu, As]);
var au = S({
	type: p("resource"),
	resource: X([iu, As]),
	annotations: l(qo).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), ou = S({
	type: p("image"),
	data: t(),
	mimeType: t(),
	annotations: l(qo).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), su = S({
	name: t(),
	title: l(t()).optional(),
	uri: t(),
	description: l(t()).optional(),
	mimeType: l(t()).optional(),
	size: l(f()).optional(),
	icons: l(v(yl)).optional(),
	annotations: l(qo).optional(),
	_meta: l(s(t(), g())).optional(),
	type: p("resource_link")
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), cu = S({
	type: p("text"),
	text: t(),
	annotations: l(qo).optional(),
	_meta: l(s(t(), g())).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" }));
Gi("type", {
	text: cu,
	image: ou,
	audio: Xo,
	resource_link: su,
	resource: au
});
var lu = S({
	content: v(Gi("type", {
		text: cu,
		image: ou,
		audio: Xo,
		resource_link: su,
		resource: au
	})),
	metadata: l(ru).optional()
}).catchall(g()), uu = X([s(t(), g()), t()]), du = X([s(t(), g()), t()]), fu = {
	Pending: "pending",
	Allowed: "allowed",
	Denied: "denied"
}, pu = Y(fu), mu = Oi(fu), hu = S({
	object: p("entry").default("entry"),
	type: p("function.call").default("function.call"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	completed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	agent_id: l(t()).optional(),
	model: l(t()).optional(),
	id: t().optional(),
	tool_call_id: t(),
	name: t(),
	arguments: uu,
	confirmation_status: l(pu).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	completed_at: "completedAt",
	agent_id: "agentId",
	tool_call_id: "toolCallId",
	confirmation_status: "confirmationStatus"
})), gu = S({
	object: p("entry").default("entry"),
	type: p("function.call").default("function.call"),
	createdAt: y().transform((e) => e.toISOString()).optional(),
	completedAt: l(y().transform((e) => e.toISOString())).optional(),
	agentId: l(t()).optional(),
	model: l(t()).optional(),
	id: t().optional(),
	toolCallId: t(),
	name: t(),
	arguments: du,
	confirmationStatus: l(mu).optional()
}).transform((e) => W(e, {
	createdAt: "created_at",
	completedAt: "completed_at",
	agentId: "agent_id",
	toolCallId: "tool_call_id",
	confirmationStatus: "confirmation_status"
})), _u = S({
	object: p("entry").default("entry"),
	type: p("function.result").default("function.result"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	completed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	id: t().optional(),
	tool_call_id: t(),
	result: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	completed_at: "completedAt",
	tool_call_id: "toolCallId"
})), vu = S({
	object: p("entry").default("entry"),
	type: p("function.result").default("function.result"),
	createdAt: y().transform((e) => e.toISOString()).optional(),
	completedAt: l(y().transform((e) => e.toISOString())).optional(),
	id: t().optional(),
	toolCallId: t(),
	result: t()
}).transform((e) => W(e, {
	createdAt: "created_at",
	completedAt: "completed_at",
	toolCallId: "tool_call_id"
}));
X([So, t()]), X([Co, t()]);
var yu = S({
	type: p("tool_file").default("tool_file"),
	tool: X([So, t()]),
	file_id: t(),
	file_name: l(t()).optional(),
	file_type: l(t()).optional()
}).transform((e) => W(e, {
	file_id: "fileId",
	file_name: "fileName",
	file_type: "fileType"
})), bu = S({
	type: p("tool_file").default("tool_file"),
	tool: X([Co, t()]),
	fileId: t(),
	fileName: l(t()).optional(),
	fileType: l(t()).optional()
}).transform((e) => W(e, {
	fileId: "file_id",
	fileName: "file_name",
	fileType: "file_type"
})), xu = X([
	yu,
	yo,
	ho,
	ao,
	Eo
]), Su = X([
	bu,
	bo,
	go,
	oo,
	Do
]), Cu = {
	Assistant: "assistant",
	User: "user"
}, wu = Y(Cu), Tu = Oi(Cu);
X([t(), v(xu)]), X([t(), v(Su)]);
var Eu = S({
	object: p("entry").default("entry"),
	type: p("message.input").default("message.input"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	completed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	id: t().optional(),
	role: wu,
	content: X([t(), v(xu)]),
	prefix: d().default(!1)
}).transform((e) => W(e, {
	created_at: "createdAt",
	completed_at: "completedAt"
})), Du = S({
	object: p("entry").default("entry"),
	type: p("message.input").default("message.input"),
	createdAt: y().transform((e) => e.toISOString()).optional(),
	completedAt: l(y().transform((e) => e.toISOString())).optional(),
	id: t().optional(),
	role: Tu,
	content: X([t(), v(Su)]),
	prefix: d().default(!1)
}).transform((e) => W(e, {
	createdAt: "created_at",
	completedAt: "completed_at"
})), Ou = X([
	yu,
	wo,
	yo,
	ho,
	ao,
	Eo
]), ku = X([
	bu,
	To,
	bo,
	go,
	oo,
	Do
]);
X([t(), v(Ou)]), X([t(), v(ku)]);
var Au = S({
	object: p("entry").default("entry"),
	type: p("message.output").default("message.output"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	completed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	agent_id: l(t()).optional(),
	model: l(t()).optional(),
	id: t().optional(),
	role: p("assistant").default("assistant"),
	content: X([t(), v(Ou)])
}).transform((e) => W(e, {
	created_at: "createdAt",
	completed_at: "completedAt",
	agent_id: "agentId"
})), ju = S({
	object: p("entry").default("entry"),
	type: p("message.output").default("message.output"),
	createdAt: y().transform((e) => e.toISOString()).optional(),
	completedAt: l(y().transform((e) => e.toISOString())).optional(),
	agentId: l(t()).optional(),
	model: l(t()).optional(),
	id: t().optional(),
	role: p("assistant").default("assistant"),
	content: X([t(), v(ku)])
}).transform((e) => W(e, {
	createdAt: "created_at",
	completedAt: "completed_at",
	agentId: "agent_id"
}));
X([So, t()]), X([Co, t()]);
var Mu = S({
	object: p("entry").default("entry"),
	type: p("tool.execution").default("tool.execution"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	completed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	agent_id: l(t()).optional(),
	model: l(t()).optional(),
	id: t().optional(),
	name: X([So, t()]),
	arguments: t(),
	info: s(t(), g()).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	completed_at: "completedAt",
	agent_id: "agentId"
})), Nu = X([
	to,
	gu,
	Du,
	vu,
	S({
		object: p("entry").default("entry"),
		type: p("tool.execution").default("tool.execution"),
		createdAt: y().transform((e) => e.toISOString()).optional(),
		completedAt: l(y().transform((e) => e.toISOString())).optional(),
		agentId: l(t()).optional(),
		model: l(t()).optional(),
		id: t().optional(),
		name: X([Co, t()]),
		arguments: t(),
		info: s(t(), g()).optional()
	}).transform((e) => W(e, {
		createdAt: "created_at",
		completedAt: "completed_at",
		agentId: "agent_id"
	})),
	ju
]), Pu = X([t(), v(Nu)]), Fu = _({
	Allow: "allow",
	Deny: "deny"
}), Iu = S({
	toolCallId: t(),
	confirmation: Fu
}).transform((e) => W(e, { toolCallId: "tool_call_id" })), Lu = _({
	Client: "client",
	Server: "server"
}), Ru = S({
	inputs: Pu.optional(),
	stream: p(!1).default(!1),
	store: d().default(!0),
	handoffExecution: Lu.default("server"),
	completionArgs: va.optional(),
	toolConfirmations: l(v(Iu)).optional()
}).transform((e) => W(e, {
	handoffExecution: "handoff_execution",
	completionArgs: "completion_args",
	toolConfirmations: "tool_confirmations"
})), zu = _({
	Client: "client",
	Server: "server"
}), Bu = S({
	inputs: Pu.optional(),
	stream: p(!0).default(!0),
	store: d().default(!0),
	handoffExecution: zu.default("server"),
	completionArgs: va.optional(),
	toolConfirmations: l(v(Iu)).optional()
}).transform((e) => W(e, {
	handoffExecution: "handoff_execution",
	completionArgs: "completion_args",
	toolConfirmations: "tool_confirmations"
})), Vu = Y({
	Pending: "pending",
	Allowed: "allowed",
	Denied: "denied"
}), Hu = S({
	type: p("function.call.delta"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	model: l(t()).optional(),
	agent_id: l(t()).optional(),
	name: t(),
	tool_call_id: t(),
	arguments: t(),
	confirmation_status: l(Vu).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex",
	agent_id: "agentId",
	tool_call_id: "toolCallId",
	confirmation_status: "confirmationStatus"
})), Uu = X([
	yu,
	wo,
	yo,
	ho,
	ao,
	Eo
]);
X([t(), Uu]);
var Wu = S({
	type: p("message.output.delta"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	content_index: f().default(0),
	model: l(t()).optional(),
	agent_id: l(t()).optional(),
	role: p("assistant").default("assistant"),
	content: X([t(), Uu])
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex",
	content_index: "contentIndex",
	agent_id: "agentId"
})), Gu = S({
	prompt_tokens: f().default(0),
	completion_tokens: f().default(0),
	total_tokens: f().default(0),
	connector_tokens: l(f()).optional(),
	connectors: l(s(t(), f())).optional()
}).transform((e) => W(e, {
	prompt_tokens: "promptTokens",
	completion_tokens: "completionTokens",
	total_tokens: "totalTokens",
	connector_tokens: "connectorTokens"
})), Ku = S({
	type: p("conversation.response.done"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	usage: Gu
}).transform((e) => W(e, { created_at: "createdAt" })), qu = S({
	type: p("conversation.response.error"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	message: t(),
	code: f()
}).transform((e) => W(e, { created_at: "createdAt" })), Ju = S({
	type: p("conversation.response.started"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	conversation_id: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	conversation_id: "conversationId"
})), Yu = Y({
	ConversationResponseStarted: "conversation.response.started",
	ConversationResponseDone: "conversation.response.done",
	ConversationResponseError: "conversation.response.error",
	MessageOutputDelta: "message.output.delta",
	ToolExecutionStarted: "tool.execution.started",
	ToolExecutionDelta: "tool.execution.delta",
	ToolExecutionDone: "tool.execution.done",
	AgentHandoffStarted: "agent.handoff.started",
	AgentHandoffDone: "agent.handoff.done",
	FunctionCallDelta: "function.call.delta"
});
X([So, t()]);
var Xu = S({
	type: p("tool.execution.delta"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	name: X([So, t()]),
	arguments: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex"
}));
X([So, t()]);
var Zu = S({
	type: p("tool.execution.done"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	name: X([So, t()]),
	info: s(t(), g()).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex"
}));
X([So, t()]);
var Qu = S({
	type: p("tool.execution.started"),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	output_index: f().default(0),
	id: t(),
	model: l(t()).optional(),
	agent_id: l(t()).optional(),
	name: X([So, t()]),
	arguments: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	output_index: "outputIndex",
	agent_id: "agentId"
}));
Gi("type", {
	"agent.handoff.done": $a,
	"agent.handoff.started": no,
	"conversation.response.done": Ku,
	"conversation.response.error": qu,
	"conversation.response.started": Ju,
	"function.call.delta": Hu,
	"message.output.delta": Wu,
	"tool.execution.delta": Xu,
	"tool.execution.done": Zu,
	"tool.execution.started": Qu
});
var $u = S({
	event: Yu,
	data: t().transform((e, t) => {
		try {
			return JSON.parse(e);
		} catch (n) {
			return t.addIssue({
				input: e,
				code: "custom",
				message: `malformed json: ${n}`
			}), o;
		}
	}).pipe(Gi("type", {
		"agent.handoff.done": $a,
		"agent.handoff.started": no,
		"conversation.response.done": Ku,
		"conversation.response.error": qu,
		"conversation.response.started": Ju,
		"function.call.delta": Hu,
		"message.output.delta": Wu,
		"tool.execution.delta": Xu,
		"tool.execution.done": Zu,
		"tool.execution.started": Qu
	}))
});
X([
	eo,
	hu,
	Eu,
	_u,
	Mu,
	Au
]);
var ed = S({
	object: p("conversation.history").default("conversation.history"),
	conversation_id: t(),
	entries: v(X([
		eo,
		hu,
		Eu,
		_u,
		Mu,
		Au
	]))
}).transform((e) => W(e, { conversation_id: "conversationId" })), td = X([Eu, Au]), nd = S({
	object: p("conversation.messages").default("conversation.messages"),
	conversation_id: t(),
	messages: v(td)
}).transform((e) => W(e, { conversation_id: "conversationId" })), rd = S({ messages: v(s(t(), g())) }).catchall(g()), id = S({ messages: v(s(t(), g())) }).catchall(g()), ad = _({
	Client: "client",
	Server: "server"
});
x([
	Yi,
	wa,
	Ea,
	Aa,
	Ga,
	Ya,
	qa
]), X([t(), f()]);
var od = S({
	inputs: Pu,
	stream: p(!1).default(!1),
	store: l(d()).optional(),
	handoffExecution: l(ad).optional(),
	instructions: l(t()).optional(),
	tools: l(v(x([
		Yi,
		wa,
		Ea,
		Aa,
		Ga,
		Ya,
		qa
	]))).optional(),
	completionArgs: l(va).optional(),
	guardrails: l(v(Ua)).optional(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	metadata: l(s(t(), g())).optional(),
	agentId: l(t()).optional(),
	agentVersion: l(X([t(), f()])).optional(),
	model: l(t()).optional()
}).transform((e) => W(e, {
	handoffExecution: "handoff_execution",
	completionArgs: "completion_args",
	agentId: "agent_id",
	agentVersion: "agent_version"
}));
X([
	eo,
	hu,
	Mu,
	Au
]);
var sd = S({
	object: p("conversation.response").default("conversation.response"),
	conversation_id: t(),
	outputs: v(X([
		eo,
		hu,
		Mu,
		Au
	])),
	usage: Gu,
	guardrails: l(v(s(t(), g()))).optional()
}).transform((e) => W(e, { conversation_id: "conversationId" })), cd = _({
	Client: "client",
	Server: "server"
});
X([t(), f()]);
var ld = S({
	inputs: Pu.optional(),
	stream: p(!1).default(!1),
	store: d().default(!0),
	handoffExecution: cd.default("server"),
	completionArgs: va.optional(),
	guardrails: l(v(Ua)).optional(),
	metadata: l(s(t(), g())).optional(),
	fromEntryId: t(),
	agentVersion: l(X([t(), f()])).optional()
}).transform((e) => W(e, {
	handoffExecution: "handoff_execution",
	completionArgs: "completion_args",
	fromEntryId: "from_entry_id",
	agentVersion: "agent_version"
})), ud = _({
	Client: "client",
	Server: "server"
});
X([t(), f()]);
var dd = S({
	inputs: Pu.optional(),
	stream: p(!0).default(!0),
	store: d().default(!0),
	handoffExecution: ud.default("server"),
	completionArgs: va.optional(),
	guardrails: l(v(Ua)).optional(),
	metadata: l(s(t(), g())).optional(),
	fromEntryId: t(),
	agentVersion: l(X([t(), f()])).optional()
}).transform((e) => W(e, {
	handoffExecution: "handoff_execution",
	completionArgs: "completion_args",
	fromEntryId: "from_entry_id",
	agentVersion: "agent_version"
})), fd = Y({
	Explorer: "EXPLORER",
	UploadedFile: "UPLOADED_FILE",
	DirectInput: "DIRECT_INPUT",
	Playground: "PLAYGROUND"
}), pd = _({
	Client: "client",
	Server: "server"
});
x([
	Yi,
	wa,
	Ea,
	Aa,
	Ga,
	Ya,
	qa
]), X([t(), f()]);
var md = S({
	inputs: Pu,
	stream: p(!0).default(!0),
	store: l(d()).optional(),
	handoffExecution: l(pd).optional(),
	instructions: l(t()).optional(),
	tools: l(v(x([
		Yi,
		wa,
		Ea,
		Aa,
		Ga,
		Ya,
		qa
	]))).optional(),
	completionArgs: l(va).optional(),
	guardrails: l(v(Ua)).optional(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	metadata: l(s(t(), g())).optional(),
	agentId: l(t()).optional(),
	agentVersion: l(X([t(), f()])).optional(),
	model: l(t()).optional()
}).transform((e) => W(e, {
	handoffExecution: "handoff_execution",
	completionArgs: "completion_args",
	agentId: "agent_id",
	agentVersion: "agent_version"
}));
x([
	Yi,
	wa,
	Ea,
	Aa,
	Ga,
	Ya,
	qa
]);
var hd = S({
	instructions: l(t()).optional(),
	tools: v(x([
		Yi,
		wa,
		Ea,
		Aa,
		Ga,
		Ya,
		qa
	])).optional(),
	completionArgs: va.optional(),
	guardrails: l(v(Ua)).optional(),
	model: t(),
	name: t(),
	description: l(t()).optional(),
	handoffs: l(v(t())).optional(),
	metadata: l(s(t(), g())).optional(),
	versionMessage: l(t()).optional()
}).transform((e) => W(e, {
	completionArgs: "completion_args",
	versionMessage: "version_message"
})), gd = S({
	inputFiles: l(v(t())).optional(),
	requests: l(v(ks)).optional(),
	endpoint: Jo,
	model: l(t()).optional(),
	agentId: l(t()).optional(),
	metadata: l(s(t(), t())).optional(),
	timeoutHours: f().default(24)
}).transform((e) => W(e, {
	inputFiles: "input_files",
	agentId: "agent_id",
	timeoutHours: "timeout_hours"
})), _d = S({
	searchParams: zs,
	judgeId: t(),
	name: t(),
	description: t(),
	maxNbEvents: f()
}).transform((e) => W(e, {
	searchParams: "search_params",
	judgeId: "judge_id",
	maxNbEvents: "max_nb_events"
})), vd = S({
	issuer: t(),
	authorizationEndpoint: t(),
	tokenEndpoint: t(),
	registrationEndpoint: l(t()).optional(),
	scopesSupported: l(v(t())).optional(),
	responseTypesSupported: v(t()).optional(),
	responseModesSupported: l(v(t())).optional(),
	grantTypesSupported: l(v(t())).optional(),
	tokenEndpointAuthMethodsSupported: l(v(t())).optional(),
	tokenEndpointAuthSigningAlgValuesSupported: l(v(t())).optional(),
	serviceDocumentation: l(t()).optional(),
	uiLocalesSupported: l(v(t())).optional(),
	opPolicyUri: l(t()).optional(),
	opTosUri: l(t()).optional(),
	revocationEndpoint: l(t()).optional(),
	revocationEndpointAuthMethodsSupported: l(v(t())).optional(),
	revocationEndpointAuthSigningAlgValuesSupported: l(v(t())).optional(),
	introspectionEndpoint: l(t()).optional(),
	introspectionEndpointAuthMethodsSupported: l(v(t())).optional(),
	introspectionEndpointAuthSigningAlgValuesSupported: l(v(t())).optional(),
	codeChallengeMethodsSupported: l(v(t())).optional(),
	clientIdMetadataDocumentSupported: l(d()).optional(),
	xResourceUrl: l(t()).optional()
}).transform((e) => W(e, {
	authorizationEndpoint: "authorization_endpoint",
	tokenEndpoint: "token_endpoint",
	registrationEndpoint: "registration_endpoint",
	scopesSupported: "scopes_supported",
	responseTypesSupported: "response_types_supported",
	responseModesSupported: "response_modes_supported",
	grantTypesSupported: "grant_types_supported",
	tokenEndpointAuthMethodsSupported: "token_endpoint_auth_methods_supported",
	tokenEndpointAuthSigningAlgValuesSupported: "token_endpoint_auth_signing_alg_values_supported",
	serviceDocumentation: "service_documentation",
	uiLocalesSupported: "ui_locales_supported",
	opPolicyUri: "op_policy_uri",
	opTosUri: "op_tos_uri",
	revocationEndpoint: "revocation_endpoint",
	revocationEndpointAuthMethodsSupported: "revocation_endpoint_auth_methods_supported",
	revocationEndpointAuthSigningAlgValuesSupported: "revocation_endpoint_auth_signing_alg_values_supported",
	introspectionEndpoint: "introspection_endpoint",
	introspectionEndpointAuthMethodsSupported: "introspection_endpoint_auth_methods_supported",
	introspectionEndpointAuthSigningAlgValuesSupported: "introspection_endpoint_auth_signing_alg_values_supported",
	codeChallengeMethodsSupported: "code_challenge_methods_supported",
	clientIdMetadataDocumentSupported: "client_id_metadata_document_supported",
	xResourceUrl: "x_resource_url"
})), yd = S({
	protocol: p("mcp").default("mcp"),
	name: t(),
	title: l(t()).optional(),
	description: t(),
	iconUrl: l(t()).optional(),
	visibility: _l.optional(),
	server: t(),
	headers: l(s(t(), g())).optional(),
	authData: l(rs).optional(),
	oauth2ServerMetadata: l(vd).optional(),
	oauth2ServerMetadataUrl: l(t()).optional(),
	systemPrompt: l(t()).optional()
}).transform((e) => W(e, {
	iconUrl: "icon_url",
	authData: "auth_data",
	oauth2ServerMetadata: "oauth2_server_metadata",
	oauth2ServerMetadataUrl: "oauth2_server_metadata_url",
	systemPrompt: "system_prompt"
})), bd = S({
	payload: id,
	properties: s(t(), g())
}), xd = S({
	name: t(),
	description: t()
}), Sd = {
	FineTune: "fine-tune",
	Batch: "batch",
	Ocr: "ocr"
}, Cd = Y(Sd), wd = Oi(Sd), Td = Y({
	Workspace: "workspace",
	User: "user"
}), Ed = {
	Pretrain: "pretrain",
	Instruct: "instruct",
	BatchRequest: "batch_request",
	BatchResult: "batch_result",
	BatchError: "batch_error"
}, Dd = Y(Ed), Od = Oi(Ed), kd = {
	Upload: "upload",
	Repository: "repository",
	Mistral: "mistral"
}, Ad = Y(kd), jd = Oi(kd), Md = S({
	id: t(),
	object: t(),
	bytes: f(),
	created_at: f(),
	filename: t(),
	purpose: Cd,
	sample_type: Dd,
	num_lines: l(f()).optional(),
	mimetype: l(t()).optional(),
	source: Ad,
	signature: l(t()).optional(),
	expires_at: l(f()).optional(),
	visibility: l(Td).optional()
}).transform((e) => W(e, {
	bytes: "sizeBytes",
	created_at: "createdAt",
	sample_type: "sampleType",
	num_lines: "numLines",
	expires_at: "expiresAt"
})), Nd = S({
	type: p("github"),
	name: t(),
	owner: t(),
	ref: l(t()).optional(),
	weight: b().default(1),
	token: t()
}), Pd = _({
	Completion: "completion",
	Classifier: "classifier"
}), Fd = S({
	fileId: t(),
	weight: b().default(1)
}).transform((e) => W(e, { fileId: "file_id" })), Id = S({
	type: p("wandb"),
	project: t(),
	name: l(t()).optional(),
	apiKey: t(),
	runName: l(t()).optional()
}).transform((e) => W(e, {
	apiKey: "api_key",
	runName: "run_name"
}));
X([Gc, xc]);
var Ld = S({
	model: t(),
	trainingFiles: v(Fd).optional(),
	validationFiles: l(v(t())).optional(),
	suffix: l(t()).optional(),
	integrations: l(v(Id)).optional(),
	autoStart: d().optional(),
	invalidSampleSkipPercentage: b().default(0),
	jobType: l(Pd).optional(),
	hyperparameters: X([Gc, xc]),
	repositories: l(v(Nd)).optional(),
	classifierTargets: l(v(kc)).optional()
}).transform((e) => W(e, {
	trainingFiles: "training_files",
	validationFiles: "validation_files",
	autoStart: "auto_start",
	invalidSampleSkipPercentage: "invalid_sample_skip_percentage",
	jobType: "job_type",
	classifierTargets: "classifier_targets"
})), Rd = S({
	name: t(),
	pipelineComposition: l(s(t(), t())).optional()
}).transform((e) => W(e, { pipelineComposition: "pipeline_composition" }));
x([Us, Gs]);
var zd = S({
	name: t(),
	description: t(),
	modelName: t(),
	output: x([Us, Gs]),
	instructions: t(),
	tools: v(t())
}).transform((e) => W(e, { modelName: "model_name" })), Bd = _({
	User: "User",
	Workspace: "Workspace"
}), Vd = S({
	name: t(),
	description: l(t()).optional(),
	chunkSize: l(f()).optional(),
	ownerType: l(Bd).optional()
}).transform((e) => W(e, {
	chunkSize: "chunk_size",
	ownerType: "owner_type"
})), Hd = S({
	name: t(),
	documentCount: l(f()).optional()
}).transform((e) => W(e, { documentCount: "document_count" })), Ud = S({
	type: p("vespa"),
	k8sCluster: t(),
	k8sNamespace: t(),
	vespaInstanceName: t(),
	schemas: v(Hd)
}).transform((e) => W(e, {
	k8sCluster: "k8s_cluster",
	k8sNamespace: "k8s_namespace",
	vespaInstanceName: "vespa_instance_name"
})), Wd = _({
	Online: "online",
	Offline: "offline"
}), Gd = S({
	name: t(),
	documentCount: l(f()).optional(),
	status: Wd.default("offline"),
	index: Ud
}).transform((e) => W(e, { documentCount: "document_count" })), Kd = S({
	name: t(),
	isDefault: l(d()).optional(),
	credentials: l(el).optional()
}).transform((e) => W(e, { isDefault: "is_default" })), qd = S({
	credentials: v(ds),
	connector_preset_credentials_for_auth: v(ls).optional()
}).transform((e) => W(e, { connector_preset_credentials_for_auth: "connectorPresetCredentialsForAuth" })), Jd = S({
	custom_task_id: t(),
	custom_task_type: t(),
	reason: l(t()).optional()
}).transform((e) => W(e, {
	custom_task_id: "customTaskId",
	custom_task_type: "customTaskType"
})), Yd = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("CUSTOM_TASK_CANCELED").default("CUSTOM_TASK_CANCELED"),
	attributes: Jd
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), Xd = S({
	custom_task_id: t(),
	custom_task_type: t(),
	payload: Ni
}).transform((e) => W(e, {
	custom_task_id: "customTaskId",
	custom_task_type: "customTaskType"
})), Zd = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("CUSTOM_TASK_COMPLETED").default("CUSTOM_TASK_COMPLETED"),
	attributes: Xd
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), Qd = S({
	custom_task_id: t(),
	custom_task_type: t(),
	failure: Ii
}).transform((e) => W(e, {
	custom_task_id: "customTaskId",
	custom_task_type: "customTaskType"
})), $d = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("CUSTOM_TASK_FAILED").default("CUSTOM_TASK_FAILED"),
	attributes: Qd
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), ef = S({
	path: t(),
	value: g(),
	op: p("add")
}), tf = S({
	type: p("__encrypted__"),
	value: t()
});
X([tf, t()]);
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/jsonpatch.js
var nf = Gi("op", {
	add: ef,
	append: S({
		path: t(),
		value: X([tf, t()]),
		op: p("append")
	}),
	remove: S({
		path: t(),
		value: g(),
		op: p("remove")
	}),
	replace: S({
		path: t(),
		value: g(),
		op: p("replace")
	})
}), rf = X([v(nf), t()]), af = S({
	type: p("json_patch"),
	value: rf,
	encoding_options: l(v(ji)).optional()
}).transform((e) => W(e, { encoding_options: "encodingOptions" }));
Gi("type", {
	json: Ni.and(S({ type: p("json") })),
	json_patch: af
});
var of = S({
	custom_task_id: t(),
	custom_task_type: t(),
	payload: Gi("type", {
		json: Ni.and(S({ type: p("json") })),
		json_patch: af
	})
}).transform((e) => W(e, {
	custom_task_id: "customTaskId",
	custom_task_type: "customTaskType"
})), sf = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("CUSTOM_TASK_IN_PROGRESS").default("CUSTOM_TASK_IN_PROGRESS"),
	attributes: of
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), cf = S({
	custom_task_id: t(),
	custom_task_type: t(),
	payload: Ni.optional()
}).transform((e) => W(e, {
	custom_task_id: "customTaskId",
	custom_task_type: "customTaskType"
})), lf = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("CUSTOM_TASK_STARTED").default("CUSTOM_TASK_STARTED"),
	attributes: cf
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), uf = S({
	custom_task_id: t(),
	custom_task_type: t(),
	timeout_type: l(t()).optional()
}).transform((e) => W(e, {
	custom_task_id: "customTaskId",
	custom_task_type: "customTaskType",
	timeout_type: "timeoutType"
})), df = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("CUSTOM_TASK_TIMED_OUT").default("CUSTOM_TASK_TIMED_OUT"),
	attributes: uf
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), ff = S({
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deleted_at: l(n({ offset: !0 }).transform((e) => new Date(e))),
	name: t(),
	description: t(),
	owner_id: t(),
	workspace_id: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	deleted_at: "deletedAt",
	owner_id: "ownerId",
	workspace_id: "workspaceId"
})), pf = S({
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deleted_at: l(n({ offset: !0 }).transform((e) => new Date(e))),
	creator_id: t(),
	dataset_id: t(),
	workspace_id: t(),
	status: bs,
	progress: l(f()).optional(),
	message: l(t()).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	deleted_at: "deletedAt",
	creator_id: "creatorId",
	dataset_id: "datasetId",
	workspace_id: "workspaceId"
})), mf = S({
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deleted_at: l(n({ offset: !0 }).transform((e) => new Date(e))),
	name: t(),
	description: t(),
	owner_id: t(),
	workspace_id: t()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	deleted_at: "deletedAt",
	owner_id: "ownerId",
	workspace_id: "workspaceId"
})), hf = S({
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	deleted_at: l(n({ offset: !0 }).transform((e) => new Date(e))),
	dataset_id: t(),
	payload: rd,
	properties: s(t(), g()),
	source: fd
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	deleted_at: "deletedAt",
	dataset_id: "datasetId"
})), gf = S({
	id: t(),
	object: p("batch").default("batch"),
	deleted: d().default(!0)
}), _f = S({ datasetRecordIds: v(t()) }).transform((e) => W(e, { datasetRecordIds: "dataset_record_ids" })), vf = S({
	id: t(),
	object: t(),
	deleted: d()
}), yf = S({
	id: t(),
	object: t().default("model"),
	deleted: d().default(!0)
}), bf = Y({
	Local: "local",
	K8s: "k8s"
}), xf = S({
	location_type: bf,
	k8s_cluster: l(t()).optional(),
	k8s_namespace: l(t()).optional()
}).transform((e) => W(e, {
	location_type: "locationType",
	k8s_cluster: "k8sCluster",
	k8s_namespace: "k8sNamespace"
})), Sf = S({
	name: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	is_active: d()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	is_active: "isActive"
})), Cf = S({
	id: t(),
	name: t(),
	is_active: d(),
	is_hardened: d().default(!1),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	location: l(xf).optional(),
	workers: v(Sf)
}).transform((e) => W(e, {
	is_active: "isActive",
	is_hardened: "isHardened",
	created_at: "createdAt",
	updated_at: "updatedAt"
})), wf = S({
	id: t(),
	name: t(),
	is_active: d(),
	is_hardened: d().default(!1),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	location: l(xf).optional()
}).transform((e) => W(e, {
	is_active: "isActive",
	is_hardened: "isHardened",
	created_at: "createdAt",
	updated_at: "updatedAt"
})), Tf = S({
	deployments: v(wf),
	next_cursor: l(t()),
	workspace_id: t()
}).transform((e) => W(e, {
	next_cursor: "nextCursor",
	workspace_id: "workspaceId"
})), Ef = Y({
	SelfManaged: "self_managed",
	MissingContent: "missing_content",
	Noop: "noop",
	Done: "done",
	Todo: "todo",
	InProgress: "in_progress",
	Error: "error",
	WaitingForCapacity: "waiting_for_capacity"
}), Df = S({
	id: t(),
	library_id: t(),
	hash: l(t()),
	mime_type: l(t()),
	extension: l(t()),
	size: l(f()),
	name: t(),
	summary: l(t()).optional(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	last_processed_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	number_of_pages: l(f()).optional(),
	process_status: Ef,
	uploaded_by_id: l(t()),
	uploaded_by_type: t(),
	tokens_processing_main_content: l(f()).optional(),
	tokens_processing_summary: l(f()).optional(),
	url: l(t()).optional(),
	attributes: l(s(t(), g())).optional(),
	expires_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	processing_status: t(),
	tokens_processing_total: f()
}).transform((e) => W(e, {
	library_id: "libraryId",
	mime_type: "mimeType",
	created_at: "createdAt",
	last_processed_at: "lastProcessedAt",
	number_of_pages: "numberOfPages",
	process_status: "processStatus",
	uploaded_by_id: "uploadedById",
	uploaded_by_type: "uploadedByType",
	tokens_processing_main_content: "tokensProcessingMainContent",
	tokens_processing_summary: "tokensProcessingSummary",
	expires_at: "expiresAt",
	processing_status: "processingStatus",
	tokens_processing_total: "tokensProcessingTotal"
})), Of = S({ text: t() }), kf = _({
	Float: "float",
	Int8: "int8",
	Uint8: "uint8",
	Binary: "binary",
	Ubinary: "ubinary"
}), Af = _({
	Float: "float",
	Base64: "base64"
});
X([t(), v(t())]);
var jf = S({
	model: t(),
	metadata: l(s(t(), g())).optional(),
	inputs: X([t(), v(t())]),
	outputDimension: l(f()).optional(),
	outputDtype: kf.optional(),
	encodingFormat: Af.optional()
}).transform((e) => W(e, {
	inputs: "input",
	outputDimension: "output_dimension",
	outputDtype: "output_dtype",
	encodingFormat: "encoding_format"
})), Mf = S({
	object: t().optional(),
	embedding: v(b()).optional(),
	index: f().optional()
}), Nf = S({
	id: t(),
	object: t(),
	model: t(),
	usage: ic,
	data: v(Mf)
}), Pf = Oi({
	User: "User",
	Workspace: "Workspace",
	Org: "Org"
}), Ff = Y({
	Running: "RUNNING",
	Completed: "COMPLETED",
	Failed: "FAILED"
}), If = _({
	Database: "DATABASE",
	Live: "LIVE",
	Hybrid: "HYBRID"
}), Lf = Y({
	Event: "EVENT",
	EventProgress: "EVENT_PROGRESS"
}), Rf = S({
	timestamp: n({ offset: !0 }).transform((e) => new Date(e)),
	trace_id: t(),
	span_id: t(),
	severity_text: t(),
	body: t(),
	log_attributes: s(t(), t())
}).transform((e) => W(e, {
	trace_id: "traceId",
	span_id: "spanId",
	severity_text: "severityText",
	log_attributes: "logAttributes"
})), zf = S({
	results: v(Rf),
	next_cursor: l(t()).optional()
}).transform((e) => W(e, { next_cursor: "nextCursor" })), Bf = S({ file_url: t() }).transform((e) => W(e, { file_url: "fileUrl" })), Vf = S({
	results: v(nc).optional(),
	next: l(t()).optional(),
	cursor: l(t()).optional()
}), Hf = S({
	customer_id: t(),
	organization_id: t(),
	workspace_id: t(),
	user_id: t(),
	timestamp: n({ offset: !0 }).transform((e) => new Date(e)),
	trace_id: t(),
	span_id: t(),
	trace_flags: f(),
	severity_text: t(),
	severity_number: f(),
	service_name: t(),
	body: t(),
	event_name: t(),
	resource_schema_url: t(),
	resource_attributes: s(t(), t()),
	scope_schema_url: t(),
	scope_name: t(),
	scope_version: t(),
	scope_attributes: s(t(), t()),
	log_attributes: s(t(), t())
}).transform((e) => W(e, {
	customer_id: "customerId",
	organization_id: "organizationId",
	workspace_id: "workspaceId",
	user_id: "userId",
	trace_id: "traceId",
	span_id: "spanId",
	trace_flags: "traceFlags",
	severity_text: "severityText",
	severity_number: "severityNumber",
	service_name: "serviceName",
	event_name: "eventName",
	resource_schema_url: "resourceSchemaUrl",
	resource_attributes: "resourceAttributes",
	scope_schema_url: "scopeSchemaUrl",
	scope_name: "scopeName",
	scope_version: "scopeVersion",
	scope_attributes: "scopeAttributes",
	log_attributes: "logAttributes"
})), Uf = S({
	results: v(Hf).optional(),
	next: l(t()).optional(),
	cursor: l(t()).optional()
}), Wf = Y({
	Error: "Error",
	Ok: "Ok",
	Unset: "Unset"
}), Gf = S({
	customer_id: t(),
	organization_id: t(),
	workspace_id: t(),
	user_id: t(),
	trace_id: t(),
	span_id: t(),
	parent_span_id: t(),
	trace_state: t(),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: n({ offset: !0 }).transform((e) => new Date(e)),
	duration_ns: f(),
	span_name: t(),
	span_kind: t(),
	service_name: t(),
	status_code: Wf,
	status_message: t(),
	error_type: t(),
	operation_name: t(),
	provider_name: t(),
	request_model: t(),
	response_model: t(),
	response_id: t(),
	output_type: t(),
	conversation_id: t(),
	data_source_id: t(),
	agent_id: t(),
	agent_name: t(),
	agent_version: t(),
	agent_description: t(),
	workflow_name: t(),
	prompt_name: t(),
	tool_name: t(),
	tool_type: t(),
	tool_call_id: t(),
	input_messages: t(),
	output_messages: t(),
	system_instructions: t(),
	tool_definitions: t(),
	tool_call_arguments: t(),
	tool_call_result: t(),
	request_choice_count: f(),
	request_max_tokens: f(),
	request_temperature: l(b()),
	request_top_p: l(b()),
	request_top_k: l(b()),
	request_presence_penalty: l(b()),
	request_frequency_penalty: l(b()),
	request_seed: f(),
	request_stop_sequences: v(t()),
	request_encoding_formats: v(t()),
	response_finish_reasons: v(t()),
	usage_input_tokens: f(),
	usage_output_tokens: f(),
	usage_cache_read_input_tokens: f(),
	usage_cache_creation_input_tokens: f(),
	resource_attributes: s(t(), t()),
	span_attributes: s(t(), t()),
	scope_name: t(),
	scope_version: t()
}).transform((e) => W(e, {
	customer_id: "customerId",
	organization_id: "organizationId",
	workspace_id: "workspaceId",
	user_id: "userId",
	trace_id: "traceId",
	span_id: "spanId",
	parent_span_id: "parentSpanId",
	trace_state: "traceState",
	start_time: "startTime",
	end_time: "endTime",
	duration_ns: "durationNs",
	span_name: "spanName",
	span_kind: "spanKind",
	service_name: "serviceName",
	status_code: "statusCode",
	status_message: "statusMessage",
	error_type: "errorType",
	operation_name: "operationName",
	provider_name: "providerName",
	request_model: "requestModel",
	response_model: "responseModel",
	response_id: "responseId",
	output_type: "outputType",
	conversation_id: "conversationId",
	data_source_id: "dataSourceId",
	agent_id: "agentId",
	agent_name: "agentName",
	agent_version: "agentVersion",
	agent_description: "agentDescription",
	workflow_name: "workflowName",
	prompt_name: "promptName",
	tool_name: "toolName",
	tool_type: "toolType",
	tool_call_id: "toolCallId",
	input_messages: "inputMessages",
	output_messages: "outputMessages",
	system_instructions: "systemInstructions",
	tool_definitions: "toolDefinitions",
	tool_call_arguments: "toolCallArguments",
	tool_call_result: "toolCallResult",
	request_choice_count: "requestChoiceCount",
	request_max_tokens: "requestMaxTokens",
	request_temperature: "requestTemperature",
	request_top_p: "requestTopP",
	request_top_k: "requestTopK",
	request_presence_penalty: "requestPresencePenalty",
	request_frequency_penalty: "requestFrequencyPenalty",
	request_seed: "requestSeed",
	request_stop_sequences: "requestStopSequences",
	request_encoding_formats: "requestEncodingFormats",
	response_finish_reasons: "responseFinishReasons",
	usage_input_tokens: "usageInputTokens",
	usage_output_tokens: "usageOutputTokens",
	usage_cache_read_input_tokens: "usageCacheReadInputTokens",
	usage_cache_creation_input_tokens: "usageCacheCreationInputTokens",
	resource_attributes: "resourceAttributes",
	span_attributes: "spanAttributes",
	scope_name: "scopeName",
	scope_version: "scopeVersion"
})), Kf = S({
	results: v(Gf).optional(),
	next: l(t()).optional(),
	cursor: l(t()).optional()
}), qf = S({
	customer_id: t(),
	organization_id: t(),
	workspace_id: t(),
	user_id: t(),
	trace_id: t(),
	span_id: t(),
	response_id: t(),
	conversation_id: t(),
	timestamp: n({ offset: !0 }).transform((e) => new Date(e)),
	evaluation_name: t(),
	score_value: b(),
	score_label: t(),
	explanation: t(),
	metadata: s(t(), t())
}).transform((e) => W(e, {
	customer_id: "customerId",
	organization_id: "organizationId",
	workspace_id: "workspaceId",
	user_id: "userId",
	trace_id: "traceId",
	span_id: "spanId",
	response_id: "responseId",
	conversation_id: "conversationId",
	evaluation_name: "evaluationName",
	score_value: "scoreValue",
	score_label: "scoreLabel"
})), Jf = S({
	results: v(qf).optional(),
	next: l(t()).optional(),
	cursor: l(t()).optional()
}), Yf = Y({
	Error: "Error",
	Unset: "Unset"
}), Xf = S({
	customer_id: t(),
	organization_id: t(),
	workspace_id: t(),
	user_id: t(),
	trace_id: t(),
	root_span_id: t(),
	root_span_name: t(),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: n({ offset: !0 }).transform((e) => new Date(e)),
	duration_ns: f(),
	service_name: t(),
	environment: t(),
	conversation_id: t(),
	workflow_name: t(),
	agent_id: t(),
	agent_name: t(),
	status_code: Yf,
	error_count: f(),
	span_count: f(),
	gen_ai_span_count: f(),
	llm_call_count: f(),
	tool_call_count: f(),
	retrieval_count: f(),
	evaluation_count: f(),
	input_tokens: f(),
	output_tokens: f(),
	cache_read_input_tokens: f(),
	cache_creation_input_tokens: f(),
	models_used: v(t()),
	tools_used: v(t()),
	first_turn_last_input_message: t(),
	first_turn_last_output_message: t(),
	last_turn_last_input_message: t(),
	last_turn_last_output_message: t()
}).transform((e) => W(e, {
	customer_id: "customerId",
	organization_id: "organizationId",
	workspace_id: "workspaceId",
	user_id: "userId",
	trace_id: "traceId",
	root_span_id: "rootSpanId",
	root_span_name: "rootSpanName",
	start_time: "startTime",
	end_time: "endTime",
	duration_ns: "durationNs",
	service_name: "serviceName",
	conversation_id: "conversationId",
	workflow_name: "workflowName",
	agent_id: "agentId",
	agent_name: "agentName",
	status_code: "statusCode",
	error_count: "errorCount",
	span_count: "spanCount",
	gen_ai_span_count: "genAiSpanCount",
	llm_call_count: "llmCallCount",
	tool_call_count: "toolCallCount",
	retrieval_count: "retrievalCount",
	evaluation_count: "evaluationCount",
	input_tokens: "inputTokens",
	output_tokens: "outputTokens",
	cache_read_input_tokens: "cacheReadInputTokens",
	cache_creation_input_tokens: "cacheCreationInputTokens",
	models_used: "modelsUsed",
	tools_used: "toolsUsed",
	first_turn_last_input_message: "firstTurnLastInputMessage",
	first_turn_last_output_message: "firstTurnLastOutputMessage",
	last_turn_last_input_message: "lastTurnLastInputMessage",
	last_turn_last_output_message: "lastTurnLastOutputMessage"
})), Zf = S({
	results: v(Xf).optional(),
	next: l(t()).optional(),
	cursor: l(t()).optional()
}), Qf = S({ status: bs });
X([t(), d()]);
var $f = S({ options: l(v(l(X([t(), d()])))).optional() }), ep = S({ filterParams: l(zs).optional() }).transform((e) => W(e, { filterParams: "filter_params" })), tp = S({
	value: t(),
	count: f()
}), np = S({ counts: v(tp) }), rp = S({
	name: t(),
	label: t()
}), ip = S({
	id: t(),
	object: t(),
	bytes: f(),
	created_at: f(),
	filename: t(),
	purpose: Cd,
	sample_type: Dd,
	num_lines: l(f()).optional(),
	mimetype: l(t()).optional(),
	source: Ad,
	signature: l(t()).optional(),
	expires_at: l(f()).optional(),
	visibility: l(Td).optional()
}).transform((e) => W(e, {
	bytes: "sizeBytes",
	created_at: "createdAt",
	sample_type: "sampleType",
	num_lines: "numLines",
	expires_at: "expiresAt"
}));
X([t(), v(t())]);
var ap = S({
	model: t(),
	temperature: l(b()).optional(),
	topP: l(b()).optional(),
	maxTokens: l(f()).optional(),
	stream: d().default(!1),
	stop: l(X([t(), v(t())])).optional(),
	randomSeed: l(f()).optional(),
	metadata: l(s(t(), g())).optional(),
	prompt: t(),
	suffix: l(t()).optional(),
	minTokens: l(f()).optional(),
	promptCacheKey: l(t()).optional()
}).transform((e) => W(e, {
	topP: "top_p",
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	minTokens: "min_tokens",
	promptCacheKey: "prompt_cache_key"
})), op = S({
	id: t(),
	object: t(),
	model: t(),
	usage: ic,
	created: f(),
	choices: v($s)
});
X([t(), v(t())]);
var sp = S({
	model: t(),
	temperature: l(b()).optional(),
	topP: l(b()).optional(),
	maxTokens: l(f()).optional(),
	stream: d().default(!0),
	stop: l(X([t(), v(t())])).optional(),
	randomSeed: l(f()).optional(),
	metadata: l(s(t(), g())).optional(),
	prompt: t(),
	suffix: l(t()).optional(),
	minTokens: l(f()).optional(),
	promptCacheKey: l(t()).optional()
}).transform((e) => W(e, {
	topP: "top_p",
	maxTokens: "max_tokens",
	randomSeed: "random_seed",
	minTokens: "min_tokens",
	promptCacheKey: "prompt_cache_key"
})), cp = S({
	id: t(),
	object: t().default("model"),
	created: f().optional(),
	owned_by: t().default("mistralai"),
	capabilities: vs,
	name: l(t()).optional(),
	description: l(t()).optional(),
	max_context_length: f().default(32768),
	aliases: v(t()).optional(),
	deprecation: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	deprecation_replacement_model: l(t()).optional(),
	default_model_temperature: l(b()).optional(),
	type: p("fine-tuned"),
	job: t(),
	root: t(),
	archived: d().default(!1)
}).transform((e) => W(e, {
	owned_by: "ownedBy",
	max_context_length: "maxContextLength",
	deprecation_replacement_model: "deprecationReplacementModel",
	default_model_temperature: "defaultModelTemperature"
})), lp = S({
	id: t(),
	object: t(),
	bytes: f(),
	created_at: f(),
	filename: t(),
	purpose: Cd,
	sample_type: Dd,
	num_lines: l(f()).optional(),
	mimetype: l(t()).optional(),
	source: Ad,
	signature: l(t()).optional(),
	expires_at: l(f()).optional(),
	visibility: l(Td).optional(),
	deleted: d()
}).transform((e) => W(e, {
	bytes: "sizeBytes",
	created_at: "createdAt",
	sample_type: "sampleType",
	num_lines: "numLines",
	expires_at: "expiresAt"
})), up = S({ options: l(v(t())) }), dp = {
	Enum: "ENUM",
	Text: "TEXT",
	Int: "INT",
	Float: "FLOAT",
	Bool: "BOOL",
	Timestamp: "TIMESTAMP",
	Array: "ARRAY",
	Map: "MAP"
}, fp = {
	Eq: "eq",
	Neq: "neq",
	Lt: "lt",
	Lte: "lte",
	Gt: "gt",
	Gte: "gte",
	Like: "like",
	Ilike: "ilike",
	NotLike: "not_like",
	NotIlike: "not_ilike",
	Between: "between",
	NotBetween: "not_between",
	In: "in",
	NotIn: "not_in",
	Exists: "exists",
	NotExists: "not_exists",
	Regexp: "regexp",
	NotRegexp: "not_regexp",
	Contains: "contains",
	NotContains: "not_contains",
	Has: "has",
	HasAny: "hasAny",
	HasAll: "hasAll",
	HasToken: "hasToken"
}, pp = Y(dp), mp = Y(fp), hp = S({
	name: t(),
	label: t(),
	type: pp,
	group: l(t()).optional(),
	supported_operators: v(mp)
}).transform((e) => W(e, { supported_operators: "supportedOperators" })), gp = S({ field_definitions: v(hp) }).transform((e) => W(e, { field_definitions: "fieldDefinitions" })), _p = S({ logs: Uf }), vp = S({ url: t() }), yp = S({ options: l(v(t())) }), bp = S({ field_definitions: v(hp) }).transform((e) => W(e, { field_definitions: "fieldDefinitions" })), xp = S({ span_evaluations: Jf }).transform((e) => W(e, { span_evaluations: "spanEvaluations" })), Sp = S({ options: l(v(t())) }), Cp = S({ field_definitions: v(hp) }).transform((e) => W(e, { field_definitions: "fieldDefinitions" })), wp = S({ spans: Kf }), Tp = S({ options: l(v(t())) }), Ep = S({ field_definitions: v(hp) }).transform((e) => W(e, { field_definitions: "fieldDefinitions" })), Dp = S({ traces: Zf }), Op = S({ campaignId: t() }).transform((e) => W(e, { campaignId: "campaign_id" })), kp = S({ datasetRecordIds: v(t()) }).transform((e) => W(e, { datasetRecordIds: "dataset_record_ids" })), Ap = S({ completionEventIds: v(t()) }).transform((e) => W(e, { completionEventIds: "completion_event_ids" })), jp = S({ fileId: t() }).transform((e) => W(e, { fileId: "file_id" })), Mp = S({ conversationIds: v(t()) }).transform((e) => W(e, { conversationIds: "conversation_ids" })), Np = S({
	id: t(),
	author_id: t(),
	name: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	modified_at: n({ offset: !0 }).transform((e) => new Date(e)),
	last_run_time: l(n({ offset: !0 }).transform((e) => new Date(e))),
	last_run_chunks_count: f(),
	total_chunks_count: f(),
	pipeline_composition: l(s(t(), t()))
}).transform((e) => W(e, {
	author_id: "authorId",
	created_at: "createdAt",
	modified_at: "modifiedAt",
	last_run_time: "lastRunTime",
	last_run_chunks_count: "lastRunChunksCount",
	total_chunks_count: "totalChunksCount",
	pipeline_composition: "pipelineComposition"
})), Pp = S({ judgeDefinition: zd }).transform((e) => W(e, { judgeDefinition: "judge_definition" })), Fp = S({
	messages: v(s(t(), g())),
	properties: l(s(t(), g())).optional()
}), Ip = S({ judgeDefinition: zd }).transform((e) => W(e, { judgeDefinition: "judge_definition" }));
X([t(), b()]);
var Lp = S({
	analysis: t(),
	answer: X([t(), b()])
}), Rp = _({
	Regression: "REGRESSION",
	Classification: "CLASSIFICATION"
}), zp = S({
	expected_duration_seconds: l(f()).optional(),
	cost: l(b()).optional(),
	cost_currency: l(t()).optional(),
	train_tokens_per_step: l(f()).optional(),
	train_tokens: l(f()).optional(),
	data_tokens: l(f()).optional(),
	estimated_start_time: l(f()).optional(),
	deprecated: d().default(!0),
	details: t(),
	epochs: l(b()).optional(),
	training_steps: l(f()).optional(),
	object: p("job.metadata").default("job.metadata")
}).transform((e) => W(e, {
	expected_duration_seconds: "expectedDurationSeconds",
	cost_currency: "costCurrency",
	train_tokens_per_step: "trainTokensPerStep",
	train_tokens: "trainTokens",
	data_tokens: "dataTokens",
	estimated_start_time: "estimatedStartTime",
	training_steps: "trainingSteps"
})), Bp = S({
	id: t(),
	name: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	owner_id: l(t()),
	owner_type: t(),
	total_size: f(),
	nb_documents: f(),
	chunk_size: l(f()),
	emoji: l(t()).optional(),
	description: l(t()).optional(),
	generated_description: l(t()).optional(),
	explicit_user_members_count: l(f()).optional(),
	explicit_workspace_members_count: l(f()).optional(),
	org_sharing_role: l(t()).optional(),
	generated_name: l(t()).optional()
}).transform((e) => W(e, {
	created_at: "createdAt",
	updated_at: "updatedAt",
	owner_id: "ownerId",
	owner_type: "ownerType",
	total_size: "totalSize",
	nb_documents: "nbDocuments",
	chunk_size: "chunkSize",
	generated_description: "generatedDescription",
	explicit_user_members_count: "explicitUserMembersCount",
	explicit_workspace_members_count: "explicitWorkspaceMembersCount",
	org_sharing_role: "orgSharingRole",
	generated_name: "generatedName"
})), Vp = S({
	data: v(Os).optional(),
	object: p("list").default("list"),
	total: f()
}), Hp = S({
	results: v(nc).optional(),
	count: f(),
	next: l(t()).optional(),
	previous: l(t()).optional()
}), Up = S({ completion_events: Hp }).transform((e) => W(e, { completion_events: "completionEvents" })), Wp = S({
	results: v(qs).optional(),
	count: f(),
	next: l(t()).optional(),
	previous: l(t()).optional()
}), Gp = S({ campaigns: Wp }), Kp = S({
	field_definitions: v(_s),
	field_groups: v(rp)
}).transform((e) => W(e, {
	field_definitions: "fieldDefinitions",
	field_groups: "fieldGroups"
})), qp = S({
	results: v(pf).optional(),
	count: f(),
	next: l(t()).optional(),
	previous: l(t()).optional()
}), Jp = S({ tasks: qp }), Yp = S({
	results: v(hf).optional(),
	count: f(),
	next: l(t()).optional(),
	previous: l(t()).optional()
}), Xp = S({ records: Yp }), Zp = S({
	results: v(mf).optional(),
	count: f(),
	next: l(t()).optional(),
	previous: l(t()).optional()
}), Qp = S({ datasets: Zp }), $p = S({
	total_items: f(),
	total_pages: f(),
	current_page: f(),
	page_size: f(),
	has_more: d()
}).transform((e) => W(e, {
	total_items: "totalItems",
	total_pages: "totalPages",
	current_page: "currentPage",
	page_size: "pageSize",
	has_more: "hasMore"
})), em = S({
	pagination: $p,
	data: v(Df)
}), tm = S({
	data: v(ip),
	object: t(),
	total: l(f()).optional()
});
Gi("job_type", {
	classifier: Tc,
	completion: Jc
}, { outputPropertyName: "jobType" });
var nm = S({
	data: v(Gi("job_type", {
		classifier: Tc,
		completion: Jc
	}, { outputPropertyName: "jobType" })).optional(),
	object: p("list").default("list"),
	total: f()
}), rm = S({
	results: v(Ks).optional(),
	count: f(),
	next: l(t()).optional(),
	previous: l(t()).optional()
}), im = S({ judges: rm }), am = S({
	pagination: $p,
	data: v(Bp)
}), om = S({
	library_id: t(),
	user_id: l(t()).optional(),
	org_id: t(),
	role: t(),
	share_with_type: t(),
	share_with_uuid: l(t())
}).transform((e) => W(e, {
	library_id: "libraryId",
	user_id: "userId",
	org_id: "orgId",
	share_with_type: "shareWithType",
	share_with_uuid: "shareWithUuid"
})), sm = S({ data: v(om) }), cm = S({
	task_id: t(),
	reason: l(t()).optional()
}).transform((e) => W(e, { task_id: "taskId" })), lm = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_EXECUTION_CANCELED").default("WORKFLOW_EXECUTION_CANCELED"),
	attributes: cm
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), um = S({
	task_id: t(),
	result: Ni
}).transform((e) => W(e, { task_id: "taskId" })), dm = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_EXECUTION_COMPLETED").default("WORKFLOW_EXECUTION_COMPLETED"),
	attributes: um
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), fm = S({
	task_id: t(),
	new_execution_run_id: t(),
	workflow_name: t(),
	input: Ni
}).transform((e) => W(e, {
	task_id: "taskId",
	new_execution_run_id: "newExecutionRunId",
	workflow_name: "workflowName"
})), pm = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_EXECUTION_CONTINUED_AS_NEW").default("WORKFLOW_EXECUTION_CONTINUED_AS_NEW"),
	attributes: fm
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), mm = S({
	task_id: t(),
	failure: Ii
}).transform((e) => W(e, { task_id: "taskId" })), hm = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_EXECUTION_FAILED").default("WORKFLOW_EXECUTION_FAILED"),
	attributes: mm
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), gm = S({
	task_id: t(),
	workflow_name: t(),
	display_name: l(t()).optional(),
	input: Ni
}).transform((e) => W(e, {
	task_id: "taskId",
	workflow_name: "workflowName",
	display_name: "displayName"
})), _m = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_EXECUTION_STARTED").default("WORKFLOW_EXECUTION_STARTED"),
	attributes: gm
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), vm = S({
	task_id: t(),
	failure: Ii
}).transform((e) => W(e, { task_id: "taskId" })), ym = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_TASK_FAILED").default("WORKFLOW_TASK_FAILED"),
	attributes: vm
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
})), bm = S({
	task_id: t(),
	timeout_type: l(t()).optional()
}).transform((e) => W(e, {
	task_id: "taskId",
	timeout_type: "timeoutType"
})), xm = S({
	event_id: t(),
	event_timestamp: f(),
	root_workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()),
	workflow_exec_id: t(),
	workflow_run_id: t(),
	workflow_name: t(),
	event_type: p("WORKFLOW_TASK_TIMED_OUT").default("WORKFLOW_TASK_TIMED_OUT"),
	attributes: bm
}).transform((e) => W(e, {
	event_id: "eventId",
	event_timestamp: "eventTimestamp",
	root_workflow_exec_id: "rootWorkflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	workflow_exec_id: "workflowExecId",
	workflow_run_id: "workflowRunId",
	workflow_name: "workflowName",
	event_type: "eventType"
}));
X([
	_m,
	dm,
	hm,
	lm,
	pm,
	xm,
	ym,
	lf,
	sf,
	Zd,
	$d,
	df,
	Yd,
	Hi,
	Fi,
	Bi,
	Ri
]);
var Sm = S({
	events: v(X([
		_m,
		dm,
		hm,
		lm,
		pm,
		xm,
		ym,
		lf,
		sf,
		Zd,
		$d,
		df,
		Yd,
		Hi,
		Fi,
		Bi,
		Ri
	])),
	next_cursor: l(t()).optional()
}).transform((e) => W(e, { next_cursor: "nextCursor" })), Cm = _({
	Asc: "asc",
	Desc: "desc"
}), wm = S({
	searchExpression: l(t()).optional(),
	order: Cm.default("desc")
}).transform((e) => W(e, { searchExpression: "search_expression" })), Tm = S({
	name: t(),
	title: l(t()).optional(),
	description: l(t()).optional(),
	inputSchema: s(t(), g()),
	outputSchema: l(s(t(), g())).optional(),
	icons: l(v(yl)).optional(),
	annotations: l(Ml).optional(),
	_meta: l(jl).optional(),
	execution: l(Pl).optional()
}).catchall(g()).transform((e) => W(e, { _meta: "meta" })), Em = S({ message: t() }), Dm = Y({
	System: "system",
	User: "user",
	Assistant: "assistant",
	Tool: "tool"
}), Om = S({
	role: Dm,
	total_tokens: l(f()).optional(),
	truncated: d().default(!1),
	usage_count: f().default(1)
}).transform((e) => W(e, {
	total_tokens: "totalTokens",
	usage_count: "usageCount"
}));
Gi("type", {
	code_interpreter: Ji,
	connector: Ca,
	document_library: Ta,
	function: ka,
	image_generation: Wa,
	web_search: Ja,
	web_search_premium: Ka
});
var km = S({
	instructions: l(t()).optional(),
	tools: v(Gi("type", {
		code_interpreter: Ji,
		connector: Ca,
		document_library: Ta,
		function: ka,
		image_generation: Wa,
		web_search: Ja,
		web_search_premium: Ka
	})).optional(),
	completion_args: _a.optional(),
	guardrails: l(v(Ha)).optional(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	metadata: l(s(t(), g())).optional(),
	object: p("conversation").default("conversation"),
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	updated_at: n({ offset: !0 }).transform((e) => new Date(e)),
	model: t()
}).transform((e) => W(e, {
	completion_args: "completionArgs",
	created_at: "createdAt",
	updated_at: "updatedAt"
}));
Gi("type", {
	base: ys,
	"fine-tuned": cp
});
var Am = S({
	object: t().default("list"),
	data: v(Gi("type", {
		base: ys,
		"fine-tuned": cp
	})).optional()
}), jm = S({
	categories: s(t(), d()).optional(),
	category_scores: s(t(), b()).optional()
}).transform((e) => W(e, { category_scores: "categoryScores" })), Mm = S({
	id: t(),
	model: t(),
	results: v(jm)
}), Nm = S({
	b64payload: t(),
	encodingOptions: v(Mi).optional(),
	empty: d().default(!1)
}).transform((e) => W(e, { encodingOptions: "encoding_options" })), Pm = Y({
	UnknownError: "UNKNOWN_ERROR",
	ValidationError: "VALIDATION_ERROR",
	AuthForbidden: "AUTH_FORBIDDEN",
	AuthForbiddenNotWorkspaceAdmin: "AUTH_FORBIDDEN_NOT_WORKSPACE_ADMIN",
	AuthForbiddenWorkspaceNotFound: "AUTH_FORBIDDEN_WORKSPACE_NOT_FOUND",
	AuthForbiddenRoleNotFound: "AUTH_FORBIDDEN_ROLE_NOT_FOUND",
	AuthUnauthorized: "AUTH_UNAUTHORIZED",
	FeatureNotSupported: "FEATURE_NOT_SUPPORTED",
	FieldsBadRequest: "FIELDS_BAD_REQUEST",
	FieldsNotFound: "FIELDS_NOT_FOUND",
	SearchNotFound: "SEARCH_NOT_FOUND",
	SearchBadRequest: "SEARCH_BAD_REQUEST",
	SearchServiceUnavailable: "SEARCH_SERVICE_UNAVAILABLE",
	DatabaseError: "DATABASE_ERROR",
	DatabaseTimeout: "DATABASE_TIMEOUT",
	DatabaseUnavailable: "DATABASE_UNAVAILABLE",
	DatabaseQueryError: "DATABASE_QUERY_ERROR",
	SearchFilterToSqlConversionError: "SEARCH_FILTER_TO_SQL_CONVERSION_ERROR",
	JudgeConversationFormatError: "JUDGE_CONVERSATION_FORMAT_ERROR",
	JudgeMistralApiError: "JUDGE_MISTRAL_API_ERROR",
	JudgeMistralApiTimeout: "JUDGE_MISTRAL_API_TIMEOUT",
	JudgeNameAlreadyExists: "JUDGE_NAME_ALREADY_EXISTS",
	JudgeNotFound: "JUDGE_NOT_FOUND",
	JudgeAlreadyHasNewVersion: "JUDGE_ALREADY_HAS_NEW_VERSION",
	JudgeUsedInCampaignCannotBeUpdated: "JUDGE_USED_IN_CAMPAIGN_CANNOT_BE_UPDATED",
	JudgeDidNotChange: "JUDGE_DID_NOT_CHANGE",
	CampaignNotFound: "CAMPAIGN_NOT_FOUND",
	CampaignNoMatchingEvents: "CAMPAIGN_NO_MATCHING_EVENTS",
	DatasetNotFound: "DATASET_NOT_FOUND",
	DatasetTaskNotFound: "DATASET_TASK_NOT_FOUND",
	DatasetRecordNotFound: "DATASET_RECORD_NOT_FOUND",
	DatasetRecordFormatError: "DATASET_RECORD_FORMAT_ERROR",
	AgentNotFound: "AGENT_NOT_FOUND",
	AgentMistralApiError: "AGENT_MISTRAL_API_ERROR",
	EvaluationNotFound: "EVALUATION_NOT_FOUND",
	EvaluationCurrentlyRunning: "EVALUATION_CURRENTLY_RUNNING",
	EvaluationRecordNotFound: "EVALUATION_RECORD_NOT_FOUND",
	EvaluationRunNotFound: "EVALUATION_RUN_NOT_FOUND",
	EvaluationRunTransitionIsInvalid: "EVALUATION_RUN_TRANSITION_IS_INVALID",
	EvaluationRunTransitionIsRunningAlready: "EVALUATION_RUN_TRANSITION_IS_RUNNING_ALREADY",
	EvaluationRunTransitionError: "EVALUATION_RUN_TRANSITION_ERROR",
	TemplateError: "TEMPLATE_ERROR",
	TemplateSyntaxError: "TEMPLATE_SYNTAX_ERROR",
	ProjectNameAlreadyExists: "PROJECT_NAME_ALREADY_EXISTS",
	EvaluationNameAlreadyExists: "EVALUATION_NAME_ALREADY_EXISTS",
	TracesFilterQueryParseError: "TRACES_FILTER_QUERY_PARSE_ERROR",
	TraceNotFound: "TRACE_NOT_FOUND",
	SpanNotFound: "SPAN_NOT_FOUND"
}), Fm = S({
	message: t(),
	error_code: l(Pm)
}).transform((e) => W(e, { error_code: "errorCode" })), Im = S({
	text: t(),
	confidence: b(),
	start_index: f()
}).transform((e) => W(e, { start_index: "startIndex" })), Lm = S({
	id: t(),
	top_left_x: l(f()),
	top_left_y: l(f()),
	bottom_right_x: l(f()),
	bottom_right_y: l(f()),
	image_base64: l(t()).optional(),
	image_annotation: l(t()).optional()
}).transform((e) => W(e, {
	top_left_x: "topLeftX",
	top_left_y: "topLeftY",
	bottom_right_x: "bottomRightX",
	bottom_right_y: "bottomRightY",
	image_base64: "imageBase64",
	image_annotation: "imageAnnotation"
})), Rm = S({
	word_confidence_scores: v(Im).optional(),
	average_page_confidence_score: b(),
	minimum_page_confidence_score: b()
}).transform((e) => W(e, {
	word_confidence_scores: "wordConfidenceScores",
	average_page_confidence_score: "averagePageConfidenceScore",
	minimum_page_confidence_score: "minimumPageConfidenceScore"
})), zm = S({
	dpi: f(),
	height: f(),
	width: f()
}), Bm = Y({
	Markdown: "markdown",
	Html: "html"
}), Vm = S({
	id: t(),
	content: t(),
	format: Bm,
	word_confidence_scores: l(v(Im)).optional()
}).transform((e) => W(e, { word_confidence_scores: "wordConfidenceScores" })), Hm = S({
	index: f(),
	markdown: t(),
	images: v(Lm),
	tables: v(Vm).optional(),
	hyperlinks: v(t()).optional(),
	header: l(t()).optional(),
	footer: l(t()).optional(),
	dimensions: l(zm),
	confidence_scores: l(Rm).optional()
}).transform((e) => W(e, { confidence_scores: "confidenceScores" })), Um = {
	Markdown: "markdown",
	Html: "html"
}, Wm = {
	Word: "word",
	Page: "page"
};
X([
	co,
	oo,
	go
]), X([t(), v(f())]);
var Gm = _(Um), Km = _(Wm), qm = S({
	model: l(t()),
	document: X([
		co,
		oo,
		go
	]),
	pages: l(X([t(), v(f())])).optional(),
	includeImageBase64: l(d()).optional(),
	imageLimit: l(f()).optional(),
	imageMinSize: l(f()).optional(),
	bboxAnnotationFormat: l(pa).optional(),
	documentAnnotationFormat: l(pa).optional(),
	documentAnnotationPrompt: l(t()).optional(),
	tableFormat: l(Gm).optional(),
	extractHeader: d().optional(),
	extractFooter: d().optional(),
	confidenceScoresGranularity: l(Km).optional()
}).transform((e) => W(e, {
	includeImageBase64: "include_image_base64",
	imageLimit: "image_limit",
	imageMinSize: "image_min_size",
	bboxAnnotationFormat: "bbox_annotation_format",
	documentAnnotationFormat: "document_annotation_format",
	documentAnnotationPrompt: "document_annotation_prompt",
	tableFormat: "table_format",
	extractHeader: "extract_header",
	extractFooter: "extract_footer",
	confidenceScoresGranularity: "confidence_scores_granularity"
})), Jm = S({
	pages_processed: f(),
	doc_size_bytes: l(f()).optional()
}).transform((e) => W(e, {
	pages_processed: "pagesProcessed",
	doc_size_bytes: "docSizeBytes"
})), Ym = S({
	pages: v(Hm),
	model: t(),
	document_annotation: l(t()).optional(),
	usage_info: Jm
}).transform((e) => W(e, {
	document_annotation: "documentAnnotation",
	usage_info: "usageInfo"
})), Xm = S({
	next_cursor: l(t()).optional(),
	page_size: f()
}).transform((e) => W(e, {
	next_cursor: "nextCursor",
	page_size: "pageSize"
})), Zm = S({
	items: v($l),
	pagination: Xm
}), Qm = S({
	start: f(),
	end: f().default(0),
	step: f().default(0)
}), $m = S({
	start: f(),
	end: f().default(0),
	step: f().default(0)
}), eh = S({
	second: v(Qm).optional(),
	minute: v(Qm).optional(),
	hour: v(Qm).optional(),
	day_of_month: v(Qm).optional(),
	month: v(Qm).optional(),
	year: v(Qm).optional(),
	day_of_week: v(Qm).optional(),
	comment: l(t()).optional()
}).transform((e) => W(e, {
	day_of_month: "dayOfMonth",
	day_of_week: "dayOfWeek"
})), th = S({
	second: v($m).optional(),
	minute: v($m).optional(),
	hour: v($m).optional(),
	dayOfMonth: v($m).optional(),
	month: v($m).optional(),
	year: v($m).optional(),
	dayOfWeek: v($m).optional(),
	comment: l(t()).optional()
}).transform((e) => W(e, {
	dayOfMonth: "day_of_month",
	dayOfWeek: "day_of_week"
})), nh = S({
	every: t(),
	offset: l(t()).optional()
}), rh = S({
	every: t(),
	offset: l(t()).optional()
}), ih = {
	One: 1,
	Two: 2,
	Three: 3,
	Four: 4,
	Five: 5,
	Six: 6
}, ah = Di(ih), oh = ki(ih), sh = S({
	catchup_window_seconds: f().default(31536e3),
	overlap: ah.optional(),
	pause_on_failure: d().default(!1)
}).transform((e) => W(e, {
	catchup_window_seconds: "catchupWindowSeconds",
	pause_on_failure: "pauseOnFailure"
})), ch = S({
	catchupWindowSeconds: f().default(31536e3),
	overlap: oh.optional(),
	pauseOnFailure: d().default(!1)
}).transform((e) => W(e, {
	catchupWindowSeconds: "catchup_window_seconds",
	pauseOnFailure: "pause_on_failure"
})), lh = S({
	input: g().optional(),
	calendars: v(th).optional(),
	intervals: v(rh).optional(),
	cronExpressions: v(t()).optional(),
	skip: v(th).optional(),
	startAt: l(y().transform((e) => e.toISOString())).optional(),
	endAt: l(y().transform((e) => e.toISOString())).optional(),
	jitter: l(t()).optional(),
	timeZoneName: l(t()).optional(),
	policy: ch.optional(),
	maxExecutions: l(f()).optional()
}).transform((e) => W(e, {
	cronExpressions: "cron_expressions",
	startAt: "start_at",
	endAt: "end_at",
	timeZoneName: "time_zone_name",
	maxExecutions: "max_executions"
})), uh = S({
	document_id: t(),
	process_status: Ef,
	processing_status: t()
}).transform((e) => W(e, {
	document_id: "documentId",
	process_status: "processStatus",
	processing_status: "processingStatus"
})), dh = S({
	messages: v(Om).optional(),
	cached_tokens: f().default(0),
	audio_tokens: f().default(0)
}).transform((e) => W(e, {
	cached_tokens: "cachedTokens",
	audio_tokens: "audioTokens"
})), fh = S({
	name: t(),
	description: l(t()).optional(),
	input_schema: s(t(), g()),
	output_schema: l(s(t(), g())).optional()
}).transform((e) => W(e, {
	input_schema: "inputSchema",
	output_schema: "outputSchema"
}));
X([Nm, s(t(), g())]);
var ph = S({
	name: t(),
	input: l(X([Nm, s(t(), g())])).optional()
}), mh = S({
	query_name: t(),
	result: g()
}).transform((e) => W(e, { query_name: "queryName" })), hh = _({
	Api: "api",
	Playground: "playground",
	AgentBuilderV1: "agent_builder_v1"
}), gh = S({
	eventId: f(),
	reason: l(t()).optional(),
	excludeSignals: d().default(!1),
	excludeUpdates: d().default(!1)
}).transform((e) => W(e, {
	eventId: "event_id",
	excludeSignals: "exclude_signals",
	excludeUpdates: "exclude_updates"
}));
X([f(), b()]);
var _h = S({ value: X([f(), b()]) }), vh = S({
	input: g(),
	calendars: v(th).optional(),
	intervals: v(rh).optional(),
	cronExpressions: v(t()).optional(),
	skip: v(th).optional(),
	startAt: l(y().transform((e) => e.toISOString())).optional(),
	endAt: l(y().transform((e) => e.toISOString())).optional(),
	jitter: l(t()).optional(),
	timeZoneName: l(t()).optional(),
	policy: ch.optional(),
	maxExecutions: l(f()).optional(),
	scheduleId: l(t()).optional()
}).transform((e) => W(e, {
	cronExpressions: "cron_expressions",
	startAt: "start_at",
	endAt: "end_at",
	timeZoneName: "time_zone_name",
	maxExecutions: "max_executions",
	scheduleId: "schedule_id"
})), yh = S({ scheduled_at: n({ offset: !0 }).transform((e) => new Date(e)) }).transform((e) => W(e, { scheduled_at: "scheduledAt" })), bh = S({
	scheduled_at: n({ offset: !0 }).transform((e) => new Date(e)),
	started_at: n({ offset: !0 }).transform((e) => new Date(e)),
	execution_id: t()
}).transform((e) => W(e, {
	scheduled_at: "scheduledAt",
	started_at: "startedAt",
	execution_id: "executionId"
})), xh = S({
	input: g(),
	calendars: v(eh).optional(),
	intervals: v(nh).optional(),
	cron_expressions: v(t()).optional(),
	skip: v(eh).optional(),
	start_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	end_at: l(n({ offset: !0 }).transform((e) => new Date(e))).optional(),
	jitter: l(t()).optional(),
	time_zone_name: l(t()).optional(),
	policy: sh.optional(),
	schedule_id: t(),
	remaining_executions: l(f()).optional(),
	workflow_name: t(),
	paused: d(),
	note: l(t()).optional(),
	future_executions: v(yh).optional(),
	recent_executions: v(bh).optional()
}).transform((e) => W(e, {
	cron_expressions: "cronExpressions",
	start_at: "startAt",
	end_at: "endAt",
	time_zone_name: "timeZoneName",
	schedule_id: "scheduleId",
	remaining_executions: "remainingExecutions",
	workflow_name: "workflowName",
	future_executions: "futureExecutions",
	recent_executions: "recentExecutions"
})), Sh = S({
	searchParams: zs,
	extraFields: l(v(t())).optional()
}).transform((e) => W(e, {
	searchParams: "search_params",
	extraFields: "extra_fields"
})), Ch = S({ completion_event_ids: v(t()) }).transform((e) => W(e, { completion_event_ids: "completionEventIds" })), wh = S({
	searchParams: zs,
	extraFields: l(v(t())).optional()
}).transform((e) => W(e, {
	searchParams: "search_params",
	extraFields: "extra_fields"
})), Th = S({ completion_events: Vf }).transform((e) => W(e, { completion_events: "completionEvents" })), Eh = S({
	name: t(),
	document_count: l(f())
}).transform((e) => W(e, { document_count: "documentCount" })), Dh = S({
	type: p("vespa"),
	k8s_cluster: t(),
	k8s_namespace: t(),
	vespa_instance_name: t(),
	schemas: v(Eh)
}).transform((e) => W(e, {
	k8s_cluster: "k8sCluster",
	k8s_namespace: "k8sNamespace",
	vespa_instance_name: "vespaInstanceName"
})), Oh = Y({
	Online: "online",
	Offline: "offline"
}), kh = S({
	id: t(),
	name: t(),
	creator_id: t(),
	document_count: f(),
	status: Oh,
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	modified_at: n({ offset: !0 }).transform((e) => new Date(e)),
	index: Dh
}).transform((e) => W(e, {
	creator_id: "creatorId",
	document_count: "documentCount",
	created_at: "createdAt",
	modified_at: "modifiedAt"
})), Ah = Oi({
	Viewer: "Viewer",
	Editor: "Editor"
}), jh = S({
	orgId: l(t()).optional(),
	shareWithUuid: t(),
	shareWithType: Pf
}).transform((e) => W(e, {
	orgId: "org_id",
	shareWithUuid: "share_with_uuid",
	shareWithType: "share_with_type"
})), Mh = S({
	orgId: l(t()).optional(),
	level: Ah,
	shareWithUuid: t(),
	shareWithType: Pf
}).transform((e) => W(e, {
	orgId: "org_id",
	shareWithUuid: "share_with_uuid",
	shareWithType: "share_with_type"
})), Nh = S({
	name: t(),
	description: l(t()).optional(),
	input_schema: s(t(), g())
}).transform((e) => W(e, { input_schema: "inputSchema" })), Ph = S({
	b64payload: t(),
	encodingOptions: v(Mi).optional(),
	empty: d().default(!1)
}).catchall(g()).transform((e) => ({ ...W(e, { encodingOptions: "encoding_options" }) }));
X([h(() => Ph), s(t(), g())]);
var Fh = S({
	name: t(),
	input: l(X([h(() => Ph), s(t(), g())])).optional()
}), Ih = S({ message: t().default("Signal accepted") }), Lh = S({ searchExpression: l(t()).optional() }).transform((e) => W(e, { searchExpression: "search_expression" })), Rh = S({ searchExpression: l(t()).optional() }).transform((e) => W(e, { searchExpression: "search_expression" })), zh = _({
	Pcm: "pcm",
	Wav: "wav",
	Mp3: "mp3",
	Flac: "flac",
	Opus: "opus"
}), Bh = S({
	model: l(t()).optional(),
	metadata: l(s(t(), g())).optional(),
	stream: d().default(!1),
	voiceId: l(t()).optional(),
	refAudio: l(t()).optional(),
	input: t(),
	responseFormat: zh.optional()
}).catchall(g()).transform((e) => ({ ...W(e, {
	voiceId: "voice_id",
	refAudio: "ref_audio",
	responseFormat: "response_format"
}) })), Vh = S({
	type: p("speech.audio.delta"),
	audio_data: t()
}).transform((e) => W(e, { audio_data: "audioData" })), Hh = S({
	prompt_audio_seconds: l(f()).optional(),
	prompt_tokens: f().default(0),
	total_tokens: f().default(0),
	completion_tokens: l(f()).optional(),
	request_count: l(f()).optional(),
	prompt_tokens_details: l(dh).optional(),
	completion_tokens_details: l(Zc).optional(),
	prompt_token_details: l(dh).optional(),
	num_cached_tokens: l(f()).optional()
}).transform((e) => W(e, {
	prompt_audio_seconds: "promptAudioSeconds",
	prompt_tokens: "promptTokens",
	total_tokens: "totalTokens",
	completion_tokens: "completionTokens",
	request_count: "requestCount",
	prompt_tokens_details: "promptTokensDetails",
	completion_tokens_details: "completionTokensDetails",
	prompt_token_details: "promptTokenDetails",
	num_cached_tokens: "numCachedTokens"
})), Uh = S({
	type: p("speech.audio.done"),
	usage: Hh
}), Wh = Y({
	SpeechAudioDelta: "speech.audio.delta",
	SpeechAudioDone: "speech.audio.done"
}), Gh = S({ error: t() }), Kh = S({
	namespace: t(),
	workflow_name: t(),
	workflow_exec_id: t(),
	parent_workflow_exec_id: l(t()).optional(),
	root_workflow_exec_id: l(t()).optional()
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	workflow_exec_id: "workflowExecId",
	parent_workflow_exec_id: "parentWorkflowExecId",
	root_workflow_exec_id: "rootWorkflowExecId"
}));
X([
	_m,
	dm,
	hm,
	lm,
	pm,
	xm,
	ym,
	lf,
	sf,
	Zd,
	$d,
	df,
	Yd,
	Hi,
	Fi,
	Bi,
	Ri
]);
var qh = S({
	stream: t(),
	timestamp: n({ offset: !0 }).transform((e) => new Date(e)).optional(),
	data: X([
		_m,
		dm,
		hm,
		lm,
		pm,
		xm,
		ym,
		lf,
		sf,
		Zd,
		$d,
		df,
		Yd,
		Hi,
		Fi,
		Bi,
		Ri
	]),
	workflow_context: Kh,
	metadata: s(t(), g()).optional(),
	broker_sequence: f()
}).transform((e) => W(e, {
	workflow_context: "workflowContext",
	broker_sequence: "brokerSequence"
})), Jh = S({
	stringValue: l(t()).optional(),
	intValue: l(t()).optional(),
	boolValue: l(d()).optional()
}), Yh = S({ values: v(Jh).optional() }), Xh = S({ arrayValue: Yh }), Zh = S({ boolValue: d() }), Qh = S({ intValue: t() }), $h = S({ stringValue: t() });
X([
	$h,
	Qh,
	Zh,
	Xh
]);
var eg = S({
	key: t(),
	value: X([
		$h,
		Qh,
		Zh,
		Xh
	])
}), tg = S({ attributes: v(eg).optional() }), ng = S({ name: t() }), rg = S({
	name: t(),
	timeUnixNano: t(),
	attributes: v(eg).optional()
}), ig = Y({
	SpanKindInternal: "SPAN_KIND_INTERNAL",
	SpanKindServer: "SPAN_KIND_SERVER",
	SpanKindClient: "SPAN_KIND_CLIENT"
}), ag = S({
	traceId: t(),
	spanId: t(),
	parentSpanId: l(t()).optional(),
	name: t(),
	kind: ig,
	startTimeUnixNano: t(),
	endTimeUnixNano: t(),
	attributes: v(eg).optional(),
	events: v(rg).optional()
}), og = S({
	scope: ng,
	spans: v(ag).optional()
}), sg = S({
	resource: tg,
	scopeSpans: v(og).optional()
}), cg = S({ batches: v(sg).optional() });
X([f(), b()]), X([f(), X([f(), b()])]);
var lg = S({ value: v(v(X([f(), X([f(), b()])]))) }), ug = S({ searchExpression: l(t()).optional() }).transform((e) => W(e, { searchExpression: "search_expression" })), dg = S({
	type: p("transcription_segment").default("transcription_segment"),
	text: t(),
	start: b(),
	end: b(),
	score: l(b()).optional(),
	speaker_id: l(t()).optional()
}).catchall(g()).transform((e) => W(e, { speaker_id: "speakerId" })), fg = S({
	type: p("transcription_segment").default("transcription_segment"),
	text: t(),
	start: b(),
	end: b(),
	score: l(b()).optional(),
	speakerId: l(t()).optional()
}).catchall(g()).transform((e) => ({ ...W(e, { speakerId: "speaker_id" }) })), pg = S({
	model: t(),
	text: t(),
	segments: v(dg).optional(),
	usage: ic,
	language: l(t())
}).catchall(g()), mg = S({
	model: t(),
	text: t(),
	segments: v(dg).optional(),
	usage: ic,
	type: p("transcription.done"),
	language: l(t())
}).catchall(g());
S({
	model: t(),
	text: t(),
	segments: v(fg).optional(),
	usage: ac,
	type: p("transcription.done"),
	language: l(t())
}).catchall(g());
var hg = Y({
	TranscriptionLanguage: "transcription.language",
	TranscriptionSegment: "transcription.segment",
	TranscriptionTextDelta: "transcription.text.delta",
	TranscriptionDone: "transcription.done"
}), gg = S({
	type: p("transcription.language"),
	audio_language: t()
}).catchall(g()).transform((e) => W(e, { audio_language: "audioLanguage" }));
S({
	type: p("transcription.language"),
	audioLanguage: t()
}).catchall(g()).transform((e) => ({ ...W(e, { audioLanguage: "audio_language" }) }));
//#endregion
//#region node_modules/@mistralai/mistralai/esm/models/components/transcriptionstreamsegmentdelta.js
var _g = S({
	type: p("transcription.segment"),
	text: t(),
	start: b(),
	end: b(),
	speaker_id: l(t()).optional()
}).catchall(g()).transform((e) => W(e, { speaker_id: "speakerId" })), vg = S({
	type: p("transcription.text.delta"),
	text: t()
}).catchall(g());
S({
	type: p("transcription.text.delta"),
	text: t()
}).catchall(g()), Gi("type", {
	"transcription.done": mg,
	"transcription.language": gg,
	"transcription.segment": _g,
	"transcription.text.delta": vg
});
var yg = S({
	event: hg,
	data: t().transform((e, t) => {
		try {
			return JSON.parse(e);
		} catch (n) {
			return t.addIssue({
				input: e,
				code: "custom",
				message: `malformed json: ${n}`
			}), o;
		}
	}).pipe(Gi("type", {
		"transcription.done": mg,
		"transcription.language": gg,
		"transcription.segment": _g,
		"transcription.text.delta": vg
	}))
}), bg = S({
	id: t(),
	object: p("model").default("model"),
	archived: d().default(!1)
});
x([
	Yi,
	wa,
	Ea,
	Aa,
	Ga,
	Ya,
	qa
]);
var xg = S({
	instructions: l(t()).optional(),
	tools: v(x([
		Yi,
		wa,
		Ea,
		Aa,
		Ga,
		Ya,
		qa
	])).optional(),
	completionArgs: va.optional(),
	guardrails: l(v(Ua)).optional(),
	model: l(t()).optional(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	handoffs: l(v(t())).optional(),
	deploymentChat: l(d()).optional(),
	metadata: l(s(t(), g())).optional(),
	versionMessage: l(t()).optional()
}).transform((e) => W(e, {
	completionArgs: "completion_args",
	deploymentChat: "deployment_chat",
	versionMessage: "version_message"
})), Sg = S({
	title: l(t()).optional(),
	name: l(t()).optional(),
	description: l(t()).optional(),
	iconUrl: l(t()).optional(),
	systemPrompt: l(t()).optional(),
	connectionConfig: l(s(t(), g())).optional(),
	connectionSecrets: l(s(t(), g())).optional(),
	protocol: p("mcp").default("mcp"),
	server: l(t()).optional(),
	headers: l(s(t(), g())).optional(),
	authData: l(rs).optional()
}).transform((e) => W(e, {
	iconUrl: "icon_url",
	systemPrompt: "system_prompt",
	connectionConfig: "connection_config",
	connectionSecrets: "connection_secrets",
	authData: "auth_data"
})), Cg = S({ payload: id }), wg = S({ properties: s(t(), g()) }), Tg = S({
	name: l(t()).optional(),
	description: l(t()).optional()
}), Eg = S({
	name: t(),
	description: l(t()).optional(),
	input_schema: s(t(), g()),
	output_schema: l(s(t(), g())).optional()
}).transform((e) => W(e, {
	input_schema: "inputSchema",
	output_schema: "outputSchema"
}));
X([
	d(),
	t(),
	f(),
	b(),
	y().transform((e) => e.toISOString()),
	v(t()),
	v(f()),
	v(b()),
	v(d())
]);
var Dg = S({
	name: t().optional(),
	attributes: l(s(t(), X([
		d(),
		t(),
		f(),
		b(),
		y().transform((e) => e.toISOString()),
		v(t()),
		v(f()),
		v(b()),
		v(d())
	]))).optional(),
	expiresAt: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, { expiresAt: "expires_at" }));
X([Nm, s(t(), g())]);
var Og = S({
	name: t(),
	input: l(X([Nm, s(t(), g())])).optional()
});
x([Us, Gs]);
var kg = S({
	name: t(),
	description: t(),
	modelName: t(),
	output: x([Us, Gs]),
	instructions: t(),
	tools: v(t())
}).transform((e) => W(e, { modelName: "model_name" })), Ag = S({
	name: t().optional(),
	description: l(t()).optional()
}), jg = S({
	name: l(t()).optional(),
	description: l(t()).optional()
}), Mg = S({
	executionTime: y().transform((e) => e.toISOString()),
	chunksCount: f()
}).transform((e) => W(e, {
	executionTime: "execution_time",
	chunksCount: "chunks_count"
})), Ng = S({
	update_name: t(),
	result: g()
}).transform((e) => W(e, { update_name: "updateName" }));
X([t(), f()]);
var Pg = S({}), Fg = S({
	loc: v(X([t(), f()])),
	msg: t(),
	type: t(),
	input: g().optional(),
	ctx: h(() => Pg).optional()
}), Ig = S({
	name: t(),
	slug: l(t()).optional(),
	languages: v(t()).optional(),
	gender: l(t()).optional(),
	age: l(f()).optional(),
	tags: l(v(t())).optional(),
	color: l(t()).optional(),
	description: l(t()).optional(),
	retentionNotice: f().default(30),
	sampleAudio: t(),
	sampleFilename: l(t()).optional()
}).transform((e) => W(e, {
	retentionNotice: "retention_notice",
	sampleAudio: "sample_audio",
	sampleFilename: "sample_filename"
})), Lg = S({
	name: t(),
	slug: l(t()).optional(),
	languages: v(t()).optional(),
	gender: l(t()).optional(),
	age: l(f()).optional(),
	tags: l(v(t())).optional(),
	color: l(t()).optional(),
	description: l(t()).optional(),
	retention_notice: f().default(30),
	id: t(),
	created_at: n({ offset: !0 }).transform((e) => new Date(e)),
	user_id: l(t()),
	trimmed_seconds: l(b()).optional()
}).transform((e) => W(e, {
	retention_notice: "retentionNotice",
	created_at: "createdAt",
	user_id: "userId",
	trimmed_seconds: "trimmedSeconds"
})), Rg = S({
	items: v(Lg),
	total: f(),
	page: f(),
	page_size: f(),
	total_pages: f()
}).transform((e) => W(e, {
	page_size: "pageSize",
	total_pages: "totalPages"
})), zg = S({
	name: l(t()).optional(),
	languages: l(v(t())).optional(),
	gender: l(t()).optional(),
	age: l(f()).optional(),
	tags: l(v(t())).optional(),
	description: l(t()).optional()
}), Bg = _({ Code: "code" }), Vg = S({
	id: t(),
	name: t(),
	display_name: t(),
	type: Bg,
	description: l(t()).optional(),
	customer_id: t(),
	workspace_id: t(),
	shared_namespace: l(t()).optional(),
	available_in_chat_assistant: d().default(!1),
	is_technical: d().default(!1),
	archived: d().default(!1),
	tags: v(t()).optional()
}).transform((e) => W(e, {
	display_name: "displayName",
	customer_id: "customerId",
	workspace_id: "workspaceId",
	shared_namespace: "sharedNamespace",
	available_in_chat_assistant: "availableInChatAssistant",
	is_technical: "isTechnical"
})), Hg = S({ workflow: Vg }), Ug = S({ shared_namespace: l(t()).optional() }).transform((e) => W(e, { shared_namespace: "sharedNamespace" })), Wg = S({
	id: t(),
	name: t(),
	display_name: t(),
	description: l(t()).optional(),
	metadata: Ug.optional(),
	archived: d(),
	tags: v(t()).optional()
}).transform((e) => W(e, { display_name: "displayName" })), Gg = S({ workflowIds: v(t()) }).transform((e) => W(e, { workflowIds: "workflow_ids" })), Kg = S({
	workflow_id: t(),
	workflow: l(Vg).optional(),
	message: t()
}).transform((e) => W(e, { workflow_id: "workflowId" })), qg = S({
	archived: v(Vg),
	errored: v(Kg).optional()
}), Jg = S({ workflowIds: v(t()) }).transform((e) => W(e, { workflowIds: "workflow_ids" })), Yg = S({
	unarchived: v(Vg),
	errored: v(Kg).optional()
}), Xg = S({
	input_schema: s(t(), g()),
	output_schema: l(s(t(), g())).optional(),
	signals: v(Nh).optional(),
	queries: v(fh).optional(),
	updates: v(Eg).optional(),
	enforce_determinism: d().default(!1),
	on_behalf_of: d().default(!1),
	execution_timeout: b().optional(),
	plugin_metadata: l(s(t(), g())).optional()
}).transform((e) => W(e, {
	input_schema: "inputSchema",
	output_schema: "outputSchema",
	enforce_determinism: "enforceDeterminism",
	on_behalf_of: "onBehalfOf",
	execution_timeout: "executionTimeout",
	plugin_metadata: "pluginMetadata"
})), Zg = _({
	WorkflowExecutionStarted: "WORKFLOW_EXECUTION_STARTED",
	WorkflowExecutionCompleted: "WORKFLOW_EXECUTION_COMPLETED",
	WorkflowExecutionFailed: "WORKFLOW_EXECUTION_FAILED",
	WorkflowExecutionCanceled: "WORKFLOW_EXECUTION_CANCELED",
	WorkflowExecutionContinuedAsNew: "WORKFLOW_EXECUTION_CONTINUED_AS_NEW",
	WorkflowTaskTimedOut: "WORKFLOW_TASK_TIMED_OUT",
	WorkflowTaskFailed: "WORKFLOW_TASK_FAILED",
	CustomTaskStarted: "CUSTOM_TASK_STARTED",
	CustomTaskInProgress: "CUSTOM_TASK_IN_PROGRESS",
	CustomTaskCompleted: "CUSTOM_TASK_COMPLETED",
	CustomTaskFailed: "CUSTOM_TASK_FAILED",
	CustomTaskTimedOut: "CUSTOM_TASK_TIMED_OUT",
	CustomTaskCanceled: "CUSTOM_TASK_CANCELED",
	ActivityTaskStarted: "ACTIVITY_TASK_STARTED",
	ActivityTaskCompleted: "ACTIVITY_TASK_COMPLETED",
	ActivityTaskRetrying: "ACTIVITY_TASK_RETRYING",
	ActivityTaskFailed: "ACTIVITY_TASK_FAILED"
}), Qg = {
	Running: "RUNNING",
	Completed: "COMPLETED",
	Failed: "FAILED",
	Canceled: "CANCELED",
	Terminated: "TERMINATED",
	ContinuedAsNew: "CONTINUED_AS_NEW",
	TimedOut: "TIMED_OUT",
	RetryingAfterError: "RETRYING_AFTER_ERROR"
}, $g = Y(Qg), e_ = Oi(Qg), t_ = S({
	workflow_name: t(),
	execution_id: t(),
	parent_execution_id: l(t()).optional(),
	root_execution_id: t(),
	run_id: l(t()).optional(),
	status: l($g),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: l(n({ offset: !0 }).transform((e) => new Date(e))),
	total_duration_ms: l(f()).optional()
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	execution_id: "executionId",
	parent_execution_id: "parentExecutionId",
	root_execution_id: "rootExecutionId",
	run_id: "runId",
	start_time: "startTime",
	end_time: "endTime",
	total_duration_ms: "totalDurationMs"
})), n_ = S({
	executions: v(t_),
	next_page_token: l(t()).optional()
}).transform((e) => W(e, { next_page_token: "nextPageToken" })), r_ = X([
	t(),
	f(),
	b(),
	d(),
	v(g())
]), i_ = S({
	type: Lf.optional(),
	name: t(),
	id: t(),
	timestamp_unix_nano: f(),
	attributes: s(t(), l(r_)),
	internal: d().default(!1),
	status: Ff.optional(),
	start_time_unix_ms: f(),
	end_time_unix_ms: l(f()).optional(),
	error: l(t()).optional()
}).transform((e) => W(e, {
	timestamp_unix_nano: "timestampUnixNano",
	start_time_unix_ms: "startTimeUnixMs",
	end_time_unix_ms: "endTimeUnixMs"
})), a_ = S({
	executionId: l(t()).optional(),
	input: l(g()).optional(),
	waitForResult: d().default(!1),
	timeoutSeconds: l(b()).optional(),
	customTracingAttributes: l(s(t(), t())).optional(),
	extensions: l(s(t(), g())).optional(),
	taskQueue: l(t()).optional(),
	deploymentName: l(t()).optional()
}).transform((e) => W(e, {
	executionId: "execution_id",
	waitForResult: "wait_for_result",
	timeoutSeconds: "timeout_seconds",
	customTracingAttributes: "custom_tracing_attributes",
	taskQueue: "task_queue",
	deploymentName: "deployment_name"
})), o_ = S({
	workflow_name: t(),
	execution_id: t(),
	parent_execution_id: l(t()).optional(),
	root_execution_id: t(),
	run_id: l(t()).optional(),
	status: l($g),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: l(n({ offset: !0 }).transform((e) => new Date(e))),
	total_duration_ms: l(f()).optional(),
	result: l(g())
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	execution_id: "executionId",
	parent_execution_id: "parentExecutionId",
	root_execution_id: "rootExecutionId",
	run_id: "runId",
	start_time: "startTime",
	end_time: "endTime",
	total_duration_ms: "totalDurationMs"
})), s_ = S({
	workflow_name: t(),
	execution_id: t(),
	result: g()
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	execution_id: "executionId"
})), c_ = S({
	type: Lf.optional(),
	name: t(),
	id: t(),
	timestamp_unix_nano: f(),
	attributes: s(t(), l(r_)),
	internal: d().default(!1)
}).transform((e) => W(e, { timestamp_unix_nano: "timestampUnixNano" }));
X([i_, c_]);
var l_ = S({
	workflow_name: t(),
	execution_id: t(),
	parent_execution_id: l(t()).optional(),
	root_execution_id: t(),
	run_id: l(t()).optional(),
	status: l($g),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: l(n({ offset: !0 }).transform((e) => new Date(e))),
	total_duration_ms: l(f()).optional(),
	result: l(g()),
	events: v(X([i_, c_])).optional()
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	execution_id: "executionId",
	parent_execution_id: "parentExecutionId",
	root_execution_id: "rootExecutionId",
	run_id: "runId",
	start_time: "startTime",
	end_time: "endTime",
	total_duration_ms: "totalDurationMs"
})), u_ = S({
	workflow_name: t(),
	execution_id: t(),
	parent_execution_id: l(t()).optional(),
	root_execution_id: t(),
	run_id: l(t()).optional(),
	status: l($g),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: l(n({ offset: !0 }).transform((e) => new Date(e))),
	total_duration_ms: l(f()).optional(),
	result: l(g()),
	data_source: t(),
	otel_trace_id: l(t()).optional(),
	otel_trace_data: l(cg).optional()
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	execution_id: "executionId",
	parent_execution_id: "parentExecutionId",
	root_execution_id: "rootExecutionId",
	run_id: "runId",
	start_time: "startTime",
	end_time: "endTime",
	total_duration_ms: "totalDurationMs",
	data_source: "dataSource",
	otel_trace_id: "otelTraceId",
	otel_trace_data: "otelTraceData"
})), d_ = S({
	span_id: t(),
	name: t(),
	start_time_unix_nano: f(),
	end_time_unix_nano: l(f()),
	attributes: s(t(), l(r_)),
	events: v(c_),
	children: v(h(() => d_)).optional()
}).transform((e) => W(e, {
	span_id: "spanId",
	start_time_unix_nano: "startTimeUnixNano",
	end_time_unix_nano: "endTimeUnixNano"
})), f_ = S({
	workflow_name: t(),
	execution_id: t(),
	parent_execution_id: l(t()).optional(),
	root_execution_id: t(),
	run_id: l(t()).optional(),
	status: l($g),
	start_time: n({ offset: !0 }).transform((e) => new Date(e)),
	end_time: l(n({ offset: !0 }).transform((e) => new Date(e))),
	total_duration_ms: l(f()).optional(),
	result: l(g()),
	span_tree: l(d_).optional()
}).transform((e) => W(e, {
	workflow_name: "workflowName",
	execution_id: "executionId",
	parent_execution_id: "parentExecutionId",
	root_execution_id: "rootExecutionId",
	run_id: "runId",
	start_time: "startTime",
	end_time: "endTime",
	total_duration_ms: "totalDurationMs",
	span_tree: "spanTree"
})), p_ = S({
	id: t(),
	name: t(),
	display_name: t(),
	type: Bg,
	description: l(t()).optional(),
	customer_id: t(),
	workspace_id: t(),
	shared_namespace: l(t()).optional(),
	available_in_chat_assistant: d().default(!1),
	is_technical: d().default(!1),
	archived: d().default(!1),
	tags: v(t()).optional(),
	active: d()
}).transform((e) => W(e, {
	display_name: "displayName",
	customer_id: "customerId",
	workspace_id: "workspaceId",
	shared_namespace: "sharedNamespace",
	available_in_chat_assistant: "availableInChatAssistant",
	is_technical: "isTechnical"
})), m_ = S({ workflow: p_ }), h_ = S({
	workflows: v(Wg),
	next_cursor: l(t())
}).transform((e) => W(e, { next_cursor: "nextCursor" })), g_ = S({
	execution_count: _h,
	success_count: _h,
	error_count: _h,
	average_latency_ms: _h,
	latency_over_time: lg,
	retry_rate: _h
}).transform((e) => W(e, {
	execution_count: "executionCount",
	success_count: "successCount",
	error_count: "errorCount",
	average_latency_ms: "averageLatencyMs",
	latency_over_time: "latencyOverTime",
	retry_rate: "retryRate"
})), __ = S({
	id: t(),
	deployment_id: l(t()).optional(),
	task_queue: l(t()).optional(),
	definition: Xg,
	workflow_id: t(),
	workflow: l(Vg).optional(),
	compatible_with_chat_assistant: d().default(!1)
}).transform((e) => W(e, {
	deployment_id: "deploymentId",
	task_queue: "taskQueue",
	workflow_id: "workflowId",
	compatible_with_chat_assistant: "compatibleWithChatAssistant"
})), v_ = S({
	id: t(),
	deployment_id: l(t()).optional(),
	task_queue: l(t()).optional(),
	definition: Xg,
	workflow_id: t(),
	workflow: l(Vg).optional(),
	compatible_with_chat_assistant: d().default(!1),
	active: d()
}).transform((e) => W(e, {
	deployment_id: "deploymentId",
	task_queue: "taskQueue",
	workflow_id: "workflowId",
	compatible_with_chat_assistant: "compatibleWithChatAssistant"
})), y_ = S({
	workflow_registration: v_,
	workflow_version: v_
}).transform((e) => W(e, {
	workflow_registration: "workflowRegistration",
	workflow_version: "workflowVersion"
})), b_ = S({
	workflow_registrations: v(__),
	next_cursor: l(t()),
	workflow_versions: v(__)
}).transform((e) => W(e, {
	workflow_registrations: "workflowRegistrations",
	next_cursor: "nextCursor",
	workflow_versions: "workflowVersions"
})), x_ = S({
	schedules: v(xh),
	next_page_token: l(t()).optional()
}).transform((e) => W(e, { next_page_token: "nextPageToken" })), S_ = S({ note: l(t()).optional() }), C_ = S({
	schedule: vh,
	workflowRegistrationId: l(t()).optional(),
	workflowVersionId: l(t()).optional(),
	workflowIdentifier: l(t()).optional(),
	workflowTaskQueue: l(t()).optional(),
	scheduleId: l(t()).optional(),
	deploymentName: l(t()).optional()
}).transform((e) => W(e, {
	workflowRegistrationId: "workflow_registration_id",
	workflowVersionId: "workflow_version_id",
	workflowIdentifier: "workflow_identifier",
	workflowTaskQueue: "workflow_task_queue",
	scheduleId: "schedule_id",
	deploymentName: "deployment_name"
})), w_ = S({ schedule_id: t() }).transform((e) => W(e, { schedule_id: "scheduleId" })), T_ = S({ overlap: l(oh).optional() }), E_ = S({ schedule: lh }), D_ = S({ workflow: Vg }), O_ = S({
	displayName: l(t()).optional(),
	description: l(t()).optional(),
	availableInChatAssistant: l(d()).optional(),
	tags: l(v(t())).optional()
}).transform((e) => W(e, {
	displayName: "display_name",
	availableInChatAssistant: "available_in_chat_assistant"
})), k_ = S({ workflow: Vg }), A_ = class extends oi {
	detail;
	data$;
	constructor(e, t) {
		let n = "message" in e && typeof e.message == "string" ? e.message : `API error occurred: ${JSON.stringify(e)}`;
		super(n, t), this.data$ = e, e.detail != null && (this.detail = e.detail), this.name = "HTTPValidationError";
	}
}, Z = S({
	detail: v(Fg).optional(),
	request$: m((e) => e instanceof Request),
	response$: m((e) => e instanceof Response),
	body$: t()
}).transform((e) => new A_(e, {
	request: e.request$,
	response: e.response$,
	body: e.body$
})), j_ = class extends oi {
	detail;
	data$;
	constructor(e, t) {
		let n = e.detail?.message || `API error occurred: ${JSON.stringify(e)}`;
		super(n, t), this.data$ = e, this.detail = e.detail, this.name = "ObservabilityError";
	}
}, Q = S({
	detail: Fm,
	request$: m((e) => e instanceof Request),
	response$: m((e) => e instanceof Response),
	body$: t()
}).transform((e) => new j_(e, {
	request: e.request$,
	response: e.response$,
	body: e.body$
})), $ = class {
	#e;
	#t;
	[Symbol.toStringTag] = "APIPromise";
	constructor(e) {
		this.#e = e instanceof Promise ? e : Promise.resolve(e), this.#t = e instanceof Promise ? null : Promise.resolve(e[0]);
	}
	#n() {
		return this.#t ??= this.#e.then(([e]) => e);
	}
	then(e, t) {
		return this.#e.then(e ? ([t]) => e(t) : void 0, t);
	}
	catch(e) {
		return this.#n().catch(e);
	}
	finally(e) {
		return this.#n().finally(e);
	}
	$inspect() {
		return this.#e;
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/agentsComplete.js
function M_(e, t, n) {
	return new $(N_(e, t, n));
}
async function N_(e, t, n) {
	let r = K(t, (e) => Wo.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/agents/completions")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_completion_v1_agents_completions_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, oc), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/lib/event-streams.js
var P_ = class extends ReadableStream {
	constructor(e, t, n) {
		let r = e.getReader(), i = /* @__PURE__ */ new Uint8Array(), a = { eventId: void 0 }, o = n?.dataRequired ?? !0;
		super({
			async pull(e) {
				try {
					for (;;) {
						let n = z_(i);
						if (!n) {
							let t = await r.read();
							if (t.done) return e.close();
							i = F_(i, t.value);
							continue;
						}
						let s = i.slice(0, n.index);
						i = i.slice(n.index + n.length);
						let c = B_(s, t, a, o);
						if (c && !c.done) return e.enqueue(c.value);
						if (c?.done) return await r.cancel("done"), e.close();
					}
				} catch (t) {
					e.error(t), await r.cancel(t);
				}
			},
			cancel: (e) => r.cancel(e)
		});
	}
	[Symbol.asyncIterator]() {
		let e = ReadableStream.prototype[Symbol.asyncIterator];
		if (typeof e == "function") return e.call(this);
		let t = this.getReader();
		return {
			next: async () => {
				let e = await t.read();
				return e.done ? (t.releaseLock(), {
					done: !0,
					value: void 0
				}) : {
					done: !1,
					value: e.value
				};
			},
			throw: async (e) => (await t.cancel(e), t.releaseLock(), {
				done: !0,
				value: void 0
			}),
			return: async () => (await t.cancel("done"), t.releaseLock(), {
				done: !0,
				value: void 0
			}),
			[Symbol.asyncIterator]() {
				return this;
			}
		};
	}
};
function F_(e, t) {
	let n = new Uint8Array(e.length + t.length);
	return n.set(e, 0), n.set(t, e.length), n;
}
var I_ = 13, L_ = 10, R_ = [
	[
		I_,
		L_,
		I_,
		L_
	],
	[
		I_,
		L_,
		I_
	],
	[
		I_,
		L_,
		L_
	],
	[
		I_,
		I_,
		L_
	],
	[
		L_,
		I_,
		L_
	],
	[I_, I_],
	[L_, I_],
	[L_, L_]
];
function z_(e) {
	let t = e.length;
	for (let n = 0; n < t; n++) if (e[n] === I_ || e[n] === L_) for (let r of R_) {
		if (n + r.length > t) continue;
		let i = !0;
		for (let t = 0; t < r.length; t++) if (e[n + t] !== r[t]) {
			i = !1;
			break;
		}
		if (i) return {
			index: n,
			length: r.length
		};
	}
	return null;
}
function B_(e, t, n, r) {
	let i = new TextDecoder().decode(e).split(/\r\n|\r|\n/), a = [], o = {}, s = !0;
	for (let e of i) {
		if (!e || e.startsWith(":")) continue;
		s = !1;
		let t = e.indexOf(":"), r = e, i = "";
		t > 0 && (r = e.slice(0, t), i = e[t + 1] === " " ? e.slice(t + 2) : e.slice(t + 1)), r === "data" ? a.push(i) : r === "event" ? o.event = i : r === "id" && !i.includes("\0") ? n.eventId = i : r === "retry" && /^\d+$/.test(i) && (o.retry = Number(i));
	}
	if (!s) {
		if (o.id = n.eventId, a.length) o.data = a.join("\n");
		else if (r) return;
		return t(o);
	}
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/agentsStream.js
function V_(e, t, n) {
	return new $(H_(e, t, n));
}
async function H_(e, t, n) {
	let r = K(t, (e) => Go.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/agents/completions#stream")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "text/event-stream"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "stream_agents",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, g = { HttpMeta: {
		Response: h,
		Request: f
	} }, [_] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => e.data === "[DONE]" ? {
		done: !0,
		value: void 0
	} : {
		done: !1,
		value: Hc.parse(e)
	}))), B(422, Z), H("4XX"), H("5XX"))(h, f, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/agents.js
var U_ = class extends z {
	async complete(e, t) {
		return P(M_(this, e, t));
	}
	async stream(e, t) {
		return P(V_(this, e, t));
	}
}, W_ = S({
	agentId: t(),
	alias: t(),
	version: f()
}).transform((e) => W(e, { agentId: "agent_id" })), G_ = S({ agentId: t() }).transform((e) => W(e, { agentId: "agent_id" })), K_ = S({
	agentId: t(),
	alias: t()
}).transform((e) => W(e, { agentId: "agent_id" }));
X([f(), t()]);
var q_ = S({
	agentId: t(),
	agentVersion: l(X([f(), t()])).optional()
}).transform((e) => W(e, {
	agentId: "agent_id",
	agentVersion: "agent_version"
})), J_ = S({
	agentId: t(),
	version: t()
}).transform((e) => W(e, { agentId: "agent_id" })), Y_ = S({
	page: f().default(0),
	pageSize: f().default(20),
	deploymentChat: l(d()).optional(),
	sources: l(v(hh)).optional(),
	name: l(t()).optional(),
	search: l(t()).optional(),
	id: l(t()).optional(),
	metadata: l(s(t(), g())).optional()
}).transform((e) => W(e, {
	pageSize: "page_size",
	deploymentChat: "deployment_chat"
})), X_ = S({ agentId: t() }).transform((e) => W(e, { agentId: "agent_id" })), Z_ = S({
	agentId: t(),
	page: f().default(0),
	pageSize: f().default(20)
}).transform((e) => W(e, {
	agentId: "agent_id",
	pageSize: "page_size"
})), Q_ = S({
	agentId: t(),
	updateAgentRequest: xg
}).transform((e) => W(e, {
	agentId: "agent_id",
	updateAgentRequest: "UpdateAgentRequest"
})), $_ = S({
	agentId: t(),
	version: f()
}).transform((e) => W(e, { agentId: "agent_id" })), ev = S({
	conversationId: t(),
	conversationAppendRequest: Ru
}).transform((e) => W(e, {
	conversationId: "conversation_id",
	conversationAppendRequest: "ConversationAppendRequest"
})), tv = S({
	conversationId: t(),
	conversationAppendStreamRequest: Bu
}).transform((e) => W(e, {
	conversationId: "conversation_id",
	conversationAppendStreamRequest: "ConversationAppendStreamRequest"
})), nv = S({ conversationId: t() }).transform((e) => W(e, { conversationId: "conversation_id" })), rv = S({ conversationId: t() }).transform((e) => W(e, { conversationId: "conversation_id" })), iv = X([km, Qa]), av = S({ conversationId: t() }).transform((e) => W(e, { conversationId: "conversation_id" })), ov = S({
	page: f().default(0),
	pageSize: f().default(100),
	metadata: l(s(t(), g())).optional()
}).transform((e) => W(e, { pageSize: "page_size" })), sv = X([km, Qa]), cv = S({ conversationId: t() }).transform((e) => W(e, { conversationId: "conversation_id" })), lv = S({
	conversationId: t(),
	conversationRestartRequest: ld
}).transform((e) => W(e, {
	conversationId: "conversation_id",
	conversationRestartRequest: "ConversationRestartRequest"
})), uv = S({
	conversationId: t(),
	conversationRestartStreamRequest: dd
}).transform((e) => W(e, {
	conversationId: "conversation_id",
	conversationRestartStreamRequest: "ConversationRestartStreamRequest"
})), dv = S({ workflowIdentifier: t() }).transform((e) => W(e, { workflowIdentifier: "workflow_identifier" })), fv = S({ executionId: t() }).transform((e) => W(e, { executionId: "execution_id" })), pv = S({
	connectorId: t(),
	toolExecutionConfiguration: l(ll).optional()
}).transform((e) => W(e, {
	connectorId: "connector_id",
	toolExecutionConfiguration: "ToolExecutionConfiguration"
})), mv = S({
	connectorId: t(),
	toolExecutionConfiguration: l(ll).optional()
}).transform((e) => W(e, {
	connectorId: "connector_id",
	toolExecutionConfiguration: "ToolExecutionConfiguration"
})), hv = S({
	connectorId: t(),
	toolExecutionConfiguration: l(ll).optional()
}).transform((e) => W(e, {
	connectorId: "connector_id",
	toolExecutionConfiguration: "ToolExecutionConfiguration"
})), gv = S({
	toolName: t(),
	credentialsName: l(t()).optional(),
	connectorIdOrName: t(),
	connectorCallToolRequest: eu
}).transform((e) => W(e, {
	toolName: "tool_name",
	credentialsName: "credentials_name",
	connectorIdOrName: "connector_id_or_name",
	connectorCallToolRequest: "ConnectorCallToolRequest"
})), _v = S({
	connectorIdOrName: t(),
	credentialsCreateOrUpdate: Kd
}).transform((e) => W(e, {
	connectorIdOrName: "connector_id_or_name",
	credentialsCreateOrUpdate: "CredentialsCreateOrUpdate"
})), vv = S({
	connectorIdOrName: t(),
	credentialsCreateOrUpdate: Kd
}).transform((e) => W(e, {
	connectorIdOrName: "connector_id_or_name",
	credentialsCreateOrUpdate: "CredentialsCreateOrUpdate"
})), yv = S({
	connectorIdOrName: t(),
	credentialsCreateOrUpdate: Kd
}).transform((e) => W(e, {
	connectorIdOrName: "connector_id_or_name",
	credentialsCreateOrUpdate: "CredentialsCreateOrUpdate"
})), bv = S({ connectorId: t() }).transform((e) => W(e, { connectorId: "connector_id" })), xv = S({ connectorId: t() }).transform((e) => W(e, { connectorId: "connector_id" })), Sv = S({ connectorId: t() }).transform((e) => W(e, { connectorId: "connector_id" })), Cv = S({
	credentialsName: t(),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	credentialsName: "credentials_name",
	connectorIdOrName: "connector_id_or_name"
})), wv = S({
	credentialsName: t(),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	credentialsName: "credentials_name",
	connectorIdOrName: "connector_id_or_name"
})), Tv = S({ connectorId: t() }).transform((e) => W(e, { connectorId: "connector_id" })), Ev = S({
	credentialsName: t(),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	credentialsName: "credentials_name",
	connectorIdOrName: "connector_id_or_name"
})), Dv = S({ connectorIdOrName: t() }).transform((e) => W(e, { connectorIdOrName: "connector_id_or_name" })), Ov = S({
	appReturnUrl: l(t()).optional(),
	methodType: us.optional(),
	credentialsName: l(t()).optional(),
	githubInstallationLink: d().default(!1),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	appReturnUrl: "app_return_url",
	methodType: "method_type",
	credentialsName: "credentials_name",
	githubInstallationLink: "github_installation_link",
	connectorIdOrName: "connector_id_or_name"
})), kv = S({
	fetchUserData: d().default(!1),
	fetchCustomerData: d().default(!1),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	fetchUserData: "fetch_user_data",
	fetchCustomerData: "fetch_customer_data",
	connectorIdOrName: "connector_id_or_name"
})), Av = S({
	authType: l(us).optional(),
	fetchDefault: d().default(!1),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	authType: "auth_type",
	fetchDefault: "fetch_default",
	connectorIdOrName: "connector_id_or_name"
})), jv = S({
	page: f().default(1),
	pageSize: f().default(100),
	refresh: d().default(!1),
	pretty: d().default(!1),
	credentialsName: l(t()).optional(),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	pageSize: "page_size",
	credentialsName: "credentials_name",
	connectorIdOrName: "connector_id_or_name"
})), Mv = X([
	v(vl),
	v(Tm),
	v(s(t(), g()))
]), Nv = S({
	authType: l(us).optional(),
	fetchDefault: d().default(!1),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	authType: "auth_type",
	fetchDefault: "fetch_default",
	connectorIdOrName: "connector_id_or_name"
})), Pv = S({
	queryFilters: tu.optional(),
	cursor: l(t()).optional(),
	pageSize: f().default(100)
}).transform((e) => W(e, {
	queryFilters: "query_filters",
	pageSize: "page_size"
})), Fv = S({
	authType: l(us).optional(),
	fetchDefault: d().default(!1),
	connectorIdOrName: t()
}).transform((e) => W(e, {
	authType: "auth_type",
	fetchDefault: "fetch_default",
	connectorIdOrName: "connector_id_or_name"
})), Iv = S({
	connectorId: t(),
	updateConnectorRequest: Sg
}).transform((e) => W(e, {
	connectorId: "connector_id",
	updateConnectorRequest: "UpdateConnectorRequest"
})), Lv = S({
	datasetId: t(),
	createDatasetRecordRequest: bd
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	createDatasetRecordRequest: "CreateDatasetRecordRequest"
})), Rv = S({ campaignId: t() }).transform((e) => W(e, { campaignId: "campaign_id" })), zv = S({ datasetRecordId: t() }).transform((e) => W(e, { datasetRecordId: "dataset_record_id" })), Bv = S({ datasetId: t() }).transform((e) => W(e, { datasetId: "dataset_id" })), Vv = S({ judgeId: t() }).transform((e) => W(e, { judgeId: "judge_id" })), Hv = S({ modelId: t() }).transform((e) => W(e, { modelId: "model_id" })), Uv = S({ voiceId: t() }).transform((e) => W(e, { voiceId: "voice_id" })), Wv = S({
	workflowRegistrationId: t(),
	workflowExecutionRequest: a_
}).transform((e) => W(e, {
	workflowRegistrationId: "workflow_registration_id",
	workflowExecutionRequest: "WorkflowExecutionRequest"
})), Gv = X([o_, s_]), Kv = S({
	workflowIdentifier: t(),
	workflowExecutionRequest: a_
}).transform((e) => W(e, {
	workflowIdentifier: "workflow_identifier",
	workflowExecutionRequest: "WorkflowExecutionRequest"
})), qv = X([o_, s_]), Jv = S({ datasetId: t() }).transform((e) => W(e, { datasetId: "dataset_id" })), Yv = S({ fileId: t() }).transform((e) => W(e, { fileId: "file_id" })), Xv = S({ fileId: t() }).transform((e) => W(e, { fileId: "file_id" })), Zv = S({
	fileId: t(),
	expiry: f().default(24)
}).transform((e) => W(e, { fileId: "file_id" })), Qv = S({
	page: f().default(0),
	pageSize: f().default(100),
	includeTotal: d().default(!0),
	sampleType: l(v(Od)).optional(),
	source: l(v(jd)).optional(),
	search: l(t()).optional(),
	purpose: l(wd).optional(),
	mimetypes: l(v(t())).optional()
}).transform((e) => W(e, {
	pageSize: "page_size",
	includeTotal: "include_total",
	sampleType: "sample_type"
})), $v = S({ fileId: t() }).transform((e) => W(e, { fileId: "file_id" })), ey = _({
	Workspace: "workspace",
	User: "user"
}), ty = S({
	expiry: l(f()).optional(),
	visibility: ey.default("workspace"),
	purpose: wd.optional(),
	file: $o.or(Zo)
}), ny = S({ campaignId: t() }).transform((e) => W(e, { campaignId: "campaign_id" })), ry = S({
	campaignId: t(),
	pageSize: f().default(50),
	page: f().default(1)
}).transform((e) => W(e, {
	campaignId: "campaign_id",
	pageSize: "page_size"
})), iy = S({ campaignId: t() }).transform((e) => W(e, { campaignId: "campaign_id" })), ay = S({
	pageSize: f().default(50),
	page: f().default(1),
	q: l(t()).optional()
}).transform((e) => W(e, { pageSize: "page_size" })), oy = S({
	pageSize: f().default(50),
	cursor: l(t()).optional(),
	searchChatCompletionEventsRequest: wh
}).transform((e) => W(e, {
	pageSize: "page_size",
	searchChatCompletionEventsRequest: "SearchChatCompletionEventsRequest"
})), sy = S({ eventId: t() }).transform((e) => W(e, { eventId: "event_id" })), cy = S({
	fieldName: t(),
	fetchFieldOptionCountsRequest: ep
}).transform((e) => W(e, {
	fieldName: "field_name",
	fetchFieldOptionCountsRequest: "FetchFieldOptionCountsRequest"
})), ly = _({
	Lt: "lt",
	Lte: "lte",
	Gt: "gt",
	Gte: "gte",
	Startswith: "startswith",
	Istartswith: "istartswith",
	Endswith: "endswith",
	Iendswith: "iendswith",
	Contains: "contains",
	Icontains: "icontains",
	Matches: "matches",
	Notcontains: "notcontains",
	Inotcontains: "inotcontains",
	Eq: "eq",
	Neq: "neq",
	Isnull: "isnull",
	Includes: "includes",
	Excludes: "excludes",
	LenEq: "len_eq"
}), uy = S({
	fieldName: t(),
	operator: ly
}).transform((e) => W(e, { fieldName: "field_name" })), dy = S({ datasetId: t() }).transform((e) => W(e, { datasetId: "dataset_id" })), fy = S({
	datasetId: t(),
	pageSize: f().default(50),
	page: f().default(1)
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	pageSize: "page_size"
})), py = S({
	datasetId: t(),
	taskId: t()
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	taskId: "task_id"
})), my = S({
	datasetId: t(),
	pageSize: f().default(50),
	page: f().default(1)
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	pageSize: "page_size"
})), hy = S({ datasetRecordId: t() }).transform((e) => W(e, { datasetRecordId: "dataset_record_id" })), gy = S({
	pageSize: f().default(50),
	page: f().default(1),
	q: l(t()).optional()
}).transform((e) => W(e, { pageSize: "page_size" })), _y = S({ name: t() }), vy = S({ judgeId: t() }).transform((e) => W(e, { judgeId: "judge_id" })), yy = S({
	typeFilter: l(v(Rp)).optional(),
	modelFilter: l(v(t())).optional(),
	pageSize: f().default(50),
	page: f().default(1),
	q: l(t()).optional()
}).transform((e) => W(e, {
	typeFilter: "type_filter",
	modelFilter: "model_filter",
	pageSize: "page_size"
})), by = S({
	fieldName: t(),
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, { fieldName: "field_name" })), xy = S({
	runId: t(),
	decodePayloads: d().default(!0)
}).transform((e) => W(e, {
	runId: "run_id",
	decodePayloads: "decode_payloads"
})), Sy = S({ runId: t() }).transform((e) => W(e, { runId: "run_id" })), Cy = _({
	Active: "active",
	Paused: "paused"
}), wy = S({
	workflowName: l(t()).optional(),
	userId: l(t()).optional(),
	status: l(Cy).optional(),
	pageSize: l(f()).optional(),
	nextPageToken: l(t()).optional()
}).transform((e) => W(e, {
	workflowName: "workflow_name",
	userId: "user_id",
	pageSize: "page_size",
	nextPageToken: "next_page_token"
})), Ty = S({ Result: x_ }).transform((e) => W(e, { Result: "result" })), Ey = S({ scheduleId: t() }).transform((e) => W(e, { scheduleId: "schedule_id" })), Dy = S({ eventId: t() }).transform((e) => W(e, { eventId: "event_id" })), Oy = S({
	traceId: t(),
	spanId: t(),
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, {
	traceId: "trace_id",
	spanId: "span_id"
})), ky = S({
	fieldName: t(),
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, { fieldName: "field_name" })), Ay = S({
	fieldName: t(),
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, { fieldName: "field_name" })), jy = _({
	Activity: "activity",
	Workflow: "workflow",
	Wildcard: "*"
}), My = S({
	scope: jy.default("*"),
	activityName: t().default("*"),
	activityId: t().default("*"),
	workflowName: t().default("*"),
	workflowExecId: t().default("*"),
	rootWorkflowExecId: t().default("*"),
	parentWorkflowExecId: t().default("*"),
	stream: t().default("*"),
	startSeq: f().default(0),
	metadataFilters: l(s(t(), g())).optional(),
	workflowEventTypes: l(v(Zg)).optional(),
	lastEventId: l(t()).optional()
}).transform((e) => W(e, {
	activityName: "activity_name",
	activityId: "activity_id",
	workflowName: "workflow_name",
	workflowExecId: "workflow_exec_id",
	rootWorkflowExecId: "root_workflow_exec_id",
	parentWorkflowExecId: "parent_workflow_exec_id",
	startSeq: "start_seq",
	metadataFilters: "metadata_filters",
	workflowEventTypes: "workflow_event_types",
	lastEventId: "last-event-id"
})), Ny = S({
	event: t().optional(),
	data: t().optional().transform((e, t) => {
		if (e !== void 0) try {
			return JSON.parse(e);
		} catch (n) {
			return t.addIssue({
				input: e,
				code: "custom",
				message: `malformed json: ${n}`
			}), o;
		}
	}).pipe(qh.optional()),
	id: t().optional(),
	retry: f().optional()
}), Py = S({ traceId: t() }).transform((e) => W(e, { traceId: "trace_id" })), Fy = S({
	fieldName: t(),
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, { fieldName: "field_name" })), Iy = S({
	traceId: t(),
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional(),
	pageSize: f().default(50),
	cursor: l(t()).optional()
}).transform((e) => W(e, {
	traceId: "trace_id",
	pageSize: "page_size"
})), Ly = S({ voiceId: t() }).transform((e) => W(e, { voiceId: "voice_id" })), Ry = S({ voiceId: t() }).transform((e) => W(e, { voiceId: "voice_id" })), zy = S({
	rootWorkflowExecId: l(t()).optional(),
	workflowExecId: l(t()).optional(),
	workflowRunId: l(t()).optional(),
	limit: f().default(100),
	cursor: l(t()).optional()
}).transform((e) => W(e, {
	rootWorkflowExecId: "root_workflow_exec_id",
	workflowExecId: "workflow_exec_id",
	workflowRunId: "workflow_run_id"
})), By = S({
	executionId: t(),
	decodePayloads: d().default(!0)
}).transform((e) => W(e, {
	executionId: "execution_id",
	decodePayloads: "decode_payloads"
})), Vy = _({
	Asc: "asc",
	Desc: "desc"
}), Hy = S({
	executionId: t(),
	runId: l(t()).optional(),
	activityId: l(t()).optional(),
	after: l(y().transform((e) => e.toISOString())).optional(),
	before: l(y().transform((e) => e.toISOString())).optional(),
	order: Vy.default("asc"),
	cursor: l(t()).optional(),
	limit: f().default(50)
}).transform((e) => W(e, {
	executionId: "execution_id",
	runId: "run_id",
	activityId: "activity_id"
})), Uy = S({
	executionId: t(),
	mergeSameIdEvents: d().default(!1),
	includeInternalEvents: d().default(!1)
}).transform((e) => W(e, {
	executionId: "execution_id",
	mergeSameIdEvents: "merge_same_id_events",
	includeInternalEvents: "include_internal_events"
})), Wy = S({ executionId: t() }).transform((e) => W(e, { executionId: "execution_id" })), Gy = S({ executionId: t() }).transform((e) => W(e, { executionId: "execution_id" })), Ky = S({ executionId: t() }).transform((e) => W(e, { executionId: "execution_id" })), qy = S({
	workflowName: t(),
	startTime: l(y().transform((e) => e.toISOString())).optional(),
	endTime: l(y().transform((e) => e.toISOString())).optional()
}).transform((e) => W(e, {
	workflowName: "workflow_name",
	startTime: "start_time",
	endTime: "end_time"
})), Jy = S({
	workflowId: l(t()).optional(),
	taskQueue: l(t()).optional(),
	activeOnly: d().default(!1),
	includeShared: d().default(!0),
	workflowSearch: l(t()).optional(),
	archived: l(d()).optional(),
	withWorkflow: d().default(!1),
	availableInChatAssistant: l(d()).optional(),
	limit: f().default(50),
	cursor: l(t()).optional()
}).transform((e) => W(e, {
	workflowId: "workflow_id",
	taskQueue: "task_queue",
	activeOnly: "active_only",
	includeShared: "include_shared",
	workflowSearch: "workflow_search",
	withWorkflow: "with_workflow",
	availableInChatAssistant: "available_in_chat_assistant"
})), Yy = S({
	workflowRegistrationId: t(),
	withWorkflow: d().default(!1),
	includeShared: d().default(!0)
}).transform((e) => W(e, {
	workflowRegistrationId: "workflow_registration_id",
	withWorkflow: "with_workflow",
	includeShared: "include_shared"
})), Xy = {
	Active: "active",
	Inactive: "inactive"
}, Zy = {
	Asc: "asc",
	Desc: "desc"
};
X([e_, v(e_)]);
var Qy = _(Xy), $y = _(Zy), eb = S({
	status: l(X([e_, v(e_)])).optional(),
	includeShared: d().default(!0),
	availableInChatAssistant: l(d()).optional(),
	deploymentName: l(v(t())).optional(),
	deploymentStatus: l(Qy).optional(),
	archived: l(d()).optional(),
	tags: l(v(t())).optional(),
	sortBy: l(p("display_name")).optional(),
	order: $y.default("asc"),
	cursor: l(t()).optional(),
	limit: f().default(50),
	activeOnly: d().default(!1)
}).transform((e) => W(e, {
	includeShared: "include_shared",
	availableInChatAssistant: "available_in_chat_assistant",
	deploymentName: "deployment_name",
	deploymentStatus: "deployment_status",
	sortBy: "sort_by",
	activeOnly: "active_only"
})), tb = S({ Result: h_ }).transform((e) => W(e, { Result: "result" })), nb = S({ workflowIdentifier: t() }).transform((e) => W(e, { workflowIdentifier: "workflow_identifier" })), rb = S({ jobId: t() }).transform((e) => W(e, { jobId: "job_id" })), ib = S({ jobId: t() }).transform((e) => W(e, { jobId: "job_id" })), ab = S({
	jobId: t(),
	inline: l(d()).optional()
}).transform((e) => W(e, { jobId: "job_id" })), ob = _({
	Created: "created",
	MinusCreated: "-created"
}), sb = S({
	page: f().default(0),
	pageSize: f().default(100),
	model: l(t()).optional(),
	agentId: l(t()).optional(),
	metadata: l(s(t(), g())).optional(),
	createdAfter: l(y().transform((e) => e.toISOString())).optional(),
	createdByMe: d().default(!1),
	status: l(v(Ds)).optional(),
	orderBy: ob.default("-created")
}).transform((e) => W(e, {
	pageSize: "page_size",
	agentId: "agent_id",
	createdAfter: "created_after",
	createdByMe: "created_by_me",
	orderBy: "order_by"
})), cb = S({ modelId: t() }).transform((e) => W(e, { modelId: "model_id" })), lb = S({ jobId: t() }).transform((e) => W(e, { jobId: "job_id" })), ub = Gi("job_type", {
	classifier: Oc,
	completion: Xc
}, { outputPropertyName: "jobType" });
Gi("job_type", {
	classifier: Tc,
	completion: Jc
}, { outputPropertyName: "jobType" });
var db = X([zp, Gi("job_type", {
	classifier: Tc,
	completion: Jc
}, { outputPropertyName: "jobType" })]), fb = S({ jobId: t() }).transform((e) => W(e, { jobId: "job_id" })), pb = Gi("job_type", {
	classifier: Oc,
	completion: Xc
}, { outputPropertyName: "jobType" }), mb = _({
	Queued: "QUEUED",
	Started: "STARTED",
	Validating: "VALIDATING",
	Validated: "VALIDATED",
	Running: "RUNNING",
	FailedValidation: "FAILED_VALIDATION",
	Failed: "FAILED",
	Success: "SUCCESS",
	Cancelled: "CANCELLED",
	CancellationRequested: "CANCELLATION_REQUESTED"
}), hb = S({
	page: f().default(0),
	pageSize: f().default(100),
	model: l(t()).optional(),
	createdAfter: l(y().transform((e) => e.toISOString())).optional(),
	createdBefore: l(y().transform((e) => e.toISOString())).optional(),
	createdByMe: d().default(!1),
	status: l(mb).optional(),
	wandbProject: l(t()).optional(),
	wandbName: l(t()).optional(),
	suffix: l(t()).optional()
}).transform((e) => W(e, {
	pageSize: "page_size",
	createdAfter: "created_after",
	createdBefore: "created_before",
	createdByMe: "created_by_me",
	wandbProject: "wandb_project",
	wandbName: "wandb_name"
})), gb = S({ jobId: t() }).transform((e) => W(e, { jobId: "job_id" })), _b = Gi("job_type", {
	classifier: Oc,
	completion: Xc
}, { outputPropertyName: "jobType" }), vb = S({ modelId: t() }).transform((e) => W(e, { modelId: "model_id" })), yb = S({
	modelId: t(),
	updateModelRequest: jg
}).transform((e) => W(e, {
	modelId: "model_id",
	updateModelRequest: "UpdateModelRequest"
})), bb = Gi("model_type", {
	classifier: yc,
	completion: Uc
}, { outputPropertyName: "modelType" }), xb = S({
	eventId: t(),
	judgeChatCompletionEventRequest: Pp
}).transform((e) => W(e, {
	eventId: "event_id",
	judgeChatCompletionEventRequest: "JudgeChatCompletionEventRequest"
})), Sb = S({
	judgeId: t(),
	judgeConversationRequest: Fp
}).transform((e) => W(e, {
	judgeId: "judge_id",
	judgeConversationRequest: "JudgeConversationRequest"
})), Cb = S({
	datasetRecordId: t(),
	judgeDatasetRecordRequest: Ip
}).transform((e) => W(e, {
	datasetRecordId: "dataset_record_id",
	judgeDatasetRecordRequest: "JudgeDatasetRecordRequest"
})), wb = S({ libraryId: t() }).transform((e) => W(e, { libraryId: "library_id" })), Tb = S({
	libraryId: t(),
	documentId: t()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id"
})), Eb = S({
	libraryId: t(),
	documentId: t()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id"
})), Db = S({
	libraryId: t(),
	documentId: t()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id"
})), Ob = S({
	libraryId: t(),
	documentId: t()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id"
})), kb = S({
	libraryId: t(),
	documentId: t(),
	pageStart: l(f()).optional(),
	pageEnd: l(f()).optional()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id",
	pageStart: "page_start",
	pageEnd: "page_end"
})), Ab = S({
	libraryId: t(),
	documentId: t()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id"
})), jb = S({
	libraryId: t(),
	search: l(t()).optional(),
	pageSize: f().default(100),
	page: f().default(0),
	filtersAttributes: l(t()).optional(),
	sortBy: t().default("created_at"),
	sortOrder: t().default("desc")
}).transform((e) => W(e, {
	libraryId: "library_id",
	pageSize: "page_size",
	filtersAttributes: "filters_attributes",
	sortBy: "sort_by",
	sortOrder: "sort_order"
})), Mb = S({
	libraryId: t(),
	documentId: t(),
	updateDocumentRequest: Dg
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id",
	updateDocumentRequest: "UpdateDocumentRequest"
})), Nb = S({
	libraryId: t(),
	documentId: t()
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id"
})), Pb = S({
	libraryId: t(),
	documentId: t(),
	updateDocumentRequest: Dg
}).transform((e) => W(e, {
	libraryId: "library_id",
	documentId: "document_id",
	updateDocumentRequest: "UpdateDocumentRequest"
})), Fb = S({ file: $o.or(Zo) }), Ib = S({
	libraryId: t(),
	requestBody: h(() => Fb)
}).transform((e) => W(e, {
	libraryId: "library_id",
	requestBody: "RequestBody"
})), Lb = S({ libraryId: t() }).transform((e) => W(e, { libraryId: "library_id" })), Rb = S({
	pageSize: f().default(100),
	page: f().default(0),
	search: l(t()).optional(),
	filterOwnedByMe: l(d()).optional()
}).transform((e) => W(e, {
	pageSize: "page_size",
	filterOwnedByMe: "filter_owned_by_me"
})), zb = S({
	libraryId: t(),
	updateLibraryRequest: Ag
}).transform((e) => W(e, {
	libraryId: "library_id",
	updateLibraryRequest: "UpdateLibraryRequest"
})), Bb = S({
	libraryId: t(),
	sharingRequest: Mh
}).transform((e) => W(e, {
	libraryId: "library_id",
	sharingRequest: "SharingRequest"
})), Vb = S({
	libraryId: t(),
	sharingDelete: jh
}).transform((e) => W(e, {
	libraryId: "library_id",
	sharingDelete: "SharingDelete"
})), Hb = S({ libraryId: t() }).transform((e) => W(e, { libraryId: "library_id" })), Ub = S({
	libraryId: t(),
	updateLibraryRequest: Ag
}).transform((e) => W(e, {
	libraryId: "library_id",
	updateLibraryRequest: "UpdateLibraryRequest"
})), Wb = S({
	activeOnly: d().default(!0),
	isHardened: l(d()).optional(),
	workflowName: l(t()).optional(),
	search: l(t()).optional(),
	limit: l(f()).optional(),
	cursor: l(t()).optional(),
	workspaceId: l(t()).optional()
}).transform((e) => W(e, {
	activeOnly: "active_only",
	isHardened: "is_hardened",
	workflowName: "workflow_name",
	workspaceId: "workspace_id"
})), Gb = S({
	provider: l(t()).optional(),
	model: l(t()).optional()
}), Kb = {
	StartTime: "start_time",
	EndTime: "end_time"
}, qb = {
	Asc: "asc",
	Desc: "desc"
};
X([e_, v(e_)]);
var Jb = _(Kb), Yb = _(qb), Xb = S({
	workflowIdentifier: l(t()).optional(),
	search: l(t()).optional(),
	status: l(X([e_, v(e_)])).optional(),
	deploymentName: l(t()).optional(),
	sortBy: l(Jb).optional(),
	order: Yb.default("desc"),
	startTimeAfter: l(y().transform((e) => e.toISOString())).optional(),
	startTimeBefore: l(y().transform((e) => e.toISOString())).optional(),
	endTimeAfter: l(y().transform((e) => e.toISOString())).optional(),
	endTimeBefore: l(y().transform((e) => e.toISOString())).optional(),
	userId: l(t()).optional(),
	pageSize: f().default(50),
	nextPageToken: l(t()).optional()
}).transform((e) => W(e, {
	workflowIdentifier: "workflow_identifier",
	deploymentName: "deployment_name",
	sortBy: "sort_by",
	startTimeAfter: "start_time_after",
	startTimeBefore: "start_time_before",
	endTimeAfter: "end_time_after",
	endTimeBefore: "end_time_before",
	userId: "user_id",
	pageSize: "page_size",
	nextPageToken: "next_page_token"
})), Zb = S({ Result: n_ }).transform((e) => W(e, { Result: "result" })), Qb = _({
	All: "all",
	Custom: "custom",
	Preset: "preset"
}), $b = S({
	limit: f().default(10),
	offset: f().default(0),
	type: Qb.default("all")
}), ex = S({
	scheduleId: t(),
	workflowSchedulePauseRequest: l(S_).optional()
}).transform((e) => W(e, {
	scheduleId: "schedule_id",
	workflowSchedulePauseRequest: "WorkflowSchedulePauseRequest"
})), tx = S({
	datasetId: t(),
	importDatasetFromCampaignRequest: Op
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	importDatasetFromCampaignRequest: "ImportDatasetFromCampaignRequest"
})), nx = S({
	datasetId: t(),
	importDatasetFromDatasetRequest: kp
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	importDatasetFromDatasetRequest: "ImportDatasetFromDatasetRequest"
})), rx = S({
	datasetId: t(),
	importDatasetFromExplorerRequest: Ap
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	importDatasetFromExplorerRequest: "ImportDatasetFromExplorerRequest"
})), ix = S({
	datasetId: t(),
	importDatasetFromFileRequest: jp
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	importDatasetFromFileRequest: "ImportDatasetFromFileRequest"
})), ax = S({
	datasetId: t(),
	importDatasetFromPlaygroundRequest: Mp
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	importDatasetFromPlaygroundRequest: "ImportDatasetFromPlaygroundRequest"
})), ox = S({
	executionId: t(),
	queryInvocationBody: ph
}).transform((e) => W(e, {
	executionId: "execution_id",
	queryInvocationBody: "QueryInvocationBody"
})), sx = S({
	executionId: t(),
	resetInvocationBody: gh
}).transform((e) => W(e, {
	executionId: "execution_id",
	resetInvocationBody: "ResetInvocationBody"
})), cx = S({
	scheduleId: t(),
	workflowSchedulePauseRequest: l(S_).optional()
}).transform((e) => W(e, {
	scheduleId: "schedule_id",
	workflowSchedulePauseRequest: "WorkflowSchedulePauseRequest"
})), lx = S({ modelId: t() }).transform((e) => W(e, { modelId: "model_id" })), ux = Gi("type", {
	base: ys,
	"fine-tuned": cp
}), dx = S({
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional(),
	pageSize: f().default(50),
	cursor: l(t()).optional(),
	spanEvaluationsRequest: Lh
}).transform((e) => W(e, {
	pageSize: "page_size",
	spanEvaluationsRequest: "SpanEvaluationsRequest"
})), fx = S({
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional(),
	pageSize: f().default(50),
	cursor: l(t()).optional(),
	logsRequest: wm
}).transform((e) => W(e, {
	pageSize: "page_size",
	logsRequest: "LogsRequest"
})), px = S({
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional(),
	pageSize: f().default(50),
	cursor: l(t()).optional(),
	spanEvaluationsRequest: Lh
}).transform((e) => W(e, {
	pageSize: "page_size",
	spanEvaluationsRequest: "SpanEvaluationsRequest"
})), mx = S({
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional(),
	pageSize: f().default(50),
	cursor: l(t()).optional(),
	spansRequest: Rh
}).transform((e) => W(e, {
	pageSize: "page_size",
	spansRequest: "SpansRequest"
})), hx = S({
	from: l(y().transform((e) => e.toISOString())).optional(),
	to: l(y().transform((e) => e.toISOString())).optional(),
	pageSize: f().default(50),
	cursor: l(t()).optional(),
	tracesRequest: ug
}).transform((e) => W(e, {
	pageSize: "page_size",
	tracesRequest: "TracesRequest"
})), gx = S({
	executionId: t(),
	signalInvocationBody: Fh
}).transform((e) => W(e, {
	executionId: "execution_id",
	signalInvocationBody: "SignalInvocationBody"
}));
Gi("type", {
	"speech.audio.delta": Vh,
	"speech.audio.done": Uh
});
var _x = S({
	event: Wh,
	data: t().transform((e, t) => {
		try {
			return JSON.parse(e);
		} catch (n) {
			return t.addIssue({
				input: e,
				code: "custom",
				message: `malformed json: ${n}`
			}), o;
		}
	}).pipe(Gi("type", {
		"speech.audio.delta": Vh,
		"speech.audio.done": Uh
	}))
}), vx = S({ audio_data: t() }).transform((e) => W(e, { audio_data: "audioData" })), yx = X([h(() => vx), m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
	done: !1,
	value: h(() => _x).parse(e)
})))]), bx = S({
	executionId: t(),
	eventSource: l(If).optional(),
	lastEventId: l(t()).optional()
}).transform((e) => W(e, {
	executionId: "execution_id",
	eventSource: "event_source",
	lastEventId: "last_event_id"
})), xx = S({
	event: t().optional(),
	data: t().optional().transform((e, t) => {
		if (e !== void 0) try {
			return JSON.parse(e);
		} catch (n) {
			return t.addIssue({
				input: e,
				code: "custom",
				message: `malformed json: ${n}`
			}), o;
		}
	}).pipe(qh.optional()),
	id: t().optional(),
	retry: f().optional()
}), Sx = {
	Log: "log",
	Error: "error"
}, Cx = S({
	executionId: t(),
	runId: l(t()).optional(),
	activityId: l(t()).optional(),
	after: l(y().transform((e) => e.toISOString())).optional(),
	lastEventId: l(t()).optional()
}).transform((e) => W(e, {
	executionId: "execution_id",
	runId: "run_id",
	activityId: "activity_id",
	lastEventId: "last_event_id"
})), wx = Y(Sx);
X([Rf, Gh]);
var Tx = S({
	event: wx.optional(),
	id: t().optional(),
	data: t().optional().transform((e, t) => {
		if (e !== void 0) try {
			return JSON.parse(e);
		} catch (n) {
			return t.addIssue({
				input: e,
				code: "custom",
				message: `malformed json: ${n}`
			}), o;
		}
	}).pipe(X([Rf, Gh]).optional())
}), Ex = S({ executionId: t() }).transform((e) => W(e, { executionId: "execution_id" })), Dx = S({
	scheduleId: t(),
	workflowScheduleTriggerRequest: l(T_).optional()
}).transform((e) => W(e, {
	scheduleId: "schedule_id",
	workflowScheduleTriggerRequest: "WorkflowScheduleTriggerRequest"
})), Ox = S({ workflowIdentifier: t() }).transform((e) => W(e, { workflowIdentifier: "workflow_identifier" })), kx = S({ scheduleId: t() }).transform((e) => W(e, { scheduleId: "schedule_id" })), Ax = S({
	datasetRecordId: t(),
	updateDatasetRecordPayloadRequest: Cg
}).transform((e) => W(e, {
	datasetRecordId: "dataset_record_id",
	updateDatasetRecordPayloadRequest: "UpdateDatasetRecordPayloadRequest"
})), jx = S({
	datasetRecordId: t(),
	updateDatasetRecordPropertiesRequest: wg
}).transform((e) => W(e, {
	datasetRecordId: "dataset_record_id",
	updateDatasetRecordPropertiesRequest: "UpdateDatasetRecordPropertiesRequest"
})), Mx = S({
	datasetId: t(),
	updateDatasetRequest: Tg
}).transform((e) => W(e, {
	datasetId: "dataset_id",
	updateDatasetRequest: "UpdateDatasetRequest"
})), Nx = S({
	judgeId: t(),
	updateJudgeRequest: kg
}).transform((e) => W(e, {
	judgeId: "judge_id",
	updateJudgeRequest: "UpdateJudgeRequest"
})), Px = S({
	id: t(),
	updateRunInfo: Mg
}).transform((e) => W(e, { updateRunInfo: "UpdateRunInfo" })), Fx = S({
	scheduleId: t(),
	workflowScheduleUpdateRequest: E_
}).transform((e) => W(e, {
	scheduleId: "schedule_id",
	workflowScheduleUpdateRequest: "WorkflowScheduleUpdateRequest"
})), Ix = S({
	voiceId: t(),
	voiceUpdateRequest: zg
}).transform((e) => W(e, {
	voiceId: "voice_id",
	voiceUpdateRequest: "VoiceUpdateRequest"
})), Lx = S({
	executionId: t(),
	updateInvocationBody: Og
}).transform((e) => W(e, {
	executionId: "execution_id",
	updateInvocationBody: "UpdateInvocationBody"
})), Rx = S({
	workflowIdentifier: t(),
	workflowUpdateRequest: O_
}).transform((e) => W(e, {
	workflowIdentifier: "workflow_identifier",
	workflowUpdateRequest: "WorkflowUpdateRequest"
})), zx;
(function(e) {
	e.applicationJson = "application/json", e.textEventStream = "text/event-stream";
})(zx ||= {});
function Bx(e, t, n) {
	return new $(Vx(e, t, n));
}
async function Vx(e, t, n) {
	let r = K(t, (e) => Bh.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/audio/speech")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: n?.acceptHeaderOverride || "application/json;q=1, text/event-stream;q=0"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "speech_v1_audio_speech_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, yx), pi(200, yx), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/speech.js
var Hx = class extends z {
	async complete(e, t) {
		return P(Bx(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/types/streams.js
function Ux(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e;
	return typeof t.getReader == "function" && typeof t.cancel == "function" && typeof t.tee == "function";
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioTranscriptionsComplete.js
function Wx(e, t, n) {
	return new $(Gx(e, t, n));
}
async function Gx(e, t, n) {
	let r = K(t, (e) => ts.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = new FormData();
	if (R(a, "model", i.model), i.context_bias !== void 0 && R(a, "context_bias", i.context_bias), i.diarize !== void 0 && R(a, "diarize", i.diarize), i.file !== void 0) {
		if (Qo(i.file)) {
			let e = i.file;
			R(a, "file", await Rr(e), "name" in e ? e.name : void 0);
		} else if (Ux(i.file.content)) R(a, "file", Kn(await Wn(i.file.content), Gn(i.file.fileName) || "application/octet-stream"), i.file.fileName);
		else {
			let e = Gn(i.file.fileName) || "application/octet-stream";
			R(a, "file", Kn(i.file.content, e), i.file.fileName);
		}
	}
	i.file_id !== void 0 && R(a, "file_id", i.file_id), i.file_url !== void 0 && R(a, "file_url", i.file_url), i.language !== void 0 && R(a, "language", i.language), i.stream !== void 0 && R(a, "stream", i.stream), i.temperature !== void 0 && R(a, "temperature", i.temperature), i.timestamp_granularities !== void 0 && R(a, "timestamp_granularities", i.timestamp_granularities);
	let o = M("/v1/audio/transcriptions")(), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "audio_api_v1_transcriptions_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, pg), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioTranscriptionsStream.js
function Kx(e, t, n) {
	return new $(qx(e, t, n));
}
async function qx(e, t, n) {
	let r = K(t, (e) => ns.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = new FormData();
	if (R(a, "model", i.model), i.context_bias !== void 0 && R(a, "context_bias", i.context_bias), i.diarize !== void 0 && R(a, "diarize", i.diarize), i.file !== void 0) {
		if (Qo(i.file)) {
			let e = i.file;
			R(a, "file", await Rr(e), "name" in e ? e.name : void 0);
		} else if (Ux(i.file.content)) R(a, "file", Kn(await Wn(i.file.content), Gn(i.file.fileName) || "application/octet-stream"), i.file.fileName);
		else {
			let e = Gn(i.file.fileName) || "application/octet-stream";
			R(a, "file", Kn(i.file.content, e), i.file.fileName);
		}
	}
	i.file_id !== void 0 && R(a, "file_id", i.file_id), i.file_url !== void 0 && R(a, "file_url", i.file_url), i.language !== void 0 && R(a, "language", i.language), i.stream !== void 0 && R(a, "stream", i.stream), i.temperature !== void 0 && R(a, "temperature", i.temperature), i.timestamp_granularities !== void 0 && R(a, "timestamp_granularities", i.timestamp_granularities);
	let o = M("/v1/audio/transcriptions#stream")(), s = new Headers(G({ Accept: "text/event-stream" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "audio_api_v1_transcriptions_post_stream",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, [g] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: yg.parse(e)
	})))), H("4XX"), H("5XX"))(h, f);
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/transcriptions.js
var Jx = class extends z {
	async complete(e, t) {
		return P(Wx(this, e, t));
	}
	async stream(e, t) {
		return P(Kx(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioVoicesCreate.js
function Yx(e, t, n) {
	return new $(Xx(e, t, n));
}
async function Xx(e, t, n) {
	let r = K(t, (e) => Ig.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/audio/voices")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "create_voice_v1_audio_voices_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Lg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioVoicesDelete.js
function Zx(e, t, n) {
	return new $(Qx(e, t, n));
}
async function Qx(e, t, n) {
	let r = K(t, (e) => Uv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { voice_id: I("voice_id", i.voice_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/audio/voices/{voice_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_voice_v1_audio_voices__voice_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Lg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioVoicesGet.js
function $x(e, t, n) {
	return new $(eS(e, t, n));
}
async function eS(e, t, n) {
	let r = K(t, (e) => Ry.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { voice_id: I("voice_id", i.voice_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/audio/voices/{voice_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_voice_v1_audio_voices__voice_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Lg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioVoicesGetSampleAudio.js
function tS(e, t, n) {
	return new $(nS(e, t, n));
}
async function nS(e, t, n) {
	let r = K(t, (e) => Ly.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { voice_id: I("voice_id", i.voice_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/audio/voices/{voice_id}/sample")(a), s = new Headers(G({ Accept: "audio/wav" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_voice_sample_audio_v1_audio_voices__voice_id__sample_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, g = { HttpMeta: {
		Response: h,
		Request: f
	} }, [_] = await U(fi(200, m((e) => e instanceof ReadableStream), { ctype: "audio/wav" }), B(422, Z), H("4XX"), H("5XX"))(h, f, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioVoicesList.js
function rS(e, t, n) {
	return new $(iS(e, t, n));
}
async function iS(e, t, n) {
	let r = K(t, (e) => $b.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/audio/voices")(), o = L({
		limit: i?.limit,
		offset: i?.offset,
		type: i?.type
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "list_voices_v1_audio_voices_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Rg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/audioVoicesUpdate.js
function aS(e, t, n) {
	return new $(oS(e, t, n));
}
async function oS(e, t, n) {
	let r = K(t, (e) => Ix.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.VoiceUpdateRequest, { explode: !0 }), o = { voice_id: I("voice_id", i.voice_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/audio/voices/{voice_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_voice_v1_audio_voices__voice_id__patch",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Lg), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/voices.js
var sS = class extends z {
	async list(e, t) {
		return P(rS(this, e, t));
	}
	async create(e, t) {
		return P(Yx(this, e, t));
	}
	async delete(e, t) {
		return P(Zx(this, e, t));
	}
	async update(e, t) {
		return P(aS(this, e, t));
	}
	async get(e, t) {
		return P($x(this, e, t));
	}
	async getSampleAudio(e, t) {
		return P(tS(this, e, t));
	}
}, cS = class extends z {
	_speech;
	get speech() {
		return this._speech ??= new Hx(this._options);
	}
	_transcriptions;
	get transcriptions() {
		return this._transcriptions ??= new Jx(this._options);
	}
	_voices;
	get voices() {
		return this._voices ??= new sS(this._options);
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/batchJobsCancel.js
function lS(e, t, n) {
	return new $(uS(e, t, n));
}
async function uS(e, t, n) {
	let r = K(t, (e) => rb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { job_id: I("job_id", i.job_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/batch/jobs/{job_id}/cancel")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_batch_cancel_batch_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, Os), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/batchJobsCreate.js
function dS(e, t, n) {
	return new $(fS(e, t, n));
}
async function fS(e, t, n) {
	let r = K(t, (e) => gd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/batch/jobs")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_batch_create_batch_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, Os), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/batchJobsDelete.js
function pS(e, t, n) {
	return new $(mS(e, t, n));
}
async function mS(e, t, n) {
	let r = K(t, (e) => ib.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { job_id: I("job_id", i.job_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/batch/jobs/{job_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_batch_delete_batch_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, gf), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/batchJobsGet.js
function hS(e, t, n) {
	return new $(gS(e, t, n));
}
async function gS(e, t, n) {
	let r = K(t, (e) => ab.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { job_id: I("job_id", i.job_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/batch/jobs/{job_id}")(a), s = L({ inline: i.inline }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_batch_get_batch_job",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, [g] = await U(V(200, Os), H("4XX"), H("5XX"))(h, p);
	return g.ok, [g, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/batchJobsList.js
function _S(e, t, n) {
	return new $(vS(e, t, n));
}
async function vS(e, t, n) {
	let r = K(t, (e) => sb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/batch/jobs")(), o = L({
		agent_id: i?.agent_id,
		created_after: i?.created_after,
		created_by_me: i?.created_by_me,
		metadata: i?.metadata,
		model: i?.model,
		order_by: i?.order_by,
		page: i?.page,
		page_size: i?.page_size,
		status: i?.status
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_batch_get_batch_jobs",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, Vp), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/batchjobs.js
var yS = class extends z {
	async list(e, t) {
		return P(_S(this, e, t));
	}
	async create(e, t) {
		return P(dS(this, e, t));
	}
	async get(e, t) {
		return P(hS(this, e, t));
	}
	async delete(e, t) {
		return P(pS(this, e, t));
	}
	async cancel(e, t) {
		return P(lS(this, e, t));
	}
}, bS = class extends z {
	_jobs;
	get jobs() {
		return this._jobs ??= new yS(this._options);
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsCreate.js
function xS(e, t, n) {
	return new $(SS(e, t, n));
}
async function SS(e, t, n) {
	let r = K(t, (e) => hd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/agents")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_create",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Xa), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsCreateVersionAlias.js
function CS(e, t, n) {
	return new $(wS(e, t, n));
}
async function wS(e, t, n) {
	let r = K(t, (e) => W_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}/aliases")(a), s = L({
		alias: i.alias,
		version: i.version
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_create_or_update_alias",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Za), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsDelete.js
function TS(e, t, n) {
	return new $(ES(e, t, n));
}
async function ES(e, t, n) {
	let r = K(t, (e) => G_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsDeleteVersionAlias.js
function DS(e, t, n) {
	return new $(OS(e, t, n));
}
async function OS(e, t, n) {
	let r = K(t, (e) => K_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}/aliases")(a), s = L({ alias: i.alias }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_delete_alias",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsGet.js
function kS(e, t, n) {
	return new $(AS(e, t, n));
}
async function AS(e, t, n) {
	let r = K(t, (e) => q_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}")(a), s = L({ agent_version: i.agent_version }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Xa), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsGetVersion.js
function jS(e, t, n) {
	return new $(MS(e, t, n));
}
async function MS(e, t, n) {
	let r = K(t, (e) => J_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		agent_id: I("agent_id", i.agent_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		version: I("version", i.version, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/agents/{agent_id}/versions/{version}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_get_version",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Xa), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsList.js
function NS(e, t, n) {
	return new $(PS(e, t, n));
}
async function PS(e, t, n) {
	let r = K(t, (e) => Y_.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/agents")(), o = Pr(L({
		deployment_chat: i?.deployment_chat,
		id: i?.id,
		name: i?.name,
		page: i?.page,
		page_size: i?.page_size,
		search: i?.search,
		sources: i?.sources
	}), Ir({ metadata: i?.metadata }, { explode: !1 })), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_list",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, v(Xa)), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsListVersionAliases.js
function FS(e, t, n) {
	return new $(IS(e, t, n));
}
async function IS(e, t, n) {
	let r = K(t, (e) => X_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}/aliases")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_list_version_aliases",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, v(Za)), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsListVersions.js
function LS(e, t, n) {
	return new $(RS(e, t, n));
}
async function RS(e, t, n) {
	let r = K(t, (e) => Z_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}/versions")(a), s = L({
		page: i.page,
		page_size: i.page_size
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_list_versions",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, v(Xa)), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsUpdate.js
function zS(e, t, n) {
	return new $(BS(e, t, n));
}
async function BS(e, t, n) {
	let r = K(t, (e) => Q_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateAgentRequest, { explode: !0 }), o = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/agents/{agent_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_update",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Xa), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaAgentsUpdateVersion.js
function VS(e, t, n) {
	return new $(HS(e, t, n));
}
async function HS(e, t, n) {
	let r = K(t, (e) => $_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { agent_id: I("agent_id", i.agent_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/agents/{agent_id}/version")(a), s = L({ version: i.version }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_agents_update_version",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Xa), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/betaagents.js
var US = class extends z {
	async create(e, t) {
		return P(xS(this, e, t));
	}
	async list(e, t) {
		return P(NS(this, e, t));
	}
	async get(e, t) {
		return P(kS(this, e, t));
	}
	async update(e, t) {
		return P(zS(this, e, t));
	}
	async delete(e, t) {
		return P(TS(this, e, t));
	}
	async updateVersion(e, t) {
		return P(VS(this, e, t));
	}
	async listVersions(e, t) {
		return P(LS(this, e, t));
	}
	async getVersion(e, t) {
		return P(jS(this, e, t));
	}
	async createVersionAlias(e, t) {
		return P(CS(this, e, t));
	}
	async listVersionAliases(e, t) {
		return P(FS(this, e, t));
	}
	async deleteVersionAlias(e, t) {
		return P(DS(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsActivateForOrganization.js
function WS(e, t, n) {
	return new $(GS(e, t, n));
}
async function GS(e, t, n) {
	let r = K(t, (e) => pv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ToolExecutionConfiguration, { explode: !0 }), o = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id}/organization/activate")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_activate_for_organization_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsActivateForUser.js
function KS(e, t, n) {
	return new $(qS(e, t, n));
}
async function qS(e, t, n) {
	let r = K(t, (e) => mv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ToolExecutionConfiguration, { explode: !0 }), o = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id}/user/activate")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_activate_for_user_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsActivateForWorkspace.js
function JS(e, t, n) {
	return new $(YS(e, t, n));
}
async function YS(e, t, n) {
	let r = K(t, (e) => hv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ToolExecutionConfiguration, { explode: !0 }), o = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id}/workspace/activate")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_activate_for_workspace_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsCallTool.js
function XS(e, t, n) {
	return new $(ZS(e, t, n));
}
async function ZS(e, t, n) {
	let r = K(t, (e) => gv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ConnectorCallToolRequest, { explode: !0 }), o = {
		connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
			explode: !1,
			charEncoding: "percent"
		}),
		tool_name: I("tool_name", i.tool_name, {
			explode: !1,
			charEncoding: "percent"
		})
	}, s = M("/v1/connectors/{connector_id_or_name}/tools/{tool_name}/call")(o), c = L({ credentials_name: i.credentials_name }), l = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), u = await J(e._options.apiKey), d = q(u == null ? {} : { apiKey: u }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_call_tool_v1",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: l,
		query: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(V(200, lu), B(422, Z), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsCreate.js
function QS(e, t, n) {
	return new $($S(e, t, n));
}
async function $S(e, t, n) {
	let r = K(t, (e) => yd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/connectors")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_create_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(201, $l), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsCreateOrUpdateOrganizationCredentials.js
function eC(e, t, n) {
	return new $(tC(e, t, n));
}
async function tC(e, t, n) {
	let r = K(t, (e) => _v.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.CredentialsCreateOrUpdate, { explode: !0 }), o = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id_or_name}/organization/credentials")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_create_or_update_organization_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsCreateOrUpdateUserCredentials.js
function nC(e, t, n) {
	return new $(rC(e, t, n));
}
async function rC(e, t, n) {
	let r = K(t, (e) => vv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.CredentialsCreateOrUpdate, { explode: !0 }), o = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id_or_name}/user/credentials")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_create_or_update_user_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsCreateOrUpdateWorkspaceCredentials.js
function iC(e, t, n) {
	return new $(aC(e, t, n));
}
async function aC(e, t, n) {
	let r = K(t, (e) => yv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.CredentialsCreateOrUpdate, { explode: !0 }), o = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id_or_name}/workspace/credentials")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_create_or_update_workspace_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDeactivateForOrganization.js
function oC(e, t, n) {
	return new $(sC(e, t, n));
}
async function sC(e, t, n) {
	let r = K(t, (e) => bv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id}/organization/deactivate")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_deactivate_for_organization_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDeactivateForUser.js
function cC(e, t, n) {
	return new $(lC(e, t, n));
}
async function lC(e, t, n) {
	let r = K(t, (e) => xv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id}/user/deactivate")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_deactivate_for_user_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDeactivateForWorkspace.js
function uC(e, t, n) {
	return new $(dC(e, t, n));
}
async function dC(e, t, n) {
	let r = K(t, (e) => Sv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id}/workspace/deactivate")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_deactivate_for_workspace_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDelete.js
function fC(e, t, n) {
	return new $(pC(e, t, n));
}
async function pC(e, t, n) {
	let r = K(t, (e) => Tv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id}#id")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_delete_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDeleteOrganizationCredentials.js
function mC(e, t, n) {
	return new $(hC(e, t, n));
}
async function hC(e, t, n) {
	let r = K(t, (e) => Cv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
			explode: !1,
			charEncoding: "percent"
		}),
		credentials_name: I("credentials_name", i.credentials_name, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/connectors/{connector_id_or_name}/organization/credentials/{credentials_name}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_delete_organization_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDeleteUserCredentials.js
function gC(e, t, n) {
	return new $(_C(e, t, n));
}
async function _C(e, t, n) {
	let r = K(t, (e) => wv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
			explode: !1,
			charEncoding: "percent"
		}),
		credentials_name: I("credentials_name", i.credentials_name, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/connectors/{connector_id_or_name}/user/credentials/{credentials_name}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_delete_user_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsDeleteWorkspaceCredentials.js
function vC(e, t, n) {
	return new $(yC(e, t, n));
}
async function yC(e, t, n) {
	let r = K(t, (e) => Ev.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
			explode: !1,
			charEncoding: "percent"
		}),
		credentials_name: I("credentials_name", i.credentials_name, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/connectors/{connector_id_or_name}/workspace/credentials/{credentials_name}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_delete_workspace_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Em), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsGet.js
function bC(e, t, n) {
	return new $(xC(e, t, n));
}
async function xC(e, t, n) {
	let r = K(t, (e) => kv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}#idOrName")(a), s = L({
		fetch_customer_data: i.fetch_customer_data,
		fetch_user_data: i.fetch_user_data
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_get_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, $l), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsGetAuthenticationMethods.js
function SC(e, t, n) {
	return new $(CC(e, t, n));
}
async function CC(e, t, n) {
	let r = K(t, (e) => Dv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}/authentication_methods")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_get_authentication_methods_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, v(Xl)), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsGetAuthUrl.js
function wC(e, t, n) {
	return new $(TC(e, t, n));
}
async function TC(e, t, n) {
	let r = K(t, (e) => Ov.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}/auth_url")(a), s = L({
		app_return_url: i.app_return_url,
		credentials_name: i.credentials_name,
		github_installation_link: i.github_installation_link,
		method_type: i.method_type
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_get_auth_url_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, fs), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsList.js
function EC(e, t, n) {
	return new $(DC(e, t, n));
}
async function DC(e, t, n) {
	let r = K(t, (e) => Pv.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/connectors")(), o = L({
		cursor: i?.cursor,
		page_size: i?.page_size,
		query_filters: i?.query_filters
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_list_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Zm), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsListOrganizationCredentials.js
function OC(e, t, n) {
	return new $(kC(e, t, n));
}
async function kC(e, t, n) {
	let r = K(t, (e) => Av.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}/organization/credentials")(a), s = L({
		auth_type: i.auth_type,
		fetch_default: i.fetch_default
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_list_organization_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, qd), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsListTools.js
function AC(e, t, n) {
	return new $(jC(e, t, n));
}
async function jC(e, t, n) {
	let r = K(t, (e) => jv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}/tools")(a), s = L({
		credentials_name: i.credentials_name,
		page: i.page,
		page_size: i.page_size,
		pretty: i.pretty,
		refresh: i.refresh
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_list_tools_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Mv), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsListUserCredentials.js
function MC(e, t, n) {
	return new $(NC(e, t, n));
}
async function NC(e, t, n) {
	let r = K(t, (e) => Nv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}/user/credentials")(a), s = L({
		auth_type: i.auth_type,
		fetch_default: i.fetch_default
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_list_user_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, qd), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsListWorkspaceCredentials.js
function PC(e, t, n) {
	return new $(FC(e, t, n));
}
async function FC(e, t, n) {
	let r = K(t, (e) => Fv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { connector_id_or_name: I("connector_id_or_name", i.connector_id_or_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/connectors/{connector_id_or_name}/workspace/credentials")(a), s = L({
		auth_type: i.auth_type,
		fetch_default: i.fetch_default
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_list_workspace_credentials_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, qd), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConnectorsUpdate.js
function IC(e, t, n) {
	return new $(LC(e, t, n));
}
async function LC(e, t, n) {
	let r = K(t, (e) => Iv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateConnectorRequest, { explode: !0 }), o = { connector_id: I("connector_id", i.connector_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/connectors/{connector_id}#id")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "connector_update_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, $l), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/connectors.js
var RC = class extends z {
	async create(e, t) {
		return P(QS(this, e, t));
	}
	async list(e, t) {
		return P(EC(this, e, t));
	}
	async getAuthUrl(e, t) {
		return P(wC(this, e, t));
	}
	async activateForOrganization(e, t) {
		return P(WS(this, e, t));
	}
	async deactivateForOrganization(e, t) {
		return P(oC(this, e, t));
	}
	async activateForWorkspace(e, t) {
		return P(JS(this, e, t));
	}
	async deactivateForWorkspace(e, t) {
		return P(uC(this, e, t));
	}
	async activateForUser(e, t) {
		return P(KS(this, e, t));
	}
	async deactivateForUser(e, t) {
		return P(cC(this, e, t));
	}
	async callTool(e, t) {
		return P(XS(this, e, t));
	}
	async listTools(e, t) {
		return P(AC(this, e, t));
	}
	async getAuthenticationMethods(e, t) {
		return P(SC(this, e, t));
	}
	async listOrganizationCredentials(e, t) {
		return P(OC(this, e, t));
	}
	async createOrUpdateOrganizationCredentials(e, t) {
		return P(eC(this, e, t));
	}
	async listWorkspaceCredentials(e, t) {
		return P(PC(this, e, t));
	}
	async createOrUpdateWorkspaceCredentials(e, t) {
		return P(iC(this, e, t));
	}
	async listUserCredentials(e, t) {
		return P(MC(this, e, t));
	}
	async createOrUpdateUserCredentials(e, t) {
		return P(nC(this, e, t));
	}
	async deleteOrganizationCredentials(e, t) {
		return P(mC(this, e, t));
	}
	async deleteWorkspaceCredentials(e, t) {
		return P(vC(this, e, t));
	}
	async deleteUserCredentials(e, t) {
		return P(gC(this, e, t));
	}
	async get(e, t) {
		return P(bC(this, e, t));
	}
	async update(e, t) {
		return P(IC(this, e, t));
	}
	async delete(e, t) {
		return P(fC(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsAppend.js
function zC(e, t, n) {
	return new $(BC(e, t, n));
}
async function BC(e, t, n) {
	let r = K(t, (e) => ev.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ConversationAppendRequest, { explode: !0 }), o = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/conversations/{conversation_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_append",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, sd), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsAppendStream.js
function VC(e, t, n) {
	return new $(HC(e, t, n));
}
async function HC(e, t, n) {
	let r = K(t, (e) => tv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ConversationAppendStreamRequest, { explode: !0 }), o = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/conversations/{conversation_id}#stream")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "text/event-stream"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_append_stream",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, h = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: p
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: p
	} }, [v] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: $u.parse(e)
	})))), B(422, Z), H("4XX"), H("5XX"))(g, p, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: p,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsDelete.js
function UC(e, t, n) {
	return new $(WC(e, t, n));
}
async function WC(e, t, n) {
	let r = K(t, (e) => nv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/conversations/{conversation_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsGet.js
function GC(e, t, n) {
	return new $(KC(e, t, n));
}
async function KC(e, t, n) {
	let r = K(t, (e) => rv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/conversations/{conversation_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, iv), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsGetHistory.js
function qC(e, t, n) {
	return new $(JC(e, t, n));
}
async function JC(e, t, n) {
	let r = K(t, (e) => av.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/conversations/{conversation_id}/history")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_history",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, ed), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsGetMessages.js
function YC(e, t, n) {
	return new $(XC(e, t, n));
}
async function XC(e, t, n) {
	let r = K(t, (e) => cv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/conversations/{conversation_id}/messages")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_messages",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, nd), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsList.js
function ZC(e, t, n) {
	return new $(QC(e, t, n));
}
async function QC(e, t, n) {
	let r = K(t, (e) => ov.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/conversations")(), o = Pr(L({
		page: i?.page,
		page_size: i?.page_size
	}), Ir({ metadata: i?.metadata }, { explode: !1 })), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_list",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, v(sv)), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsRestart.js
function $C(e, t, n) {
	return new $(ew(e, t, n));
}
async function ew(e, t, n) {
	let r = K(t, (e) => lv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ConversationRestartRequest, { explode: !0 }), o = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/conversations/{conversation_id}/restart")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_restart",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, sd), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsRestartStream.js
function tw(e, t, n) {
	return new $(nw(e, t, n));
}
async function nw(e, t, n) {
	let r = K(t, (e) => uv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ConversationRestartStreamRequest, { explode: !0 }), o = { conversation_id: I("conversation_id", i.conversation_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/conversations/{conversation_id}/restart#stream")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "text/event-stream"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_restart_stream",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, h = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: p
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: p
	} }, [v] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: $u.parse(e)
	})))), B(422, Z), H("4XX"), H("5XX"))(g, p, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: p,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsStart.js
function rw(e, t, n) {
	return new $(iw(e, t, n));
}
async function iw(e, t, n) {
	let r = K(t, (e) => od.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/conversations")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_start",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, sd), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaConversationsStartStream.js
function aw(e, t, n) {
	return new $(ow(e, t, n));
}
async function ow(e, t, n) {
	let r = K(t, (e) => md.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/conversations#stream")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "text/event-stream"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "agents_api_v1_conversations_start_stream",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, g = { HttpMeta: {
		Response: h,
		Request: f
	} }, [_] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: $u.parse(e)
	})))), B(422, Z), H("4XX"), H("5XX"))(h, f, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/conversations.js
var sw = class extends z {
	async start(e, t) {
		return P(rw(this, e, t));
	}
	async list(e, t) {
		return P(ZC(this, e, t));
	}
	async get(e, t) {
		return P(GC(this, e, t));
	}
	async delete(e, t) {
		return P(UC(this, e, t));
	}
	async append(e, t) {
		return P(zC(this, e, t));
	}
	async getHistory(e, t) {
		return P(qC(this, e, t));
	}
	async getMessages(e, t) {
		return P(YC(this, e, t));
	}
	async restart(e, t) {
		return P($C(this, e, t));
	}
	async startStream(e, t) {
		return P(aw(this, e, t));
	}
	async appendStream(e, t) {
		return P(VC(this, e, t));
	}
	async restartStream(e, t) {
		return P(tw(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesCreate.js
function cw(e, t, n) {
	return new $(lw(e, t, n));
}
async function lw(e, t, n) {
	let r = K(t, (e) => Vd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/libraries")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_create_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(201, Bp), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDelete.js
function uw(e, t, n) {
	return new $(dw(e, t, n));
}
async function dw(e, t, n) {
	let r = K(t, (e) => wb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/libraries/{library_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_delete_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Bp), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesGet.js
function fw(e, t, n) {
	return new $(pw(e, t, n));
}
async function pw(e, t, n) {
	let r = K(t, (e) => Lb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/libraries/{library_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_get_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Bp), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesLibrariesUpdateV1.js
function mw(e, t, n) {
	return new $(hw(e, t, n));
}
async function hw(e, t, n) {
	let r = K(t, (e) => Ub.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateLibraryRequest, { explode: !0 }), o = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/libraries/{library_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_update_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Bp), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesList.js
function gw(e, t, n) {
	return new $(_w(e, t, n));
}
async function _w(e, t, n) {
	let r = K(t, (e) => Rb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/libraries")(), o = L({
		filter_owned_by_me: i?.filter_owned_by_me,
		page: i?.page,
		page_size: i?.page_size,
		search: i?.search
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_list_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, am), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesUpdate.js
function vw(e, t, n) {
	return new $(yw(e, t, n));
}
async function yw(e, t, n) {
	let r = K(t, (e) => zb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateLibraryRequest, { explode: !0 }), o = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/libraries/{library_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_patch_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Bp), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesAccessesDelete.js
function bw(e, t, n) {
	return new $(xw(e, t, n));
}
async function xw(e, t, n) {
	let r = K(t, (e) => Vb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SharingDelete, { explode: !0 }), o = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/libraries/{library_id}/share")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_share_delete_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, om), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesAccessesList.js
function Sw(e, t, n) {
	return new $(Cw(e, t, n));
}
async function Cw(e, t, n) {
	let r = K(t, (e) => Hb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/libraries/{library_id}/share")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_share_list_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, sm), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesAccessesUpdateOrCreate.js
function ww(e, t, n) {
	return new $(Tw(e, t, n));
}
async function Tw(e, t, n) {
	let r = K(t, (e) => Bb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SharingRequest, { explode: !0 }), o = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/libraries/{library_id}/share")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_share_create_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, om), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/accesses.js
var Ew = class extends z {
	async list(e, t) {
		return P(Sw(this, e, t));
	}
	async updateOrCreate(e, t) {
		return P(ww(this, e, t));
	}
	async delete(e, t) {
		return P(bw(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsDelete.js
function Dw(e, t, n) {
	return new $(Ow(e, t, n));
}
async function Ow(e, t, n) {
	let r = K(t, (e) => Tb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/libraries/{library_id}/documents/{document_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_delete_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsExtractedTextSignedUrl.js
function kw(e, t, n) {
	return new $(Aw(e, t, n));
}
async function Aw(e, n, r) {
	let i = K(n, (e) => Eb.parse(e), "Input validation failed");
	if (!i.ok) return [i, { status: "invalid" }];
	let a = i.value, o = {
		document_id: I("document_id", a.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", a.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, s = M("/v1/libraries/{library_id}/documents/{document_id}/extracted-text-signed-url")(o), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: r?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_get_extracted_text_signed_url_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: r?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: r?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: r?.serverURL,
		path: s,
		headers: c,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: r?.timeoutMs || e._options.timeoutMs || 6e4
	}, r);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, t()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsGet.js
function jw(e, t, n) {
	return new $(Mw(e, t, n));
}
async function Mw(e, t, n) {
	let r = K(t, (e) => Ab.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/libraries/{library_id}/documents/{document_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_get_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Df), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsGetSignedUrl.js
function Nw(e, t, n) {
	return new $(Pw(e, t, n));
}
async function Pw(e, n, r) {
	let i = K(n, (e) => Db.parse(e), "Input validation failed");
	if (!i.ok) return [i, { status: "invalid" }];
	let a = i.value, o = {
		document_id: I("document_id", a.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", a.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, s = M("/v1/libraries/{library_id}/documents/{document_id}/signed-url")(o), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: r?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_get_signed_url_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: r?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: r?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: r?.serverURL,
		path: s,
		headers: c,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: r?.timeoutMs || e._options.timeoutMs || 6e4
	}, r);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, t()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsLibrariesDocumentsUpdateV1.js
function Fw(e, t, n) {
	return new $(Iw(e, t, n));
}
async function Iw(e, t, n) {
	let r = K(t, (e) => Pb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateDocumentRequest, { explode: !0 }), o = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, s = M("/v1/libraries/{library_id}/documents/{document_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_update_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Df), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsList.js
function Lw(e, t, n) {
	return new $(Rw(e, t, n));
}
async function Rw(e, t, n) {
	let r = K(t, (e) => jb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/libraries/{library_id}/documents")(a), s = L({
		filters_attributes: i.filters_attributes,
		page: i.page,
		page_size: i.page_size,
		search: i.search,
		sort_by: i.sort_by,
		sort_order: i.sort_order
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_list_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, em), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsReprocess.js
function zw(e, t, n) {
	return new $(Bw(e, t, n));
}
async function Bw(e, t, n) {
	let r = K(t, (e) => Nb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/libraries/{library_id}/documents/{document_id}/reprocess")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_reprocess_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsStatus.js
function Vw(e, t, n) {
	return new $(Hw(e, t, n));
}
async function Hw(e, t, n) {
	let r = K(t, (e) => Ob.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/libraries/{library_id}/documents/{document_id}/status")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_get_status_v1",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, uh), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsTextContent.js
function Uw(e, t, n) {
	return new $(Ww(e, t, n));
}
async function Ww(e, t, n) {
	let r = K(t, (e) => kb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/libraries/{library_id}/documents/{document_id}/text_content")(a), s = L({
		page_end: i.page_end,
		page_start: i.page_start
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_get_text_content_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Of), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsUpdate.js
function Gw(e, t, n) {
	return new $(Kw(e, t, n));
}
async function Kw(e, t, n) {
	let r = K(t, (e) => Mb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateDocumentRequest, { explode: !0 }), o = {
		document_id: I("document_id", i.document_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		library_id: I("library_id", i.library_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, s = M("/v1/libraries/{library_id}/documents/{document_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_patch_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Df), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaLibrariesDocumentsUpload.js
function qw(e, t, n) {
	return new $(Jw(e, t, n));
}
async function Jw(e, t, n) {
	let r = K(t, (e) => Ib.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = new FormData();
	if (Qo(i.RequestBody.file)) {
		let e = i.RequestBody.file;
		R(a, "file", await Rr(e), "name" in e ? e.name : void 0);
	} else if (Ux(i.RequestBody.file.content)) R(a, "file", Kn(await Wn(i.RequestBody.file.content), Gn(i.RequestBody.file.fileName) || "application/octet-stream"), i.RequestBody.file.fileName);
	else {
		let e = Gn(i.RequestBody.file.fileName) || "application/octet-stream";
		R(a, "file", Kn(i.RequestBody.file.content, e), i.RequestBody.file.fileName);
	}
	let o = { library_id: I("library_id", i.library_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/libraries/{library_id}/documents")(o), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "libraries_documents_upload_v1",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V([200, 201], Df), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/documents.js
var Yw = class extends z {
	async list(e, t) {
		return P(Lw(this, e, t));
	}
	async upload(e, t) {
		return P(qw(this, e, t));
	}
	async get(e, t) {
		return P(jw(this, e, t));
	}
	async update(e, t) {
		return P(Gw(this, e, t));
	}
	async librariesDocumentsUpdateV1(e, t) {
		return P(Fw(this, e, t));
	}
	async delete(e, t) {
		return P(Dw(this, e, t));
	}
	async textContent(e, t) {
		return P(Uw(this, e, t));
	}
	async status(e, t) {
		return P(Vw(this, e, t));
	}
	async getSignedUrl(e, t) {
		return P(Nw(this, e, t));
	}
	async extractedTextSignedUrl(e, t) {
		return P(kw(this, e, t));
	}
	async reprocess(e, t) {
		return P(zw(this, e, t));
	}
}, Xw = class extends z {
	_documents;
	get documents() {
		return this._documents ??= new Yw(this._options);
	}
	_accesses;
	get accesses() {
		return this._accesses ??= new Ew(this._options);
	}
	async list(e, t) {
		return P(gw(this, e, t));
	}
	async create(e, t) {
		return P(cw(this, e, t));
	}
	async get(e, t) {
		return P(fw(this, e, t));
	}
	async delete(e, t) {
		return P(uw(this, e, t));
	}
	async update(e, t) {
		return P(vw(this, e, t));
	}
	async librariesUpdateV1(e, t) {
		return P(mw(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityCampaignsCreate.js
function Zw(e, t, n) {
	return new $(Qw(e, t, n));
}
async function Qw(e, t, n) {
	let r = K(t, (e) => _d.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/observability/campaigns")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "create_campaign_v1_observability_campaigns_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(201, qs), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityCampaignsDelete.js
function $w(e, t, n) {
	return new $(eT(e, t, n));
}
async function eT(e, t, n) {
	let r = K(t, (e) => Rv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { campaign_id: I("campaign_id", i.campaign_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/campaigns/{campaign_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_campaign_v1_observability_campaigns__campaign_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityCampaignsFetch.js
function tT(e, t, n) {
	return new $(nT(e, t, n));
}
async function nT(e, t, n) {
	let r = K(t, (e) => ny.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { campaign_id: I("campaign_id", i.campaign_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/campaigns/{campaign_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_campaign_by_id_v1_observability_campaigns__campaign_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, qs), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityCampaignsFetchStatus.js
function rT(e, t, n) {
	return new $(iT(e, t, n));
}
async function iT(e, t, n) {
	let r = K(t, (e) => iy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { campaign_id: I("campaign_id", i.campaign_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/campaigns/{campaign_id}/status")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_campaign_status_by_id_v1_observability_campaigns__campaign_id__status_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Qf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityCampaignsList.js
function aT(e, t, n) {
	return new $(oT(e, t, n));
}
async function oT(e, t, n) {
	let r = K(t, (e) => ay.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/observability/campaigns")(), o = L({
		page: i?.page,
		page_size: i?.page_size,
		q: i?.q
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_campaigns_v1_observability_campaigns_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Gp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityCampaignsListEvents.js
function sT(e, t, n) {
	return new $(cT(e, t, n));
}
async function cT(e, t, n) {
	let r = K(t, (e) => ry.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { campaign_id: I("campaign_id", i.campaign_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/campaigns/{campaign_id}/selected-events")(a), s = L({
		page: i.page,
		page_size: i.page_size
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_campaign_selected_events_v1_observability_campaigns__campaign_id__selected_events_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Up), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/campaigns.js
var lT = class extends z {
	async create(e, t) {
		return P(Zw(this, e, t));
	}
	async list(e, t) {
		return P(aT(this, e, t));
	}
	async fetch(e, t) {
		return P(tT(this, e, t));
	}
	async delete(e, t) {
		return P($w(this, e, t));
	}
	async fetchStatus(e, t) {
		return P(rT(this, e, t));
	}
	async listEvents(e, t) {
		return P(sT(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsFetch.js
function uT(e, t, n) {
	return new $(dT(e, t, n));
}
async function dT(e, t, n) {
	let r = K(t, (e) => sy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { event_id: I("event_id", i.event_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/chat-completion-events/{event_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_chat_completion_event_v1_observability_chat_completion_events__event_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, tc), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsFetchSimilarEvents.js
function fT(e, t, n) {
	return new $(pT(e, t, n));
}
async function pT(e, t, n) {
	let r = K(t, (e) => Dy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { event_id: I("event_id", i.event_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/chat-completion-events/{event_id}/similar-events")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_similar_chat_completion_events_v1_observability_chat_completion_events__event_id__similar_events_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Th), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsJudge.js
function mT(e, t, n) {
	return new $(hT(e, t, n));
}
async function hT(e, t, n) {
	let r = K(t, (e) => xb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.JudgeChatCompletionEventRequest, { explode: !0 }), o = { event_id: I("event_id", i.event_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/chat-completion-events/{event_id}/live-judging")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "judge_chat_completion_event_v1_observability_chat_completion_events__event_id__live_judging_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Lp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsSearch.js
function gT(e, t, n) {
	return new $(_T(e, t, n));
}
async function _T(e, t, n) {
	let r = K(t, (e) => oy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SearchChatCompletionEventsRequest, { explode: !0 }), o = M("/v1/observability/chat-completion-events/search")(), s = L({
		cursor: i.cursor,
		page_size: i.page_size
	}), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_chat_completion_events_v1_observability_chat_completion_events_search_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Th), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsSearchIds.js
function vT(e, t, n) {
	return new $(yT(e, t, n));
}
async function yT(e, t, n) {
	let r = K(t, (e) => Sh.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/observability/chat-completion-events/search-ids")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_chat_completion_event_ids_v1_observability_chat_completion_events_search_ids_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Ch), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsFieldsFetchOptionCounts.js
function bT(e, t, n) {
	return new $(xT(e, t, n));
}
async function xT(e, t, n) {
	let r = K(t, (e) => cy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.FetchFieldOptionCountsRequest, { explode: !0 }), o = { field_name: I("field_name", i.field_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/chat-completion-fields/{field_name}/options-counts")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_chat_completion_field_options_counts_v1_observability_chat_completion_fields__field_name__options_counts_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, np), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsFieldsFetchOptions.js
function ST(e, t, n) {
	return new $(CT(e, t, n));
}
async function CT(e, t, n) {
	let r = K(t, (e) => uy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { field_name: I("field_name", i.field_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/chat-completion-fields/{field_name}/options")(a), s = L({ operator: i.operator }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_chat_completion_field_options_v1_observability_chat_completion_fields__field_name__options_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, $f), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityChatCompletionEventsFieldsList.js
function wT(e, t) {
	return new $(TT(e, t));
}
async function TT(e, t) {
	let n = M("/v1/observability/chat-completion-fields")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_chat_completion_fields_v1_observability_chat_completion_fields_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, d = { HttpMeta: {
		Response: u,
		Request: c
	} }, [f] = await U(V(200, Kp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(u, c, { extraFields: d });
	return f.ok, [f, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/fields.js
var ET = class extends z {
	async list(e) {
		return P(wT(this, e));
	}
	async fetchOptions(e, t) {
		return P(ST(this, e, t));
	}
	async fetchOptionCounts(e, t) {
		return P(bT(this, e, t));
	}
}, DT = class extends z {
	_fields;
	get fields() {
		return this._fields ??= new ET(this._options);
	}
	async search(e, t) {
		return P(gT(this, e, t));
	}
	async searchIds(e, t) {
		return P(vT(this, e, t));
	}
	async fetch(e, t) {
		return P(uT(this, e, t));
	}
	async fetchSimilarEvents(e, t) {
		return P(fT(this, e, t));
	}
	async judge(e, t) {
		return P(mT(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsCreate.js
function OT(e, t, n) {
	return new $(kT(e, t, n));
}
async function kT(e, t, n) {
	let r = K(t, (e) => xd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/observability/datasets")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "create_dataset_v1_observability_datasets_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(201, ff), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsCreateRecord.js
function AT(e, t, n) {
	return new $(jT(e, t, n));
}
async function jT(e, t, n) {
	let r = K(t, (e) => Lv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.CreateDatasetRecordRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}/records")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "create_dataset_record_v1_observability_datasets__dataset_id__records_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(201, hf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsDelete.js
function MT(e, t, n) {
	return new $(NT(e, t, n));
}
async function NT(e, t, n) {
	let r = K(t, (e) => Bv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/datasets/{dataset_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_dataset_v1_observability_datasets__dataset_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsExportToJsonl.js
function PT(e, t, n) {
	return new $(FT(e, t, n));
}
async function FT(e, t, n) {
	let r = K(t, (e) => Jv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/datasets/{dataset_id}/exports/to-jsonl")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "export_dataset_to_jsonl_v1_observability_datasets__dataset_id__exports_to_jsonl_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Bf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsFetch.js
function IT(e, t, n) {
	return new $(LT(e, t, n));
}
async function LT(e, t, n) {
	let r = K(t, (e) => dy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/datasets/{dataset_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_dataset_by_id_v1_observability_datasets__dataset_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, mf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsFetchTask.js
function RT(e, t, n) {
	return new $(zT(e, t, n));
}
async function zT(e, t, n) {
	let r = K(t, (e) => py.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		dataset_id: I("dataset_id", i.dataset_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		task_id: I("task_id", i.task_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/observability/datasets/{dataset_id}/tasks/{task_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_dataset_import_task_v1_observability_datasets__dataset_id__tasks__task_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, pf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsImportFromCampaign.js
function BT(e, t, n) {
	return new $(VT(e, t, n));
}
async function VT(e, t, n) {
	let r = K(t, (e) => tx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ImportDatasetFromCampaignRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}/imports/from-campaign")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "post_dataset_records_from_campaign_v1_observability_datasets__dataset_id__imports_from_campaign_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(202, pf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsImportFromDatasetRecords.js
function HT(e, t, n) {
	return new $(UT(e, t, n));
}
async function UT(e, t, n) {
	let r = K(t, (e) => nx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ImportDatasetFromDatasetRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}/imports/from-dataset")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "post_dataset_records_from_dataset_v1_observability_datasets__dataset_id__imports_from_dataset_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(202, pf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsImportFromExplorer.js
function WT(e, t, n) {
	return new $(GT(e, t, n));
}
async function GT(e, t, n) {
	let r = K(t, (e) => rx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ImportDatasetFromExplorerRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}/imports/from-explorer")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "post_dataset_records_from_explorer_v1_observability_datasets__dataset_id__imports_from_explorer_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(202, pf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsImportFromFile.js
function KT(e, t, n) {
	return new $(qT(e, t, n));
}
async function qT(e, t, n) {
	let r = K(t, (e) => ix.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ImportDatasetFromFileRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}/imports/from-file")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "post_dataset_records_from_file_v1_observability_datasets__dataset_id__imports_from_file_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(202, pf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsImportFromPlayground.js
function JT(e, t, n) {
	return new $(YT(e, t, n));
}
async function YT(e, t, n) {
	let r = K(t, (e) => ax.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ImportDatasetFromPlaygroundRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}/imports/from-playground")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "post_dataset_records_from_playground_v1_observability_datasets__dataset_id__imports_from_playground_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(202, pf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsList.js
function XT(e, t, n) {
	return new $(ZT(e, t, n));
}
async function ZT(e, t, n) {
	let r = K(t, (e) => gy.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/observability/datasets")(), o = L({
		page: i?.page,
		page_size: i?.page_size,
		q: i?.q
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_datasets_v1_observability_datasets_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Qp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsListRecords.js
function QT(e, t, n) {
	return new $($T(e, t, n));
}
async function $T(e, t, n) {
	let r = K(t, (e) => my.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/datasets/{dataset_id}/records")(a), s = L({
		page: i.page,
		page_size: i.page_size
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_dataset_records_v1_observability_datasets__dataset_id__records_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Xp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsListTasks.js
function eE(e, t, n) {
	return new $(tE(e, t, n));
}
async function tE(e, t, n) {
	let r = K(t, (e) => fy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/datasets/{dataset_id}/tasks")(a), s = L({
		page: i.page,
		page_size: i.page_size
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_dataset_import_tasks_v1_observability_datasets__dataset_id__tasks_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Jp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsUpdate.js
function nE(e, t, n) {
	return new $(rE(e, t, n));
}
async function rE(e, t, n) {
	let r = K(t, (e) => Mx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateDatasetRequest, { explode: !0 }), o = { dataset_id: I("dataset_id", i.dataset_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/datasets/{dataset_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_dataset_v1_observability_datasets__dataset_id__patch",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, mf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsRecordsBulkDelete.js
function iE(e, t, n) {
	return new $(aE(e, t, n));
}
async function aE(e, t, n) {
	let r = K(t, (e) => _f.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/observability/dataset-records/bulk-delete")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_dataset_records_v1_observability_dataset_records_bulk_delete_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsRecordsDelete.js
function oE(e, t, n) {
	return new $(sE(e, t, n));
}
async function sE(e, t, n) {
	let r = K(t, (e) => zv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_record_id: I("dataset_record_id", i.dataset_record_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/dataset-records/{dataset_record_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_dataset_record_v1_observability_dataset_records__dataset_record_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsRecordsFetch.js
function cE(e, t, n) {
	return new $(lE(e, t, n));
}
async function lE(e, t, n) {
	let r = K(t, (e) => hy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { dataset_record_id: I("dataset_record_id", i.dataset_record_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/dataset-records/{dataset_record_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_dataset_record_v1_observability_dataset_records__dataset_record_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, hf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsRecordsJudge.js
function uE(e, t, n) {
	return new $(dE(e, t, n));
}
async function dE(e, t, n) {
	let r = K(t, (e) => Cb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.JudgeDatasetRecordRequest, { explode: !0 }), o = { dataset_record_id: I("dataset_record_id", i.dataset_record_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/dataset-records/{dataset_record_id}/live-judging")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "judge_dataset_record_v1_observability_dataset_records__dataset_record_id__live_judging_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Lp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsRecordsUpdatePayload.js
function fE(e, t, n) {
	return new $(pE(e, t, n));
}
async function pE(e, t, n) {
	let r = K(t, (e) => Ax.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateDatasetRecordPayloadRequest, { explode: !0 }), o = { dataset_record_id: I("dataset_record_id", i.dataset_record_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/dataset-records/{dataset_record_id}/payload")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_dataset_record_payload_v1_observability_dataset_records__dataset_record_id__payload_put",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityDatasetsRecordsUpdateProperties.js
function mE(e, t, n) {
	return new $(hE(e, t, n));
}
async function hE(e, t, n) {
	let r = K(t, (e) => jx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateDatasetRecordPropertiesRequest, { explode: !0 }), o = { dataset_record_id: I("dataset_record_id", i.dataset_record_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/dataset-records/{dataset_record_id}/properties")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_dataset_record_properties_v1_observability_dataset_records__dataset_record_id__properties_put",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/records.js
var gE = class extends z {
	async fetch(e, t) {
		return P(cE(this, e, t));
	}
	async delete(e, t) {
		return P(oE(this, e, t));
	}
	async bulkDelete(e, t) {
		return P(iE(this, e, t));
	}
	async judge(e, t) {
		return P(uE(this, e, t));
	}
	async updatePayload(e, t) {
		return P(fE(this, e, t));
	}
	async updateProperties(e, t) {
		return P(mE(this, e, t));
	}
}, _E = class extends z {
	_records;
	get records() {
		return this._records ??= new gE(this._options);
	}
	async create(e, t) {
		return P(OT(this, e, t));
	}
	async list(e, t) {
		return P(XT(this, e, t));
	}
	async fetch(e, t) {
		return P(IT(this, e, t));
	}
	async delete(e, t) {
		return P(MT(this, e, t));
	}
	async update(e, t) {
		return P(nE(this, e, t));
	}
	async listRecords(e, t) {
		return P(QT(this, e, t));
	}
	async createRecord(e, t) {
		return P(AT(this, e, t));
	}
	async importFromCampaign(e, t) {
		return P(BT(this, e, t));
	}
	async importFromExplorer(e, t) {
		return P(WT(this, e, t));
	}
	async importFromFile(e, t) {
		return P(KT(this, e, t));
	}
	async importFromPlayground(e, t) {
		return P(JT(this, e, t));
	}
	async importFromDatasetRecords(e, t) {
		return P(HT(this, e, t));
	}
	async exportToJsonl(e, t) {
		return P(PT(this, e, t));
	}
	async fetchTask(e, t) {
		return P(RT(this, e, t));
	}
	async listTasks(e, t) {
		return P(eE(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityJudgesCreate.js
function vE(e, t, n) {
	return new $(yE(e, t, n));
}
async function yE(e, t, n) {
	let r = K(t, (e) => zd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/observability/judges")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "create_judge_v1_observability_judges_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(201, Ks), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityJudgesDelete.js
function bE(e, t, n) {
	return new $(xE(e, t, n));
}
async function xE(e, t, n) {
	let r = K(t, (e) => Vv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { judge_id: I("judge_id", i.judge_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/judges/{judge_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_judge_v1_observability_judges__judge_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityJudgesFetch.js
function SE(e, t, n) {
	return new $(CE(e, t, n));
}
async function CE(e, t, n) {
	let r = K(t, (e) => vy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { judge_id: I("judge_id", i.judge_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/judges/{judge_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_judge_by_id_v1_observability_judges__judge_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Ks), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityJudgesJudgeConversation.js
function wE(e, t, n) {
	return new $(TE(e, t, n));
}
async function TE(e, t, n) {
	let r = K(t, (e) => Sb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.JudgeConversationRequest, { explode: !0 }), o = { judge_id: I("judge_id", i.judge_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/judges/{judge_id}/live-judging")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "judge_conversation_v1_observability_judges__judge_id__live_judging_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Lp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityJudgesList.js
function EE(e, t, n) {
	return new $(DE(e, t, n));
}
async function DE(e, t, n) {
	let r = K(t, (e) => yy.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/observability/judges")(), o = L({
		model_filter: i?.model_filter,
		page: i?.page,
		page_size: i?.page_size,
		q: i?.q,
		type_filter: i?.type_filter
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_judges_v1_observability_judges_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, im), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityJudgesUpdate.js
function OE(e, t, n) {
	return new $(kE(e, t, n));
}
async function kE(e, t, n) {
	let r = K(t, (e) => Nx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateJudgeRequest, { explode: !0 }), o = { judge_id: I("judge_id", i.judge_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/observability/judges/{judge_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_judge_v1_observability_judges__judge_id__put",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/judges.js
var AE = class extends z {
	async create(e, t) {
		return P(vE(this, e, t));
	}
	async list(e, t) {
		return P(EE(this, e, t));
	}
	async fetch(e, t) {
		return P(SE(this, e, t));
	}
	async delete(e, t) {
		return P(bE(this, e, t));
	}
	async update(e, t) {
		return P(OE(this, e, t));
	}
	async judgeConversation(e, t) {
		return P(wE(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityLogsFetchOptions.js
function jE(e, t, n) {
	return new $(ME(e, t, n));
}
async function ME(e, t, n) {
	let r = K(t, (e) => by.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { field_name: I("field_name", i.field_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/logs/fields/{field_name}/options")(a), s = L({
		from: i.from,
		to: i.to
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_log_field_options_v1_observability_logs_fields__field_name__options_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, up), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityLogsList.js
function NE(e, t) {
	return new $(PE(e, t));
}
async function PE(e, t) {
	let n = M("/v1/observability/logs/fields")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_log_fields_v1_observability_logs_fields_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, d = { HttpMeta: {
		Response: u,
		Request: c
	} }, [f] = await U(V(200, gp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(u, c, { extraFields: d });
	return f.ok, [f, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityLogsSearch.js
function FE(e, t, n) {
	return new $(IE(e, t, n));
}
async function IE(e, t, n) {
	let r = K(t, (e) => fx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.LogsRequest, { explode: !0 }), o = M("/v1/observability/logs/search")(), s = L({
		cursor: i.cursor,
		from: i.from,
		page_size: i.page_size,
		to: i.to
	}), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "search_logs_v1_observability_logs_search_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, _p), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/logs.js
var LE = class extends z {
	async search(e, t) {
		return P(FE(this, e, t));
	}
	async list(e) {
		return P(NE(this, e));
	}
	async fetchOptions(e, t) {
		return P(jE(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansFetchSpanEvalFieldOptions.js
function RE(e, t, n) {
	return new $(zE(e, t, n));
}
async function zE(e, t, n) {
	let r = K(t, (e) => ky.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { field_name: I("field_name", i.field_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/spans/evaluations/fields/{field_name}/options")(a), s = L({
		from: i.from,
		to: i.to
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_span_evaluation_field_options_v1_observability_spans_evaluations_fields__field_name__options_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, yp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansFetchSpanFieldOptions.js
function BE(e, t, n) {
	return new $(VE(e, t, n));
}
async function VE(e, t, n) {
	let r = K(t, (e) => Ay.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { field_name: I("field_name", i.field_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/spans/fields/{field_name}/options")(a), s = L({
		from: i.from,
		to: i.to
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_span_field_options_v1_observability_spans_fields__field_name__options_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Sp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansListSpanEvalFields.js
function HE(e, t) {
	return new $(UE(e, t));
}
async function UE(e, t) {
	let n = M("/v1/observability/spans/evaluations/fields")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_span_evaluation_fields_v1_observability_spans_evaluations_fields_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, d = { HttpMeta: {
		Response: u,
		Request: c
	} }, [f] = await U(V(200, bp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(u, c, { extraFields: d });
	return f.ok, [f, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansListSpanFields.js
function WE(e, t) {
	return new $(GE(e, t));
}
async function GE(e, t) {
	let n = M("/v1/observability/spans/fields")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_span_fields_v1_observability_spans_fields_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, d = { HttpMeta: {
		Response: u,
		Request: c
	} }, [f] = await U(V(200, Cp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(u, c, { extraFields: d });
	return f.ok, [f, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansSearchLatestSpanEvaluations.js
function KE(e, t, n) {
	return new $(qE(e, t, n));
}
async function qE(e, t, n) {
	let r = K(t, (e) => dx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SpanEvaluationsRequest, { explode: !0 }), o = M("/v1/observability/spans/evaluations/search/latest")(), s = L({
		cursor: i.cursor,
		from: i.from,
		page_size: i.page_size,
		to: i.to
	}), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "search_latest_span_evaluations_v1_observability_spans_evaluations_search_latest_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, xp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansSearchSpanEvaluations.js
function JE(e, t, n) {
	return new $(YE(e, t, n));
}
async function YE(e, t, n) {
	let r = K(t, (e) => px.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SpanEvaluationsRequest, { explode: !0 }), o = M("/v1/observability/spans/evaluations/search")(), s = L({
		cursor: i.cursor,
		from: i.from,
		page_size: i.page_size,
		to: i.to
	}), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "search_span_evaluations_v1_observability_spans_evaluations_search_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, xp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilitySpansSearchSpans.js
function XE(e, t, n) {
	return new $(ZE(e, t, n));
}
async function ZE(e, t, n) {
	let r = K(t, (e) => mx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SpansRequest, { explode: !0 }), o = M("/v1/observability/spans/search")(), s = L({
		cursor: i.cursor,
		from: i.from,
		page_size: i.page_size,
		to: i.to
	}), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "search_spans_v1_observability_spans_search_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, wp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/spans.js
var QE = class extends z {
	async searchSpans(e, t) {
		return P(XE(this, e, t));
	}
	async searchSpanEvaluations(e, t) {
		return P(JE(this, e, t));
	}
	async searchLatestSpanEvaluations(e, t) {
		return P(KE(this, e, t));
	}
	async listSpanFields(e) {
		return P(WE(this, e));
	}
	async listSpanEvalFields(e) {
		return P(HE(this, e));
	}
	async fetchSpanFieldOptions(e, t) {
		return P(BE(this, e, t));
	}
	async fetchSpanEvalFieldOptions(e, t) {
		return P(RE(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityTracesFetchOptions.js
function $E(e, t, n) {
	return new $(eD(e, t, n));
}
async function eD(e, t, n) {
	let r = K(t, (e) => Fy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { field_name: I("field_name", i.field_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/traces/fields/{field_name}/options")(a), s = L({
		from: i.from,
		to: i.to
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_trace_field_options_v1_observability_traces_fields__field_name__options_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Tp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityTracesGetSpanById.js
function tD(e, t, n) {
	return new $(nD(e, t, n));
}
async function nD(e, t, n) {
	let r = K(t, (e) => Oy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = {
		span_id: I("span_id", i.span_id, {
			explode: !1,
			charEncoding: "percent"
		}),
		trace_id: I("trace_id", i.trace_id, {
			explode: !1,
			charEncoding: "percent"
		})
	}, o = M("/v1/observability/traces/{trace_id}/spans/{span_id}")(a), s = L({
		from: i.from,
		to: i.to
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_span_by_id_v1_observability_traces__trace_id__spans__span_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Gf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityTracesGetTraceById.js
function rD(e, t, n) {
	return new $(iD(e, t, n));
}
async function iD(e, t, n) {
	let r = K(t, (e) => Py.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { trace_id: I("trace_id", i.trace_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/traces/{trace_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_trace_by_id_v1_observability_traces__trace_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Xf), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityTracesGetTraceFields.js
function aD(e, t) {
	return new $(oD(e, t));
}
async function oD(e, t) {
	let n = M("/v1/observability/traces/fields")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_trace_fields_v1_observability_traces_fields_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, d = { HttpMeta: {
		Response: u,
		Request: c
	} }, [f] = await U(V(200, Ep), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(u, c, { extraFields: d });
	return f.ok, [f, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityTracesGetTraceSpans.js
function sD(e, t, n) {
	return new $(cD(e, t, n));
}
async function cD(e, t, n) {
	let r = K(t, (e) => Iy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { trace_id: I("trace_id", i.trace_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/observability/traces/{trace_id}/spans")(a), s = L({
		cursor: i.cursor,
		from: i.from,
		page_size: i.page_size,
		to: i.to
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_trace_spans_v1_observability_traces__trace_id__spans_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, wp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaObservabilityTracesSearch.js
function lD(e, t, n) {
	return new $(uD(e, t, n));
}
async function uD(e, t, n) {
	let r = K(t, (e) => hx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.TracesRequest, { explode: !0 }), o = M("/v1/observability/traces/search")(), s = L({
		cursor: i.cursor,
		from: i.from,
		page_size: i.page_size,
		to: i.to
	}), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "search_traces_v1_observability_traces_search_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Dp), B([
		400,
		404,
		408,
		409,
		422
	], Q), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/traces.js
var dD = class extends z {
	async search(e, t) {
		return P(lD(this, e, t));
	}
	async getTraceFields(e) {
		return P(aD(this, e));
	}
	async getTraceById(e, t) {
		return P(rD(this, e, t));
	}
	async getTraceSpans(e, t) {
		return P(sD(this, e, t));
	}
	async fetchOptions(e, t) {
		return P($E(this, e, t));
	}
	async getSpanById(e, t) {
		return P(tD(this, e, t));
	}
}, fD = class extends z {
	_chatCompletionEvents;
	get chatCompletionEvents() {
		return this._chatCompletionEvents ??= new DT(this._options);
	}
	_judges;
	get judges() {
		return this._judges ??= new AE(this._options);
	}
	_campaigns;
	get campaigns() {
		return this._campaigns ??= new lT(this._options);
	}
	_datasets;
	get datasets() {
		return this._datasets ??= new _E(this._options);
	}
	_logs;
	get logs() {
		return this._logs ??= new LE(this._options);
	}
	_traces;
	get traces() {
		return this._traces ??= new dD(this._options);
	}
	_spans;
	get spans() {
		return this._spans ??= new QE(this._options);
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaRagIngestionPipelineConfigurationsList.js
function pD(e, t) {
	return new $(mD(e, t));
}
async function mD(e, t) {
	let n = M("/v1/rag/ingestion_pipeline_configurations")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_configs_v1_rag_ingestion_pipeline_configurations_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, [d] = await U(V(200, v(Np)), H("4XX"), H("5XX"))(u, c);
	return d.ok, [d, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaRagIngestionPipelineConfigurationsRegister.js
function hD(e, t, n) {
	return new $(gD(e, t, n));
}
async function gD(e, t, n) {
	let r = K(t, (e) => Rd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/rag/ingestion_pipeline_configurations")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "register_config_v1_rag_ingestion_pipeline_configurations_put",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Np), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaRagIngestionPipelineConfigurationsUpdateRunInfo.js
function _D(e, t, n) {
	return new $(vD(e, t, n));
}
async function vD(e, t, n) {
	let r = K(t, (e) => Px.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateRunInfo, { explode: !0 }), o = { id: I("id", i.id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/rag/ingestion_pipeline_configurations/{id}/run_info")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_run_info_v1_rag_ingestion_pipeline_configurations__id__run_info_put",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Np), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/ingestionpipelineconfigurations.js
var yD = class extends z {
	async list(e) {
		return P(pD(this, e));
	}
	async register(e, t) {
		return P(hD(this, e, t));
	}
	async updateRunInfo(e, t) {
		return P(_D(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaRagSearchIndexesList.js
function bD(e, t) {
	return new $(xD(e, t));
}
async function xD(e, t) {
	let n = M("/v1/rag/search_index")(), r = new Headers(G({ Accept: "application/json" })), i = await J(e._options.apiKey), a = q(i == null ? {} : { apiKey: i }), o = {
		options: e._options,
		baseURL: t?.serverURL ?? e._baseURL ?? "",
		operationID: "get_search_indexes_v1_rag_search_index_get",
		oAuth2Scopes: null,
		resolvedSecurity: a,
		securitySource: e._options.apiKey,
		retryConfig: t?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: t?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, s = e._createRequest(o, {
		security: a,
		method: "GET",
		baseURL: t?.serverURL,
		path: n,
		headers: r,
		userAgent: e._options.userAgent,
		timeoutMs: t?.timeoutMs || e._options.timeoutMs || 6e4
	}, t);
	if (!s.ok) return [s, { status: "invalid" }];
	let c = s.value, l = await e._do(c, {
		context: o,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: o.retryConfig,
		retryCodes: o.retryCodes
	});
	if (!l.ok) return [l, {
		status: "request-error",
		request: c
	}];
	let u = l.value, [d] = await U(V(200, v(kh)), H("4XX"), H("5XX"))(u, c);
	return d.ok, [d, {
		status: "complete",
		request: c,
		response: u
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/betaRagSearchIndexesRegister.js
function SD(e, t, n) {
	return new $(CD(e, t, n));
}
async function CD(e, t, n) {
	let r = K(t, (e) => Gd.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/rag/search_index")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "register_search_index_v1_rag_search_index_put",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, kh), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/searchindexes.js
var wD = class extends z {
	async list(e) {
		return P(bD(this, e));
	}
	async register(e, t) {
		return P(SD(this, e, t));
	}
}, TD = class extends z {
	_ingestionPipelineConfigurations;
	get ingestionPipelineConfigurations() {
		return this._ingestionPipelineConfigurations ??= new yD(this._options);
	}
	_searchIndexes;
	get searchIndexes() {
		return this._searchIndexes ??= new wD(this._options);
	}
}, ED = class extends z {
	_conversations;
	get conversations() {
		return this._conversations ??= new sw(this._options);
	}
	_agents;
	get agents() {
		return this._agents ??= new US(this._options);
	}
	_libraries;
	get libraries() {
		return this._libraries ??= new Xw(this._options);
	}
	_observability;
	get observability() {
		return this._observability ??= new fD(this._options);
	}
	_connectors;
	get connectors() {
		return this._connectors ??= new RC(this._options);
	}
	_rag;
	get rag() {
		return this._rag ??= new TD(this._options);
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/chatComplete.js
function DD(e, t, n) {
	return new $(OD(e, t, n));
}
async function OD(e, t, n) {
	let r = K(t, (e) => rc.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/chat/completions")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "chat_completion_v1_chat_completions_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, oc), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/chatStream.js
function kD(e, t, n) {
	return new $(AD(e, t, n));
}
async function AD(e, t, n) {
	let r = K(t, (e) => sc.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/chat/completions#stream")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "text/event-stream"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "stream_chat",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, g = { HttpMeta: {
		Response: h,
		Request: f
	} }, [_] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => e.data === "[DONE]" ? {
		done: !0,
		value: void 0
	} : {
		done: !1,
		value: Hc.parse(e)
	}))), B(422, Z), H("4XX"), H("5XX"))(h, f, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/extra/structChat.js
function jD(e) {
	if (typeof e != "object" || !e) return e;
	let t = { ...e };
	if (t.type === "object" && t.properties && typeof t.properties == "object") {
		let e = new Set(Array.isArray(t.required) ? t.required : []), n = {};
		for (let [r, i] of Object.entries(t.properties)) {
			let t = jD(i);
			e.has(r) ? n[r] = t : (e.add(r), n[r] = Array.isArray(t.type) ? t.type.includes("null") ? t : {
				...t,
				type: [...t.type, "null"]
			} : Array.isArray(t.anyOf) ? t.anyOf.some((e) => e.type === "null") ? t : {
				...t,
				anyOf: [...t.anyOf, { type: "null" }]
			} : t.type ? {
				...t,
				type: [t.type, "null"]
			} : t);
		}
		t.properties = n, t.required = [...e], t.additionalProperties = !1;
	}
	t.items &&= jD(t.items);
	for (let e of [
		"anyOf",
		"oneOf",
		"allOf"
	]) Array.isArray(t[e]) && (t[e] = t[e].map(jD));
	for (let e of ["$defs", "definitions"]) if (t[e] && typeof t[e] == "object") {
		let n = {};
		for (let [r, i] of Object.entries(t[e])) n[r] = jD(i);
		t[e] = n;
	}
	return t;
}
function MD(e) {
	let t;
	return t = "_zod" in e ? a(e) : zn(e, { target: "openAi" }), delete t.$schema, jD(t);
}
function ND(e) {
	let { responseFormat: t, ...n } = e, r = FD(t);
	return {
		...n,
		...r ? { responseFormat: r } : {}
	};
}
function PD(e, t) {
	if (e.choices === void 0 || e.choices.length === 0) return {
		...e,
		choices: e.choices === void 0 ? void 0 : []
	};
	let n = [];
	for (let r of e.choices) if (r.message === null || r.message === void 0) n.push({
		...r,
		message: void 0
	});
	else if (r.message.content !== null && r.message.content !== void 0 && !Array.isArray(r.message.content)) {
		let e;
		try {
			e = t.safeParse(JSON.parse(r.message.content)).data;
		} catch {
			e = void 0;
		}
		n.push({
			...r,
			message: {
				...r.message,
				parsed: e
			}
		});
	} else n.push({
		...r,
		message: {
			...r.message,
			parsed: void 0
		}
	});
	return {
		...e,
		choices: n
	};
}
function FD(e) {
	return {
		type: "json_schema",
		jsonSchema: {
			name: "placeholderName",
			schemaDefinition: MD(e),
			strict: !0
		}
	};
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/chat.js
var ID = class extends z {
	async parse(e, t) {
		let n = ND(e);
		return PD(await P(DD(this, n, t)), e.responseFormat);
	}
	async parseStream(e, t) {
		let n = ND(e);
		return P(kD(this, n, t));
	}
	async complete(e, t) {
		return P(DD(this, e, t));
	}
	async stream(e, t) {
		return P(kD(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/classifiersClassify.js
function LD(e, t, n) {
	return new $(RD(e, t, n));
}
async function RD(e, t, n) {
	let r = K(t, (e) => dc.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/classifications")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "classifications_v1_classifications_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, pc), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/classifiersClassifyChat.js
function zD(e, t, n) {
	return new $(BD(e, t, n));
}
async function BD(e, t, n) {
	let r = K(t, (e) => Xs.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/chat/classifications")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "chat_classifications_v1_chat_classifications_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, pc), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/classifiersModerate.js
function VD(e, t, n) {
	return new $(HD(e, t, n));
}
async function HD(e, t, n) {
	let r = K(t, (e) => dc.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/moderations")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "moderations_v1_moderations_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Mm), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/classifiersModerateChat.js
function UD(e, t, n) {
	return new $(WD(e, t, n));
}
async function WD(e, t, n) {
	let r = K(t, (e) => cc.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/chat/moderations")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "chat_moderations_v1_chat_moderations_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Mm), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/classifiers.js
var GD = class extends z {
	async moderate(e, t) {
		return P(VD(this, e, t));
	}
	async moderateChat(e, t) {
		return P(UD(this, e, t));
	}
	async classify(e, t) {
		return P(LD(this, e, t));
	}
	async classifyChat(e, t) {
		return P(zD(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/embeddingsCreate.js
function KD(e, t, n) {
	return new $(qD(e, t, n));
}
async function qD(e, t, n) {
	let r = K(t, (e) => jf.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/embeddings")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "embeddings_v1_embeddings_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Nf), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/embeddings.js
var JD = class extends z {
	async create(e, t) {
		return P(KD(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/eventsGetStreamEvents.js
function YD(e, t, n) {
	return new $(XD(e, t, n));
}
async function XD(e, t, n) {
	let r = K(t, (e) => My.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows/events/stream")(), o = L({
		activity_id: i?.activity_id,
		activity_name: i?.activity_name,
		metadata_filters: i?.metadata_filters,
		parent_workflow_exec_id: i?.parent_workflow_exec_id,
		root_workflow_exec_id: i?.root_workflow_exec_id,
		scope: i?.scope,
		start_seq: i?.start_seq,
		stream: i?.stream,
		workflow_event_types: i?.workflow_event_types,
		workflow_exec_id: i?.workflow_exec_id,
		workflow_name: i?.workflow_name
	}), s = new Headers(G({
		Accept: "text/event-stream",
		"last-event-id": I("last-event-id", i?.["last-event-id"], {
			explode: !1,
			charEncoding: "none"
		})
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_stream_events_v1_workflows_events_stream_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, g = { HttpMeta: {
		Response: h,
		Request: f
	} }, [_] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: Ny.parse(e)
	}), { dataRequired: !1 }))), B(422, Z), H("4XX"), H("5XX"))(h, f, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/eventsGetWorkflowEvents.js
function ZD(e, t, n) {
	return new $(QD(e, t, n));
}
async function QD(e, t, n) {
	let r = K(t, (e) => zy.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows/events/list")(), o = L({
		cursor: i?.cursor,
		limit: i?.limit,
		root_workflow_exec_id: i?.root_workflow_exec_id,
		workflow_exec_id: i?.workflow_exec_id,
		workflow_run_id: i?.workflow_run_id
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_events_v1_workflows_events_list_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Sm), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/events.js
var $D = class extends z {
	async getStreamEvents(e, t) {
		return P(YD(this, e, t));
	}
	async getWorkflowEvents(e, t) {
		return P(ZD(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/filesDelete.js
function eO(e, t, n) {
	return new $(tO(e, t, n));
}
async function tO(e, t, n) {
	let r = K(t, (e) => Yv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { file_id: I("file_id", i.file_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/files/{file_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "files_api_routes_delete_file",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, vf), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/filesDownload.js
function nO(e, t, n) {
	return new $(rO(e, t, n));
}
async function rO(e, t, n) {
	let r = K(t, (e) => Xv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { file_id: I("file_id", i.file_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/files/{file_id}/content")(a), s = new Headers(G({ Accept: "application/octet-stream" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "files_api_routes_download_file",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, [g] = await U(fi(200, m((e) => e instanceof ReadableStream)), H("4XX"), H("5XX"))(h, f);
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/filesGetSignedUrl.js
function iO(e, t, n) {
	return new $(aO(e, t, n));
}
async function aO(e, t, n) {
	let r = K(t, (e) => Zv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { file_id: I("file_id", i.file_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/files/{file_id}/url")(a), s = L({ expiry: i.expiry }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "files_api_routes_get_signed_url",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, [g] = await U(V(200, vp), H("4XX"), H("5XX"))(h, p);
	return g.ok, [g, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/filesList.js
function oO(e, t, n) {
	return new $(sO(e, t, n));
}
async function sO(e, t, n) {
	let r = K(t, (e) => Qv.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/files")(), o = L({
		include_total: i?.include_total,
		mimetypes: i?.mimetypes,
		page: i?.page,
		page_size: i?.page_size,
		purpose: i?.purpose,
		sample_type: i?.sample_type,
		search: i?.search,
		source: i?.source
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "files_api_routes_list_files",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, tm), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/filesRetrieve.js
function cO(e, t, n) {
	return new $(lO(e, t, n));
}
async function lO(e, t, n) {
	let r = K(t, (e) => $v.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { file_id: I("file_id", i.file_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/files/{file_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "files_api_routes_retrieve_file",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, lp), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/filesUpload.js
function uO(e, t, n) {
	return new $(dO(e, t, n));
}
async function dO(e, t, n) {
	let r = K(t, (e) => ty.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = new FormData();
	if (Qo(i.file)) {
		let e = i.file;
		R(a, "file", await Rr(e), "name" in e ? e.name : void 0);
	} else if (Ux(i.file.content)) R(a, "file", Kn(await Wn(i.file.content), Gn(i.file.fileName) || "application/octet-stream"), i.file.fileName);
	else {
		let e = Gn(i.file.fileName) || "application/octet-stream";
		R(a, "file", Kn(i.file.content, e), i.file.fileName);
	}
	i.expiry !== void 0 && R(a, "expiry", i.expiry), i.purpose !== void 0 && R(a, "purpose", i.purpose), i.visibility !== void 0 && R(a, "visibility", i.visibility);
	let o = M("/v1/files")(), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "files_api_routes_upload_file",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, Md), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/files.js
var fO = class extends z {
	async upload(e, t) {
		return P(uO(this, e, t));
	}
	async list(e, t) {
		return P(oO(this, e, t));
	}
	async retrieve(e, t) {
		return P(cO(this, e, t));
	}
	async delete(e, t) {
		return P(eO(this, e, t));
	}
	async download(e, t) {
		return P(nO(this, e, t));
	}
	async getSignedUrl(e, t) {
		return P(iO(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fimComplete.js
function pO(e, t, n) {
	return new $(mO(e, t, n));
}
async function mO(e, t, n) {
	let r = K(t, (e) => ap.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/fim/completions")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "fim_completion_v1_fim_completions_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, op), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fimStream.js
function hO(e, t, n) {
	return new $(gO(e, t, n));
}
async function gO(e, t, n) {
	let r = K(t, (e) => sp.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/fim/completions#stream")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "text/event-stream"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "stream_fim",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let h = p.value, g = { HttpMeta: {
		Response: h,
		Request: f
	} }, [_] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => e.data === "[DONE]" ? {
		done: !0,
		value: void 0
	} : {
		done: !1,
		value: Hc.parse(e)
	}))), B(422, Z), H("4XX"), H("5XX"))(h, f, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: f,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/fim.js
var _O = class extends z {
	async complete(e, t) {
		return P(pO(this, e, t));
	}
	async stream(e, t) {
		return P(hO(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fineTuningJobsCancel.js
function vO(e, t, n) {
	return new $(yO(e, t, n));
}
async function yO(e, t, n) {
	let r = K(t, (e) => lb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { job_id: I("job_id", i.job_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/fine_tuning/jobs/{job_id}/cancel")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_cancel_fine_tuning_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, ub), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fineTuningJobsCreate.js
function bO(e, t, n) {
	return new $(xO(e, t, n));
}
async function xO(e, t, n) {
	let r = K(t, (e) => Ld.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/fine_tuning/jobs")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_create_fine_tuning_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, db), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fineTuningJobsGet.js
function SO(e, t, n) {
	return new $(CO(e, t, n));
}
async function CO(e, t, n) {
	let r = K(t, (e) => fb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { job_id: I("job_id", i.job_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/fine_tuning/jobs/{job_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_get_fine_tuning_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, pb), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fineTuningJobsList.js
function wO(e, t, n) {
	return new $(TO(e, t, n));
}
async function TO(e, t, n) {
	let r = K(t, (e) => hb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/fine_tuning/jobs")(), o = L({
		created_after: i?.created_after,
		created_before: i?.created_before,
		created_by_me: i?.created_by_me,
		model: i?.model,
		page: i?.page,
		page_size: i?.page_size,
		status: i?.status,
		suffix: i?.suffix,
		wandb_name: i?.wandb_name,
		wandb_project: i?.wandb_project
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_get_fine_tuning_jobs",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, nm), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/fineTuningJobsStart.js
function EO(e, t, n) {
	return new $(DO(e, t, n));
}
async function DO(e, t, n) {
	let r = K(t, (e) => gb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { job_id: I("job_id", i.job_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/fine_tuning/jobs/{job_id}/start")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_start_fine_tuning_job",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, _b), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/finetuningjobs.js
var OO = class extends z {
	async list(e, t) {
		return P(wO(this, e, t));
	}
	async create(e, t) {
		return P(bO(this, e, t));
	}
	async get(e, t) {
		return P(SO(this, e, t));
	}
	async cancel(e, t) {
		return P(vO(this, e, t));
	}
	async start(e, t) {
		return P(EO(this, e, t));
	}
}, kO = class extends z {
	_jobs;
	get jobs() {
		return this._jobs ??= new OO(this._options);
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/modelsArchive.js
function AO(e, t, n) {
	return new $(jO(e, t, n));
}
async function jO(e, t, n) {
	let r = K(t, (e) => cb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { model_id: I("model_id", i.model_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/fine_tuning/models/{model_id}/archive")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_archive_fine_tuned_model",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, Yo), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/modelsDelete.js
function MO(e, t, n) {
	return new $(NO(e, t, n));
}
async function NO(e, t, n) {
	let r = K(t, (e) => Hv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { model_id: I("model_id", i.model_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/models/{model_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "delete_model_v1_models__model_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, yf), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/modelsList.js
function PO(e, t, n) {
	return new $(FO(e, t, n));
}
async function FO(e, t, n) {
	let r = K(t, (e) => Gb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/models")(), o = L({
		model: i?.model,
		provider: i?.provider
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "list_models_v1_models_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Am), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/modelsRetrieve.js
function IO(e, t, n) {
	return new $(LO(e, t, n));
}
async function LO(e, t, n) {
	let r = K(t, (e) => lx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { model_id: I("model_id", i.model_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/models/{model_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "retrieve_model_v1_models__model_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, ux), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/modelsUnarchive.js
function RO(e, t, n) {
	return new $(zO(e, t, n));
}
async function zO(e, t, n) {
	let r = K(t, (e) => vb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { model_id: I("model_id", i.model_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/fine_tuning/models/{model_id}/archive")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_unarchive_fine_tuned_model",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, [h] = await U(V(200, bg), H("4XX"), H("5XX"))(m, f);
	return h.ok, [h, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/modelsUpdate.js
function BO(e, t, n) {
	return new $(VO(e, t, n));
}
async function VO(e, t, n) {
	let r = K(t, (e) => yb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateModelRequest, { explode: !0 }), o = { model_id: I("model_id", i.model_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/fine_tuning/models/{model_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "jobs_api_routes_fine_tuning_update_fine_tuned_model",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, [g] = await U(V(200, bb), H("4XX"), H("5XX"))(h, p);
	return g.ok, [g, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/models.js
var HO = class extends z {
	async list(e, t) {
		return P(PO(this, e, t));
	}
	async retrieve(e, t) {
		return P(IO(this, e, t));
	}
	async delete(e, t) {
		return P(MO(this, e, t));
	}
	async update(e, t) {
		return P(BO(this, e, t));
	}
	async archive(e, t) {
		return P(AO(this, e, t));
	}
	async unarchive(e, t) {
		return P(RO(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/ocrProcess.js
function UO(e, t, n) {
	return new $(WO(e, t, n));
}
async function WO(e, t, n) {
	let r = K(t, (e) => qm.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/ocr")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "ocr_v1_ocr_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Ym), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/ocr.js
var GO = class extends z {
	async process(e, t) {
		return P(UO(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsArchiveWorkflow.js
function KO(e, t, n) {
	return new $(qO(e, t, n));
}
async function qO(e, t, n) {
	let r = K(t, (e) => dv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { workflow_identifier: I("workflow_identifier", i.workflow_identifier, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/{workflow_identifier}/archive")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "archive_workflow_v1_workflows__workflow_identifier__archive_put",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Hg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsBulkArchiveWorkflows.js
function JO(e, t, n) {
	return new $(YO(e, t, n));
}
async function YO(e, t, n) {
	let r = K(t, (e) => Gg.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/workflows/archive")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "bulk_archive_workflows_v1_workflows_archive_put",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, qg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsBulkUnarchiveWorkflows.js
function XO(e, t, n) {
	return new $(ZO(e, t, n));
}
async function ZO(e, t, n) {
	let r = K(t, (e) => Jg.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/workflows/unarchive")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "bulk_unarchive_workflows_v1_workflows_unarchive_put",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Yg), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecuteWorkflow.js
function QO(e, t, n) {
	return new $($O(e, t, n));
}
async function $O(e, t, n) {
	let r = K(t, (e) => Kv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowExecutionRequest, { explode: !0 }), o = { workflow_identifier: I("workflow_identifier", i.workflow_identifier, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/{workflow_identifier}/execute")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "execute_workflow_v1_workflows__workflow_identifier__execute_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, qv), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecuteWorkflowRegistration.js
function ek(e, t, n) {
	return new $(tk(e, t, n));
}
async function tk(e, t, n) {
	let r = K(t, (e) => Wv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowExecutionRequest, { explode: !0 }), o = { workflow_registration_id: I("workflow_registration_id", i.workflow_registration_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/registrations/{workflow_registration_id}/execute")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "execute_workflow_registration_v1_workflows_registrations__workflow_registration_id__execute_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Gv), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsGetWorkflow.js
function nk(e, t, n) {
	return new $(rk(e, t, n));
}
async function rk(e, t, n) {
	let r = K(t, (e) => nb.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { workflow_identifier: I("workflow_identifier", i.workflow_identifier, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/{workflow_identifier}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_v1_workflows__workflow_identifier__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, m_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsGetWorkflowRegistration.js
function ik(e, t, n) {
	return new $(ak(e, t, n));
}
async function ak(e, t, n) {
	let r = K(t, (e) => Yy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { workflow_registration_id: I("workflow_registration_id", i.workflow_registration_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/registrations/{workflow_registration_id}")(a), s = L({
		include_shared: i.include_shared,
		with_workflow: i.with_workflow
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_registration_v1_workflows_registrations__workflow_registration_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, y_), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsGetWorkflowRegistrations.js
function ok(e, t, n) {
	return new $(sk(e, t, n));
}
async function sk(e, t, n) {
	let r = K(t, (e) => Jy.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows/registrations")(), o = L({
		active_only: i?.active_only,
		archived: i?.archived,
		available_in_chat_assistant: i?.available_in_chat_assistant,
		cursor: i?.cursor,
		include_shared: i?.include_shared,
		limit: i?.limit,
		task_queue: i?.task_queue,
		with_workflow: i?.with_workflow,
		workflow_id: i?.workflow_id,
		workflow_search: i?.workflow_search
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_registrations_v1_workflows_registrations_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, b_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/types/operations.js
function ck(e, t) {
	return { [Symbol.asyncIterator]: async function* () {
		if (yield e, t(e)) return;
		let n = e;
		for (n = await n.next(); n != null; n = await n.next()) if (yield n, t(n)) return;
	} };
}
function lk(e) {
	return {
		...e,
		next: () => null,
		[Symbol.asyncIterator]: async function* () {
			yield e;
		}
	};
}
async function uk(e) {
	let t = await e;
	if (!t.ok) throw t.error;
	return {
		...t.value,
		next: dk(t.next),
		"~next": t["~next"],
		[Symbol.asyncIterator]: async function* () {
			for await (let e of t) {
				if (!e.ok) throw e.error;
				yield e.value;
			}
		}
	};
}
function dk(e) {
	return () => {
		let t = e();
		return t == null ? null : t.then((e) => {
			if (!e.ok) throw e.error;
			return {
				...e.value,
				next: dk(e.next)
			};
		});
	};
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsGetWorkflows.js
function fk(e, t, n) {
	return new $(pk(e, t, n));
}
async function pk(e, t, n) {
	let r = K(t, (e) => eb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [lk(r), { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows")(), o = L({
		active_only: i?.active_only,
		archived: i?.archived,
		available_in_chat_assistant: i?.available_in_chat_assistant,
		cursor: i?.cursor,
		deployment_name: i?.deployment_name,
		deployment_status: i?.deployment_status,
		include_shared: i?.include_shared,
		limit: i?.limit,
		order: i?.order,
		sort_by: i?.sort_by,
		status: i?.status,
		tags: i?.tags
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflows_v1_workflows_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [lk(d), { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [lk(p), {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g, _] = await U(V(200, tb, { key: "Result" }), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	if (!g.ok) return [lk(g), {
		status: "complete",
		request: f,
		response: m
	}];
	let v = (r) => {
		let i = zr(r, "next_cursor");
		if (typeof i != "string" || i.trim() === "") return { next: () => null };
		let a = zr(r, "workflows");
		if (!Array.isArray(a) || !a.length) return { next: () => null };
		let o = t?.limit ?? 50;
		return a.length < o ? { next: () => null } : {
			next: () => fk(e, {
				...t,
				cursor: i
			}, n),
			"~next": { cursor: i }
		};
	}, y = {
		...g,
		...v(_)
	};
	return [{
		...y,
		...ck(y, (e) => !e.ok)
	}, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsUnarchiveWorkflow.js
function mk(e, t, n) {
	return new $(hk(e, t, n));
}
async function hk(e, t, n) {
	let r = K(t, (e) => Ox.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { workflow_identifier: I("workflow_identifier", i.workflow_identifier, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/{workflow_identifier}/unarchive")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "unarchive_workflow_v1_workflows__workflow_identifier__unarchive_put",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "PUT",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, D_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsUpdateWorkflow.js
function gk(e, t, n) {
	return new $(_k(e, t, n));
}
async function _k(e, t, n) {
	let r = K(t, (e) => Rx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowUpdateRequest, { explode: !0 }), o = { workflow_identifier: I("workflow_identifier", i.workflow_identifier, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/{workflow_identifier}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_workflow_v1_workflows__workflow_identifier__put",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PUT",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, k_), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsDeploymentsGetDeployment.js
function vk(e, t, n) {
	return new $(yk(e, t, n));
}
async function yk(e, t, n) {
	let r = K(t, (e) => _y.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { name: I("name", i.name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/deployments/{name}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_deployment_v1_workflows_deployments__name__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Cf), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsDeploymentsListDeployments.js
function bk(e, t, n) {
	return new $(xk(e, t, n));
}
async function xk(e, t, n) {
	let r = K(t, (e) => Wb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows/deployments")(), o = L({
		active_only: i?.active_only,
		cursor: i?.cursor,
		is_hardened: i?.is_hardened,
		limit: i?.limit,
		search: i?.search,
		workflow_name: i?.workflow_name,
		workspace_id: i?.workspace_id
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "list_deployments_v1_workflows_deployments_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, Tf), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/deployments.js
var Sk = class extends z {
	async listDeployments(e, t) {
		return P(bk(this, e, t));
	}
	async getDeployment(e, t) {
		return P(vk(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsBatchCancelWorkflowExecutions.js
function Ck(e, t, n) {
	return new $(wk(e, t, n));
}
async function wk(e, t, n) {
	let r = K(t, (e) => Ss.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/workflows/executions/cancel")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "batch_cancel_workflow_executions_v1_workflows_executions_cancel_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, ws), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsBatchTerminateWorkflowExecutions.js
function Tk(e, t, n) {
	return new $(Ek(e, t, n));
}
async function Ek(e, t, n) {
	let r = K(t, (e) => Ss.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/workflows/executions/terminate")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "batch_terminate_workflow_executions_v1_workflows_executions_terminate_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, ws), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsCancelWorkflowExecution.js
function Dk(e, t, n) {
	return new $(Ok(e, t, n));
}
async function Ok(e, t, n) {
	let r = K(t, (e) => fv.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/cancel")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "cancel_workflow_execution_v1_workflows_executions__execution_id__cancel_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsGetWorkflowExecution.js
function kk(e, t, n) {
	return new $(Ak(e, t, n));
}
async function Ak(e, t, n) {
	let r = K(t, (e) => Ky.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_execution_v1_workflows_executions__execution_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, o_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsGetWorkflowExecutionHistory.js
function jk(e, t, n) {
	return new $(Mk(e, t, n));
}
async function Mk(e, t, n) {
	let r = K(t, (e) => By.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/history")(a), s = L({ decode_payloads: i.decode_payloads }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_execution_history_v1_workflows_executions__execution_id__history_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, _ = { HttpMeta: {
		Response: h,
		Request: p
	} }, [v] = await U(V(200, g()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsGetWorkflowExecutionLogs.js
function Nk(e, t, n) {
	return new $(Pk(e, t, n));
}
async function Pk(e, t, n) {
	let r = K(t, (e) => Hy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/logs")(a), s = L({
		activity_id: i.activity_id,
		after: i.after,
		before: i.before,
		cursor: i.cursor,
		limit: i.limit,
		order: i.order,
		run_id: i.run_id
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_execution_logs",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, zf), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsGetWorkflowExecutionTraceEvents.js
function Fk(e, t, n) {
	return new $(Ik(e, t, n));
}
async function Ik(e, t, n) {
	let r = K(t, (e) => Uy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/trace/events")(a), s = L({
		include_internal_events: i.include_internal_events,
		merge_same_id_events: i.merge_same_id_events
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_execution_trace_events",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, l_), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsGetWorkflowExecutionTraceOtel.js
function Lk(e, t, n) {
	return new $(Rk(e, t, n));
}
async function Rk(e, t, n) {
	let r = K(t, (e) => Wy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/trace/otel")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_execution_trace_otel",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, u_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsGetWorkflowExecutionTraceSummary.js
function zk(e, t, n) {
	return new $(Bk(e, t, n));
}
async function Bk(e, t, n) {
	let r = K(t, (e) => Gy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/trace/summary")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_execution_trace_summary",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, f_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsQueryWorkflowExecution.js
function Vk(e, t, n) {
	return new $(Hk(e, t, n));
}
async function Hk(e, t, n) {
	let r = K(t, (e) => ox.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.QueryInvocationBody, { explode: !0 }), o = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/executions/{execution_id}/queries")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "query_workflow_execution_v1_workflows_executions__execution_id__queries_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, mh), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsResetWorkflow.js
function Uk(e, t, n) {
	return new $(Wk(e, t, n));
}
async function Wk(e, t, n) {
	let r = K(t, (e) => sx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.ResetInvocationBody, { explode: !0 }), o = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/executions/{execution_id}/reset")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "reset_workflow_v1_workflows_executions__execution_id__reset_post",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsSignalWorkflowExecution.js
function Gk(e, t, n) {
	return new $(Kk(e, t, n));
}
async function Kk(e, t, n) {
	let r = K(t, (e) => gx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.SignalInvocationBody, { explode: !0 }), o = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/executions/{execution_id}/signals")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "signal_workflow_execution_v1_workflows_executions__execution_id__signals_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(202, Ih), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsStream.js
function qk(e, t, n) {
	return new $(Jk(e, t, n));
}
async function Jk(e, t, n) {
	let r = K(t, (e) => bx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/stream")(a), s = L({
		event_source: i.event_source,
		last_event_id: i.last_event_id
	}), c = new Headers(G({ Accept: "text/event-stream" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "stream_v1_workflows_executions__execution_id__stream_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, h = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: p
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: p
	} }, [v] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: xx.parse(e)
	}), { dataRequired: !1 }))), B(422, Z), H("4XX"), H("5XX"))(g, p, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: p,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsStreamWorkflowExecutionLogs.js
function Yk(e, t, n) {
	return new $(Xk(e, t, n));
}
async function Xk(e, t, n) {
	let r = K(t, (e) => Cx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/logs/stream")(a), s = L({
		activity_id: i.activity_id,
		after: i.after,
		last_event_id: i.last_event_id,
		run_id: i.run_id
	}), c = new Headers(G({ Accept: "text/event-stream" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "stream_workflow_execution_logs",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, h = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: p
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: p
	} }, [v] = await U(pi(200, m((e) => e instanceof ReadableStream).transform((e) => new P_(e, (e) => ({
		done: !1,
		value: Tx.parse(e)
	}), { dataRequired: !1 }))), B(422, Z), H([404, "4XX"]), H([503, "5XX"]))(g, p, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: p,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsTerminateWorkflowExecution.js
function Zk(e, t, n) {
	return new $(Qk(e, t, n));
}
async function Qk(e, t, n) {
	let r = K(t, (e) => Ex.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/executions/{execution_id}/terminate")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "terminate_workflow_execution_v1_workflows_executions__execution_id__terminate_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsExecutionsUpdateWorkflowExecution.js
function $k(e, t, n) {
	return new $(eA(e, t, n));
}
async function eA(e, t, n) {
	let r = K(t, (e) => Lx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.UpdateInvocationBody, { explode: !0 }), o = { execution_id: I("execution_id", i.execution_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/executions/{execution_id}/updates")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_workflow_execution_v1_workflows_executions__execution_id__updates_post",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, Ng), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/executions.js
var tA = class extends z {
	async getWorkflowExecution(e, t) {
		return P(kk(this, e, t));
	}
	async getWorkflowExecutionHistory(e, t) {
		return P(jk(this, e, t));
	}
	async signalWorkflowExecution(e, t) {
		return P(Gk(this, e, t));
	}
	async queryWorkflowExecution(e, t) {
		return P(Vk(this, e, t));
	}
	async terminateWorkflowExecution(e, t) {
		return P(Zk(this, e, t));
	}
	async batchTerminateWorkflowExecutions(e, t) {
		return P(Tk(this, e, t));
	}
	async cancelWorkflowExecution(e, t) {
		return P(Dk(this, e, t));
	}
	async batchCancelWorkflowExecutions(e, t) {
		return P(Ck(this, e, t));
	}
	async resetWorkflow(e, t) {
		return P(Uk(this, e, t));
	}
	async updateWorkflowExecution(e, t) {
		return P($k(this, e, t));
	}
	async getWorkflowExecutionTraceOtel(e, t) {
		return P(Lk(this, e, t));
	}
	async getWorkflowExecutionTraceSummary(e, t) {
		return P(zk(this, e, t));
	}
	async getWorkflowExecutionTraceEvents(e, t) {
		return P(Fk(this, e, t));
	}
	async stream(e, t) {
		return P(qk(this, e, t));
	}
	async getWorkflowExecutionLogs(e, t) {
		return P(Nk(this, e, t));
	}
	async streamWorkflowExecutionLogs(e, t) {
		return P(Yk(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsMetricsGetWorkflowMetrics.js
function nA(e, t, n) {
	return new $(rA(e, t, n));
}
async function rA(e, t, n) {
	let r = K(t, (e) => qy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { workflow_name: I("workflow_name", i.workflow_name, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/{workflow_name}/metrics")(a), s = L({
		end_time: i.end_time,
		start_time: i.start_time
	}), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_workflow_metrics_v1_workflows__workflow_name__metrics_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, g_), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/metrics.js
var iA = class extends z {
	async getWorkflowMetrics(e, t) {
		return P(nA(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsRunsGetRun.js
function aA(e, t, n) {
	return new $(oA(e, t, n));
}
async function oA(e, t, n) {
	let r = K(t, (e) => Sy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { run_id: I("run_id", i.run_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/runs/{run_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_run_v1_workflows_runs__run_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, o_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsRunsGetRunHistory.js
function sA(e, t, n) {
	return new $(cA(e, t, n));
}
async function cA(e, t, n) {
	let r = K(t, (e) => xy.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { run_id: I("run_id", i.run_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/runs/{run_id}/history")(a), s = L({ decode_payloads: i.decode_payloads }), c = new Headers(G({ Accept: "application/json" })), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_run_history_v1_workflows_runs__run_id__history_get",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: c,
		query: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, _ = { HttpMeta: {
		Response: h,
		Request: p
	} }, [v] = await U(V(200, g()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsRunsListRuns.js
function lA(e, t, n) {
	return new $(uA(e, t, n));
}
async function uA(e, t, n) {
	let r = K(t, (e) => Xb.optional().parse(e), "Input validation failed");
	if (!r.ok) return [lk(r), { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows/runs")(), o = L({
		deployment_name: i?.deployment_name,
		end_time_after: i?.end_time_after,
		end_time_before: i?.end_time_before,
		next_page_token: i?.next_page_token,
		order: i?.order,
		page_size: i?.page_size,
		search: i?.search,
		sort_by: i?.sort_by,
		start_time_after: i?.start_time_after,
		start_time_before: i?.start_time_before,
		status: i?.status,
		user_id: i?.user_id,
		workflow_identifier: i?.workflow_identifier
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "list_runs_v1_workflows_runs_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [lk(d), { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [lk(p), {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g, _] = await U(V(200, Zb, { key: "Result" }), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	if (!g.ok) return [lk(g), {
		status: "complete",
		request: f,
		response: m
	}];
	let v = (r) => {
		let i = zr(r, "next_page_token");
		if (typeof i != "string" || i.trim() === "") return { next: () => null };
		let a = zr(r, "executions");
		if (!Array.isArray(a) || !a.length) return { next: () => null };
		let o = t?.pageSize ?? 50;
		return a.length < o ? { next: () => null } : {
			next: () => lA(e, {
				...t,
				nextPageToken: i
			}, n),
			"~next": { cursor: i }
		};
	}, y = {
		...g,
		...v(_)
	};
	return [{
		...y,
		...ck(y, (e) => !e.ok)
	}, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/runs.js
var dA = class extends z {
	async listRuns(e, t) {
		return uk(lA(this, e, t));
	}
	async getRun(e, t) {
		return P(aA(this, e, t));
	}
	async getRunHistory(e, t) {
		return P(sA(this, e, t));
	}
};
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesGetSchedule.js
function fA(e, t, n) {
	return new $(pA(e, t, n));
}
async function pA(e, t, n) {
	let r = K(t, (e) => Ey.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { schedule_id: I("schedule_id", i.schedule_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/schedules/{schedule_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_schedule_v1_workflows_schedules__schedule_id__get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(200, xh), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesGetSchedules.js
function mA(e, t, n) {
	return new $(hA(e, t, n));
}
async function hA(e, t, n) {
	let r = K(t, (e) => wy.optional().parse(e), "Input validation failed");
	if (!r.ok) return [lk(r), { status: "invalid" }];
	let i = r.value, a = M("/v1/workflows/schedules")(), o = L({
		next_page_token: i?.next_page_token,
		page_size: i?.page_size,
		status: i?.status,
		user_id: i?.user_id,
		workflow_name: i?.workflow_name
	}), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "get_schedules_v1_workflows_schedules_get",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "GET",
		baseURL: n?.serverURL,
		path: a,
		headers: s,
		query: o,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [lk(d), { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [lk(p), {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g, _] = await U(V(200, Ty, { key: "Result" }), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	if (!g.ok) return [lk(g), {
		status: "complete",
		request: f,
		response: m
	}];
	let v = (r) => {
		let i = zr(r, "next_page_token");
		if (typeof i != "string" || i.trim() === "") return { next: () => null };
		let a = zr(r, "schedules");
		if (!Array.isArray(a) || !a.length) return { next: () => null };
		let o = t?.pageSize ?? 0;
		return a.length < o ? { next: () => null } : {
			next: () => mA(e, {
				...t,
				nextPageToken: i
			}, n),
			"~next": { cursor: i }
		};
	}, y = {
		...g,
		...v(_)
	};
	return [{
		...y,
		...ck(y, (e) => !e.ok)
	}, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesPauseSchedule.js
function gA(e, t, n) {
	return new $(_A(e, t, n));
}
async function _A(e, t, n) {
	let r = K(t, (e) => ex.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowSchedulePauseRequest, { explode: !0 }), o = { schedule_id: I("schedule_id", i.schedule_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/schedules/{schedule_id}/pause")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "pause_schedule_v1_workflows_schedules__schedule_id__pause_post",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesResumeSchedule.js
function vA(e, t, n) {
	return new $(yA(e, t, n));
}
async function yA(e, t, n) {
	let r = K(t, (e) => cx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowSchedulePauseRequest, { explode: !0 }), o = { schedule_id: I("schedule_id", i.schedule_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/schedules/{schedule_id}/resume")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "resume_schedule_v1_workflows_schedules__schedule_id__resume_post",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesScheduleWorkflow.js
function bA(e, t, n) {
	return new $(xA(e, t, n));
}
async function xA(e, t, n) {
	let r = K(t, (e) => C_.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i, { explode: !0 }), o = M("/v1/workflows/schedules")(), s = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), u = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "schedule_workflow_v1_workflows_schedules_post",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, d = e._createRequest(u, {
		security: l,
		method: "POST",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!d.ok) return [d, { status: "invalid" }];
	let f = d.value, p = await e._do(f, {
		context: u,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: u.retryConfig,
		retryCodes: u.retryCodes
	});
	if (!p.ok) return [p, {
		status: "request-error",
		request: f
	}];
	let m = p.value, h = { HttpMeta: {
		Response: m,
		Request: f
	} }, [g] = await U(V(201, w_), B(422, Z), H("4XX"), H("5XX"))(m, f, { extraFields: h });
	return g.ok, [g, {
		status: "complete",
		request: f,
		response: m
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesTriggerSchedule.js
function SA(e, t, n) {
	return new $(CA(e, t, n));
}
async function CA(e, t, n) {
	let r = K(t, (e) => Dx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowScheduleTriggerRequest, { explode: !0 }), o = { schedule_id: I("schedule_id", i.schedule_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/schedules/{schedule_id}/trigger")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), d = q(l == null ? {} : { apiKey: l }), f = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "trigger_schedule_v1_workflows_schedules__schedule_id__trigger_post",
		oAuth2Scopes: null,
		resolvedSecurity: d,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, p = e._createRequest(f, {
		security: d,
		method: "POST",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!p.ok) return [p, { status: "invalid" }];
	let m = p.value, h = await e._do(m, {
		context: f,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: f.retryConfig,
		retryCodes: f.retryCodes
	});
	if (!h.ok) return [h, {
		status: "request-error",
		request: m
	}];
	let g = h.value, _ = { HttpMeta: {
		Response: g,
		Request: m
	} }, [v] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(g, m, { extraFields: _ });
	return v.ok, [v, {
		status: "complete",
		request: m,
		response: g
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesUnscheduleWorkflow.js
function wA(e, t, n) {
	return new $(TA(e, t, n));
}
async function TA(e, t, n) {
	let r = K(t, (e) => kx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = { schedule_id: I("schedule_id", i.schedule_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, o = M("/v1/workflows/schedules/{schedule_id}")(a), s = new Headers(G({ Accept: "application/json" })), c = await J(e._options.apiKey), l = q(c == null ? {} : { apiKey: c }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "unschedule_workflow_v1_workflows_schedules__schedule_id__delete",
		oAuth2Scopes: null,
		resolvedSecurity: l,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: l,
		method: "DELETE",
		baseURL: n?.serverURL,
		path: o,
		headers: s,
		body: null,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(mi(204, u()), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/funcs/workflowsSchedulesUpdateSchedule.js
function EA(e, t, n) {
	return new $(DA(e, t, n));
}
async function DA(e, t, n) {
	let r = K(t, (e) => Fx.parse(e), "Input validation failed");
	if (!r.ok) return [r, { status: "invalid" }];
	let i = r.value, a = F("body", i.WorkflowScheduleUpdateRequest, { explode: !0 }), o = { schedule_id: I("schedule_id", i.schedule_id, {
		explode: !1,
		charEncoding: "percent"
	}) }, s = M("/v1/workflows/schedules/{schedule_id}")(o), c = new Headers(G({
		"Content-Type": "application/json",
		Accept: "application/json"
	})), l = await J(e._options.apiKey), u = q(l == null ? {} : { apiKey: l }), d = {
		options: e._options,
		baseURL: n?.serverURL ?? e._baseURL ?? "",
		operationID: "update_schedule_v1_workflows_schedules__schedule_id__patch",
		oAuth2Scopes: null,
		resolvedSecurity: u,
		securitySource: e._options.apiKey,
		retryConfig: n?.retries || e._options.retryConfig || { strategy: "none" },
		retryCodes: n?.retryCodes || [
			"429",
			"500",
			"502",
			"503",
			"504"
		]
	}, f = e._createRequest(d, {
		security: u,
		method: "PATCH",
		baseURL: n?.serverURL,
		path: s,
		headers: c,
		body: a,
		userAgent: e._options.userAgent,
		timeoutMs: n?.timeoutMs || e._options.timeoutMs || 6e4
	}, n);
	if (!f.ok) return [f, { status: "invalid" }];
	let p = f.value, m = await e._do(p, {
		context: d,
		isErrorStatusCode: (e) => N({ status: e }, ["4XX", "5XX"]),
		retryConfig: d.retryConfig,
		retryCodes: d.retryCodes
	});
	if (!m.ok) return [m, {
		status: "request-error",
		request: p
	}];
	let h = m.value, g = { HttpMeta: {
		Response: h,
		Request: p
	} }, [_] = await U(V(200, w_), B(422, Z), H("4XX"), H("5XX"))(h, p, { extraFields: g });
	return _.ok, [_, {
		status: "complete",
		request: p,
		response: h
	}];
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/sdk/schedules.js
var OA = class extends z {
	async getSchedules(e, t) {
		return uk(mA(this, e, t));
	}
	async scheduleWorkflow(e, t) {
		return P(bA(this, e, t));
	}
	async getSchedule(e, t) {
		return P(fA(this, e, t));
	}
	async unscheduleWorkflow(e, t) {
		return P(wA(this, e, t));
	}
	async updateSchedule(e, t) {
		return P(EA(this, e, t));
	}
	async pauseSchedule(e, t) {
		return P(gA(this, e, t));
	}
	async resumeSchedule(e, t) {
		return P(vA(this, e, t));
	}
	async triggerSchedule(e, t) {
		return P(SA(this, e, t));
	}
}, kA = class extends z {
	async getStreamEvents(e, t) {
		return P(YD(this, e, t));
	}
	async getWorkflowEvents(e, t) {
		return P(ZD(this, e, t));
	}
}, AA = class extends z {
	_executions;
	get executions() {
		return this._executions ??= new tA(this._options);
	}
	_metrics;
	get metrics() {
		return this._metrics ??= new iA(this._options);
	}
	_runs;
	get runs() {
		return this._runs ??= new dA(this._options);
	}
	_schedules;
	get schedules() {
		return this._schedules ??= new OA(this._options);
	}
	_events;
	get events() {
		return this._events ??= new kA(this._options);
	}
	_deployments;
	get deployments() {
		return this._deployments ??= new Sk(this._options);
	}
	async getWorkflows(e, t) {
		return uk(fk(this, e, t));
	}
	async getWorkflowRegistrations(e, t) {
		return P(ok(this, e, t));
	}
	async executeWorkflow(e, t) {
		return P(QO(this, e, t));
	}
	async executeWorkflowRegistration(e, t) {
		return P(ek(this, e, t));
	}
	async getWorkflow(e, t) {
		return P(nk(this, e, t));
	}
	async updateWorkflow(e, t) {
		return P(gk(this, e, t));
	}
	async getWorkflowRegistration(e, t) {
		return P(ik(this, e, t));
	}
	async bulkArchiveWorkflows(e, t) {
		return P(JO(this, e, t));
	}
	async bulkUnarchiveWorkflows(e, t) {
		return P(XO(this, e, t));
	}
	async archiveWorkflow(e, t) {
		return P(KO(this, e, t));
	}
	async unarchiveWorkflow(e, t) {
		return P(mk(this, e, t));
	}
}, jA = class extends z {
	_audio;
	get audio() {
		return this._audio ??= new cS(this._options);
	}
	_models;
	get models() {
		return this._models ??= new HO(this._options);
	}
	_beta;
	get beta() {
		return this._beta ??= new ED(this._options);
	}
	_files;
	get files() {
		return this._files ??= new fO(this._options);
	}
	_fineTuning;
	get fineTuning() {
		return this._fineTuning ??= new kO(this._options);
	}
	_batch;
	get batch() {
		return this._batch ??= new bS(this._options);
	}
	_chat;
	get chat() {
		return this._chat ??= new ID(this._options);
	}
	_fim;
	get fim() {
		return this._fim ??= new _O(this._options);
	}
	_agents;
	get agents() {
		return this._agents ??= new U_(this._options);
	}
	_embeddings;
	get embeddings() {
		return this._embeddings ??= new JD(this._options);
	}
	_classifiers;
	get classifiers() {
		return this._classifiers ??= new GD(this._options);
	}
	_ocr;
	get ocr() {
		return this._ocr ??= new GO(this._options);
	}
	_workflows;
	get workflows() {
		return this._workflows ??= new AA(this._options);
	}
	_events;
	get events() {
		return this._events ??= new $D(this._options);
	}
}, MA = /* @__PURE__ */ e({
	stream: () => FA,
	streamSimple: () => IA
}), NA = 9, PA = 4e3, FA = (e, t, n) => {
	let r = new re();
	return (async () => {
		let i = LA(e);
		try {
			let a = n?.apiKey;
			if (!a) throw Error(`No API key for provider: ${e.provider}`);
			let o = new jA({
				apiKey: a,
				serverURL: e.baseUrl,
				...n?.fetch ? { httpClient: new Jn({ fetcher: n.fetch }) } : {}
			}), s = RA(), c = WA(e, t, ce(t.messages, e, (e) => s(e)), n), l = await n?.onPayload?.(c, e);
			l !== void 0 && (c = l);
			let u = await o.chat.stream(c, UA(e, n));
			if (r.push({
				type: "start",
				partial: i
			}), await qA(e, i, r, u), n?.signal?.aborted) throw Error("Request was aborted");
			if (i.stopReason === "pending") throw Error("Mistral stream ended without a finish reason");
			if (i.stopReason === "aborted" || i.stopReason === "error") throw Error(i.errorMessage || "An unknown error occurred");
			r.push({
				type: "done",
				reason: i.stopReason,
				message: i
			}), r.end();
		} catch (e) {
			for (let e of i.content) delete e.partialArgs;
			i.stopReason = n?.signal?.aborted ? "aborted" : "error", i.errorMessage = BA(e), r.push({
				type: "error",
				reason: i.stopReason,
				error: i
			}), r.end();
		}
	})(), r;
}, IA = (e, t, n) => {
	let r = n?.apiKey;
	if (!r) throw Error(`No API key for provider: ${e.provider}`);
	let i = se(e, t, n, r), a = n?.reasoning ? te(e, n.reasoning) : void 0, o = a === "off" ? void 0 : a, s = e.reasoning && o !== void 0;
	return FA(e, t, {
		...i,
		promptMode: s && $A(e) ? "reasoning" : void 0,
		reasoningEffort: s && QA(e) ? ej(e, o) : void 0
	});
};
function LA(e) {
	return {
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
}
function RA() {
	let e = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map();
	return (n) => {
		let r = e.get(n);
		if (r) return r;
		let i = 0;
		for (;;) {
			let r = zA(n, i), a = t.get(r);
			if (!a || a === n) return e.set(n, r), t.set(r, n), r;
			i++;
		}
	};
}
function zA(e, t) {
	let n = e.replace(/[^a-zA-Z0-9]/g, "");
	if (t === 0 && n.length === NA) return n;
	let r = n || e, i = t === 0 ? r : `${r}:${t}`;
	return le(i).replace(/[^a-zA-Z0-9]/g, "").slice(0, NA);
}
function BA(e) {
	if (e instanceof Error) {
		let t = e, n = typeof t.statusCode == "number" ? t.statusCode : void 0, r = typeof t.body == "string" ? t.body.trim() : void 0;
		return n !== void 0 && r ? `Mistral API error (${n}): ${VA(r, PA)}` : n === void 0 ? e.message : `Mistral API error (${n}): ${e.message}`;
	}
	return HA(e);
}
function VA(e, t) {
	return e.length <= t ? e : `${e.slice(0, t)}... [truncated ${e.length - t} chars]`;
}
function HA(e) {
	try {
		let t = JSON.stringify(e);
		return t === void 0 ? String(e) : t;
	} catch {
		return String(e);
	}
}
function UA(e, t) {
	let n = { retries: { strategy: "none" } };
	t?.signal && (n.signal = t.signal);
	let r = {};
	return e.headers && Object.assign(r, e.headers), t?.headers && Object.assign(r, t.headers), GA(t) && !r["x-affinity"] && (r["x-affinity"] = t.sessionId), Object.keys(r).length > 0 && (n.headers = r), n;
}
function WA(e, t, n, r) {
	let i = {
		model: e.id,
		stream: !0,
		messages: XA(n, e.input.includes("image"))
	};
	return t.tools?.length && (i.tools = JA(t.tools)), r?.temperature !== void 0 && (i.temperature = r.temperature), r?.maxTokens !== void 0 && (i.maxTokens = r.maxTokens), r?.toolChoice && (i.toolChoice = tj(r.toolChoice)), r?.promptMode && (i.promptMode = r.promptMode), r?.reasoningEffort && (i.reasoningEffort = r.reasoningEffort), GA(r) && (i.promptCacheKey = r.sessionId), t.systemPrompt && i.messages.unshift({
		role: "system",
		content: oe(t.systemPrompt)
	}), i;
}
function GA(e) {
	return e?.cacheRetention !== "none" && !!e?.sessionId;
}
function KA(e, t) {
	let n = e, r = n.promptTokensDetails?.cachedTokens ?? n.prompt_tokens_details?.cached_tokens ?? n.promptTokenDetails?.cachedTokens ?? n.prompt_token_details?.cached_tokens ?? n.numCachedTokens ?? n.num_cached_tokens ?? 0;
	return Math.min(t, Math.max(0, typeof r == "number" && Number.isFinite(r) ? r : 0));
}
async function qA(e, t, n, r) {
	let i = null, a = t.content, o = () => a.length - 1, s = /* @__PURE__ */ new Map(), c = (e) => {
		if (e) {
			if (e.type === "text") {
				n.push({
					type: "text_end",
					contentIndex: o(),
					content: e.text,
					partial: t
				});
				return;
			}
			e.type === "thinking" && n.push({
				type: "thinking_end",
				contentIndex: o(),
				content: e.thinking,
				partial: t
			});
		}
	};
	for await (let a of r) {
		let r = a.data;
		if (t.responseId ||= r.id, r.usage) {
			let n = r.usage.promptTokens || 0, i = KA(r.usage, n);
			t.usage.input = Math.max(0, n - i), t.usage.output = r.usage.completionTokens || 0, t.usage.cacheRead = i, t.usage.cacheWrite = 0, t.usage.totalTokens = r.usage.totalTokens || t.usage.input + t.usage.output + t.usage.cacheRead + t.usage.cacheWrite, ne(e, t.usage);
		}
		let l = r.choices[0];
		if (!l) continue;
		if (l.finishReason) {
			t.rawStopReason = l.finishReason;
			let e = nj(l.finishReason);
			t.stopReason = e.stopReason, e.errorMessage && (t.errorMessage = e.errorMessage);
		}
		let u = l.delta;
		if (u.content !== null && u.content !== void 0) {
			let e = typeof u.content == "string" ? [u.content] : u.content;
			for (let r of e) {
				if (typeof r == "string") {
					let e = oe(r);
					(!i || i.type !== "text") && (c(i), i = {
						type: "text",
						text: ""
					}, t.content.push(i), n.push({
						type: "text_start",
						contentIndex: o(),
						partial: t
					})), i.text += e, n.push({
						type: "text_delta",
						contentIndex: o(),
						delta: e,
						partial: t
					});
					continue;
				}
				if (r.type === "thinking") {
					let e = r.thinking.map((e) => "text" in e ? e.text : "").filter((e) => e.length > 0).join(""), a = oe(e);
					if (!a) continue;
					(!i || i.type !== "thinking") && (c(i), i = {
						type: "thinking",
						thinking: ""
					}, t.content.push(i), n.push({
						type: "thinking_start",
						contentIndex: o(),
						partial: t
					})), i.thinking += a, n.push({
						type: "thinking_delta",
						contentIndex: o(),
						delta: a,
						partial: t
					});
					continue;
				}
				if (r.type === "text") {
					let e = oe(r.text);
					(!i || i.type !== "text") && (c(i), i = {
						type: "text",
						text: ""
					}, t.content.push(i), n.push({
						type: "text_start",
						contentIndex: o(),
						partial: t
					})), i.text += e, n.push({
						type: "text_delta",
						contentIndex: o(),
						delta: e,
						partial: t
					});
				}
			}
		}
		let d = u.toolCalls || [];
		for (let e of d) {
			i &&= (c(i), null);
			let r = e.id && e.id !== "null" ? e.id : zA(`toolcall:${e.index ?? 0}`, 0), a = `${r}:${e.index || 0}`, o = s.get(a), l;
			if (o !== void 0) {
				let e = t.content[o];
				e?.type === "toolCall" && (l = e);
			}
			l || (l = {
				type: "toolCall",
				id: r,
				name: e.function.name,
				arguments: {},
				partialArgs: ""
			}, t.content.push(l), s.set(a, t.content.length - 1), n.push({
				type: "toolcall_start",
				contentIndex: t.content.length - 1,
				partial: t
			}));
			let u = typeof e.function.arguments == "string" ? e.function.arguments : JSON.stringify(e.function.arguments || {});
			l.partialArgs = (l.partialArgs || "") + u, l.arguments = ie(l.partialArgs), n.push({
				type: "toolcall_delta",
				contentIndex: s.get(a),
				delta: u,
				partial: t
			});
		}
	}
	c(i);
	for (let e of s.values()) {
		let r = t.content[e];
		if (r.type !== "toolCall") continue;
		let i = r;
		i.arguments = ie(i.partialArgs), delete i.partialArgs, n.push({
			type: "toolcall_end",
			contentIndex: e,
			toolCall: i,
			partial: t
		});
	}
}
function JA(e) {
	return e.map((e) => {
		let t = ae(e, !0);
		return {
			type: "function",
			function: {
				name: e.name,
				description: e.description,
				parameters: YA(e.parameters),
				strict: t ?? !1
			}
		};
	});
}
function YA(e) {
	if (Array.isArray(e)) return e.map((e) => YA(e));
	if (e && typeof e == "object") {
		let t = {};
		for (let [n, r] of Object.entries(e)) t[n] = YA(r);
		return t;
	}
	return e;
}
function XA(e, t) {
	let n = [];
	for (let r of e) {
		if (r.role === "user") {
			if (typeof r.content == "string") {
				n.push({
					role: "user",
					content: oe(r.content)
				});
				continue;
			}
			let e = r.content.some((e) => e.type === "image"), i = r.content.filter((e) => e.type === "text" || t).map((e) => e.type === "text" ? {
				type: "text",
				text: oe(e.text)
			} : {
				type: "image_url",
				imageUrl: `data:${e.mimeType};base64,${e.data}`
			});
			if (i.length > 0) {
				n.push({
					role: "user",
					content: i
				});
				continue;
			}
			e && !t && n.push({
				role: "user",
				content: "(image omitted: model does not support images)"
			});
			continue;
		}
		if (r.role === "assistant") {
			let e = [], t = [];
			for (let n of r.content) {
				if (n.type === "text") {
					n.text.trim().length > 0 && e.push({
						type: "text",
						text: oe(n.text)
					});
					continue;
				}
				if (n.type === "thinking") {
					n.thinking.trim().length > 0 && e.push({
						type: "thinking",
						thinking: [{
							type: "text",
							text: oe(n.thinking)
						}]
					});
					continue;
				}
				t.push({
					id: n.id,
					type: "function",
					function: {
						name: n.name,
						arguments: JSON.stringify(n.arguments || {})
					}
				});
			}
			let i = { role: "assistant" };
			e.length > 0 && (i.content = e), t.length > 0 && (i.toolCalls = t), (e.length > 0 || t.length > 0) && n.push(i);
			continue;
		}
		let e = [], i = ZA(r.content.filter((e) => e.type === "text").map((e) => e.type === "text" ? oe(e.text) : "").join("\n"), r.content.some((e) => e.type === "image"), t, r.isError);
		e.push({
			type: "text",
			text: i
		});
		for (let n of r.content) t && n.type === "image" && e.push({
			type: "image_url",
			imageUrl: `data:${n.mimeType};base64,${n.data}`
		});
		n.push({
			role: "tool",
			toolCallId: r.toolCallId,
			name: r.toolName,
			content: e
		});
	}
	return n;
}
function ZA(e, t, n, r) {
	let i = e.trim(), a = r ? "[tool error] " : "";
	return i.length > 0 ? `${a}${i}${t && !n ? "\n[tool image omitted: model does not support images]" : ""}` : t ? n ? r ? "[tool error] (see attached image)" : "(see attached image)" : r ? "[tool error] (image omitted: model does not support images)" : "(image omitted: model does not support images)" : r ? "[tool error] (no tool output)" : "(no tool output)";
}
function QA(e) {
	return e.id === "mistral-small-2603" || e.id === "mistral-small-latest" || e.id === "mistral-medium-3.5";
}
function $A(e) {
	return e.reasoning && !QA(e);
}
function ej(e, t) {
	return e.thinkingLevelMap?.[t] ?? "high";
}
function tj(e) {
	if (e) return e === "auto" || e === "none" || e === "any" || e === "required" ? e : {
		type: "function",
		function: { name: e.function.name }
	};
}
function nj(e) {
	if (e === null) return { stopReason: "stop" };
	switch (e) {
		case "stop": return { stopReason: "stop" };
		case "length":
		case "model_length": return { stopReason: "length" };
		case "tool_calls": return { stopReason: "toolUse" };
		case "error": return {
			stopReason: "error",
			errorMessage: "Provider stopped with: error"
		};
		default: return {
			stopReason: "error",
			errorMessage: `Provider stopped with: ${e}`
		};
	}
}
//#endregion
export { Vc as n, ac as r, FA as stream, IA as streamSimple, MA as t };
