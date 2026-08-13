import { o as e, t } from "./rolldown-runtime-CJfroGDQ.js";
import { t as n } from "./provider-retry-geBRPa4e.js";
import { d as r, f as i, t as a } from "./transform-messages-Dy7xZPcj.js";
//#region node_modules/p-retry/node_modules/retry/lib/retry_operation.js
var o = /* @__PURE__ */ t(((e, t) => {
	function n(e, t) {
		typeof t == "boolean" && (t = { forever: t }), this._originalTimeouts = JSON.parse(JSON.stringify(e)), this._timeouts = e, this._options = t || {}, this._maxRetryTime = t && t.maxRetryTime || Infinity, this._fn = null, this._errors = [], this._attempts = 1, this._operationTimeout = null, this._operationTimeoutCb = null, this._timeout = null, this._operationStart = null, this._timer = null, this._options.forever && (this._cachedTimeouts = this._timeouts.slice(0));
	}
	t.exports = n, n.prototype.reset = function() {
		this._attempts = 1, this._timeouts = this._originalTimeouts.slice(0);
	}, n.prototype.stop = function() {
		this._timeout && clearTimeout(this._timeout), this._timer && clearTimeout(this._timer), this._timeouts = [], this._cachedTimeouts = null;
	}, n.prototype.retry = function(e) {
		if (this._timeout && clearTimeout(this._timeout), !e) return !1;
		var t = (/* @__PURE__ */ new Date()).getTime();
		if (e && t - this._operationStart >= this._maxRetryTime) return this._errors.push(e), this._errors.unshift(/* @__PURE__ */ Error("RetryOperation timeout occurred")), !1;
		this._errors.push(e);
		var n = this._timeouts.shift();
		if (n === void 0) {
			if (this._cachedTimeouts) this._errors.splice(0, this._errors.length - 1), n = this._cachedTimeouts.slice(-1);
			else return !1;
		}
		var r = this;
		return this._timer = setTimeout(function() {
			r._attempts++, r._operationTimeoutCb && (r._timeout = setTimeout(function() {
				r._operationTimeoutCb(r._attempts);
			}, r._operationTimeout), r._options.unref && r._timeout.unref()), r._fn(r._attempts);
		}, n), this._options.unref && this._timer.unref(), !0;
	}, n.prototype.attempt = function(e, t) {
		this._fn = e, t && (t.timeout && (this._operationTimeout = t.timeout), t.cb && (this._operationTimeoutCb = t.cb));
		var n = this;
		this._operationTimeoutCb && (this._timeout = setTimeout(function() {
			n._operationTimeoutCb();
		}, n._operationTimeout)), this._operationStart = (/* @__PURE__ */ new Date()).getTime(), this._fn(this._attempts);
	}, n.prototype.try = function(e) {
		console.log("Using RetryOperation.try() is deprecated"), this.attempt(e);
	}, n.prototype.start = function(e) {
		console.log("Using RetryOperation.start() is deprecated"), this.attempt(e);
	}, n.prototype.start = n.prototype.try, n.prototype.errors = function() {
		return this._errors;
	}, n.prototype.attempts = function() {
		return this._attempts;
	}, n.prototype.mainError = function() {
		if (this._errors.length === 0) return null;
		for (var e = {}, t = null, n = 0, r = 0; r < this._errors.length; r++) {
			var i = this._errors[r], a = i.message, o = (e[a] || 0) + 1;
			e[a] = o, o >= n && (t = i, n = o);
		}
		return t;
	};
})), s = /* @__PURE__ */ t(((e) => {
	var t = o();
	e.operation = function(n) {
		return new t(e.timeouts(n), {
			forever: n && (n.forever || n.retries === Infinity),
			unref: n && n.unref,
			maxRetryTime: n && n.maxRetryTime
		});
	}, e.timeouts = function(e) {
		if (e instanceof Array) return [].concat(e);
		var t = {
			retries: 10,
			factor: 2,
			minTimeout: 1e3,
			maxTimeout: Infinity,
			randomize: !1
		};
		for (var n in e) t[n] = e[n];
		if (t.minTimeout > t.maxTimeout) throw Error("minTimeout is greater than maxTimeout");
		for (var r = [], i = 0; i < t.retries; i++) r.push(this.createTimeout(i, t));
		return e && e.forever && !r.length && r.push(this.createTimeout(i, t)), r.sort(function(e, t) {
			return e - t;
		}), r;
	}, e.createTimeout = function(e, t) {
		var n = t.randomize ? Math.random() + 1 : 1, r = Math.round(n * Math.max(t.minTimeout, 1) * t.factor ** +e);
		return r = Math.min(r, t.maxTimeout), r;
	}, e.wrap = function(t, n, r) {
		if (n instanceof Array && (r = n, n = null), !r) for (var i in r = [], t) typeof t[i] == "function" && r.push(i);
		for (var a = 0; a < r.length; a++) {
			var o = r[a], s = t[o];
			t[o] = function(r) {
				var i = e.operation(n), a = Array.prototype.slice.call(arguments, 1), o = a.pop();
				a.push(function(e) {
					i.retry(e) || (e && (arguments[0] = i.mainError()), o.apply(this, arguments));
				}), i.attempt(function() {
					r.apply(t, a);
				});
			}.bind(t, s), t[o].options = n;
		}
	};
})), c = /* @__PURE__ */ t(((e, t) => {
	t.exports = s();
})), l = /* @__PURE__ */ e((/* @__PURE__ */ t(((e, t) => {
	var n = c(), r = [
		"Failed to fetch",
		"NetworkError when attempting to fetch resource.",
		"The Internet connection appears to be offline.",
		"Network request failed"
	], i = class extends Error {
		constructor(e) {
			super(), e instanceof Error ? (this.originalError = e, {message: e} = e) : (this.originalError = Error(e), this.originalError.stack = this.stack), this.name = "AbortError", this.message = e;
		}
	}, a = (e, t, n) => {
		let r = n.retries - (t - 1);
		return e.attemptNumber = t, e.retriesLeft = r, e;
	}, o = (e) => r.includes(e), s = (e, t) => new Promise((r, s) => {
		t = {
			onFailedAttempt: () => {},
			retries: 10,
			...t
		};
		let c = n.operation(t);
		c.attempt(async (n) => {
			try {
				r(await e(n));
			} catch (e) {
				if (!(e instanceof Error)) {
					s(/* @__PURE__ */ TypeError(`Non-error was thrown: "${e}". You should only throw errors.`));
					return;
				}
				if (e instanceof i) c.stop(), s(e.originalError);
				else if (e instanceof TypeError && !o(e.message)) c.stop(), s(e);
				else {
					a(e, n, t);
					try {
						await t.onFailedAttempt(e);
					} catch (e) {
						s(e);
						return;
					}
					c.retry(e) || s(c.mainError());
				}
			}
		});
	});
	t.exports = s, t.exports.default = s, t.exports.AbortError = i;
})))(), 1), u = void 0, d = void 0;
function f() {
	return {
		geminiUrl: u,
		vertexUrl: d
	};
}
function p(e, t, n, r) {
	if (!e?.baseUrl) {
		let e = f();
		return t ? e.vertexUrl ?? n : e.geminiUrl ?? r;
	}
	return e.baseUrl;
}
var m = class {};
function h(e, t) {
	return e.replace(/\{([^}]+)\}/g, (e, n) => {
		if (Object.prototype.hasOwnProperty.call(t, n)) {
			let e = t[n];
			return e == null ? "" : String(e);
		}
		throw Error(`Key '${n}' not found in valueMap.`);
	});
}
function g(e, t, n) {
	for (let r = 0; r < t.length - 1; r++) {
		let i = t[r];
		if (i.endsWith("[]")) {
			let a = i.slice(0, -2);
			if (!(a in e)) {
				if (Array.isArray(n)) e[a] = Array.from({ length: n.length }, () => ({}));
				else throw Error(`Value must be a list given an array path ${i}`);
			}
			if (Array.isArray(e[a])) {
				let i = e[a];
				if (Array.isArray(n)) for (let e = 0; e < i.length; e++) {
					let a = i[e];
					g(a, t.slice(r + 1), n[e]);
				}
				else for (let e of i) g(e, t.slice(r + 1), n);
			}
			return;
		}
		if (i.endsWith("[0]")) {
			let a = i.slice(0, -3);
			a in e || (e[a] = [{}]);
			let o = e[a];
			g(o[0], t.slice(r + 1), n);
			return;
		}
		(!e[i] || typeof e[i] != "object") && (e[i] = {}), e = e[i];
	}
	let r = t[t.length - 1], i = e[r];
	if (i !== void 0) {
		if (!n || typeof n == "object" && Object.keys(n).length === 0 || n === i) return;
		if (typeof i == "object" && typeof n == "object" && i !== null && n !== null) Object.assign(i, n);
		else throw Error(`Cannot set value for an existing key. Key: ${r}`);
	} else r === "_self" && typeof n == "object" && n && !Array.isArray(n) ? Object.assign(e, n) : e[r] = n;
}
function _(e, t, n = void 0) {
	try {
		if (t.length === 1 && t[0] === "_self") return e;
		for (let r = 0; r < t.length; r++) {
			if (typeof e != "object" || !e) return n;
			let i = t[r];
			if (i.endsWith("[]")) {
				let a = i.slice(0, -2);
				if (a in e) {
					let i = e[a];
					return Array.isArray(i) ? i.map((e) => _(e, t.slice(r + 1), n)) : n;
				}
				return n;
			}
			e = e[i];
		}
		return e;
	} catch (e) {
		if (e instanceof TypeError) return n;
		throw e;
	}
}
function v(e, t) {
	for (let [n, r] of Object.entries(t)) {
		let t = n.split("."), i = r.split("."), a = /* @__PURE__ */ new Set(), o = -1;
		for (let e = 0; e < t.length; e++) if (t[e] === "*") {
			o = e;
			break;
		}
		if (o !== -1 && i.length > o) for (let e = o; e < i.length; e++) {
			let t = i[e];
			t !== "*" && !t.endsWith("[]") && !t.endsWith("[0]") && a.add(t);
		}
		y(e, t, i, 0, a);
	}
}
function y(e, t, n, r, i) {
	if (r >= t.length || typeof e != "object" || !e) return;
	let a = t[r];
	if (a.endsWith("[]")) {
		let o = a.slice(0, -2), s = e;
		if (o in s && Array.isArray(s[o])) for (let e of s[o]) y(e, t, n, r + 1, i);
	} else if (a === "*") {
		if (typeof e == "object" && e && !Array.isArray(e)) {
			let t = e, a = Object.keys(t).filter((e) => !e.startsWith("_") && !i.has(e)), o = {};
			for (let e of a) o[e] = t[e];
			for (let [e, i] of Object.entries(o)) {
				let a = [];
				for (let t of n.slice(r)) t === "*" ? a.push(e) : a.push(t);
				g(t, a, i);
			}
			for (let e of a) delete t[e];
		}
	} else {
		let o = e;
		a in o && y(o[a], t, n, r + 1, i);
	}
}
function b(e) {
	if (typeof e != "string") throw Error("fromImageBytes must be a string");
	return e;
}
function x(e) {
	let t = {}, n = _(e, ["operationName"]);
	n != null && g(t, ["operationName"], n);
	let r = _(e, ["resourceName"]);
	return r != null && g(t, ["_url", "resourceName"], r), t;
}
function S(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["metadata"]);
	r != null && g(t, ["metadata"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	a != null && g(t, ["error"], a);
	let o = _(e, ["response", "generateVideoResponse"]);
	return o != null && g(t, ["response"], w(o)), t;
}
function C(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["metadata"]);
	r != null && g(t, ["metadata"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	a != null && g(t, ["error"], a);
	let o = _(e, ["response"]);
	return o != null && g(t, ["response"], T(o)), t;
}
function w(e) {
	let t = {}, n = _(e, ["generatedSamples"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => E(e))), g(t, ["generatedVideos"], e);
	}
	let r = _(e, ["raiMediaFilteredCount"]);
	r != null && g(t, ["raiMediaFilteredCount"], r);
	let i = _(e, ["raiMediaFilteredReasons"]);
	return i != null && g(t, ["raiMediaFilteredReasons"], i), t;
}
function T(e) {
	let t = {}, n = _(e, ["videos"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => D(e))), g(t, ["generatedVideos"], e);
	}
	let r = _(e, ["raiMediaFilteredCount"]);
	r != null && g(t, ["raiMediaFilteredCount"], r);
	let i = _(e, ["raiMediaFilteredReasons"]);
	return i != null && g(t, ["raiMediaFilteredReasons"], i), t;
}
function E(e) {
	let t = {}, n = _(e, ["video"]);
	return n != null && g(t, ["video"], te(n)), t;
}
function D(e) {
	let t = {}, n = _(e, ["_self"]);
	return n != null && g(t, ["video"], ne(n)), t;
}
function O(e) {
	let t = {}, n = _(e, ["operationName"]);
	return n != null && g(t, ["_url", "operationName"], n), t;
}
function k(e) {
	let t = {}, n = _(e, ["operationName"]);
	return n != null && g(t, ["_url", "operationName"], n), t;
}
function A(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["metadata"]);
	r != null && g(t, ["metadata"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	a != null && g(t, ["error"], a);
	let o = _(e, ["response"]);
	return o != null && g(t, ["response"], j(o)), t;
}
function j(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["parent"]);
	r != null && g(t, ["parent"], r);
	let i = _(e, ["documentName"]);
	return i != null && g(t, ["documentName"], i), t;
}
function M(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["metadata"]);
	r != null && g(t, ["metadata"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	a != null && g(t, ["error"], a);
	let o = _(e, ["response"]);
	return o != null && g(t, ["response"], ee(o)), t;
}
function ee(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["parent"]);
	r != null && g(t, ["parent"], r);
	let i = _(e, ["documentName"]);
	return i != null && g(t, ["documentName"], i), t;
}
function te(e) {
	let t = {}, n = _(e, ["uri"]);
	n != null && g(t, ["uri"], n);
	let r = _(e, ["encodedVideo"]);
	r != null && g(t, ["videoBytes"], b(r));
	let i = _(e, ["encoding"]);
	return i != null && g(t, ["mimeType"], i), t;
}
function ne(e) {
	let t = {}, n = _(e, ["gcsUri"]);
	n != null && g(t, ["uri"], n);
	let r = _(e, ["bytesBase64Encoded"]);
	r != null && g(t, ["videoBytes"], b(r));
	let i = _(e, ["mimeType"]);
	return i != null && g(t, ["mimeType"], i), t;
}
var re;
(function(e) {
	e.LANGUAGE_UNSPECIFIED = "LANGUAGE_UNSPECIFIED", e.PYTHON = "PYTHON";
})(re ||= {});
var ie;
(function(e) {
	e.OUTCOME_UNSPECIFIED = "OUTCOME_UNSPECIFIED", e.OUTCOME_OK = "OUTCOME_OK", e.OUTCOME_FAILED = "OUTCOME_FAILED", e.OUTCOME_DEADLINE_EXCEEDED = "OUTCOME_DEADLINE_EXCEEDED";
})(ie ||= {});
var ae;
(function(e) {
	e.SCHEDULING_UNSPECIFIED = "SCHEDULING_UNSPECIFIED", e.SILENT = "SILENT", e.WHEN_IDLE = "WHEN_IDLE", e.INTERRUPT = "INTERRUPT";
})(ae ||= {});
var N;
(function(e) {
	e.TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED", e.STRING = "STRING", e.NUMBER = "NUMBER", e.INTEGER = "INTEGER", e.BOOLEAN = "BOOLEAN", e.ARRAY = "ARRAY", e.OBJECT = "OBJECT", e.NULL = "NULL";
})(N ||= {});
var oe;
(function(e) {
	e.ENVIRONMENT_UNSPECIFIED = "ENVIRONMENT_UNSPECIFIED", e.ENVIRONMENT_BROWSER = "ENVIRONMENT_BROWSER";
})(oe ||= {});
var se;
(function(e) {
	e.AUTH_TYPE_UNSPECIFIED = "AUTH_TYPE_UNSPECIFIED", e.NO_AUTH = "NO_AUTH", e.API_KEY_AUTH = "API_KEY_AUTH", e.HTTP_BASIC_AUTH = "HTTP_BASIC_AUTH", e.GOOGLE_SERVICE_ACCOUNT_AUTH = "GOOGLE_SERVICE_ACCOUNT_AUTH", e.OAUTH = "OAUTH", e.OIDC_AUTH = "OIDC_AUTH";
})(se ||= {});
var ce;
(function(e) {
	e.HTTP_IN_UNSPECIFIED = "HTTP_IN_UNSPECIFIED", e.HTTP_IN_QUERY = "HTTP_IN_QUERY", e.HTTP_IN_HEADER = "HTTP_IN_HEADER", e.HTTP_IN_PATH = "HTTP_IN_PATH", e.HTTP_IN_BODY = "HTTP_IN_BODY", e.HTTP_IN_COOKIE = "HTTP_IN_COOKIE";
})(ce ||= {});
var le;
(function(e) {
	e.API_SPEC_UNSPECIFIED = "API_SPEC_UNSPECIFIED", e.SIMPLE_SEARCH = "SIMPLE_SEARCH", e.ELASTIC_SEARCH = "ELASTIC_SEARCH";
})(le ||= {});
var ue;
(function(e) {
	e.PHISH_BLOCK_THRESHOLD_UNSPECIFIED = "PHISH_BLOCK_THRESHOLD_UNSPECIFIED", e.BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE", e.BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE", e.BLOCK_HIGH_AND_ABOVE = "BLOCK_HIGH_AND_ABOVE", e.BLOCK_HIGHER_AND_ABOVE = "BLOCK_HIGHER_AND_ABOVE", e.BLOCK_VERY_HIGH_AND_ABOVE = "BLOCK_VERY_HIGH_AND_ABOVE", e.BLOCK_ONLY_EXTREMELY_HIGH = "BLOCK_ONLY_EXTREMELY_HIGH";
})(ue ||= {});
var de;
(function(e) {
	e.UNSPECIFIED = "UNSPECIFIED", e.BLOCKING = "BLOCKING", e.NON_BLOCKING = "NON_BLOCKING";
})(de ||= {});
var fe;
(function(e) {
	e.MODE_UNSPECIFIED = "MODE_UNSPECIFIED", e.MODE_DYNAMIC = "MODE_DYNAMIC";
})(fe ||= {});
var pe;
(function(e) {
	e.MODE_UNSPECIFIED = "MODE_UNSPECIFIED", e.AUTO = "AUTO", e.ANY = "ANY", e.NONE = "NONE", e.VALIDATED = "VALIDATED";
})(pe ||= {});
var me;
(function(e) {
	e.THINKING_LEVEL_UNSPECIFIED = "THINKING_LEVEL_UNSPECIFIED", e.MINIMAL = "MINIMAL", e.LOW = "LOW", e.MEDIUM = "MEDIUM", e.HIGH = "HIGH";
})(me ||= {});
var he;
(function(e) {
	e.DONT_ALLOW = "DONT_ALLOW", e.ALLOW_ADULT = "ALLOW_ADULT", e.ALLOW_ALL = "ALLOW_ALL";
})(he ||= {});
var ge;
(function(e) {
	e.PROMINENT_PEOPLE_UNSPECIFIED = "PROMINENT_PEOPLE_UNSPECIFIED", e.ALLOW_PROMINENT_PEOPLE = "ALLOW_PROMINENT_PEOPLE", e.BLOCK_PROMINENT_PEOPLE = "BLOCK_PROMINENT_PEOPLE";
})(ge ||= {});
var _e;
(function(e) {
	e.HARM_CATEGORY_UNSPECIFIED = "HARM_CATEGORY_UNSPECIFIED", e.HARM_CATEGORY_HARASSMENT = "HARM_CATEGORY_HARASSMENT", e.HARM_CATEGORY_HATE_SPEECH = "HARM_CATEGORY_HATE_SPEECH", e.HARM_CATEGORY_SEXUALLY_EXPLICIT = "HARM_CATEGORY_SEXUALLY_EXPLICIT", e.HARM_CATEGORY_DANGEROUS_CONTENT = "HARM_CATEGORY_DANGEROUS_CONTENT", e.HARM_CATEGORY_CIVIC_INTEGRITY = "HARM_CATEGORY_CIVIC_INTEGRITY", e.HARM_CATEGORY_IMAGE_HATE = "HARM_CATEGORY_IMAGE_HATE", e.HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT = "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT", e.HARM_CATEGORY_IMAGE_HARASSMENT = "HARM_CATEGORY_IMAGE_HARASSMENT", e.HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT = "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT", e.HARM_CATEGORY_JAILBREAK = "HARM_CATEGORY_JAILBREAK";
})(_e ||= {});
var ve;
(function(e) {
	e.HARM_BLOCK_METHOD_UNSPECIFIED = "HARM_BLOCK_METHOD_UNSPECIFIED", e.SEVERITY = "SEVERITY", e.PROBABILITY = "PROBABILITY";
})(ve ||= {});
var ye;
(function(e) {
	e.HARM_BLOCK_THRESHOLD_UNSPECIFIED = "HARM_BLOCK_THRESHOLD_UNSPECIFIED", e.BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE", e.BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE", e.BLOCK_ONLY_HIGH = "BLOCK_ONLY_HIGH", e.BLOCK_NONE = "BLOCK_NONE", e.OFF = "OFF";
})(ye ||= {});
var P;
(function(e) {
	e.FINISH_REASON_UNSPECIFIED = "FINISH_REASON_UNSPECIFIED", e.STOP = "STOP", e.MAX_TOKENS = "MAX_TOKENS", e.SAFETY = "SAFETY", e.RECITATION = "RECITATION", e.LANGUAGE = "LANGUAGE", e.OTHER = "OTHER", e.BLOCKLIST = "BLOCKLIST", e.PROHIBITED_CONTENT = "PROHIBITED_CONTENT", e.SPII = "SPII", e.MALFORMED_FUNCTION_CALL = "MALFORMED_FUNCTION_CALL", e.IMAGE_SAFETY = "IMAGE_SAFETY", e.UNEXPECTED_TOOL_CALL = "UNEXPECTED_TOOL_CALL", e.IMAGE_PROHIBITED_CONTENT = "IMAGE_PROHIBITED_CONTENT", e.NO_IMAGE = "NO_IMAGE", e.IMAGE_RECITATION = "IMAGE_RECITATION", e.IMAGE_OTHER = "IMAGE_OTHER";
})(P ||= {});
var be;
(function(e) {
	e.HARM_PROBABILITY_UNSPECIFIED = "HARM_PROBABILITY_UNSPECIFIED", e.NEGLIGIBLE = "NEGLIGIBLE", e.LOW = "LOW", e.MEDIUM = "MEDIUM", e.HIGH = "HIGH";
})(be ||= {});
var xe;
(function(e) {
	e.HARM_SEVERITY_UNSPECIFIED = "HARM_SEVERITY_UNSPECIFIED", e.HARM_SEVERITY_NEGLIGIBLE = "HARM_SEVERITY_NEGLIGIBLE", e.HARM_SEVERITY_LOW = "HARM_SEVERITY_LOW", e.HARM_SEVERITY_MEDIUM = "HARM_SEVERITY_MEDIUM", e.HARM_SEVERITY_HIGH = "HARM_SEVERITY_HIGH";
})(xe ||= {});
var Se;
(function(e) {
	e.URL_RETRIEVAL_STATUS_UNSPECIFIED = "URL_RETRIEVAL_STATUS_UNSPECIFIED", e.URL_RETRIEVAL_STATUS_SUCCESS = "URL_RETRIEVAL_STATUS_SUCCESS", e.URL_RETRIEVAL_STATUS_ERROR = "URL_RETRIEVAL_STATUS_ERROR", e.URL_RETRIEVAL_STATUS_PAYWALL = "URL_RETRIEVAL_STATUS_PAYWALL", e.URL_RETRIEVAL_STATUS_UNSAFE = "URL_RETRIEVAL_STATUS_UNSAFE";
})(Se ||= {});
var Ce;
(function(e) {
	e.BLOCKED_REASON_UNSPECIFIED = "BLOCKED_REASON_UNSPECIFIED", e.SAFETY = "SAFETY", e.OTHER = "OTHER", e.BLOCKLIST = "BLOCKLIST", e.PROHIBITED_CONTENT = "PROHIBITED_CONTENT", e.IMAGE_SAFETY = "IMAGE_SAFETY", e.MODEL_ARMOR = "MODEL_ARMOR", e.JAILBREAK = "JAILBREAK";
})(Ce ||= {});
var we;
(function(e) {
	e.TRAFFIC_TYPE_UNSPECIFIED = "TRAFFIC_TYPE_UNSPECIFIED", e.ON_DEMAND = "ON_DEMAND", e.ON_DEMAND_PRIORITY = "ON_DEMAND_PRIORITY", e.ON_DEMAND_FLEX = "ON_DEMAND_FLEX", e.PROVISIONED_THROUGHPUT = "PROVISIONED_THROUGHPUT";
})(we ||= {});
var Te;
(function(e) {
	e.MODALITY_UNSPECIFIED = "MODALITY_UNSPECIFIED", e.TEXT = "TEXT", e.IMAGE = "IMAGE", e.AUDIO = "AUDIO", e.VIDEO = "VIDEO";
})(Te ||= {});
var Ee;
(function(e) {
	e.MODEL_STAGE_UNSPECIFIED = "MODEL_STAGE_UNSPECIFIED", e.UNSTABLE_EXPERIMENTAL = "UNSTABLE_EXPERIMENTAL", e.EXPERIMENTAL = "EXPERIMENTAL", e.PREVIEW = "PREVIEW", e.STABLE = "STABLE", e.LEGACY = "LEGACY", e.DEPRECATED = "DEPRECATED", e.RETIRED = "RETIRED";
})(Ee ||= {});
var De;
(function(e) {
	e.MEDIA_RESOLUTION_UNSPECIFIED = "MEDIA_RESOLUTION_UNSPECIFIED", e.MEDIA_RESOLUTION_LOW = "MEDIA_RESOLUTION_LOW", e.MEDIA_RESOLUTION_MEDIUM = "MEDIA_RESOLUTION_MEDIUM", e.MEDIA_RESOLUTION_HIGH = "MEDIA_RESOLUTION_HIGH";
})(De ||= {});
var Oe;
(function(e) {
	e.TUNING_MODE_UNSPECIFIED = "TUNING_MODE_UNSPECIFIED", e.TUNING_MODE_FULL = "TUNING_MODE_FULL", e.TUNING_MODE_PEFT_ADAPTER = "TUNING_MODE_PEFT_ADAPTER";
})(Oe ||= {});
var ke;
(function(e) {
	e.ADAPTER_SIZE_UNSPECIFIED = "ADAPTER_SIZE_UNSPECIFIED", e.ADAPTER_SIZE_ONE = "ADAPTER_SIZE_ONE", e.ADAPTER_SIZE_TWO = "ADAPTER_SIZE_TWO", e.ADAPTER_SIZE_FOUR = "ADAPTER_SIZE_FOUR", e.ADAPTER_SIZE_EIGHT = "ADAPTER_SIZE_EIGHT", e.ADAPTER_SIZE_SIXTEEN = "ADAPTER_SIZE_SIXTEEN", e.ADAPTER_SIZE_THIRTY_TWO = "ADAPTER_SIZE_THIRTY_TWO";
})(ke ||= {});
var Ae;
(function(e) {
	e.JOB_STATE_UNSPECIFIED = "JOB_STATE_UNSPECIFIED", e.JOB_STATE_QUEUED = "JOB_STATE_QUEUED", e.JOB_STATE_PENDING = "JOB_STATE_PENDING", e.JOB_STATE_RUNNING = "JOB_STATE_RUNNING", e.JOB_STATE_SUCCEEDED = "JOB_STATE_SUCCEEDED", e.JOB_STATE_FAILED = "JOB_STATE_FAILED", e.JOB_STATE_CANCELLING = "JOB_STATE_CANCELLING", e.JOB_STATE_CANCELLED = "JOB_STATE_CANCELLED", e.JOB_STATE_PAUSED = "JOB_STATE_PAUSED", e.JOB_STATE_EXPIRED = "JOB_STATE_EXPIRED", e.JOB_STATE_UPDATING = "JOB_STATE_UPDATING", e.JOB_STATE_PARTIALLY_SUCCEEDED = "JOB_STATE_PARTIALLY_SUCCEEDED";
})(Ae ||= {});
var je;
(function(e) {
	e.TUNING_JOB_STATE_UNSPECIFIED = "TUNING_JOB_STATE_UNSPECIFIED", e.TUNING_JOB_STATE_WAITING_FOR_QUOTA = "TUNING_JOB_STATE_WAITING_FOR_QUOTA", e.TUNING_JOB_STATE_PROCESSING_DATASET = "TUNING_JOB_STATE_PROCESSING_DATASET", e.TUNING_JOB_STATE_WAITING_FOR_CAPACITY = "TUNING_JOB_STATE_WAITING_FOR_CAPACITY", e.TUNING_JOB_STATE_TUNING = "TUNING_JOB_STATE_TUNING", e.TUNING_JOB_STATE_POST_PROCESSING = "TUNING_JOB_STATE_POST_PROCESSING";
})(je ||= {});
var Me;
(function(e) {
	e.AGGREGATION_METRIC_UNSPECIFIED = "AGGREGATION_METRIC_UNSPECIFIED", e.AVERAGE = "AVERAGE", e.MODE = "MODE", e.STANDARD_DEVIATION = "STANDARD_DEVIATION", e.VARIANCE = "VARIANCE", e.MINIMUM = "MINIMUM", e.MAXIMUM = "MAXIMUM", e.MEDIAN = "MEDIAN", e.PERCENTILE_P90 = "PERCENTILE_P90", e.PERCENTILE_P95 = "PERCENTILE_P95", e.PERCENTILE_P99 = "PERCENTILE_P99";
})(Me ||= {});
var Ne;
(function(e) {
	e.PAIRWISE_CHOICE_UNSPECIFIED = "PAIRWISE_CHOICE_UNSPECIFIED", e.BASELINE = "BASELINE", e.CANDIDATE = "CANDIDATE", e.TIE = "TIE";
})(Ne ||= {});
var Pe;
(function(e) {
	e.TUNING_TASK_UNSPECIFIED = "TUNING_TASK_UNSPECIFIED", e.TUNING_TASK_I2V = "TUNING_TASK_I2V", e.TUNING_TASK_T2V = "TUNING_TASK_T2V", e.TUNING_TASK_R2V = "TUNING_TASK_R2V";
})(Pe ||= {});
var Fe;
(function(e) {
	e.STATE_UNSPECIFIED = "STATE_UNSPECIFIED", e.STATE_PENDING = "STATE_PENDING", e.STATE_ACTIVE = "STATE_ACTIVE", e.STATE_FAILED = "STATE_FAILED";
})(Fe ||= {});
var Ie;
(function(e) {
	e.MEDIA_RESOLUTION_UNSPECIFIED = "MEDIA_RESOLUTION_UNSPECIFIED", e.MEDIA_RESOLUTION_LOW = "MEDIA_RESOLUTION_LOW", e.MEDIA_RESOLUTION_MEDIUM = "MEDIA_RESOLUTION_MEDIUM", e.MEDIA_RESOLUTION_HIGH = "MEDIA_RESOLUTION_HIGH", e.MEDIA_RESOLUTION_ULTRA_HIGH = "MEDIA_RESOLUTION_ULTRA_HIGH";
})(Ie ||= {});
var Le;
(function(e) {
	e.TOOL_TYPE_UNSPECIFIED = "TOOL_TYPE_UNSPECIFIED", e.GOOGLE_SEARCH_WEB = "GOOGLE_SEARCH_WEB", e.GOOGLE_SEARCH_IMAGE = "GOOGLE_SEARCH_IMAGE", e.URL_CONTEXT = "URL_CONTEXT", e.GOOGLE_MAPS = "GOOGLE_MAPS", e.FILE_SEARCH = "FILE_SEARCH";
})(Le ||= {});
var Re;
(function(e) {
	e.COLLECTION = "COLLECTION";
})(Re ||= {});
var ze;
(function(e) {
	e.UNSPECIFIED = "unspecified", e.FLEX = "flex", e.STANDARD = "standard", e.PRIORITY = "priority";
})(ze ||= {});
var Be;
(function(e) {
	e.FEATURE_SELECTION_PREFERENCE_UNSPECIFIED = "FEATURE_SELECTION_PREFERENCE_UNSPECIFIED", e.PRIORITIZE_QUALITY = "PRIORITIZE_QUALITY", e.BALANCED = "BALANCED", e.PRIORITIZE_COST = "PRIORITIZE_COST";
})(Be ||= {});
var Ve;
(function(e) {
	e.PREDICT = "PREDICT", e.EMBED_CONTENT = "EMBED_CONTENT";
})(Ve ||= {});
var He;
(function(e) {
	e.BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE", e.BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE", e.BLOCK_ONLY_HIGH = "BLOCK_ONLY_HIGH", e.BLOCK_NONE = "BLOCK_NONE";
})(He ||= {});
var Ue;
(function(e) {
	e.auto = "auto", e.en = "en", e.ja = "ja", e.ko = "ko", e.hi = "hi", e.zh = "zh", e.pt = "pt", e.es = "es";
})(Ue ||= {});
var We;
(function(e) {
	e.MASK_MODE_DEFAULT = "MASK_MODE_DEFAULT", e.MASK_MODE_USER_PROVIDED = "MASK_MODE_USER_PROVIDED", e.MASK_MODE_BACKGROUND = "MASK_MODE_BACKGROUND", e.MASK_MODE_FOREGROUND = "MASK_MODE_FOREGROUND", e.MASK_MODE_SEMANTIC = "MASK_MODE_SEMANTIC";
})(We ||= {});
var Ge;
(function(e) {
	e.CONTROL_TYPE_DEFAULT = "CONTROL_TYPE_DEFAULT", e.CONTROL_TYPE_CANNY = "CONTROL_TYPE_CANNY", e.CONTROL_TYPE_SCRIBBLE = "CONTROL_TYPE_SCRIBBLE", e.CONTROL_TYPE_FACE_MESH = "CONTROL_TYPE_FACE_MESH";
})(Ge ||= {});
var Ke;
(function(e) {
	e.SUBJECT_TYPE_DEFAULT = "SUBJECT_TYPE_DEFAULT", e.SUBJECT_TYPE_PERSON = "SUBJECT_TYPE_PERSON", e.SUBJECT_TYPE_ANIMAL = "SUBJECT_TYPE_ANIMAL", e.SUBJECT_TYPE_PRODUCT = "SUBJECT_TYPE_PRODUCT";
})(Ke ||= {});
var qe;
(function(e) {
	e.EDIT_MODE_DEFAULT = "EDIT_MODE_DEFAULT", e.EDIT_MODE_INPAINT_REMOVAL = "EDIT_MODE_INPAINT_REMOVAL", e.EDIT_MODE_INPAINT_INSERTION = "EDIT_MODE_INPAINT_INSERTION", e.EDIT_MODE_OUTPAINT = "EDIT_MODE_OUTPAINT", e.EDIT_MODE_CONTROLLED_EDITING = "EDIT_MODE_CONTROLLED_EDITING", e.EDIT_MODE_STYLE = "EDIT_MODE_STYLE", e.EDIT_MODE_BGSWAP = "EDIT_MODE_BGSWAP", e.EDIT_MODE_PRODUCT_IMAGE = "EDIT_MODE_PRODUCT_IMAGE";
})(qe ||= {});
var Je;
(function(e) {
	e.FOREGROUND = "FOREGROUND", e.BACKGROUND = "BACKGROUND", e.PROMPT = "PROMPT", e.SEMANTIC = "SEMANTIC", e.INTERACTIVE = "INTERACTIVE";
})(Je ||= {});
var Ye;
(function(e) {
	e.ASSET = "ASSET", e.STYLE = "STYLE";
})(Ye ||= {});
var Xe;
(function(e) {
	e.INSERT = "INSERT", e.REMOVE = "REMOVE", e.REMOVE_STATIC = "REMOVE_STATIC", e.OUTPAINT = "OUTPAINT";
})(Xe ||= {});
var Ze;
(function(e) {
	e.OPTIMIZED = "OPTIMIZED", e.LOSSLESS = "LOSSLESS";
})(Ze ||= {});
var Qe;
(function(e) {
	e.CROP = "CROP", e.PAD = "PAD";
})(Qe ||= {});
var $e;
(function(e) {
	e.SUPERVISED_FINE_TUNING = "SUPERVISED_FINE_TUNING", e.PREFERENCE_TUNING = "PREFERENCE_TUNING", e.DISTILLATION = "DISTILLATION";
})($e ||= {});
var et;
(function(e) {
	e.STATE_UNSPECIFIED = "STATE_UNSPECIFIED", e.PROCESSING = "PROCESSING", e.ACTIVE = "ACTIVE", e.FAILED = "FAILED";
})(et ||= {});
var tt;
(function(e) {
	e.SOURCE_UNSPECIFIED = "SOURCE_UNSPECIFIED", e.UPLOADED = "UPLOADED", e.GENERATED = "GENERATED", e.REGISTERED = "REGISTERED";
})(tt ||= {});
var nt;
(function(e) {
	e.TURN_COMPLETE_REASON_UNSPECIFIED = "TURN_COMPLETE_REASON_UNSPECIFIED", e.MALFORMED_FUNCTION_CALL = "MALFORMED_FUNCTION_CALL", e.RESPONSE_REJECTED = "RESPONSE_REJECTED", e.NEED_MORE_INPUT = "NEED_MORE_INPUT", e.PROHIBITED_INPUT_CONTENT = "PROHIBITED_INPUT_CONTENT", e.IMAGE_PROHIBITED_INPUT_CONTENT = "IMAGE_PROHIBITED_INPUT_CONTENT", e.INPUT_TEXT_CONTAIN_PROMINENT_PERSON_PROHIBITED = "INPUT_TEXT_CONTAIN_PROMINENT_PERSON_PROHIBITED", e.INPUT_IMAGE_CELEBRITY = "INPUT_IMAGE_CELEBRITY", e.INPUT_IMAGE_PHOTO_REALISTIC_CHILD_PROHIBITED = "INPUT_IMAGE_PHOTO_REALISTIC_CHILD_PROHIBITED", e.INPUT_TEXT_NCII_PROHIBITED = "INPUT_TEXT_NCII_PROHIBITED", e.INPUT_OTHER = "INPUT_OTHER", e.INPUT_IP_PROHIBITED = "INPUT_IP_PROHIBITED", e.BLOCKLIST = "BLOCKLIST", e.UNSAFE_PROMPT_FOR_IMAGE_GENERATION = "UNSAFE_PROMPT_FOR_IMAGE_GENERATION", e.GENERATED_IMAGE_SAFETY = "GENERATED_IMAGE_SAFETY", e.GENERATED_CONTENT_SAFETY = "GENERATED_CONTENT_SAFETY", e.GENERATED_AUDIO_SAFETY = "GENERATED_AUDIO_SAFETY", e.GENERATED_VIDEO_SAFETY = "GENERATED_VIDEO_SAFETY", e.GENERATED_CONTENT_PROHIBITED = "GENERATED_CONTENT_PROHIBITED", e.GENERATED_CONTENT_BLOCKLIST = "GENERATED_CONTENT_BLOCKLIST", e.GENERATED_IMAGE_PROHIBITED = "GENERATED_IMAGE_PROHIBITED", e.GENERATED_IMAGE_CELEBRITY = "GENERATED_IMAGE_CELEBRITY", e.GENERATED_IMAGE_PROMINENT_PEOPLE_DETECTED_BY_REWRITER = "GENERATED_IMAGE_PROMINENT_PEOPLE_DETECTED_BY_REWRITER", e.GENERATED_IMAGE_IDENTIFIABLE_PEOPLE = "GENERATED_IMAGE_IDENTIFIABLE_PEOPLE", e.GENERATED_IMAGE_MINORS = "GENERATED_IMAGE_MINORS", e.OUTPUT_IMAGE_IP_PROHIBITED = "OUTPUT_IMAGE_IP_PROHIBITED", e.GENERATED_OTHER = "GENERATED_OTHER", e.MAX_REGENERATION_REACHED = "MAX_REGENERATION_REACHED";
})(nt ||= {});
var rt;
(function(e) {
	e.MODALITY_UNSPECIFIED = "MODALITY_UNSPECIFIED", e.TEXT = "TEXT", e.IMAGE = "IMAGE", e.VIDEO = "VIDEO", e.AUDIO = "AUDIO", e.DOCUMENT = "DOCUMENT";
})(rt ||= {});
var it;
(function(e) {
	e.VAD_SIGNAL_TYPE_UNSPECIFIED = "VAD_SIGNAL_TYPE_UNSPECIFIED", e.VAD_SIGNAL_TYPE_SOS = "VAD_SIGNAL_TYPE_SOS", e.VAD_SIGNAL_TYPE_EOS = "VAD_SIGNAL_TYPE_EOS";
})(it ||= {});
var at;
(function(e) {
	e.TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED", e.ACTIVITY_START = "ACTIVITY_START", e.ACTIVITY_END = "ACTIVITY_END";
})(at ||= {});
var ot;
(function(e) {
	e.START_SENSITIVITY_UNSPECIFIED = "START_SENSITIVITY_UNSPECIFIED", e.START_SENSITIVITY_HIGH = "START_SENSITIVITY_HIGH", e.START_SENSITIVITY_LOW = "START_SENSITIVITY_LOW";
})(ot ||= {});
var st;
(function(e) {
	e.END_SENSITIVITY_UNSPECIFIED = "END_SENSITIVITY_UNSPECIFIED", e.END_SENSITIVITY_HIGH = "END_SENSITIVITY_HIGH", e.END_SENSITIVITY_LOW = "END_SENSITIVITY_LOW";
})(st ||= {});
var ct;
(function(e) {
	e.ACTIVITY_HANDLING_UNSPECIFIED = "ACTIVITY_HANDLING_UNSPECIFIED", e.START_OF_ACTIVITY_INTERRUPTS = "START_OF_ACTIVITY_INTERRUPTS", e.NO_INTERRUPTION = "NO_INTERRUPTION";
})(ct ||= {});
var lt;
(function(e) {
	e.TURN_COVERAGE_UNSPECIFIED = "TURN_COVERAGE_UNSPECIFIED", e.TURN_INCLUDES_ONLY_ACTIVITY = "TURN_INCLUDES_ONLY_ACTIVITY", e.TURN_INCLUDES_ALL_INPUT = "TURN_INCLUDES_ALL_INPUT", e.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO = "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO";
})(lt ||= {});
var ut;
(function(e) {
	e.SCALE_UNSPECIFIED = "SCALE_UNSPECIFIED", e.C_MAJOR_A_MINOR = "C_MAJOR_A_MINOR", e.D_FLAT_MAJOR_B_FLAT_MINOR = "D_FLAT_MAJOR_B_FLAT_MINOR", e.D_MAJOR_B_MINOR = "D_MAJOR_B_MINOR", e.E_FLAT_MAJOR_C_MINOR = "E_FLAT_MAJOR_C_MINOR", e.E_MAJOR_D_FLAT_MINOR = "E_MAJOR_D_FLAT_MINOR", e.F_MAJOR_D_MINOR = "F_MAJOR_D_MINOR", e.G_FLAT_MAJOR_E_FLAT_MINOR = "G_FLAT_MAJOR_E_FLAT_MINOR", e.G_MAJOR_E_MINOR = "G_MAJOR_E_MINOR", e.A_FLAT_MAJOR_F_MINOR = "A_FLAT_MAJOR_F_MINOR", e.A_MAJOR_G_FLAT_MINOR = "A_MAJOR_G_FLAT_MINOR", e.B_FLAT_MAJOR_G_MINOR = "B_FLAT_MAJOR_G_MINOR", e.B_MAJOR_A_FLAT_MINOR = "B_MAJOR_A_FLAT_MINOR";
})(ut ||= {});
var dt;
(function(e) {
	e.MUSIC_GENERATION_MODE_UNSPECIFIED = "MUSIC_GENERATION_MODE_UNSPECIFIED", e.QUALITY = "QUALITY", e.DIVERSITY = "DIVERSITY", e.VOCALIZATION = "VOCALIZATION";
})(dt ||= {});
var ft;
(function(e) {
	e.PLAYBACK_CONTROL_UNSPECIFIED = "PLAYBACK_CONTROL_UNSPECIFIED", e.PLAY = "PLAY", e.PAUSE = "PAUSE", e.STOP = "STOP", e.RESET_CONTEXT = "RESET_CONTEXT";
})(ft ||= {});
var pt = class {
	constructor(e) {
		let t = {};
		for (let n of e.headers.entries()) t[n[0]] = n[1];
		this.headers = t, this.responseInternal = e;
	}
	json() {
		return this.responseInternal.json();
	}
}, mt = class {
	get text() {
		if (this.candidates?.[0]?.content?.parts?.length === 0) return;
		this.candidates && this.candidates.length > 1 && console.warn("there are multiple candidates in the response, returning text from the first one.");
		let e = "", t = !1, n = [];
		for (let r of this.candidates?.[0]?.content?.parts ?? []) {
			for (let [e, t] of Object.entries(r)) e !== "text" && e !== "thought" && e !== "thoughtSignature" && (t !== null || t !== void 0) && n.push(e);
			if (typeof r.text == "string") {
				if (typeof r.thought == "boolean" && r.thought) continue;
				t = !0, e += r.text;
			}
		}
		return n.length > 0 && console.warn(`there are non-text parts ${n} in the response, returning concatenation of all text parts. Please refer to the non text parts for a full response from model.`), t ? e : void 0;
	}
	get data() {
		if (this.candidates?.[0]?.content?.parts?.length === 0) return;
		this.candidates && this.candidates.length > 1 && console.warn("there are multiple candidates in the response, returning data from the first one.");
		let e = "", t = [];
		for (let n of this.candidates?.[0]?.content?.parts ?? []) {
			for (let [e, r] of Object.entries(n)) e !== "inlineData" && (r !== null || r !== void 0) && t.push(e);
			n.inlineData && typeof n.inlineData.data == "string" && (e += atob(n.inlineData.data));
		}
		return t.length > 0 && console.warn(`there are non-data parts ${t} in the response, returning concatenation of all data parts. Please refer to the non data parts for a full response from model.`), e.length > 0 ? btoa(e) : void 0;
	}
	get functionCalls() {
		if (this.candidates?.[0]?.content?.parts?.length === 0) return;
		this.candidates && this.candidates.length > 1 && console.warn("there are multiple candidates in the response, returning function calls from the first one.");
		let e = (this.candidates?.[0]?.content?.parts)?.filter((e) => e.functionCall).map((e) => e.functionCall).filter((e) => e !== void 0);
		if (e?.length !== 0) return e;
	}
	get executableCode() {
		if (this.candidates?.[0]?.content?.parts?.length === 0) return;
		this.candidates && this.candidates.length > 1 && console.warn("there are multiple candidates in the response, returning executable code from the first one.");
		let e = (this.candidates?.[0]?.content?.parts)?.filter((e) => e.executableCode).map((e) => e.executableCode).filter((e) => e !== void 0);
		if (e?.length !== 0) return e?.[0]?.code;
	}
	get codeExecutionResult() {
		if (this.candidates?.[0]?.content?.parts?.length === 0) return;
		this.candidates && this.candidates.length > 1 && console.warn("there are multiple candidates in the response, returning code execution result from the first one.");
		let e = (this.candidates?.[0]?.content?.parts)?.filter((e) => e.codeExecutionResult).map((e) => e.codeExecutionResult).filter((e) => e !== void 0);
		if (e?.length !== 0) return e?.[0]?.output;
	}
}, ht = class {}, gt = class {}, _t = class {}, vt = class {}, yt = class {}, bt = class {}, xt = class {}, St = class {}, Ct = class {}, wt = class {}, Tt = class e {
	_fromAPIResponse({ apiResponse: t, _isVertexAI: n }) {
		let r = new e(), i, a = t;
		return i = n ? C(a) : S(a), Object.assign(r, i), r;
	}
}, Et = class {}, Dt = class {}, Ot = class {}, kt = class {}, At = class {}, jt = class {}, Mt = class {}, Nt = class e {
	_fromAPIResponse({ apiResponse: t, _isVertexAI: n }) {
		let r = new e(), i = A(t);
		return Object.assign(r, i), r;
	}
}, Pt = class {}, Ft = class {}, It = class {}, Lt = class {}, Rt = class {}, zt = class {
	get text() {
		let e = "", t = !1, n = [];
		for (let r of this.serverContent?.modelTurn?.parts ?? []) {
			for (let [e, t] of Object.entries(r)) e !== "text" && e !== "thought" && t !== null && n.push(e);
			if (typeof r.text == "string") {
				if (typeof r.thought == "boolean" && r.thought) continue;
				t = !0, e += r.text;
			}
		}
		return n.length > 0 && console.warn(`there are non-text parts ${n} in the response, returning concatenation of all text parts. Please refer to the non text parts for a full response from model.`), t ? e : void 0;
	}
	get data() {
		let e = "", t = [];
		for (let n of this.serverContent?.modelTurn?.parts ?? []) {
			for (let [e, r] of Object.entries(n)) e !== "inlineData" && r !== null && t.push(e);
			n.inlineData && typeof n.inlineData.data == "string" && (e += atob(n.inlineData.data));
		}
		return t.length > 0 && console.warn(`there are non-data parts ${t} in the response, returning concatenation of all data parts. Please refer to the non data parts for a full response from model.`), e.length > 0 ? btoa(e) : void 0;
	}
}, Bt = class {
	get audioChunk() {
		if (this.serverContent && this.serverContent.audioChunks && this.serverContent.audioChunks.length > 0) return this.serverContent.audioChunks[0];
	}
}, Vt = class e {
	_fromAPIResponse({ apiResponse: t, _isVertexAI: n }) {
		let r = new e(), i = M(t);
		return Object.assign(r, i), r;
	}
};
function F(e, t) {
	if (!t || typeof t != "string") throw Error("model is required and must be a string");
	if (t.includes("..") || t.includes("?") || t.includes("&")) throw Error("invalid model parameter");
	if (e.isVertexAI()) {
		if (t.startsWith("publishers/") || t.startsWith("projects/") || t.startsWith("models/")) return t;
		if (t.indexOf("/") >= 0) {
			let e = t.split("/", 2);
			return `publishers/${e[0]}/models/${e[1]}`;
		}
		return `publishers/google/models/${t}`;
	}
	return t.startsWith("models/") || t.startsWith("tunedModels/") ? t : `models/${t}`;
}
function Ht(e, t) {
	let n = F(e, t);
	return n ? n.startsWith("publishers/") && e.isVertexAI() ? `projects/${e.getProject()}/locations/${e.getLocation()}/${n}` : n.startsWith("models/") && e.isVertexAI() ? `projects/${e.getProject()}/locations/${e.getLocation()}/publishers/google/${n}` : n : "";
}
function Ut(e) {
	return Array.isArray(e) ? e.map((e) => Wt(e)) : [Wt(e)];
}
function Wt(e) {
	if (typeof e == "object" && e) return e;
	throw Error(`Could not parse input as Blob. Unsupported blob type: ${typeof e}`);
}
function Gt(e) {
	let t = Wt(e);
	if (t.mimeType && t.mimeType.startsWith("image/")) return t;
	throw Error(`Unsupported mime type: ${t.mimeType}`);
}
function Kt(e) {
	let t = Wt(e);
	if (t.mimeType && t.mimeType.startsWith("audio/")) return t;
	throw Error(`Unsupported mime type: ${t.mimeType}`);
}
function qt(e) {
	if (e == null) throw Error("PartUnion is required");
	if (typeof e == "object") return e;
	if (typeof e == "string") return { text: e };
	throw Error(`Unsupported part type: ${typeof e}`);
}
function Jt(e) {
	if (e == null || Array.isArray(e) && e.length === 0) throw Error("PartListUnion is required");
	return Array.isArray(e) ? e.map((e) => qt(e)) : [qt(e)];
}
function Yt(e) {
	return typeof e == "object" && !!e && "parts" in e && Array.isArray(e.parts);
}
function Xt(e) {
	return typeof e == "object" && !!e && "functionCall" in e;
}
function Zt(e) {
	return typeof e == "object" && !!e && "functionResponse" in e;
}
function I(e) {
	if (e == null) throw Error("ContentUnion is required");
	return Yt(e) ? e : {
		role: "user",
		parts: Jt(e)
	};
}
function Qt(e, t) {
	if (!t) return [];
	if (e.isVertexAI() && Array.isArray(t)) return t.flatMap((e) => {
		let t = I(e);
		return t.parts && t.parts.length > 0 && t.parts[0].text !== void 0 ? [t.parts[0].text] : [];
	});
	if (e.isVertexAI()) {
		let e = I(t);
		return e.parts && e.parts.length > 0 && e.parts[0].text !== void 0 ? [e.parts[0].text] : [];
	}
	return Array.isArray(t) ? t.map((e) => I(e)) : [I(t)];
}
function L(e) {
	if (e == null || Array.isArray(e) && e.length === 0) throw Error("contents are required");
	if (!Array.isArray(e)) {
		if (Xt(e) || Zt(e)) throw Error("To specify functionCall or functionResponse parts, please wrap them in a Content object, specifying the role for them");
		return [I(e)];
	}
	let t = [], n = [], r = Yt(e[0]);
	for (let i of e) {
		let e = Yt(i);
		if (e != r) throw Error("Mixing Content and Parts is not supported, please group the parts into a the appropriate Content objects and specify the roles for them");
		if (e) t.push(i);
		else if (Xt(i) || Zt(i)) throw Error("To specify functionCall or functionResponse parts, please wrap them, and any other parts, in Content objects as appropriate, specifying the role for them");
		else n.push(i);
	}
	return r || t.push({
		role: "user",
		parts: Jt(n)
	}), t;
}
function $t(e, t) {
	e.includes("null") && (t.nullable = !0);
	let n = e.filter((e) => e !== "null");
	if (n.length === 1) t.type = Object.values(N).includes(n[0].toUpperCase()) ? n[0].toUpperCase() : N.TYPE_UNSPECIFIED;
	else {
		t.anyOf = [];
		for (let e of n) t.anyOf.push({ type: Object.values(N).includes(e.toUpperCase()) ? e.toUpperCase() : N.TYPE_UNSPECIFIED });
	}
}
function en(e) {
	let t = {}, n = ["items"], r = ["anyOf"], i = ["properties"];
	if (e.type && e.anyOf) throw Error("type and anyOf cannot be both populated.");
	let a = e.anyOf;
	a != null && a.length == 2 && (a[0].type === "null" ? (t.nullable = !0, e = a[1]) : a[1].type === "null" && (t.nullable = !0, e = a[0])), e.type instanceof Array && $t(e.type, t);
	for (let [a, o] of Object.entries(e)) if (o != null) {
		if (a == "type") {
			if (o === "null") throw Error("type: null can not be the only possible type for the field.");
			if (o instanceof Array) continue;
			t.type = Object.values(N).includes(o.toUpperCase()) ? o.toUpperCase() : N.TYPE_UNSPECIFIED;
		} else if (n.includes(a)) t[a] = en(o);
		else if (r.includes(a)) {
			let e = [];
			for (let n of o) {
				if (n.type == "null") {
					t.nullable = !0;
					continue;
				}
				e.push(en(n));
			}
			t[a] = e;
		} else if (i.includes(a)) {
			let e = {};
			for (let [t, n] of Object.entries(o)) e[t] = en(n);
			t[a] = e;
		} else {
			if (a === "additionalProperties") continue;
			t[a] = o;
		}
	}
	return t;
}
function tn(e) {
	return en(e);
}
function nn(e) {
	if (typeof e == "object") return e;
	if (typeof e == "string") return { voiceConfig: { prebuiltVoiceConfig: { voiceName: e } } };
	throw Error(`Unsupported speechConfig type: ${typeof e}`);
}
function rn(e) {
	if ("multiSpeakerVoiceConfig" in e) throw Error("multiSpeakerVoiceConfig is not supported in the live API.");
	return e;
}
function R(e) {
	if (e.functionDeclarations) for (let t of e.functionDeclarations) t.parameters && (Object.keys(t.parameters).includes("$schema") ? t.parametersJsonSchema || (t.parametersJsonSchema = t.parameters, delete t.parameters) : t.parameters = en(t.parameters)), t.response && (Object.keys(t.response).includes("$schema") ? t.responseJsonSchema || (t.responseJsonSchema = t.response, delete t.response) : t.response = en(t.response));
	return e;
}
function an(e) {
	if (e == null) throw Error("tools is required");
	if (!Array.isArray(e)) throw Error("tools is required and must be an array of Tools");
	let t = [];
	for (let n of e) t.push(n);
	return t;
}
function on(e, t, n, r = 1) {
	let i = !t.startsWith(`${n}/`) && t.split("/").length === r;
	return e.isVertexAI() ? t.startsWith("projects/") ? t : t.startsWith("locations/") ? `projects/${e.getProject()}/${t}` : t.startsWith(`${n}/`) ? `projects/${e.getProject()}/locations/${e.getLocation()}/${t}` : i ? `projects/${e.getProject()}/locations/${e.getLocation()}/${n}/${t}` : t : i ? `${n}/${t}` : t;
}
function z(e, t) {
	if (typeof t != "string") throw Error("name must be a string");
	return on(e, t, "cachedContents");
}
function sn(e) {
	switch (e) {
		case "STATE_UNSPECIFIED": return "JOB_STATE_UNSPECIFIED";
		case "CREATING": return "JOB_STATE_RUNNING";
		case "ACTIVE": return "JOB_STATE_SUCCEEDED";
		case "FAILED": return "JOB_STATE_FAILED";
		default: return e;
	}
}
function B(e) {
	return b(e);
}
function cn(e) {
	return typeof e == "object" && !!e && "name" in e;
}
function ln(e) {
	return typeof e == "object" && !!e && "video" in e;
}
function un(e) {
	return typeof e == "object" && !!e && "uri" in e;
}
function dn(e) {
	let t;
	if (cn(e) && (t = e.name), !(un(e) && (t = e.uri, t === void 0)) && !(ln(e) && (t = e.video?.uri, t === void 0))) {
		if (typeof e == "string" && (t = e), t === void 0) throw Error("Could not extract file name from the provided input.");
		if (t.startsWith("https://")) {
			let e = t.split("files/")[1].match(/[a-z0-9]+/);
			if (e === null) throw Error(`Could not extract file name from URI ${t}`);
			t = e[0];
		} else t.startsWith("files/") && (t = t.split("files/")[1]);
		return t;
	}
}
function fn(e, t) {
	let n;
	return n = e.isVertexAI() ? t ? "publishers/google/models" : "models" : t ? "models" : "tunedModels", n;
}
function pn(e) {
	for (let t of [
		"models",
		"tunedModels",
		"publisherModels"
	]) if (mn(e, t)) return e[t];
	return [];
}
function mn(e, t) {
	return typeof e == "object" && !!e && t in e;
}
function hn(e, t = {}) {
	let n = e, r = {
		name: n.name,
		description: n.description,
		parametersJsonSchema: n.inputSchema
	};
	return n.outputSchema && (r.responseJsonSchema = n.outputSchema), t.behavior && (r.behavior = t.behavior), { functionDeclarations: [r] };
}
function gn(e, t = {}) {
	let n = [], r = /* @__PURE__ */ new Set();
	for (let i of e) {
		let e = i.name;
		if (r.has(e)) throw Error(`Duplicate function name ${e} found in MCP tools. Please ensure function names are unique.`);
		r.add(e);
		let a = hn(i, t);
		a.functionDeclarations && n.push(...a.functionDeclarations);
	}
	return { functionDeclarations: n };
}
function _n(e, t) {
	let n;
	if (typeof t == "string") {
		if (e.isVertexAI()) {
			if (t.startsWith("gs://")) n = {
				format: "jsonl",
				gcsUri: [t]
			};
			else if (t.startsWith("bq://")) n = {
				format: "bigquery",
				bigqueryUri: t
			};
			else if (/^projects\/[^/]+\/locations\/[^/]+\/datasets\/[^/]+$/.test(t)) n = {
				format: "vertex-dataset",
				vertexDatasetName: t
			};
			else throw Error(`Unsupported string source for Vertex AI: ${t}`);
		} else if (t.startsWith("files/")) n = { fileName: t };
		else throw Error(`Unsupported string source for Gemini API: ${t}`);
	} else if (Array.isArray(t)) {
		if (e.isVertexAI()) throw Error("InlinedRequest[] is not supported in Vertex AI.");
		n = { inlinedRequests: t };
	} else n = t;
	let r = [
		n.gcsUri,
		n.bigqueryUri,
		n.vertexDatasetName
	].filter(Boolean).length, i = [n.inlinedRequests, n.fileName].filter(Boolean).length;
	if (e.isVertexAI()) {
		if (i > 0 || r !== 1) throw Error("Exactly one of `gcsUri`, `bigqueryUri`, or `vertexDatasetName` must be set for Vertex AI.");
	} else if (r > 0 || i !== 1) throw Error("Exactly one of `inlinedRequests`, `fileName`, must be set for Gemini API.");
	return n;
}
function vn(e) {
	if (typeof e != "string") return e;
	let t = e;
	if (t.startsWith("gs://")) return {
		format: "jsonl",
		gcsUri: t
	};
	if (t.startsWith("bq://")) return {
		format: "bigquery",
		bigqueryUri: t
	};
	throw Error(`Unsupported destination: ${t}`);
}
function yn(e) {
	if (typeof e != "object" || !e) return {};
	let t = e, n = t.inlinedResponses;
	if (typeof n != "object" || !n) return e;
	let r = n.inlinedResponses;
	if (!Array.isArray(r) || r.length === 0) return e;
	let i = !1;
	for (let e of r) {
		if (typeof e != "object" || !e) continue;
		let t = e.response;
		if (!(typeof t != "object" || !t) && t.embedding !== void 0) {
			i = !0;
			break;
		}
	}
	return i && (t.inlinedEmbedContentResponses = t.inlinedResponses, delete t.inlinedResponses), e;
}
function bn(e, t) {
	let n = t;
	if (!e.isVertexAI()) {
		if (/batches\/[^/]+$/.test(n)) return n.split("/").pop();
		throw Error(`Invalid batch job name: ${n}.`);
	}
	if (/^projects\/[^/]+\/locations\/[^/]+\/batchPredictionJobs\/[^/]+$/.test(n)) return n.split("/").pop();
	if (/^\d+$/.test(n)) return n;
	throw Error(`Invalid batch job name: ${n}.`);
}
function xn(e) {
	let t = e;
	return t === "BATCH_STATE_UNSPECIFIED" ? "JOB_STATE_UNSPECIFIED" : t === "BATCH_STATE_PENDING" ? "JOB_STATE_PENDING" : t === "BATCH_STATE_RUNNING" ? "JOB_STATE_RUNNING" : t === "BATCH_STATE_SUCCEEDED" ? "JOB_STATE_SUCCEEDED" : t === "BATCH_STATE_FAILED" ? "JOB_STATE_FAILED" : t === "BATCH_STATE_CANCELLED" ? "JOB_STATE_CANCELLED" : t === "BATCH_STATE_EXPIRED" ? "JOB_STATE_EXPIRED" : t;
}
function Sn(e) {
	return e.includes("gemini") && e !== "gemini-embedding-001" || e.includes("maas");
}
function Cn(e) {
	let t = {}, n = _(e, ["apiKey"]);
	if (n != null && g(t, ["apiKey"], n), _(e, ["apiKeyConfig"]) !== void 0) throw Error("apiKeyConfig parameter is not supported in Gemini API.");
	if (_(e, ["authType"]) !== void 0) throw Error("authType parameter is not supported in Gemini API.");
	if (_(e, ["googleServiceAccountConfig"]) !== void 0) throw Error("googleServiceAccountConfig parameter is not supported in Gemini API.");
	if (_(e, ["httpBasicAuthConfig"]) !== void 0) throw Error("httpBasicAuthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oauthConfig"]) !== void 0) throw Error("oauthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oidcConfig"]) !== void 0) throw Error("oidcConfig parameter is not supported in Gemini API.");
	return t;
}
function wn(e) {
	let t = {}, n = _(e, ["responsesFile"]);
	n != null && g(t, ["fileName"], n);
	let r = _(e, ["inlinedResponses", "inlinedResponses"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => cr(e))), g(t, ["inlinedResponses"], e);
	}
	let i = _(e, ["inlinedEmbedContentResponses", "inlinedResponses"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["inlinedEmbedContentResponses"], e);
	}
	return t;
}
function Tn(e) {
	let t = {}, n = _(e, ["predictionsFormat"]);
	n != null && g(t, ["format"], n);
	let r = _(e, ["gcsDestination", "outputUriPrefix"]);
	r != null && g(t, ["gcsUri"], r);
	let i = _(e, ["bigqueryDestination", "outputUri"]);
	i != null && g(t, ["bigqueryUri"], i);
	let a = _(e, ["vertexMultimodalDatasetDestination"]);
	return a != null && g(t, ["vertexDataset"], yr(a)), t;
}
function En(e) {
	let t = {}, n = _(e, ["format"]);
	n != null && g(t, ["predictionsFormat"], n);
	let r = _(e, ["gcsUri"]);
	r != null && g(t, ["gcsDestination", "outputUriPrefix"], r);
	let i = _(e, ["bigqueryUri"]);
	if (i != null && g(t, ["bigqueryDestination", "outputUri"], i), _(e, ["fileName"]) !== void 0) throw Error("fileName parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["inlinedResponses"]) !== void 0) throw Error("inlinedResponses parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["inlinedEmbedContentResponses"]) !== void 0) throw Error("inlinedEmbedContentResponses parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let a = _(e, ["vertexDataset"]);
	return a != null && g(t, ["vertexMultimodalDatasetDestination"], br(a)), t;
}
function Dn(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["metadata", "displayName"]);
	r != null && g(t, ["displayName"], r);
	let i = _(e, ["metadata", "state"]);
	i != null && g(t, ["state"], xn(i));
	let a = _(e, ["metadata", "createTime"]);
	a != null && g(t, ["createTime"], a);
	let o = _(e, ["metadata", "endTime"]);
	o != null && g(t, ["endTime"], o);
	let s = _(e, ["metadata", "updateTime"]);
	s != null && g(t, ["updateTime"], s);
	let c = _(e, ["metadata", "model"]);
	c != null && g(t, ["model"], c);
	let l = _(e, ["metadata", "output"]);
	return l != null && g(t, ["dest"], wn(yn(l))), t;
}
function On(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["displayName"]);
	r != null && g(t, ["displayName"], r);
	let i = _(e, ["state"]);
	i != null && g(t, ["state"], xn(i));
	let a = _(e, ["error"]);
	a != null && g(t, ["error"], a);
	let o = _(e, ["createTime"]);
	o != null && g(t, ["createTime"], o);
	let s = _(e, ["startTime"]);
	s != null && g(t, ["startTime"], s);
	let c = _(e, ["endTime"]);
	c != null && g(t, ["endTime"], c);
	let l = _(e, ["updateTime"]);
	l != null && g(t, ["updateTime"], l);
	let u = _(e, ["model"]);
	u != null && g(t, ["model"], u);
	let d = _(e, ["inputConfig"]);
	d != null && g(t, ["src"], kn(d));
	let f = _(e, ["outputConfig"]);
	f != null && g(t, ["dest"], Tn(yn(f)));
	let p = _(e, ["completionStats"]);
	p != null && g(t, ["completionStats"], p);
	let m = _(e, ["outputInfo"]);
	return m != null && g(t, ["outputInfo"], m), t;
}
function kn(e) {
	let t = {}, n = _(e, ["instancesFormat"]);
	n != null && g(t, ["format"], n);
	let r = _(e, ["gcsSource", "uris"]);
	r != null && g(t, ["gcsUri"], r);
	let i = _(e, ["bigquerySource", "inputUri"]);
	i != null && g(t, ["bigqueryUri"], i);
	let a = _(e, ["vertexMultimodalDatasetSource", "datasetName"]);
	return a != null && g(t, ["vertexDatasetName"], a), t;
}
function An(e, t) {
	let n = {};
	if (_(t, ["format"]) !== void 0) throw Error("format parameter is not supported in Gemini API.");
	if (_(t, ["gcsUri"]) !== void 0) throw Error("gcsUri parameter is not supported in Gemini API.");
	if (_(t, ["bigqueryUri"]) !== void 0) throw Error("bigqueryUri parameter is not supported in Gemini API.");
	let r = _(t, ["fileName"]);
	r != null && g(n, ["fileName"], r);
	let i = _(t, ["inlinedRequests"]);
	if (i != null) {
		let t = i;
		Array.isArray(t) && (t = t.map((t) => sr(e, t))), g(n, ["requests", "requests"], t);
	}
	if (_(t, ["vertexDatasetName"]) !== void 0) throw Error("vertexDatasetName parameter is not supported in Gemini API.");
	return n;
}
function jn(e) {
	let t = {}, n = _(e, ["format"]);
	n != null && g(t, ["instancesFormat"], n);
	let r = _(e, ["gcsUri"]);
	r != null && g(t, ["gcsSource", "uris"], r);
	let i = _(e, ["bigqueryUri"]);
	if (i != null && g(t, ["bigquerySource", "inputUri"], i), _(e, ["fileName"]) !== void 0) throw Error("fileName parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["inlinedRequests"]) !== void 0) throw Error("inlinedRequests parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let a = _(e, ["vertexDatasetName"]);
	return a != null && g(t, ["vertexMultimodalDatasetSource", "datasetName"], a), t;
}
function Mn(e) {
	let t = {}, n = _(e, ["data"]);
	if (n != null && g(t, ["data"], n), _(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function Nn(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], bn(e, r)), n;
}
function Pn(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], bn(e, r)), n;
}
function Fn(e) {
	let t = {}, n = _(e, ["content"]);
	n != null && g(t, ["content"], n);
	let r = _(e, ["citationMetadata"]);
	r != null && g(t, ["citationMetadata"], In(r));
	let i = _(e, ["tokenCount"]);
	i != null && g(t, ["tokenCount"], i);
	let a = _(e, ["finishReason"]);
	a != null && g(t, ["finishReason"], a);
	let o = _(e, ["groundingMetadata"]);
	o != null && g(t, ["groundingMetadata"], o);
	let s = _(e, ["avgLogprobs"]);
	s != null && g(t, ["avgLogprobs"], s);
	let c = _(e, ["index"]);
	c != null && g(t, ["index"], c);
	let l = _(e, ["logprobsResult"]);
	l != null && g(t, ["logprobsResult"], l);
	let u = _(e, ["safetyRatings"]);
	if (u != null) {
		let e = u;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["safetyRatings"], e);
	}
	let d = _(e, ["urlContextMetadata"]);
	return d != null && g(t, ["urlContextMetadata"], d), t;
}
function In(e) {
	let t = {}, n = _(e, ["citationSources"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["citations"], e);
	}
	return t;
}
function Ln(e) {
	let t = {}, n = _(e, ["parts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => hr(e))), g(t, ["parts"], e);
	}
	let r = _(e, ["role"]);
	return r != null && g(t, ["role"], r), t;
}
function Rn(e, t) {
	let n = {}, r = _(e, ["displayName"]);
	if (t !== void 0 && r != null && g(t, ["batch", "displayName"], r), _(e, ["dest"]) !== void 0) throw Error("dest parameter is not supported in Gemini API.");
	let i = _(e, ["webhookConfig"]);
	return t !== void 0 && i != null && g(t, ["batch", "webhookConfig"], i), n;
}
function zn(e, t) {
	let n = {}, r = _(e, ["displayName"]);
	t !== void 0 && r != null && g(t, ["displayName"], r);
	let i = _(e, ["dest"]);
	if (t !== void 0 && i != null && g(t, ["outputConfig"], En(vn(i))), _(e, ["webhookConfig"]) !== void 0) throw Error("webhookConfig parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return n;
}
function Bn(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["_url", "model"], F(e, r));
	let i = _(t, ["src"]);
	i != null && g(n, ["batch", "inputConfig"], An(e, _n(e, i)));
	let a = _(t, ["config"]);
	return a != null && Rn(a, n), n;
}
function Vn(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["model"], F(e, r));
	let i = _(t, ["src"]);
	i != null && g(n, ["inputConfig"], jn(_n(e, i)));
	let a = _(t, ["config"]);
	return a != null && zn(a, n), n;
}
function Hn(e, t) {
	let n = {}, r = _(e, ["displayName"]);
	return t !== void 0 && r != null && g(t, ["batch", "displayName"], r), n;
}
function Un(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["_url", "model"], F(e, r));
	let i = _(t, ["src"]);
	i != null && g(n, ["batch", "inputConfig"], Xn(e, i));
	let a = _(t, ["config"]);
	return a != null && Hn(a, n), n;
}
function Wn(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], bn(e, r)), n;
}
function Gn(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], bn(e, r)), n;
}
function Kn(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["name"]);
	r != null && g(t, ["name"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	return a != null && g(t, ["error"], a), t;
}
function qn(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["name"]);
	r != null && g(t, ["name"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	return a != null && g(t, ["error"], a), t;
}
function Jn(e, t) {
	let n = {}, r = _(t, ["contents"]);
	if (r != null) {
		let t = Qt(e, r);
		Array.isArray(t) && (t = t.map((e) => e)), g(n, [
			"requests[]",
			"request",
			"content"
		], t);
	}
	let i = _(t, ["config"]);
	return i != null && (g(n, ["_self"], Yn(i, n)), v(n, { "requests[].*": "requests[].request.*" })), n;
}
function Yn(e, t) {
	let n = {}, r = _(e, ["taskType"]);
	t !== void 0 && r != null && g(t, ["requests[]", "taskType"], r);
	let i = _(e, ["title"]);
	t !== void 0 && i != null && g(t, ["requests[]", "title"], i);
	let a = _(e, ["outputDimensionality"]);
	if (t !== void 0 && a != null && g(t, ["requests[]", "outputDimensionality"], a), _(e, ["mimeType"]) !== void 0) throw Error("mimeType parameter is not supported in Gemini API.");
	if (_(e, ["autoTruncate"]) !== void 0) throw Error("autoTruncate parameter is not supported in Gemini API.");
	if (_(e, ["documentOcr"]) !== void 0) throw Error("documentOcr parameter is not supported in Gemini API.");
	if (_(e, ["audioTrackExtraction"]) !== void 0) throw Error("audioTrackExtraction parameter is not supported in Gemini API.");
	return n;
}
function Xn(e, t) {
	let n = {}, r = _(t, ["fileName"]);
	r != null && g(n, ["file_name"], r);
	let i = _(t, ["inlinedRequests"]);
	return i != null && g(n, ["requests"], Jn(e, i)), n;
}
function Zn(e) {
	let t = {};
	if (_(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let n = _(e, ["fileUri"]);
	n != null && g(t, ["fileUri"], n);
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function Qn(e) {
	let t = {}, n = _(e, ["id"]);
	n != null && g(t, ["id"], n);
	let r = _(e, ["args"]);
	r != null && g(t, ["args"], r);
	let i = _(e, ["name"]);
	if (i != null && g(t, ["name"], i), _(e, ["partialArgs"]) !== void 0) throw Error("partialArgs parameter is not supported in Gemini API.");
	if (_(e, ["willContinue"]) !== void 0) throw Error("willContinue parameter is not supported in Gemini API.");
	return t;
}
function $n(e) {
	let t = {}, n = _(e, ["allowedFunctionNames"]);
	n != null && g(t, ["allowedFunctionNames"], n);
	let r = _(e, ["mode"]);
	if (r != null && g(t, ["mode"], r), _(e, ["streamFunctionCallArguments"]) !== void 0) throw Error("streamFunctionCallArguments parameter is not supported in Gemini API.");
	return t;
}
function er(e, t, n) {
	let r = {}, i = _(t, ["systemInstruction"]);
	n !== void 0 && i != null && g(n, ["systemInstruction"], Ln(I(i)));
	let a = _(t, ["temperature"]);
	a != null && g(r, ["temperature"], a);
	let o = _(t, ["topP"]);
	o != null && g(r, ["topP"], o);
	let s = _(t, ["topK"]);
	s != null && g(r, ["topK"], s);
	let c = _(t, ["candidateCount"]);
	c != null && g(r, ["candidateCount"], c);
	let l = _(t, ["maxOutputTokens"]);
	l != null && g(r, ["maxOutputTokens"], l);
	let u = _(t, ["stopSequences"]);
	u != null && g(r, ["stopSequences"], u);
	let d = _(t, ["responseLogprobs"]);
	d != null && g(r, ["responseLogprobs"], d);
	let f = _(t, ["logprobs"]);
	f != null && g(r, ["logprobs"], f);
	let p = _(t, ["presencePenalty"]);
	p != null && g(r, ["presencePenalty"], p);
	let m = _(t, ["frequencyPenalty"]);
	m != null && g(r, ["frequencyPenalty"], m);
	let h = _(t, ["seed"]);
	h != null && g(r, ["seed"], h);
	let v = _(t, ["responseMimeType"]);
	v != null && g(r, ["responseMimeType"], v);
	let y = _(t, ["responseSchema"]);
	y != null && g(r, ["responseSchema"], tn(y));
	let b = _(t, ["responseJsonSchema"]);
	if (b != null && g(r, ["responseJsonSchema"], b), _(t, ["routingConfig"]) !== void 0) throw Error("routingConfig parameter is not supported in Gemini API.");
	if (_(t, ["modelSelectionConfig"]) !== void 0) throw Error("modelSelectionConfig parameter is not supported in Gemini API.");
	let x = _(t, ["safetySettings"]);
	if (n !== void 0 && x != null) {
		let e = x;
		Array.isArray(e) && (e = e.map((e) => gr(e))), g(n, ["safetySettings"], e);
	}
	let S = _(t, ["tools"]);
	if (n !== void 0 && S != null) {
		let e = an(S);
		Array.isArray(e) && (e = e.map((e) => vr(R(e)))), g(n, ["tools"], e);
	}
	let C = _(t, ["toolConfig"]);
	if (n !== void 0 && C != null && g(n, ["toolConfig"], _r(C)), _(t, ["labels"]) !== void 0) throw Error("labels parameter is not supported in Gemini API.");
	let w = _(t, ["cachedContent"]);
	n !== void 0 && w != null && g(n, ["cachedContent"], z(e, w));
	let T = _(t, ["responseModalities"]);
	T != null && g(r, ["responseModalities"], T);
	let E = _(t, ["mediaResolution"]);
	E != null && g(r, ["mediaResolution"], E);
	let D = _(t, ["speechConfig"]);
	if (D != null && g(r, ["speechConfig"], nn(D)), _(t, ["audioTimestamp"]) !== void 0) throw Error("audioTimestamp parameter is not supported in Gemini API.");
	let O = _(t, ["thinkingConfig"]);
	O != null && g(r, ["thinkingConfig"], O);
	let k = _(t, ["imageConfig"]);
	k != null && g(r, ["imageConfig"], or(k));
	let A = _(t, ["enableEnhancedCivicAnswers"]);
	if (A != null && g(r, ["enableEnhancedCivicAnswers"], A), _(t, ["modelArmorConfig"]) !== void 0) throw Error("modelArmorConfig parameter is not supported in Gemini API.");
	let j = _(t, ["serviceTier"]);
	return n !== void 0 && j != null && g(n, ["serviceTier"], j), r;
}
function tr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["candidates"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => Fn(e))), g(t, ["candidates"], e);
	}
	let i = _(e, ["modelVersion"]);
	i != null && g(t, ["modelVersion"], i);
	let a = _(e, ["promptFeedback"]);
	a != null && g(t, ["promptFeedback"], a);
	let o = _(e, ["responseId"]);
	o != null && g(t, ["responseId"], o);
	let s = _(e, ["usageMetadata"]);
	s != null && g(t, ["usageMetadata"], s);
	let c = _(e, ["modelStatus"]);
	return c != null && g(t, ["modelStatus"], c), t;
}
function nr(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], bn(e, r)), n;
}
function rr(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], bn(e, r)), n;
}
function ir(e) {
	let t = {}, n = _(e, ["authConfig"]);
	n != null && g(t, ["authConfig"], Cn(n));
	let r = _(e, ["enableWidget"]);
	return r != null && g(t, ["enableWidget"], r), t;
}
function ar(e) {
	let t = {}, n = _(e, ["searchTypes"]);
	if (n != null && g(t, ["searchTypes"], n), _(e, ["blockingConfidence"]) !== void 0) throw Error("blockingConfidence parameter is not supported in Gemini API.");
	if (_(e, ["excludeDomains"]) !== void 0) throw Error("excludeDomains parameter is not supported in Gemini API.");
	let r = _(e, ["timeRangeFilter"]);
	return r != null && g(t, ["timeRangeFilter"], r), t;
}
function or(e) {
	let t = {}, n = _(e, ["aspectRatio"]);
	n != null && g(t, ["aspectRatio"], n);
	let r = _(e, ["imageSize"]);
	if (r != null && g(t, ["imageSize"], r), _(e, ["personGeneration"]) !== void 0) throw Error("personGeneration parameter is not supported in Gemini API.");
	if (_(e, ["prominentPeople"]) !== void 0) throw Error("prominentPeople parameter is not supported in Gemini API.");
	if (_(e, ["outputMimeType"]) !== void 0) throw Error("outputMimeType parameter is not supported in Gemini API.");
	if (_(e, ["outputCompressionQuality"]) !== void 0) throw Error("outputCompressionQuality parameter is not supported in Gemini API.");
	if (_(e, ["imageOutputOptions"]) !== void 0) throw Error("imageOutputOptions parameter is not supported in Gemini API.");
	return t;
}
function sr(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["request", "model"], F(e, r));
	let i = _(t, ["contents"]);
	if (i != null) {
		let e = L(i);
		Array.isArray(e) && (e = e.map((e) => Ln(e))), g(n, ["request", "contents"], e);
	}
	let a = _(t, ["metadata"]);
	a != null && g(n, ["metadata"], a);
	let o = _(t, ["config"]);
	return o != null && g(n, ["request", "generationConfig"], er(e, o, _(n, ["request"], {}))), n;
}
function cr(e) {
	let t = {}, n = _(e, ["response"]);
	n != null && g(t, ["response"], tr(n));
	let r = _(e, ["metadata"]);
	r != null && g(t, ["metadata"], r);
	let i = _(e, ["error"]);
	return i != null && g(t, ["error"], i), t;
}
function lr(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	if (t !== void 0 && i != null && g(t, ["_query", "pageToken"], i), _(e, ["filter"]) !== void 0) throw Error("filter parameter is not supported in Gemini API.");
	return n;
}
function ur(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	t !== void 0 && i != null && g(t, ["_query", "pageToken"], i);
	let a = _(e, ["filter"]);
	return t !== void 0 && a != null && g(t, ["_query", "filter"], a), n;
}
function dr(e) {
	let t = {}, n = _(e, ["config"]);
	return n != null && lr(n, t), t;
}
function fr(e) {
	let t = {}, n = _(e, ["config"]);
	return n != null && ur(n, t), t;
}
function pr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["operations"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => Dn(e))), g(t, ["batchJobs"], e);
	}
	return t;
}
function mr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["batchPredictionJobs"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => On(e))), g(t, ["batchJobs"], e);
	}
	return t;
}
function hr(e) {
	let t = {}, n = _(e, ["mediaResolution"]);
	n != null && g(t, ["mediaResolution"], n);
	let r = _(e, ["codeExecutionResult"]);
	r != null && g(t, ["codeExecutionResult"], r);
	let i = _(e, ["executableCode"]);
	i != null && g(t, ["executableCode"], i);
	let a = _(e, ["fileData"]);
	a != null && g(t, ["fileData"], Zn(a));
	let o = _(e, ["functionCall"]);
	o != null && g(t, ["functionCall"], Qn(o));
	let s = _(e, ["functionResponse"]);
	s != null && g(t, ["functionResponse"], s);
	let c = _(e, ["inlineData"]);
	c != null && g(t, ["inlineData"], Mn(c));
	let l = _(e, ["text"]);
	l != null && g(t, ["text"], l);
	let u = _(e, ["thought"]);
	u != null && g(t, ["thought"], u);
	let d = _(e, ["thoughtSignature"]);
	d != null && g(t, ["thoughtSignature"], d);
	let f = _(e, ["videoMetadata"]);
	f != null && g(t, ["videoMetadata"], f);
	let p = _(e, ["toolCall"]);
	p != null && g(t, ["toolCall"], p);
	let m = _(e, ["toolResponse"]);
	m != null && g(t, ["toolResponse"], m);
	let h = _(e, ["partMetadata"]);
	return h != null && g(t, ["partMetadata"], h), t;
}
function gr(e) {
	let t = {}, n = _(e, ["category"]);
	if (n != null && g(t, ["category"], n), _(e, ["method"]) !== void 0) throw Error("method parameter is not supported in Gemini API.");
	let r = _(e, ["threshold"]);
	return r != null && g(t, ["threshold"], r), t;
}
function _r(e) {
	let t = {}, n = _(e, ["retrievalConfig"]);
	n != null && g(t, ["retrievalConfig"], n);
	let r = _(e, ["functionCallingConfig"]);
	r != null && g(t, ["functionCallingConfig"], $n(r));
	let i = _(e, ["includeServerSideToolInvocations"]);
	return i != null && g(t, ["includeServerSideToolInvocations"], i), t;
}
function vr(e) {
	let t = {};
	if (_(e, ["retrieval"]) !== void 0) throw Error("retrieval parameter is not supported in Gemini API.");
	let n = _(e, ["computerUse"]);
	n != null && g(t, ["computerUse"], n);
	let r = _(e, ["fileSearch"]);
	r != null && g(t, ["fileSearch"], r);
	let i = _(e, ["googleSearch"]);
	i != null && g(t, ["googleSearch"], ar(i));
	let a = _(e, ["googleMaps"]);
	a != null && g(t, ["googleMaps"], ir(a));
	let o = _(e, ["codeExecution"]);
	if (o != null && g(t, ["codeExecution"], o), _(e, ["enterpriseWebSearch"]) !== void 0) throw Error("enterpriseWebSearch parameter is not supported in Gemini API.");
	let s = _(e, ["functionDeclarations"]);
	if (s != null) {
		let e = s;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["functionDeclarations"], e);
	}
	let c = _(e, ["googleSearchRetrieval"]);
	if (c != null && g(t, ["googleSearchRetrieval"], c), _(e, ["parallelAiSearch"]) !== void 0) throw Error("parallelAiSearch parameter is not supported in Gemini API.");
	let l = _(e, ["urlContext"]);
	l != null && g(t, ["urlContext"], l);
	let u = _(e, ["mcpServers"]);
	if (u != null) {
		let e = u;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["mcpServers"], e);
	}
	return t;
}
function yr(e) {
	let t = {}, n = _(e, ["bigqueryDestination", "outputUri"]);
	n != null && g(t, ["bigqueryDestination"], n);
	let r = _(e, ["displayName"]);
	return r != null && g(t, ["displayName"], r), t;
}
function br(e) {
	let t = {}, n = _(e, ["bigqueryDestination"]);
	n != null && g(t, ["bigqueryDestination", "outputUri"], n);
	let r = _(e, ["displayName"]);
	return r != null && g(t, ["displayName"], r), t;
}
var V;
(function(e) {
	e.PAGED_ITEM_BATCH_JOBS = "batchJobs", e.PAGED_ITEM_MODELS = "models", e.PAGED_ITEM_TUNING_JOBS = "tuningJobs", e.PAGED_ITEM_FILES = "files", e.PAGED_ITEM_CACHED_CONTENTS = "cachedContents", e.PAGED_ITEM_FILE_SEARCH_STORES = "fileSearchStores", e.PAGED_ITEM_DOCUMENTS = "documents";
})(V ||= {});
var H = class {
	constructor(e, t, n, r) {
		this.pageInternal = [], this.paramsInternal = {}, this.requestInternal = t, this.init(e, n, r);
	}
	init(e, t, n) {
		this.nameInternal = e, this.pageInternal = t[this.nameInternal] || [], this.sdkHttpResponseInternal = t?.sdkHttpResponse, this.idxInternal = 0;
		let r = { config: {} };
		r = !n || Object.keys(n).length === 0 ? { config: {} } : typeof n == "object" ? Object.assign({}, n) : n, r.config && (r.config.pageToken = t.nextPageToken), this.paramsInternal = r, this.pageInternalSize = r.config?.pageSize ?? this.pageInternal.length;
	}
	initNextPage(e) {
		this.init(this.nameInternal, e, this.paramsInternal);
	}
	get page() {
		return this.pageInternal;
	}
	get name() {
		return this.nameInternal;
	}
	get pageSize() {
		return this.pageInternalSize;
	}
	get sdkHttpResponse() {
		return this.sdkHttpResponseInternal;
	}
	get params() {
		return this.paramsInternal;
	}
	get pageLength() {
		return this.pageInternal.length;
	}
	getItem(e) {
		return this.pageInternal[e];
	}
	[Symbol.asyncIterator]() {
		return {
			next: async () => {
				if (this.idxInternal >= this.pageLength) {
					if (this.hasNextPage()) await this.nextPage();
					else return {
						value: void 0,
						done: !0
					};
				}
				let e = this.getItem(this.idxInternal);
				return this.idxInternal += 1, {
					value: e,
					done: !1
				};
			},
			return: async () => ({
				value: void 0,
				done: !0
			})
		};
	}
	async nextPage() {
		if (!this.hasNextPage()) throw Error("No more pages to fetch.");
		let e = await this.requestInternal(this.params);
		return this.initNextPage(e), this.page;
	}
	hasNextPage() {
		return this.params.config?.pageToken !== void 0;
	}
}, xr = class extends m {
	constructor(e) {
		super(), this.apiClient = e, this.list = async (e = {}) => new H(V.PAGED_ITEM_BATCH_JOBS, (e) => this.listInternal(e), await this.listInternal(e), e), this.create = async (e) => (this.apiClient.isVertexAI() && (e.config = this.formatDestination(e.src, e.config)), this.createInternal(e)), this.createEmbeddings = async (e) => {
			if (console.warn("batches.createEmbeddings() is experimental and may change without notice."), this.apiClient.isVertexAI()) throw Error("Gemini Enterprise Agent Platform (previously known as Vertex AI) does not support batches.createEmbeddings.");
			return this.createEmbeddingsInternal(e);
		};
	}
	createInlinedGenerateContentRequest(e) {
		let t = Bn(this.apiClient, e), n = t._url, r = h("{model}:batchGenerateContent", n), i = t.batch.inputConfig.requests, a = i.requests, o = [];
		for (let e of a) {
			let t = Object.assign({}, e);
			if (t.systemInstruction) {
				let e = t.systemInstruction;
				delete t.systemInstruction;
				let n = t.request;
				n.systemInstruction = e, t.request = n;
			}
			o.push(t);
		}
		return i.requests = o, delete t.config, delete t._url, delete t._query, {
			path: r,
			body: t
		};
	}
	getGcsUri(e) {
		if (typeof e == "string") return e.startsWith("gs://") ? e : void 0;
		if (!Array.isArray(e) && e.gcsUri && e.gcsUri.length > 0) return e.gcsUri[0];
	}
	getBigqueryUri(e) {
		if (typeof e == "string") return e.startsWith("bq://") ? e : void 0;
		if (!Array.isArray(e)) return e.bigqueryUri;
	}
	formatDestination(e, t) {
		let n = t ? Object.assign({}, t) : {}, r = Date.now().toString();
		if (n.displayName ||= `genaiBatchJob_${r}`, n.dest === void 0) {
			let t = this.getGcsUri(e), i = this.getBigqueryUri(e);
			if (t) n.dest = t.endsWith(".jsonl") ? `${t.slice(0, -6)}/dest` : `${t}_dest_${r}`;
			else if (i) n.dest = `${i}_dest_${r}`;
			else throw Error("Unsupported source for Gemini Enterprise Agent Platform (previously known as Vertex AI): No GCS or BigQuery URI found.");
		}
		return n;
	}
	async createInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Vn(this.apiClient, e);
			return n = h("batchPredictionJobs", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => On(e));
		}
		{
			let i = Bn(this.apiClient, e);
			return n = h("{model}:batchGenerateContent", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => Dn(e));
		}
	}
	async createEmbeddingsInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = Un(this.apiClient, e);
			return n = h("{model}:asyncBatchEmbedContent", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => Dn(e));
		}
	}
	async get(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = rr(this.apiClient, e);
			return n = h("batchPredictionJobs/{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => On(e));
		}
		{
			let i = nr(this.apiClient, e);
			return n = h("batches/{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => Dn(e));
		}
	}
	async cancel(e) {
		let t = "", n = {};
		if (this.apiClient.isVertexAI()) {
			let r = Pn(this.apiClient, e);
			t = h("batchPredictionJobs/{name}:cancel", r._url), n = r._query, delete r._url, delete r._query, await this.apiClient.request({
				path: t,
				queryParams: n,
				body: JSON.stringify(r),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			});
		} else {
			let r = Nn(this.apiClient, e);
			t = h("batches/{name}:cancel", r._url), n = r._query, delete r._url, delete r._query, await this.apiClient.request({
				path: t,
				queryParams: n,
				body: JSON.stringify(r),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			});
		}
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = fr(e);
			return n = h("batchPredictionJobs", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = mr(e), n = new Rt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = dr(e);
			return n = h("batches", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = pr(e), n = new Rt();
				return Object.assign(n, t), n;
			});
		}
	}
	async delete(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Gn(this.apiClient, e);
			return n = h("batchPredictionJobs/{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => qn(e));
		}
		{
			let i = Wn(this.apiClient, e);
			return n = h("batches/{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => Kn(e));
		}
	}
};
function Sr(e) {
	let t = {}, n = _(e, ["apiKey"]);
	if (n != null && g(t, ["apiKey"], n), _(e, ["apiKeyConfig"]) !== void 0) throw Error("apiKeyConfig parameter is not supported in Gemini API.");
	if (_(e, ["authType"]) !== void 0) throw Error("authType parameter is not supported in Gemini API.");
	if (_(e, ["googleServiceAccountConfig"]) !== void 0) throw Error("googleServiceAccountConfig parameter is not supported in Gemini API.");
	if (_(e, ["httpBasicAuthConfig"]) !== void 0) throw Error("httpBasicAuthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oauthConfig"]) !== void 0) throw Error("oauthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oidcConfig"]) !== void 0) throw Error("oidcConfig parameter is not supported in Gemini API.");
	return t;
}
function Cr(e) {
	let t = {}, n = _(e, ["data"]);
	if (n != null && g(t, ["data"], n), _(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function wr(e) {
	let t = {}, n = _(e, ["parts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => Jr(e))), g(t, ["parts"], e);
	}
	let r = _(e, ["role"]);
	return r != null && g(t, ["role"], r), t;
}
function Tr(e) {
	let t = {}, n = _(e, ["parts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => Yr(e))), g(t, ["parts"], e);
	}
	let r = _(e, ["role"]);
	return r != null && g(t, ["role"], r), t;
}
function Er(e, t) {
	let n = {}, r = _(e, ["ttl"]);
	t !== void 0 && r != null && g(t, ["ttl"], r);
	let i = _(e, ["expireTime"]);
	t !== void 0 && i != null && g(t, ["expireTime"], i);
	let a = _(e, ["displayName"]);
	t !== void 0 && a != null && g(t, ["displayName"], a);
	let o = _(e, ["contents"]);
	if (t !== void 0 && o != null) {
		let e = L(o);
		Array.isArray(e) && (e = e.map((e) => wr(e))), g(t, ["contents"], e);
	}
	let s = _(e, ["systemInstruction"]);
	t !== void 0 && s != null && g(t, ["systemInstruction"], wr(I(s)));
	let c = _(e, ["tools"]);
	if (t !== void 0 && c != null) {
		let e = c;
		Array.isArray(e) && (e = e.map((e) => Qr(e))), g(t, ["tools"], e);
	}
	let l = _(e, ["toolConfig"]);
	if (t !== void 0 && l != null && g(t, ["toolConfig"], Xr(l)), _(e, ["kmsKeyName"]) !== void 0) throw Error("kmsKeyName parameter is not supported in Gemini API.");
	return n;
}
function Dr(e, t) {
	let n = {}, r = _(e, ["ttl"]);
	t !== void 0 && r != null && g(t, ["ttl"], r);
	let i = _(e, ["expireTime"]);
	t !== void 0 && i != null && g(t, ["expireTime"], i);
	let a = _(e, ["displayName"]);
	t !== void 0 && a != null && g(t, ["displayName"], a);
	let o = _(e, ["contents"]);
	if (t !== void 0 && o != null) {
		let e = L(o);
		Array.isArray(e) && (e = e.map((e) => Tr(e))), g(t, ["contents"], e);
	}
	let s = _(e, ["systemInstruction"]);
	t !== void 0 && s != null && g(t, ["systemInstruction"], Tr(I(s)));
	let c = _(e, ["tools"]);
	if (t !== void 0 && c != null) {
		let e = c;
		Array.isArray(e) && (e = e.map((e) => $r(e))), g(t, ["tools"], e);
	}
	let l = _(e, ["toolConfig"]);
	t !== void 0 && l != null && g(t, ["toolConfig"], Zr(l));
	let u = _(e, ["kmsKeyName"]);
	return t !== void 0 && u != null && g(t, ["encryption_spec", "kmsKeyName"], u), n;
}
function Or(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["model"], Ht(e, r));
	let i = _(t, ["config"]);
	return i != null && Er(i, n), n;
}
function kr(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["model"], Ht(e, r));
	let i = _(t, ["config"]);
	return i != null && Dr(i, n), n;
}
function Ar(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], z(e, r)), n;
}
function jr(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], z(e, r)), n;
}
function Mr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	return n != null && g(t, ["sdkHttpResponse"], n), t;
}
function Nr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	return n != null && g(t, ["sdkHttpResponse"], n), t;
}
function Pr(e) {
	let t = {};
	if (_(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let n = _(e, ["fileUri"]);
	n != null && g(t, ["fileUri"], n);
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function Fr(e) {
	let t = {}, n = _(e, ["id"]);
	n != null && g(t, ["id"], n);
	let r = _(e, ["args"]);
	r != null && g(t, ["args"], r);
	let i = _(e, ["name"]);
	if (i != null && g(t, ["name"], i), _(e, ["partialArgs"]) !== void 0) throw Error("partialArgs parameter is not supported in Gemini API.");
	if (_(e, ["willContinue"]) !== void 0) throw Error("willContinue parameter is not supported in Gemini API.");
	return t;
}
function Ir(e) {
	let t = {}, n = _(e, ["allowedFunctionNames"]);
	n != null && g(t, ["allowedFunctionNames"], n);
	let r = _(e, ["mode"]);
	if (r != null && g(t, ["mode"], r), _(e, ["streamFunctionCallArguments"]) !== void 0) throw Error("streamFunctionCallArguments parameter is not supported in Gemini API.");
	return t;
}
function Lr(e) {
	let t = {}, n = _(e, ["description"]);
	n != null && g(t, ["description"], n);
	let r = _(e, ["name"]);
	r != null && g(t, ["name"], r);
	let i = _(e, ["parameters"]);
	i != null && g(t, ["parameters"], i);
	let a = _(e, ["parametersJsonSchema"]);
	a != null && g(t, ["parametersJsonSchema"], a);
	let o = _(e, ["response"]);
	o != null && g(t, ["response"], o);
	let s = _(e, ["responseJsonSchema"]);
	if (s != null && g(t, ["responseJsonSchema"], s), _(e, ["behavior"]) !== void 0) throw Error("behavior parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Rr(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], z(e, r)), n;
}
function zr(e, t) {
	let n = {}, r = _(t, ["name"]);
	return r != null && g(n, ["_url", "name"], z(e, r)), n;
}
function Br(e) {
	let t = {}, n = _(e, ["authConfig"]);
	n != null && g(t, ["authConfig"], Sr(n));
	let r = _(e, ["enableWidget"]);
	return r != null && g(t, ["enableWidget"], r), t;
}
function Vr(e) {
	let t = {}, n = _(e, ["searchTypes"]);
	if (n != null && g(t, ["searchTypes"], n), _(e, ["blockingConfidence"]) !== void 0) throw Error("blockingConfidence parameter is not supported in Gemini API.");
	if (_(e, ["excludeDomains"]) !== void 0) throw Error("excludeDomains parameter is not supported in Gemini API.");
	let r = _(e, ["timeRangeFilter"]);
	return r != null && g(t, ["timeRangeFilter"], r), t;
}
function Hr(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	return t !== void 0 && i != null && g(t, ["_query", "pageToken"], i), n;
}
function Ur(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	return t !== void 0 && i != null && g(t, ["_query", "pageToken"], i), n;
}
function Wr(e) {
	let t = {}, n = _(e, ["config"]);
	return n != null && Hr(n, t), t;
}
function Gr(e) {
	let t = {}, n = _(e, ["config"]);
	return n != null && Ur(n, t), t;
}
function Kr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["cachedContents"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["cachedContents"], e);
	}
	return t;
}
function qr(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["cachedContents"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["cachedContents"], e);
	}
	return t;
}
function Jr(e) {
	let t = {}, n = _(e, ["mediaResolution"]);
	n != null && g(t, ["mediaResolution"], n);
	let r = _(e, ["codeExecutionResult"]);
	r != null && g(t, ["codeExecutionResult"], r);
	let i = _(e, ["executableCode"]);
	i != null && g(t, ["executableCode"], i);
	let a = _(e, ["fileData"]);
	a != null && g(t, ["fileData"], Pr(a));
	let o = _(e, ["functionCall"]);
	o != null && g(t, ["functionCall"], Fr(o));
	let s = _(e, ["functionResponse"]);
	s != null && g(t, ["functionResponse"], s);
	let c = _(e, ["inlineData"]);
	c != null && g(t, ["inlineData"], Cr(c));
	let l = _(e, ["text"]);
	l != null && g(t, ["text"], l);
	let u = _(e, ["thought"]);
	u != null && g(t, ["thought"], u);
	let d = _(e, ["thoughtSignature"]);
	d != null && g(t, ["thoughtSignature"], d);
	let f = _(e, ["videoMetadata"]);
	f != null && g(t, ["videoMetadata"], f);
	let p = _(e, ["toolCall"]);
	p != null && g(t, ["toolCall"], p);
	let m = _(e, ["toolResponse"]);
	m != null && g(t, ["toolResponse"], m);
	let h = _(e, ["partMetadata"]);
	return h != null && g(t, ["partMetadata"], h), t;
}
function Yr(e) {
	let t = {}, n = _(e, ["mediaResolution"]);
	n != null && g(t, ["mediaResolution"], n);
	let r = _(e, ["codeExecutionResult"]);
	r != null && g(t, ["codeExecutionResult"], r);
	let i = _(e, ["executableCode"]);
	i != null && g(t, ["executableCode"], i);
	let a = _(e, ["fileData"]);
	a != null && g(t, ["fileData"], a);
	let o = _(e, ["functionCall"]);
	o != null && g(t, ["functionCall"], o);
	let s = _(e, ["functionResponse"]);
	s != null && g(t, ["functionResponse"], s);
	let c = _(e, ["inlineData"]);
	c != null && g(t, ["inlineData"], c);
	let l = _(e, ["text"]);
	l != null && g(t, ["text"], l);
	let u = _(e, ["thought"]);
	u != null && g(t, ["thought"], u);
	let d = _(e, ["thoughtSignature"]);
	d != null && g(t, ["thoughtSignature"], d);
	let f = _(e, ["videoMetadata"]);
	if (f != null && g(t, ["videoMetadata"], f), _(e, ["toolCall"]) !== void 0) throw Error("toolCall parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["toolResponse"]) !== void 0) throw Error("toolResponse parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["partMetadata"]) !== void 0) throw Error("partMetadata parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Xr(e) {
	let t = {}, n = _(e, ["retrievalConfig"]);
	n != null && g(t, ["retrievalConfig"], n);
	let r = _(e, ["functionCallingConfig"]);
	r != null && g(t, ["functionCallingConfig"], Ir(r));
	let i = _(e, ["includeServerSideToolInvocations"]);
	return i != null && g(t, ["includeServerSideToolInvocations"], i), t;
}
function Zr(e) {
	let t = {}, n = _(e, ["retrievalConfig"]);
	n != null && g(t, ["retrievalConfig"], n);
	let r = _(e, ["functionCallingConfig"]);
	if (r != null && g(t, ["functionCallingConfig"], r), _(e, ["includeServerSideToolInvocations"]) !== void 0) throw Error("includeServerSideToolInvocations parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Qr(e) {
	let t = {};
	if (_(e, ["retrieval"]) !== void 0) throw Error("retrieval parameter is not supported in Gemini API.");
	let n = _(e, ["computerUse"]);
	n != null && g(t, ["computerUse"], n);
	let r = _(e, ["fileSearch"]);
	r != null && g(t, ["fileSearch"], r);
	let i = _(e, ["googleSearch"]);
	i != null && g(t, ["googleSearch"], Vr(i));
	let a = _(e, ["googleMaps"]);
	a != null && g(t, ["googleMaps"], Br(a));
	let o = _(e, ["codeExecution"]);
	if (o != null && g(t, ["codeExecution"], o), _(e, ["enterpriseWebSearch"]) !== void 0) throw Error("enterpriseWebSearch parameter is not supported in Gemini API.");
	let s = _(e, ["functionDeclarations"]);
	if (s != null) {
		let e = s;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["functionDeclarations"], e);
	}
	let c = _(e, ["googleSearchRetrieval"]);
	if (c != null && g(t, ["googleSearchRetrieval"], c), _(e, ["parallelAiSearch"]) !== void 0) throw Error("parallelAiSearch parameter is not supported in Gemini API.");
	let l = _(e, ["urlContext"]);
	l != null && g(t, ["urlContext"], l);
	let u = _(e, ["mcpServers"]);
	if (u != null) {
		let e = u;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["mcpServers"], e);
	}
	return t;
}
function $r(e) {
	let t = {}, n = _(e, ["retrieval"]);
	n != null && g(t, ["retrieval"], n);
	let r = _(e, ["computerUse"]);
	if (r != null && g(t, ["computerUse"], r), _(e, ["fileSearch"]) !== void 0) throw Error("fileSearch parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let i = _(e, ["googleSearch"]);
	i != null && g(t, ["googleSearch"], i);
	let a = _(e, ["googleMaps"]);
	a != null && g(t, ["googleMaps"], a);
	let o = _(e, ["codeExecution"]);
	o != null && g(t, ["codeExecution"], o);
	let s = _(e, ["enterpriseWebSearch"]);
	s != null && g(t, ["enterpriseWebSearch"], s);
	let c = _(e, ["functionDeclarations"]);
	if (c != null) {
		let e = c;
		Array.isArray(e) && (e = e.map((e) => Lr(e))), g(t, ["functionDeclarations"], e);
	}
	let l = _(e, ["googleSearchRetrieval"]);
	l != null && g(t, ["googleSearchRetrieval"], l);
	let u = _(e, ["parallelAiSearch"]);
	u != null && g(t, ["parallelAiSearch"], u);
	let d = _(e, ["urlContext"]);
	if (d != null && g(t, ["urlContext"], d), _(e, ["mcpServers"]) !== void 0) throw Error("mcpServers parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function ei(e, t) {
	let n = {}, r = _(e, ["ttl"]);
	t !== void 0 && r != null && g(t, ["ttl"], r);
	let i = _(e, ["expireTime"]);
	return t !== void 0 && i != null && g(t, ["expireTime"], i), n;
}
function ti(e, t) {
	let n = {}, r = _(e, ["ttl"]);
	t !== void 0 && r != null && g(t, ["ttl"], r);
	let i = _(e, ["expireTime"]);
	return t !== void 0 && i != null && g(t, ["expireTime"], i), n;
}
function ni(e, t) {
	let n = {}, r = _(t, ["name"]);
	r != null && g(n, ["_url", "name"], z(e, r));
	let i = _(t, ["config"]);
	return i != null && ei(i, n), n;
}
function ri(e, t) {
	let n = {}, r = _(t, ["name"]);
	r != null && g(n, ["_url", "name"], z(e, r));
	let i = _(t, ["config"]);
	return i != null && ti(i, n), n;
}
var ii = class extends m {
	constructor(e) {
		super(), this.apiClient = e, this.list = async (e = {}) => new H(V.PAGED_ITEM_CACHED_CONTENTS, (e) => this.listInternal(e), await this.listInternal(e), e);
	}
	async create(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = kr(this.apiClient, e);
			return n = h("cachedContents", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
		{
			let i = Or(this.apiClient, e);
			return n = h("cachedContents", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async get(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = zr(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
		{
			let i = Rr(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async delete(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = jr(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Nr(e), n = new Ot();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = Ar(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Mr(e), n = new Ot();
				return Object.assign(n, t), n;
			});
		}
	}
	async update(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = ri(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "PATCH",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
		{
			let i = ni(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "PATCH",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Gr(e);
			return n = h("cachedContents", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = qr(e), n = new kt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = Wr(e);
			return n = h("cachedContents", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Kr(e), n = new kt();
				return Object.assign(n, t), n;
			});
		}
	}
};
function U(e, t) {
	var n = {};
	for (var r in e) Object.prototype.hasOwnProperty.call(e, r) && t.indexOf(r) < 0 && (n[r] = e[r]);
	if (e != null && typeof Object.getOwnPropertySymbols == "function") for (var i = 0, r = Object.getOwnPropertySymbols(e); i < r.length; i++) t.indexOf(r[i]) < 0 && Object.prototype.propertyIsEnumerable.call(e, r[i]) && (n[r[i]] = e[r[i]]);
	return n;
}
function ai(e) {
	var t = typeof Symbol == "function" && Symbol.iterator, n = t && e[t], r = 0;
	if (n) return n.call(e);
	if (e && typeof e.length == "number") return { next: function() {
		return e && r >= e.length && (e = void 0), {
			value: e && e[r++],
			done: !e
		};
	} };
	throw TypeError(t ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function W(e) {
	return this instanceof W ? (this.v = e, this) : new W(e);
}
function G(e, t, n) {
	if (!Symbol.asyncIterator) throw TypeError("Symbol.asyncIterator is not defined.");
	var r = n.apply(e, t || []), i, a = [];
	return i = Object.create((typeof AsyncIterator == "function" ? AsyncIterator : Object).prototype), s("next"), s("throw"), s("return", o), i[Symbol.asyncIterator] = function() {
		return this;
	}, i;
	function o(e) {
		return function(t) {
			return Promise.resolve(t).then(e, d);
		};
	}
	function s(e, t) {
		r[e] && (i[e] = function(t) {
			return new Promise(function(n, r) {
				a.push([
					e,
					t,
					n,
					r
				]) > 1 || c(e, t);
			});
		}, t && (i[e] = t(i[e])));
	}
	function c(e, t) {
		try {
			l(r[e](t));
		} catch (e) {
			f(a[0][3], e);
		}
	}
	function l(e) {
		e.value instanceof W ? Promise.resolve(e.value.v).then(u, d) : f(a[0][2], e);
	}
	function u(e) {
		c("next", e);
	}
	function d(e) {
		c("throw", e);
	}
	function f(e, t) {
		e(t), a.shift(), a.length && c(a[0][0], a[0][1]);
	}
}
function K(e) {
	if (!Symbol.asyncIterator) throw TypeError("Symbol.asyncIterator is not defined.");
	var t = e[Symbol.asyncIterator], n;
	return t ? t.call(e) : (e = typeof ai == "function" ? ai(e) : e[Symbol.iterator](), n = {}, r("next"), r("throw"), r("return"), n[Symbol.asyncIterator] = function() {
		return this;
	}, n);
	function r(t) {
		n[t] = e[t] && function(n) {
			return new Promise(function(r, a) {
				n = e[t](n), i(r, a, n.done, n.value);
			});
		};
	}
	function i(e, t, n, r) {
		Promise.resolve(r).then(function(t) {
			e({
				value: t,
				done: n
			});
		}, t);
	}
}
function oi(e) {
	if (e.candidates == null || e.candidates.length === 0) return !1;
	let t = e.candidates[0]?.content;
	return t !== void 0 && si(t);
}
function si(e) {
	if (e.parts === void 0 || e.parts.length === 0) return !1;
	for (let t of e.parts) if (t === void 0 || Object.keys(t).length === 0) return !1;
	return !0;
}
function ci(e) {
	if (e.length !== 0) {
		for (let t of e) if (t.role !== "user" && t.role !== "model") throw Error(`Role must be user or model, but got ${t.role}.`);
	}
}
function li(e) {
	if (e === void 0 || e.length === 0) return [];
	let t = [], n = e.length, r = 0;
	for (; r < n;) if (e[r].role === "user") t.push(e[r]), r++;
	else {
		let i = [], a = !0;
		for (; r < n && e[r].role === "model";) i.push(e[r]), a && !si(e[r]) && (a = !1), r++;
		a ? t.push(...i) : t.pop();
	}
	return t;
}
var ui = class {
	constructor(e, t) {
		this.modelsModule = e, this.apiClient = t;
	}
	create(e) {
		return new di(this.apiClient, this.modelsModule, e.model, e.config, structuredClone(e.history));
	}
}, di = class {
	constructor(e, t, n, r = {}, i = []) {
		this.apiClient = e, this.modelsModule = t, this.model = n, this.config = r, this.history = i, this.sendPromise = Promise.resolve(), ci(i);
	}
	async sendMessage(e) {
		await this.sendPromise;
		let t = I(e.message), n = this.modelsModule.generateContent({
			model: this.model,
			contents: this.getHistory(!0).concat(t),
			config: e.config ?? this.config
		});
		return this.sendPromise = (async () => {
			let e = await n, r = e.candidates?.[0]?.content, i = e.automaticFunctionCallingHistory, a = this.getHistory(!0).length, o = [];
			i != null && (o = i.slice(a) ?? []);
			let s = r ? [r] : [];
			this.recordHistory(t, s, o);
		})(), await this.sendPromise.catch(() => {
			this.sendPromise = Promise.resolve();
		}), n;
	}
	async sendMessageStream(e) {
		await this.sendPromise;
		let t = I(e.message), n = this.modelsModule.generateContentStream({
			model: this.model,
			contents: this.getHistory(!0).concat(t),
			config: e.config ?? this.config
		});
		this.sendPromise = n.then(() => void 0).catch(() => void 0);
		let r = await n;
		return this.processStreamResponse(r, t);
	}
	getHistory(e = !1) {
		let t = e ? li(this.history) : this.history;
		return structuredClone(t);
	}
	processStreamResponse(e, t) {
		return G(this, arguments, function* () {
			var n, r, i, a;
			let o = [];
			try {
				for (var s = !0, c = K(e), l; l = yield W(c.next()), n = l.done, !n; s = !0) {
					a = l.value, s = !1;
					let e = a;
					if (oi(e)) {
						let t = e.candidates?.[0]?.content;
						t !== void 0 && o.push(t);
					}
					yield yield W(e);
				}
			} catch (e) {
				r = { error: e };
			} finally {
				try {
					!s && !n && (i = c.return) && (yield W(i.call(c)));
				} finally {
					if (r) throw r.error;
				}
			}
			this.recordHistory(t, o);
		});
	}
	recordHistory(e, t, n) {
		let r = [];
		t.length > 0 && t.every((e) => e.role !== void 0) ? r = t : r.push({
			role: "model",
			parts: []
		}), n && n.length > 0 ? this.history.push(...li(n)) : this.history.push(e), this.history.push(...r);
	}
}, fi = class e extends Error {
	constructor(t) {
		super(t.message), this.name = "ApiError", this.status = t.status, Object.setPrototypeOf(this, e.prototype);
	}
};
function pi(e) {
	let t = {}, n = _(e, ["file"]);
	return n != null && g(t, ["file"], n), t;
}
function mi(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	return n != null && g(t, ["sdkHttpResponse"], n), t;
}
function hi(e) {
	let t = {}, n = _(e, ["name"]);
	return n != null && g(t, ["_url", "file"], dn(n)), t;
}
function gi(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	return n != null && g(t, ["sdkHttpResponse"], n), t;
}
function _i(e) {
	let t = {}, n = _(e, ["name"]);
	return n != null && g(t, ["_url", "file"], dn(n)), t;
}
function vi(e) {
	let t = {}, n = _(e, ["uris"]);
	return n != null && g(t, ["uris"], n), t;
}
function yi(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	return t !== void 0 && i != null && g(t, ["_query", "pageToken"], i), n;
}
function bi(e) {
	let t = {}, n = _(e, ["config"]);
	return n != null && yi(n, t), t;
}
function xi(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["files"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["files"], e);
	}
	return t;
}
function Si(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["files"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["files"], e);
	}
	return t;
}
var Ci = class extends m {
	constructor(e) {
		super(), this.apiClient = e, this.list = async (e = {}) => new H(V.PAGED_ITEM_FILES, (e) => this.listInternal(e), await this.listInternal(e), e);
	}
	async upload(e) {
		if (this.apiClient.isVertexAI()) throw Error("Gemini Enterprise Agent Platform (previously known as Vertex AI) does not support uploading files. You can share files through a GCS bucket.");
		return this.apiClient.uploadFile(e.file, e.config).then((e) => e);
	}
	async download(e) {
		await this.apiClient.downloadFile(e);
	}
	async registerFiles(e) {
		throw Error("registerFiles is only supported in Node.js environments.");
	}
	async _registerFiles(e) {
		return this.registerFilesInternal(e);
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = bi(e);
			return n = h("files", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = xi(e), n = new Pt();
				return Object.assign(n, t), n;
			});
		}
	}
	async createInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = pi(e);
			return n = h("upload/v1beta/files", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = mi(e), n = new Ft();
				return Object.assign(n, t), n;
			});
		}
	}
	async get(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = _i(e);
			return n = h("files/{file}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async delete(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = hi(e);
			return n = h("files/{file}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = gi(e), n = new It();
				return Object.assign(n, t), n;
			});
		}
	}
	async registerFilesInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = vi(e);
			return n = h("files:register", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = Si(e), n = new Lt();
				return Object.assign(n, t), n;
			});
		}
	}
};
function wi(e) {
	let t = {};
	if (_(e, ["languageCodes"]) !== void 0) throw Error("languageCodes parameter is not supported in Gemini API.");
	return t;
}
function Ti(e) {
	let t = {}, n = _(e, ["apiKey"]);
	if (n != null && g(t, ["apiKey"], n), _(e, ["apiKeyConfig"]) !== void 0) throw Error("apiKeyConfig parameter is not supported in Gemini API.");
	if (_(e, ["authType"]) !== void 0) throw Error("authType parameter is not supported in Gemini API.");
	if (_(e, ["googleServiceAccountConfig"]) !== void 0) throw Error("googleServiceAccountConfig parameter is not supported in Gemini API.");
	if (_(e, ["httpBasicAuthConfig"]) !== void 0) throw Error("httpBasicAuthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oauthConfig"]) !== void 0) throw Error("oauthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oidcConfig"]) !== void 0) throw Error("oidcConfig parameter is not supported in Gemini API.");
	return t;
}
function Ei(e) {
	let t = {}, n = _(e, ["data"]);
	if (n != null && g(t, ["data"], n), _(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function Di(e) {
	let t = {}, n = _(e, ["parts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => Wi(e))), g(t, ["parts"], e);
	}
	let r = _(e, ["role"]);
	return r != null && g(t, ["role"], r), t;
}
function Oi(e) {
	let t = {}, n = _(e, ["parts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => Gi(e))), g(t, ["parts"], e);
	}
	let r = _(e, ["role"]);
	return r != null && g(t, ["role"], r), t;
}
function ki(e) {
	let t = {};
	if (_(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let n = _(e, ["fileUri"]);
	n != null && g(t, ["fileUri"], n);
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function Ai(e) {
	let t = {}, n = _(e, ["id"]);
	n != null && g(t, ["id"], n);
	let r = _(e, ["args"]);
	r != null && g(t, ["args"], r);
	let i = _(e, ["name"]);
	if (i != null && g(t, ["name"], i), _(e, ["partialArgs"]) !== void 0) throw Error("partialArgs parameter is not supported in Gemini API.");
	if (_(e, ["willContinue"]) !== void 0) throw Error("willContinue parameter is not supported in Gemini API.");
	return t;
}
function ji(e) {
	let t = {}, n = _(e, ["description"]);
	n != null && g(t, ["description"], n);
	let r = _(e, ["name"]);
	r != null && g(t, ["name"], r);
	let i = _(e, ["parameters"]);
	i != null && g(t, ["parameters"], i);
	let a = _(e, ["parametersJsonSchema"]);
	a != null && g(t, ["parametersJsonSchema"], a);
	let o = _(e, ["response"]);
	o != null && g(t, ["response"], o);
	let s = _(e, ["responseJsonSchema"]);
	if (s != null && g(t, ["responseJsonSchema"], s), _(e, ["behavior"]) !== void 0) throw Error("behavior parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Mi(e) {
	let t = {}, n = _(e, ["modelSelectionConfig"]);
	n != null && g(t, ["modelConfig"], n);
	let r = _(e, ["responseJsonSchema"]);
	r != null && g(t, ["responseJsonSchema"], r);
	let i = _(e, ["audioTimestamp"]);
	i != null && g(t, ["audioTimestamp"], i);
	let a = _(e, ["candidateCount"]);
	a != null && g(t, ["candidateCount"], a);
	let o = _(e, ["enableAffectiveDialog"]);
	o != null && g(t, ["enableAffectiveDialog"], o);
	let s = _(e, ["frequencyPenalty"]);
	s != null && g(t, ["frequencyPenalty"], s);
	let c = _(e, ["logprobs"]);
	c != null && g(t, ["logprobs"], c);
	let l = _(e, ["maxOutputTokens"]);
	l != null && g(t, ["maxOutputTokens"], l);
	let u = _(e, ["mediaResolution"]);
	u != null && g(t, ["mediaResolution"], u);
	let d = _(e, ["presencePenalty"]);
	d != null && g(t, ["presencePenalty"], d);
	let f = _(e, ["responseLogprobs"]);
	f != null && g(t, ["responseLogprobs"], f);
	let p = _(e, ["responseMimeType"]);
	p != null && g(t, ["responseMimeType"], p);
	let m = _(e, ["responseModalities"]);
	m != null && g(t, ["responseModalities"], m);
	let h = _(e, ["responseSchema"]);
	h != null && g(t, ["responseSchema"], h);
	let v = _(e, ["routingConfig"]);
	v != null && g(t, ["routingConfig"], v);
	let y = _(e, ["seed"]);
	y != null && g(t, ["seed"], y);
	let b = _(e, ["speechConfig"]);
	b != null && g(t, ["speechConfig"], b);
	let x = _(e, ["stopSequences"]);
	x != null && g(t, ["stopSequences"], x);
	let S = _(e, ["temperature"]);
	S != null && g(t, ["temperature"], S);
	let C = _(e, ["thinkingConfig"]);
	C != null && g(t, ["thinkingConfig"], C);
	let w = _(e, ["topK"]);
	w != null && g(t, ["topK"], w);
	let T = _(e, ["topP"]);
	if (T != null && g(t, ["topP"], T), _(e, ["enableEnhancedCivicAnswers"]) !== void 0) throw Error("enableEnhancedCivicAnswers parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Ni(e) {
	let t = {}, n = _(e, ["authConfig"]);
	n != null && g(t, ["authConfig"], Ti(n));
	let r = _(e, ["enableWidget"]);
	return r != null && g(t, ["enableWidget"], r), t;
}
function Pi(e) {
	let t = {}, n = _(e, ["searchTypes"]);
	if (n != null && g(t, ["searchTypes"], n), _(e, ["blockingConfidence"]) !== void 0) throw Error("blockingConfidence parameter is not supported in Gemini API.");
	if (_(e, ["excludeDomains"]) !== void 0) throw Error("excludeDomains parameter is not supported in Gemini API.");
	let r = _(e, ["timeRangeFilter"]);
	return r != null && g(t, ["timeRangeFilter"], r), t;
}
function Fi(e, t) {
	let n = {}, r = _(e, ["generationConfig"]);
	t !== void 0 && r != null && g(t, ["setup", "generationConfig"], r);
	let i = _(e, ["responseModalities"]);
	t !== void 0 && i != null && g(t, [
		"setup",
		"generationConfig",
		"responseModalities"
	], i);
	let a = _(e, ["temperature"]);
	t !== void 0 && a != null && g(t, [
		"setup",
		"generationConfig",
		"temperature"
	], a);
	let o = _(e, ["topP"]);
	t !== void 0 && o != null && g(t, [
		"setup",
		"generationConfig",
		"topP"
	], o);
	let s = _(e, ["topK"]);
	t !== void 0 && s != null && g(t, [
		"setup",
		"generationConfig",
		"topK"
	], s);
	let c = _(e, ["maxOutputTokens"]);
	t !== void 0 && c != null && g(t, [
		"setup",
		"generationConfig",
		"maxOutputTokens"
	], c);
	let l = _(e, ["mediaResolution"]);
	t !== void 0 && l != null && g(t, [
		"setup",
		"generationConfig",
		"mediaResolution"
	], l);
	let u = _(e, ["seed"]);
	t !== void 0 && u != null && g(t, [
		"setup",
		"generationConfig",
		"seed"
	], u);
	let d = _(e, ["speechConfig"]);
	t !== void 0 && d != null && g(t, [
		"setup",
		"generationConfig",
		"speechConfig"
	], rn(d));
	let f = _(e, ["thinkingConfig"]);
	t !== void 0 && f != null && g(t, [
		"setup",
		"generationConfig",
		"thinkingConfig"
	], f);
	let p = _(e, ["enableAffectiveDialog"]);
	t !== void 0 && p != null && g(t, [
		"setup",
		"generationConfig",
		"enableAffectiveDialog"
	], p);
	let m = _(e, ["systemInstruction"]);
	t !== void 0 && m != null && g(t, ["setup", "systemInstruction"], Di(I(m)));
	let h = _(e, ["tools"]);
	if (t !== void 0 && h != null) {
		let e = an(h);
		Array.isArray(e) && (e = e.map((e) => Ji(R(e)))), g(t, ["setup", "tools"], e);
	}
	let v = _(e, ["sessionResumption"]);
	t !== void 0 && v != null && g(t, ["setup", "sessionResumption"], qi(v));
	let y = _(e, ["inputAudioTranscription"]);
	t !== void 0 && y != null && g(t, ["setup", "inputAudioTranscription"], wi(y));
	let b = _(e, ["outputAudioTranscription"]);
	t !== void 0 && b != null && g(t, ["setup", "outputAudioTranscription"], wi(b));
	let x = _(e, ["realtimeInputConfig"]);
	t !== void 0 && x != null && g(t, ["setup", "realtimeInputConfig"], x);
	let S = _(e, ["contextWindowCompression"]);
	t !== void 0 && S != null && g(t, ["setup", "contextWindowCompression"], S);
	let C = _(e, ["proactivity"]);
	if (t !== void 0 && C != null && g(t, ["setup", "proactivity"], C), _(e, ["explicitVadSignal"]) !== void 0) throw Error("explicitVadSignal parameter is not supported in Gemini API.");
	let w = _(e, ["avatarConfig"]);
	t !== void 0 && w != null && g(t, ["setup", "avatarConfig"], w);
	let T = _(e, ["safetySettings"]);
	if (t !== void 0 && T != null) {
		let e = T;
		Array.isArray(e) && (e = e.map((e) => Ki(e))), g(t, ["setup", "safetySettings"], e);
	}
	return n;
}
function Ii(e, t) {
	let n = {}, r = _(e, ["generationConfig"]);
	t !== void 0 && r != null && g(t, ["setup", "generationConfig"], Mi(r));
	let i = _(e, ["responseModalities"]);
	t !== void 0 && i != null && g(t, [
		"setup",
		"generationConfig",
		"responseModalities"
	], i);
	let a = _(e, ["temperature"]);
	t !== void 0 && a != null && g(t, [
		"setup",
		"generationConfig",
		"temperature"
	], a);
	let o = _(e, ["topP"]);
	t !== void 0 && o != null && g(t, [
		"setup",
		"generationConfig",
		"topP"
	], o);
	let s = _(e, ["topK"]);
	t !== void 0 && s != null && g(t, [
		"setup",
		"generationConfig",
		"topK"
	], s);
	let c = _(e, ["maxOutputTokens"]);
	t !== void 0 && c != null && g(t, [
		"setup",
		"generationConfig",
		"maxOutputTokens"
	], c);
	let l = _(e, ["mediaResolution"]);
	t !== void 0 && l != null && g(t, [
		"setup",
		"generationConfig",
		"mediaResolution"
	], l);
	let u = _(e, ["seed"]);
	t !== void 0 && u != null && g(t, [
		"setup",
		"generationConfig",
		"seed"
	], u);
	let d = _(e, ["speechConfig"]);
	t !== void 0 && d != null && g(t, [
		"setup",
		"generationConfig",
		"speechConfig"
	], rn(d));
	let f = _(e, ["thinkingConfig"]);
	t !== void 0 && f != null && g(t, [
		"setup",
		"generationConfig",
		"thinkingConfig"
	], f);
	let p = _(e, ["enableAffectiveDialog"]);
	t !== void 0 && p != null && g(t, [
		"setup",
		"generationConfig",
		"enableAffectiveDialog"
	], p);
	let m = _(e, ["systemInstruction"]);
	t !== void 0 && m != null && g(t, ["setup", "systemInstruction"], Oi(I(m)));
	let h = _(e, ["tools"]);
	if (t !== void 0 && h != null) {
		let e = an(h);
		Array.isArray(e) && (e = e.map((e) => Yi(R(e)))), g(t, ["setup", "tools"], e);
	}
	let v = _(e, ["sessionResumption"]);
	t !== void 0 && v != null && g(t, ["setup", "sessionResumption"], v);
	let y = _(e, ["inputAudioTranscription"]);
	t !== void 0 && y != null && g(t, ["setup", "inputAudioTranscription"], y);
	let b = _(e, ["outputAudioTranscription"]);
	t !== void 0 && b != null && g(t, ["setup", "outputAudioTranscription"], b);
	let x = _(e, ["realtimeInputConfig"]);
	t !== void 0 && x != null && g(t, ["setup", "realtimeInputConfig"], x);
	let S = _(e, ["contextWindowCompression"]);
	t !== void 0 && S != null && g(t, ["setup", "contextWindowCompression"], S);
	let C = _(e, ["proactivity"]);
	t !== void 0 && C != null && g(t, ["setup", "proactivity"], C);
	let w = _(e, ["explicitVadSignal"]);
	t !== void 0 && w != null && g(t, ["setup", "explicitVadSignal"], w);
	let T = _(e, ["avatarConfig"]);
	t !== void 0 && T != null && g(t, ["setup", "avatarConfig"], T);
	let E = _(e, ["safetySettings"]);
	if (t !== void 0 && E != null) {
		let e = E;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["setup", "safetySettings"], e);
	}
	return n;
}
function Li(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["setup", "model"], F(e, r));
	let i = _(t, ["config"]);
	return i != null && g(n, ["config"], Fi(i, n)), n;
}
function Ri(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["setup", "model"], F(e, r));
	let i = _(t, ["config"]);
	return i != null && g(n, ["config"], Ii(i, n)), n;
}
function zi(e) {
	let t = {}, n = _(e, ["musicGenerationConfig"]);
	return n != null && g(t, ["musicGenerationConfig"], n), t;
}
function Bi(e) {
	let t = {}, n = _(e, ["weightedPrompts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["weightedPrompts"], e);
	}
	return t;
}
function Vi(e) {
	let t = {}, n = _(e, ["media"]);
	if (n != null) {
		let e = Ut(n);
		Array.isArray(e) && (e = e.map((e) => Ei(e))), g(t, ["mediaChunks"], e);
	}
	let r = _(e, ["audio"]);
	r != null && g(t, ["audio"], Ei(Kt(r)));
	let i = _(e, ["audioStreamEnd"]);
	i != null && g(t, ["audioStreamEnd"], i);
	let a = _(e, ["video"]);
	a != null && g(t, ["video"], Ei(Gt(a)));
	let o = _(e, ["text"]);
	o != null && g(t, ["text"], o);
	let s = _(e, ["activityStart"]);
	s != null && g(t, ["activityStart"], s);
	let c = _(e, ["activityEnd"]);
	return c != null && g(t, ["activityEnd"], c), t;
}
function Hi(e) {
	let t = {}, n = _(e, ["media"]);
	if (n != null) {
		let e = Ut(n);
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["mediaChunks"], e);
	}
	let r = _(e, ["audio"]);
	r != null && g(t, ["audio"], Kt(r));
	let i = _(e, ["audioStreamEnd"]);
	i != null && g(t, ["audioStreamEnd"], i);
	let a = _(e, ["video"]);
	a != null && g(t, ["video"], Gt(a));
	let o = _(e, ["text"]);
	o != null && g(t, ["text"], o);
	let s = _(e, ["activityStart"]);
	s != null && g(t, ["activityStart"], s);
	let c = _(e, ["activityEnd"]);
	return c != null && g(t, ["activityEnd"], c), t;
}
function Ui(e) {
	let t = {}, n = _(e, ["setupComplete"]);
	n != null && g(t, ["setupComplete"], n);
	let r = _(e, ["serverContent"]);
	r != null && g(t, ["serverContent"], r);
	let i = _(e, ["toolCall"]);
	i != null && g(t, ["toolCall"], i);
	let a = _(e, ["toolCallCancellation"]);
	a != null && g(t, ["toolCallCancellation"], a);
	let o = _(e, ["usageMetadata"]);
	o != null && g(t, ["usageMetadata"], Xi(o));
	let s = _(e, ["goAway"]);
	s != null && g(t, ["goAway"], s);
	let c = _(e, ["sessionResumptionUpdate"]);
	c != null && g(t, ["sessionResumptionUpdate"], c);
	let l = _(e, ["voiceActivityDetectionSignal"]);
	l != null && g(t, ["voiceActivityDetectionSignal"], l);
	let u = _(e, ["voiceActivity"]);
	return u != null && g(t, ["voiceActivity"], Zi(u)), t;
}
function Wi(e) {
	let t = {}, n = _(e, ["mediaResolution"]);
	n != null && g(t, ["mediaResolution"], n);
	let r = _(e, ["codeExecutionResult"]);
	r != null && g(t, ["codeExecutionResult"], r);
	let i = _(e, ["executableCode"]);
	i != null && g(t, ["executableCode"], i);
	let a = _(e, ["fileData"]);
	a != null && g(t, ["fileData"], ki(a));
	let o = _(e, ["functionCall"]);
	o != null && g(t, ["functionCall"], Ai(o));
	let s = _(e, ["functionResponse"]);
	s != null && g(t, ["functionResponse"], s);
	let c = _(e, ["inlineData"]);
	c != null && g(t, ["inlineData"], Ei(c));
	let l = _(e, ["text"]);
	l != null && g(t, ["text"], l);
	let u = _(e, ["thought"]);
	u != null && g(t, ["thought"], u);
	let d = _(e, ["thoughtSignature"]);
	d != null && g(t, ["thoughtSignature"], d);
	let f = _(e, ["videoMetadata"]);
	f != null && g(t, ["videoMetadata"], f);
	let p = _(e, ["toolCall"]);
	p != null && g(t, ["toolCall"], p);
	let m = _(e, ["toolResponse"]);
	m != null && g(t, ["toolResponse"], m);
	let h = _(e, ["partMetadata"]);
	return h != null && g(t, ["partMetadata"], h), t;
}
function Gi(e) {
	let t = {}, n = _(e, ["mediaResolution"]);
	n != null && g(t, ["mediaResolution"], n);
	let r = _(e, ["codeExecutionResult"]);
	r != null && g(t, ["codeExecutionResult"], r);
	let i = _(e, ["executableCode"]);
	i != null && g(t, ["executableCode"], i);
	let a = _(e, ["fileData"]);
	a != null && g(t, ["fileData"], a);
	let o = _(e, ["functionCall"]);
	o != null && g(t, ["functionCall"], o);
	let s = _(e, ["functionResponse"]);
	s != null && g(t, ["functionResponse"], s);
	let c = _(e, ["inlineData"]);
	c != null && g(t, ["inlineData"], c);
	let l = _(e, ["text"]);
	l != null && g(t, ["text"], l);
	let u = _(e, ["thought"]);
	u != null && g(t, ["thought"], u);
	let d = _(e, ["thoughtSignature"]);
	d != null && g(t, ["thoughtSignature"], d);
	let f = _(e, ["videoMetadata"]);
	if (f != null && g(t, ["videoMetadata"], f), _(e, ["toolCall"]) !== void 0) throw Error("toolCall parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["toolResponse"]) !== void 0) throw Error("toolResponse parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["partMetadata"]) !== void 0) throw Error("partMetadata parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Ki(e) {
	let t = {}, n = _(e, ["category"]);
	if (n != null && g(t, ["category"], n), _(e, ["method"]) !== void 0) throw Error("method parameter is not supported in Gemini API.");
	let r = _(e, ["threshold"]);
	return r != null && g(t, ["threshold"], r), t;
}
function qi(e) {
	let t = {}, n = _(e, ["handle"]);
	if (n != null && g(t, ["handle"], n), _(e, ["transparent"]) !== void 0) throw Error("transparent parameter is not supported in Gemini API.");
	return t;
}
function Ji(e) {
	let t = {};
	if (_(e, ["retrieval"]) !== void 0) throw Error("retrieval parameter is not supported in Gemini API.");
	let n = _(e, ["computerUse"]);
	n != null && g(t, ["computerUse"], n);
	let r = _(e, ["fileSearch"]);
	r != null && g(t, ["fileSearch"], r);
	let i = _(e, ["googleSearch"]);
	i != null && g(t, ["googleSearch"], Pi(i));
	let a = _(e, ["googleMaps"]);
	a != null && g(t, ["googleMaps"], Ni(a));
	let o = _(e, ["codeExecution"]);
	if (o != null && g(t, ["codeExecution"], o), _(e, ["enterpriseWebSearch"]) !== void 0) throw Error("enterpriseWebSearch parameter is not supported in Gemini API.");
	let s = _(e, ["functionDeclarations"]);
	if (s != null) {
		let e = s;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["functionDeclarations"], e);
	}
	let c = _(e, ["googleSearchRetrieval"]);
	if (c != null && g(t, ["googleSearchRetrieval"], c), _(e, ["parallelAiSearch"]) !== void 0) throw Error("parallelAiSearch parameter is not supported in Gemini API.");
	let l = _(e, ["urlContext"]);
	l != null && g(t, ["urlContext"], l);
	let u = _(e, ["mcpServers"]);
	if (u != null) {
		let e = u;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["mcpServers"], e);
	}
	return t;
}
function Yi(e) {
	let t = {}, n = _(e, ["retrieval"]);
	n != null && g(t, ["retrieval"], n);
	let r = _(e, ["computerUse"]);
	if (r != null && g(t, ["computerUse"], r), _(e, ["fileSearch"]) !== void 0) throw Error("fileSearch parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let i = _(e, ["googleSearch"]);
	i != null && g(t, ["googleSearch"], i);
	let a = _(e, ["googleMaps"]);
	a != null && g(t, ["googleMaps"], a);
	let o = _(e, ["codeExecution"]);
	o != null && g(t, ["codeExecution"], o);
	let s = _(e, ["enterpriseWebSearch"]);
	s != null && g(t, ["enterpriseWebSearch"], s);
	let c = _(e, ["functionDeclarations"]);
	if (c != null) {
		let e = c;
		Array.isArray(e) && (e = e.map((e) => ji(e))), g(t, ["functionDeclarations"], e);
	}
	let l = _(e, ["googleSearchRetrieval"]);
	l != null && g(t, ["googleSearchRetrieval"], l);
	let u = _(e, ["parallelAiSearch"]);
	u != null && g(t, ["parallelAiSearch"], u);
	let d = _(e, ["urlContext"]);
	if (d != null && g(t, ["urlContext"], d), _(e, ["mcpServers"]) !== void 0) throw Error("mcpServers parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return t;
}
function Xi(e) {
	let t = {}, n = _(e, ["promptTokenCount"]);
	n != null && g(t, ["promptTokenCount"], n);
	let r = _(e, ["cachedContentTokenCount"]);
	r != null && g(t, ["cachedContentTokenCount"], r);
	let i = _(e, ["candidatesTokenCount"]);
	i != null && g(t, ["responseTokenCount"], i);
	let a = _(e, ["toolUsePromptTokenCount"]);
	a != null && g(t, ["toolUsePromptTokenCount"], a);
	let o = _(e, ["thoughtsTokenCount"]);
	o != null && g(t, ["thoughtsTokenCount"], o);
	let s = _(e, ["totalTokenCount"]);
	s != null && g(t, ["totalTokenCount"], s);
	let c = _(e, ["promptTokensDetails"]);
	if (c != null) {
		let e = c;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["promptTokensDetails"], e);
	}
	let l = _(e, ["cacheTokensDetails"]);
	if (l != null) {
		let e = l;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["cacheTokensDetails"], e);
	}
	let u = _(e, ["candidatesTokensDetails"]);
	if (u != null) {
		let e = u;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["responseTokensDetails"], e);
	}
	let d = _(e, ["toolUsePromptTokensDetails"]);
	if (d != null) {
		let e = d;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["toolUsePromptTokensDetails"], e);
	}
	let f = _(e, ["trafficType"]);
	return f != null && g(t, ["trafficType"], f), t;
}
function Zi(e) {
	let t = {}, n = _(e, ["type"]);
	return n != null && g(t, ["voiceActivityType"], n), t;
}
function Qi(e, t) {
	let n = {}, r = _(e, ["apiKey"]);
	if (r != null && g(n, ["apiKey"], r), _(e, ["apiKeyConfig"]) !== void 0) throw Error("apiKeyConfig parameter is not supported in Gemini API.");
	if (_(e, ["authType"]) !== void 0) throw Error("authType parameter is not supported in Gemini API.");
	if (_(e, ["googleServiceAccountConfig"]) !== void 0) throw Error("googleServiceAccountConfig parameter is not supported in Gemini API.");
	if (_(e, ["httpBasicAuthConfig"]) !== void 0) throw Error("httpBasicAuthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oauthConfig"]) !== void 0) throw Error("oauthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oidcConfig"]) !== void 0) throw Error("oidcConfig parameter is not supported in Gemini API.");
	return n;
}
function $i(e, t) {
	let n = {}, r = _(e, ["data"]);
	if (r != null && g(n, ["data"], r), _(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let i = _(e, ["mimeType"]);
	return i != null && g(n, ["mimeType"], i), n;
}
function ea(e, t) {
	let n = {}, r = _(e, ["content"]);
	r != null && g(n, ["content"], r);
	let i = _(e, ["citationMetadata"]);
	i != null && g(n, ["citationMetadata"], ta(i));
	let a = _(e, ["tokenCount"]);
	a != null && g(n, ["tokenCount"], a);
	let o = _(e, ["finishReason"]);
	o != null && g(n, ["finishReason"], o);
	let s = _(e, ["groundingMetadata"]);
	s != null && g(n, ["groundingMetadata"], s);
	let c = _(e, ["avgLogprobs"]);
	c != null && g(n, ["avgLogprobs"], c);
	let l = _(e, ["index"]);
	l != null && g(n, ["index"], l);
	let u = _(e, ["logprobsResult"]);
	u != null && g(n, ["logprobsResult"], u);
	let d = _(e, ["safetyRatings"]);
	if (d != null) {
		let e = d;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["safetyRatings"], e);
	}
	let f = _(e, ["urlContextMetadata"]);
	return f != null && g(n, ["urlContextMetadata"], f), n;
}
function ta(e, t) {
	let n = {}, r = _(e, ["citationSources"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["citations"], e);
	}
	return n;
}
function na(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["contents"]);
	if (a != null) {
		let e = L(a);
		Array.isArray(e) && (e = e.map((e) => sa(e))), g(r, ["contents"], e);
	}
	return r;
}
function ra(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["tokensInfo"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["tokensInfo"], e);
	}
	return n;
}
function ia(e, t) {
	let n = {}, r = _(e, ["values"]);
	r != null && g(n, ["values"], r);
	let i = _(e, ["statistics"]);
	return i != null && g(n, ["statistics"], aa(i)), n;
}
function aa(e, t) {
	let n = {}, r = _(e, ["truncated"]);
	r != null && g(n, ["truncated"], r);
	let i = _(e, ["token_count"]);
	return i != null && g(n, ["tokenCount"], i), n;
}
function oa(e, t) {
	let n = {}, r = _(e, ["parts"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => Eo(e))), g(n, ["parts"], e);
	}
	let i = _(e, ["role"]);
	return i != null && g(n, ["role"], i), n;
}
function sa(e, t) {
	let n = {}, r = _(e, ["parts"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => Do(e))), g(n, ["parts"], e);
	}
	let i = _(e, ["role"]);
	return i != null && g(n, ["role"], i), n;
}
function ca(e, t) {
	let n = {}, r = _(e, ["controlType"]);
	r != null && g(n, ["controlType"], r);
	let i = _(e, ["enableControlImageComputation"]);
	return i != null && g(n, ["computeControl"], i), n;
}
function la(e, t) {
	let n = {};
	if (_(e, ["systemInstruction"]) !== void 0) throw Error("systemInstruction parameter is not supported in Gemini API.");
	if (_(e, ["tools"]) !== void 0) throw Error("tools parameter is not supported in Gemini API.");
	if (_(e, ["generationConfig"]) !== void 0) throw Error("generationConfig parameter is not supported in Gemini API.");
	return n;
}
function ua(e, t, n) {
	let r = {}, i = _(e, ["systemInstruction"]);
	t !== void 0 && i != null && g(t, ["systemInstruction"], sa(I(i)));
	let a = _(e, ["tools"]);
	if (t !== void 0 && a != null) {
		let e = a;
		Array.isArray(e) && (e = e.map((e) => Go(e))), g(t, ["tools"], e);
	}
	let o = _(e, ["generationConfig"]);
	return t !== void 0 && o != null && g(t, ["generationConfig"], oo(o)), r;
}
function da(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["contents"]);
	if (a != null) {
		let e = L(a);
		Array.isArray(e) && (e = e.map((e) => oa(e))), g(r, ["contents"], e);
	}
	let o = _(t, ["config"]);
	return o != null && la(o), r;
}
function fa(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["contents"]);
	if (a != null) {
		let e = L(a);
		Array.isArray(e) && (e = e.map((e) => sa(e))), g(r, ["contents"], e);
	}
	let o = _(t, ["config"]);
	return o != null && ua(o, r), r;
}
function pa(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["totalTokens"]);
	i != null && g(n, ["totalTokens"], i);
	let a = _(e, ["cachedContentTokenCount"]);
	return a != null && g(n, ["cachedContentTokenCount"], a), n;
}
function ma(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["totalTokens"]);
	return i != null && g(n, ["totalTokens"], i), n;
}
function ha(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	return i != null && g(r, ["_url", "name"], F(e, i)), r;
}
function ga(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	return i != null && g(r, ["_url", "name"], F(e, i)), r;
}
function _a(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	return r != null && g(n, ["sdkHttpResponse"], r), n;
}
function va(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	return r != null && g(n, ["sdkHttpResponse"], r), n;
}
function ya(e, t, n) {
	let r = {}, i = _(e, ["outputGcsUri"]);
	t !== void 0 && i != null && g(t, ["parameters", "storageUri"], i);
	let a = _(e, ["negativePrompt"]);
	t !== void 0 && a != null && g(t, ["parameters", "negativePrompt"], a);
	let o = _(e, ["numberOfImages"]);
	t !== void 0 && o != null && g(t, ["parameters", "sampleCount"], o);
	let s = _(e, ["aspectRatio"]);
	t !== void 0 && s != null && g(t, ["parameters", "aspectRatio"], s);
	let c = _(e, ["guidanceScale"]);
	t !== void 0 && c != null && g(t, ["parameters", "guidanceScale"], c);
	let l = _(e, ["seed"]);
	t !== void 0 && l != null && g(t, ["parameters", "seed"], l);
	let u = _(e, ["safetyFilterLevel"]);
	t !== void 0 && u != null && g(t, ["parameters", "safetySetting"], u);
	let d = _(e, ["personGeneration"]);
	t !== void 0 && d != null && g(t, ["parameters", "personGeneration"], d);
	let f = _(e, ["includeSafetyAttributes"]);
	t !== void 0 && f != null && g(t, ["parameters", "includeSafetyAttributes"], f);
	let p = _(e, ["includeRaiReason"]);
	t !== void 0 && p != null && g(t, ["parameters", "includeRaiReason"], p);
	let m = _(e, ["language"]);
	t !== void 0 && m != null && g(t, ["parameters", "language"], m);
	let h = _(e, ["outputMimeType"]);
	t !== void 0 && h != null && g(t, [
		"parameters",
		"outputOptions",
		"mimeType"
	], h);
	let v = _(e, ["outputCompressionQuality"]);
	t !== void 0 && v != null && g(t, [
		"parameters",
		"outputOptions",
		"compressionQuality"
	], v);
	let y = _(e, ["addWatermark"]);
	t !== void 0 && y != null && g(t, ["parameters", "addWatermark"], y);
	let b = _(e, ["labels"]);
	t !== void 0 && b != null && g(t, ["labels"], b);
	let x = _(e, ["editMode"]);
	t !== void 0 && x != null && g(t, ["parameters", "editMode"], x);
	let S = _(e, ["baseSteps"]);
	return t !== void 0 && S != null && g(t, [
		"parameters",
		"editConfig",
		"baseSteps"
	], S), r;
}
function ba(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["prompt"]);
	a != null && g(r, ["instances[0]", "prompt"], a);
	let o = _(t, ["referenceImages"]);
	if (o != null) {
		let e = o;
		Array.isArray(e) && (e = e.map((e) => No(e))), g(r, ["instances[0]", "referenceImages"], e);
	}
	let s = _(t, ["config"]);
	return s != null && ya(s, r), r;
}
function xa(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["predictions"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => no(e))), g(n, ["generatedImages"], e);
	}
	return n;
}
function Sa(e, t, n) {
	let r = {}, i = _(e, ["taskType"]);
	t !== void 0 && i != null && g(t, ["requests[]", "taskType"], i);
	let a = _(e, ["title"]);
	t !== void 0 && a != null && g(t, ["requests[]", "title"], a);
	let o = _(e, ["outputDimensionality"]);
	if (t !== void 0 && o != null && g(t, ["requests[]", "outputDimensionality"], o), _(e, ["mimeType"]) !== void 0) throw Error("mimeType parameter is not supported in Gemini API.");
	if (_(e, ["autoTruncate"]) !== void 0) throw Error("autoTruncate parameter is not supported in Gemini API.");
	if (_(e, ["documentOcr"]) !== void 0) throw Error("documentOcr parameter is not supported in Gemini API.");
	if (_(e, ["audioTrackExtraction"]) !== void 0) throw Error("audioTrackExtraction parameter is not supported in Gemini API.");
	return r;
}
function Ca(e, t, n) {
	let r = {}, i = _(n, ["embeddingApiType"]);
	if (i === void 0 && (i = "PREDICT"), i === "PREDICT") {
		let n = _(e, ["taskType"]);
		t !== void 0 && n != null && g(t, ["instances[]", "task_type"], n);
	} else if (i === "EMBED_CONTENT") {
		let n = _(e, ["taskType"]);
		t !== void 0 && n != null && g(t, ["embedContentConfig", "taskType"], n);
	}
	let a = _(n, ["embeddingApiType"]);
	if (a === void 0 && (a = "PREDICT"), a === "PREDICT") {
		let n = _(e, ["title"]);
		t !== void 0 && n != null && g(t, ["instances[]", "title"], n);
	} else if (a === "EMBED_CONTENT") {
		let n = _(e, ["title"]);
		t !== void 0 && n != null && g(t, ["embedContentConfig", "title"], n);
	}
	let o = _(n, ["embeddingApiType"]);
	if (o === void 0 && (o = "PREDICT"), o === "PREDICT") {
		let n = _(e, ["outputDimensionality"]);
		t !== void 0 && n != null && g(t, ["parameters", "outputDimensionality"], n);
	} else if (o === "EMBED_CONTENT") {
		let n = _(e, ["outputDimensionality"]);
		t !== void 0 && n != null && g(t, ["embedContentConfig", "outputDimensionality"], n);
	}
	let s = _(n, ["embeddingApiType"]);
	if (s === void 0 && (s = "PREDICT"), s === "PREDICT") {
		let n = _(e, ["mimeType"]);
		t !== void 0 && n != null && g(t, ["instances[]", "mimeType"], n);
	}
	let c = _(n, ["embeddingApiType"]);
	if (c === void 0 && (c = "PREDICT"), c === "PREDICT") {
		let n = _(e, ["autoTruncate"]);
		t !== void 0 && n != null && g(t, ["parameters", "autoTruncate"], n);
	} else if (c === "EMBED_CONTENT") {
		let n = _(e, ["autoTruncate"]);
		t !== void 0 && n != null && g(t, ["embedContentConfig", "autoTruncate"], n);
	}
	let l = _(n, ["embeddingApiType"]);
	if (l === void 0 && (l = "PREDICT"), l === "EMBED_CONTENT") {
		let n = _(e, ["documentOcr"]);
		t !== void 0 && n != null && g(t, ["embedContentConfig", "documentOcr"], n);
	}
	let u = _(n, ["embeddingApiType"]);
	if (u === void 0 && (u = "PREDICT"), u === "EMBED_CONTENT") {
		let n = _(e, ["audioTrackExtraction"]);
		t !== void 0 && n != null && g(t, ["embedContentConfig", "audioTrackExtraction"], n);
	}
	return r;
}
function wa(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["contents"]);
	if (a != null) {
		let t = Qt(e, a);
		Array.isArray(t) && (t = t.map((e) => e)), g(r, ["requests[]", "content"], t);
	}
	let o = _(t, ["content"]);
	o != null && oa(I(o));
	let s = _(t, ["config"]);
	s != null && Sa(s, r);
	let c = _(t, ["model"]);
	return c !== void 0 && g(r, ["requests[]", "model"], F(e, c)), r;
}
function Ta(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(n, ["embeddingApiType"]);
	if (a === void 0 && (a = "PREDICT"), a === "PREDICT") {
		let n = _(t, ["contents"]);
		if (n != null) {
			let t = Qt(e, n);
			Array.isArray(t) && (t = t.map((e) => e)), g(r, ["instances[]", "content"], t);
		}
	}
	let o = _(n, ["embeddingApiType"]);
	if (o === void 0 && (o = "PREDICT"), o === "EMBED_CONTENT") {
		let e = _(t, ["content"]);
		e != null && g(r, ["content"], sa(I(e)));
	}
	let s = _(t, ["config"]);
	return s != null && Ca(s, r, n), r;
}
function Ea(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["embeddings"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["embeddings"], e);
	}
	let a = _(e, ["metadata"]);
	return a != null && g(n, ["metadata"], a), n;
}
function Da(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["predictions[]", "embeddings"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => ia(e))), g(n, ["embeddings"], e);
	}
	let a = _(e, ["metadata"]);
	if (a != null && g(n, ["metadata"], a), t && _(t, ["embeddingApiType"]) === "EMBED_CONTENT") {
		let t = _(e, ["embedding"]), r = _(e, ["usageMetadata"]), i = _(e, ["truncated"]);
		if (t) {
			let e = {};
			r && r.promptTokenCount && (e.tokenCount = r.promptTokenCount), i && (e.truncated = i), t.statistics = e, g(n, ["embeddings"], [t]);
		}
	}
	return n;
}
function Oa(e, t) {
	let n = {}, r = _(e, ["endpoint"]);
	r != null && g(n, ["name"], r);
	let i = _(e, ["deployedModelId"]);
	return i != null && g(n, ["deployedModelId"], i), n;
}
function ka(e, t) {
	let n = {};
	if (_(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let r = _(e, ["fileUri"]);
	r != null && g(n, ["fileUri"], r);
	let i = _(e, ["mimeType"]);
	return i != null && g(n, ["mimeType"], i), n;
}
function Aa(e, t) {
	let n = {}, r = _(e, ["id"]);
	r != null && g(n, ["id"], r);
	let i = _(e, ["args"]);
	i != null && g(n, ["args"], i);
	let a = _(e, ["name"]);
	if (a != null && g(n, ["name"], a), _(e, ["partialArgs"]) !== void 0) throw Error("partialArgs parameter is not supported in Gemini API.");
	if (_(e, ["willContinue"]) !== void 0) throw Error("willContinue parameter is not supported in Gemini API.");
	return n;
}
function ja(e, t) {
	let n = {}, r = _(e, ["allowedFunctionNames"]);
	r != null && g(n, ["allowedFunctionNames"], r);
	let i = _(e, ["mode"]);
	if (i != null && g(n, ["mode"], i), _(e, ["streamFunctionCallArguments"]) !== void 0) throw Error("streamFunctionCallArguments parameter is not supported in Gemini API.");
	return n;
}
function Ma(e, t) {
	let n = {}, r = _(e, ["description"]);
	r != null && g(n, ["description"], r);
	let i = _(e, ["name"]);
	i != null && g(n, ["name"], i);
	let a = _(e, ["parameters"]);
	a != null && g(n, ["parameters"], a);
	let o = _(e, ["parametersJsonSchema"]);
	o != null && g(n, ["parametersJsonSchema"], o);
	let s = _(e, ["response"]);
	s != null && g(n, ["response"], s);
	let c = _(e, ["responseJsonSchema"]);
	if (c != null && g(n, ["responseJsonSchema"], c), _(e, ["behavior"]) !== void 0) throw Error("behavior parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return n;
}
function Na(e, t, n, r) {
	let i = {}, a = _(t, ["systemInstruction"]);
	n !== void 0 && a != null && g(n, ["systemInstruction"], oa(I(a)));
	let o = _(t, ["temperature"]);
	o != null && g(i, ["temperature"], o);
	let s = _(t, ["topP"]);
	s != null && g(i, ["topP"], s);
	let c = _(t, ["topK"]);
	c != null && g(i, ["topK"], c);
	let l = _(t, ["candidateCount"]);
	l != null && g(i, ["candidateCount"], l);
	let u = _(t, ["maxOutputTokens"]);
	u != null && g(i, ["maxOutputTokens"], u);
	let d = _(t, ["stopSequences"]);
	d != null && g(i, ["stopSequences"], d);
	let f = _(t, ["responseLogprobs"]);
	f != null && g(i, ["responseLogprobs"], f);
	let p = _(t, ["logprobs"]);
	p != null && g(i, ["logprobs"], p);
	let m = _(t, ["presencePenalty"]);
	m != null && g(i, ["presencePenalty"], m);
	let h = _(t, ["frequencyPenalty"]);
	h != null && g(i, ["frequencyPenalty"], h);
	let v = _(t, ["seed"]);
	v != null && g(i, ["seed"], v);
	let y = _(t, ["responseMimeType"]);
	y != null && g(i, ["responseMimeType"], y);
	let b = _(t, ["responseSchema"]);
	b != null && g(i, ["responseSchema"], tn(b));
	let x = _(t, ["responseJsonSchema"]);
	if (x != null && g(i, ["responseJsonSchema"], x), _(t, ["routingConfig"]) !== void 0) throw Error("routingConfig parameter is not supported in Gemini API.");
	if (_(t, ["modelSelectionConfig"]) !== void 0) throw Error("modelSelectionConfig parameter is not supported in Gemini API.");
	let S = _(t, ["safetySettings"]);
	if (n !== void 0 && S != null) {
		let e = S;
		Array.isArray(e) && (e = e.map((e) => Io(e))), g(n, ["safetySettings"], e);
	}
	let C = _(t, ["tools"]);
	if (n !== void 0 && C != null) {
		let e = an(C);
		Array.isArray(e) && (e = e.map((e) => Wo(R(e)))), g(n, ["tools"], e);
	}
	let w = _(t, ["toolConfig"]);
	if (n !== void 0 && w != null && g(n, ["toolConfig"], Ho(w)), _(t, ["labels"]) !== void 0) throw Error("labels parameter is not supported in Gemini API.");
	let T = _(t, ["cachedContent"]);
	n !== void 0 && T != null && g(n, ["cachedContent"], z(e, T));
	let E = _(t, ["responseModalities"]);
	E != null && g(i, ["responseModalities"], E);
	let D = _(t, ["mediaResolution"]);
	D != null && g(i, ["mediaResolution"], D);
	let O = _(t, ["speechConfig"]);
	if (O != null && g(i, ["speechConfig"], nn(O)), _(t, ["audioTimestamp"]) !== void 0) throw Error("audioTimestamp parameter is not supported in Gemini API.");
	let k = _(t, ["thinkingConfig"]);
	k != null && g(i, ["thinkingConfig"], k);
	let A = _(t, ["imageConfig"]);
	A != null && g(i, ["imageConfig"], fo(A));
	let j = _(t, ["enableEnhancedCivicAnswers"]);
	if (j != null && g(i, ["enableEnhancedCivicAnswers"], j), _(t, ["modelArmorConfig"]) !== void 0) throw Error("modelArmorConfig parameter is not supported in Gemini API.");
	let M = _(t, ["serviceTier"]);
	return n !== void 0 && M != null && g(n, ["serviceTier"], M), i;
}
function Pa(e, t, n, r) {
	let i = {}, a = _(t, ["systemInstruction"]);
	n !== void 0 && a != null && g(n, ["systemInstruction"], sa(I(a)));
	let o = _(t, ["temperature"]);
	o != null && g(i, ["temperature"], o);
	let s = _(t, ["topP"]);
	s != null && g(i, ["topP"], s);
	let c = _(t, ["topK"]);
	c != null && g(i, ["topK"], c);
	let l = _(t, ["candidateCount"]);
	l != null && g(i, ["candidateCount"], l);
	let u = _(t, ["maxOutputTokens"]);
	u != null && g(i, ["maxOutputTokens"], u);
	let d = _(t, ["stopSequences"]);
	d != null && g(i, ["stopSequences"], d);
	let f = _(t, ["responseLogprobs"]);
	f != null && g(i, ["responseLogprobs"], f);
	let p = _(t, ["logprobs"]);
	p != null && g(i, ["logprobs"], p);
	let m = _(t, ["presencePenalty"]);
	m != null && g(i, ["presencePenalty"], m);
	let h = _(t, ["frequencyPenalty"]);
	h != null && g(i, ["frequencyPenalty"], h);
	let v = _(t, ["seed"]);
	v != null && g(i, ["seed"], v);
	let y = _(t, ["responseMimeType"]);
	y != null && g(i, ["responseMimeType"], y);
	let b = _(t, ["responseSchema"]);
	b != null && g(i, ["responseSchema"], tn(b));
	let x = _(t, ["responseJsonSchema"]);
	x != null && g(i, ["responseJsonSchema"], x);
	let S = _(t, ["routingConfig"]);
	S != null && g(i, ["routingConfig"], S);
	let C = _(t, ["modelSelectionConfig"]);
	C != null && g(i, ["modelConfig"], C);
	let w = _(t, ["safetySettings"]);
	if (n !== void 0 && w != null) {
		let e = w;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["safetySettings"], e);
	}
	let T = _(t, ["tools"]);
	if (n !== void 0 && T != null) {
		let e = an(T);
		Array.isArray(e) && (e = e.map((e) => Go(R(e)))), g(n, ["tools"], e);
	}
	let E = _(t, ["toolConfig"]);
	n !== void 0 && E != null && g(n, ["toolConfig"], Uo(E));
	let D = _(t, ["labels"]);
	n !== void 0 && D != null && g(n, ["labels"], D);
	let O = _(t, ["cachedContent"]);
	n !== void 0 && O != null && g(n, ["cachedContent"], z(e, O));
	let k = _(t, ["responseModalities"]);
	k != null && g(i, ["responseModalities"], k);
	let A = _(t, ["mediaResolution"]);
	A != null && g(i, ["mediaResolution"], A);
	let j = _(t, ["speechConfig"]);
	j != null && g(i, ["speechConfig"], nn(j));
	let M = _(t, ["audioTimestamp"]);
	M != null && g(i, ["audioTimestamp"], M);
	let ee = _(t, ["thinkingConfig"]);
	ee != null && g(i, ["thinkingConfig"], ee);
	let te = _(t, ["imageConfig"]);
	if (te != null && g(i, ["imageConfig"], po(te)), _(t, ["enableEnhancedCivicAnswers"]) !== void 0) throw Error("enableEnhancedCivicAnswers parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let ne = _(t, ["modelArmorConfig"]);
	n !== void 0 && ne != null && g(n, ["modelArmorConfig"], ne);
	let re = _(t, ["serviceTier"]);
	return n !== void 0 && re != null && g(n, ["serviceTier"], re), i;
}
function Fa(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["contents"]);
	if (a != null) {
		let e = L(a);
		Array.isArray(e) && (e = e.map((e) => oa(e))), g(r, ["contents"], e);
	}
	let o = _(t, ["config"]);
	return o != null && g(r, ["generationConfig"], Na(e, o, r)), r;
}
function Ia(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["contents"]);
	if (a != null) {
		let e = L(a);
		Array.isArray(e) && (e = e.map((e) => sa(e))), g(r, ["contents"], e);
	}
	let o = _(t, ["config"]);
	return o != null && g(r, ["generationConfig"], Pa(e, o, r)), r;
}
function La(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["candidates"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => ea(e))), g(n, ["candidates"], e);
	}
	let a = _(e, ["modelVersion"]);
	a != null && g(n, ["modelVersion"], a);
	let o = _(e, ["promptFeedback"]);
	o != null && g(n, ["promptFeedback"], o);
	let s = _(e, ["responseId"]);
	s != null && g(n, ["responseId"], s);
	let c = _(e, ["usageMetadata"]);
	c != null && g(n, ["usageMetadata"], c);
	let l = _(e, ["modelStatus"]);
	return l != null && g(n, ["modelStatus"], l), n;
}
function Ra(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["candidates"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["candidates"], e);
	}
	let a = _(e, ["createTime"]);
	a != null && g(n, ["createTime"], a);
	let o = _(e, ["modelVersion"]);
	o != null && g(n, ["modelVersion"], o);
	let s = _(e, ["promptFeedback"]);
	s != null && g(n, ["promptFeedback"], s);
	let c = _(e, ["responseId"]);
	c != null && g(n, ["responseId"], c);
	let l = _(e, ["usageMetadata"]);
	return l != null && g(n, ["usageMetadata"], l), n;
}
function za(e, t, n) {
	let r = {};
	if (_(e, ["outputGcsUri"]) !== void 0) throw Error("outputGcsUri parameter is not supported in Gemini API.");
	if (_(e, ["negativePrompt"]) !== void 0) throw Error("negativePrompt parameter is not supported in Gemini API.");
	let i = _(e, ["numberOfImages"]);
	t !== void 0 && i != null && g(t, ["parameters", "sampleCount"], i);
	let a = _(e, ["aspectRatio"]);
	t !== void 0 && a != null && g(t, ["parameters", "aspectRatio"], a);
	let o = _(e, ["guidanceScale"]);
	if (t !== void 0 && o != null && g(t, ["parameters", "guidanceScale"], o), _(e, ["seed"]) !== void 0) throw Error("seed parameter is not supported in Gemini API.");
	let s = _(e, ["safetyFilterLevel"]);
	t !== void 0 && s != null && g(t, ["parameters", "safetySetting"], s);
	let c = _(e, ["personGeneration"]);
	t !== void 0 && c != null && g(t, ["parameters", "personGeneration"], c);
	let l = _(e, ["includeSafetyAttributes"]);
	t !== void 0 && l != null && g(t, ["parameters", "includeSafetyAttributes"], l);
	let u = _(e, ["includeRaiReason"]);
	t !== void 0 && u != null && g(t, ["parameters", "includeRaiReason"], u);
	let d = _(e, ["language"]);
	t !== void 0 && d != null && g(t, ["parameters", "language"], d);
	let f = _(e, ["outputMimeType"]);
	t !== void 0 && f != null && g(t, [
		"parameters",
		"outputOptions",
		"mimeType"
	], f);
	let p = _(e, ["outputCompressionQuality"]);
	if (t !== void 0 && p != null && g(t, [
		"parameters",
		"outputOptions",
		"compressionQuality"
	], p), _(e, ["addWatermark"]) !== void 0) throw Error("addWatermark parameter is not supported in Gemini API.");
	if (_(e, ["labels"]) !== void 0) throw Error("labels parameter is not supported in Gemini API.");
	let m = _(e, ["imageSize"]);
	if (t !== void 0 && m != null && g(t, ["parameters", "sampleImageSize"], m), _(e, ["enhancePrompt"]) !== void 0) throw Error("enhancePrompt parameter is not supported in Gemini API.");
	return r;
}
function Ba(e, t, n) {
	let r = {}, i = _(e, ["outputGcsUri"]);
	t !== void 0 && i != null && g(t, ["parameters", "storageUri"], i);
	let a = _(e, ["negativePrompt"]);
	t !== void 0 && a != null && g(t, ["parameters", "negativePrompt"], a);
	let o = _(e, ["numberOfImages"]);
	t !== void 0 && o != null && g(t, ["parameters", "sampleCount"], o);
	let s = _(e, ["aspectRatio"]);
	t !== void 0 && s != null && g(t, ["parameters", "aspectRatio"], s);
	let c = _(e, ["guidanceScale"]);
	t !== void 0 && c != null && g(t, ["parameters", "guidanceScale"], c);
	let l = _(e, ["seed"]);
	t !== void 0 && l != null && g(t, ["parameters", "seed"], l);
	let u = _(e, ["safetyFilterLevel"]);
	t !== void 0 && u != null && g(t, ["parameters", "safetySetting"], u);
	let d = _(e, ["personGeneration"]);
	t !== void 0 && d != null && g(t, ["parameters", "personGeneration"], d);
	let f = _(e, ["includeSafetyAttributes"]);
	t !== void 0 && f != null && g(t, ["parameters", "includeSafetyAttributes"], f);
	let p = _(e, ["includeRaiReason"]);
	t !== void 0 && p != null && g(t, ["parameters", "includeRaiReason"], p);
	let m = _(e, ["language"]);
	t !== void 0 && m != null && g(t, ["parameters", "language"], m);
	let h = _(e, ["outputMimeType"]);
	t !== void 0 && h != null && g(t, [
		"parameters",
		"outputOptions",
		"mimeType"
	], h);
	let v = _(e, ["outputCompressionQuality"]);
	t !== void 0 && v != null && g(t, [
		"parameters",
		"outputOptions",
		"compressionQuality"
	], v);
	let y = _(e, ["addWatermark"]);
	t !== void 0 && y != null && g(t, ["parameters", "addWatermark"], y);
	let b = _(e, ["labels"]);
	t !== void 0 && b != null && g(t, ["labels"], b);
	let x = _(e, ["imageSize"]);
	t !== void 0 && x != null && g(t, ["parameters", "sampleImageSize"], x);
	let S = _(e, ["enhancePrompt"]);
	return t !== void 0 && S != null && g(t, ["parameters", "enhancePrompt"], S), r;
}
function Va(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["prompt"]);
	a != null && g(r, ["instances[0]", "prompt"], a);
	let o = _(t, ["config"]);
	return o != null && za(o, r), r;
}
function Ha(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["prompt"]);
	a != null && g(r, ["instances[0]", "prompt"], a);
	let o = _(t, ["config"]);
	return o != null && Ba(o, r), r;
}
function Ua(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["predictions"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => to(e))), g(n, ["generatedImages"], e);
	}
	let a = _(e, ["positivePromptSafetyAttributes"]);
	return a != null && g(n, ["positivePromptSafetyAttributes"], Po(a)), n;
}
function Wa(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["predictions"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => no(e))), g(n, ["generatedImages"], e);
	}
	let a = _(e, ["positivePromptSafetyAttributes"]);
	return a != null && g(n, ["positivePromptSafetyAttributes"], Fo(a)), n;
}
function Ga(e, t, n) {
	let r = {}, i = _(e, ["numberOfVideos"]);
	if (t !== void 0 && i != null && g(t, ["parameters", "sampleCount"], i), _(e, ["outputGcsUri"]) !== void 0) throw Error("outputGcsUri parameter is not supported in Gemini API.");
	if (_(e, ["fps"]) !== void 0) throw Error("fps parameter is not supported in Gemini API.");
	let a = _(e, ["durationSeconds"]);
	if (t !== void 0 && a != null && g(t, ["parameters", "durationSeconds"], a), _(e, ["seed"]) !== void 0) throw Error("seed parameter is not supported in Gemini API.");
	let o = _(e, ["aspectRatio"]);
	t !== void 0 && o != null && g(t, ["parameters", "aspectRatio"], o);
	let s = _(e, ["resolution"]);
	t !== void 0 && s != null && g(t, ["parameters", "resolution"], s);
	let c = _(e, ["personGeneration"]);
	if (t !== void 0 && c != null && g(t, ["parameters", "personGeneration"], c), _(e, ["pubsubTopic"]) !== void 0) throw Error("pubsubTopic parameter is not supported in Gemini API.");
	let l = _(e, ["negativePrompt"]);
	t !== void 0 && l != null && g(t, ["parameters", "negativePrompt"], l);
	let u = _(e, ["enhancePrompt"]);
	if (t !== void 0 && u != null && g(t, ["parameters", "enhancePrompt"], u), _(e, ["generateAudio"]) !== void 0) throw Error("generateAudio parameter is not supported in Gemini API.");
	let d = _(e, ["lastFrame"]);
	t !== void 0 && d != null && g(t, ["instances[0]", "lastFrame"], go(d));
	let f = _(e, ["referenceImages"]);
	if (t !== void 0 && f != null) {
		let e = f;
		Array.isArray(e) && (e = e.map((e) => is(e))), g(t, ["instances[0]", "referenceImages"], e);
	}
	if (_(e, ["mask"]) !== void 0) throw Error("mask parameter is not supported in Gemini API.");
	if (_(e, ["compressionQuality"]) !== void 0) throw Error("compressionQuality parameter is not supported in Gemini API.");
	if (_(e, ["labels"]) !== void 0) throw Error("labels parameter is not supported in Gemini API.");
	let p = _(e, ["webhookConfig"]);
	if (t !== void 0 && p != null && g(t, ["webhookConfig"], p), _(e, ["resizeMode"]) !== void 0) throw Error("resizeMode parameter is not supported in Gemini API.");
	return r;
}
function Ka(e, t, n) {
	let r = {}, i = _(e, ["numberOfVideos"]);
	t !== void 0 && i != null && g(t, ["parameters", "sampleCount"], i);
	let a = _(e, ["outputGcsUri"]);
	t !== void 0 && a != null && g(t, ["parameters", "storageUri"], a);
	let o = _(e, ["fps"]);
	t !== void 0 && o != null && g(t, ["parameters", "fps"], o);
	let s = _(e, ["durationSeconds"]);
	t !== void 0 && s != null && g(t, ["parameters", "durationSeconds"], s);
	let c = _(e, ["seed"]);
	t !== void 0 && c != null && g(t, ["parameters", "seed"], c);
	let l = _(e, ["aspectRatio"]);
	t !== void 0 && l != null && g(t, ["parameters", "aspectRatio"], l);
	let u = _(e, ["resolution"]);
	t !== void 0 && u != null && g(t, ["parameters", "resolution"], u);
	let d = _(e, ["personGeneration"]);
	t !== void 0 && d != null && g(t, ["parameters", "personGeneration"], d);
	let f = _(e, ["pubsubTopic"]);
	t !== void 0 && f != null && g(t, ["parameters", "pubsubTopic"], f);
	let p = _(e, ["negativePrompt"]);
	t !== void 0 && p != null && g(t, ["parameters", "negativePrompt"], p);
	let m = _(e, ["enhancePrompt"]);
	t !== void 0 && m != null && g(t, ["parameters", "enhancePrompt"], m);
	let h = _(e, ["generateAudio"]);
	t !== void 0 && h != null && g(t, ["parameters", "generateAudio"], h);
	let v = _(e, ["lastFrame"]);
	t !== void 0 && v != null && g(t, ["instances[0]", "lastFrame"], q(v));
	let y = _(e, ["referenceImages"]);
	if (t !== void 0 && y != null) {
		let e = y;
		Array.isArray(e) && (e = e.map((e) => as(e))), g(t, ["instances[0]", "referenceImages"], e);
	}
	let b = _(e, ["mask"]);
	t !== void 0 && b != null && g(t, ["instances[0]", "mask"], rs(b));
	let x = _(e, ["compressionQuality"]);
	t !== void 0 && x != null && g(t, ["parameters", "compressionQuality"], x);
	let S = _(e, ["labels"]);
	if (t !== void 0 && S != null && g(t, ["labels"], S), _(e, ["webhookConfig"]) !== void 0) throw Error("webhookConfig parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let C = _(e, ["resizeMode"]);
	return t !== void 0 && C != null && g(t, ["parameters", "resizeMode"], C), r;
}
function qa(e, t) {
	let n = {}, r = _(e, ["name"]);
	r != null && g(n, ["name"], r);
	let i = _(e, ["metadata"]);
	i != null && g(n, ["metadata"], i);
	let a = _(e, ["done"]);
	a != null && g(n, ["done"], a);
	let o = _(e, ["error"]);
	o != null && g(n, ["error"], o);
	let s = _(e, ["response", "generateVideoResponse"]);
	return s != null && g(n, ["response"], Za(s)), n;
}
function Ja(e, t) {
	let n = {}, r = _(e, ["name"]);
	r != null && g(n, ["name"], r);
	let i = _(e, ["metadata"]);
	i != null && g(n, ["metadata"], i);
	let a = _(e, ["done"]);
	a != null && g(n, ["done"], a);
	let o = _(e, ["error"]);
	o != null && g(n, ["error"], o);
	let s = _(e, ["response"]);
	return s != null && g(n, ["response"], Qa(s)), n;
}
function Ya(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["prompt"]);
	a != null && g(r, ["instances[0]", "prompt"], a);
	let o = _(t, ["image"]);
	o != null && g(r, ["instances[0]", "image"], go(o));
	let s = _(t, ["video"]);
	s != null && g(r, ["instances[0]", "video"], os(s));
	let c = _(t, ["source"]);
	c != null && $a(c, r);
	let l = _(t, ["config"]);
	return l != null && Ga(l, r), r;
}
function Xa(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["prompt"]);
	a != null && g(r, ["instances[0]", "prompt"], a);
	let o = _(t, ["image"]);
	o != null && g(r, ["instances[0]", "image"], q(o));
	let s = _(t, ["video"]);
	s != null && g(r, ["instances[0]", "video"], ss(s));
	let c = _(t, ["source"]);
	c != null && eo(c, r);
	let l = _(t, ["config"]);
	return l != null && Ka(l, r), r;
}
function Za(e, t) {
	let n = {}, r = _(e, ["generatedSamples"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => io(e))), g(n, ["generatedVideos"], e);
	}
	let i = _(e, ["raiMediaFilteredCount"]);
	i != null && g(n, ["raiMediaFilteredCount"], i);
	let a = _(e, ["raiMediaFilteredReasons"]);
	return a != null && g(n, ["raiMediaFilteredReasons"], a), n;
}
function Qa(e, t) {
	let n = {}, r = _(e, ["videos"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => ao(e))), g(n, ["generatedVideos"], e);
	}
	let i = _(e, ["raiMediaFilteredCount"]);
	i != null && g(n, ["raiMediaFilteredCount"], i);
	let a = _(e, ["raiMediaFilteredReasons"]);
	return a != null && g(n, ["raiMediaFilteredReasons"], a), n;
}
function $a(e, t, n) {
	let r = {}, i = _(e, ["prompt"]);
	t !== void 0 && i != null && g(t, ["instances[0]", "prompt"], i);
	let a = _(e, ["image"]);
	t !== void 0 && a != null && g(t, ["instances[0]", "image"], go(a));
	let o = _(e, ["video"]);
	return t !== void 0 && o != null && g(t, ["instances[0]", "video"], os(o)), r;
}
function eo(e, t, n) {
	let r = {}, i = _(e, ["prompt"]);
	t !== void 0 && i != null && g(t, ["instances[0]", "prompt"], i);
	let a = _(e, ["image"]);
	t !== void 0 && a != null && g(t, ["instances[0]", "image"], q(a));
	let o = _(e, ["video"]);
	return t !== void 0 && o != null && g(t, ["instances[0]", "video"], ss(o)), r;
}
function to(e, t) {
	let n = {}, r = _(e, ["_self"]);
	r != null && g(n, ["image"], mo(r));
	let i = _(e, ["raiFilteredReason"]);
	i != null && g(n, ["raiFilteredReason"], i);
	let a = _(e, ["_self"]);
	return a != null && g(n, ["safetyAttributes"], Po(a)), n;
}
function no(e, t) {
	let n = {}, r = _(e, ["_self"]);
	r != null && g(n, ["image"], ho(r));
	let i = _(e, ["raiFilteredReason"]);
	i != null && g(n, ["raiFilteredReason"], i);
	let a = _(e, ["_self"]);
	a != null && g(n, ["safetyAttributes"], Fo(a));
	let o = _(e, ["prompt"]);
	return o != null && g(n, ["enhancedPrompt"], o), n;
}
function ro(e, t) {
	let n = {}, r = _(e, ["_self"]);
	r != null && g(n, ["mask"], ho(r));
	let i = _(e, ["labels"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["labels"], e);
	}
	return n;
}
function io(e, t) {
	let n = {}, r = _(e, ["video"]);
	return r != null && g(n, ["video"], ts(r)), n;
}
function ao(e, t) {
	let n = {}, r = _(e, ["_self"]);
	return r != null && g(n, ["video"], ns(r)), n;
}
function oo(e, t) {
	let n = {}, r = _(e, ["modelSelectionConfig"]);
	r != null && g(n, ["modelConfig"], r);
	let i = _(e, ["responseJsonSchema"]);
	i != null && g(n, ["responseJsonSchema"], i);
	let a = _(e, ["audioTimestamp"]);
	a != null && g(n, ["audioTimestamp"], a);
	let o = _(e, ["candidateCount"]);
	o != null && g(n, ["candidateCount"], o);
	let s = _(e, ["enableAffectiveDialog"]);
	s != null && g(n, ["enableAffectiveDialog"], s);
	let c = _(e, ["frequencyPenalty"]);
	c != null && g(n, ["frequencyPenalty"], c);
	let l = _(e, ["logprobs"]);
	l != null && g(n, ["logprobs"], l);
	let u = _(e, ["maxOutputTokens"]);
	u != null && g(n, ["maxOutputTokens"], u);
	let d = _(e, ["mediaResolution"]);
	d != null && g(n, ["mediaResolution"], d);
	let f = _(e, ["presencePenalty"]);
	f != null && g(n, ["presencePenalty"], f);
	let p = _(e, ["responseLogprobs"]);
	p != null && g(n, ["responseLogprobs"], p);
	let m = _(e, ["responseMimeType"]);
	m != null && g(n, ["responseMimeType"], m);
	let h = _(e, ["responseModalities"]);
	h != null && g(n, ["responseModalities"], h);
	let v = _(e, ["responseSchema"]);
	v != null && g(n, ["responseSchema"], v);
	let y = _(e, ["routingConfig"]);
	y != null && g(n, ["routingConfig"], y);
	let b = _(e, ["seed"]);
	b != null && g(n, ["seed"], b);
	let x = _(e, ["speechConfig"]);
	x != null && g(n, ["speechConfig"], x);
	let S = _(e, ["stopSequences"]);
	S != null && g(n, ["stopSequences"], S);
	let C = _(e, ["temperature"]);
	C != null && g(n, ["temperature"], C);
	let w = _(e, ["thinkingConfig"]);
	w != null && g(n, ["thinkingConfig"], w);
	let T = _(e, ["topK"]);
	T != null && g(n, ["topK"], T);
	let E = _(e, ["topP"]);
	if (E != null && g(n, ["topP"], E), _(e, ["enableEnhancedCivicAnswers"]) !== void 0) throw Error("enableEnhancedCivicAnswers parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return n;
}
function so(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	return i != null && g(r, ["_url", "name"], F(e, i)), r;
}
function co(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	return i != null && g(r, ["_url", "name"], F(e, i)), r;
}
function lo(e, t) {
	let n = {}, r = _(e, ["authConfig"]);
	r != null && g(n, ["authConfig"], Qi(r));
	let i = _(e, ["enableWidget"]);
	return i != null && g(n, ["enableWidget"], i), n;
}
function uo(e, t) {
	let n = {}, r = _(e, ["searchTypes"]);
	if (r != null && g(n, ["searchTypes"], r), _(e, ["blockingConfidence"]) !== void 0) throw Error("blockingConfidence parameter is not supported in Gemini API.");
	if (_(e, ["excludeDomains"]) !== void 0) throw Error("excludeDomains parameter is not supported in Gemini API.");
	let i = _(e, ["timeRangeFilter"]);
	return i != null && g(n, ["timeRangeFilter"], i), n;
}
function fo(e, t) {
	let n = {}, r = _(e, ["aspectRatio"]);
	r != null && g(n, ["aspectRatio"], r);
	let i = _(e, ["imageSize"]);
	if (i != null && g(n, ["imageSize"], i), _(e, ["personGeneration"]) !== void 0) throw Error("personGeneration parameter is not supported in Gemini API.");
	if (_(e, ["prominentPeople"]) !== void 0) throw Error("prominentPeople parameter is not supported in Gemini API.");
	if (_(e, ["outputMimeType"]) !== void 0) throw Error("outputMimeType parameter is not supported in Gemini API.");
	if (_(e, ["outputCompressionQuality"]) !== void 0) throw Error("outputCompressionQuality parameter is not supported in Gemini API.");
	if (_(e, ["imageOutputOptions"]) !== void 0) throw Error("imageOutputOptions parameter is not supported in Gemini API.");
	return n;
}
function po(e, t) {
	let n = {}, r = _(e, ["aspectRatio"]);
	r != null && g(n, ["aspectRatio"], r);
	let i = _(e, ["imageSize"]);
	i != null && g(n, ["imageSize"], i);
	let a = _(e, ["personGeneration"]);
	a != null && g(n, ["personGeneration"], a);
	let o = _(e, ["prominentPeople"]);
	o != null && g(n, ["prominentPeople"], o);
	let s = _(e, ["outputMimeType"]);
	s != null && g(n, ["imageOutputOptions", "mimeType"], s);
	let c = _(e, ["outputCompressionQuality"]);
	c != null && g(n, ["imageOutputOptions", "compressionQuality"], c);
	let l = _(e, ["imageOutputOptions"]);
	return l != null && g(n, ["imageOutputOptions"], l), n;
}
function mo(e, t) {
	let n = {}, r = _(e, ["bytesBase64Encoded"]);
	r != null && g(n, ["imageBytes"], B(r));
	let i = _(e, ["mimeType"]);
	return i != null && g(n, ["mimeType"], i), n;
}
function ho(e, t) {
	let n = {}, r = _(e, ["gcsUri"]);
	r != null && g(n, ["gcsUri"], r);
	let i = _(e, ["bytesBase64Encoded"]);
	i != null && g(n, ["imageBytes"], B(i));
	let a = _(e, ["mimeType"]);
	return a != null && g(n, ["mimeType"], a), n;
}
function go(e, t) {
	let n = {};
	if (_(e, ["gcsUri"]) !== void 0) throw Error("gcsUri parameter is not supported in Gemini API.");
	let r = _(e, ["imageBytes"]);
	r != null && g(n, ["bytesBase64Encoded"], B(r));
	let i = _(e, ["mimeType"]);
	return i != null && g(n, ["mimeType"], i), n;
}
function q(e, t) {
	let n = {}, r = _(e, ["gcsUri"]);
	r != null && g(n, ["gcsUri"], r);
	let i = _(e, ["imageBytes"]);
	i != null && g(n, ["bytesBase64Encoded"], B(i));
	let a = _(e, ["mimeType"]);
	return a != null && g(n, ["mimeType"], a), n;
}
function _o(e, t, n, r) {
	let i = {}, a = _(t, ["pageSize"]);
	n !== void 0 && a != null && g(n, ["_query", "pageSize"], a);
	let o = _(t, ["pageToken"]);
	n !== void 0 && o != null && g(n, ["_query", "pageToken"], o);
	let s = _(t, ["filter"]);
	n !== void 0 && s != null && g(n, ["_query", "filter"], s);
	let c = _(t, ["queryBase"]);
	return n !== void 0 && c != null && g(n, ["_url", "models_url"], fn(e, c)), i;
}
function vo(e, t, n, r) {
	let i = {}, a = _(t, ["pageSize"]);
	n !== void 0 && a != null && g(n, ["_query", "pageSize"], a);
	let o = _(t, ["pageToken"]);
	n !== void 0 && o != null && g(n, ["_query", "pageToken"], o);
	let s = _(t, ["filter"]);
	n !== void 0 && s != null && g(n, ["_query", "filter"], s);
	let c = _(t, ["queryBase"]);
	return n !== void 0 && c != null && g(n, ["_url", "models_url"], fn(e, c)), i;
}
function yo(e, t, n) {
	let r = {}, i = _(t, ["config"]);
	return i != null && _o(e, i, r), r;
}
function bo(e, t, n) {
	let r = {}, i = _(t, ["config"]);
	return i != null && vo(e, i, r), r;
}
function xo(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["nextPageToken"]);
	i != null && g(n, ["nextPageToken"], i);
	let a = _(e, ["_self"]);
	if (a != null) {
		let e = pn(a);
		Array.isArray(e) && (e = e.map((e) => wo(e))), g(n, ["models"], e);
	}
	return n;
}
function So(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["nextPageToken"]);
	i != null && g(n, ["nextPageToken"], i);
	let a = _(e, ["_self"]);
	if (a != null) {
		let e = pn(a);
		Array.isArray(e) && (e = e.map((e) => To(e))), g(n, ["models"], e);
	}
	return n;
}
function Co(e, t) {
	let n = {}, r = _(e, ["maskMode"]);
	r != null && g(n, ["maskMode"], r);
	let i = _(e, ["segmentationClasses"]);
	i != null && g(n, ["maskClasses"], i);
	let a = _(e, ["maskDilation"]);
	return a != null && g(n, ["dilation"], a), n;
}
function wo(e, t) {
	let n = {}, r = _(e, ["name"]);
	r != null && g(n, ["name"], r);
	let i = _(e, ["displayName"]);
	i != null && g(n, ["displayName"], i);
	let a = _(e, ["description"]);
	a != null && g(n, ["description"], a);
	let o = _(e, ["version"]);
	o != null && g(n, ["version"], o);
	let s = _(e, ["_self"]);
	s != null && g(n, ["tunedModelInfo"], Ko(s));
	let c = _(e, ["inputTokenLimit"]);
	c != null && g(n, ["inputTokenLimit"], c);
	let l = _(e, ["outputTokenLimit"]);
	l != null && g(n, ["outputTokenLimit"], l);
	let u = _(e, ["supportedGenerationMethods"]);
	u != null && g(n, ["supportedActions"], u);
	let d = _(e, ["temperature"]);
	d != null && g(n, ["temperature"], d);
	let f = _(e, ["maxTemperature"]);
	f != null && g(n, ["maxTemperature"], f);
	let p = _(e, ["topP"]);
	p != null && g(n, ["topP"], p);
	let m = _(e, ["topK"]);
	m != null && g(n, ["topK"], m);
	let h = _(e, ["thinking"]);
	return h != null && g(n, ["thinking"], h), n;
}
function To(e, t) {
	let n = {}, r = _(e, ["name"]);
	r != null && g(n, ["name"], r);
	let i = _(e, ["displayName"]);
	i != null && g(n, ["displayName"], i);
	let a = _(e, ["description"]);
	a != null && g(n, ["description"], a);
	let o = _(e, ["versionId"]);
	o != null && g(n, ["version"], o);
	let s = _(e, ["deployedModels"]);
	if (s != null) {
		let e = s;
		Array.isArray(e) && (e = e.map((e) => Oa(e))), g(n, ["endpoints"], e);
	}
	let c = _(e, ["labels"]);
	c != null && g(n, ["labels"], c);
	let l = _(e, ["_self"]);
	l != null && g(n, ["tunedModelInfo"], qo(l));
	let u = _(e, ["defaultCheckpointId"]);
	u != null && g(n, ["defaultCheckpointId"], u);
	let d = _(e, ["checkpoints"]);
	if (d != null) {
		let e = d;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["checkpoints"], e);
	}
	return n;
}
function Eo(e, t) {
	let n = {}, r = _(e, ["mediaResolution"]);
	r != null && g(n, ["mediaResolution"], r);
	let i = _(e, ["codeExecutionResult"]);
	i != null && g(n, ["codeExecutionResult"], i);
	let a = _(e, ["executableCode"]);
	a != null && g(n, ["executableCode"], a);
	let o = _(e, ["fileData"]);
	o != null && g(n, ["fileData"], ka(o));
	let s = _(e, ["functionCall"]);
	s != null && g(n, ["functionCall"], Aa(s));
	let c = _(e, ["functionResponse"]);
	c != null && g(n, ["functionResponse"], c);
	let l = _(e, ["inlineData"]);
	l != null && g(n, ["inlineData"], $i(l));
	let u = _(e, ["text"]);
	u != null && g(n, ["text"], u);
	let d = _(e, ["thought"]);
	d != null && g(n, ["thought"], d);
	let f = _(e, ["thoughtSignature"]);
	f != null && g(n, ["thoughtSignature"], f);
	let p = _(e, ["videoMetadata"]);
	p != null && g(n, ["videoMetadata"], p);
	let m = _(e, ["toolCall"]);
	m != null && g(n, ["toolCall"], m);
	let h = _(e, ["toolResponse"]);
	h != null && g(n, ["toolResponse"], h);
	let v = _(e, ["partMetadata"]);
	return v != null && g(n, ["partMetadata"], v), n;
}
function Do(e, t) {
	let n = {}, r = _(e, ["mediaResolution"]);
	r != null && g(n, ["mediaResolution"], r);
	let i = _(e, ["codeExecutionResult"]);
	i != null && g(n, ["codeExecutionResult"], i);
	let a = _(e, ["executableCode"]);
	a != null && g(n, ["executableCode"], a);
	let o = _(e, ["fileData"]);
	o != null && g(n, ["fileData"], o);
	let s = _(e, ["functionCall"]);
	s != null && g(n, ["functionCall"], s);
	let c = _(e, ["functionResponse"]);
	c != null && g(n, ["functionResponse"], c);
	let l = _(e, ["inlineData"]);
	l != null && g(n, ["inlineData"], l);
	let u = _(e, ["text"]);
	u != null && g(n, ["text"], u);
	let d = _(e, ["thought"]);
	d != null && g(n, ["thought"], d);
	let f = _(e, ["thoughtSignature"]);
	f != null && g(n, ["thoughtSignature"], f);
	let p = _(e, ["videoMetadata"]);
	if (p != null && g(n, ["videoMetadata"], p), _(e, ["toolCall"]) !== void 0) throw Error("toolCall parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["toolResponse"]) !== void 0) throw Error("toolResponse parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	if (_(e, ["partMetadata"]) !== void 0) throw Error("partMetadata parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return n;
}
function Oo(e, t) {
	let n = {}, r = _(e, ["productImage"]);
	return r != null && g(n, ["image"], q(r)), n;
}
function ko(e, t, n) {
	let r = {}, i = _(e, ["numberOfImages"]);
	t !== void 0 && i != null && g(t, ["parameters", "sampleCount"], i);
	let a = _(e, ["baseSteps"]);
	t !== void 0 && a != null && g(t, ["parameters", "baseSteps"], a);
	let o = _(e, ["outputGcsUri"]);
	t !== void 0 && o != null && g(t, ["parameters", "storageUri"], o);
	let s = _(e, ["seed"]);
	t !== void 0 && s != null && g(t, ["parameters", "seed"], s);
	let c = _(e, ["safetyFilterLevel"]);
	t !== void 0 && c != null && g(t, ["parameters", "safetySetting"], c);
	let l = _(e, ["personGeneration"]);
	t !== void 0 && l != null && g(t, ["parameters", "personGeneration"], l);
	let u = _(e, ["addWatermark"]);
	t !== void 0 && u != null && g(t, ["parameters", "addWatermark"], u);
	let d = _(e, ["outputMimeType"]);
	t !== void 0 && d != null && g(t, [
		"parameters",
		"outputOptions",
		"mimeType"
	], d);
	let f = _(e, ["outputCompressionQuality"]);
	t !== void 0 && f != null && g(t, [
		"parameters",
		"outputOptions",
		"compressionQuality"
	], f);
	let p = _(e, ["enhancePrompt"]);
	t !== void 0 && p != null && g(t, ["parameters", "enhancePrompt"], p);
	let m = _(e, ["labels"]);
	return t !== void 0 && m != null && g(t, ["labels"], m), r;
}
function Ao(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["source"]);
	a != null && Mo(a, r);
	let o = _(t, ["config"]);
	return o != null && ko(o, r), r;
}
function jo(e, t) {
	let n = {}, r = _(e, ["predictions"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => no(e))), g(n, ["generatedImages"], e);
	}
	return n;
}
function Mo(e, t, n) {
	let r = {}, i = _(e, ["prompt"]);
	t !== void 0 && i != null && g(t, ["instances[0]", "prompt"], i);
	let a = _(e, ["personImage"]);
	t !== void 0 && a != null && g(t, [
		"instances[0]",
		"personImage",
		"image"
	], q(a));
	let o = _(e, ["productImages"]);
	if (t !== void 0 && o != null) {
		let e = o;
		Array.isArray(e) && (e = e.map((e) => Oo(e))), g(t, ["instances[0]", "productImages"], e);
	}
	return r;
}
function No(e, t) {
	let n = {}, r = _(e, ["referenceImage"]);
	r != null && g(n, ["referenceImage"], q(r));
	let i = _(e, ["referenceId"]);
	i != null && g(n, ["referenceId"], i);
	let a = _(e, ["referenceType"]);
	a != null && g(n, ["referenceType"], a);
	let o = _(e, ["maskImageConfig"]);
	o != null && g(n, ["maskImageConfig"], Co(o));
	let s = _(e, ["controlImageConfig"]);
	s != null && g(n, ["controlImageConfig"], ca(s));
	let c = _(e, ["styleImageConfig"]);
	c != null && g(n, ["styleImageConfig"], c);
	let l = _(e, ["subjectImageConfig"]);
	return l != null && g(n, ["subjectImageConfig"], l), n;
}
function Po(e, t) {
	let n = {}, r = _(e, ["safetyAttributes", "categories"]);
	r != null && g(n, ["categories"], r);
	let i = _(e, ["safetyAttributes", "scores"]);
	i != null && g(n, ["scores"], i);
	let a = _(e, ["contentType"]);
	return a != null && g(n, ["contentType"], a), n;
}
function Fo(e, t) {
	let n = {}, r = _(e, ["safetyAttributes", "categories"]);
	r != null && g(n, ["categories"], r);
	let i = _(e, ["safetyAttributes", "scores"]);
	i != null && g(n, ["scores"], i);
	let a = _(e, ["contentType"]);
	return a != null && g(n, ["contentType"], a), n;
}
function Io(e, t) {
	let n = {}, r = _(e, ["category"]);
	if (r != null && g(n, ["category"], r), _(e, ["method"]) !== void 0) throw Error("method parameter is not supported in Gemini API.");
	let i = _(e, ["threshold"]);
	return i != null && g(n, ["threshold"], i), n;
}
function Lo(e, t) {
	let n = {}, r = _(e, ["image"]);
	return r != null && g(n, ["image"], q(r)), n;
}
function Ro(e, t, n) {
	let r = {}, i = _(e, ["mode"]);
	t !== void 0 && i != null && g(t, ["parameters", "mode"], i);
	let a = _(e, ["maxPredictions"]);
	t !== void 0 && a != null && g(t, ["parameters", "maxPredictions"], a);
	let o = _(e, ["confidenceThreshold"]);
	t !== void 0 && o != null && g(t, ["parameters", "confidenceThreshold"], o);
	let s = _(e, ["maskDilation"]);
	t !== void 0 && s != null && g(t, ["parameters", "maskDilation"], s);
	let c = _(e, ["binaryColorThreshold"]);
	t !== void 0 && c != null && g(t, ["parameters", "binaryColorThreshold"], c);
	let l = _(e, ["labels"]);
	return t !== void 0 && l != null && g(t, ["labels"], l), r;
}
function zo(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["source"]);
	a != null && Vo(a, r);
	let o = _(t, ["config"]);
	return o != null && Ro(o, r), r;
}
function Bo(e, t) {
	let n = {}, r = _(e, ["predictions"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => ro(e))), g(n, ["generatedMasks"], e);
	}
	return n;
}
function Vo(e, t, n) {
	let r = {}, i = _(e, ["prompt"]);
	t !== void 0 && i != null && g(t, ["instances[0]", "prompt"], i);
	let a = _(e, ["image"]);
	t !== void 0 && a != null && g(t, ["instances[0]", "image"], q(a));
	let o = _(e, ["scribbleImage"]);
	return t !== void 0 && o != null && g(t, ["instances[0]", "scribble"], Lo(o)), r;
}
function Ho(e, t) {
	let n = {}, r = _(e, ["retrievalConfig"]);
	r != null && g(n, ["retrievalConfig"], r);
	let i = _(e, ["functionCallingConfig"]);
	i != null && g(n, ["functionCallingConfig"], ja(i));
	let a = _(e, ["includeServerSideToolInvocations"]);
	return a != null && g(n, ["includeServerSideToolInvocations"], a), n;
}
function Uo(e, t) {
	let n = {}, r = _(e, ["retrievalConfig"]);
	r != null && g(n, ["retrievalConfig"], r);
	let i = _(e, ["functionCallingConfig"]);
	if (i != null && g(n, ["functionCallingConfig"], i), _(e, ["includeServerSideToolInvocations"]) !== void 0) throw Error("includeServerSideToolInvocations parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return n;
}
function Wo(e, t) {
	let n = {};
	if (_(e, ["retrieval"]) !== void 0) throw Error("retrieval parameter is not supported in Gemini API.");
	let r = _(e, ["computerUse"]);
	r != null && g(n, ["computerUse"], r);
	let i = _(e, ["fileSearch"]);
	i != null && g(n, ["fileSearch"], i);
	let a = _(e, ["googleSearch"]);
	a != null && g(n, ["googleSearch"], uo(a));
	let o = _(e, ["googleMaps"]);
	o != null && g(n, ["googleMaps"], lo(o));
	let s = _(e, ["codeExecution"]);
	if (s != null && g(n, ["codeExecution"], s), _(e, ["enterpriseWebSearch"]) !== void 0) throw Error("enterpriseWebSearch parameter is not supported in Gemini API.");
	let c = _(e, ["functionDeclarations"]);
	if (c != null) {
		let e = c;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["functionDeclarations"], e);
	}
	let l = _(e, ["googleSearchRetrieval"]);
	if (l != null && g(n, ["googleSearchRetrieval"], l), _(e, ["parallelAiSearch"]) !== void 0) throw Error("parallelAiSearch parameter is not supported in Gemini API.");
	let u = _(e, ["urlContext"]);
	u != null && g(n, ["urlContext"], u);
	let d = _(e, ["mcpServers"]);
	if (d != null) {
		let e = d;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["mcpServers"], e);
	}
	return n;
}
function Go(e, t) {
	let n = {}, r = _(e, ["retrieval"]);
	r != null && g(n, ["retrieval"], r);
	let i = _(e, ["computerUse"]);
	if (i != null && g(n, ["computerUse"], i), _(e, ["fileSearch"]) !== void 0) throw Error("fileSearch parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	let a = _(e, ["googleSearch"]);
	a != null && g(n, ["googleSearch"], a);
	let o = _(e, ["googleMaps"]);
	o != null && g(n, ["googleMaps"], o);
	let s = _(e, ["codeExecution"]);
	s != null && g(n, ["codeExecution"], s);
	let c = _(e, ["enterpriseWebSearch"]);
	c != null && g(n, ["enterpriseWebSearch"], c);
	let l = _(e, ["functionDeclarations"]);
	if (l != null) {
		let e = l;
		Array.isArray(e) && (e = e.map((e) => Ma(e))), g(n, ["functionDeclarations"], e);
	}
	let u = _(e, ["googleSearchRetrieval"]);
	u != null && g(n, ["googleSearchRetrieval"], u);
	let d = _(e, ["parallelAiSearch"]);
	d != null && g(n, ["parallelAiSearch"], d);
	let f = _(e, ["urlContext"]);
	if (f != null && g(n, ["urlContext"], f), _(e, ["mcpServers"]) !== void 0) throw Error("mcpServers parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return n;
}
function Ko(e, t) {
	let n = {}, r = _(e, ["baseModel"]);
	r != null && g(n, ["baseModel"], r);
	let i = _(e, ["createTime"]);
	i != null && g(n, ["createTime"], i);
	let a = _(e, ["updateTime"]);
	return a != null && g(n, ["updateTime"], a), n;
}
function qo(e, t) {
	let n = {}, r = _(e, ["labels", "google-vertex-llm-tuning-base-model-id"]);
	r != null && g(n, ["baseModel"], r);
	let i = _(e, ["createTime"]);
	i != null && g(n, ["createTime"], i);
	let a = _(e, ["updateTime"]);
	return a != null && g(n, ["updateTime"], a), n;
}
function Jo(e, t, n) {
	let r = {}, i = _(e, ["displayName"]);
	t !== void 0 && i != null && g(t, ["displayName"], i);
	let a = _(e, ["description"]);
	t !== void 0 && a != null && g(t, ["description"], a);
	let o = _(e, ["defaultCheckpointId"]);
	return t !== void 0 && o != null && g(t, ["defaultCheckpointId"], o), r;
}
function Yo(e, t, n) {
	let r = {}, i = _(e, ["displayName"]);
	t !== void 0 && i != null && g(t, ["displayName"], i);
	let a = _(e, ["description"]);
	t !== void 0 && a != null && g(t, ["description"], a);
	let o = _(e, ["defaultCheckpointId"]);
	return t !== void 0 && o != null && g(t, ["defaultCheckpointId"], o), r;
}
function Xo(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "name"], F(e, i));
	let a = _(t, ["config"]);
	return a != null && Jo(a, r), r;
}
function Zo(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["config"]);
	return a != null && Yo(a, r), r;
}
function Qo(e, t, n) {
	let r = {}, i = _(e, ["outputGcsUri"]);
	t !== void 0 && i != null && g(t, ["parameters", "storageUri"], i);
	let a = _(e, ["safetyFilterLevel"]);
	t !== void 0 && a != null && g(t, ["parameters", "safetySetting"], a);
	let o = _(e, ["personGeneration"]);
	t !== void 0 && o != null && g(t, ["parameters", "personGeneration"], o);
	let s = _(e, ["includeRaiReason"]);
	t !== void 0 && s != null && g(t, ["parameters", "includeRaiReason"], s);
	let c = _(e, ["outputMimeType"]);
	t !== void 0 && c != null && g(t, [
		"parameters",
		"outputOptions",
		"mimeType"
	], c);
	let l = _(e, ["outputCompressionQuality"]);
	t !== void 0 && l != null && g(t, [
		"parameters",
		"outputOptions",
		"compressionQuality"
	], l);
	let u = _(e, ["enhanceInputImage"]);
	t !== void 0 && u != null && g(t, [
		"parameters",
		"upscaleConfig",
		"enhanceInputImage"
	], u);
	let d = _(e, ["imagePreservationFactor"]);
	t !== void 0 && d != null && g(t, [
		"parameters",
		"upscaleConfig",
		"imagePreservationFactor"
	], d);
	let f = _(e, ["labels"]);
	t !== void 0 && f != null && g(t, ["labels"], f);
	let p = _(e, ["numberOfImages"]);
	t !== void 0 && p != null && g(t, ["parameters", "sampleCount"], p);
	let m = _(e, ["mode"]);
	return t !== void 0 && m != null && g(t, ["parameters", "mode"], m), r;
}
function $o(e, t, n) {
	let r = {}, i = _(t, ["model"]);
	i != null && g(r, ["_url", "model"], F(e, i));
	let a = _(t, ["image"]);
	a != null && g(r, ["instances[0]", "image"], q(a));
	let o = _(t, ["upscaleFactor"]);
	o != null && g(r, [
		"parameters",
		"upscaleConfig",
		"upscaleFactor"
	], o);
	let s = _(t, ["config"]);
	return s != null && Qo(s, r), r;
}
function es(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["predictions"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => no(e))), g(n, ["generatedImages"], e);
	}
	return n;
}
function ts(e, t) {
	let n = {}, r = _(e, ["uri"]);
	r != null && g(n, ["uri"], r);
	let i = _(e, ["encodedVideo"]);
	i != null && g(n, ["videoBytes"], B(i));
	let a = _(e, ["encoding"]);
	return a != null && g(n, ["mimeType"], a), n;
}
function ns(e, t) {
	let n = {}, r = _(e, ["gcsUri"]);
	r != null && g(n, ["uri"], r);
	let i = _(e, ["bytesBase64Encoded"]);
	i != null && g(n, ["videoBytes"], B(i));
	let a = _(e, ["mimeType"]);
	return a != null && g(n, ["mimeType"], a), n;
}
function rs(e, t) {
	let n = {}, r = _(e, ["image"]);
	r != null && g(n, ["_self"], q(r));
	let i = _(e, ["maskMode"]);
	return i != null && g(n, ["maskMode"], i), n;
}
function is(e, t) {
	let n = {}, r = _(e, ["image"]);
	r != null && g(n, ["image"], go(r));
	let i = _(e, ["referenceType"]);
	return i != null && g(n, ["referenceType"], i), n;
}
function as(e, t) {
	let n = {}, r = _(e, ["image"]);
	r != null && g(n, ["image"], q(r));
	let i = _(e, ["referenceType"]);
	return i != null && g(n, ["referenceType"], i), n;
}
function os(e, t) {
	let n = {}, r = _(e, ["uri"]);
	r != null && g(n, ["uri"], r);
	let i = _(e, ["videoBytes"]);
	i != null && g(n, ["encodedVideo"], B(i));
	let a = _(e, ["mimeType"]);
	return a != null && g(n, ["encoding"], a), n;
}
function ss(e, t) {
	let n = {}, r = _(e, ["uri"]);
	r != null && g(n, ["gcsUri"], r);
	let i = _(e, ["videoBytes"]);
	i != null && g(n, ["bytesBase64Encoded"], B(i));
	let a = _(e, ["mimeType"]);
	return a != null && g(n, ["mimeType"], a), n;
}
function cs(e, t, n) {
	let r = {}, i = _(t, ["displayName"]);
	n !== void 0 && i != null && g(n, ["displayName"], i);
	let a = _(t, ["embeddingModel"]);
	return n !== void 0 && a != null && g(n, ["embeddingModel"], F(e, a)), r;
}
function ls(e, t) {
	let n = {}, r = _(t, ["config"]);
	return r != null && cs(e, r, n), n;
}
function us(e, t) {
	let n = {}, r = _(e, ["force"]);
	return t !== void 0 && r != null && g(t, ["_query", "force"], r), n;
}
function ds(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["_url", "name"], n);
	let r = _(e, ["config"]);
	return r != null && us(r, t), t;
}
function fs(e) {
	let t = {}, n = _(e, ["name"]);
	return n != null && g(t, ["_url", "name"], n), t;
}
function ps(e, t) {
	let n = {}, r = _(e, ["customMetadata"]);
	if (t !== void 0 && r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["customMetadata"], e);
	}
	let i = _(e, ["chunkingConfig"]);
	return t !== void 0 && i != null && g(t, ["chunkingConfig"], i), n;
}
function ms(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["name"], n);
	let r = _(e, ["metadata"]);
	r != null && g(t, ["metadata"], r);
	let i = _(e, ["done"]);
	i != null && g(t, ["done"], i);
	let a = _(e, ["error"]);
	a != null && g(t, ["error"], a);
	let o = _(e, ["response"]);
	return o != null && g(t, ["response"], gs(o)), t;
}
function hs(e) {
	let t = {}, n = _(e, ["fileSearchStoreName"]);
	n != null && g(t, ["_url", "file_search_store_name"], n);
	let r = _(e, ["fileName"]);
	r != null && g(t, ["fileName"], r);
	let i = _(e, ["config"]);
	return i != null && ps(i, t), t;
}
function gs(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["parent"]);
	r != null && g(t, ["parent"], r);
	let i = _(e, ["documentName"]);
	return i != null && g(t, ["documentName"], i), t;
}
function _s(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	return t !== void 0 && i != null && g(t, ["_query", "pageToken"], i), n;
}
function vs(e) {
	let t = {}, n = _(e, ["config"]);
	return n != null && _s(n, t), t;
}
function ys(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["fileSearchStores"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["fileSearchStores"], e);
	}
	return t;
}
function bs(e, t) {
	let n = {}, r = _(e, ["mimeType"]);
	t !== void 0 && r != null && g(t, ["mimeType"], r);
	let i = _(e, ["displayName"]);
	t !== void 0 && i != null && g(t, ["displayName"], i);
	let a = _(e, ["customMetadata"]);
	if (t !== void 0 && a != null) {
		let e = a;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["customMetadata"], e);
	}
	let o = _(e, ["chunkingConfig"]);
	return t !== void 0 && o != null && g(t, ["chunkingConfig"], o), n;
}
function xs(e) {
	let t = {}, n = _(e, ["fileSearchStoreName"]);
	n != null && g(t, ["_url", "file_search_store_name"], n);
	let r = _(e, ["config"]);
	return r != null && bs(r, t), t;
}
function Ss(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	return n != null && g(t, ["sdkHttpResponse"], n), t;
}
var Cs = "Content-Type", ws = "X-Server-Timeout", Ts = "User-Agent", Es = "x-goog-api-client", Ds = "google-genai-sdk/1.52.0", Os = "v1beta1", ks = "v1beta", As = /* @__PURE__ */ new Set(["us", "eu"]), js = 5, Ms = [
	408,
	429,
	500,
	502,
	503,
	504
], Ns = class {
	constructor(e) {
		this.clientOptions = Object.assign({}, e), this.customBaseUrl = e.httpOptions?.baseUrl, this.clientOptions.vertexai && (this.clientOptions.project && this.clientOptions.location ? this.clientOptions.apiKey = void 0 : this.clientOptions.apiKey && (this.clientOptions.project = void 0, this.clientOptions.location = void 0));
		let t = {};
		if (this.clientOptions.vertexai) {
			if (!this.clientOptions.location && !this.clientOptions.apiKey && !this.customBaseUrl && (this.clientOptions.location = "global"), !(this.clientOptions.project && this.clientOptions.location || this.clientOptions.apiKey) && !this.customBaseUrl) throw Error("Authentication is not set up. Please provide either a project and location, or an API key, or a custom base URL.");
			let n = e.project && e.location || !!e.apiKey;
			this.customBaseUrl && !n ? (t.baseUrl = this.customBaseUrl, this.clientOptions.project = void 0, this.clientOptions.location = void 0) : this.clientOptions.apiKey || this.clientOptions.location === "global" ? t.baseUrl = "https://aiplatform.googleapis.com/" : this.clientOptions.project && this.clientOptions.location && As.has(this.clientOptions.location) ? t.baseUrl = `https://aiplatform.${this.clientOptions.location}.rep.googleapis.com/` : this.clientOptions.project && this.clientOptions.location && (t.baseUrl = `https://${this.clientOptions.location}-aiplatform.googleapis.com/`), t.apiVersion = this.clientOptions.apiVersion ?? Os;
		} else this.clientOptions.apiKey || console.warn("API key should be set when using the Gemini API."), t.apiVersion = this.clientOptions.apiVersion ?? ks, t.baseUrl = "https://generativelanguage.googleapis.com/";
		t.headers = this.getDefaultHeaders(), this.clientOptions.httpOptions = t, e.httpOptions && (this.clientOptions.httpOptions = this.patchHttpOptions(t, e.httpOptions));
	}
	isVertexAI() {
		return this.clientOptions.vertexai ?? !1;
	}
	getProject() {
		return this.clientOptions.project;
	}
	getLocation() {
		return this.clientOptions.location;
	}
	getCustomBaseUrl() {
		return this.customBaseUrl;
	}
	async getAuthHeaders() {
		let e = new Headers();
		return await this.clientOptions.auth.addAuthHeaders(e), e;
	}
	getApiVersion() {
		if (this.clientOptions.httpOptions && this.clientOptions.httpOptions.apiVersion !== void 0) return this.clientOptions.httpOptions.apiVersion;
		throw Error("API version is not set.");
	}
	getBaseUrl() {
		if (this.clientOptions.httpOptions && this.clientOptions.httpOptions.baseUrl !== void 0) return this.clientOptions.httpOptions.baseUrl;
		throw Error("Base URL is not set.");
	}
	getRequestUrl() {
		return this.getRequestUrlInternal(this.clientOptions.httpOptions);
	}
	getHeaders() {
		if (this.clientOptions.httpOptions && this.clientOptions.httpOptions.headers !== void 0) return this.clientOptions.httpOptions.headers;
		throw Error("Headers are not set.");
	}
	getRequestUrlInternal(e) {
		if (!e || e.baseUrl === void 0 || e.apiVersion === void 0) throw Error("HTTP options are not correctly set.");
		let t = [e.baseUrl.endsWith("/") ? e.baseUrl.slice(0, -1) : e.baseUrl];
		return e.apiVersion && e.apiVersion !== "" && t.push(e.apiVersion), t.join("/");
	}
	getBaseResourcePath() {
		return `projects/${this.clientOptions.project}/locations/${this.clientOptions.location}`;
	}
	getApiKey() {
		return this.clientOptions.apiKey;
	}
	getWebsocketBaseUrl() {
		let e = this.getBaseUrl(), t = new URL(e);
		return t.protocol = t.protocol == "http:" ? "ws" : "wss", t.toString();
	}
	setBaseUrl(e) {
		if (this.clientOptions.httpOptions) this.clientOptions.httpOptions.baseUrl = e;
		else throw Error("HTTP options are not correctly set.");
	}
	constructUrl(e, t, n) {
		let r = [this.getRequestUrlInternal(t)];
		return n && r.push(this.getBaseResourcePath()), e !== "" && r.push(e), new URL(`${r.join("/")}`);
	}
	shouldPrependVertexProjectPath(e, t) {
		return !(t.baseUrl && t.baseUrlResourceScope === Re.COLLECTION || this.clientOptions.apiKey || !this.clientOptions.vertexai || e.path.startsWith("projects/") || e.httpMethod === "GET" && e.path.startsWith("publishers/google/models"));
	}
	async request(e) {
		let t = this.clientOptions.httpOptions;
		e.httpOptions && (t = this.patchHttpOptions(this.clientOptions.httpOptions, e.httpOptions));
		let n = this.shouldPrependVertexProjectPath(e, t), r = this.constructUrl(e.path, t, n);
		if (e.queryParams) for (let [t, n] of Object.entries(e.queryParams)) r.searchParams.append(t, String(n));
		let i = {};
		if (e.httpMethod === "GET") {
			if (e.body && e.body !== "{}") throw Error("Request body should be empty for GET request, but got non empty request body");
		} else i.body = e.body;
		return i = await this.includeExtraHttpOptionsToRequestInit(i, t, r.toString(), e.abortSignal), this.unaryApiCall(r, i, e.httpMethod);
	}
	patchHttpOptions(e, t) {
		let n = JSON.parse(JSON.stringify(e));
		for (let [e, r] of Object.entries(t)) typeof r == "object" ? n[e] = Object.assign(Object.assign({}, n[e]), r) : r !== void 0 && (n[e] = r);
		return n;
	}
	async requestStream(e) {
		let t = this.clientOptions.httpOptions;
		e.httpOptions && (t = this.patchHttpOptions(this.clientOptions.httpOptions, e.httpOptions));
		let n = this.shouldPrependVertexProjectPath(e, t), r = this.constructUrl(e.path, t, n);
		(!r.searchParams.has("alt") || r.searchParams.get("alt") !== "sse") && r.searchParams.set("alt", "sse");
		let i = {};
		return i.body = e.body, i = await this.includeExtraHttpOptionsToRequestInit(i, t, r.toString(), e.abortSignal), this.streamApiCall(r, i, e.httpMethod);
	}
	async includeExtraHttpOptionsToRequestInit(e, t, n, r) {
		if (t && t.timeout || r) {
			let n = new AbortController(), i = n.signal;
			if (t.timeout && t?.timeout > 0) {
				let e = setTimeout(() => n.abort(), t.timeout);
				e && typeof e.unref == "function" && e.unref();
			}
			r && r.addEventListener("abort", () => {
				n.abort();
			}), e.signal = i;
		}
		return t && t.extraBody !== null && Fs(e, t.extraBody), e.headers = await this.getHeadersInternal(t, n), e;
	}
	async unaryApiCall(e, t, n) {
		return this.apiCall(e.toString(), Object.assign(Object.assign({}, t), { method: n })).then(async (e) => (await Ps(e), new pt(e))).catch((e) => {
			throw e instanceof Error ? e : Error(JSON.stringify(e));
		});
	}
	async streamApiCall(e, t, n) {
		return this.apiCall(e.toString(), Object.assign(Object.assign({}, t), { method: n })).then(async (e) => (await Ps(e), this.processStreamResponse(e))).catch((e) => {
			throw e instanceof Error ? e : Error(JSON.stringify(e));
		});
	}
	processStreamResponse(e) {
		return G(this, arguments, function* () {
			let t = (e?.body)?.getReader(), n = new TextDecoder("utf-8");
			if (!t) throw Error("Response body is empty");
			try {
				let r = "", i = [
					"\n\n",
					"\r\r",
					"\r\n\r\n"
				];
				for (;;) {
					let { done: a, value: o } = yield W(t.read());
					if (a) {
						if (r.trim().length > 0) throw Error("Incomplete JSON segment at the end");
						break;
					}
					let s = n.decode(o, { stream: !0 });
					try {
						let e = JSON.parse(s);
						if ("error" in e) {
							let t = JSON.parse(JSON.stringify(e.error)), n = t.status, r = t.code, i = `got status: ${n}. ${JSON.stringify(e)}`;
							if (r >= 400 && r < 600) throw new fi({
								message: i,
								status: r
							});
						}
					} catch (e) {
						if (e.name === "ApiError") throw e;
					}
					r += s;
					let c = -1, l = 0;
					for (;;) {
						c = -1, l = 0;
						for (let e of i) {
							let t = r.indexOf(e);
							t !== -1 && (c === -1 || t < c) && (c = t, l = e.length);
						}
						if (c === -1) break;
						let t = r.substring(0, c);
						r = r.substring(c + l);
						let n = t.trim();
						if (n.startsWith("data:")) {
							let t = n.substring(5).trim();
							try {
								yield yield W(new pt(new Response(t, {
									headers: e?.headers,
									status: e?.status,
									statusText: e?.statusText
								})));
							} catch (e) {
								throw Error(`exception parsing stream chunk ${t}. ${e}`);
							}
						}
					}
				}
			} finally {
				t.releaseLock();
			}
		});
	}
	async apiCall(e, t) {
		if (!this.clientOptions.httpOptions || !this.clientOptions.httpOptions.retryOptions) return fetch(e, t);
		let n = this.clientOptions.httpOptions.retryOptions;
		return (0, l.default)(async () => {
			let n = await fetch(e, t);
			if (n.ok) return n;
			throw Ms.includes(n.status) ? Error(`Retryable HTTP Error: ${n.statusText}`) : new l.AbortError(`Non-retryable exception ${n.statusText} sending request`);
		}, { retries: (n.attempts ?? js) - 1 });
	}
	getDefaultHeaders() {
		let e = {}, t = Ds + " " + this.clientOptions.userAgentExtra;
		return e[Ts] = t, e[Es] = t, e[Cs] = "application/json", e;
	}
	async getHeadersInternal(e, t) {
		let n = new Headers();
		if (e && e.headers) {
			for (let [t, r] of Object.entries(e.headers)) n.append(t, r);
			e.timeout && e.timeout > 0 && n.append(ws, String(Math.ceil(e.timeout / 1e3)));
		}
		return await this.clientOptions.auth.addAuthHeaders(n, t), n;
	}
	getFileName(e) {
		let t = "";
		return typeof e == "string" && (t = e.replace(/[/\\]+$/, ""), t = t.split(/[/\\]/).pop() ?? ""), t;
	}
	async uploadFile(e, t) {
		let n = {};
		t != null && (n.mimeType = t.mimeType, n.name = t.name, n.displayName = t.displayName), n.name && !n.name.startsWith("files/") && (n.name = `files/${n.name}`);
		let r = this.clientOptions.uploader, i = await r.stat(e);
		n.sizeBytes = String(i.size);
		let a = t?.mimeType ?? i.type;
		if (a === void 0 || a === "") throw Error("Can not determine mimeType. Please provide mimeType in the config.");
		n.mimeType = a;
		let o = { file: n }, s = this.getFileName(e), c = h("upload/v1beta/files", o._url), l = await this.fetchUploadUrl(c, n.sizeBytes, n.mimeType, s, o, t?.httpOptions);
		return r.upload(e, l, this);
	}
	async uploadFileToFileSearchStore(e, t, n) {
		let r = this.clientOptions.uploader, i = await r.stat(t), a = String(i.size), o = n?.mimeType ?? i.type;
		if (o === void 0 || o === "") throw Error("Can not determine mimeType. Please provide mimeType in the config.");
		let s = `upload/v1beta/${e}:uploadToFileSearchStore`, c = this.getFileName(t), l = {};
		n != null && bs(n, l);
		let u = await this.fetchUploadUrl(s, a, o, c, l, n?.httpOptions);
		return r.uploadToFileSearchStore(t, u, this);
	}
	async downloadFile(e) {
		await this.clientOptions.downloader.download(e, this);
	}
	async fetchUploadUrl(e, t, n, r, i, a) {
		let o = {};
		o = a || {
			apiVersion: "",
			headers: Object.assign({
				"Content-Type": "application/json",
				"X-Goog-Upload-Protocol": "resumable",
				"X-Goog-Upload-Command": "start",
				"X-Goog-Upload-Header-Content-Length": `${t}`,
				"X-Goog-Upload-Header-Content-Type": `${n}`
			}, r ? { "X-Goog-Upload-File-Name": r } : {})
		};
		let s = await this.request({
			path: e,
			body: JSON.stringify(i),
			httpMethod: "POST",
			httpOptions: o
		});
		if (!s || !s?.headers) throw Error("Server did not return an HttpResponse or the returned HttpResponse did not have headers.");
		let c = s?.headers?.["x-goog-upload-url"];
		if (c === void 0) throw Error("Failed to get upload url. Server did not return the x-google-upload-url in the headers");
		return c;
	}
};
async function Ps(e) {
	if (e === void 0) throw Error("response is undefined");
	if (!e.ok) {
		let t = e.status, n;
		n = e.headers.get("content-type")?.includes("application/json") ? await e.json() : { error: {
			message: await e.text(),
			code: e.status,
			status: e.statusText
		} };
		let r = JSON.stringify(n);
		throw t >= 400 && t < 600 ? new fi({
			message: r,
			status: t
		}) : Error(r);
	}
}
function Fs(e, t) {
	if (!t || Object.keys(t).length === 0) return;
	if (e.body instanceof Blob) {
		console.warn("includeExtraBodyToRequestInit: extraBody provided but current request body is a Blob. extraBody will be ignored as merging is not supported for Blob bodies.");
		return;
	}
	let n = {};
	if (typeof e.body == "string" && e.body.length > 0) try {
		let t = JSON.parse(e.body);
		if (typeof t == "object" && t && !Array.isArray(t)) n = t;
		else {
			console.warn("includeExtraBodyToRequestInit: Original request body is valid JSON but not a non-array object. Skip applying extraBody to the request body.");
			return;
		}
	} catch {
		console.warn("includeExtraBodyToRequestInit: Original request body is not valid JSON. Skip applying extraBody to the request body.");
		return;
	}
	function r(e, t) {
		let n = Object.assign({}, e);
		for (let e in t) if (Object.prototype.hasOwnProperty.call(t, e)) {
			let i = t[e], a = n[e];
			i && typeof i == "object" && !Array.isArray(i) && a && typeof a == "object" && !Array.isArray(a) ? n[e] = r(a, i) : (a && i && typeof a != typeof i && console.warn(`includeExtraBodyToRequestInit:deepMerge: Type mismatch for key "${e}". Original type: ${typeof a}, New type: ${typeof i}. Overwriting.`), n[e] = i);
		}
		return n;
	}
	let i = r(n, t);
	e.body = JSON.stringify(i);
}
var Is = "mcp_used/unknown", Ls = !1;
function Rs(e) {
	for (let t of e) if (Bs(t) || typeof t == "object" && "inputSchema" in t) return !0;
	return Ls;
}
function zs(e) {
	e[Es] = ((e[Es] ?? "") + ` ${Is}`).trimStart();
}
function Bs(e) {
	return typeof e == "object" && !!e && e instanceof Hs;
}
function Vs(e) {
	return G(this, arguments, function* (e, t = 100) {
		let n, r = 0;
		for (; r < t;) {
			let t = yield W(e.listTools({ cursor: n }));
			for (let e of t.tools) yield yield W(e), r++;
			if (!t.nextCursor) break;
			n = t.nextCursor;
		}
	});
}
var Hs = class e {
	constructor(e = [], t) {
		this.mcpTools = [], this.functionNameToMcpClient = {}, this.mcpClients = e, this.config = t;
	}
	static create(t, n) {
		return new e(t, n);
	}
	async initialize() {
		var e, t, n, r;
		if (this.mcpTools.length > 0) return;
		let i = {}, a = [];
		for (let l of this.mcpClients) try {
			for (var o = !0, s = (t = void 0, K(Vs(l))), c; c = await s.next(), e = c.done, !e; o = !0) {
				r = c.value, o = !1;
				let e = r;
				a.push(e);
				let t = e.name;
				if (i[t]) throw Error(`Duplicate function name ${t} found in MCP tools. Please ensure function names are unique.`);
				i[t] = l;
			}
		} catch (e) {
			t = { error: e };
		} finally {
			try {
				!o && !e && (n = s.return) && await n.call(s);
			} finally {
				if (t) throw t.error;
			}
		}
		this.mcpTools = a, this.functionNameToMcpClient = i;
	}
	async tool() {
		return await this.initialize(), gn(this.mcpTools, this.config);
	}
	async callTool(e) {
		await this.initialize();
		let t = [];
		for (let n of e) if (n.name in this.functionNameToMcpClient) {
			let e = this.functionNameToMcpClient[n.name], r;
			this.config.timeout && (r = { timeout: this.config.timeout });
			let i = await e.callTool({
				name: n.name,
				arguments: n.args
			}, void 0, r);
			t.push({ functionResponse: {
				name: n.name,
				response: i.isError ? { error: i } : i
			} });
		}
		return t;
	}
};
async function Us(e, t, n) {
	let r = new Bt(), i;
	i = n.data instanceof Blob ? JSON.parse(await n.data.text()) : JSON.parse(n.data), Object.assign(r, i), t(r);
}
var Ws = class {
	constructor(e, t, n) {
		this.apiClient = e, this.auth = t, this.webSocketFactory = n;
	}
	async connect(e) {
		if (this.apiClient.isVertexAI()) throw Error("Live music is not supported for Vertex AI.");
		console.warn("Live music generation is experimental and may change in future versions.");
		let t = this.apiClient.getWebsocketBaseUrl(), n = this.apiClient.getApiVersion(), r = qs(this.apiClient.getDefaultHeaders()), i = `${t}/ws/google.ai.generativelanguage.${n}.GenerativeService.BidiGenerateMusic?key=${this.apiClient.getApiKey()}`, a = () => {}, o = new Promise((e) => {
			a = e;
		}), s = e.callbacks, c = function() {
			a({});
		}, l = this.apiClient, u = {
			onopen: c,
			onmessage: (e) => {
				Us(l, s.onmessage, e);
			},
			onerror: s?.onerror ?? function(e) {},
			onclose: s?.onclose ?? function(e) {}
		}, d = this.webSocketFactory.create(i, Ks(r), u);
		d.connect(), await o;
		let f = { setup: { model: F(this.apiClient, e.model) } };
		return d.send(JSON.stringify(f)), new Gs(d, this.apiClient);
	}
}, Gs = class {
	constructor(e, t) {
		this.conn = e, this.apiClient = t;
	}
	async setWeightedPrompts(e) {
		if (!e.weightedPrompts || Object.keys(e.weightedPrompts).length === 0) throw Error("Weighted prompts must be set and contain at least one entry.");
		let t = Bi(e);
		this.conn.send(JSON.stringify({ clientContent: t }));
	}
	async setMusicGenerationConfig(e) {
		e.musicGenerationConfig ||= {};
		let t = zi(e);
		this.conn.send(JSON.stringify(t));
	}
	sendPlaybackControl(e) {
		let t = { playbackControl: e };
		this.conn.send(JSON.stringify(t));
	}
	play() {
		this.sendPlaybackControl(ft.PLAY);
	}
	pause() {
		this.sendPlaybackControl(ft.PAUSE);
	}
	stop() {
		this.sendPlaybackControl(ft.STOP);
	}
	resetContext() {
		this.sendPlaybackControl(ft.RESET_CONTEXT);
	}
	close() {
		this.conn.close();
	}
};
function Ks(e) {
	let t = {};
	return e.forEach((e, n) => {
		t[n] = e;
	}), t;
}
function qs(e) {
	let t = new Headers();
	for (let [n, r] of Object.entries(e)) t.append(n, r);
	return t;
}
var Js = "FunctionResponse request must have an `id` field from the response of a ToolCall.FunctionalCalls in Google AI.";
async function Ys(e, t, n) {
	let r = new zt(), i;
	i = n.data instanceof Blob ? await n.data.text() : n.data instanceof ArrayBuffer ? new TextDecoder().decode(n.data) : n.data;
	let a = JSON.parse(i);
	if (e.isVertexAI()) {
		let e = Ui(a);
		Object.assign(r, e);
	} else Object.assign(r, a);
	t(r);
}
var Xs = class {
	constructor(e, t, n) {
		this.apiClient = e, this.auth = t, this.webSocketFactory = n, this.music = new Ws(this.apiClient, this.auth, this.webSocketFactory);
	}
	async connect(e) {
		if (e.config && e.config.httpOptions) throw Error("The Live module does not support httpOptions at request-level in LiveConnectConfig yet. Please use the client-level httpOptions configuration instead.");
		let t = this.apiClient.getWebsocketBaseUrl(), n = this.apiClient.getApiVersion(), r, i = this.apiClient.getHeaders();
		e.config && e.config.tools && Rs(e.config.tools) && zs(i);
		let a = ec(i);
		if (this.apiClient.isVertexAI()) {
			let e = this.apiClient.getProject(), i = this.apiClient.getLocation(), o = this.apiClient.getApiKey(), s = !!e && !!i || !!o;
			this.apiClient.getCustomBaseUrl() && !s ? r = t : (r = `${t}/ws/google.cloud.aiplatform.${n}.LlmBidiService/BidiGenerateContent`, await this.auth.addAuthHeaders(a, r));
		} else {
			let e = this.apiClient.getApiKey(), i = "BidiGenerateContent", a = "key";
			e?.startsWith("auth_tokens/") && (console.warn("Warning: Ephemeral token support is experimental and may change in future versions."), n !== "v1alpha" && console.warn("Warning: The SDK's ephemeral token support is in v1alpha only. Please use const ai = new GoogleGenAI({apiKey: token.name, httpOptions: { apiVersion: 'v1alpha' }}); before session connection."), i = "BidiGenerateContentConstrained", a = "access_token"), r = `${t}/ws/google.ai.generativelanguage.${n}.GenerativeService.${i}?${a}=${e}`;
		}
		let o = () => {}, s = new Promise((e) => {
			o = e;
		}), c = e.callbacks, l = function() {
			var e;
			(e = c?.onopen) == null || e.call(c), o({});
		}, u = this.apiClient, d = {
			onopen: l,
			onmessage: (e) => {
				Ys(u, c.onmessage, e);
			},
			onerror: c?.onerror ?? function(e) {},
			onclose: c?.onclose ?? function(e) {}
		}, f = this.webSocketFactory.create(r, $s(a), d);
		f.connect(), await s;
		let p = F(this.apiClient, e.model);
		if (this.apiClient.isVertexAI() && p.startsWith("publishers/")) {
			let e = this.apiClient.getProject(), t = this.apiClient.getLocation();
			e && t && (p = `projects/${e}/locations/${t}/` + p);
		}
		let m = {};
		this.apiClient.isVertexAI() && e.config?.responseModalities === void 0 && (e.config === void 0 ? e.config = { responseModalities: [Te.AUDIO] } : e.config.responseModalities = [Te.AUDIO]), e.config?.generationConfig && console.warn("Setting `LiveConnectConfig.generation_config` is deprecated, please set the fields on `LiveConnectConfig` directly. This will become an error in a future version (not before Q3 2025).");
		let h = e.config?.tools ?? [], g = [];
		for (let e of h) if (this.isCallableTool(e)) {
			let t = e;
			g.push(await t.tool());
		} else g.push(e);
		g.length > 0 && (e.config.tools = g);
		let _ = {
			model: p,
			config: e.config,
			callbacks: e.callbacks
		};
		return m = this.apiClient.isVertexAI() ? Ri(this.apiClient, _) : Li(this.apiClient, _), delete m.config, f.send(JSON.stringify(m)), new Qs(f, this.apiClient);
	}
	isCallableTool(e) {
		return "callTool" in e && typeof e.callTool == "function";
	}
}, Zs = { turnComplete: !0 }, Qs = class {
	constructor(e, t) {
		this.conn = e, this.apiClient = t;
	}
	tLiveClientContent(e, t) {
		if (t.turns !== null && t.turns !== void 0) {
			let n = [];
			try {
				n = L(t.turns), e.isVertexAI() || (n = n.map((e) => oa(e)));
			} catch {
				throw Error(`Failed to parse client content "turns", type: '${typeof t.turns}'`);
			}
			return { clientContent: {
				turns: n,
				turnComplete: t.turnComplete
			} };
		}
		return { clientContent: { turnComplete: t.turnComplete } };
	}
	tLiveClienttToolResponse(e, t) {
		let n = [];
		if (t.functionResponses == null || (n = Array.isArray(t.functionResponses) ? t.functionResponses : [t.functionResponses], n.length === 0)) throw Error("functionResponses is required.");
		for (let t of n) {
			if (typeof t != "object" || !t || !("name" in t) || !("response" in t)) throw Error(`Could not parse function response, type '${typeof t}'.`);
			if (!e.isVertexAI() && !("id" in t)) throw Error(Js);
		}
		return { toolResponse: { functionResponses: n } };
	}
	sendClientContent(e) {
		e = Object.assign(Object.assign({}, Zs), e);
		let t = this.tLiveClientContent(this.apiClient, e);
		this.conn.send(JSON.stringify(t));
	}
	sendRealtimeInput(e) {
		let t = {};
		t = this.apiClient.isVertexAI() ? { realtimeInput: Hi(e) } : { realtimeInput: Vi(e) }, this.conn.send(JSON.stringify(t));
	}
	sendToolResponse(e) {
		if (e.functionResponses == null) throw Error("Tool response parameters are required.");
		let t = this.tLiveClienttToolResponse(this.apiClient, e);
		this.conn.send(JSON.stringify(t));
	}
	close() {
		this.conn.close();
	}
};
function $s(e) {
	let t = {};
	return e.forEach((e, n) => {
		t[n] = e;
	}), t;
}
function ec(e) {
	let t = new Headers();
	for (let [n, r] of Object.entries(e)) t.append(n, r);
	return t;
}
var tc = 10;
function nc(e) {
	if (e?.automaticFunctionCalling?.disable) return !0;
	let t = !1;
	for (let n of e?.tools ?? []) if (rc(n)) {
		t = !0;
		break;
	}
	if (!t) return !0;
	let n = e?.automaticFunctionCalling?.maximumRemoteCalls;
	return n && (n < 0 || !Number.isInteger(n)) || n == 0 ? (console.warn("Invalid maximumRemoteCalls value provided for automatic function calling. Disabled automatic function calling. Please provide a valid integer value greater than 0. maximumRemoteCalls provided:", n), !0) : !1;
}
function rc(e) {
	return "callTool" in e && typeof e.callTool == "function";
}
function ic(e) {
	return (e.config?.tools)?.some((e) => rc(e)) ?? !1;
}
function ac(e) {
	let t = [];
	return e?.config?.tools && e.config.tools.forEach((e, n) => {
		if (rc(e)) return;
		let r = e;
		r.functionDeclarations && r.functionDeclarations.length > 0 && t.push(n);
	}), t;
}
function oc(e) {
	return !e?.automaticFunctionCalling?.ignoreCallHistory;
}
var sc = class extends m {
	constructor(e) {
		super(), this.apiClient = e, this.embedContent = async (e) => {
			if (!this.apiClient.isVertexAI()) return e.model.includes("gemini-embedding-2") && (e.contents = L(e.contents)), await this.embedContentInternal(e);
			if (e.model.includes("gemini") && e.model !== "gemini-embedding-001" || e.model.includes("maas")) {
				let t = L(e.contents);
				if (t.length > 1) throw Error("The embedContent API for this model only supports one content at a time.");
				let n = Object.assign(Object.assign({}, e), {
					content: t[0],
					embeddingApiType: Ve.EMBED_CONTENT
				});
				return await this.embedContentInternal(n);
			}
			{
				let t = Object.assign(Object.assign({}, e), { embeddingApiType: Ve.PREDICT });
				return await this.embedContentInternal(t);
			}
		}, this.generateContent = async (e) => {
			let t = await this.processParamsMaybeAddMcpUsage(e);
			if (this.maybeMoveToResponseJsonSchem(e), !ic(e) || nc(e.config)) return await this.generateContentInternal(t);
			let n = ac(e);
			if (n.length > 0) {
				let e = n.map((e) => `tools[${e}]`).join(", ");
				throw Error(`Automatic function calling with CallableTools (or MCP objects) and basic FunctionDeclarations is not yet supported. Incompatible tools found at ${e}.`);
			}
			let r, i, a = L(t.contents), o = t.config?.automaticFunctionCalling?.maximumRemoteCalls ?? tc, s = 0;
			for (; s < o && (r = await this.generateContentInternal(t), !(!r.functionCalls || r.functionCalls.length === 0));) {
				let n = r.candidates[0].content, o = [];
				for (let t of e.config?.tools ?? []) if (rc(t)) {
					let e = await t.callTool(r.functionCalls);
					o.push(...e);
				}
				s++, i = {
					role: "user",
					parts: o
				}, t.contents = L(t.contents), t.contents.push(n), t.contents.push(i), oc(t.config) && (a.push(n), a.push(i));
			}
			return oc(t.config) && (r.automaticFunctionCallingHistory = a), r;
		}, this.generateContentStream = async (e) => {
			if (this.maybeMoveToResponseJsonSchem(e), nc(e.config)) {
				let t = await this.processParamsMaybeAddMcpUsage(e);
				return await this.generateContentStreamInternal(t);
			}
			let t = ac(e);
			if (t.length > 0) {
				let e = t.map((e) => `tools[${e}]`).join(", ");
				throw Error(`Incompatible tools found at ${e}. Automatic function calling with CallableTools (or MCP objects) and basic FunctionDeclarations" is not yet supported.`);
			}
			let n = e?.config?.toolConfig?.functionCallingConfig?.streamFunctionCallArguments, r = e?.config?.automaticFunctionCalling?.disable;
			if (n && !r) throw Error("Running in streaming mode with 'streamFunctionCallArguments' enabled, this feature is not compatible with automatic function calling (AFC). Please set 'config.automaticFunctionCalling.disable' to true to disable AFC or leave 'config.toolConfig.functionCallingConfig.streamFunctionCallArguments' to be undefined or set to false to disable streaming function call arguments feature.");
			return await this.processAfcStream(e);
		}, this.generateImages = async (e) => await this.generateImagesInternal(e).then((e) => {
			let t, n = [];
			if (e?.generatedImages) for (let r of e.generatedImages) r && r?.safetyAttributes && r?.safetyAttributes?.contentType === "Positive Prompt" ? t = r?.safetyAttributes : n.push(r);
			let r;
			return r = t ? {
				generatedImages: n,
				positivePromptSafetyAttributes: t,
				sdkHttpResponse: e.sdkHttpResponse
			} : {
				generatedImages: n,
				sdkHttpResponse: e.sdkHttpResponse
			}, r;
		}), this.list = async (e) => {
			let t = { config: Object.assign(Object.assign({}, { queryBase: !0 }), e?.config) };
			if (this.apiClient.isVertexAI() && !t.config.queryBase) {
				if (t.config?.filter) throw Error("Filtering tuned models list for Gemini Enterprise Agent Platform (previously known as Vertex AI) is not currently supported");
				t.config.filter = "labels.tune-type:*";
			}
			return new H(V.PAGED_ITEM_MODELS, (e) => this.listInternal(e), await this.listInternal(t), t);
		}, this.editImage = async (e) => {
			let t = {
				model: e.model,
				prompt: e.prompt,
				referenceImages: [],
				config: e.config
			};
			return e.referenceImages && e.referenceImages && (t.referenceImages = e.referenceImages.map((e) => e.toReferenceImageAPI())), await this.editImageInternal(t);
		}, this.upscaleImage = async (e) => {
			let t = {
				numberOfImages: 1,
				mode: "upscale"
			};
			e.config && (t = Object.assign(Object.assign({}, t), e.config));
			let n = {
				model: e.model,
				image: e.image,
				upscaleFactor: e.upscaleFactor,
				config: t
			};
			return await this.upscaleImageInternal(n);
		}, this.generateVideos = async (e) => {
			if ((e.prompt || e.image || e.video) && e.source) throw Error("Source and prompt/image/video are mutually exclusive. Please only use source.");
			return this.apiClient.isVertexAI() || (e.video?.uri && e.video?.videoBytes ? e.video = {
				uri: e.video.uri,
				mimeType: e.video.mimeType
			} : e.source?.video?.uri && e.source?.video?.videoBytes && (e.source.video = {
				uri: e.source.video.uri,
				mimeType: e.source.video.mimeType
			})), await this.generateVideosInternal(e);
		};
	}
	maybeMoveToResponseJsonSchem(e) {
		e.config && e.config.responseSchema && (e.config.responseJsonSchema || Object.keys(e.config.responseSchema).includes("$schema") && (e.config.responseJsonSchema = e.config.responseSchema, delete e.config.responseSchema));
	}
	async processParamsMaybeAddMcpUsage(e) {
		let t = e.config?.tools;
		if (!t) return e;
		let n = await Promise.all(t.map(async (e) => rc(e) ? await e.tool() : e)), r = {
			model: e.model,
			contents: e.contents,
			config: Object.assign(Object.assign({}, e.config), { tools: n })
		};
		if (r.config.tools = n, e.config && e.config.tools && Rs(e.config.tools)) {
			let t = e.config.httpOptions?.headers ?? {}, n = Object.assign({}, t);
			Object.keys(n).length === 0 && (n = this.apiClient.getDefaultHeaders()), zs(n), r.config.httpOptions = Object.assign(Object.assign({}, e.config.httpOptions), { headers: n });
		}
		return r;
	}
	async initAfcToolsMap(e) {
		let t = /* @__PURE__ */ new Map();
		for (let n of e.config?.tools ?? []) if (rc(n)) {
			let e = n, r = await e.tool();
			for (let n of r.functionDeclarations ?? []) {
				if (!n.name) throw Error("Function declaration name is required.");
				if (t.has(n.name)) throw Error(`Duplicate tool declaration name: ${n.name}`);
				t.set(n.name, e);
			}
		}
		return t;
	}
	async processAfcStream(e) {
		let t = e.config?.automaticFunctionCalling?.maximumRemoteCalls ?? tc, n = !1, r = 0, i = await this.initAfcToolsMap(e);
		return (function(e, i, a) {
			return G(this, arguments, function* () {
				for (var o, s, c, l; r < t;) {
					n &&= (r++, !1);
					let p = yield W(e.processParamsMaybeAddMcpUsage(a)), m = yield W(e.generateContentStreamInternal(p)), h = [], g = [];
					try {
						for (var u = !0, d = (s = void 0, K(m)), f; f = yield W(d.next()), o = f.done, !o; u = !0) {
							l = f.value, u = !1;
							let e = l;
							if (yield yield W(e), e.candidates && e.candidates[0]?.content) {
								g.push(e.candidates[0].content);
								for (let n of e.candidates[0].content.parts ?? []) if (r < t && n.functionCall) {
									if (!n.functionCall.name) throw Error("Function call name was not returned by the model.");
									if (i.has(n.functionCall.name)) {
										let e = yield W(i.get(n.functionCall.name).callTool([n.functionCall]));
										h.push(...e);
									} else throw Error(`Automatic function calling was requested, but not all the tools the model used implement the CallableTool interface. Available tools: ${i.keys()}, mising tool: ${n.functionCall.name}`);
								}
							}
						}
					} catch (e) {
						s = { error: e };
					} finally {
						try {
							!u && !o && (c = d.return) && (yield W(c.call(d)));
						} finally {
							if (s) throw s.error;
						}
					}
					if (h.length > 0) {
						n = !0;
						let e = new mt();
						e.candidates = [{ content: {
							role: "user",
							parts: h
						} }], yield yield W(e);
						let t = [];
						t.push(...g), t.push({
							role: "user",
							parts: h
						}), a.contents = L(a.contents).concat(t);
					} else break;
				}
			});
		})(this, i, e);
	}
	async generateContentInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Ia(this.apiClient, e);
			return n = h("{model}:generateContent", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Ra(e), n = new mt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = Fa(this.apiClient, e);
			return n = h("{model}:generateContent", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = La(e), n = new mt();
				return Object.assign(n, t), n;
			});
		}
	}
	async generateContentStreamInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Ia(this.apiClient, e);
			return n = h("{model}:streamGenerateContent?alt=sse", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.requestStream({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}), t.then(function(t) {
				return G(this, arguments, function* () {
					var n, r, i, a;
					try {
						for (var o = !0, s = K(t), c; c = yield W(s.next()), n = c.done, !n; o = !0) {
							a = c.value, o = !1;
							let t = a, n = Ra(yield W(t.json()), e);
							n.sdkHttpResponse = { headers: t.headers };
							let r = new mt();
							Object.assign(r, n), yield yield W(r);
						}
					} catch (e) {
						r = { error: e };
					} finally {
						try {
							!o && !n && (i = s.return) && (yield W(i.call(s)));
						} finally {
							if (r) throw r.error;
						}
					}
				});
			});
		}
		{
			let i = Fa(this.apiClient, e);
			return n = h("{model}:streamGenerateContent?alt=sse", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.requestStream({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}), t.then(function(t) {
				return G(this, arguments, function* () {
					var n, r, i, a;
					try {
						for (var o = !0, s = K(t), c; c = yield W(s.next()), n = c.done, !n; o = !0) {
							a = c.value, o = !1;
							let t = a, n = La(yield W(t.json()), e);
							n.sdkHttpResponse = { headers: t.headers };
							let r = new mt();
							Object.assign(r, n), yield yield W(r);
						}
					} catch (e) {
						r = { error: e };
					} finally {
						try {
							!o && !n && (i = s.return) && (yield W(i.call(s)));
						} finally {
							if (r) throw r.error;
						}
					}
				});
			});
		}
	}
	async embedContentInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Ta(this.apiClient, e, e);
			return n = h(Sn(e.model) ? "{model}:embedContent" : "{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((t) => {
				let n = Da(t, e), r = new ht();
				return Object.assign(r, n), r;
			});
		}
		{
			let i = wa(this.apiClient, e);
			return n = h("{model}:batchEmbedContents", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Ea(e), n = new ht();
				return Object.assign(n, t), n;
			});
		}
	}
	async generateImagesInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Ha(this.apiClient, e);
			return n = h("{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Wa(e), n = new gt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = Va(this.apiClient, e);
			return n = h("{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = Ua(e), n = new gt();
				return Object.assign(n, t), n;
			});
		}
	}
	async editImageInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = ba(this.apiClient, e);
			return n = h("{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = xa(e), n = new _t();
				return Object.assign(n, t), n;
			});
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async upscaleImageInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = $o(this.apiClient, e);
			return n = h("{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = es(e), n = new vt();
				return Object.assign(n, t), n;
			});
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async recontextImage(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Ao(this.apiClient, e);
			return n = h("{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = jo(e), n = new yt();
				return Object.assign(n, t), n;
			});
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async segmentImage(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = zo(this.apiClient, e);
			return n = h("{model}:predict", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = Bo(e), n = new bt();
				return Object.assign(n, t), n;
			});
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async get(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = co(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => To(e));
		}
		{
			let i = so(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => wo(e));
		}
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = bo(this.apiClient, e);
			return n = h("{models_url}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = So(e), n = new xt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = yo(this.apiClient, e);
			return n = h("{models_url}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = xo(e), n = new xt();
				return Object.assign(n, t), n;
			});
		}
	}
	async update(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Zo(this.apiClient, e);
			return n = h("{model}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "PATCH",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => To(e));
		}
		{
			let i = Xo(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "PATCH",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => wo(e));
		}
	}
	async delete(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = ga(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = va(e), n = new St();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = ha(this.apiClient, e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = _a(e), n = new St();
				return Object.assign(n, t), n;
			});
		}
	}
	async countTokens(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = fa(this.apiClient, e);
			return n = h("{model}:countTokens", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = ma(e), n = new Ct();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = da(this.apiClient, e);
			return n = h("{model}:countTokens", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = pa(e), n = new Ct();
				return Object.assign(n, t), n;
			});
		}
	}
	async computeTokens(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = na(this.apiClient, e);
			return n = h("{model}:computeTokens", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = ra(e), n = new wt();
				return Object.assign(n, t), n;
			});
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async generateVideosInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = Xa(this.apiClient, e);
			return n = h("{model}:predictLongRunning", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = Ja(e), n = new Tt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = Ya(this.apiClient, e);
			return n = h("{model}:predictLongRunning", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = qa(e), n = new Tt();
				return Object.assign(n, t), n;
			});
		}
	}
}, cc = class extends m {
	constructor(e) {
		super(), this.apiClient = e;
	}
	async getVideosOperation(e) {
		let t = e.operation, n = e.config;
		if (t.name === void 0 || t.name === "") throw Error("Operation name is required.");
		if (this.apiClient.isVertexAI()) {
			let e = t.name.split("/operations/")[0], r;
			n && "httpOptions" in n && (r = n.httpOptions);
			let i = await this.fetchPredictVideosOperationInternal({
				operationName: t.name,
				resourceName: e,
				config: { httpOptions: r }
			});
			return t._fromAPIResponse({
				apiResponse: i,
				_isVertexAI: !0
			});
		}
		{
			let e = await this.getVideosOperationInternal({
				operationName: t.name,
				config: n
			});
			return t._fromAPIResponse({
				apiResponse: e,
				_isVertexAI: !1
			});
		}
	}
	async get(e) {
		let t = e.operation, n = e.config;
		if (t.name === void 0 || t.name === "") throw Error("Operation name is required.");
		if (this.apiClient.isVertexAI()) {
			let e = t.name.split("/operations/")[0], r;
			n && "httpOptions" in n && (r = n.httpOptions);
			let i = await this.fetchPredictVideosOperationInternal({
				operationName: t.name,
				resourceName: e,
				config: { httpOptions: r }
			});
			return t._fromAPIResponse({
				apiResponse: i,
				_isVertexAI: !0
			});
		}
		{
			let e = await this.getVideosOperationInternal({
				operationName: t.name,
				config: n
			});
			return t._fromAPIResponse({
				apiResponse: e,
				_isVertexAI: !1
			});
		}
	}
	async getVideosOperationInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = k(e);
			return n = h("{operationName}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t;
		}
		{
			let i = O(e);
			return n = h("{operationName}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t;
		}
	}
	async fetchPredictVideosOperationInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = x(e);
			return n = h("{resourceName}:fetchPredictOperation", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t;
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
};
function lc(e) {
	let t = {};
	if (_(e, ["languageCodes"]) !== void 0) throw Error("languageCodes parameter is not supported in Gemini API.");
	return t;
}
function uc(e) {
	let t = {}, n = _(e, ["apiKey"]);
	if (n != null && g(t, ["apiKey"], n), _(e, ["apiKeyConfig"]) !== void 0) throw Error("apiKeyConfig parameter is not supported in Gemini API.");
	if (_(e, ["authType"]) !== void 0) throw Error("authType parameter is not supported in Gemini API.");
	if (_(e, ["googleServiceAccountConfig"]) !== void 0) throw Error("googleServiceAccountConfig parameter is not supported in Gemini API.");
	if (_(e, ["httpBasicAuthConfig"]) !== void 0) throw Error("httpBasicAuthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oauthConfig"]) !== void 0) throw Error("oauthConfig parameter is not supported in Gemini API.");
	if (_(e, ["oidcConfig"]) !== void 0) throw Error("oidcConfig parameter is not supported in Gemini API.");
	return t;
}
function dc(e) {
	let t = {}, n = _(e, ["data"]);
	if (n != null && g(t, ["data"], n), _(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function fc(e) {
	let t = {}, n = _(e, ["parts"]);
	if (n != null) {
		let e = n;
		Array.isArray(e) && (e = e.map((e) => xc(e))), g(t, ["parts"], e);
	}
	let r = _(e, ["role"]);
	return r != null && g(t, ["role"], r), t;
}
function pc(e, t, n) {
	let r = {}, i = _(t, ["expireTime"]);
	n !== void 0 && i != null && g(n, ["expireTime"], i);
	let a = _(t, ["newSessionExpireTime"]);
	n !== void 0 && a != null && g(n, ["newSessionExpireTime"], a);
	let o = _(t, ["uses"]);
	n !== void 0 && o != null && g(n, ["uses"], o);
	let s = _(t, ["liveConnectConstraints"]);
	n !== void 0 && s != null && g(n, ["bidiGenerateContentSetup"], bc(e, s));
	let c = _(t, ["lockAdditionalFields"]);
	return n !== void 0 && c != null && g(n, ["fieldMask"], c), r;
}
function mc(e, t) {
	let n = {}, r = _(t, ["config"]);
	return r != null && g(n, ["config"], pc(e, r, n)), n;
}
function hc(e) {
	let t = {};
	if (_(e, ["displayName"]) !== void 0) throw Error("displayName parameter is not supported in Gemini API.");
	let n = _(e, ["fileUri"]);
	n != null && g(t, ["fileUri"], n);
	let r = _(e, ["mimeType"]);
	return r != null && g(t, ["mimeType"], r), t;
}
function gc(e) {
	let t = {}, n = _(e, ["id"]);
	n != null && g(t, ["id"], n);
	let r = _(e, ["args"]);
	r != null && g(t, ["args"], r);
	let i = _(e, ["name"]);
	if (i != null && g(t, ["name"], i), _(e, ["partialArgs"]) !== void 0) throw Error("partialArgs parameter is not supported in Gemini API.");
	if (_(e, ["willContinue"]) !== void 0) throw Error("willContinue parameter is not supported in Gemini API.");
	return t;
}
function _c(e) {
	let t = {}, n = _(e, ["authConfig"]);
	n != null && g(t, ["authConfig"], uc(n));
	let r = _(e, ["enableWidget"]);
	return r != null && g(t, ["enableWidget"], r), t;
}
function vc(e) {
	let t = {}, n = _(e, ["searchTypes"]);
	if (n != null && g(t, ["searchTypes"], n), _(e, ["blockingConfidence"]) !== void 0) throw Error("blockingConfidence parameter is not supported in Gemini API.");
	if (_(e, ["excludeDomains"]) !== void 0) throw Error("excludeDomains parameter is not supported in Gemini API.");
	let r = _(e, ["timeRangeFilter"]);
	return r != null && g(t, ["timeRangeFilter"], r), t;
}
function yc(e, t) {
	let n = {}, r = _(e, ["generationConfig"]);
	t !== void 0 && r != null && g(t, ["setup", "generationConfig"], r);
	let i = _(e, ["responseModalities"]);
	t !== void 0 && i != null && g(t, [
		"setup",
		"generationConfig",
		"responseModalities"
	], i);
	let a = _(e, ["temperature"]);
	t !== void 0 && a != null && g(t, [
		"setup",
		"generationConfig",
		"temperature"
	], a);
	let o = _(e, ["topP"]);
	t !== void 0 && o != null && g(t, [
		"setup",
		"generationConfig",
		"topP"
	], o);
	let s = _(e, ["topK"]);
	t !== void 0 && s != null && g(t, [
		"setup",
		"generationConfig",
		"topK"
	], s);
	let c = _(e, ["maxOutputTokens"]);
	t !== void 0 && c != null && g(t, [
		"setup",
		"generationConfig",
		"maxOutputTokens"
	], c);
	let l = _(e, ["mediaResolution"]);
	t !== void 0 && l != null && g(t, [
		"setup",
		"generationConfig",
		"mediaResolution"
	], l);
	let u = _(e, ["seed"]);
	t !== void 0 && u != null && g(t, [
		"setup",
		"generationConfig",
		"seed"
	], u);
	let d = _(e, ["speechConfig"]);
	t !== void 0 && d != null && g(t, [
		"setup",
		"generationConfig",
		"speechConfig"
	], rn(d));
	let f = _(e, ["thinkingConfig"]);
	t !== void 0 && f != null && g(t, [
		"setup",
		"generationConfig",
		"thinkingConfig"
	], f);
	let p = _(e, ["enableAffectiveDialog"]);
	t !== void 0 && p != null && g(t, [
		"setup",
		"generationConfig",
		"enableAffectiveDialog"
	], p);
	let m = _(e, ["systemInstruction"]);
	t !== void 0 && m != null && g(t, ["setup", "systemInstruction"], fc(I(m)));
	let h = _(e, ["tools"]);
	if (t !== void 0 && h != null) {
		let e = an(h);
		Array.isArray(e) && (e = e.map((e) => wc(R(e)))), g(t, ["setup", "tools"], e);
	}
	let v = _(e, ["sessionResumption"]);
	t !== void 0 && v != null && g(t, ["setup", "sessionResumption"], Cc(v));
	let y = _(e, ["inputAudioTranscription"]);
	t !== void 0 && y != null && g(t, ["setup", "inputAudioTranscription"], lc(y));
	let b = _(e, ["outputAudioTranscription"]);
	t !== void 0 && b != null && g(t, ["setup", "outputAudioTranscription"], lc(b));
	let x = _(e, ["realtimeInputConfig"]);
	t !== void 0 && x != null && g(t, ["setup", "realtimeInputConfig"], x);
	let S = _(e, ["contextWindowCompression"]);
	t !== void 0 && S != null && g(t, ["setup", "contextWindowCompression"], S);
	let C = _(e, ["proactivity"]);
	if (t !== void 0 && C != null && g(t, ["setup", "proactivity"], C), _(e, ["explicitVadSignal"]) !== void 0) throw Error("explicitVadSignal parameter is not supported in Gemini API.");
	let w = _(e, ["avatarConfig"]);
	t !== void 0 && w != null && g(t, ["setup", "avatarConfig"], w);
	let T = _(e, ["safetySettings"]);
	if (t !== void 0 && T != null) {
		let e = T;
		Array.isArray(e) && (e = e.map((e) => Sc(e))), g(t, ["setup", "safetySettings"], e);
	}
	return n;
}
function bc(e, t) {
	let n = {}, r = _(t, ["model"]);
	r != null && g(n, ["setup", "model"], F(e, r));
	let i = _(t, ["config"]);
	return i != null && g(n, ["config"], yc(i, n)), n;
}
function xc(e) {
	let t = {}, n = _(e, ["mediaResolution"]);
	n != null && g(t, ["mediaResolution"], n);
	let r = _(e, ["codeExecutionResult"]);
	r != null && g(t, ["codeExecutionResult"], r);
	let i = _(e, ["executableCode"]);
	i != null && g(t, ["executableCode"], i);
	let a = _(e, ["fileData"]);
	a != null && g(t, ["fileData"], hc(a));
	let o = _(e, ["functionCall"]);
	o != null && g(t, ["functionCall"], gc(o));
	let s = _(e, ["functionResponse"]);
	s != null && g(t, ["functionResponse"], s);
	let c = _(e, ["inlineData"]);
	c != null && g(t, ["inlineData"], dc(c));
	let l = _(e, ["text"]);
	l != null && g(t, ["text"], l);
	let u = _(e, ["thought"]);
	u != null && g(t, ["thought"], u);
	let d = _(e, ["thoughtSignature"]);
	d != null && g(t, ["thoughtSignature"], d);
	let f = _(e, ["videoMetadata"]);
	f != null && g(t, ["videoMetadata"], f);
	let p = _(e, ["toolCall"]);
	p != null && g(t, ["toolCall"], p);
	let m = _(e, ["toolResponse"]);
	m != null && g(t, ["toolResponse"], m);
	let h = _(e, ["partMetadata"]);
	return h != null && g(t, ["partMetadata"], h), t;
}
function Sc(e) {
	let t = {}, n = _(e, ["category"]);
	if (n != null && g(t, ["category"], n), _(e, ["method"]) !== void 0) throw Error("method parameter is not supported in Gemini API.");
	let r = _(e, ["threshold"]);
	return r != null && g(t, ["threshold"], r), t;
}
function Cc(e) {
	let t = {}, n = _(e, ["handle"]);
	if (n != null && g(t, ["handle"], n), _(e, ["transparent"]) !== void 0) throw Error("transparent parameter is not supported in Gemini API.");
	return t;
}
function wc(e) {
	let t = {};
	if (_(e, ["retrieval"]) !== void 0) throw Error("retrieval parameter is not supported in Gemini API.");
	let n = _(e, ["computerUse"]);
	n != null && g(t, ["computerUse"], n);
	let r = _(e, ["fileSearch"]);
	r != null && g(t, ["fileSearch"], r);
	let i = _(e, ["googleSearch"]);
	i != null && g(t, ["googleSearch"], vc(i));
	let a = _(e, ["googleMaps"]);
	a != null && g(t, ["googleMaps"], _c(a));
	let o = _(e, ["codeExecution"]);
	if (o != null && g(t, ["codeExecution"], o), _(e, ["enterpriseWebSearch"]) !== void 0) throw Error("enterpriseWebSearch parameter is not supported in Gemini API.");
	let s = _(e, ["functionDeclarations"]);
	if (s != null) {
		let e = s;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["functionDeclarations"], e);
	}
	let c = _(e, ["googleSearchRetrieval"]);
	if (c != null && g(t, ["googleSearchRetrieval"], c), _(e, ["parallelAiSearch"]) !== void 0) throw Error("parallelAiSearch parameter is not supported in Gemini API.");
	let l = _(e, ["urlContext"]);
	l != null && g(t, ["urlContext"], l);
	let u = _(e, ["mcpServers"]);
	if (u != null) {
		let e = u;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["mcpServers"], e);
	}
	return t;
}
function Tc(e) {
	let t = [];
	for (let n in e) if (Object.prototype.hasOwnProperty.call(e, n)) {
		let r = e[n];
		if (typeof r == "object" && r && Object.keys(r).length > 0) {
			let e = Object.keys(r).map((e) => `${n}.${e}`);
			t.push(...e);
		} else t.push(n);
	}
	return t.join(",");
}
function Ec(e, t) {
	let n = null, r = e.bidiGenerateContentSetup;
	if (typeof r == "object" && r && "setup" in r) {
		let t = r.setup;
		typeof t == "object" && t ? (e.bidiGenerateContentSetup = t, n = t) : delete e.bidiGenerateContentSetup;
	} else r !== void 0 && delete e.bidiGenerateContentSetup;
	let i = e.fieldMask;
	if (n) {
		let r = Tc(n);
		if (Array.isArray(t?.lockAdditionalFields) && t?.lockAdditionalFields.length === 0) r ? e.fieldMask = r : delete e.fieldMask;
		else if (t?.lockAdditionalFields && t.lockAdditionalFields.length > 0 && i !== null && Array.isArray(i) && i.length > 0) {
			let t = [
				"temperature",
				"topK",
				"topP",
				"maxOutputTokens",
				"responseModalities",
				"seed",
				"speechConfig"
			], n = [];
			i.length > 0 && (n = i.map((e) => t.includes(e) ? `generationConfig.${e}` : e));
			let a = [];
			r && a.push(r), n.length > 0 && a.push(...n), a.length > 0 ? e.fieldMask = a.join(",") : delete e.fieldMask;
		} else delete e.fieldMask;
	} else i !== null && Array.isArray(i) && i.length > 0 ? e.fieldMask = i.join(",") : delete e.fieldMask;
	return e;
}
var Dc = class extends m {
	constructor(e) {
		super(), this.apiClient = e;
	}
	async create(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("The client.tokens.create method is only supported by the Gemini Developer API.");
		{
			let i = mc(this.apiClient, e);
			n = h("auth_tokens", i._url), r = i._query, delete i.config, delete i._url, delete i._query;
			let a = Ec(i, e.config);
			return t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(a),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
};
function Oc(e, t) {
	let n = {}, r = _(e, ["force"]);
	return t !== void 0 && r != null && g(t, ["_query", "force"], r), n;
}
function kc(e) {
	let t = {}, n = _(e, ["name"]);
	n != null && g(t, ["_url", "name"], n);
	let r = _(e, ["config"]);
	return r != null && Oc(r, t), t;
}
function Ac(e) {
	let t = {}, n = _(e, ["name"]);
	return n != null && g(t, ["_url", "name"], n), t;
}
function jc(e, t) {
	let n = {}, r = _(e, ["pageSize"]);
	t !== void 0 && r != null && g(t, ["_query", "pageSize"], r);
	let i = _(e, ["pageToken"]);
	return t !== void 0 && i != null && g(t, ["_query", "pageToken"], i), n;
}
function Mc(e) {
	let t = {}, n = _(e, ["parent"]);
	n != null && g(t, ["_url", "parent"], n);
	let r = _(e, ["config"]);
	return r != null && jc(r, t), t;
}
function Nc(e) {
	let t = {}, n = _(e, ["sdkHttpResponse"]);
	n != null && g(t, ["sdkHttpResponse"], n);
	let r = _(e, ["nextPageToken"]);
	r != null && g(t, ["nextPageToken"], r);
	let i = _(e, ["documents"]);
	if (i != null) {
		let e = i;
		Array.isArray(e) && (e = e.map((e) => e)), g(t, ["documents"], e);
	}
	return t;
}
var Pc = class extends m {
	constructor(e) {
		super(), this.apiClient = e, this.list = async (e) => new H(V.PAGED_ITEM_DOCUMENTS, (t) => this.listInternal({
			parent: e.parent,
			config: t.config
		}), await this.listInternal(e), e);
	}
	async get(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = Ac(e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async delete(e) {
		let t = "", n = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let r = kc(e);
			t = h("{name}", r._url), n = r._query, delete r._url, delete r._query, await this.apiClient.request({
				path: t,
				queryParams: n,
				body: JSON.stringify(r),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			});
		}
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = Mc(e);
			return n = h("{parent}/documents", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = Nc(e), n = new At();
				return Object.assign(n, t), n;
			});
		}
	}
}, Fc = class extends m {
	constructor(e, t = new Pc(e)) {
		super(), this.apiClient = e, this.documents = t, this.list = async (e = {}) => new H(V.PAGED_ITEM_FILE_SEARCH_STORES, (e) => this.listInternal(e), await this.listInternal(e), e);
	}
	async uploadToFileSearchStore(e) {
		if (this.apiClient.isVertexAI()) throw Error("Gemini Enterprise Agent Platform (previously known as Vertex AI) does not support uploading files to a file search store.");
		return this.apiClient.uploadFileToFileSearchStore(e.fileSearchStoreName, e.file, e.config);
	}
	async downloadMedia(e, t) {
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported in the Gemini Developer client.");
		let n = new URL(e, "http://dummy.com"), r = n.pathname;
		if (r.startsWith("/") && (r = r.slice(1)), !r.includes("/media/")) throw Error(`Invalid uri format: ${e}. Expected to contain /media/`);
		let i = {};
		n.searchParams.forEach((e, t) => {
			i[t] = e;
		}), i.alt = "media";
		let a = Object.assign({}, t?.httpOptions), o = await this.apiClient.request({
			path: r,
			httpMethod: "GET",
			queryParams: i,
			httpOptions: a
		});
		if (o instanceof pt) {
			let e = await o.responseInternal.arrayBuffer();
			return new Uint8Array(e);
		}
		throw Error("Unexpected response type from downloadMedia");
	}
	async create(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = ls(this.apiClient, e);
			return n = h("fileSearchStores", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async get(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = fs(e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => e);
		}
	}
	async delete(e) {
		let t = "", n = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let r = ds(e);
			t = h("{name}", r._url), n = r._query, delete r._url, delete r._query, await this.apiClient.request({
				path: t,
				queryParams: n,
				body: JSON.stringify(r),
				httpMethod: "DELETE",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			});
		}
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = vs(e);
			return n = h("fileSearchStores", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = ys(e), n = new jt();
				return Object.assign(n, t), n;
			});
		}
	}
	async uploadToFileSearchStoreInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = xs(e);
			return n = h("upload/v1beta/{file_search_store_name}:uploadToFileSearchStore", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = Ss(e), n = new Mt();
				return Object.assign(n, t), n;
			});
		}
	}
	async importFile(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = hs(e);
			return n = h("{file_search_store_name}:importFile", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json()), t.then((e) => {
				let t = ms(e), n = new Nt();
				return Object.assign(n, t), n;
			});
		}
	}
}, Ic = function() {
	let { crypto: e } = globalThis;
	if (e?.randomUUID) return Ic = e.randomUUID.bind(e), e.randomUUID();
	let t = /* @__PURE__ */ new Uint8Array(1), n = e ? () => e.getRandomValues(t)[0] : () => Math.random() * 255 & 255;
	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (e) => (e ^ n() & 15 >> e / 4).toString(16));
}, Lc = () => Ic();
function Rc(e) {
	return typeof e == "object" && !!e && ("name" in e && e.name === "AbortError" || "message" in e && String(e.message).includes("FetchRequestCanceledException"));
}
var zc = (e) => {
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
}, J = class extends Error {}, Y = class e extends J {
	constructor(t, n, r, i) {
		super(`${e.makeMessage(t, n, r)}`), this.status = t, this.headers = i, this.error = n;
	}
	static makeMessage(e, t, n) {
		let r = t?.message ? typeof t.message == "string" ? t.message : JSON.stringify(t.message) : t ? JSON.stringify(t) : n;
		return e && r ? `${e} ${r}` : e ? `${e} status code (no body)` : r || "(no status code or body)";
	}
	static generate(t, n, r, i) {
		if (!t || !i) return new Vc({
			message: r,
			cause: zc(n)
		});
		let a = n;
		return t === 400 ? new Uc(t, a, r, i) : t === 401 ? new Wc(t, a, r, i) : t === 403 ? new Gc(t, a, r, i) : t === 404 ? new Kc(t, a, r, i) : t === 409 ? new qc(t, a, r, i) : t === 422 ? new Jc(t, a, r, i) : t === 429 ? new Yc(t, a, r, i) : t >= 500 ? new Xc(t, a, r, i) : new e(t, a, r, i);
	}
}, Bc = class extends Y {
	constructor({ message: e } = {}) {
		super(void 0, void 0, e || "Request was aborted.", void 0);
	}
}, Vc = class extends Y {
	constructor({ message: e, cause: t }) {
		super(void 0, void 0, e || "Connection error.", void 0), t && (this.cause = t);
	}
}, Hc = class extends Vc {
	constructor({ message: e } = {}) {
		super({ message: e ?? "Request timed out." });
	}
}, Uc = class extends Y {}, Wc = class extends Y {}, Gc = class extends Y {}, Kc = class extends Y {}, qc = class extends Y {}, Jc = class extends Y {}, Yc = class extends Y {}, Xc = class extends Y {}, Zc = /^[a-z][a-z0-9+.-]*:/i, Qc = (e) => Zc.test(e), $c = (e) => ($c = Array.isArray, $c(e)), el = $c;
function tl(e) {
	if (!e) return !0;
	for (let t in e) return !1;
	return !0;
}
function nl(e, t) {
	return Object.prototype.hasOwnProperty.call(e, t);
}
var rl = (e, t) => {
	if (typeof t != "number" || !Number.isInteger(t)) throw new J(`${e} must be an integer`);
	if (t < 0) throw new J(`${e} must be a positive integer`);
	return t;
}, il = (e) => {
	try {
		return JSON.parse(e);
	} catch {
		return;
	}
}, al = (e) => new Promise((t) => setTimeout(t, e));
function ol() {
	if (typeof fetch < "u") return fetch;
	throw Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new GeminiNextGenAPIClient({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function sl(...e) {
	let t = globalThis.ReadableStream;
	if (t === void 0) throw Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
	return new t(...e);
}
function cl(e) {
	let t = Symbol.asyncIterator in e ? e[Symbol.asyncIterator]() : e[Symbol.iterator]();
	return sl({
		start() {},
		async pull(e) {
			let { done: n, value: r } = await t.next();
			n ? e.close() : e.enqueue(r);
		},
		async cancel() {
			await t.return?.call(t);
		}
	});
}
function ll(e) {
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
async function ul(e) {
	var t;
	if (typeof e != "object" || !e) return;
	if (e[Symbol.asyncIterator]) {
		await (t = e[Symbol.asyncIterator]()).return?.call(t);
		return;
	}
	let n = e.getReader(), r = n.cancel();
	n.releaseLock(), await r;
}
var dl = ({ headers: e, body: t }) => ({
	bodyHeaders: { "content-type": "application/json" },
	body: JSON.stringify(t)
});
function fl(e) {
	return Object.entries(e).filter(([e, t]) => t !== void 0).map(([e, t]) => {
		if (typeof t == "string" || typeof t == "number" || typeof t == "boolean") return `${encodeURIComponent(e)}=${encodeURIComponent(t)}`;
		if (t === null) return `${encodeURIComponent(e)}=`;
		throw new J(`Cannot stringify type ${typeof t}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
	}).join("&");
}
var pl = "0.0.1", ml = () => {
	if (typeof File > "u") {
		let { process: e } = globalThis, t = typeof e?.versions?.node == "string" && parseInt(e.versions.node.split(".")) < 20;
		throw Error("`File` is not defined as a global, which is required for file uploads." + (t ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
	}
};
function hl(e, t, n) {
	return ml(), new File(e, t ?? "unknown_file", n);
}
function gl(e) {
	return (typeof e == "object" && !!e && ("name" in e && e.name && String(e.name) || "url" in e && e.url && String(e.url) || "filename" in e && e.filename && String(e.filename) || "path" in e && e.path && String(e.path)) || "").split(/[\\/]/).pop() || void 0;
}
var _l = (e) => typeof e == "object" && !!e && typeof e[Symbol.asyncIterator] == "function", vl = (e) => typeof e == "object" && !!e && typeof e.size == "number" && typeof e.type == "string" && typeof e.text == "function" && typeof e.slice == "function" && typeof e.arrayBuffer == "function", yl = (e) => typeof e == "object" && !!e && typeof e.name == "string" && typeof e.lastModified == "number" && vl(e), bl = (e) => typeof e == "object" && !!e && typeof e.url == "string" && typeof e.blob == "function";
async function xl(e, t, n) {
	if (ml(), e = await e, yl(e)) return e instanceof File ? e : hl([await e.arrayBuffer()], e.name);
	if (bl(e)) {
		let r = await e.blob();
		return t ||= new URL(e.url).pathname.split(/[\\/]/).pop(), hl(await Sl(r), t, n);
	}
	let r = await Sl(e);
	if (t ||= gl(e), !n?.type) {
		let e = r.find((e) => typeof e == "object" && "type" in e && e.type);
		typeof e == "string" && (n = Object.assign(Object.assign({}, n), { type: e }));
	}
	return hl(r, t, n);
}
async function Sl(e) {
	var t, n, r, i;
	let a = [];
	if (typeof e == "string" || ArrayBuffer.isView(e) || e instanceof ArrayBuffer) a.push(e);
	else if (vl(e)) a.push(e instanceof Blob ? e : await e.arrayBuffer());
	else if (_l(e)) try {
		for (var o = !0, s = K(e), c; c = await s.next(), t = c.done, !t; o = !0) {
			i = c.value, o = !1;
			let e = i;
			a.push(...await Sl(e));
		}
	} catch (e) {
		n = { error: e };
	} finally {
		try {
			!o && !t && (r = s.return) && await r.call(s);
		} finally {
			if (n) throw n.error;
		}
	}
	else {
		let t = e?.constructor?.name;
		throw Error(`Unexpected data type: ${typeof e}${t ? `; constructor: ${t}` : ""}${Cl(e)}`);
	}
	return a;
}
function Cl(e) {
	return typeof e != "object" || !e ? "" : `; props: [${Object.getOwnPropertyNames(e).map((e) => `"${e}"`).join(", ")}]`;
}
var wl = class {
	constructor(e) {
		this._client = e;
	}
};
wl._key = [];
function Tl(e) {
	return e.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var El = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null)), X = /* @__PURE__ */ ((e = Tl) => (function(t, ...n) {
	if (t.length === 1) return t[0];
	let r = !1, i = [], a = t.reduce((t, a, o) => {
		/[?#]/.test(a) && (r = !0);
		let s = n[o], c = (r ? encodeURIComponent : e)("" + s);
		return o !== n.length && (s == null || typeof s == "object" && s.toString === Object.getPrototypeOf(Object.getPrototypeOf(s.hasOwnProperty ?? El) ?? El)?.toString) && (c = s + "", i.push({
			start: t.length + a.length,
			length: c.length,
			error: `Value of type ${Object.prototype.toString.call(s).slice(8, -1)} is not a valid path parameter`
		})), t + a + (o === n.length ? "" : c);
	}, ""), o = a.split(/[?#]/, 1)[0], s = /(^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi, c;
	for (; (c = s.exec(o)) !== null;) {
		let e = c[0].startsWith("/"), t = +!!e, n = e ? c[0].slice(1) : c[0];
		i.push({
			start: c.index + t,
			length: n.length,
			error: `Value "${n}" can\'t be safely passed as a path parameter`
		});
	}
	if (i.sort((e, t) => e.start - t.start), i.length > 0) {
		let e = 0, t = i.reduce((t, n) => {
			let r = " ".repeat(n.start - e), i = "^".repeat(n.length);
			return e = n.start + n.length, t + r + i;
		}, "");
		throw new J(`Path parameters result in path with invalid segments:\n${i.map((e) => e.error).join("\n")}\n${a}\n${t}`);
	}
	return a;
}))(Tl), Dl = class extends wl {
	create(e, t) {
		let { api_version: n = this._client.apiVersion } = e, r = U(e, ["api_version"]);
		if ("model" in r && "agent_config" in r) throw new J("Invalid request: specified `model` and `agent_config`. If specifying `model`, use `generation_config`.");
		if ("agent" in r && "generation_config" in r) throw new J("Invalid request: specified `agent` and `generation_config`. If specifying `agent`, use `agent_config`.");
		return this._client.post(X`/${n}/interactions`, Object.assign(Object.assign({ body: r }, t), { stream: e.stream ?? !1 }));
	}
	delete(e, t = {}, n) {
		let { api_version: r = this._client.apiVersion } = t ?? {};
		return this._client.delete(X`/${r}/interactions/${e}`, n);
	}
	cancel(e, t = {}, n) {
		let { api_version: r = this._client.apiVersion } = t ?? {};
		return this._client.post(X`/${r}/interactions/${e}/cancel`, n);
	}
	get(e, t = {}, n) {
		let r = t ?? {}, { api_version: i = this._client.apiVersion } = r, a = U(r, ["api_version"]);
		return this._client.get(X`/${i}/interactions/${e}`, Object.assign(Object.assign({ query: a }, n), { stream: t?.stream ?? !1 }));
	}
};
Dl._key = Object.freeze(["interactions"]);
var Ol = class extends Dl {}, kl = class extends wl {
	create(e, t) {
		let { api_version: n = this._client.apiVersion } = e, r = U(e, ["api_version"]);
		return this._client.post(X`/${n}/webhooks`, Object.assign({ body: r }, t));
	}
	update(e, t = {}, n) {
		let r = t ?? {}, { api_version: i = this._client.apiVersion, update_mask: a } = r, o = U(r, ["api_version", "update_mask"]);
		return this._client.patch(X`/${i}/webhooks/${e}`, Object.assign({
			query: { update_mask: a },
			body: o
		}, n));
	}
	list(e = {}, t) {
		let n = e ?? {}, { api_version: r = this._client.apiVersion } = n, i = U(n, ["api_version"]);
		return this._client.get(X`/${r}/webhooks`, Object.assign({ query: i }, t));
	}
	delete(e, t = {}, n) {
		let { api_version: r = this._client.apiVersion } = t ?? {};
		return this._client.delete(X`/${r}/webhooks/${e}`, n);
	}
	get(e, t = {}, n) {
		let { api_version: r = this._client.apiVersion } = t ?? {};
		return this._client.get(X`/${r}/webhooks/${e}`, n);
	}
	ping(e, t = void 0, n) {
		let { api_version: r = this._client.apiVersion, body: i } = t ?? {};
		return this._client.post(X`/${r}/webhooks/${e}:ping`, Object.assign({ body: i }, n));
	}
	rotateSigningSecret(e, t = {}, n) {
		let r = t ?? {}, { api_version: i = this._client.apiVersion } = r, a = U(r, ["api_version"]);
		return this._client.post(X`/${i}/webhooks/${e}:rotateSigningSecret`, Object.assign({ body: a }, n));
	}
};
kl._key = Object.freeze(["webhooks"]);
var Al = class extends kl {};
function jl(e) {
	let t = 0;
	for (let n of e) t += n.length;
	let n = new Uint8Array(t), r = 0;
	for (let t of e) n.set(t, r), r += t.length;
	return n;
}
var Ml;
function Nl(e) {
	let t;
	return (Ml ??= (t = new globalThis.TextEncoder(), t.encode.bind(t)))(e);
}
var Pl;
function Fl(e) {
	let t;
	return (Pl ??= (t = new globalThis.TextDecoder(), t.decode.bind(t)))(e);
}
var Il = class {
	constructor() {
		this.buffer = /* @__PURE__ */ new Uint8Array(), this.carriageReturnIndex = null, this.searchIndex = 0;
	}
	decode(e) {
		if (e == null) return [];
		let t = e instanceof ArrayBuffer ? new Uint8Array(e) : typeof e == "string" ? Nl(e) : e;
		this.buffer = jl([this.buffer, t]);
		let n = [], r;
		for (; (r = Ll(this.buffer, this.carriageReturnIndex ?? this.searchIndex)) != null;) {
			if (r.carriage && this.carriageReturnIndex == null) {
				this.carriageReturnIndex = r.index;
				continue;
			}
			if (this.carriageReturnIndex != null && (r.index !== this.carriageReturnIndex + 1 || r.carriage)) {
				n.push(Fl(this.buffer.subarray(0, this.carriageReturnIndex - 1))), this.buffer = this.buffer.subarray(this.carriageReturnIndex), this.carriageReturnIndex = null, this.searchIndex = 0;
				continue;
			}
			let e = this.carriageReturnIndex === null ? r.preceding : r.preceding - 1, t = Fl(this.buffer.subarray(0, e));
			n.push(t), this.buffer = this.buffer.subarray(r.index), this.carriageReturnIndex = null, this.searchIndex = 0;
		}
		return this.searchIndex = Math.max(0, this.buffer.length - 1), n;
	}
	flush() {
		return this.buffer.length ? this.decode("\n") : [];
	}
};
Il.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]), Il.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function Ll(e, t) {
	let n = t ?? 0, r = e.indexOf(10, n), i = e.indexOf(13, n);
	if (r === -1 && i === -1) return null;
	let a;
	return a = r !== -1 && i !== -1 ? Math.min(r, i) : r === -1 ? i : r, e[a] === 10 ? {
		preceding: a,
		index: a + 1,
		carriage: !1
	} : {
		preceding: a,
		index: a + 1,
		carriage: !0
	};
}
var Rl = {
	off: 0,
	error: 200,
	warn: 300,
	info: 400,
	debug: 500
}, zl = (e, t, n) => {
	if (e) {
		if (nl(Rl, e)) return e;
		Z(n).warn(`${t} was set to ${JSON.stringify(e)}, expected one of ${JSON.stringify(Object.keys(Rl))}`);
	}
};
function Bl() {}
function Vl(e, t, n) {
	return !t || Rl[e] > Rl[n] ? Bl : t[e].bind(t);
}
var Hl = {
	error: Bl,
	warn: Bl,
	info: Bl,
	debug: Bl
}, Ul = /* @__PURE__ */ new WeakMap();
function Z(e) {
	let t = e.logger, n = e.logLevel ?? "off";
	if (!t) return Hl;
	let r = Ul.get(t);
	if (r && r[0] === n) return r[1];
	let i = {
		error: Vl("error", t, n),
		warn: Vl("warn", t, n),
		info: Vl("info", t, n),
		debug: Vl("debug", t, n)
	};
	return Ul.set(t, [n, i]), i;
}
var Q = (e) => (e.options && (e.options = Object.assign({}, e.options), delete e.options.headers), e.headers &&= Object.fromEntries((e.headers instanceof Headers ? [...e.headers] : Object.entries(e.headers)).map(([e, t]) => [e, e.toLowerCase() === "x-goog-api-key" || e.toLowerCase() === "authorization" || e.toLowerCase() === "cookie" || e.toLowerCase() === "set-cookie" ? "***" : t])), "retryOfRequestLogID" in e && (e.retryOfRequestLogID && (e.retryOf = e.retryOfRequestLogID), delete e.retryOfRequestLogID), e), Wl = class e {
	constructor(e, t, n) {
		this.iterator = e, this.controller = t, this.client = n;
	}
	static fromSSEResponse(t, n, r) {
		let i = !1, a = r ? Z(r) : console;
		function o() {
			return G(this, arguments, function* () {
				var e, r, o, s;
				if (i) throw new J("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
				i = !0;
				let c = !1;
				try {
					try {
						for (var l = !0, u = K(Gl(t, n)), d; d = yield W(u.next()), e = d.done, !e; l = !0) {
							s = d.value, l = !1;
							let e = s;
							if (!c) {
								if (e.data.startsWith("[DONE]")) {
									c = !0;
									continue;
								}
								try {
									yield yield W(JSON.parse(e.data));
								} catch (t) {
									throw a.error("Could not parse message into JSON:", e.data), a.error("From chunk:", e.raw), t;
								}
							}
						}
					} catch (e) {
						r = { error: e };
					} finally {
						try {
							!l && !e && (o = u.return) && (yield W(o.call(u)));
						} finally {
							if (r) throw r.error;
						}
					}
					c = !0;
				} catch (e) {
					if (Rc(e)) return yield W(void 0);
					throw e;
				} finally {
					c || n.abort();
				}
			});
		}
		return new e(o, n, r);
	}
	static fromReadableStream(t, n, r) {
		let i = !1;
		function a() {
			return G(this, arguments, function* () {
				var e, n, r, i;
				let a = new Il(), o = ll(t);
				try {
					for (var s = !0, c = K(o), l; l = yield W(c.next()), e = l.done, !e; s = !0) {
						i = l.value, s = !1;
						let e = i;
						for (let t of a.decode(e)) yield yield W(t);
					}
				} catch (e) {
					n = { error: e };
				} finally {
					try {
						!s && !e && (r = c.return) && (yield W(r.call(c)));
					} finally {
						if (n) throw n.error;
					}
				}
				for (let e of a.flush()) yield yield W(e);
			});
		}
		function o() {
			return G(this, arguments, function* () {
				var e, t, r, o;
				if (i) throw new J("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
				i = !0;
				let s = !1;
				try {
					try {
						for (var c = !0, l = K(a()), u; u = yield W(l.next()), e = u.done, !e; c = !0) {
							o = u.value, c = !1;
							let e = o;
							s || e && (yield yield W(JSON.parse(e)));
						}
					} catch (e) {
						t = { error: e };
					} finally {
						try {
							!c && !e && (r = l.return) && (yield W(r.call(l)));
						} finally {
							if (t) throw t.error;
						}
					}
					s = !0;
				} catch (e) {
					if (Rc(e)) return yield W(void 0);
					throw e;
				} finally {
					s || n.abort();
				}
			});
		}
		return new e(o, n, r);
	}
	[Symbol.asyncIterator]() {
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
		return [new e(() => i(t), this.controller, this.client), new e(() => i(n), this.controller, this.client)];
	}
	toReadableStream() {
		let e = this, t;
		return sl({
			async start() {
				t = e[Symbol.asyncIterator]();
			},
			async pull(e) {
				try {
					let { value: n, done: r } = await t.next();
					if (r) return e.close();
					let i = Nl(JSON.stringify(n) + "\n");
					e.enqueue(i);
				} catch (t) {
					e.error(t);
				}
			},
			async cancel() {
				await t.return?.call(t);
			}
		});
	}
};
function Gl(e, t) {
	return G(this, arguments, function* () {
		var n, r, i, a;
		if (!e.body) throw t.abort(), globalThis.navigator !== void 0 && globalThis.navigator.product === "ReactNative" ? new J("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new J("Attempted to iterate over a response with no body");
		let o = new ql(), s = new Il(), c = ll(e.body);
		try {
			for (var l = !0, u = K(Kl(c)), d; d = yield W(u.next()), n = d.done, !n; l = !0) {
				a = d.value, l = !1;
				let e = a;
				for (let t of s.decode(e)) {
					let e = o.decode(t);
					e && (yield yield W(e));
				}
			}
		} catch (e) {
			r = { error: e };
		} finally {
			try {
				!l && !n && (i = u.return) && (yield W(i.call(u)));
			} finally {
				if (r) throw r.error;
			}
		}
		for (let e of s.flush()) {
			let t = o.decode(e);
			t && (yield yield W(t));
		}
	});
}
function Kl(e) {
	return G(this, arguments, function* () {
		var t, n, r, i;
		try {
			for (var a = !0, o = K(e), s; s = yield W(o.next()), t = s.done, !t; a = !0) {
				i = s.value, a = !1;
				let e = i;
				e != null && (yield yield W(e instanceof ArrayBuffer ? new Uint8Array(e) : typeof e == "string" ? Nl(e) : e));
			}
		} catch (e) {
			n = { error: e };
		} finally {
			try {
				!a && !t && (r = o.return) && (yield W(r.call(o)));
			} finally {
				if (n) throw n.error;
			}
		}
	});
}
var ql = class {
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
		let [t, n, r] = Jl(e, ":");
		return r.startsWith(" ") && (r = r.substring(1)), t === "event" ? this.event = r : t === "data" && this.data.push(r), null;
	}
};
function Jl(e, t) {
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
async function Yl(e, t) {
	let { response: n, requestLogID: r, retryOfRequestLogID: i, startTime: a } = t, o = await (async () => {
		if (t.options.stream) return Z(e).debug("response", n.status, n.url, n.headers, n.body), t.options.__streamClass ? t.options.__streamClass.fromSSEResponse(n, t.controller, e) : Wl.fromSSEResponse(n, t.controller, e);
		if (n.status === 204) return null;
		if (t.options.__binaryResponse) return n;
		let r = (n.headers.get("content-type")?.split(";")[0])?.trim();
		return r?.includes("application/json") || r?.endsWith("+json") ? n.headers.get("content-length") === "0" ? void 0 : await n.json() : await n.text();
	})();
	return Z(e).debug(`[${r}] response parsed`, Q({
		retryOfRequestLogID: i,
		url: n.url,
		status: n.status,
		body: o,
		durationMs: Date.now() - a
	})), o;
}
var Xl = class e extends Promise {
	constructor(e, t, n = Yl) {
		super((e) => {
			e(null);
		}), this.responsePromise = t, this.parseResponse = n, this.client = e;
	}
	_thenUnwrap(t) {
		return new e(this.client, this.responsePromise, async (e, n) => t(await this.parseResponse(e, n), n));
	}
	asResponse() {
		return this.responsePromise.then((e) => e.response);
	}
	async withResponse() {
		let [e, t] = await Promise.all([this.parse(), this.asResponse()]);
		return {
			data: e,
			response: t
		};
	}
	parse() {
		return this.parsedPromise ||= this.responsePromise.then((e) => this.parseResponse(this.client, e)), this.parsedPromise;
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
}, Zl = /* @__PURE__ */ Symbol("brand.privateNullableHeaders");
function* Ql(e) {
	if (!e) return;
	if (Zl in e) {
		let { values: t, nulls: n } = e;
		yield* t.entries();
		for (let e of n) yield [e, null];
		return;
	}
	let t = !1, n;
	e instanceof Headers ? n = e.entries() : el(e) ? n = e : (t = !0, n = Object.entries(e ?? {}));
	for (let e of n) {
		let n = e[0];
		if (typeof n != "string") throw TypeError("expected header name to be a string");
		let r = el(e[1]) ? e[1] : [e[1]], i = !1;
		for (let e of r) e !== void 0 && (t && !i && (i = !0, yield [n, null]), yield [n, e]);
	}
}
var $l = (e) => {
	let t = new Headers(), n = /* @__PURE__ */ new Set();
	for (let r of e) {
		let e = /* @__PURE__ */ new Set();
		for (let [i, a] of Ql(r)) {
			let r = i.toLowerCase();
			e.has(r) || (t.delete(i), e.add(r)), a === null ? (t.delete(i), n.add(r)) : (t.append(i, a), n.delete(r));
		}
	}
	return {
		[Zl]: !0,
		values: t,
		nulls: n
	};
}, eu = (e) => {
	var t;
	if (globalThis.process !== void 0) return (globalThis.process.env?.[e])?.trim() || void 0;
	if (globalThis.Deno !== void 0) return (((t = globalThis.Deno.env)?.get)?.call(t, e))?.trim() || void 0;
}, tu, nu = class e {
	constructor(t) {
		var { baseURL: n = eu("GEMINI_NEXT_GEN_API_BASE_URL"), apiKey: r = eu("GEMINI_API_KEY") ?? null, apiVersion: i = "v1beta" } = t, a = U(t, [
			"baseURL",
			"apiKey",
			"apiVersion"
		]);
		let o = Object.assign(Object.assign({
			apiKey: r,
			apiVersion: i
		}, a), { baseURL: n || "https://generativelanguage.googleapis.com" });
		this.baseURL = o.baseURL, this.timeout = o.timeout ?? e.DEFAULT_TIMEOUT, this.logger = o.logger ?? console;
		let s = "warn";
		this.logLevel = s, this.logLevel = zl(o.logLevel, "ClientOptions.logLevel", this) ?? zl(eu("GEMINI_NEXT_GEN_API_LOG"), "process.env['GEMINI_NEXT_GEN_API_LOG']", this) ?? s, this.fetchOptions = o.fetchOptions, this.maxRetries = o.maxRetries ?? 2, this.fetch = o.fetch ?? ol(), this.encoder = dl, this._options = o, this.apiKey = r, this.apiVersion = i, this.clientAdapter = o.clientAdapter;
	}
	withOptions(e) {
		return new this.constructor(Object.assign(Object.assign(Object.assign({}, this._options), {
			baseURL: this.baseURL,
			maxRetries: this.maxRetries,
			timeout: this.timeout,
			logger: this.logger,
			logLevel: this.logLevel,
			fetch: this.fetch,
			fetchOptions: this.fetchOptions,
			apiKey: this.apiKey,
			apiVersion: this.apiVersion
		}), e));
	}
	baseURLOverridden() {
		return this.baseURL !== "https://generativelanguage.googleapis.com";
	}
	defaultQuery() {
		return this._options.defaultQuery;
	}
	validateHeaders({ values: e, nulls: t }) {
		if (!(e.has("authorization") || e.has("x-goog-api-key")) && !(this.apiKey && e.get("x-goog-api-key")) && !t.has("x-goog-api-key")) throw Error("Could not resolve authentication method. Expected the apiKey to be set. Or for the \"x-goog-api-key\" headers to be explicitly omitted");
	}
	async authHeaders(e) {
		let t = $l([e.headers]);
		if (!(t.values.has("authorization") || t.values.has("x-goog-api-key"))) {
			if (this.apiKey) return $l([{ "x-goog-api-key": this.apiKey }]);
			if (this.clientAdapter && this.clientAdapter.isVertexAI()) return $l([await this.clientAdapter.getAuthHeaders()]);
		}
	}
	stringifyQuery(e) {
		return fl(e);
	}
	getUserAgent() {
		return `${this.constructor.name}/JS ${pl}`;
	}
	defaultIdempotencyKey() {
		return `stainless-node-retry-${Lc()}`;
	}
	makeStatusError(e, t, n, r) {
		return Y.generate(e, t, n, r);
	}
	buildURL(e, t, n) {
		let r = !this.baseURLOverridden() && n || this.baseURL, i = Qc(e) ? new URL(e) : new URL(r + (r.endsWith("/") && e.startsWith("/") ? e.slice(1) : e)), a = this.defaultQuery(), o = Object.fromEntries(i.searchParams);
		return (!tl(a) || !tl(o)) && (t = Object.assign(Object.assign(Object.assign({}, o), a), t)), typeof t == "object" && t && !Array.isArray(t) && (i.search = this.stringifyQuery(t)), i.toString();
	}
	async prepareOptions(e) {
		if (this.clientAdapter && this.clientAdapter.isVertexAI() && !e.path.startsWith(`/${this.apiVersion}/projects/`)) {
			let t = e.path.slice(this.apiVersion.length + 1);
			e.path = `/${this.apiVersion}/projects/${this.clientAdapter.getProject()}/locations/${this.clientAdapter.getLocation()}${t}`;
		}
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
		return this.request(Promise.resolve(n).then((n) => Object.assign({
			method: e,
			path: t
		}, n)));
	}
	request(e, t = null) {
		return new Xl(this, this.makeRequest(e, t, void 0));
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
		if (Z(this).debug(`[${c}] sending request`, Q({
			retryOfRequestLogID: n,
			method: r.method,
			url: o,
			options: r,
			headers: a.headers
		})), r.signal?.aborted) throw new Bc();
		let d = new AbortController(), f = await this.fetchWithTimeout(o, a, s, d).catch(zc), p = Date.now();
		if (f instanceof globalThis.Error) {
			let e = `retrying, ${t} attempts remaining`;
			if (r.signal?.aborted) throw new Bc();
			let i = Rc(f) || /timed? ?out/i.test(String(f) + ("cause" in f ? String(f.cause) : ""));
			if (t) return Z(this).info(`[${c}] connection ${i ? "timed out" : "failed"} - ${e}`), Z(this).debug(`[${c}] connection ${i ? "timed out" : "failed"} (${e})`, Q({
				retryOfRequestLogID: n,
				url: o,
				durationMs: p - u,
				message: f.message
			})), this.retryRequest(r, t, n ?? c);
			throw Z(this).info(`[${c}] connection ${i ? "timed out" : "failed"} - error; no more retries left`), Z(this).debug(`[${c}] connection ${i ? "timed out" : "failed"} (error; no more retries left)`, Q({
				retryOfRequestLogID: n,
				url: o,
				durationMs: p - u,
				message: f.message
			})), i ? new Hc() : new Vc({ cause: f });
		}
		let m = `[${c}${l}] ${a.method} ${o} ${f.ok ? "succeeded" : "failed"} with status ${f.status} in ${p - u}ms`;
		if (!f.ok) {
			let e = await this.shouldRetry(f);
			if (t && e) {
				let e = `retrying, ${t} attempts remaining`;
				return await ul(f.body), Z(this).info(`${m} - ${e}`), Z(this).debug(`[${c}] response error (${e})`, Q({
					retryOfRequestLogID: n,
					url: f.url,
					status: f.status,
					headers: f.headers,
					durationMs: p - u
				})), this.retryRequest(r, t, n ?? c, f.headers);
			}
			let i = e ? "error; no more retries left" : "error; not retryable";
			Z(this).info(`${m} - ${i}`);
			let a = await f.text().catch((e) => zc(e).message), o = il(a), s = o ? void 0 : a;
			throw Z(this).debug(`[${c}] response error (${i})`, Q({
				retryOfRequestLogID: n,
				url: f.url,
				status: f.status,
				headers: f.headers,
				message: s,
				durationMs: Date.now() - u
			})), this.makeStatusError(f.status, o, s, f.headers);
		}
		return Z(this).info(m), Z(this).debug(`[${c}] response start`, Q({
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
	async fetchWithTimeout(e, t, n, r) {
		let i = t || {}, { signal: a, method: o } = i, s = U(i, ["signal", "method"]), c = this._makeAbort(r);
		a && a.addEventListener("abort", c, { once: !0 });
		let l = setTimeout(c, n), u = globalThis.ReadableStream && s.body instanceof globalThis.ReadableStream || typeof s.body == "object" && s.body !== null && Symbol.asyncIterator in s.body, d = Object.assign(Object.assign(Object.assign({ signal: r.signal }, u ? { duplex: "half" } : {}), { method: "GET" }), s);
		o && (d.method = o.toUpperCase());
		try {
			return await this.fetch.call(void 0, e, d);
		} finally {
			clearTimeout(l);
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
		return await al(i), this.makeRequest(e, t - 1, n);
	}
	calculateDefaultRetryTimeoutMillis(e, t) {
		let n = t - e;
		return Math.min(.5 * 2 ** n, 8) * (1 - Math.random() * .25) * 1e3;
	}
	async buildRequest(e, { retryCount: t = 0 } = {}) {
		let n = Object.assign({}, e), { method: r, path: i, query: a, defaultBaseURL: o } = n, s = this.buildURL(i, a, o);
		"timeout" in n && rl("timeout", n.timeout), n.timeout = n.timeout ?? this.timeout;
		let { bodyHeaders: c, body: l } = this.buildBody({ options: n }), u = await this.buildHeaders({
			options: e,
			method: r,
			bodyHeaders: c,
			retryCount: t
		});
		return {
			req: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({
				method: r,
				headers: u
			}, n.signal && { signal: n.signal }), globalThis.ReadableStream && l instanceof globalThis.ReadableStream && { duplex: "half" }), l && { body: l }), this.fetchOptions ?? {}), n.fetchOptions ?? {}),
			url: s,
			timeout: n.timeout
		};
	}
	async buildHeaders({ options: e, method: t, bodyHeaders: n, retryCount: r }) {
		let i = {};
		this.idempotencyHeader && t !== "get" && (e.idempotencyKey ||= this.defaultIdempotencyKey(), i[this.idempotencyHeader] = e.idempotencyKey);
		let a = await this.authHeaders(e), o = $l([
			i,
			{
				Accept: "application/json",
				"User-Agent": this.getUserAgent()
			},
			this._options.defaultHeaders,
			n,
			e.headers,
			a
		]);
		return this.validateHeaders(o), o.values;
	}
	_makeAbort(e) {
		return () => e.abort();
	}
	buildBody({ options: { body: e, headers: t } }) {
		if (!e) return {
			bodyHeaders: void 0,
			body: void 0
		};
		let n = $l([t]);
		return ArrayBuffer.isView(e) || e instanceof ArrayBuffer || e instanceof DataView || typeof e == "string" && n.values.has("content-type") || globalThis.Blob && e instanceof globalThis.Blob || e instanceof FormData || e instanceof URLSearchParams || globalThis.ReadableStream && e instanceof globalThis.ReadableStream ? {
			bodyHeaders: void 0,
			body: e
		} : typeof e == "object" && (Symbol.asyncIterator in e || Symbol.iterator in e && "next" in e && typeof e.next == "function") ? {
			bodyHeaders: void 0,
			body: cl(e)
		} : typeof e == "object" && n.values.get("content-type") === "application/x-www-form-urlencoded" ? {
			bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
			body: this.stringifyQuery(e)
		} : this.encoder({
			body: e,
			headers: n
		});
	}
};
nu.DEFAULT_TIMEOUT = 6e4;
var $ = class extends nu {
	constructor() {
		super(...arguments), this.interactions = new Ol(this), this.webhooks = new Al(this);
	}
};
tu = $, $.GeminiNextGenAPIClient = tu, $.GeminiNextGenAPIClientError = J, $.APIError = Y, $.APIConnectionError = Vc, $.APIConnectionTimeoutError = Hc, $.APIUserAbortError = Bc, $.NotFoundError = Kc, $.ConflictError = qc, $.RateLimitError = Yc, $.BadRequestError = Uc, $.AuthenticationError = Wc, $.InternalServerError = Xc, $.PermissionDeniedError = Gc, $.UnprocessableEntityError = Jc, $.toFile = xl, $.Interactions = Ol, $.Webhooks = Al;
function ru(e, t) {
	let n = {}, r = _(e, ["name"]);
	return r != null && g(n, ["_url", "name"], r), n;
}
function iu(e, t) {
	let n = {}, r = _(e, ["name"]);
	return r != null && g(n, ["_url", "name"], r), n;
}
function au(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	return r != null && g(n, ["sdkHttpResponse"], r), n;
}
function ou(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	return r != null && g(n, ["sdkHttpResponse"], r), n;
}
function su(e, t, n) {
	let r = {};
	if (_(e, ["validationDataset"]) !== void 0) throw Error("validationDataset parameter is not supported in Gemini API.");
	let i = _(e, ["tunedModelDisplayName"]);
	if (t !== void 0 && i != null && g(t, ["displayName"], i), _(e, ["description"]) !== void 0) throw Error("description parameter is not supported in Gemini API.");
	let a = _(e, ["epochCount"]);
	t !== void 0 && a != null && g(t, [
		"tuningTask",
		"hyperparameters",
		"epochCount"
	], a);
	let o = _(e, ["learningRateMultiplier"]);
	if (o != null && g(r, [
		"tuningTask",
		"hyperparameters",
		"learningRateMultiplier"
	], o), _(e, ["exportLastCheckpointOnly"]) !== void 0) throw Error("exportLastCheckpointOnly parameter is not supported in Gemini API.");
	if (_(e, ["preTunedModelCheckpointId"]) !== void 0) throw Error("preTunedModelCheckpointId parameter is not supported in Gemini API.");
	if (_(e, ["adapterSize"]) !== void 0) throw Error("adapterSize parameter is not supported in Gemini API.");
	if (_(e, ["tuningMode"]) !== void 0) throw Error("tuningMode parameter is not supported in Gemini API.");
	if (_(e, ["customBaseModel"]) !== void 0) throw Error("customBaseModel parameter is not supported in Gemini API.");
	let s = _(e, ["batchSize"]);
	t !== void 0 && s != null && g(t, [
		"tuningTask",
		"hyperparameters",
		"batchSize"
	], s);
	let c = _(e, ["learningRate"]);
	if (t !== void 0 && c != null && g(t, [
		"tuningTask",
		"hyperparameters",
		"learningRate"
	], c), _(e, ["labels"]) !== void 0) throw Error("labels parameter is not supported in Gemini API.");
	if (_(e, ["beta"]) !== void 0) throw Error("beta parameter is not supported in Gemini API.");
	if (_(e, ["baseTeacherModel"]) !== void 0) throw Error("baseTeacherModel parameter is not supported in Gemini API.");
	if (_(e, ["tunedTeacherModelSource"]) !== void 0) throw Error("tunedTeacherModelSource parameter is not supported in Gemini API.");
	if (_(e, ["sftLossWeightMultiplier"]) !== void 0) throw Error("sftLossWeightMultiplier parameter is not supported in Gemini API.");
	if (_(e, ["outputUri"]) !== void 0) throw Error("outputUri parameter is not supported in Gemini API.");
	if (_(e, ["encryptionSpec"]) !== void 0) throw Error("encryptionSpec parameter is not supported in Gemini API.");
	return r;
}
function cu(e, t, n) {
	let r = {}, i = _(n, ["config", "method"]);
	if (i === void 0 && (i = "SUPERVISED_FINE_TUNING"), i === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["validationDataset"]);
		t !== void 0 && n != null && g(t, ["supervisedTuningSpec"], Su(n));
	} else if (i === "PREFERENCE_TUNING") {
		let n = _(e, ["validationDataset"]);
		t !== void 0 && n != null && g(t, ["preferenceOptimizationSpec"], Su(n));
	} else if (i === "DISTILLATION") {
		let n = _(e, ["validationDataset"]);
		t !== void 0 && n != null && g(t, ["distillationSpec"], Su(n));
	}
	let a = _(e, ["tunedModelDisplayName"]);
	t !== void 0 && a != null && g(t, ["tunedModelDisplayName"], a);
	let o = _(e, ["description"]);
	t !== void 0 && o != null && g(t, ["description"], o);
	let s = _(n, ["config", "method"]);
	if (s === void 0 && (s = "SUPERVISED_FINE_TUNING"), s === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["epochCount"]);
		t !== void 0 && n != null && g(t, [
			"supervisedTuningSpec",
			"hyperParameters",
			"epochCount"
		], n);
	} else if (s === "PREFERENCE_TUNING") {
		let n = _(e, ["epochCount"]);
		t !== void 0 && n != null && g(t, [
			"preferenceOptimizationSpec",
			"hyperParameters",
			"epochCount"
		], n);
	} else if (s === "DISTILLATION") {
		let n = _(e, ["epochCount"]);
		t !== void 0 && n != null && g(t, [
			"distillationSpec",
			"hyperParameters",
			"epochCount"
		], n);
	}
	let c = _(n, ["config", "method"]);
	if (c === void 0 && (c = "SUPERVISED_FINE_TUNING"), c === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["learningRateMultiplier"]);
		t !== void 0 && n != null && g(t, [
			"supervisedTuningSpec",
			"hyperParameters",
			"learningRateMultiplier"
		], n);
	} else if (c === "PREFERENCE_TUNING") {
		let n = _(e, ["learningRateMultiplier"]);
		t !== void 0 && n != null && g(t, [
			"preferenceOptimizationSpec",
			"hyperParameters",
			"learningRateMultiplier"
		], n);
	} else if (c === "DISTILLATION") {
		let n = _(e, ["learningRateMultiplier"]);
		t !== void 0 && n != null && g(t, [
			"distillationSpec",
			"hyperParameters",
			"learningRateMultiplier"
		], n);
	}
	let l = _(n, ["config", "method"]);
	if (l === void 0 && (l = "SUPERVISED_FINE_TUNING"), l === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["exportLastCheckpointOnly"]);
		t !== void 0 && n != null && g(t, ["supervisedTuningSpec", "exportLastCheckpointOnly"], n);
	} else if (l === "PREFERENCE_TUNING") {
		let n = _(e, ["exportLastCheckpointOnly"]);
		t !== void 0 && n != null && g(t, ["preferenceOptimizationSpec", "exportLastCheckpointOnly"], n);
	} else if (l === "DISTILLATION") {
		let n = _(e, ["exportLastCheckpointOnly"]);
		t !== void 0 && n != null && g(t, ["distillationSpec", "exportLastCheckpointOnly"], n);
	}
	let u = _(n, ["config", "method"]);
	if (u === void 0 && (u = "SUPERVISED_FINE_TUNING"), u === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["adapterSize"]);
		t !== void 0 && n != null && g(t, [
			"supervisedTuningSpec",
			"hyperParameters",
			"adapterSize"
		], n);
	} else if (u === "PREFERENCE_TUNING") {
		let n = _(e, ["adapterSize"]);
		t !== void 0 && n != null && g(t, [
			"preferenceOptimizationSpec",
			"hyperParameters",
			"adapterSize"
		], n);
	} else if (u === "DISTILLATION") {
		let n = _(e, ["adapterSize"]);
		t !== void 0 && n != null && g(t, [
			"distillationSpec",
			"hyperParameters",
			"adapterSize"
		], n);
	}
	let d = _(n, ["config", "method"]);
	if (d === void 0 && (d = "SUPERVISED_FINE_TUNING"), d === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["tuningMode"]);
		t !== void 0 && n != null && g(t, ["supervisedTuningSpec", "tuningMode"], n);
	} else if (d === "DISTILLATION") {
		let n = _(e, ["tuningMode"]);
		t !== void 0 && n != null && g(t, ["distillationSpec", "tuningMode"], n);
	}
	let f = _(e, ["customBaseModel"]);
	t !== void 0 && f != null && g(t, ["customBaseModel"], f);
	let p = _(n, ["config", "method"]);
	if (p === void 0 && (p = "SUPERVISED_FINE_TUNING"), p === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["batchSize"]);
		t !== void 0 && n != null && g(t, [
			"supervisedTuningSpec",
			"hyperParameters",
			"batchSize"
		], n);
	} else if (p === "DISTILLATION") {
		let n = _(e, ["batchSize"]);
		t !== void 0 && n != null && g(t, [
			"distillationSpec",
			"hyperParameters",
			"batchSize"
		], n);
	}
	let m = _(n, ["config", "method"]);
	if (m === void 0 && (m = "SUPERVISED_FINE_TUNING"), m === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["learningRate"]);
		t !== void 0 && n != null && g(t, [
			"supervisedTuningSpec",
			"hyperParameters",
			"learningRate"
		], n);
	} else if (m === "DISTILLATION") {
		let n = _(e, ["learningRate"]);
		t !== void 0 && n != null && g(t, [
			"distillationSpec",
			"hyperParameters",
			"learningRate"
		], n);
	}
	let h = _(e, ["labels"]);
	t !== void 0 && h != null && g(t, ["labels"], h);
	let v = _(e, ["beta"]);
	t !== void 0 && v != null && g(t, [
		"preferenceOptimizationSpec",
		"hyperParameters",
		"beta"
	], v);
	let y = _(e, ["baseTeacherModel"]);
	t !== void 0 && y != null && g(t, ["distillationSpec", "baseTeacherModel"], y);
	let b = _(e, ["tunedTeacherModelSource"]);
	t !== void 0 && b != null && g(t, ["distillationSpec", "tunedTeacherModelSource"], b);
	let x = _(e, ["sftLossWeightMultiplier"]);
	t !== void 0 && x != null && g(t, [
		"distillationSpec",
		"hyperParameters",
		"sftLossWeightMultiplier"
	], x);
	let S = _(e, ["outputUri"]);
	t !== void 0 && S != null && g(t, ["outputUri"], S);
	let C = _(e, ["encryptionSpec"]);
	return t !== void 0 && C != null && g(t, ["encryptionSpec"], C), r;
}
function lu(e, t) {
	let n = {}, r = _(e, ["baseModel"]);
	r != null && g(n, ["baseModel"], r);
	let i = _(e, ["preTunedModel"]);
	i != null && g(n, ["preTunedModel"], i);
	let a = _(e, ["trainingDataset"]);
	a != null && _u(a);
	let o = _(e, ["config"]);
	return o != null && su(o, n), n;
}
function uu(e, t) {
	let n = {}, r = _(e, ["baseModel"]);
	r != null && g(n, ["baseModel"], r);
	let i = _(e, ["preTunedModel"]);
	i != null && g(n, ["preTunedModel"], i);
	let a = _(e, ["trainingDataset"]);
	a != null && vu(a, n, t);
	let o = _(e, ["config"]);
	return o != null && cu(o, n, t), n;
}
function du(e, t) {
	let n = {}, r = _(e, ["name"]);
	return r != null && g(n, ["_url", "name"], r), n;
}
function fu(e, t) {
	let n = {}, r = _(e, ["name"]);
	return r != null && g(n, ["_url", "name"], r), n;
}
function pu(e, t, n) {
	let r = {}, i = _(e, ["pageSize"]);
	t !== void 0 && i != null && g(t, ["_query", "pageSize"], i);
	let a = _(e, ["pageToken"]);
	t !== void 0 && a != null && g(t, ["_query", "pageToken"], a);
	let o = _(e, ["filter"]);
	return t !== void 0 && o != null && g(t, ["_query", "filter"], o), r;
}
function mu(e, t) {
	let n = {}, r = _(e, ["config"]);
	return r != null && pu(r, n), n;
}
function hu(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["nextPageToken"]);
	i != null && g(n, ["nextPageToken"], i);
	let a = _(e, ["tuningJobs"]);
	if (a != null) {
		let e = a;
		Array.isArray(e) && (e = e.map((e) => bu(e))), g(n, ["tuningJobs"], e);
	}
	return n;
}
function gu(e, t) {
	let n = {}, r = _(e, ["name"]);
	r != null && g(n, ["model"], r);
	let i = _(e, ["name"]);
	return i != null && g(n, ["endpoint"], i), n;
}
function _u(e, t) {
	let n = {};
	if (_(e, ["gcsUri"]) !== void 0) throw Error("gcsUri parameter is not supported in Gemini API.");
	if (_(e, ["vertexDatasetResource"]) !== void 0) throw Error("vertexDatasetResource parameter is not supported in Gemini API.");
	let r = _(e, ["examples"]);
	if (r != null) {
		let e = r;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["examples", "examples"], e);
	}
	return n;
}
function vu(e, t, n) {
	let r = {}, i = _(n, ["config", "method"]);
	if (i === void 0 && (i = "SUPERVISED_FINE_TUNING"), i === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["gcsUri"]);
		t !== void 0 && n != null && g(t, ["supervisedTuningSpec", "trainingDatasetUri"], n);
	} else if (i === "PREFERENCE_TUNING") {
		let n = _(e, ["gcsUri"]);
		t !== void 0 && n != null && g(t, ["preferenceOptimizationSpec", "trainingDatasetUri"], n);
	} else if (i === "DISTILLATION") {
		let n = _(e, ["gcsUri"]);
		t !== void 0 && n != null && g(t, ["distillationSpec", "promptDatasetUri"], n);
	}
	let a = _(n, ["config", "method"]);
	if (a === void 0 && (a = "SUPERVISED_FINE_TUNING"), a === "SUPERVISED_FINE_TUNING") {
		let n = _(e, ["vertexDatasetResource"]);
		t !== void 0 && n != null && g(t, ["supervisedTuningSpec", "trainingDatasetUri"], n);
	} else if (a === "PREFERENCE_TUNING") {
		let n = _(e, ["vertexDatasetResource"]);
		t !== void 0 && n != null && g(t, ["preferenceOptimizationSpec", "trainingDatasetUri"], n);
	} else if (a === "DISTILLATION") {
		let n = _(e, ["vertexDatasetResource"]);
		t !== void 0 && n != null && g(t, ["distillationSpec", "promptDatasetUri"], n);
	}
	if (_(e, ["examples"]) !== void 0) throw Error("examples parameter is not supported in Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	return r;
}
function yu(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["name"]);
	i != null && g(n, ["name"], i);
	let a = _(e, ["state"]);
	a != null && g(n, ["state"], sn(a));
	let o = _(e, ["createTime"]);
	o != null && g(n, ["createTime"], o);
	let s = _(e, ["tuningTask", "startTime"]);
	s != null && g(n, ["startTime"], s);
	let c = _(e, ["tuningTask", "completeTime"]);
	c != null && g(n, ["endTime"], c);
	let l = _(e, ["updateTime"]);
	l != null && g(n, ["updateTime"], l);
	let u = _(e, ["description"]);
	u != null && g(n, ["description"], u);
	let d = _(e, ["baseModel"]);
	d != null && g(n, ["baseModel"], d);
	let f = _(e, ["_self"]);
	return f != null && g(n, ["tunedModel"], gu(f)), n;
}
function bu(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["name"]);
	i != null && g(n, ["name"], i);
	let a = _(e, ["state"]);
	a != null && g(n, ["state"], sn(a));
	let o = _(e, ["createTime"]);
	o != null && g(n, ["createTime"], o);
	let s = _(e, ["startTime"]);
	s != null && g(n, ["startTime"], s);
	let c = _(e, ["endTime"]);
	c != null && g(n, ["endTime"], c);
	let l = _(e, ["updateTime"]);
	l != null && g(n, ["updateTime"], l);
	let u = _(e, ["error"]);
	u != null && g(n, ["error"], u);
	let d = _(e, ["description"]);
	d != null && g(n, ["description"], d);
	let f = _(e, ["baseModel"]);
	f != null && g(n, ["baseModel"], f);
	let p = _(e, ["tunedModel"]);
	p != null && g(n, ["tunedModel"], p);
	let m = _(e, ["preTunedModel"]);
	m != null && g(n, ["preTunedModel"], m);
	let h = _(e, ["supervisedTuningSpec"]);
	h != null && g(n, ["supervisedTuningSpec"], h);
	let v = _(e, ["preferenceOptimizationSpec"]);
	v != null && g(n, ["preferenceOptimizationSpec"], v);
	let y = _(e, ["distillationSpec"]);
	y != null && g(n, ["distillationSpec"], y);
	let b = _(e, ["tuningDataStats"]);
	b != null && g(n, ["tuningDataStats"], b);
	let x = _(e, ["encryptionSpec"]);
	x != null && g(n, ["encryptionSpec"], x);
	let S = _(e, ["partnerModelTuningSpec"]);
	S != null && g(n, ["partnerModelTuningSpec"], S);
	let C = _(e, ["customBaseModel"]);
	C != null && g(n, ["customBaseModel"], C);
	let w = _(e, ["evaluateDatasetRuns"]);
	if (w != null) {
		let e = w;
		Array.isArray(e) && (e = e.map((e) => e)), g(n, ["evaluateDatasetRuns"], e);
	}
	let T = _(e, ["experiment"]);
	T != null && g(n, ["experiment"], T);
	let E = _(e, ["fullFineTuningSpec"]);
	E != null && g(n, ["fullFineTuningSpec"], E);
	let D = _(e, ["labels"]);
	D != null && g(n, ["labels"], D);
	let O = _(e, ["outputUri"]);
	O != null && g(n, ["outputUri"], O);
	let k = _(e, ["pipelineJob"]);
	k != null && g(n, ["pipelineJob"], k);
	let A = _(e, ["serviceAccount"]);
	A != null && g(n, ["serviceAccount"], A);
	let j = _(e, ["tunedModelDisplayName"]);
	j != null && g(n, ["tunedModelDisplayName"], j);
	let M = _(e, ["tuningJobState"]);
	M != null && g(n, ["tuningJobState"], M);
	let ee = _(e, ["veoTuningSpec"]);
	ee != null && g(n, ["veoTuningSpec"], ee);
	let te = _(e, ["distillationSamplingSpec"]);
	te != null && g(n, ["distillationSamplingSpec"], te);
	let ne = _(e, ["tuningJobMetadata"]);
	return ne != null && g(n, ["tuningJobMetadata"], ne), n;
}
function xu(e, t) {
	let n = {}, r = _(e, ["sdkHttpResponse"]);
	r != null && g(n, ["sdkHttpResponse"], r);
	let i = _(e, ["name"]);
	i != null && g(n, ["name"], i);
	let a = _(e, ["metadata"]);
	a != null && g(n, ["metadata"], a);
	let o = _(e, ["done"]);
	o != null && g(n, ["done"], o);
	let s = _(e, ["error"]);
	return s != null && g(n, ["error"], s), n;
}
function Su(e, t) {
	let n = {}, r = _(e, ["gcsUri"]);
	r != null && g(n, ["validationDatasetUri"], r);
	let i = _(e, ["vertexDatasetResource"]);
	return i != null && g(n, ["validationDatasetUri"], i), n;
}
var Cu = class extends m {
	constructor(e) {
		super(), this.apiClient = e, this.list = async (e = {}) => new H(V.PAGED_ITEM_TUNING_JOBS, (e) => this.listInternal(e), await this.listInternal(e), e), this.get = async (e) => await this.getInternal(e), this.tune = async (e) => {
			if (this.apiClient.isVertexAI()) {
				if (e.baseModel.startsWith("projects/")) {
					let t = { tunedModelName: e.baseModel };
					e.config?.preTunedModelCheckpointId && (t.checkpointId = e.config.preTunedModelCheckpointId);
					let n = Object.assign(Object.assign({}, e), { preTunedModel: t });
					return n.baseModel = void 0, await this.tuneInternal(n);
				}
				{
					let t = Object.assign({}, e);
					return await this.tuneInternal(t);
				}
			}
			{
				let t = Object.assign({}, e), n = await this.tuneMldevInternal(t), r = "";
				return n.metadata !== void 0 && n.metadata.tunedModel !== void 0 ? r = n.metadata.tunedModel : n.name !== void 0 && n.name.includes("/operations/") && (r = n.name.split("/operations/")[0]), {
					name: r,
					state: Ae.JOB_STATE_QUEUED
				};
			}
		};
	}
	async getInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = fu(e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => bu(e));
		}
		{
			let i = du(e);
			return n = h("{name}", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => yu(e));
		}
	}
	async listInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = mu(e);
			return n = h("tuningJobs", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "GET",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = hu(e), n = new Et();
				return Object.assign(n, t), n;
			});
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async cancel(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = iu(e);
			return n = h("{name}:cancel", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = ou(e), n = new Dt();
				return Object.assign(n, t), n;
			});
		}
		{
			let i = ru(e);
			return n = h("{name}:cancel", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => {
				let t = au(e), n = new Dt();
				return Object.assign(n, t), n;
			});
		}
	}
	async tuneInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) {
			let i = uu(e, e);
			return n = h("tuningJobs", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => bu(e));
		}
		throw Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
	}
	async tuneMldevInternal(e) {
		let t, n = "", r = {};
		if (this.apiClient.isVertexAI()) throw Error("This method is only supported by the Gemini Developer API.");
		{
			let i = lu(e);
			return n = h("tunedModels", i._url), r = i._query, delete i._url, delete i._query, t = this.apiClient.request({
				path: n,
				queryParams: r,
				body: JSON.stringify(i),
				httpMethod: "POST",
				httpOptions: e.config?.httpOptions,
				abortSignal: e.config?.abortSignal
			}).then((e) => e.json().then((t) => {
				let n = t;
				return n.sdkHttpResponse = { headers: e.headers }, n;
			})), t.then((e) => xu(e));
		}
	}
}, wu = class {
	async download(e, t) {
		throw Error("Download to file is not supported in the browser, please use a browser compliant download like an <a> tag.");
	}
}, Tu = 8388608, Eu = 3, Du = 1e3, Ou = 2, ku = "x-goog-upload-status";
async function Au(e, t, n, r) {
	let i = await Mu(e, t, n, r), a = await i?.json();
	if (i?.headers?.[ku] !== "final") throw Error("Failed to upload file: Upload status is not finalized.");
	return a.file;
}
async function ju(e, t, n, r) {
	let i = await Mu(e, t, n, r), a = await i?.json();
	if (i?.headers?.[ku] !== "final") throw Error("Failed to upload file: Upload status is not finalized.");
	let o = M(a), s = new Vt();
	return Object.assign(s, o), s;
}
async function Mu(e, t, n, r) {
	let i = t, a = r?.baseUrl || n.clientOptions.httpOptions?.baseUrl;
	if (a) {
		let e = new URL(a), n = new URL(t);
		n.protocol = e.protocol, n.host = e.host, n.port = e.port, i = n.toString();
	}
	let o = 0, s = 0, c = new pt(new Response()), l = "upload";
	for (o = e.size; s < o;) {
		let t = Math.min(Tu, o - s), a = e.slice(s, s + t);
		s + t >= o && (l += ", finalize");
		let u = 0, d = Du;
		for (; u < Eu;) {
			let e = Object.assign(Object.assign({}, r?.headers || {}), {
				"X-Goog-Upload-Command": l,
				"X-Goog-Upload-Offset": String(s),
				"Content-Length": String(t)
			});
			if (c = await n.request({
				path: "",
				body: a,
				httpMethod: "POST",
				httpOptions: Object.assign(Object.assign({}, r), {
					apiVersion: "",
					baseUrl: i,
					headers: e
				})
			}), c?.headers?.[ku]) break;
			u++, await Pu(d), d *= Ou;
		}
		if (s += t, c?.headers?.[ku] !== "active") break;
		if (o <= s) throw Error("All content has been uploaded, but the upload status is not finalized.");
	}
	return c;
}
async function Nu(e) {
	return {
		size: e.size,
		type: e.type
	};
}
function Pu(e) {
	return new Promise((t) => setTimeout(t, e));
}
var Fu = class {
	async upload(e, t, n, r) {
		if (typeof e == "string") throw Error("File path is not supported in browser uploader.");
		return await Au(e, t, n, r);
	}
	async uploadToFileSearchStore(e, t, n, r) {
		if (typeof e == "string") throw Error("File path is not supported in browser uploader.");
		return await ju(e, t, n, r);
	}
	async stat(e) {
		if (typeof e == "string") throw Error("File path is not supported in browser uploader.");
		return await Nu(e);
	}
}, Iu = class {
	create(e, t, n) {
		return new Lu(e, t, n);
	}
}, Lu = class {
	constructor(e, t, n) {
		this.url = e, this.headers = t, this.callbacks = n;
	}
	connect() {
		this.ws = new WebSocket(this.url), this.ws.onopen = this.callbacks.onopen, this.ws.onerror = this.callbacks.onerror, this.ws.onclose = this.callbacks.onclose, this.ws.onmessage = this.callbacks.onmessage;
	}
	send(e) {
		if (this.ws === void 0) throw Error("WebSocket is not connected");
		this.ws.send(e);
	}
	close() {
		if (this.ws === void 0) throw Error("WebSocket is not connected");
		this.ws.close();
	}
}, Ru = "x-goog-api-key", zu = class {
	constructor(e) {
		this.apiKey = e;
	}
	async addAuthHeaders(e, t) {
		if (e.get(Ru) === null) {
			if (this.apiKey.startsWith("auth_tokens/")) throw Error("Ephemeral tokens are only supported by the live API.");
			if (!this.apiKey) throw Error("API key is missing. Please provide a valid API key.");
			e.append(Ru, this.apiKey);
		}
	}
}, Bu = class {
	getNextGenClient() {
		let e = this.httpOptions;
		if (this._nextGenClient === void 0) {
			let e = this.httpOptions;
			this._nextGenClient = new $({
				baseURL: this.apiClient.getBaseUrl(),
				apiKey: this.apiKey,
				apiVersion: this.apiClient.getApiVersion(),
				clientAdapter: this.apiClient,
				defaultHeaders: this.apiClient.getDefaultHeaders(),
				timeout: e?.timeout,
				maxRetries: e?.retryOptions?.attempts
			});
		}
		return e?.extraBody && console.warn("GoogleGenAI.interactions: Client level httpOptions.extraBody is not supported by the interactions client and will be ignored."), this._nextGenClient;
	}
	get interactions() {
		return this._interactions === void 0 ? (console.warn("GoogleGenAI.interactions: Interactions usage is experimental and may change in future versions."), this._interactions = this.getNextGenClient().interactions, this._interactions) : this._interactions;
	}
	get webhooks() {
		return this._webhooks === void 0 && (this._webhooks = this.getNextGenClient().webhooks), this._webhooks;
	}
	constructor(e) {
		if (e.apiKey == null) throw Error("An API Key must be set when running in a browser");
		if (e.project || e.location) throw Error("Vertex AI project based authentication is not supported on browser runtimes. Please do not provide a project or location.");
		this.vertexai = e.vertexai ?? !1, this.apiKey = e.apiKey;
		let t = p(e.httpOptions, e.vertexai, void 0, void 0);
		t && (e.httpOptions ? e.httpOptions.baseUrl = t : e.httpOptions = { baseUrl: t }), this.apiVersion = e.apiVersion, this.httpOptions = e.httpOptions;
		let n = new zu(this.apiKey);
		this.apiClient = new Ns({
			auth: n,
			apiVersion: this.apiVersion,
			apiKey: this.apiKey,
			vertexai: this.vertexai,
			httpOptions: this.httpOptions,
			userAgentExtra: "gl-node/web",
			uploader: new Fu(),
			downloader: new wu()
		}), this.models = new sc(this.apiClient), this.live = new Xs(this.apiClient, n, new Iu()), this.batches = new xr(this.apiClient), this.chats = new ui(this.models, this.apiClient), this.caches = new ii(this.apiClient), this.files = new Ci(this.apiClient), this.operations = new cc(this.apiClient), this.authTokens = new Dc(this.apiClient), this.tunings = new Cu(this.apiClient), this.fileSearchStores = new Fc(this.apiClient);
	}
};
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/api/google-shared.js
function Vu(e) {
	return e.thought === !0;
}
function Hu(e, t) {
	return typeof t == "string" && t.length > 0 ? t : e;
}
var Uu = /^[A-Za-z0-9+/]+={0,2}$/;
function Wu(e) {
	return !e || e.length % 4 != 0 ? !1 : Uu.test(e);
}
function Gu(e, t) {
	return e && Wu(t) ? t : void 0;
}
function Ku(e) {
	let t = qu(e);
	return e.startsWith("claude-") || e.startsWith("gpt-oss-") || t !== void 0 && t >= 3;
}
function qu(e) {
	let t = e.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
	if (t) return Number.parseInt(t[1], 10);
}
function Ju(e) {
	let t = qu(e);
	return t === void 0 || t >= 3;
}
function Yu(e, t) {
	let n = [], r = a(t.messages, e, (t) => Ku(e.id) ? t.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) : t);
	for (let t of r) if (t.role === "user") {
		if (typeof t.content == "string") n.push({
			role: "user",
			parts: [{ text: i(t.content) }]
		});
		else {
			let e = t.content.map((e) => e.type === "text" ? { text: i(e.text) } : { inlineData: {
				mimeType: e.mimeType,
				data: e.data
			} });
			if (e.length === 0) continue;
			n.push({
				role: "user",
				parts: e
			});
		}
	} else if (t.role === "assistant") {
		let r = [], a = t.provider === e.provider && t.model === e.id;
		for (let n of t.content) if (n.type === "text") {
			let e = Gu(a, n.textSignature);
			if ((!n.text || n.text.trim() === "") && !e) continue;
			r.push({
				text: i(n.text),
				...e && { thoughtSignature: e }
			});
		} else if (n.type === "thinking") {
			if (a) {
				let e = Gu(a, n.thinkingSignature);
				if ((!n.thinking || n.thinking.trim() === "") && !e) continue;
				r.push({
					thought: !0,
					text: i(n.thinking),
					...e && { thoughtSignature: e }
				});
			} else {
				if (!n.thinking || n.thinking.trim() === "") continue;
				r.push({ text: i(n.thinking) });
			}
		} else if (n.type === "toolCall") {
			let t = Gu(a, n.thoughtSignature), i = {
				functionCall: {
					name: n.name,
					args: n.arguments ?? {},
					...Ku(e.id) ? { id: n.id } : {}
				},
				...t && { thoughtSignature: t }
			};
			r.push(i);
		}
		if (r.length === 0) continue;
		n.push({
			role: "model",
			parts: r
		});
	} else if (t.role === "toolResult") {
		let r = t.content.filter((e) => e.type === "text").map((e) => e.text).join("\n"), a = e.input.includes("image") ? t.content.filter((e) => e.type === "image") : [], o = r.length > 0, s = a.length > 0, c = Ju(e.id), l = o ? i(r) : s ? "(see attached image)" : "", u = a.map((e) => ({ inlineData: {
			mimeType: e.mimeType,
			data: e.data
		} })), d = Ku(e.id), f = { functionResponse: {
			name: t.toolName,
			response: t.isError ? { error: l } : { output: l },
			...s && c && { parts: u },
			...d ? { id: t.toolCallId } : {}
		} }, p = n[n.length - 1];
		p?.role === "user" && p.parts?.some((e) => e.functionResponse) ? p.parts.push(f) : n.push({
			role: "user",
			parts: [f]
		}), s && !c && n.push({
			role: "user",
			parts: [{ text: "Tool result image:" }, ...u]
		});
	}
	return n;
}
var Xu = /* @__PURE__ */ new Set([
	"$schema",
	"$id",
	"$anchor",
	"$dynamicAnchor",
	"$vocabulary",
	"$comment",
	"$defs",
	"definitions"
]);
function Zu(e) {
	if (typeof e != "object" || !e || Array.isArray(e)) return e;
	let t = {};
	for (let [n, r] of Object.entries(e)) Xu.has(n) || (t[n] = Zu(r));
	return t;
}
function Qu(e, t = !1) {
	if (e.length !== 0) return [{ functionDeclarations: e.map((e) => ({
		name: e.name,
		description: e.description,
		...t ? { parameters: Zu(e.parameters) } : { parametersJsonSchema: e.parameters }
	})) }];
}
function $u(e) {
	let t = qu(e);
	return t !== void 0 && t >= 3;
}
function ed(e) {
	switch (e) {
		case "auto": return pe.AUTO;
		case "none": return pe.NONE;
		case "any": return pe.ANY;
		default: return pe.AUTO;
	}
}
function td(e, t, n) {
	let i = e.some((e) => r(e, n) === !0);
	return t === "none" || t === "any" ? ed(t) : i ? pe.VALIDATED : t ? ed(t) : void 0;
}
function nd(e) {
	switch (e) {
		case P.STOP: return "stop";
		case P.MAX_TOKENS: return "length";
		case P.BLOCKLIST:
		case P.PROHIBITED_CONTENT:
		case P.SPII:
		case P.SAFETY:
		case P.IMAGE_SAFETY:
		case P.IMAGE_PROHIBITED_CONTENT:
		case P.IMAGE_RECITATION:
		case P.IMAGE_OTHER:
		case P.RECITATION:
		case P.FINISH_REASON_UNSPECIFIED:
		case P.OTHER:
		case P.LANGUAGE:
		case P.MALFORMED_FUNCTION_CALL:
		case P.UNEXPECTED_TOOL_CALL:
		case P.NO_IMAGE: return "error";
		default: throw Error(`Unhandled stop reason: ${e}`);
	}
}
function rd(e, t) {
	return n(async () => {
		try {
			return await e();
		} catch (e) {
			throw e instanceof Error && "status" in e && !("headers" in e) && (e.headers = void 0), e;
		}
	}, {
		maxRetries: t?.maxRetries,
		maxRetryDelayMs: t?.maxRetryDelayMs,
		signal: t?.signal
	});
}
//#endregion
export { td as a, $u as c, me as d, nd as i, Bu as l, Qu as n, Hu as o, Vu as r, rd as s, Yu as t, Re as u };
