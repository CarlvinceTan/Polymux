import { t as e } from "./rolldown-runtime-CJfroGDQ.js";
//#region node_modules/partial-json/dist/options.js
var t = /* @__PURE__ */ e(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.Allow = e.ALL = e.COLLECTION = e.ATOM = e.SPECIAL = e.INF = e._INFINITY = e.INFINITY = e.NAN = e.BOOL = e.NULL = e.OBJ = e.ARR = e.NUM = e.STR = void 0, e.STR = 1, e.NUM = 2, e.ARR = 4, e.OBJ = 8, e.NULL = 16, e.BOOL = 32, e.NAN = 64, e.INFINITY = 128, e._INFINITY = 256, e.INF = e.INFINITY | e._INFINITY, e.SPECIAL = e.NULL | e.BOOL | e.INF | e.NAN, e.ATOM = e.STR | e.NUM | e.SPECIAL, e.COLLECTION = e.ARR | e.OBJ, e.ALL = e.ATOM | e.COLLECTION, e.Allow = {
		STR: e.STR,
		NUM: e.NUM,
		ARR: e.ARR,
		OBJ: e.OBJ,
		NULL: e.NULL,
		BOOL: e.BOOL,
		NAN: e.NAN,
		INFINITY: e.INFINITY,
		_INFINITY: e._INFINITY,
		INF: e.INF,
		SPECIAL: e.SPECIAL,
		ATOM: e.ATOM,
		COLLECTION: e.COLLECTION,
		ALL: e.ALL
	}, e.default = e.Allow;
})), n = (/* @__PURE__ */ e(((e) => {
	var n = e && e.__createBinding || (Object.create ? (function(e, t, n, r) {
		r === void 0 && (r = n);
		var i = Object.getOwnPropertyDescriptor(t, n);
		(!i || ("get" in i ? !t.__esModule : i.writable || i.configurable)) && (i = {
			enumerable: !0,
			get: function() {
				return t[n];
			}
		}), Object.defineProperty(e, r, i);
	}) : (function(e, t, n, r) {
		r === void 0 && (r = n), e[r] = t[n];
	})), r = e && e.__exportStar || function(e, t) {
		for (var r in e) r !== "default" && !Object.prototype.hasOwnProperty.call(t, r) && n(t, e, r);
	};
	Object.defineProperty(e, "__esModule", { value: !0 }), e.Allow = e.MalformedJSON = e.PartialJSON = e.parseJSON = e.parse = void 0;
	var i = t();
	Object.defineProperty(e, "Allow", {
		enumerable: !0,
		get: function() {
			return i.Allow;
		}
	}), r(t(), e);
	var a = class extends Error {};
	e.PartialJSON = a;
	var o = class extends Error {};
	e.MalformedJSON = o;
	function s(e, t = i.Allow.ALL) {
		if (typeof e != "string") throw TypeError(`expecting str, got ${typeof e}`);
		if (!e.trim()) throw Error(`${e} is empty`);
		return c(e.trim(), t);
	}
	e.parseJSON = s;
	var c = (e, t) => {
		let n = e.length, r = 0, s = (e) => {
			throw new a(`${e} at position ${r}`);
		}, c = (e) => {
			throw new o(`${e} at position ${r}`);
		}, l = () => (m(), r >= n && s("Unexpected end of input"), e[r] === "\"" ? u() : e[r] === "{" ? d() : e[r] === "[" ? f() : e.substring(r, r + 4) === "null" || i.Allow.NULL & t && n - r < 4 && "null".startsWith(e.substring(r)) ? (r += 4, null) : e.substring(r, r + 4) === "true" || i.Allow.BOOL & t && n - r < 4 && "true".startsWith(e.substring(r)) ? (r += 4, !0) : e.substring(r, r + 5) === "false" || i.Allow.BOOL & t && n - r < 5 && "false".startsWith(e.substring(r)) ? (r += 5, !1) : e.substring(r, r + 8) === "Infinity" || i.Allow.INFINITY & t && n - r < 8 && "Infinity".startsWith(e.substring(r)) ? (r += 8, Infinity) : e.substring(r, r + 9) === "-Infinity" || i.Allow._INFINITY & t && 1 < n - r && n - r < 9 && "-Infinity".startsWith(e.substring(r)) ? (r += 9, -Infinity) : e.substring(r, r + 3) === "NaN" || i.Allow.NAN & t && n - r < 3 && "NaN".startsWith(e.substring(r)) ? (r += 3, NaN) : p()), u = () => {
			let a = r, o = !1;
			for (r++; r < n && (e[r] !== "\"" || o && e[r - 1] === "\\");) o = e[r] === "\\" && !o, r++;
			if (e.charAt(r) == "\"") try {
				return JSON.parse(e.substring(a, ++r - Number(o)));
			} catch (e) {
				c(String(e));
			}
			else if (i.Allow.STR & t) try {
				return JSON.parse(e.substring(a, r - Number(o)) + "\"");
			} catch {
				return JSON.parse(e.substring(a, e.lastIndexOf("\\")) + "\"");
			}
			s("Unterminated string literal");
		}, d = () => {
			r++, m();
			let a = {};
			try {
				for (; e[r] !== "}";) {
					if (m(), r >= n && i.Allow.OBJ & t) return a;
					let o = u();
					m(), r++;
					try {
						a[o] = l();
					} catch (e) {
						if (i.Allow.OBJ & t) return a;
						throw e;
					}
					m(), e[r] === "," && r++;
				}
			} catch {
				if (i.Allow.OBJ & t) return a;
				s("Expected '}' at end of object");
			}
			return r++, a;
		}, f = () => {
			r++;
			let n = [];
			try {
				for (; e[r] !== "]";) n.push(l()), m(), e[r] === "," && r++;
			} catch {
				if (i.Allow.ARR & t) return n;
				s("Expected ']' at end of array");
			}
			return r++, n;
		}, p = () => {
			if (r === 0) {
				e === "-" && c("Not sure what '-' is");
				try {
					return JSON.parse(e);
				} catch (n) {
					if (i.Allow.NUM & t) try {
						return JSON.parse(e.substring(0, e.lastIndexOf("e")));
					} catch {}
					c(String(n));
				}
			}
			let a = r;
			for (e[r] === "-" && r++; e[r] && ",]}".indexOf(e[r]) === -1;) r++;
			r == n && !(i.Allow.NUM & t) && s("Unterminated number literal");
			try {
				return JSON.parse(e.substring(a, r));
			} catch {
				e.substring(a, r) === "-" && s("Not sure what '-' is");
				try {
					return JSON.parse(e.substring(a, e.lastIndexOf("e")));
				} catch (e) {
					c(String(e));
				}
			}
		}, m = () => {
			for (; r < n && " \n\r	".includes(e[r]);) r++;
		};
		return l();
	};
	e.parse = s;
})))(), r = /* @__PURE__ */ new Set([
	"\"",
	"\\",
	"/",
	"b",
	"f",
	"n",
	"r",
	"t",
	"u"
]);
function i(e) {
	let t = e.codePointAt(0);
	return t !== void 0 && t >= 0 && t <= 31;
}
function a(e) {
	switch (e) {
		case "\b": return "\\b";
		case "\f": return "\\f";
		case "\n": return "\\n";
		case "\r": return "\\r";
		case "	": return "\\t";
		default: return `\\u${e.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
	}
}
function o(e) {
	let t = "", n = !1;
	for (let o = 0; o < e.length; o++) {
		let s = e[o];
		if (!n) {
			t += s, s === "\"" && (n = !0);
			continue;
		}
		if (s === "\"") {
			t += s, n = !1;
			continue;
		}
		if (s === "\\") {
			let n = e[o + 1];
			if (n === void 0) {
				t += "\\\\";
				continue;
			}
			if (n === "u") {
				let n = e.slice(o + 2, o + 6);
				if (/^[0-9a-fA-F]{4}$/.test(n)) {
					t += `\\u${n}`, o += 5;
					continue;
				}
			}
			if (r.has(n)) {
				t += `\\${n}`, o += 1;
				continue;
			}
			t += "\\\\";
			continue;
		}
		t += i(s) ? a(s) : s;
	}
	return t;
}
function s(e) {
	try {
		return JSON.parse(e);
	} catch (t) {
		let n = o(e);
		if (n !== e) return JSON.parse(n);
		throw t;
	}
}
function c(e) {
	if (!e || e.trim() === "") return {};
	try {
		return s(e);
	} catch {
		try {
			return (0, n.parse)(e) ?? {};
		} catch {
			try {
				return (0, n.parse)(o(e)) ?? {};
			} catch {
				return {};
			}
		}
	}
}
//#endregion
export { c as n, s as t };
