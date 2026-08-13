import { r as e } from "./rolldown-runtime-CJfroGDQ.js";
import { n as t, r as n } from "./mistral-conversations-00_qW8L7.js";
//#region node_modules/@opentelemetry/api/build/esm/platform/browser/globalThis.js
var r = typeof globalThis == "object" ? globalThis : typeof self == "object" ? self : typeof window == "object" ? window : typeof global == "object" ? global : {}, i = "1.9.0", a = /^(\d+)\.(\d+)\.(\d+)(-(.+))?$/;
function o(e) {
	var t = /* @__PURE__ */ new Set([e]), n = /* @__PURE__ */ new Set(), r = e.match(a);
	if (!r) return function() {
		return !1;
	};
	var i = {
		major: +r[1],
		minor: +r[2],
		patch: +r[3],
		prerelease: r[4]
	};
	if (i.prerelease != null) return function(t) {
		return t === e;
	};
	function o(e) {
		return n.add(e), !1;
	}
	function s(e) {
		return t.add(e), !0;
	}
	return function(e) {
		if (t.has(e)) return !0;
		if (n.has(e)) return !1;
		var r = e.match(a);
		if (!r) return o(e);
		var c = {
			major: +r[1],
			minor: +r[2],
			patch: +r[3],
			prerelease: r[4]
		};
		return c.prerelease != null || i.major !== c.major ? o(e) : i.major === 0 ? i.minor === c.minor && i.patch <= c.patch ? s(e) : o(e) : i.minor <= c.minor ? s(e) : o(e);
	};
}
var s = o(i), c = i.split(".")[0], l = Symbol.for("opentelemetry.js.api." + c), u = r;
function d(e, t, n, r) {
	r === void 0 && (r = !1);
	var a = u[l] = u[l] ?? { version: i };
	if (!r && a[e]) {
		var o = /* @__PURE__ */ Error("@opentelemetry/api: Attempted duplicate registration of API: " + e);
		return n.error(o.stack || o.message), !1;
	}
	if (a.version !== "1.9.0") {
		var o = /* @__PURE__ */ Error("@opentelemetry/api: Registration of version v" + a.version + " for " + e + " does not match previously registered API v" + i);
		return n.error(o.stack || o.message), !1;
	}
	return a[e] = t, n.debug("@opentelemetry/api: Registered a global for " + e + " v" + i + "."), !0;
}
function f(e) {
	var t = u[l]?.version;
	if (!(!t || !s(t))) return u[l]?.[e];
}
function p(e, t) {
	t.debug("@opentelemetry/api: Unregistering a global for " + e + " v" + i + ".");
	var n = u[l];
	n && delete n[e];
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/diag/ComponentLogger.js
var ee = function(e, t) {
	var n = typeof Symbol == "function" && e[Symbol.iterator];
	if (!n) return e;
	var r = n.call(e), i, a = [], o;
	try {
		for (; (t === void 0 || t-- > 0) && !(i = r.next()).done;) a.push(i.value);
	} catch (e) {
		o = { error: e };
	} finally {
		try {
			i && !i.done && (n = r.return) && n.call(r);
		} finally {
			if (o) throw o.error;
		}
	}
	return a;
}, te = function(e, t, n) {
	if (n || arguments.length === 2) for (var r = 0, i = t.length, a; r < i; r++) (a || !(r in t)) && (a ||= Array.prototype.slice.call(t, 0, r), a[r] = t[r]);
	return e.concat(a || Array.prototype.slice.call(t));
}, ne = function() {
	function e(e) {
		this._namespace = e.namespace || "DiagComponentLogger";
	}
	return e.prototype.debug = function() {
		var e = [...arguments];
		return m("debug", this._namespace, e);
	}, e.prototype.error = function() {
		var e = [...arguments];
		return m("error", this._namespace, e);
	}, e.prototype.info = function() {
		var e = [...arguments];
		return m("info", this._namespace, e);
	}, e.prototype.warn = function() {
		var e = [...arguments];
		return m("warn", this._namespace, e);
	}, e.prototype.verbose = function() {
		var e = [...arguments];
		return m("verbose", this._namespace, e);
	}, e;
}();
function m(e, t, n) {
	var r = f("diag");
	if (r) return n.unshift(t), r[e].apply(r, te([], ee(n), !1));
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/diag/types.js
var h;
(function(e) {
	e[e.NONE = 0] = "NONE", e[e.ERROR = 30] = "ERROR", e[e.WARN = 50] = "WARN", e[e.INFO = 60] = "INFO", e[e.DEBUG = 70] = "DEBUG", e[e.VERBOSE = 80] = "VERBOSE", e[e.ALL = 9999] = "ALL";
})(h ||= {});
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/diag/internal/logLevelLogger.js
function re(e, t) {
	e < h.NONE ? e = h.NONE : e > h.ALL && (e = h.ALL), t ||= {};
	function n(n, r) {
		var i = t[n];
		return typeof i == "function" && e >= r ? i.bind(t) : function() {};
	}
	return {
		error: n("error", h.ERROR),
		warn: n("warn", h.WARN),
		info: n("info", h.INFO),
		debug: n("debug", h.DEBUG),
		verbose: n("verbose", h.VERBOSE)
	};
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/api/diag.js
var ie = function(e, t) {
	var n = typeof Symbol == "function" && e[Symbol.iterator];
	if (!n) return e;
	var r = n.call(e), i, a = [], o;
	try {
		for (; (t === void 0 || t-- > 0) && !(i = r.next()).done;) a.push(i.value);
	} catch (e) {
		o = { error: e };
	} finally {
		try {
			i && !i.done && (n = r.return) && n.call(r);
		} finally {
			if (o) throw o.error;
		}
	}
	return a;
}, ae = function(e, t, n) {
	if (n || arguments.length === 2) for (var r = 0, i = t.length, a; r < i; r++) (a || !(r in t)) && (a ||= Array.prototype.slice.call(t, 0, r), a[r] = t[r]);
	return e.concat(a || Array.prototype.slice.call(t));
}, oe = "diag", g = function() {
	function e() {
		function e(e) {
			return function() {
				var t = [...arguments], n = f("diag");
				if (n) return n[e].apply(n, ae([], ie(t), !1));
			};
		}
		var t = this;
		t.setLogger = function(e, n) {
			if (n === void 0 && (n = { logLevel: h.INFO }), e === t) {
				var r = /* @__PURE__ */ Error("Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation");
				return t.error(r.stack ?? r.message), !1;
			}
			typeof n == "number" && (n = { logLevel: n });
			var i = f("diag"), a = re(n.logLevel ?? h.INFO, e);
			if (i && !n.suppressOverrideMessage) {
				var o = (/* @__PURE__ */ Error()).stack ?? "<failed to generate stacktrace>";
				i.warn("Current logger will be overwritten from " + o), a.warn("Current logger will overwrite one already registered from " + o);
			}
			return d("diag", a, t, !0);
		}, t.disable = function() {
			p(oe, t);
		}, t.createComponentLogger = function(e) {
			return new ne(e);
		}, t.verbose = e("verbose"), t.debug = e("debug"), t.info = e("info"), t.warn = e("warn"), t.error = e("error");
	}
	return e.instance = function() {
		return this._instance ||= new e(), this._instance;
	}, e;
}(), se = function(e, t) {
	var n = typeof Symbol == "function" && e[Symbol.iterator];
	if (!n) return e;
	var r = n.call(e), i, a = [], o;
	try {
		for (; (t === void 0 || t-- > 0) && !(i = r.next()).done;) a.push(i.value);
	} catch (e) {
		o = { error: e };
	} finally {
		try {
			i && !i.done && (n = r.return) && n.call(r);
		} finally {
			if (o) throw o.error;
		}
	}
	return a;
}, ce = function(e) {
	var t = typeof Symbol == "function" && Symbol.iterator, n = t && e[t], r = 0;
	if (n) return n.call(e);
	if (e && typeof e.length == "number") return { next: function() {
		return e && r >= e.length && (e = void 0), {
			value: e && e[r++],
			done: !e
		};
	} };
	throw TypeError(t ? "Object is not iterable." : "Symbol.iterator is not defined.");
}, le = function() {
	function e(e) {
		this._entries = e ? new Map(e) : /* @__PURE__ */ new Map();
	}
	return e.prototype.getEntry = function(e) {
		var t = this._entries.get(e);
		if (t) return Object.assign({}, t);
	}, e.prototype.getAllEntries = function() {
		return Array.from(this._entries.entries()).map(function(e) {
			var t = se(e, 2);
			return [t[0], t[1]];
		});
	}, e.prototype.setEntry = function(t, n) {
		var r = new e(this._entries);
		return r._entries.set(t, n), r;
	}, e.prototype.removeEntry = function(t) {
		var n = new e(this._entries);
		return n._entries.delete(t), n;
	}, e.prototype.removeEntries = function() {
		for (var t, n, r = [], i = 0; i < arguments.length; i++) r[i] = arguments[i];
		var a = new e(this._entries);
		try {
			for (var o = ce(r), s = o.next(); !s.done; s = o.next()) {
				var c = s.value;
				a._entries.delete(c);
			}
		} catch (e) {
			t = { error: e };
		} finally {
			try {
				s && !s.done && (n = o.return) && n.call(o);
			} finally {
				if (t) throw t.error;
			}
		}
		return a;
	}, e.prototype.clear = function() {
		return new e();
	}, e;
}();
g.instance();
function ue(e) {
	return e === void 0 && (e = {}), new le(new Map(Object.entries(e)));
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/context/context.js
function de(e) {
	return Symbol.for(e);
}
var fe = new (function() {
	function e(t) {
		var n = this;
		n._currentContext = t ? new Map(t) : /* @__PURE__ */ new Map(), n.getValue = function(e) {
			return n._currentContext.get(e);
		}, n.setValue = function(t, r) {
			var i = new e(n._currentContext);
			return i._currentContext.set(t, r), i;
		}, n.deleteValue = function(t) {
			var r = new e(n._currentContext);
			return r._currentContext.delete(t), r;
		};
	}
	return e;
}())(), pe = {
	get: function(e, t) {
		if (e != null) return e[t];
	},
	keys: function(e) {
		return e == null ? [] : Object.keys(e);
	}
}, me = { set: function(e, t, n) {
	e != null && (e[t] = n);
} }, he = function(e, t) {
	var n = typeof Symbol == "function" && e[Symbol.iterator];
	if (!n) return e;
	var r = n.call(e), i, a = [], o;
	try {
		for (; (t === void 0 || t-- > 0) && !(i = r.next()).done;) a.push(i.value);
	} catch (e) {
		o = { error: e };
	} finally {
		try {
			i && !i.done && (n = r.return) && n.call(r);
		} finally {
			if (o) throw o.error;
		}
	}
	return a;
}, ge = function(e, t, n) {
	if (n || arguments.length === 2) for (var r = 0, i = t.length, a; r < i; r++) (a || !(r in t)) && (a ||= Array.prototype.slice.call(t, 0, r), a[r] = t[r]);
	return e.concat(a || Array.prototype.slice.call(t));
}, _e = function() {
	function e() {}
	return e.prototype.active = function() {
		return fe;
	}, e.prototype.with = function(e, t, n) {
		var r = [...arguments].slice(3);
		return t.call.apply(t, ge([n], he(r), !1));
	}, e.prototype.bind = function(e, t) {
		return t;
	}, e.prototype.enable = function() {
		return this;
	}, e.prototype.disable = function() {
		return this;
	}, e;
}(), ve = function(e, t) {
	var n = typeof Symbol == "function" && e[Symbol.iterator];
	if (!n) return e;
	var r = n.call(e), i, a = [], o;
	try {
		for (; (t === void 0 || t-- > 0) && !(i = r.next()).done;) a.push(i.value);
	} catch (e) {
		o = { error: e };
	} finally {
		try {
			i && !i.done && (n = r.return) && n.call(r);
		} finally {
			if (o) throw o.error;
		}
	}
	return a;
}, ye = function(e, t, n) {
	if (n || arguments.length === 2) for (var r = 0, i = t.length, a; r < i; r++) (a || !(r in t)) && (a ||= Array.prototype.slice.call(t, 0, r), a[r] = t[r]);
	return e.concat(a || Array.prototype.slice.call(t));
}, _ = "context", be = new _e(), v = function() {
	function e() {}
	return e.getInstance = function() {
		return this._instance ||= new e(), this._instance;
	}, e.prototype.setGlobalContextManager = function(e) {
		return d(_, e, g.instance());
	}, e.prototype.active = function() {
		return this._getContextManager().active();
	}, e.prototype.with = function(e, t, n) {
		for (var r, i = [], a = 3; a < arguments.length; a++) i[a - 3] = arguments[a];
		return (r = this._getContextManager()).with.apply(r, ye([
			e,
			t,
			n
		], ve(i), !1));
	}, e.prototype.bind = function(e, t) {
		return this._getContextManager().bind(e, t);
	}, e.prototype._getContextManager = function() {
		return f(_) || be;
	}, e.prototype.disable = function() {
		this._getContextManager().disable(), p(_, g.instance());
	}, e;
}(), xe;
(function(e) {
	e[e.NONE = 0] = "NONE", e[e.SAMPLED = 1] = "SAMPLED";
})(xe ||= {});
var Se = {
	traceId: "00000000000000000000000000000000",
	spanId: "0000000000000000",
	traceFlags: xe.NONE
}, y = function() {
	function e(e) {
		e === void 0 && (e = Se), this._spanContext = e;
	}
	return e.prototype.spanContext = function() {
		return this._spanContext;
	}, e.prototype.setAttribute = function(e, t) {
		return this;
	}, e.prototype.setAttributes = function(e) {
		return this;
	}, e.prototype.addEvent = function(e, t) {
		return this;
	}, e.prototype.addLink = function(e) {
		return this;
	}, e.prototype.addLinks = function(e) {
		return this;
	}, e.prototype.setStatus = function(e) {
		return this;
	}, e.prototype.updateName = function(e) {
		return this;
	}, e.prototype.end = function(e) {}, e.prototype.isRecording = function() {
		return !1;
	}, e.prototype.recordException = function(e, t) {}, e;
}(), b = de("OpenTelemetry Context Key SPAN");
function x(e) {
	return e.getValue(b) || void 0;
}
function Ce() {
	return x(v.getInstance().active());
}
function S(e, t) {
	return e.setValue(b, t);
}
function we(e) {
	return e.deleteValue(b);
}
function Te(e, t) {
	return S(e, new y(t));
}
function Ee(e) {
	return x(e)?.spanContext();
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/trace/spancontext-utils.js
var De = /^([0-9a-f]{32})$/i, Oe = /^[0-9a-f]{16}$/i;
function ke(e) {
	return De.test(e) && e !== "00000000000000000000000000000000";
}
function Ae(e) {
	return Oe.test(e) && e !== "0000000000000000";
}
function je(e) {
	return ke(e.traceId) && Ae(e.spanId);
}
function Me(e) {
	return new y(e);
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/trace/NoopTracer.js
var C = v.getInstance(), Ne = function() {
	function e() {}
	return e.prototype.startSpan = function(e, t, n) {
		if (n === void 0 && (n = C.active()), t?.root) return new y();
		var r = n && Ee(n);
		return Pe(r) && je(r) ? new y(r) : new y();
	}, e.prototype.startActiveSpan = function(e, t, n, r) {
		var i, a, o;
		if (!(arguments.length < 2)) {
			arguments.length === 2 ? o = t : arguments.length === 3 ? (i = t, o = n) : (i = t, a = n, o = r);
			var s = a ?? C.active(), c = this.startSpan(e, i, s), l = S(s, c);
			return C.with(l, o, void 0, c);
		}
	}, e;
}();
function Pe(e) {
	return typeof e == "object" && typeof e.spanId == "string" && typeof e.traceId == "string" && typeof e.traceFlags == "number";
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/trace/ProxyTracer.js
var Fe = new Ne(), Ie = function() {
	function e(e, t, n, r) {
		this._provider = e, this.name = t, this.version = n, this.options = r;
	}
	return e.prototype.startSpan = function(e, t, n) {
		return this._getTracer().startSpan(e, t, n);
	}, e.prototype.startActiveSpan = function(e, t, n, r) {
		var i = this._getTracer();
		return Reflect.apply(i.startActiveSpan, i, arguments);
	}, e.prototype._getTracer = function() {
		if (this._delegate) return this._delegate;
		var e = this._provider.getDelegateTracer(this.name, this.version, this.options);
		return e ? (this._delegate = e, this._delegate) : Fe;
	}, e;
}(), Le = new (function() {
	function e() {}
	return e.prototype.getTracer = function(e, t, n) {
		return new Ne();
	}, e;
}())(), Re = function() {
	function e() {}
	return e.prototype.getTracer = function(e, t, n) {
		return this.getDelegateTracer(e, t, n) ?? new Ie(this, e, t, n);
	}, e.prototype.getDelegate = function() {
		return this._delegate ?? Le;
	}, e.prototype.setDelegate = function(e) {
		this._delegate = e;
	}, e.prototype.getDelegateTracer = function(e, t, n) {
		return this._delegate?.getTracer(e, t, n);
	}, e;
}(), w;
(function(e) {
	e[e.UNSET = 0] = "UNSET", e[e.OK = 1] = "OK", e[e.ERROR = 2] = "ERROR";
})(w ||= {});
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/context-api.js
var T = v.getInstance(), ze = function() {
	function e() {}
	return e.prototype.inject = function(e, t) {}, e.prototype.extract = function(e, t) {
		return e;
	}, e.prototype.fields = function() {
		return [];
	}, e;
}(), E = de("OpenTelemetry Baggage Key");
function Be(e) {
	return e.getValue(E) || void 0;
}
function Ve() {
	return Be(v.getInstance().active());
}
function He(e, t) {
	return e.setValue(E, t);
}
function Ue(e) {
	return e.deleteValue(E);
}
//#endregion
//#region node_modules/@opentelemetry/api/build/esm/api/propagation.js
var D = "propagation", We = new ze(), Ge = function() {
	function e() {
		this.createBaggage = ue, this.getBaggage = Be, this.getActiveBaggage = Ve, this.setBaggage = He, this.deleteBaggage = Ue;
	}
	return e.getInstance = function() {
		return this._instance ||= new e(), this._instance;
	}, e.prototype.setGlobalPropagator = function(e) {
		return d(D, e, g.instance());
	}, e.prototype.inject = function(e, t, n) {
		return n === void 0 && (n = me), this._getGlobalPropagator().inject(e, t, n);
	}, e.prototype.extract = function(e, t, n) {
		return n === void 0 && (n = pe), this._getGlobalPropagator().extract(e, t, n);
	}, e.prototype.fields = function() {
		return this._getGlobalPropagator().fields();
	}, e.prototype.disable = function() {
		p(D, g.instance());
	}, e.prototype._getGlobalPropagator = function() {
		return f(D) || We;
	}, e;
}().getInstance(), O = "trace", k = function() {
	function e() {
		this._proxyTracerProvider = new Re(), this.wrapSpanContext = Me, this.isSpanContextValid = je, this.deleteSpan = we, this.getSpan = x, this.getActiveSpan = Ce, this.getSpanContext = Ee, this.setSpan = S, this.setSpanContext = Te;
	}
	return e.getInstance = function() {
		return this._instance ||= new e(), this._instance;
	}, e.prototype.setGlobalTracerProvider = function(e) {
		var t = d(O, this._proxyTracerProvider, g.instance());
		return t && this._proxyTracerProvider.setDelegate(e), t;
	}, e.prototype.getTracerProvider = function() {
		return f(O) || this._proxyTracerProvider;
	}, e.prototype.getTracer = function(e, t) {
		return this.getTracerProvider().getTracer(e, t);
	}, e.prototype.disable = function() {
		p(O, g.instance()), this._proxyTracerProvider = new Re();
	}, e;
}().getInstance(), Ke = "aspnetcore.diagnostics.exception.result", qe = "aborted", Je = "handled", Ye = "skipped", Xe = "unhandled", Ze = "aspnetcore.diagnostics.handler.type", Qe = "aspnetcore.rate_limiting.policy", $e = "aspnetcore.rate_limiting.result", et = "acquired", tt = "endpoint_limiter", nt = "global_limiter", rt = "request_canceled", it = "aspnetcore.request.is_unhandled", at = "aspnetcore.routing.is_fallback", ot = "aspnetcore.routing.match_status", st = "failure", ct = "success", lt = "aspnetcore.user.is_authenticated", ut = "client.address", dt = "client.port", ft = "code.column.number", pt = "code.file.path", mt = "code.function.name", ht = "code.line.number", gt = "code.stacktrace", _t = "container.id", vt = "container.image.name", yt = "container.image.repo_digests", bt = "container.image.tags", xt = "db.collection.name", St = "db.namespace", Ct = "db.operation.batch.size", wt = "db.operation.name", Tt = "db.query.summary", Et = "db.query.text", Dt = "db.response.status_code", Ot = "db.stored_procedure.name", kt = "db.system.name", At = "mariadb", jt = "microsoft.sql_server", Mt = "mysql", Nt = "postgresql", Pt = "deployment.environment.name", Ft = "development", It = "production", Lt = "staging", Rt = "test", zt = "dotnet.gc.heap.generation", Bt = "gen0", Vt = "gen1", Ht = "gen2", Ut = "error.type", Wt = "_OTHER", Gt = "exception.escaped", Kt = "exception.message", qt = "exception.stacktrace", Jt = "exception.type", Yt = (e) => `http.request.header.${e}`, Xt = "http.request.method", Zt = "_OTHER", Qt = "CONNECT", $t = "DELETE", en = "HEAD", tn = "OPTIONS", nn = "PATCH", rn = "POST", an = "TRACE", on = "http.request.method_original", sn = "http.request.resend_count", cn = (e) => `http.response.header.${e}`, A = "http.response.status_code", ln = "http.route", un = "jvm.gc.action", dn = "jvm.gc.name", fn = "jvm.memory.pool.name", pn = "jvm.memory.type", mn = "heap", hn = "non_heap", gn = "jvm.thread.daemon", _n = "jvm.thread.state", vn = "blocked", yn = "runnable", bn = "terminated", xn = "timed_waiting", Sn = "waiting", Cn = "k8s.cluster.name", wn = "k8s.cluster.uid", Tn = "k8s.container.name", En = "k8s.container.restart_count", Dn = (e) => `k8s.cronjob.annotation.${e}`, On = (e) => `k8s.cronjob.label.${e}`, kn = "k8s.cronjob.name", An = "k8s.cronjob.uid", jn = (e) => `k8s.daemonset.annotation.${e}`, Mn = (e) => `k8s.daemonset.label.${e}`, Nn = "k8s.daemonset.name", Pn = "k8s.daemonset.uid", Fn = (e) => `k8s.deployment.annotation.${e}`, In = (e) => `k8s.deployment.label.${e}`, Ln = "k8s.deployment.name", Rn = "k8s.deployment.uid", zn = (e) => `k8s.job.annotation.${e}`, Bn = (e) => `k8s.job.label.${e}`, Vn = "k8s.job.name", Hn = "k8s.job.uid", Un = (e) => `k8s.namespace.annotation.${e}`, Wn = (e) => `k8s.namespace.label.${e}`, Gn = "k8s.namespace.name", Kn = (e) => `k8s.node.annotation.${e}`, qn = (e) => `k8s.node.label.${e}`, Jn = "k8s.node.name", Yn = "k8s.node.uid", Xn = (e) => `k8s.pod.annotation.${e}`, Zn = "k8s.pod.hostname", Qn = "k8s.pod.ip", $n = (e) => `k8s.pod.label.${e}`, er = "k8s.pod.name", tr = "k8s.pod.start_time", nr = "k8s.pod.uid", rr = (e) => `k8s.replicaset.annotation.${e}`, ir = (e) => `k8s.replicaset.label.${e}`, ar = "k8s.replicaset.name", or = "k8s.replicaset.uid", sr = (e) => `k8s.statefulset.annotation.${e}`, cr = (e) => `k8s.statefulset.label.${e}`, lr = "k8s.statefulset.name", ur = "k8s.statefulset.uid", dr = "network.local.address", fr = "network.local.port", pr = "network.peer.address", mr = "network.peer.port", hr = "network.protocol.name", gr = "network.protocol.version", _r = "network.transport", vr = "pipe", yr = "quic", br = "unix", xr = "network.type", Sr = "ipv4", Cr = "ipv6", wr = "otel.event.name", Tr = "otel.scope.name", Er = "otel.scope.version", Dr = "otel.status_code", Or = "ERROR", kr = "otel.status_description", Ar = "server.address", jr = "server.port", Mr = "service.instance.id", Nr = "service.name", Pr = "service.namespace", Fr = "service.version", Ir = "signalr.connection.status", Lr = "app_shutdown", Rr = "normal_closure", zr = "timeout", Br = "signalr.transport", Vr = "long_polling", Hr = "server_sent_events", Ur = "web_sockets", Wr = "telemetry.distro.name", Gr = "telemetry.distro.version", Kr = "telemetry.sdk.language", qr = "dotnet", Jr = "erlang", Yr = "java", Xr = "kotlin", Zr = "nodejs", Qr = "python", $r = "ruby", ei = "rust", ti = "swift", ni = "webjs", ri = "telemetry.sdk.name", ii = "telemetry.sdk.version", ai = "url.fragment", oi = "url.full", si = "url.path", ci = "url.query", li = "url.scheme", ui = "user_agent.original", di = "aspnetcore.diagnostics.exceptions", fi = "aspnetcore.rate_limiting.active_request_leases", pi = "aspnetcore.rate_limiting.queued_requests", mi = "aspnetcore.rate_limiting.request.time_in_queue", hi = "aspnetcore.rate_limiting.request_lease.duration", gi = "aspnetcore.rate_limiting.requests", _i = "aspnetcore.routing.match_attempts", vi = "db.client.operation.duration", yi = "dotnet.assembly.count", bi = "dotnet.exceptions", xi = "dotnet.gc.collections", Si = "dotnet.gc.heap.total_allocated", Ci = "dotnet.gc.last_collection.heap.fragmentation.size", wi = "dotnet.gc.last_collection.heap.size", Ti = "dotnet.gc.last_collection.memory.committed_size", Ei = "dotnet.gc.pause.time", Di = "dotnet.jit.compilation.time", Oi = "dotnet.jit.compiled_il.size", ki = "dotnet.jit.compiled_methods", Ai = "dotnet.monitor.lock_contentions", ji = "dotnet.process.cpu.count", Mi = "dotnet.process.cpu.time", Ni = "dotnet.process.memory.working_set", Pi = "dotnet.thread_pool.queue.length", Fi = "dotnet.thread_pool.thread.count", Ii = "dotnet.thread_pool.work_item.count", Li = "dotnet.timer.count", Ri = "http.client.request.duration", zi = "http.server.request.duration", Bi = "jvm.class.count", Vi = "jvm.class.loaded", Hi = "jvm.class.unloaded", Ui = "jvm.cpu.count", Wi = "jvm.cpu.recent_utilization", Gi = "jvm.cpu.time", Ki = "jvm.gc.duration", qi = "jvm.memory.committed", Ji = "jvm.memory.limit", Yi = "jvm.memory.used", Xi = "jvm.memory.used_after_last_gc", Zi = "jvm.thread.count", Qi = "kestrel.active_connections", $i = "kestrel.active_tls_handshakes", ea = "kestrel.connection.duration", ta = "kestrel.queued_connections", na = "kestrel.queued_requests", ra = "kestrel.rejected_connections", ia = "kestrel.tls_handshake.duration", aa = "kestrel.upgraded_connections", oa = "signalr.server.active_connections", sa = "signalr.server.connection.duration", ca = "exception", la = "android.app.state", ua = "background", da = "created", fa = "foreground", pa = "android.os.api_level", ma = "android.state", ha = "background", ga = "created", _a = "foreground", va = "app.build_id", ya = "app.crash.id", ba = "app.installation.id", xa = "app.jank.frame_count", Sa = "app.jank.period", Ca = "app.jank.threshold", wa = "app.screen.coordinate.x", Ta = "app.screen.coordinate.y", Ea = "app.screen.id", Da = "app.screen.name", Oa = "app.widget.id", ka = "app.widget.name", Aa = "artifact.attestation.filename", ja = "artifact.attestation.hash", Ma = "artifact.attestation.id", Na = "artifact.filename", Pa = "artifact.hash", Fa = "artifact.purl", Ia = "artifact.version", La = "aspnetcore.authentication.result", Ra = "failure", za = "none", Ba = "success", Va = "aspnetcore.authentication.scheme", Ha = "aspnetcore.authorization.policy", Ua = "aspnetcore.authorization.result", Wa = "failure", Ga = "success", Ka = "aspnetcore.identity.error_code", qa = "aspnetcore.identity.password_check_result", Ja = "failure", Ya = "password_missing", Xa = "success", Za = "success_rehash_needed", Qa = "user_missing", $a = "aspnetcore.identity.result", eo = "failure", to = "success", no = "aspnetcore.identity.sign_in.result", ro = "failure", io = "locked_out", ao = "not_allowed", oo = "requires_two_factor", so = "success", co = "aspnetcore.identity.sign_in.type", lo = "external", uo = "passkey", fo = "password", po = "two_factor", mo = "two_factor_authenticator", ho = "two_factor_recovery_code", go = "aspnetcore.identity.token_purpose", _o = "_OTHER", vo = "change_email", yo = "change_phone_number", bo = "email_confirmation", xo = "reset_password", So = "two_factor", Co = "aspnetcore.identity.token_verified", wo = "failure", To = "success", Eo = "aspnetcore.identity.user.update_type", Do = "_OTHER", Oo = "access_failed", ko = "add_claims", Ao = "add_login", jo = "add_password", Mo = "add_to_roles", No = "change_email", Po = "change_password", Fo = "change_phone_number", Io = "confirm_email", Lo = "generate_new_two_factor_recovery_codes", Ro = "password_rehash", zo = "redeem_two_factor_recovery_code", Bo = "remove_authentication_token", Vo = "remove_claims", Ho = "remove_from_roles", Uo = "remove_login", Wo = "remove_passkey", Go = "remove_password", Ko = "replace_claim", qo = "reset_access_failed_count", Jo = "reset_authenticator_key", Yo = "reset_password", Xo = "security_stamp", Zo = "set_authentication_token", Qo = "set_email", $o = "set_lockout_enabled", es = "set_lockout_end_date", ts = "set_passkey", ns = "set_phone_number", rs = "set_two_factor_enabled", is = "update", as = "user_name", os = "aspnetcore.identity.user_type", ss = "aspnetcore.memory_pool.owner", cs = "aspnetcore.sign_in.is_persistent", ls = "aws.bedrock.guardrail.id", us = "aws.bedrock.knowledge_base.id", ds = "aws.dynamodb.attribute_definitions", fs = "aws.dynamodb.attributes_to_get", ps = "aws.dynamodb.consistent_read", ms = "aws.dynamodb.consumed_capacity", hs = "aws.dynamodb.count", gs = "aws.dynamodb.exclusive_start_table", _s = "aws.dynamodb.global_secondary_index_updates", vs = "aws.dynamodb.global_secondary_indexes", ys = "aws.dynamodb.index_name", bs = "aws.dynamodb.item_collection_metrics", xs = "aws.dynamodb.limit", Ss = "aws.dynamodb.local_secondary_indexes", Cs = "aws.dynamodb.projection", ws = "aws.dynamodb.provisioned_read_capacity", Ts = "aws.dynamodb.provisioned_write_capacity", Es = "aws.dynamodb.scan_forward", Ds = "aws.dynamodb.scanned_count", Os = "aws.dynamodb.segment", ks = "aws.dynamodb.select", As = "aws.dynamodb.table_count", js = "aws.dynamodb.table_names", Ms = "aws.dynamodb.total_segments", Ns = "aws.ecs.cluster.arn", Ps = "aws.ecs.container.arn", Fs = "aws.ecs.launchtype", Is = "fargate", Ls = "aws.ecs.task.arn", Rs = "aws.ecs.task.family", zs = "aws.ecs.task.id", Bs = "aws.ecs.task.revision", Vs = "aws.eks.cluster.arn", Hs = "aws.extended_request_id", Us = "aws.kinesis.stream_name", Ws = "aws.lambda.invoked_arn", Gs = "aws.lambda.resource_mapping.id", Ks = "aws.log.group.arns", qs = "aws.log.group.names", Js = "aws.log.stream.arns", Ys = "aws.log.stream.names", Xs = "aws.request_id", Zs = "aws.s3.bucket", Qs = "aws.s3.copy_source", $s = "aws.s3.delete", ec = "aws.s3.key", tc = "aws.s3.part_number", nc = "aws.s3.upload_id", rc = "aws.secretsmanager.secret.arn", ic = "aws.sns.topic.arn", ac = "aws.sqs.queue.url", oc = "aws.step_functions.activity.arn", sc = "aws.step_functions.state_machine.arn", cc = "az.namespace", lc = "az.service_request_id", uc = "azure.client.id", dc = "azure.cosmosdb.connection.mode", fc = "direct", pc = "gateway", mc = "azure.cosmosdb.consistency.level", hc = "BoundedStaleness", gc = "ConsistentPrefix", _c = "Eventual", vc = "Session", yc = "Strong", bc = "azure.cosmosdb.operation.contacted_regions", xc = "azure.cosmosdb.operation.request_charge", Sc = "azure.cosmosdb.request.body.size", Cc = "azure.cosmosdb.response.sub_status_code", wc = "azure.resource_group.name", Tc = "azure.resource_provider.namespace", Ec = "azure.service.request.id", Dc = "browser.brands", Oc = "browser.document.url.full", kc = "browser.language", Ac = "browser.mobile", jc = "browser.platform", Mc = "cassandra.consistency.level", Nc = "each_quorum", Pc = "local_one", Fc = "local_quorum", Ic = "local_serial", Lc = "quorum", Rc = "serial", zc = "three", Bc = "cassandra.coordinator.dc", Vc = "cassandra.coordinator.id", Hc = "cassandra.page.size", Uc = "cassandra.query.idempotent", Wc = "cassandra.speculative_execution.count", Gc = "cicd.pipeline.action.name", Kc = "BUILD", qc = "SYNC", Jc = "cicd.pipeline.name", Yc = "cicd.pipeline.result", Xc = "cancellation", Zc = "error", Qc = "failure", $c = "skip", el = "success", tl = "timeout", nl = "cicd.pipeline.run.id", rl = "cicd.pipeline.run.state", il = "executing", al = "finalizing", ol = "pending", sl = "cicd.pipeline.run.url.full", cl = "cicd.pipeline.task.name", ll = "cicd.pipeline.task.run.id", ul = "cicd.pipeline.task.run.result", dl = "cancellation", fl = "error", pl = "failure", ml = "skip", hl = "success", gl = "timeout", _l = "cicd.pipeline.task.run.url.full", vl = "cicd.pipeline.task.type", yl = "build", bl = "deploy", xl = "test", Sl = "cicd.system.component", Cl = "cicd.worker.id", wl = "cicd.worker.name", Tl = "cicd.worker.state", El = "available", Dl = "busy", Ol = "offline", kl = "cicd.worker.url.full", Al = "cloud.account.id", jl = "cloud.availability_zone", Ml = "cloud.platform", Nl = "akamai_cloud.compute", Pl = "alibaba_cloud_ecs", Fl = "alibaba_cloud_fc", Il = "alibaba_cloud_openshift", Ll = "aws_app_runner", Rl = "aws_ec2", zl = "aws_ecs", Bl = "aws_eks", Vl = "aws_elastic_beanstalk", Hl = "aws_lambda", Ul = "aws_openshift", Wl = "azure.aks", Gl = "azure.app_service", Kl = "azure.container_apps", ql = "azure.container_instances", Jl = "azure.functions", Yl = "azure.openshift", Xl = "azure.vm", Zl = "gcp.agent_engine", Ql = "gcp_app_engine", $l = "gcp_bare_metal_solution", eu = "gcp_cloud_functions", tu = "gcp_cloud_run", nu = "gcp_compute_engine", ru = "gcp_kubernetes_engine", iu = "gcp_openshift", au = "hetzner.cloud_server", ou = "ibm_cloud_openshift", su = "oracle_cloud_compute", cu = "oracle_cloud_oke", lu = "tencent_cloud_cvm", uu = "tencent_cloud_eks", du = "tencent_cloud_scf", fu = "vultr.cloud_compute", pu = "cloud.provider", mu = "akamai_cloud", hu = "alibaba_cloud", gu = "azure", _u = "heroku", vu = "hetzner", yu = "ibm_cloud", bu = "oracle_cloud", xu = "tencent_cloud", Su = "vultr", Cu = "cloud.region", wu = "cloud.resource_id", Tu = "cloudevents.event_id", Eu = "cloudevents.event_source", Du = "cloudevents.event_spec_version", Ou = "cloudevents.event_subject", ku = "cloudevents.event_type", Au = "cloudfoundry.app.id", ju = "cloudfoundry.app.instance.id", Mu = "cloudfoundry.app.name", Nu = "cloudfoundry.org.id", Pu = "cloudfoundry.org.name", Fu = "cloudfoundry.process.id", Iu = "cloudfoundry.process.type", Lu = "cloudfoundry.space.id", Ru = "cloudfoundry.space.name", zu = "cloudfoundry.system.id", Bu = "cloudfoundry.system.instance.id", Vu = "code.column", Hu = "code.filepath", Uu = "code.function", Wu = "code.lineno", Gu = "code.namespace", Ku = "container.command", qu = "container.command_args", Ju = "container.command_line", Yu = "container.cpu.state", Xu = "kernel", Zu = "system", Qu = "user", $u = "container.csi.plugin.name", ed = "container.csi.volume.id", td = "container.image.id", nd = (e) => `container.label.${e}`, rd = (e) => `container.labels.${e}`, id = "container.name", ad = "container.runtime", od = "container.runtime.description", sd = "container.runtime.name", cd = "container.runtime.version", ld = "cpu.logical_number", ud = "cpu.mode", dd = "idle", fd = "interrupt", pd = "iowait", md = "kernel", hd = "nice", gd = "steal", _d = "system", vd = "user", yd = "cpython.gc.generation", bd = "db.cassandra.consistency_level", xd = "each_quorum", Sd = "local_one", Cd = "local_quorum", wd = "local_serial", Td = "quorum", Ed = "serial", Dd = "three", Od = "db.cassandra.coordinator.dc", kd = "db.cassandra.coordinator.id", Ad = "db.cassandra.idempotence", jd = "db.cassandra.page_size", Md = "db.cassandra.speculative_execution_count", Nd = "db.cassandra.table", Pd = "db.client.connection.pool.name", Fd = "db.client.connection.state", Id = "idle", Ld = "used", Rd = "db.client.connections.pool.name", zd = "db.client.connections.state", Bd = "idle", Vd = "used", Hd = "db.connection_string", Ud = "db.cosmosdb.client_id", Wd = "db.cosmosdb.connection_mode", Gd = "direct", Kd = "gateway", qd = "db.cosmosdb.consistency_level", Jd = "BoundedStaleness", Yd = "ConsistentPrefix", Xd = "Eventual", Zd = "Session", Qd = "Strong", $d = "db.cosmosdb.container", ef = "db.cosmosdb.operation_type", tf = "batch", nf = "create", rf = "delete", af = "execute", of = "execute_javascript", sf = "head", cf = "head_feed", lf = "invalid", uf = "patch", df = "query", ff = "query_plan", pf = "read", mf = "read_feed", hf = "replace", gf = "upsert", _f = "db.cosmosdb.regions_contacted", vf = "db.cosmosdb.request_charge", yf = "db.cosmosdb.request_content_length", bf = "db.cosmosdb.status_code", xf = "db.cosmosdb.sub_status_code", Sf = "db.elasticsearch.cluster.name", Cf = "db.elasticsearch.node.name", wf = (e) => `db.elasticsearch.path_parts.${e}`, Tf = "db.instance.id", Ef = "db.jdbc.driver_classname", Df = "db.mongodb.collection", Of = "db.mssql.instance_name", kf = "db.name", Af = "db.operation", jf = (e) => `db.operation.parameter.${e}`, Mf = (e) => `db.query.parameter.${e}`, Nf = "db.redis.database_index", Pf = "db.response.returned_rows", Ff = "db.sql.table", If = "db.statement", Lf = "db.system", Rf = "adabas", zf = "cache", Bf = "cassandra", Vf = "clickhouse", Hf = "cloudscape", Uf = "cockroachdb", Wf = "coldfusion", Gf = "cosmosdb", Kf = "couchbase", qf = "couchdb", Jf = "derby", Yf = "dynamodb", Xf = "elasticsearch", Zf = "filemaker", Qf = "firebird", $f = "firstsql", ep = "geode", tp = "hanadb", np = "hbase", rp = "hive", ip = "hsqldb", ap = "influxdb", op = "informix", sp = "ingres", cp = "instantdb", lp = "interbase", up = "intersystems_cache", dp = "mariadb", fp = "maxdb", pp = "memcached", mp = "mongodb", hp = "mssql", gp = "mssqlcompact", _p = "mysql", vp = "neo4j", yp = "netezza", bp = "opensearch", xp = "oracle", Sp = "other_sql", Cp = "pervasive", wp = "pointbase", Tp = "postgresql", Ep = "progress", Dp = "redis", Op = "redshift", kp = "spanner", Ap = "sqlite", jp = "sybase", Mp = "teradata", Np = "trino", Pp = "vertica", Fp = "actian.ingres", Ip = "aws.dynamodb", Lp = "aws.redshift", Rp = "azure.cosmosdb", zp = "cassandra", Bp = "clickhouse", Vp = "cockroachdb", Hp = "couchbase", Up = "couchdb", Wp = "derby", Gp = "elasticsearch", Kp = "firebirdsql", qp = "gcp.spanner", Jp = "geode", Yp = "h2database", Xp = "hbase", Zp = "hive", Qp = "hsqldb", $p = "ibm.db2", em = "ibm.informix", tm = "ibm.netezza", nm = "influxdb", rm = "instantdb", im = "intersystems.cache", am = "memcached", om = "mongodb", sm = "neo4j", cm = "opensearch", lm = "oracle.db", um = "other_sql", dm = "redis", fm = "sap.hana", pm = "sap.maxdb", mm = "softwareag.adabas", hm = "sqlite", gm = "teradata", _m = "trino", vm = "db.user", ym = "deployment.environment", bm = "deployment.id", xm = "deployment.name", Sm = "deployment.status", Cm = "failed", wm = "succeeded", Tm = "destination.address", Em = "destination.port", Dm = "device.id", Om = "device.manufacturer", km = "device.model.identifier", Am = "device.model.name", jm = "disk.io.direction", Mm = "read", Nm = "write", Pm = "dns.answers", Fm = "dns.question.name", Im = "elasticsearch.node.name", Lm = "enduser.id", Rm = "enduser.pseudo.id", zm = "enduser.role", Bm = "enduser.scope", Vm = "error.message", Hm = "event.name", Um = "faas.coldstart", Wm = "faas.cron", Gm = "faas.document.collection", Km = "faas.document.name", qm = "faas.document.operation", Jm = "delete", Ym = "edit", Xm = "insert", Zm = "faas.document.time", Qm = "faas.instance", $m = "faas.invocation_id", eh = "faas.invoked_name", th = "faas.invoked_provider", nh = "alibaba_cloud", rh = "azure", ih = "tencent_cloud", ah = "faas.invoked_region", oh = "faas.max_memory", sh = "faas.name", ch = "faas.time", lh = "faas.trigger", uh = "datasource", dh = "http", fh = "other", ph = "pubsub", mh = "timer", hh = "faas.version", gh = "feature_flag.context.id", _h = "feature_flag.error.message", vh = "feature_flag.evaluation.error.message", yh = "feature_flag.evaluation.reason", bh = "cached", xh = "default", Sh = "disabled", Ch = "error", wh = "split", Th = "stale", Eh = "static", Dh = "targeting_match", Oh = "unknown", kh = "feature_flag.key", Ah = "feature_flag.provider.name", jh = "feature_flag.result.reason", Mh = "cached", Nh = "default", Ph = "disabled", Fh = "error", Ih = "split", Lh = "stale", Rh = "static", zh = "targeting_match", Bh = "unknown", Vh = "feature_flag.result.value", Hh = "feature_flag.result.variant", Uh = "feature_flag.set.id", Wh = "feature_flag.variant", Gh = "feature_flag.version", Kh = "file.accessed", qh = "file.attributes", Jh = "file.changed", Yh = "file.created", Xh = "file.directory", Zh = "file.extension", Qh = "file.fork_name", $h = "file.group.id", eg = "file.group.name", tg = "file.inode", ng = "file.lock.mechanism", rg = "file.lock.mode", ig = "file.lock.type", ag = "read", og = "write", sg = "file.mode", cg = "file.modified", lg = "file.name", ug = "file.owner.id", dg = "file.owner.name", fg = "file.path", pg = "file.size", mg = "file.symbolic_link.target_path", hg = "gcp.apphub.application.container", gg = "gcp.apphub.application.id", _g = "gcp.apphub.application.location", vg = "gcp.apphub.service.criticality_type", yg = "HIGH", bg = "MEDIUM", xg = "MISSION_CRITICAL", Sg = "gcp.apphub.service.environment_type", Cg = "DEVELOPMENT", wg = "PRODUCTION", Tg = "STAGING", Eg = "TEST", Dg = "gcp.apphub.service.id", Og = "gcp.apphub.workload.criticality_type", kg = "HIGH", Ag = "MEDIUM", jg = "MISSION_CRITICAL", Mg = "gcp.apphub.workload.environment_type", Ng = "DEVELOPMENT", Pg = "PRODUCTION", Fg = "STAGING", Ig = "TEST", Lg = "gcp.apphub.workload.id", Rg = "gcp.apphub_destination.application.container", zg = "gcp.apphub_destination.application.id", Bg = "gcp.apphub_destination.application.location", Vg = "gcp.apphub_destination.service.criticality_type", Hg = "HIGH", Ug = "MEDIUM", Wg = "MISSION_CRITICAL", Gg = "gcp.apphub_destination.service.environment_type", Kg = "DEVELOPMENT", qg = "PRODUCTION", Jg = "STAGING", Yg = "TEST", Xg = "gcp.apphub_destination.service.id", Zg = "gcp.apphub_destination.workload.criticality_type", Qg = "HIGH", $g = "MEDIUM", e_ = "MISSION_CRITICAL", t_ = "gcp.apphub_destination.workload.environment_type", n_ = "DEVELOPMENT", r_ = "PRODUCTION", i_ = "STAGING", a_ = "TEST", o_ = "gcp.apphub_destination.workload.id", s_ = "gcp.client.service", c_ = "gcp.cloud_run.job.execution", l_ = "gcp.cloud_run.job.task_index", u_ = "gcp.gce.instance.hostname", d_ = (e) => `gcp.gce.instance.labels.${e}`, f_ = "gcp.gce.instance.name", p_ = "gcp.gce.instance_group_manager.name", m_ = "gcp.gce.instance_group_manager.region", h_ = "gcp.gce.instance_group_manager.zone", g_ = "gen_ai.agent.description", j = "gen_ai.agent.id", __ = "gen_ai.agent.name", v_ = "gen_ai.agent.version", y_ = "gen_ai.completion", M = "gen_ai.conversation.id", b_ = "gen_ai.data_source.id", x_ = "gen_ai.embeddings.dimension.count", S_ = "gen_ai.evaluation.explanation", C_ = "gen_ai.evaluation.name", w_ = "gen_ai.evaluation.score.label", T_ = "gen_ai.evaluation.score.value", N = "gen_ai.input.messages", E_ = "gen_ai.openai.request.response_format", D_ = "json_object", O_ = "json_schema", k_ = "text", A_ = "gen_ai.openai.request.seed", j_ = "gen_ai.openai.request.service_tier", M_ = "auto", N_ = "default", P_ = "gen_ai.openai.response.service_tier", F_ = "gen_ai.openai.response.system_fingerprint", P = "gen_ai.operation.name", F = "chat", I_ = "create_agent", L_ = "embeddings", R_ = "execute_tool", z_ = "generate_content", I = "invoke_agent", B_ = "invoke_workflow", V_ = "retrieval", H_ = "text_completion", L = "gen_ai.output.messages", U_ = "gen_ai.output.type", W_ = "image", G_ = "json", K_ = "speech", q_ = "text", J_ = "gen_ai.prompt", Y_ = "gen_ai.prompt.name", R = "gen_ai.provider.name", X_ = "anthropic", Z_ = "aws.bedrock", Q_ = "azure.ai.inference", $_ = "azure.ai.openai", ev = "cohere", tv = "deepseek", nv = "gcp.gemini", rv = "gcp.gen_ai", iv = "gcp.vertex_ai", av = "groq", ov = "ibm.watsonx.ai", z = "mistral_ai", sv = "openai", cv = "perplexity", lv = "x_ai", uv = "gen_ai.request.choice.count", dv = "gen_ai.request.encoding_formats", fv = "gen_ai.request.frequency_penalty", pv = "gen_ai.request.max_tokens", B = "gen_ai.request.model", mv = "gen_ai.request.presence_penalty", hv = "gen_ai.request.seed", gv = "gen_ai.request.stop_sequences", _v = "gen_ai.request.stream", vv = "gen_ai.request.temperature", yv = "gen_ai.request.top_k", bv = "gen_ai.request.top_p", xv = "gen_ai.response.finish_reasons", V = "gen_ai.response.id", H = "gen_ai.response.model", Sv = "gen_ai.response.time_to_first_chunk", Cv = "gen_ai.retrieval.documents", wv = "gen_ai.retrieval.query.text", Tv = "gen_ai.system", Ev = "anthropic", Dv = "aws.bedrock", Ov = "az.ai.inference", kv = "az.ai.openai", Av = "azure.ai.inference", jv = "azure.ai.openai", Mv = "cohere", Nv = "deepseek", Pv = "gcp.gemini", Fv = "gcp.gen_ai", Iv = "gcp.vertex_ai", Lv = "gemini", Rv = "groq", zv = "ibm.watsonx.ai", Bv = "mistral_ai", Vv = "openai", Hv = "perplexity", Uv = "vertex_ai", U = "gen_ai.system_instructions", Wv = "gen_ai.token.type", Gv = "input", Kv = "output", qv = "output", Jv = "gen_ai.tool.call.arguments", Yv = "gen_ai.tool.call.id", Xv = "gen_ai.tool.call.result", Zv = "gen_ai.tool.definitions", Qv = "gen_ai.tool.description", $v = "gen_ai.tool.name", ey = "gen_ai.tool.type", ty = "gen_ai.usage.cache_creation.input_tokens", ny = "gen_ai.usage.cache_read.input_tokens", ry = "gen_ai.usage.completion_tokens", iy = "gen_ai.usage.input_tokens", ay = "gen_ai.usage.output_tokens", oy = "gen_ai.usage.prompt_tokens", sy = "gen_ai.usage.reasoning.output_tokens", cy = "gen_ai.workflow.name", ly = "geo.continent.code", uy = "geo.country.iso_code", dy = "geo.locality.name", fy = "geo.location.lat", py = "geo.location.lon", my = "geo.postal_code", hy = "geo.region.iso_code", gy = "go.cpu.detailed_state", _y = "go.cpu.state", vy = "idle", yy = "scavenge", by = "user", xy = "go.memory.detailed_type", Sy = "go.memory.type", Cy = "other", wy = "stack", Ty = "graphql.document", Ey = "graphql.operation.name", Dy = "graphql.operation.type", Oy = "mutation", ky = "query", Ay = "subscription", jy = "heroku.app.id", My = "heroku.release.commit", Ny = "heroku.release.creation_timestamp", Py = "host.arch", Fy = "amd64", Iy = "arm32", Ly = "arm64", Ry = "ia64", zy = "ppc32", By = "ppc64", Vy = "s390x", Hy = "host.cpu.cache.l2.size", Uy = "host.cpu.family", Wy = "host.cpu.model.id", Gy = "host.cpu.model.name", Ky = "host.cpu.stepping", qy = "host.cpu.vendor.id", Jy = "host.id", Yy = "host.image.id", Xy = "host.image.name", Zy = "host.image.version", Qy = "host.ip", $y = "host.mac", eb = "host.name", tb = "host.type", nb = "http.client_ip", rb = "http.connection.state", ib = "active", ab = "idle", ob = "http.flavor", sb = "QUIC", cb = "SPDY", lb = "http.host", ub = "http.method", db = "http.request.body.size", fb = "QUERY", pb = "http.request.size", mb = "http.request_content_length", hb = "http.request_content_length_uncompressed", gb = "http.response.body.size", _b = "http.response.size", vb = "http.response_content_length", yb = "http.response_content_length_uncompressed", bb = "http.scheme", xb = "http.server_name", Sb = "http.status_code", Cb = "http.target", wb = "http.url", Tb = "http.user_agent", Eb = "hw.battery.capacity", Db = "hw.battery.chemistry", Ob = "hw.battery.state", kb = "charging", Ab = "discharging", jb = "hw.bios_version", Mb = "hw.driver_version", Nb = "hw.enclosure.type", Pb = "hw.firmware_version", Fb = "hw.gpu.task", Ib = "decoder", Lb = "encoder", Rb = "general", zb = "hw.id", Bb = "hw.limit_type", Vb = "critical", Hb = "degraded", Ub = "high.critical", Wb = "high.degraded", Gb = "low.critical", Kb = "low.degraded", qb = "throttled", Jb = "turbo", Yb = "hw.logical_disk.raid_level", Xb = "hw.logical_disk.state", Zb = "free", Qb = "used", $b = "hw.memory.type", ex = "hw.model", tx = "hw.name", nx = "hw.network.logical_addresses", rx = "hw.network.physical_address", ix = "hw.parent", ax = "hw.physical_disk.smart_attribute", ox = "hw.physical_disk.state", sx = "remaining", cx = "hw.physical_disk.type", lx = "hw.sensor_location", ux = "hw.serial_number", dx = "hw.state", fx = "degraded", px = "failed", mx = "needs_cleaning", hx = "predicted_failure", gx = "hw.tape_drive.operation_type", _x = "clean", vx = "mount", yx = "unmount", bx = "hw.type", xx = "battery", Sx = "disk_controller", Cx = "enclosure", wx = "logical_disk", Tx = "memory", Ex = "network", Dx = "physical_disk", Ox = "power_supply", kx = "tape_drive", Ax = "temperature", jx = "voltage", Mx = "hw.vendor", Nx = "ios.app.state", Px = "active", Fx = "background", Ix = "foreground", Lx = "inactive", Rx = "terminate", zx = "ios.state", Bx = "active", Vx = "background", Hx = "foreground", Ux = "inactive", Wx = "terminate", Gx = "jsonrpc.protocol.version", Kx = "jsonrpc.request.id", qx = "jvm.buffer.pool.name", Jx = "jvm.gc.cause", Yx = "k8s.container.ephemeral_storage.fs_type", Xx = "logs", Zx = "rootfs", Qx = "k8s.container.status.last_terminated_reason", $x = "k8s.container.status.reason", eS = "Completed", tS = "ContainerCannotRun", nS = "ContainerCreating", rS = "CrashLoopBackOff", iS = "CreateContainerConfigError", aS = "ErrImagePull", oS = "Error", sS = "ImagePullBackOff", cS = "OOMKilled", lS = "k8s.container.status.state", uS = "running", dS = "terminated", fS = "waiting", pS = "k8s.hpa.metric.type", mS = "k8s.hpa.name", hS = "k8s.hpa.scaletargetref.api_version", gS = "k8s.hpa.scaletargetref.kind", _S = "k8s.hpa.scaletargetref.name", vS = "k8s.hpa.uid", yS = "k8s.hugepage.size", bS = "k8s.namespace.phase", xS = "active", SS = "terminating", CS = "k8s.node.condition.status", wS = "false", TS = "true", ES = "unknown", DS = "k8s.node.condition.type", OS = "DiskPressure", kS = "MemoryPressure", AS = "NetworkUnavailable", jS = "PIDPressure", MS = "Ready", NS = "k8s.node.system_container.name", PS = (e) => `k8s.persistentvolume.annotation.${e}`, FS = (e) => `k8s.persistentvolume.label.${e}`, IS = "k8s.persistentvolume.name", LS = "k8s.persistentvolume.reclaim_policy", RS = "Delete", zS = "Recycle", BS = "Retain", VS = "k8s.persistentvolume.status.phase", HS = "Available", US = "Bound", WS = "Failed", GS = "Pending", KS = "Released", qS = "k8s.persistentvolume.uid", JS = (e) => `k8s.persistentvolumeclaim.annotation.${e}`, YS = (e) => `k8s.persistentvolumeclaim.label.${e}`, XS = "k8s.persistentvolumeclaim.name", ZS = "k8s.persistentvolumeclaim.status.phase", QS = "Bound", $S = "Lost", eC = "Pending", tC = "k8s.persistentvolumeclaim.uid", nC = (e) => `k8s.pod.labels.${e}`, rC = "k8s.pod.status.phase", iC = "Failed", aC = "Pending", oC = "Running", sC = "Succeeded", cC = "Unknown", lC = "k8s.pod.status.reason", uC = "Evicted", dC = "NodeAffinity", fC = "NodeLost", pC = "Shutdown", mC = "UnexpectedAdmissionError", hC = "k8s.replicationcontroller.name", gC = "k8s.replicationcontroller.uid", _C = "k8s.resourcequota.name", vC = "k8s.resourcequota.resource_name", yC = "k8s.resourcequota.uid", bC = (e) => `k8s.service.annotation.${e}`, xC = "k8s.service.endpoint.address_type", SC = "FQDN", CC = "IPv4", wC = "IPv6", TC = "k8s.service.endpoint.condition", EC = "ready", DC = "serving", OC = "terminating", kC = "k8s.service.endpoint.zone", AC = (e) => `k8s.service.label.${e}`, jC = "k8s.service.name", MC = "k8s.service.publish_not_ready_addresses", NC = (e) => `k8s.service.selector.${e}`, PC = "k8s.service.traffic_distribution", FC = "k8s.service.type", IC = "ClusterIP", LC = "ExternalName", RC = "LoadBalancer", zC = "NodePort", BC = "k8s.service.uid", VC = "k8s.storageclass.name", HC = "k8s.volume.name", UC = "k8s.volume.type", WC = "configMap", GC = "downwardAPI", KC = "emptyDir", qC = "local", JC = "persistentVolumeClaim", YC = "secret", XC = "linux.memory.slab.state", ZC = "reclaimable", QC = "unreclaimable", $C = "log.file.name", ew = "log.file.name_resolved", tw = "log.file.path", nw = "log.file.path_resolved", rw = "log.iostream", iw = "stderr", aw = "stdout", ow = "log.record.original", sw = "log.record.uid", cw = "mainframe.lpar.name", lw = "mcp.method.name", uw = "completion/complete", dw = "elicitation/create", fw = "initialize", pw = "logging/setLevel", mw = "notifications/cancelled", hw = "notifications/initialized", gw = "notifications/message", _w = "notifications/progress", vw = "notifications/prompts/list_changed", yw = "notifications/resources/list_changed", bw = "notifications/resources/updated", xw = "notifications/roots/list_changed", Sw = "notifications/tools/list_changed", Cw = "ping", ww = "prompts/get", Tw = "prompts/list", Ew = "resources/list", Dw = "resources/read", Ow = "resources/subscribe", kw = "resources/templates/list", Aw = "resources/unsubscribe", jw = "roots/list", Mw = "sampling/createMessage", Nw = "tools/call", Pw = "tools/list", Fw = "mcp.protocol.version", Iw = "mcp.resource.uri", Lw = "mcp.session.id", Rw = "message.compressed_size", zw = "message.id", Bw = "message.type", Vw = "RECEIVED", Hw = "SENT", Uw = "message.uncompressed_size", Ww = "messaging.batch.message_count", Gw = "messaging.client.id", Kw = "messaging.consumer.group.name", qw = "messaging.destination.anonymous", Jw = "messaging.destination.name", Yw = "messaging.destination.partition.id", Xw = "messaging.destination.subscription.name", Zw = "messaging.destination.template", Qw = "messaging.destination.temporary", $w = "messaging.destination_publish.anonymous", eT = "messaging.destination_publish.name", tT = "messaging.eventhubs.consumer.group", nT = "messaging.eventhubs.message.enqueued_time", rT = "messaging.gcp_pubsub.message.ack_deadline", iT = "messaging.gcp_pubsub.message.ack_id", aT = "messaging.gcp_pubsub.message.delivery_attempt", oT = "messaging.gcp_pubsub.message.ordering_key", sT = "messaging.kafka.consumer.group", cT = "messaging.kafka.destination.partition", lT = "messaging.kafka.message.key", uT = "messaging.kafka.message.offset", dT = "messaging.kafka.message.tombstone", fT = "messaging.kafka.offset", pT = "messaging.message.body.size", mT = "messaging.message.conversation_id", hT = "messaging.message.envelope.size", gT = "messaging.message.id", _T = "messaging.operation", vT = "messaging.operation.name", yT = "messaging.operation.type", bT = "create", xT = "deliver", ST = "process", CT = "publish", wT = "receive", TT = "send", ET = "settle", DT = "messaging.rabbitmq.destination.routing_key", OT = "messaging.rabbitmq.message.delivery_tag", kT = "messaging.rocketmq.client_group", AT = "messaging.rocketmq.consumption_model", jT = "broadcasting", MT = "clustering", NT = "messaging.rocketmq.message.delay_time_level", PT = "messaging.rocketmq.message.delivery_timestamp", FT = "messaging.rocketmq.message.group", IT = "messaging.rocketmq.message.keys", LT = "messaging.rocketmq.message.tag", RT = "messaging.rocketmq.message.type", zT = "delay", BT = "fifo", VT = "normal", HT = "transaction", UT = "messaging.rocketmq.namespace", WT = "messaging.servicebus.destination.subscription_name", GT = "messaging.servicebus.disposition_status", KT = "abandon", qT = "complete", JT = "dead_letter", YT = "defer", XT = "messaging.servicebus.message.delivery_count", ZT = "messaging.servicebus.message.enqueued_time", QT = "messaging.system", $T = "activemq", eE = "aws.sns", tE = "aws_sqs", nE = "eventgrid", rE = "eventhubs", iE = "gcp_pubsub", aE = "kafka", oE = "pulsar", sE = "rabbitmq", cE = "rocketmq", lE = "servicebus", uE = "net.host.ip", dE = "net.host.name", fE = "net.host.port", pE = "net.peer.ip", mE = "net.peer.name", hE = "net.peer.port", gE = "net.protocol.name", _E = "net.protocol.version", vE = "net.sock.family", yE = "inet", bE = "inet6", xE = "unix", SE = "net.sock.host.addr", CE = "net.sock.host.port", wE = "net.sock.peer.addr", TE = "net.sock.peer.name", EE = "net.sock.peer.port", DE = "net.transport", OE = "inproc", kE = "ip_tcp", AE = "ip_udp", jE = "other", ME = "pipe", NE = "network.carrier.icc", PE = "network.carrier.mcc", FE = "network.carrier.mnc", IE = "network.carrier.name", LE = "network.connection.state", RE = "close_wait", zE = "closed", BE = "closing", VE = "established", HE = "fin_wait_1", UE = "fin_wait_2", WE = "last_ack", GE = "listen", KE = "syn_received", qE = "syn_sent", JE = "time_wait", YE = "network.connection.subtype", XE = "cdma", ZE = "cdma2000_1xrtt", QE = "edge", $E = "ehrpd", eD = "evdo_0", tD = "evdo_a", nD = "evdo_b", rD = "gprs", iD = "hsdpa", aD = "hspa", oD = "hspap", sD = "hsupa", cD = "iden", lD = "iwlan", uD = "lte_ca", dD = "nrnsa", fD = "td_scdma", pD = "umts", mD = "network.connection.type", hD = "cell", gD = "unavailable", _D = "unknown", vD = "wifi", yD = "wired", bD = "network.interface.name", xD = "network.io.direction", SD = "receive", CD = "transmit", wD = "nfs.operation.name", TD = "nfs.server.repcache.status", ED = "nodejs.eventloop.state", DD = "active", OD = "idle", kD = "oci.manifest.digest", AD = "onc_rpc.procedure.name", jD = "onc_rpc.procedure.number", MD = "onc_rpc.program.name", ND = "onc_rpc.version", PD = "openai.api.type", FD = "chat_completions", ID = "responses", LD = "openai.request.service_tier", RD = "auto", zD = "default", BD = "openai.response.service_tier", VD = "openai.response.system_fingerprint", HD = "openshift.clusterquota.name", UD = "openshift.clusterquota.uid", WD = "opentracing.ref_type", GD = "child_of", KD = "follows_from", qD = "oracle.db.domain", JD = "oracle.db.instance.name", YD = "oracle.db.name", XD = "oracle.db.pdb", ZD = "oracle.db.service", QD = "oracle_cloud.realm", $D = "os.build_id", eO = "os.description", tO = "os.name", nO = "os.type", rO = "darwin", iO = "dragonflybsd", aO = "freebsd", oO = "hpux", sO = "linux", cO = "netbsd", lO = "openbsd", uO = "solaris", dO = "windows", fO = "z_os", pO = "os.version", mO = "otel.component.name", hO = "otel.component.type", gO = "batching_log_processor", _O = "batching_span_processor", vO = "otlp_grpc_log_exporter", yO = "otlp_grpc_metric_exporter", bO = "otlp_grpc_span_exporter", xO = "otlp_http_json_log_exporter", SO = "otlp_http_json_metric_exporter", CO = "otlp_http_json_span_exporter", wO = "otlp_http_log_exporter", TO = "otlp_http_metric_exporter", EO = "otlp_http_span_exporter", DO = "periodic_metric_reader", OO = "prometheus_http_text_metric_exporter", kO = "simple_log_processor", AO = "simple_span_processor", jO = "zipkin_http_span_exporter", MO = "otel.library.name", NO = "otel.library.version", PO = "otel.scope.schema_url", FO = "otel.span.parent.origin", IO = "local", LO = "none", RO = "remote", zO = "otel.span.sampling_result", BO = "DROP", VO = "RECORD_AND_SAMPLE", HO = "RECORD_ONLY", UO = "peer.service", WO = "pool.name", GO = "pprof.location.is_folded", KO = "pprof.mapping.has_filenames", qO = "pprof.mapping.has_functions", JO = "pprof.mapping.has_inline_frames", YO = "pprof.mapping.has_line_numbers", XO = "pprof.profile.comment", ZO = "pprof.profile.doc_url", QO = "pprof.profile.drop_frames", $O = "pprof.profile.keep_frames", ek = "pprof.scope.default_sample_type", tk = "pprof.scope.sample_type_order", nk = "process.args_count", rk = "process.command", ik = "process.command_args", ak = "process.command_line", ok = "process.context_switch.type", sk = "involuntary", ck = "voluntary", lk = "process.cpu.state", uk = "system", dk = "user", fk = "wait", pk = "process.creation.time", mk = (e) => `process.environment_variable.${e}`, hk = "process.executable.build_id.gnu", gk = "process.executable.build_id.go", _k = "process.executable.build_id.htlhash", vk = "process.executable.build_id.profiling", yk = "process.executable.name", bk = "process.executable.path", xk = "process.exit.code", Sk = "process.exit.time", Ck = "process.group_leader.pid", wk = "process.interactive", Tk = "process.linux.cgroup", Ek = "process.owner", Dk = "process.paging.fault_type", Ok = "major", kk = "minor", Ak = "process.parent_pid", jk = "process.pid", Mk = "process.real_user.id", Nk = "process.real_user.name", Pk = "process.runtime.description", Fk = "process.runtime.name", Ik = "process.runtime.version", Lk = "process.saved_user.id", Rk = "process.saved_user.name", zk = "process.session_leader.pid", Bk = "process.state", Vk = "defunct", Hk = "running", Uk = "sleeping", Wk = "stopped", Gk = "process.title", Kk = "process.user.id", qk = "process.user.name", Jk = "process.vpid", Yk = "process.working_directory", Xk = "profile.frame.type", Zk = "beam", Qk = "cpython", $k = "dotnet", eA = "kernel", tA = "luajit", nA = "native", rA = "perl", iA = "ruby", aA = "rust", oA = "v8js", sA = "rpc.connect_rpc.error_code", cA = "aborted", lA = "already_exists", uA = "cancelled", dA = "data_loss", fA = "deadline_exceeded", pA = "failed_precondition", mA = "internal", hA = "invalid_argument", gA = "not_found", _A = "out_of_range", vA = "permission_denied", yA = "resource_exhausted", bA = "unauthenticated", xA = "unavailable", SA = "unimplemented", CA = "unknown", wA = (e) => `rpc.connect_rpc.request.metadata.${e}`, TA = (e) => `rpc.connect_rpc.response.metadata.${e}`, EA = (e) => `rpc.grpc.request.metadata.${e}`, DA = (e) => `rpc.grpc.response.metadata.${e}`, OA = "rpc.grpc.status_code", kA = "rpc.jsonrpc.error_code", AA = "rpc.jsonrpc.error_message", jA = "rpc.jsonrpc.request_id", MA = "rpc.jsonrpc.version", NA = "rpc.message.compressed_size", PA = "rpc.message.id", FA = "rpc.message.type", IA = "RECEIVED", LA = "SENT", RA = "rpc.message.uncompressed_size", zA = "rpc.method", BA = "rpc.method_original", VA = (e) => `rpc.request.metadata.${e}`, HA = (e) => `rpc.response.metadata.${e}`, UA = "rpc.response.status_code", WA = "rpc.service", GA = "rpc.system", KA = "apache_dubbo", qA = "connect_rpc", JA = "dotnet_wcf", YA = "grpc", XA = "java_rmi", ZA = "jsonrpc", QA = "onc_rpc", $A = "rpc.system.name", ej = "connectrpc", tj = "dubbo", nj = "grpc", rj = "jsonrpc", ij = "security_rule.category", aj = "security_rule.description", oj = "security_rule.license", sj = "security_rule.name", cj = "security_rule.reference", lj = "security_rule.ruleset.name", uj = "security_rule.uuid", dj = "security_rule.version", fj = "service.criticality", pj = "critical", mj = "high", hj = "medium", gj = "service.peer.name", _j = "service.peer.namespace", vj = "session.id", yj = "session.previous_id", bj = "source.address", xj = "source.port", Sj = "state", Cj = "idle", wj = "used", Tj = "system.cpu.logical_number", Ej = "system.cpu.state", Dj = "idle", Oj = "interrupt", kj = "iowait", Aj = "nice", jj = "steal", Mj = "system", Nj = "user", Pj = "system.device", Fj = "system.filesystem.mode", Ij = "system.filesystem.mountpoint", Lj = "system.filesystem.state", Rj = "free", zj = "reserved", Bj = "used", Vj = "system.filesystem.type", Hj = "exfat", Uj = "ext4", Wj = "fat32", Gj = "hfsplus", Kj = "ntfs", qj = "refs", Jj = "system.memory.linux.hugepages.state", Yj = "free", Xj = "used", Zj = "system.memory.linux.slab.state", Qj = "reclaimable", $j = "unreclaimable", eM = "system.memory.state", tM = "buffers", nM = "cached", rM = "free", iM = "shared", aM = "used", oM = "system.network.state", sM = "close", cM = "close_wait", lM = "closing", uM = "delete", dM = "established", fM = "fin_wait_1", pM = "fin_wait_2", mM = "last_ack", hM = "listen", gM = "syn_recv", _M = "syn_sent", vM = "time_wait", yM = "system.paging.direction", bM = "system.paging.fault.type", xM = "major", SM = "minor", CM = "system.paging.state", wM = "free", TM = "used", EM = "system.paging.type", DM = "major", OM = "minor", kM = "system.process.status", AM = "defunct", jM = "running", MM = "sleeping", NM = "stopped", PM = "system.processes.status", FM = "defunct", IM = "running", LM = "sleeping", RM = "stopped", zM = "test.case.name", BM = "test.case.result.status", VM = "fail", HM = "pass", UM = "test.suite.name", WM = "test.suite.run.status", GM = "aborted", KM = "failure", qM = "in_progress", JM = "skipped", YM = "success", XM = "timed_out", ZM = "thread.id", QM = "thread.name", $M = "tls.cipher", eN = "tls.client.certificate", tN = "tls.client.certificate_chain", nN = "tls.client.hash.md5", rN = "tls.client.hash.sha1", iN = "tls.client.hash.sha256", aN = "tls.client.issuer", oN = "tls.client.ja3", sN = "tls.client.not_after", cN = "tls.client.not_before", lN = "tls.client.server_name", uN = "tls.client.subject", dN = "tls.client.supported_ciphers", fN = "tls.curve", pN = "tls.established", mN = "tls.next_protocol", hN = "tls.protocol.name", gN = "tls.protocol.version", _N = "tls.resumed", vN = "tls.server.certificate", yN = "tls.server.certificate_chain", bN = "tls.server.hash.md5", xN = "tls.server.hash.sha1", SN = "tls.server.hash.sha256", CN = "tls.server.issuer", wN = "tls.server.ja3s", TN = "tls.server.not_after", EN = "tls.server.not_before", DN = "tls.server.subject", ON = "url.domain", kN = "url.extension", AN = "url.original", jN = "url.port", MN = "url.registered_domain", NN = "url.subdomain", PN = "url.template", FN = "url.top_level_domain", IN = "user.email", LN = "user.full_name", RN = "user.hash", zN = "user.id", BN = "user.name", VN = "user.roles", HN = "user_agent.name", UN = "user_agent.os.name", WN = "user_agent.os.version", GN = "user_agent.synthetic.type", KN = "test", qN = "user_agent.version", JN = "v8js.gc.type", YN = "incremental", XN = "major", ZN = "minor", QN = "weakcb", $N = "v8js.heap.space.name", eP = "code_space", tP = "large_object_space", nP = "map_space", rP = "new_space", iP = "old_space", aP = "v8js.resource.type", oP = "Immediate", sP = "TCPServerWrap", cP = "TCPWrap", lP = "Timeout", uP = "TTYWrap", dP = "vcs.change.id", fP = "vcs.change.state", pP = "closed", mP = "merged", hP = "open", gP = "vcs.change.title", _P = "vcs.line_change.type", vP = "added", yP = "removed", bP = "vcs.owner.name", xP = "vcs.provider.name", SP = "bitbucket", CP = "gitea", wP = "github", TP = "gitlab", EP = "gittea", DP = "vcs.ref.base.name", OP = "vcs.ref.base.revision", kP = "vcs.ref.base.type", AP = "branch", jP = "vcs.ref.head.name", MP = "vcs.ref.head.revision", NP = "vcs.ref.head.type", PP = "branch", FP = "vcs.ref.type", IP = "branch", LP = "vcs.repository.change.id", RP = "vcs.repository.change.title", zP = "vcs.repository.name", BP = "vcs.repository.ref.name", VP = "vcs.repository.ref.revision", HP = "vcs.repository.ref.type", UP = "branch", WP = "vcs.repository.url.full", GP = "vcs.revision_delta.direction", KP = "ahead", qP = "behind", JP = "webengine.description", YP = "webengine.name", XP = "webengine.version", ZP = "zos.smf.id", QP = "zos.sysplex.name", $P = "aspnetcore.authentication.authenticate.duration", eF = "aspnetcore.authentication.challenges", tF = "aspnetcore.authentication.forbids", nF = "aspnetcore.authentication.sign_ins", rF = "aspnetcore.authentication.sign_outs", iF = "aspnetcore.authorization.attempts", aF = "aspnetcore.identity.sign_in.authenticate.duration", oF = "aspnetcore.identity.sign_in.check_password_attempts", sF = "aspnetcore.identity.sign_in.sign_ins", cF = "aspnetcore.identity.sign_in.sign_outs", lF = "aspnetcore.identity.sign_in.two_factor_clients_forgotten", uF = "aspnetcore.identity.sign_in.two_factor_clients_remembered", dF = "aspnetcore.identity.user.check_password_attempts", fF = "aspnetcore.identity.user.create.duration", pF = "aspnetcore.identity.user.delete.duration", mF = "aspnetcore.identity.user.generated_tokens", hF = "aspnetcore.identity.user.update.duration", gF = "aspnetcore.identity.user.verify_token_attempts", _F = "aspnetcore.memory_pool.allocated", vF = "aspnetcore.memory_pool.evicted", yF = "aspnetcore.memory_pool.pooled", bF = "aspnetcore.memory_pool.rented", xF = "azure.cosmosdb.client.active_instance.count", SF = "azure.cosmosdb.client.operation.request_charge", CF = "cicd.pipeline.run.active", wF = "cicd.pipeline.run.duration", TF = "cicd.pipeline.run.errors", EF = "cicd.system.errors", DF = "cicd.worker.count", OF = "container.cpu.time", kF = "container.cpu.usage", AF = "container.disk.io", jF = "container.filesystem.available", MF = "container.filesystem.capacity", NF = "container.filesystem.usage", PF = "container.memory.available", FF = "container.memory.paging.faults", IF = "container.memory.rss", LF = "container.memory.usage", RF = "container.memory.working_set", zF = "container.network.io", BF = "container.uptime", VF = "cpu.frequency", HF = "cpu.time", UF = "cpu.utilization", WF = "cpython.gc.collected_objects", GF = "cpython.gc.collections", KF = "cpython.gc.uncollectable_objects", qF = "db.client.connection.count", JF = "db.client.connection.create_time", YF = "db.client.connection.idle.max", XF = "db.client.connection.idle.min", ZF = "db.client.connection.max", QF = "db.client.connection.pending_requests", $F = "db.client.connection.timeouts", eI = "db.client.connection.use_time", tI = "db.client.connection.wait_time", nI = "db.client.connections.create_time", rI = "db.client.connections.idle.max", iI = "db.client.connections.idle.min", aI = "db.client.connections.max", oI = "db.client.connections.pending_requests", sI = "db.client.connections.timeouts", cI = "db.client.connections.usage", lI = "db.client.connections.use_time", uI = "db.client.connections.wait_time", dI = "db.client.cosmosdb.active_instance.count", fI = "db.client.cosmosdb.operation.request_charge", pI = "db.client.response.returned_rows", mI = "dns.lookup.duration", hI = "faas.coldstarts", gI = "faas.cpu_usage", _I = "faas.errors", vI = "faas.init_duration", yI = "faas.invocations", bI = "faas.invoke_duration", xI = "faas.mem_usage", SI = "faas.net_io", CI = "faas.timeouts", wI = "gen_ai.client.operation.duration", TI = "gen_ai.client.operation.time_per_output_chunk", EI = "gen_ai.client.operation.time_to_first_chunk", DI = "gen_ai.client.token.usage", OI = "gen_ai.server.request.duration", kI = "gen_ai.server.time_per_output_token", AI = "gen_ai.server.time_to_first_token", jI = "go.config.gogc", MI = "go.cpu.time", NI = "go.goroutine.count", PI = "go.memory.allocated", FI = "go.memory.allocations", II = "go.memory.gc.cycles", LI = "go.memory.gc.goal", RI = "go.memory.gc.pause.duration", zI = "go.memory.limit", BI = "go.memory.used", VI = "go.processor.limit", HI = "go.schedule.duration", UI = "http.client.active_requests", WI = "http.client.connection.duration", GI = "http.client.open_connections", KI = "http.client.request.body.size", qI = "http.client.response.body.size", JI = "http.server.active_requests", YI = "http.server.request.body.size", XI = "http.server.response.body.size", ZI = "hw.battery.charge", QI = "hw.battery.charge.limit", $I = "hw.battery.time_left", eL = "hw.cpu.speed", tL = "hw.cpu.speed.limit", nL = "hw.energy", rL = "hw.errors", iL = "hw.fan.speed", aL = "hw.fan.speed.limit", oL = "hw.fan.speed_ratio", sL = "hw.gpu.io", cL = "hw.gpu.memory.limit", lL = "hw.gpu.memory.usage", uL = "hw.gpu.memory.utilization", dL = "hw.gpu.utilization", fL = "hw.host.ambient_temperature", pL = "hw.host.energy", mL = "hw.host.heating_margin", hL = "hw.host.power", gL = "hw.logical_disk.limit", _L = "hw.logical_disk.usage", vL = "hw.logical_disk.utilization", yL = "hw.memory.size", bL = "hw.network.bandwidth.limit", xL = "hw.network.bandwidth.utilization", SL = "hw.network.io", CL = "hw.network.packets", wL = "hw.network.up", TL = "hw.physical_disk.endurance_utilization", EL = "hw.physical_disk.size", DL = "hw.physical_disk.smart", OL = "hw.power", kL = "hw.power_supply.limit", AL = "hw.power_supply.usage", jL = "hw.power_supply.utilization", ML = "hw.status", NL = "hw.tape_drive.operations", PL = "hw.temperature", FL = "hw.temperature.limit", IL = "hw.voltage", LL = "hw.voltage.limit", RL = "hw.voltage.nominal", zL = "jvm.buffer.count", BL = "jvm.buffer.memory.limit", VL = "jvm.buffer.memory.usage", HL = "jvm.buffer.memory.used", UL = "jvm.file_descriptor.count", WL = "jvm.file_descriptor.limit", GL = "jvm.memory.init", KL = "jvm.system.cpu.load_1m", qL = "jvm.system.cpu.utilization", JL = "k8s.container.cpu.limit", YL = "k8s.container.cpu.limit.current", XL = "k8s.container.cpu.limit.desired", ZL = "k8s.container.cpu.limit.utilization", QL = "k8s.container.cpu.request", $L = "k8s.container.cpu.request.current", eR = "k8s.container.cpu.request.desired", tR = "k8s.container.cpu.request.utilization", nR = "k8s.container.ephemeral_storage.limit", rR = "k8s.container.ephemeral_storage.request", iR = "k8s.container.ephemeral_storage.usage", aR = "k8s.container.memory.limit", oR = "k8s.container.memory.limit.current", sR = "k8s.container.memory.limit.desired", cR = "k8s.container.memory.request", lR = "k8s.container.memory.request.current", uR = "k8s.container.memory.request.desired", dR = "k8s.container.ready", fR = "k8s.container.restart.count", pR = "k8s.container.status.reason", mR = "k8s.container.status.state", hR = "k8s.container.storage.limit", gR = "k8s.container.storage.request", _R = "k8s.cronjob.active_jobs", vR = "k8s.cronjob.job.active", yR = "k8s.daemonset.current_scheduled_nodes", bR = "k8s.daemonset.desired_scheduled_nodes", xR = "k8s.daemonset.misscheduled_nodes", SR = "k8s.daemonset.node.current_scheduled", CR = "k8s.daemonset.node.desired_scheduled", wR = "k8s.daemonset.node.misscheduled", TR = "k8s.daemonset.node.ready", ER = "k8s.daemonset.ready_nodes", DR = "k8s.deployment.available_pods", OR = "k8s.deployment.desired_pods", kR = "k8s.deployment.pod.available", AR = "k8s.deployment.pod.desired", jR = "k8s.hpa.current_pods", MR = "k8s.hpa.desired_pods", NR = "k8s.hpa.max_pods", PR = "k8s.hpa.metric.target.cpu.average_utilization", FR = "k8s.hpa.metric.target.cpu.average_value", IR = "k8s.hpa.metric.target.cpu.value", LR = "k8s.hpa.min_pods", RR = "k8s.hpa.pod.current", zR = "k8s.hpa.pod.desired", BR = "k8s.hpa.pod.max", VR = "k8s.hpa.pod.min", HR = "k8s.job.active_pods", UR = "k8s.job.desired_successful_pods", WR = "k8s.job.failed_pods", GR = "k8s.job.max_parallel_pods", KR = "k8s.job.pod.active", qR = "k8s.job.pod.desired_successful", JR = "k8s.job.pod.failed", YR = "k8s.job.pod.max_parallel", XR = "k8s.job.pod.successful", ZR = "k8s.job.successful_pods", QR = "k8s.namespace.phase", $R = "k8s.node.allocatable.cpu", ez = "k8s.node.allocatable.ephemeral_storage", tz = "k8s.node.allocatable.memory", nz = "k8s.node.allocatable.pods", rz = "k8s.node.condition.status", iz = "k8s.node.cpu.allocatable", az = "k8s.node.cpu.time", oz = "k8s.node.cpu.usage", sz = "k8s.node.ephemeral_storage.allocatable", cz = "k8s.node.filesystem.available", lz = "k8s.node.filesystem.capacity", uz = "k8s.node.filesystem.usage", dz = "k8s.node.memory.allocatable", fz = "k8s.node.memory.available", pz = "k8s.node.memory.paging.faults", mz = "k8s.node.memory.rss", hz = "k8s.node.memory.usage", gz = "k8s.node.memory.working_set", _z = "k8s.node.network.errors", vz = "k8s.node.network.io", yz = "k8s.node.pod.allocatable", bz = "k8s.node.system_container.cpu.time", xz = "k8s.node.system_container.cpu.usage", Sz = "k8s.node.system_container.memory.usage", Cz = "k8s.node.system_container.memory.working_set", wz = "k8s.node.uptime", Tz = "k8s.persistentvolume.status.phase", Ez = "k8s.persistentvolume.storage.capacity", Dz = "k8s.persistentvolumeclaim.status.phase", Oz = "k8s.persistentvolumeclaim.storage.capacity", kz = "k8s.persistentvolumeclaim.storage.request", Az = "k8s.pod.cpu.time", jz = "k8s.pod.cpu.usage", Mz = "k8s.pod.filesystem.available", Nz = "k8s.pod.filesystem.capacity", Pz = "k8s.pod.filesystem.usage", Fz = "k8s.pod.memory.available", Iz = "k8s.pod.memory.paging.faults", Lz = "k8s.pod.memory.rss", Rz = "k8s.pod.memory.usage", zz = "k8s.pod.memory.working_set", Bz = "k8s.pod.network.errors", Vz = "k8s.pod.network.io", Hz = "k8s.pod.status.phase", Uz = "k8s.pod.status.reason", Wz = "k8s.pod.uptime", Gz = "k8s.pod.volume.available", Kz = "k8s.pod.volume.capacity", qz = "k8s.pod.volume.inode.count", Jz = "k8s.pod.volume.inode.free", Yz = "k8s.pod.volume.inode.used", Xz = "k8s.pod.volume.usage", Zz = "k8s.replicaset.available_pods", Qz = "k8s.replicaset.desired_pods", $z = "k8s.replicaset.pod.available", eB = "k8s.replicaset.pod.desired", tB = "k8s.replication_controller.available_pods", nB = "k8s.replication_controller.desired_pods", rB = "k8s.replicationcontroller.available_pods", iB = "k8s.replicationcontroller.desired_pods", aB = "k8s.replicationcontroller.pod.available", oB = "k8s.replicationcontroller.pod.desired", sB = "k8s.resourcequota.cpu.limit.hard", cB = "k8s.resourcequota.cpu.limit.used", lB = "k8s.resourcequota.cpu.request.hard", uB = "k8s.resourcequota.cpu.request.used", dB = "k8s.resourcequota.ephemeral_storage.limit.hard", fB = "k8s.resourcequota.ephemeral_storage.limit.used", pB = "k8s.resourcequota.ephemeral_storage.request.hard", mB = "k8s.resourcequota.ephemeral_storage.request.used", hB = "k8s.resourcequota.hugepage_count.request.hard", gB = "k8s.resourcequota.hugepage_count.request.used", _B = "k8s.resourcequota.memory.limit.hard", vB = "k8s.resourcequota.memory.limit.used", yB = "k8s.resourcequota.memory.request.hard", bB = "k8s.resourcequota.memory.request.used", xB = "k8s.resourcequota.object_count.hard", SB = "k8s.resourcequota.object_count.used", CB = "k8s.resourcequota.persistentvolumeclaim_count.hard", wB = "k8s.resourcequota.persistentvolumeclaim_count.used", TB = "k8s.resourcequota.storage.request.hard", EB = "k8s.resourcequota.storage.request.used", DB = "k8s.service.endpoint.count", OB = "k8s.service.load_balancer.ingress.count", kB = "k8s.statefulset.current_pods", AB = "k8s.statefulset.desired_pods", jB = "k8s.statefulset.pod.current", MB = "k8s.statefulset.pod.desired", NB = "k8s.statefulset.pod.ready", PB = "k8s.statefulset.pod.updated", FB = "k8s.statefulset.ready_pods", IB = "k8s.statefulset.updated_pods", LB = "mcp.client.operation.duration", RB = "mcp.client.session.duration", zB = "mcp.server.operation.duration", BB = "mcp.server.session.duration", VB = "messaging.client.consumed.messages", HB = "messaging.client.operation.duration", UB = "messaging.client.published.messages", WB = "messaging.client.sent.messages", GB = "messaging.process.duration", KB = "messaging.process.messages", qB = "messaging.publish.duration", JB = "messaging.publish.messages", YB = "messaging.receive.duration", XB = "messaging.receive.messages", ZB = "nfs.client.net.count", QB = "nfs.client.net.tcp.connection.accepted", $B = "nfs.client.operation.count", eV = "nfs.client.procedure.count", tV = "nfs.client.rpc.authrefresh.count", nV = "nfs.client.rpc.count", rV = "nfs.client.rpc.retransmit.count", iV = "nfs.server.fh.stale.count", aV = "nfs.server.io", oV = "nfs.server.net.count", sV = "nfs.server.net.tcp.connection.accepted", cV = "nfs.server.operation.count", lV = "nfs.server.procedure.count", uV = "nfs.server.repcache.requests", dV = "nfs.server.rpc.count", fV = "nfs.server.thread.count", pV = "nodejs.eventloop.delay.max", mV = "nodejs.eventloop.delay.mean", hV = "nodejs.eventloop.delay.min", gV = "nodejs.eventloop.delay.p50", _V = "nodejs.eventloop.delay.p90", vV = "nodejs.eventloop.delay.p99", yV = "nodejs.eventloop.delay.stddev", bV = "nodejs.eventloop.time", xV = "nodejs.eventloop.utilization", SV = "openshift.clusterquota.cpu.limit.hard", CV = "openshift.clusterquota.cpu.limit.used", wV = "openshift.clusterquota.cpu.request.hard", TV = "openshift.clusterquota.cpu.request.used", EV = "openshift.clusterquota.ephemeral_storage.limit.hard", DV = "openshift.clusterquota.ephemeral_storage.limit.used", OV = "openshift.clusterquota.ephemeral_storage.request.hard", kV = "openshift.clusterquota.ephemeral_storage.request.used", AV = "openshift.clusterquota.hugepage_count.request.hard", jV = "openshift.clusterquota.hugepage_count.request.used", MV = "openshift.clusterquota.memory.limit.hard", NV = "openshift.clusterquota.memory.limit.used", PV = "openshift.clusterquota.memory.request.hard", FV = "openshift.clusterquota.memory.request.used", IV = "openshift.clusterquota.object_count.hard", LV = "openshift.clusterquota.object_count.used", RV = "openshift.clusterquota.persistentvolumeclaim_count.hard", zV = "openshift.clusterquota.persistentvolumeclaim_count.used", BV = "openshift.clusterquota.storage.request.hard", VV = "openshift.clusterquota.storage.request.used", HV = "otel.sdk.exporter.log.exported", UV = "otel.sdk.exporter.log.inflight", WV = "otel.sdk.exporter.metric_data_point.exported", GV = "otel.sdk.exporter.metric_data_point.inflight", KV = "otel.sdk.exporter.operation.duration", qV = "otel.sdk.exporter.span.exported", JV = "otel.sdk.exporter.span.exported.count", YV = "otel.sdk.exporter.span.inflight", XV = "otel.sdk.exporter.span.inflight.count", ZV = "otel.sdk.log.created", QV = "otel.sdk.metric_reader.collection.duration", $V = "otel.sdk.processor.log.processed", eH = "otel.sdk.processor.log.queue.capacity", tH = "otel.sdk.processor.log.queue.size", nH = "otel.sdk.processor.span.processed", rH = "otel.sdk.processor.span.processed.count", iH = "otel.sdk.processor.span.queue.capacity", aH = "otel.sdk.processor.span.queue.size", oH = "otel.sdk.span.ended", sH = "otel.sdk.span.ended.count", cH = "otel.sdk.span.live", lH = "otel.sdk.span.live.count", uH = "otel.sdk.span.started", dH = "process.context_switches", fH = "process.cpu.time", pH = "process.cpu.utilization", mH = "process.disk.io", hH = "process.memory.usage", gH = "process.memory.virtual", _H = "process.network.io", vH = "process.open_file_descriptor.count", yH = "process.paging.faults", bH = "process.thread.count", xH = "process.unix.file_descriptor.count", SH = "process.uptime", CH = "process.windows.handle.count", wH = "rpc.client.call.duration", TH = "rpc.client.duration", EH = "rpc.client.request.size", DH = "rpc.client.requests_per_rpc", OH = "rpc.client.response.size", kH = "rpc.client.responses_per_rpc", AH = "rpc.server.call.duration", jH = "rpc.server.duration", MH = "rpc.server.request.size", NH = "rpc.server.requests_per_rpc", PH = "rpc.server.response.size", FH = "rpc.server.responses_per_rpc", IH = "system.cpu.frequency", LH = "system.cpu.logical.count", RH = "system.cpu.physical.count", zH = "system.cpu.time", BH = "system.cpu.utilization", VH = "system.disk.io", HH = "system.disk.io_time", UH = "system.disk.limit", WH = "system.disk.merged", GH = "system.disk.operation_time", KH = "system.disk.operations", qH = "system.filesystem.limit", JH = "system.filesystem.lock.count", YH = "system.filesystem.usage", XH = "system.filesystem.utilization", ZH = "system.linux.memory.available", QH = "system.linux.memory.slab.usage", $H = "system.memory.limit", eU = "system.memory.linux.available", tU = "system.memory.linux.hugepages.limit", nU = "system.memory.linux.hugepages.page_size", rU = "system.memory.linux.hugepages.reserved", iU = "system.memory.linux.hugepages.surplus", aU = "system.memory.linux.hugepages.usage", oU = "system.memory.linux.hugepages.utilization", sU = "system.memory.linux.shared", cU = "system.memory.linux.slab.usage", lU = "system.memory.shared", uU = "system.memory.usage", dU = "system.memory.utilization", fU = "system.network.connection.count", pU = "system.network.connections", mU = "system.network.dropped", hU = "system.network.errors", gU = "system.network.io", _U = "system.network.packet.count", vU = "system.network.packet.dropped", yU = "system.network.packets", bU = "system.paging.faults", xU = "system.paging.operations", SU = "system.paging.usage", CU = "system.paging.utilization", wU = "system.process.count", TU = "system.process.created", EU = "system.uptime", DU = "v8js.gc.duration", OU = "v8js.heap.space.available_size", kU = "v8js.heap.space.physical_size", AU = "v8js.memory.heap.limit", jU = "v8js.memory.heap.space.available_size", MU = "v8js.memory.heap.space.physical_size", NU = "v8js.memory.heap.space.size", PU = "v8js.memory.heap.used", FU = "v8js.resource.active", IU = "vcs.change.count", LU = "vcs.change.duration", RU = "vcs.change.time_to_approval", zU = "vcs.change.time_to_merge", BU = "vcs.contributor.count", VU = "vcs.ref.count", HU = "vcs.ref.lines_delta", UU = "vcs.ref.revisions_delta", WU = "vcs.ref.time", GU = "vcs.repository.count", KU = "app.crash", qU = "app.jank", JU = "app.screen.click", YU = "app.widget.click", XU = "az.resource.log", ZU = "azure.resource.log", QU = "browser.web_vital", $U = "db.client.operation.exception", eW = "device.app.lifecycle", tW = "faas.invocation.exception", nW = "feature_flag.evaluation", rW = "gen_ai.assistant.message", iW = "gen_ai.choice", aW = "gen_ai.client.inference.operation.details", oW = "gen_ai.client.operation.exception", sW = "gen_ai.evaluation.result", cW = "gen_ai.system.message", lW = "gen_ai.tool.message", uW = "gen_ai.user.message", dW = "http.client.request.exception", fW = "http.server.request.exception", pW = "messaging.create.exception", mW = "messaging.process.exception", hW = "messaging.receive.exception", gW = "messaging.send.exception", _W = "messaging.settle.exception", vW = "rpc.client.call.exception", yW = "rpc.message", bW = "rpc.server.call.exception", xW = "session.end", SW = "session.start", CW = /* @__PURE__ */ e({
	ANDROID_APP_STATE_VALUE_BACKGROUND: () => ua,
	ANDROID_APP_STATE_VALUE_CREATED: () => da,
	ANDROID_APP_STATE_VALUE_FOREGROUND: () => fa,
	ANDROID_STATE_VALUE_BACKGROUND: () => ha,
	ANDROID_STATE_VALUE_CREATED: () => ga,
	ANDROID_STATE_VALUE_FOREGROUND: () => _a,
	ASPNETCORE_AUTHENTICATION_RESULT_VALUE_FAILURE: () => Ra,
	ASPNETCORE_AUTHENTICATION_RESULT_VALUE_NONE: () => za,
	ASPNETCORE_AUTHENTICATION_RESULT_VALUE_SUCCESS: () => Ba,
	ASPNETCORE_AUTHORIZATION_RESULT_VALUE_FAILURE: () => Wa,
	ASPNETCORE_AUTHORIZATION_RESULT_VALUE_SUCCESS: () => Ga,
	ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_ABORTED: () => qe,
	ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_HANDLED: () => Je,
	ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_SKIPPED: () => Ye,
	ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_UNHANDLED: () => Xe,
	ASPNETCORE_IDENTITY_PASSWORD_CHECK_RESULT_VALUE_FAILURE: () => Ja,
	ASPNETCORE_IDENTITY_PASSWORD_CHECK_RESULT_VALUE_PASSWORD_MISSING: () => Ya,
	ASPNETCORE_IDENTITY_PASSWORD_CHECK_RESULT_VALUE_SUCCESS: () => Xa,
	ASPNETCORE_IDENTITY_PASSWORD_CHECK_RESULT_VALUE_SUCCESS_REHASH_NEEDED: () => Za,
	ASPNETCORE_IDENTITY_PASSWORD_CHECK_RESULT_VALUE_USER_MISSING: () => Qa,
	ASPNETCORE_IDENTITY_RESULT_VALUE_FAILURE: () => eo,
	ASPNETCORE_IDENTITY_RESULT_VALUE_SUCCESS: () => to,
	ASPNETCORE_IDENTITY_SIGN_IN_RESULT_VALUE_FAILURE: () => ro,
	ASPNETCORE_IDENTITY_SIGN_IN_RESULT_VALUE_LOCKED_OUT: () => io,
	ASPNETCORE_IDENTITY_SIGN_IN_RESULT_VALUE_NOT_ALLOWED: () => ao,
	ASPNETCORE_IDENTITY_SIGN_IN_RESULT_VALUE_REQUIRES_TWO_FACTOR: () => oo,
	ASPNETCORE_IDENTITY_SIGN_IN_RESULT_VALUE_SUCCESS: () => so,
	ASPNETCORE_IDENTITY_SIGN_IN_TYPE_VALUE_EXTERNAL: () => lo,
	ASPNETCORE_IDENTITY_SIGN_IN_TYPE_VALUE_PASSKEY: () => uo,
	ASPNETCORE_IDENTITY_SIGN_IN_TYPE_VALUE_PASSWORD: () => fo,
	ASPNETCORE_IDENTITY_SIGN_IN_TYPE_VALUE_TWO_FACTOR: () => po,
	ASPNETCORE_IDENTITY_SIGN_IN_TYPE_VALUE_TWO_FACTOR_AUTHENTICATOR: () => mo,
	ASPNETCORE_IDENTITY_SIGN_IN_TYPE_VALUE_TWO_FACTOR_RECOVERY_CODE: () => ho,
	ASPNETCORE_IDENTITY_TOKEN_PURPOSE_VALUE_CHANGE_EMAIL: () => vo,
	ASPNETCORE_IDENTITY_TOKEN_PURPOSE_VALUE_CHANGE_PHONE_NUMBER: () => yo,
	ASPNETCORE_IDENTITY_TOKEN_PURPOSE_VALUE_EMAIL_CONFIRMATION: () => bo,
	ASPNETCORE_IDENTITY_TOKEN_PURPOSE_VALUE_OTHER: () => _o,
	ASPNETCORE_IDENTITY_TOKEN_PURPOSE_VALUE_RESET_PASSWORD: () => xo,
	ASPNETCORE_IDENTITY_TOKEN_PURPOSE_VALUE_TWO_FACTOR: () => So,
	ASPNETCORE_IDENTITY_TOKEN_VERIFIED_VALUE_FAILURE: () => wo,
	ASPNETCORE_IDENTITY_TOKEN_VERIFIED_VALUE_SUCCESS: () => To,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_ACCESS_FAILED: () => Oo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_ADD_CLAIMS: () => ko,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_ADD_LOGIN: () => Ao,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_ADD_PASSWORD: () => jo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_ADD_TO_ROLES: () => Mo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_CHANGE_EMAIL: () => No,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_CHANGE_PASSWORD: () => Po,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_CHANGE_PHONE_NUMBER: () => Fo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_CONFIRM_EMAIL: () => Io,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_GENERATE_NEW_TWO_FACTOR_RECOVERY_CODES: () => Lo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_OTHER: () => Do,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_PASSWORD_REHASH: () => Ro,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REDEEM_TWO_FACTOR_RECOVERY_CODE: () => zo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REMOVE_AUTHENTICATION_TOKEN: () => Bo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REMOVE_CLAIMS: () => Vo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REMOVE_FROM_ROLES: () => Ho,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REMOVE_LOGIN: () => Uo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REMOVE_PASSKEY: () => Wo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REMOVE_PASSWORD: () => Go,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_REPLACE_CLAIM: () => Ko,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_RESET_ACCESS_FAILED_COUNT: () => qo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_RESET_AUTHENTICATOR_KEY: () => Jo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_RESET_PASSWORD: () => Yo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SECURITY_STAMP: () => Xo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_AUTHENTICATION_TOKEN: () => Zo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_EMAIL: () => Qo,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_LOCKOUT_ENABLED: () => $o,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_LOCKOUT_END_DATE: () => es,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_PASSKEY: () => ts,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_PHONE_NUMBER: () => ns,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_SET_TWO_FACTOR_ENABLED: () => rs,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_UPDATE: () => is,
	ASPNETCORE_IDENTITY_USER_UPDATE_TYPE_VALUE_USER_NAME: () => as,
	ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ACQUIRED: () => et,
	ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ENDPOINT_LIMITER: () => tt,
	ASPNETCORE_RATE_LIMITING_RESULT_VALUE_GLOBAL_LIMITER: () => nt,
	ASPNETCORE_RATE_LIMITING_RESULT_VALUE_REQUEST_CANCELED: () => rt,
	ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_FAILURE: () => st,
	ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_SUCCESS: () => ct,
	ATTR_ANDROID_APP_STATE: () => la,
	ATTR_ANDROID_OS_API_LEVEL: () => pa,
	ATTR_ANDROID_STATE: () => ma,
	ATTR_APP_BUILD_ID: () => va,
	ATTR_APP_CRASH_ID: () => ya,
	ATTR_APP_INSTALLATION_ID: () => ba,
	ATTR_APP_JANK_FRAME_COUNT: () => xa,
	ATTR_APP_JANK_PERIOD: () => Sa,
	ATTR_APP_JANK_THRESHOLD: () => Ca,
	ATTR_APP_SCREEN_COORDINATE_X: () => wa,
	ATTR_APP_SCREEN_COORDINATE_Y: () => Ta,
	ATTR_APP_SCREEN_ID: () => Ea,
	ATTR_APP_SCREEN_NAME: () => Da,
	ATTR_APP_WIDGET_ID: () => Oa,
	ATTR_APP_WIDGET_NAME: () => ka,
	ATTR_ARTIFACT_ATTESTATION_FILENAME: () => Aa,
	ATTR_ARTIFACT_ATTESTATION_HASH: () => ja,
	ATTR_ARTIFACT_ATTESTATION_ID: () => Ma,
	ATTR_ARTIFACT_FILENAME: () => Na,
	ATTR_ARTIFACT_HASH: () => Pa,
	ATTR_ARTIFACT_PURL: () => Fa,
	ATTR_ARTIFACT_VERSION: () => Ia,
	ATTR_ASPNETCORE_AUTHENTICATION_RESULT: () => La,
	ATTR_ASPNETCORE_AUTHENTICATION_SCHEME: () => Va,
	ATTR_ASPNETCORE_AUTHORIZATION_POLICY: () => Ha,
	ATTR_ASPNETCORE_AUTHORIZATION_RESULT: () => Ua,
	ATTR_ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT: () => Ke,
	ATTR_ASPNETCORE_DIAGNOSTICS_HANDLER_TYPE: () => Ze,
	ATTR_ASPNETCORE_IDENTITY_ERROR_CODE: () => Ka,
	ATTR_ASPNETCORE_IDENTITY_PASSWORD_CHECK_RESULT: () => qa,
	ATTR_ASPNETCORE_IDENTITY_RESULT: () => $a,
	ATTR_ASPNETCORE_IDENTITY_SIGN_IN_RESULT: () => no,
	ATTR_ASPNETCORE_IDENTITY_SIGN_IN_TYPE: () => co,
	ATTR_ASPNETCORE_IDENTITY_TOKEN_PURPOSE: () => go,
	ATTR_ASPNETCORE_IDENTITY_TOKEN_VERIFIED: () => Co,
	ATTR_ASPNETCORE_IDENTITY_USER_TYPE: () => os,
	ATTR_ASPNETCORE_IDENTITY_USER_UPDATE_TYPE: () => Eo,
	ATTR_ASPNETCORE_MEMORY_POOL_OWNER: () => ss,
	ATTR_ASPNETCORE_RATE_LIMITING_POLICY: () => Qe,
	ATTR_ASPNETCORE_RATE_LIMITING_RESULT: () => $e,
	ATTR_ASPNETCORE_REQUEST_IS_UNHANDLED: () => it,
	ATTR_ASPNETCORE_ROUTING_IS_FALLBACK: () => at,
	ATTR_ASPNETCORE_ROUTING_MATCH_STATUS: () => ot,
	ATTR_ASPNETCORE_SIGN_IN_IS_PERSISTENT: () => cs,
	ATTR_ASPNETCORE_USER_IS_AUTHENTICATED: () => lt,
	ATTR_AWS_BEDROCK_GUARDRAIL_ID: () => ls,
	ATTR_AWS_BEDROCK_KNOWLEDGE_BASE_ID: () => us,
	ATTR_AWS_DYNAMODB_ATTRIBUTES_TO_GET: () => fs,
	ATTR_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS: () => ds,
	ATTR_AWS_DYNAMODB_CONSISTENT_READ: () => ps,
	ATTR_AWS_DYNAMODB_CONSUMED_CAPACITY: () => ms,
	ATTR_AWS_DYNAMODB_COUNT: () => hs,
	ATTR_AWS_DYNAMODB_EXCLUSIVE_START_TABLE: () => gs,
	ATTR_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES: () => vs,
	ATTR_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES: () => _s,
	ATTR_AWS_DYNAMODB_INDEX_NAME: () => ys,
	ATTR_AWS_DYNAMODB_ITEM_COLLECTION_METRICS: () => bs,
	ATTR_AWS_DYNAMODB_LIMIT: () => xs,
	ATTR_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES: () => Ss,
	ATTR_AWS_DYNAMODB_PROJECTION: () => Cs,
	ATTR_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY: () => ws,
	ATTR_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY: () => Ts,
	ATTR_AWS_DYNAMODB_SCANNED_COUNT: () => Ds,
	ATTR_AWS_DYNAMODB_SCAN_FORWARD: () => Es,
	ATTR_AWS_DYNAMODB_SEGMENT: () => Os,
	ATTR_AWS_DYNAMODB_SELECT: () => ks,
	ATTR_AWS_DYNAMODB_TABLE_COUNT: () => As,
	ATTR_AWS_DYNAMODB_TABLE_NAMES: () => js,
	ATTR_AWS_DYNAMODB_TOTAL_SEGMENTS: () => Ms,
	ATTR_AWS_ECS_CLUSTER_ARN: () => Ns,
	ATTR_AWS_ECS_CONTAINER_ARN: () => Ps,
	ATTR_AWS_ECS_LAUNCHTYPE: () => Fs,
	ATTR_AWS_ECS_TASK_ARN: () => Ls,
	ATTR_AWS_ECS_TASK_FAMILY: () => Rs,
	ATTR_AWS_ECS_TASK_ID: () => zs,
	ATTR_AWS_ECS_TASK_REVISION: () => Bs,
	ATTR_AWS_EKS_CLUSTER_ARN: () => Vs,
	ATTR_AWS_EXTENDED_REQUEST_ID: () => Hs,
	ATTR_AWS_KINESIS_STREAM_NAME: () => Us,
	ATTR_AWS_LAMBDA_INVOKED_ARN: () => Ws,
	ATTR_AWS_LAMBDA_RESOURCE_MAPPING_ID: () => Gs,
	ATTR_AWS_LOG_GROUP_ARNS: () => Ks,
	ATTR_AWS_LOG_GROUP_NAMES: () => qs,
	ATTR_AWS_LOG_STREAM_ARNS: () => Js,
	ATTR_AWS_LOG_STREAM_NAMES: () => Ys,
	ATTR_AWS_REQUEST_ID: () => Xs,
	ATTR_AWS_S3_BUCKET: () => Zs,
	ATTR_AWS_S3_COPY_SOURCE: () => Qs,
	ATTR_AWS_S3_DELETE: () => $s,
	ATTR_AWS_S3_KEY: () => ec,
	ATTR_AWS_S3_PART_NUMBER: () => tc,
	ATTR_AWS_S3_UPLOAD_ID: () => nc,
	ATTR_AWS_SECRETSMANAGER_SECRET_ARN: () => rc,
	ATTR_AWS_SNS_TOPIC_ARN: () => ic,
	ATTR_AWS_SQS_QUEUE_URL: () => ac,
	ATTR_AWS_STEP_FUNCTIONS_ACTIVITY_ARN: () => oc,
	ATTR_AWS_STEP_FUNCTIONS_STATE_MACHINE_ARN: () => sc,
	ATTR_AZURE_CLIENT_ID: () => uc,
	ATTR_AZURE_COSMOSDB_CONNECTION_MODE: () => dc,
	ATTR_AZURE_COSMOSDB_CONSISTENCY_LEVEL: () => mc,
	ATTR_AZURE_COSMOSDB_OPERATION_CONTACTED_REGIONS: () => bc,
	ATTR_AZURE_COSMOSDB_OPERATION_REQUEST_CHARGE: () => xc,
	ATTR_AZURE_COSMOSDB_REQUEST_BODY_SIZE: () => Sc,
	ATTR_AZURE_COSMOSDB_RESPONSE_SUB_STATUS_CODE: () => Cc,
	ATTR_AZURE_RESOURCE_GROUP_NAME: () => wc,
	ATTR_AZURE_RESOURCE_PROVIDER_NAMESPACE: () => Tc,
	ATTR_AZURE_SERVICE_REQUEST_ID: () => Ec,
	ATTR_AZ_NAMESPACE: () => cc,
	ATTR_AZ_SERVICE_REQUEST_ID: () => lc,
	ATTR_BROWSER_BRANDS: () => Dc,
	ATTR_BROWSER_DOCUMENT_URL_FULL: () => Oc,
	ATTR_BROWSER_LANGUAGE: () => kc,
	ATTR_BROWSER_MOBILE: () => Ac,
	ATTR_BROWSER_PLATFORM: () => jc,
	ATTR_CASSANDRA_CONSISTENCY_LEVEL: () => Mc,
	ATTR_CASSANDRA_COORDINATOR_DC: () => Bc,
	ATTR_CASSANDRA_COORDINATOR_ID: () => Vc,
	ATTR_CASSANDRA_PAGE_SIZE: () => Hc,
	ATTR_CASSANDRA_QUERY_IDEMPOTENT: () => Uc,
	ATTR_CASSANDRA_SPECULATIVE_EXECUTION_COUNT: () => Wc,
	ATTR_CICD_PIPELINE_ACTION_NAME: () => Gc,
	ATTR_CICD_PIPELINE_NAME: () => Jc,
	ATTR_CICD_PIPELINE_RESULT: () => Yc,
	ATTR_CICD_PIPELINE_RUN_ID: () => nl,
	ATTR_CICD_PIPELINE_RUN_STATE: () => rl,
	ATTR_CICD_PIPELINE_RUN_URL_FULL: () => sl,
	ATTR_CICD_PIPELINE_TASK_NAME: () => cl,
	ATTR_CICD_PIPELINE_TASK_RUN_ID: () => ll,
	ATTR_CICD_PIPELINE_TASK_RUN_RESULT: () => ul,
	ATTR_CICD_PIPELINE_TASK_RUN_URL_FULL: () => _l,
	ATTR_CICD_PIPELINE_TASK_TYPE: () => vl,
	ATTR_CICD_SYSTEM_COMPONENT: () => Sl,
	ATTR_CICD_WORKER_ID: () => Cl,
	ATTR_CICD_WORKER_NAME: () => wl,
	ATTR_CICD_WORKER_STATE: () => Tl,
	ATTR_CICD_WORKER_URL_FULL: () => kl,
	ATTR_CLIENT_ADDRESS: () => ut,
	ATTR_CLIENT_PORT: () => dt,
	ATTR_CLOUDEVENTS_EVENT_ID: () => Tu,
	ATTR_CLOUDEVENTS_EVENT_SOURCE: () => Eu,
	ATTR_CLOUDEVENTS_EVENT_SPEC_VERSION: () => Du,
	ATTR_CLOUDEVENTS_EVENT_SUBJECT: () => Ou,
	ATTR_CLOUDEVENTS_EVENT_TYPE: () => ku,
	ATTR_CLOUDFOUNDRY_APP_ID: () => Au,
	ATTR_CLOUDFOUNDRY_APP_INSTANCE_ID: () => ju,
	ATTR_CLOUDFOUNDRY_APP_NAME: () => Mu,
	ATTR_CLOUDFOUNDRY_ORG_ID: () => Nu,
	ATTR_CLOUDFOUNDRY_ORG_NAME: () => Pu,
	ATTR_CLOUDFOUNDRY_PROCESS_ID: () => Fu,
	ATTR_CLOUDFOUNDRY_PROCESS_TYPE: () => Iu,
	ATTR_CLOUDFOUNDRY_SPACE_ID: () => Lu,
	ATTR_CLOUDFOUNDRY_SPACE_NAME: () => Ru,
	ATTR_CLOUDFOUNDRY_SYSTEM_ID: () => zu,
	ATTR_CLOUDFOUNDRY_SYSTEM_INSTANCE_ID: () => Bu,
	ATTR_CLOUD_ACCOUNT_ID: () => Al,
	ATTR_CLOUD_AVAILABILITY_ZONE: () => jl,
	ATTR_CLOUD_PLATFORM: () => Ml,
	ATTR_CLOUD_PROVIDER: () => pu,
	ATTR_CLOUD_REGION: () => Cu,
	ATTR_CLOUD_RESOURCE_ID: () => wu,
	ATTR_CODE_COLUMN: () => Vu,
	ATTR_CODE_COLUMN_NUMBER: () => ft,
	ATTR_CODE_FILEPATH: () => Hu,
	ATTR_CODE_FILE_PATH: () => pt,
	ATTR_CODE_FUNCTION: () => Uu,
	ATTR_CODE_FUNCTION_NAME: () => mt,
	ATTR_CODE_LINENO: () => Wu,
	ATTR_CODE_LINE_NUMBER: () => ht,
	ATTR_CODE_NAMESPACE: () => Gu,
	ATTR_CODE_STACKTRACE: () => gt,
	ATTR_CONTAINER_COMMAND: () => Ku,
	ATTR_CONTAINER_COMMAND_ARGS: () => qu,
	ATTR_CONTAINER_COMMAND_LINE: () => Ju,
	ATTR_CONTAINER_CPU_STATE: () => Yu,
	ATTR_CONTAINER_CSI_PLUGIN_NAME: () => $u,
	ATTR_CONTAINER_CSI_VOLUME_ID: () => ed,
	ATTR_CONTAINER_ID: () => _t,
	ATTR_CONTAINER_IMAGE_ID: () => td,
	ATTR_CONTAINER_IMAGE_NAME: () => vt,
	ATTR_CONTAINER_IMAGE_REPO_DIGESTS: () => yt,
	ATTR_CONTAINER_IMAGE_TAGS: () => bt,
	ATTR_CONTAINER_LABEL: () => nd,
	ATTR_CONTAINER_LABELS: () => rd,
	ATTR_CONTAINER_NAME: () => id,
	ATTR_CONTAINER_RUNTIME: () => ad,
	ATTR_CONTAINER_RUNTIME_DESCRIPTION: () => od,
	ATTR_CONTAINER_RUNTIME_NAME: () => sd,
	ATTR_CONTAINER_RUNTIME_VERSION: () => cd,
	ATTR_CPU_LOGICAL_NUMBER: () => ld,
	ATTR_CPU_MODE: () => ud,
	ATTR_CPYTHON_GC_GENERATION: () => yd,
	ATTR_DB_CASSANDRA_CONSISTENCY_LEVEL: () => bd,
	ATTR_DB_CASSANDRA_COORDINATOR_DC: () => Od,
	ATTR_DB_CASSANDRA_COORDINATOR_ID: () => kd,
	ATTR_DB_CASSANDRA_IDEMPOTENCE: () => Ad,
	ATTR_DB_CASSANDRA_PAGE_SIZE: () => jd,
	ATTR_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT: () => Md,
	ATTR_DB_CASSANDRA_TABLE: () => Nd,
	ATTR_DB_CLIENT_CONNECTIONS_POOL_NAME: () => Rd,
	ATTR_DB_CLIENT_CONNECTIONS_STATE: () => zd,
	ATTR_DB_CLIENT_CONNECTION_POOL_NAME: () => Pd,
	ATTR_DB_CLIENT_CONNECTION_STATE: () => Fd,
	ATTR_DB_COLLECTION_NAME: () => xt,
	ATTR_DB_CONNECTION_STRING: () => Hd,
	ATTR_DB_COSMOSDB_CLIENT_ID: () => Ud,
	ATTR_DB_COSMOSDB_CONNECTION_MODE: () => Wd,
	ATTR_DB_COSMOSDB_CONSISTENCY_LEVEL: () => qd,
	ATTR_DB_COSMOSDB_CONTAINER: () => $d,
	ATTR_DB_COSMOSDB_OPERATION_TYPE: () => ef,
	ATTR_DB_COSMOSDB_REGIONS_CONTACTED: () => _f,
	ATTR_DB_COSMOSDB_REQUEST_CHARGE: () => vf,
	ATTR_DB_COSMOSDB_REQUEST_CONTENT_LENGTH: () => yf,
	ATTR_DB_COSMOSDB_STATUS_CODE: () => bf,
	ATTR_DB_COSMOSDB_SUB_STATUS_CODE: () => xf,
	ATTR_DB_ELASTICSEARCH_CLUSTER_NAME: () => Sf,
	ATTR_DB_ELASTICSEARCH_NODE_NAME: () => Cf,
	ATTR_DB_ELASTICSEARCH_PATH_PARTS: () => wf,
	ATTR_DB_INSTANCE_ID: () => Tf,
	ATTR_DB_JDBC_DRIVER_CLASSNAME: () => Ef,
	ATTR_DB_MONGODB_COLLECTION: () => Df,
	ATTR_DB_MSSQL_INSTANCE_NAME: () => Of,
	ATTR_DB_NAME: () => kf,
	ATTR_DB_NAMESPACE: () => St,
	ATTR_DB_OPERATION: () => Af,
	ATTR_DB_OPERATION_BATCH_SIZE: () => Ct,
	ATTR_DB_OPERATION_NAME: () => wt,
	ATTR_DB_OPERATION_PARAMETER: () => jf,
	ATTR_DB_QUERY_PARAMETER: () => Mf,
	ATTR_DB_QUERY_SUMMARY: () => Tt,
	ATTR_DB_QUERY_TEXT: () => Et,
	ATTR_DB_REDIS_DATABASE_INDEX: () => Nf,
	ATTR_DB_RESPONSE_RETURNED_ROWS: () => Pf,
	ATTR_DB_RESPONSE_STATUS_CODE: () => Dt,
	ATTR_DB_SQL_TABLE: () => Ff,
	ATTR_DB_STATEMENT: () => If,
	ATTR_DB_STORED_PROCEDURE_NAME: () => Ot,
	ATTR_DB_SYSTEM: () => Lf,
	ATTR_DB_SYSTEM_NAME: () => kt,
	ATTR_DB_USER: () => vm,
	ATTR_DEPLOYMENT_ENVIRONMENT: () => ym,
	ATTR_DEPLOYMENT_ENVIRONMENT_NAME: () => Pt,
	ATTR_DEPLOYMENT_ID: () => bm,
	ATTR_DEPLOYMENT_NAME: () => xm,
	ATTR_DEPLOYMENT_STATUS: () => Sm,
	ATTR_DESTINATION_ADDRESS: () => Tm,
	ATTR_DESTINATION_PORT: () => Em,
	ATTR_DEVICE_ID: () => Dm,
	ATTR_DEVICE_MANUFACTURER: () => Om,
	ATTR_DEVICE_MODEL_IDENTIFIER: () => km,
	ATTR_DEVICE_MODEL_NAME: () => Am,
	ATTR_DISK_IO_DIRECTION: () => jm,
	ATTR_DNS_ANSWERS: () => Pm,
	ATTR_DNS_QUESTION_NAME: () => Fm,
	ATTR_DOTNET_GC_HEAP_GENERATION: () => zt,
	ATTR_ELASTICSEARCH_NODE_NAME: () => Im,
	ATTR_ENDUSER_ID: () => Lm,
	ATTR_ENDUSER_PSEUDO_ID: () => Rm,
	ATTR_ENDUSER_ROLE: () => zm,
	ATTR_ENDUSER_SCOPE: () => Bm,
	ATTR_ERROR_MESSAGE: () => Vm,
	ATTR_ERROR_TYPE: () => Ut,
	ATTR_EVENT_NAME: () => Hm,
	ATTR_EXCEPTION_ESCAPED: () => Gt,
	ATTR_EXCEPTION_MESSAGE: () => Kt,
	ATTR_EXCEPTION_STACKTRACE: () => qt,
	ATTR_EXCEPTION_TYPE: () => Jt,
	ATTR_FAAS_COLDSTART: () => Um,
	ATTR_FAAS_CRON: () => Wm,
	ATTR_FAAS_DOCUMENT_COLLECTION: () => Gm,
	ATTR_FAAS_DOCUMENT_NAME: () => Km,
	ATTR_FAAS_DOCUMENT_OPERATION: () => qm,
	ATTR_FAAS_DOCUMENT_TIME: () => Zm,
	ATTR_FAAS_INSTANCE: () => Qm,
	ATTR_FAAS_INVOCATION_ID: () => $m,
	ATTR_FAAS_INVOKED_NAME: () => eh,
	ATTR_FAAS_INVOKED_PROVIDER: () => th,
	ATTR_FAAS_INVOKED_REGION: () => ah,
	ATTR_FAAS_MAX_MEMORY: () => oh,
	ATTR_FAAS_NAME: () => sh,
	ATTR_FAAS_TIME: () => ch,
	ATTR_FAAS_TRIGGER: () => lh,
	ATTR_FAAS_VERSION: () => hh,
	ATTR_FEATURE_FLAG_CONTEXT_ID: () => gh,
	ATTR_FEATURE_FLAG_ERROR_MESSAGE: () => _h,
	ATTR_FEATURE_FLAG_EVALUATION_ERROR_MESSAGE: () => vh,
	ATTR_FEATURE_FLAG_EVALUATION_REASON: () => yh,
	ATTR_FEATURE_FLAG_KEY: () => kh,
	ATTR_FEATURE_FLAG_PROVIDER_NAME: () => Ah,
	ATTR_FEATURE_FLAG_RESULT_REASON: () => jh,
	ATTR_FEATURE_FLAG_RESULT_VALUE: () => Vh,
	ATTR_FEATURE_FLAG_RESULT_VARIANT: () => Hh,
	ATTR_FEATURE_FLAG_SET_ID: () => Uh,
	ATTR_FEATURE_FLAG_VARIANT: () => Wh,
	ATTR_FEATURE_FLAG_VERSION: () => Gh,
	ATTR_FILE_ACCESSED: () => Kh,
	ATTR_FILE_ATTRIBUTES: () => qh,
	ATTR_FILE_CHANGED: () => Jh,
	ATTR_FILE_CREATED: () => Yh,
	ATTR_FILE_DIRECTORY: () => Xh,
	ATTR_FILE_EXTENSION: () => Zh,
	ATTR_FILE_FORK_NAME: () => Qh,
	ATTR_FILE_GROUP_ID: () => $h,
	ATTR_FILE_GROUP_NAME: () => eg,
	ATTR_FILE_INODE: () => tg,
	ATTR_FILE_LOCK_MECHANISM: () => ng,
	ATTR_FILE_LOCK_MODE: () => rg,
	ATTR_FILE_LOCK_TYPE: () => ig,
	ATTR_FILE_MODE: () => sg,
	ATTR_FILE_MODIFIED: () => cg,
	ATTR_FILE_NAME: () => lg,
	ATTR_FILE_OWNER_ID: () => ug,
	ATTR_FILE_OWNER_NAME: () => dg,
	ATTR_FILE_PATH: () => fg,
	ATTR_FILE_SIZE: () => pg,
	ATTR_FILE_SYMBOLIC_LINK_TARGET_PATH: () => mg,
	ATTR_GCP_APPHUB_APPLICATION_CONTAINER: () => hg,
	ATTR_GCP_APPHUB_APPLICATION_ID: () => gg,
	ATTR_GCP_APPHUB_APPLICATION_LOCATION: () => _g,
	ATTR_GCP_APPHUB_DESTINATION_APPLICATION_CONTAINER: () => Rg,
	ATTR_GCP_APPHUB_DESTINATION_APPLICATION_ID: () => zg,
	ATTR_GCP_APPHUB_DESTINATION_APPLICATION_LOCATION: () => Bg,
	ATTR_GCP_APPHUB_DESTINATION_SERVICE_CRITICALITY_TYPE: () => Vg,
	ATTR_GCP_APPHUB_DESTINATION_SERVICE_ENVIRONMENT_TYPE: () => Gg,
	ATTR_GCP_APPHUB_DESTINATION_SERVICE_ID: () => Xg,
	ATTR_GCP_APPHUB_DESTINATION_WORKLOAD_CRITICALITY_TYPE: () => Zg,
	ATTR_GCP_APPHUB_DESTINATION_WORKLOAD_ENVIRONMENT_TYPE: () => t_,
	ATTR_GCP_APPHUB_DESTINATION_WORKLOAD_ID: () => o_,
	ATTR_GCP_APPHUB_SERVICE_CRITICALITY_TYPE: () => vg,
	ATTR_GCP_APPHUB_SERVICE_ENVIRONMENT_TYPE: () => Sg,
	ATTR_GCP_APPHUB_SERVICE_ID: () => Dg,
	ATTR_GCP_APPHUB_WORKLOAD_CRITICALITY_TYPE: () => Og,
	ATTR_GCP_APPHUB_WORKLOAD_ENVIRONMENT_TYPE: () => Mg,
	ATTR_GCP_APPHUB_WORKLOAD_ID: () => Lg,
	ATTR_GCP_CLIENT_SERVICE: () => s_,
	ATTR_GCP_CLOUD_RUN_JOB_EXECUTION: () => c_,
	ATTR_GCP_CLOUD_RUN_JOB_TASK_INDEX: () => l_,
	ATTR_GCP_GCE_INSTANCE_GROUP_MANAGER_NAME: () => p_,
	ATTR_GCP_GCE_INSTANCE_GROUP_MANAGER_REGION: () => m_,
	ATTR_GCP_GCE_INSTANCE_GROUP_MANAGER_ZONE: () => h_,
	ATTR_GCP_GCE_INSTANCE_HOSTNAME: () => u_,
	ATTR_GCP_GCE_INSTANCE_LABELS: () => d_,
	ATTR_GCP_GCE_INSTANCE_NAME: () => f_,
	ATTR_GEN_AI_AGENT_DESCRIPTION: () => g_,
	ATTR_GEN_AI_AGENT_ID: () => j,
	ATTR_GEN_AI_AGENT_NAME: () => __,
	ATTR_GEN_AI_AGENT_VERSION: () => v_,
	ATTR_GEN_AI_COMPLETION: () => y_,
	ATTR_GEN_AI_CONVERSATION_ID: () => M,
	ATTR_GEN_AI_DATA_SOURCE_ID: () => b_,
	ATTR_GEN_AI_EMBEDDINGS_DIMENSION_COUNT: () => x_,
	ATTR_GEN_AI_EVALUATION_EXPLANATION: () => S_,
	ATTR_GEN_AI_EVALUATION_NAME: () => C_,
	ATTR_GEN_AI_EVALUATION_SCORE_LABEL: () => w_,
	ATTR_GEN_AI_EVALUATION_SCORE_VALUE: () => T_,
	ATTR_GEN_AI_INPUT_MESSAGES: () => N,
	ATTR_GEN_AI_OPENAI_REQUEST_RESPONSE_FORMAT: () => E_,
	ATTR_GEN_AI_OPENAI_REQUEST_SEED: () => A_,
	ATTR_GEN_AI_OPENAI_REQUEST_SERVICE_TIER: () => j_,
	ATTR_GEN_AI_OPENAI_RESPONSE_SERVICE_TIER: () => P_,
	ATTR_GEN_AI_OPENAI_RESPONSE_SYSTEM_FINGERPRINT: () => F_,
	ATTR_GEN_AI_OPERATION_NAME: () => P,
	ATTR_GEN_AI_OUTPUT_MESSAGES: () => L,
	ATTR_GEN_AI_OUTPUT_TYPE: () => U_,
	ATTR_GEN_AI_PROMPT: () => J_,
	ATTR_GEN_AI_PROMPT_NAME: () => Y_,
	ATTR_GEN_AI_PROVIDER_NAME: () => R,
	ATTR_GEN_AI_REQUEST_CHOICE_COUNT: () => uv,
	ATTR_GEN_AI_REQUEST_ENCODING_FORMATS: () => dv,
	ATTR_GEN_AI_REQUEST_FREQUENCY_PENALTY: () => fv,
	ATTR_GEN_AI_REQUEST_MAX_TOKENS: () => pv,
	ATTR_GEN_AI_REQUEST_MODEL: () => B,
	ATTR_GEN_AI_REQUEST_PRESENCE_PENALTY: () => mv,
	ATTR_GEN_AI_REQUEST_SEED: () => hv,
	ATTR_GEN_AI_REQUEST_STOP_SEQUENCES: () => gv,
	ATTR_GEN_AI_REQUEST_STREAM: () => _v,
	ATTR_GEN_AI_REQUEST_TEMPERATURE: () => vv,
	ATTR_GEN_AI_REQUEST_TOP_K: () => yv,
	ATTR_GEN_AI_REQUEST_TOP_P: () => bv,
	ATTR_GEN_AI_RESPONSE_FINISH_REASONS: () => xv,
	ATTR_GEN_AI_RESPONSE_ID: () => V,
	ATTR_GEN_AI_RESPONSE_MODEL: () => H,
	ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK: () => Sv,
	ATTR_GEN_AI_RETRIEVAL_DOCUMENTS: () => Cv,
	ATTR_GEN_AI_RETRIEVAL_QUERY_TEXT: () => wv,
	ATTR_GEN_AI_SYSTEM: () => Tv,
	ATTR_GEN_AI_SYSTEM_INSTRUCTIONS: () => U,
	ATTR_GEN_AI_TOKEN_TYPE: () => Wv,
	ATTR_GEN_AI_TOOL_CALL_ARGUMENTS: () => Jv,
	ATTR_GEN_AI_TOOL_CALL_ID: () => Yv,
	ATTR_GEN_AI_TOOL_CALL_RESULT: () => Xv,
	ATTR_GEN_AI_TOOL_DEFINITIONS: () => Zv,
	ATTR_GEN_AI_TOOL_DESCRIPTION: () => Qv,
	ATTR_GEN_AI_TOOL_NAME: () => $v,
	ATTR_GEN_AI_TOOL_TYPE: () => ey,
	ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS: () => ty,
	ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS: () => ny,
	ATTR_GEN_AI_USAGE_COMPLETION_TOKENS: () => ry,
	ATTR_GEN_AI_USAGE_INPUT_TOKENS: () => iy,
	ATTR_GEN_AI_USAGE_OUTPUT_TOKENS: () => ay,
	ATTR_GEN_AI_USAGE_PROMPT_TOKENS: () => oy,
	ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS: () => sy,
	ATTR_GEN_AI_WORKFLOW_NAME: () => cy,
	ATTR_GEO_CONTINENT_CODE: () => ly,
	ATTR_GEO_COUNTRY_ISO_CODE: () => uy,
	ATTR_GEO_LOCALITY_NAME: () => dy,
	ATTR_GEO_LOCATION_LAT: () => fy,
	ATTR_GEO_LOCATION_LON: () => py,
	ATTR_GEO_POSTAL_CODE: () => my,
	ATTR_GEO_REGION_ISO_CODE: () => hy,
	ATTR_GO_CPU_DETAILED_STATE: () => gy,
	ATTR_GO_CPU_STATE: () => _y,
	ATTR_GO_MEMORY_DETAILED_TYPE: () => xy,
	ATTR_GO_MEMORY_TYPE: () => Sy,
	ATTR_GRAPHQL_DOCUMENT: () => Ty,
	ATTR_GRAPHQL_OPERATION_NAME: () => Ey,
	ATTR_GRAPHQL_OPERATION_TYPE: () => Dy,
	ATTR_HEROKU_APP_ID: () => jy,
	ATTR_HEROKU_RELEASE_COMMIT: () => My,
	ATTR_HEROKU_RELEASE_CREATION_TIMESTAMP: () => Ny,
	ATTR_HOST_ARCH: () => Py,
	ATTR_HOST_CPU_CACHE_L2_SIZE: () => Hy,
	ATTR_HOST_CPU_FAMILY: () => Uy,
	ATTR_HOST_CPU_MODEL_ID: () => Wy,
	ATTR_HOST_CPU_MODEL_NAME: () => Gy,
	ATTR_HOST_CPU_STEPPING: () => Ky,
	ATTR_HOST_CPU_VENDOR_ID: () => qy,
	ATTR_HOST_ID: () => Jy,
	ATTR_HOST_IMAGE_ID: () => Yy,
	ATTR_HOST_IMAGE_NAME: () => Xy,
	ATTR_HOST_IMAGE_VERSION: () => Zy,
	ATTR_HOST_IP: () => Qy,
	ATTR_HOST_MAC: () => $y,
	ATTR_HOST_NAME: () => eb,
	ATTR_HOST_TYPE: () => tb,
	ATTR_HTTP_CLIENT_IP: () => nb,
	ATTR_HTTP_CONNECTION_STATE: () => rb,
	ATTR_HTTP_FLAVOR: () => ob,
	ATTR_HTTP_HOST: () => lb,
	ATTR_HTTP_METHOD: () => ub,
	ATTR_HTTP_REQUEST_BODY_SIZE: () => db,
	ATTR_HTTP_REQUEST_CONTENT_LENGTH: () => mb,
	ATTR_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED: () => hb,
	ATTR_HTTP_REQUEST_HEADER: () => Yt,
	ATTR_HTTP_REQUEST_METHOD: () => Xt,
	ATTR_HTTP_REQUEST_METHOD_ORIGINAL: () => on,
	ATTR_HTTP_REQUEST_RESEND_COUNT: () => sn,
	ATTR_HTTP_REQUEST_SIZE: () => pb,
	ATTR_HTTP_RESPONSE_BODY_SIZE: () => gb,
	ATTR_HTTP_RESPONSE_CONTENT_LENGTH: () => vb,
	ATTR_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED: () => yb,
	ATTR_HTTP_RESPONSE_HEADER: () => cn,
	ATTR_HTTP_RESPONSE_SIZE: () => _b,
	ATTR_HTTP_RESPONSE_STATUS_CODE: () => A,
	ATTR_HTTP_ROUTE: () => ln,
	ATTR_HTTP_SCHEME: () => bb,
	ATTR_HTTP_SERVER_NAME: () => xb,
	ATTR_HTTP_STATUS_CODE: () => Sb,
	ATTR_HTTP_TARGET: () => Cb,
	ATTR_HTTP_URL: () => wb,
	ATTR_HTTP_USER_AGENT: () => Tb,
	ATTR_HW_BATTERY_CAPACITY: () => Eb,
	ATTR_HW_BATTERY_CHEMISTRY: () => Db,
	ATTR_HW_BATTERY_STATE: () => Ob,
	ATTR_HW_BIOS_VERSION: () => jb,
	ATTR_HW_DRIVER_VERSION: () => Mb,
	ATTR_HW_ENCLOSURE_TYPE: () => Nb,
	ATTR_HW_FIRMWARE_VERSION: () => Pb,
	ATTR_HW_GPU_TASK: () => Fb,
	ATTR_HW_ID: () => zb,
	ATTR_HW_LIMIT_TYPE: () => Bb,
	ATTR_HW_LOGICAL_DISK_RAID_LEVEL: () => Yb,
	ATTR_HW_LOGICAL_DISK_STATE: () => Xb,
	ATTR_HW_MEMORY_TYPE: () => $b,
	ATTR_HW_MODEL: () => ex,
	ATTR_HW_NAME: () => tx,
	ATTR_HW_NETWORK_LOGICAL_ADDRESSES: () => nx,
	ATTR_HW_NETWORK_PHYSICAL_ADDRESS: () => rx,
	ATTR_HW_PARENT: () => ix,
	ATTR_HW_PHYSICAL_DISK_SMART_ATTRIBUTE: () => ax,
	ATTR_HW_PHYSICAL_DISK_STATE: () => ox,
	ATTR_HW_PHYSICAL_DISK_TYPE: () => cx,
	ATTR_HW_SENSOR_LOCATION: () => lx,
	ATTR_HW_SERIAL_NUMBER: () => ux,
	ATTR_HW_STATE: () => dx,
	ATTR_HW_TAPE_DRIVE_OPERATION_TYPE: () => gx,
	ATTR_HW_TYPE: () => bx,
	ATTR_HW_VENDOR: () => Mx,
	ATTR_IOS_APP_STATE: () => Nx,
	ATTR_IOS_STATE: () => zx,
	ATTR_JSONRPC_PROTOCOL_VERSION: () => Gx,
	ATTR_JSONRPC_REQUEST_ID: () => Kx,
	ATTR_JVM_BUFFER_POOL_NAME: () => qx,
	ATTR_JVM_GC_ACTION: () => un,
	ATTR_JVM_GC_CAUSE: () => Jx,
	ATTR_JVM_GC_NAME: () => dn,
	ATTR_JVM_MEMORY_POOL_NAME: () => fn,
	ATTR_JVM_MEMORY_TYPE: () => pn,
	ATTR_JVM_THREAD_DAEMON: () => gn,
	ATTR_JVM_THREAD_STATE: () => _n,
	ATTR_K8S_CLUSTER_NAME: () => Cn,
	ATTR_K8S_CLUSTER_UID: () => wn,
	ATTR_K8S_CONTAINER_EPHEMERAL_STORAGE_FS_TYPE: () => Yx,
	ATTR_K8S_CONTAINER_NAME: () => Tn,
	ATTR_K8S_CONTAINER_RESTART_COUNT: () => En,
	ATTR_K8S_CONTAINER_STATUS_LAST_TERMINATED_REASON: () => Qx,
	ATTR_K8S_CONTAINER_STATUS_REASON: () => $x,
	ATTR_K8S_CONTAINER_STATUS_STATE: () => lS,
	ATTR_K8S_CRONJOB_ANNOTATION: () => Dn,
	ATTR_K8S_CRONJOB_LABEL: () => On,
	ATTR_K8S_CRONJOB_NAME: () => kn,
	ATTR_K8S_CRONJOB_UID: () => An,
	ATTR_K8S_DAEMONSET_ANNOTATION: () => jn,
	ATTR_K8S_DAEMONSET_LABEL: () => Mn,
	ATTR_K8S_DAEMONSET_NAME: () => Nn,
	ATTR_K8S_DAEMONSET_UID: () => Pn,
	ATTR_K8S_DEPLOYMENT_ANNOTATION: () => Fn,
	ATTR_K8S_DEPLOYMENT_LABEL: () => In,
	ATTR_K8S_DEPLOYMENT_NAME: () => Ln,
	ATTR_K8S_DEPLOYMENT_UID: () => Rn,
	ATTR_K8S_HPA_METRIC_TYPE: () => pS,
	ATTR_K8S_HPA_NAME: () => mS,
	ATTR_K8S_HPA_SCALETARGETREF_API_VERSION: () => hS,
	ATTR_K8S_HPA_SCALETARGETREF_KIND: () => gS,
	ATTR_K8S_HPA_SCALETARGETREF_NAME: () => _S,
	ATTR_K8S_HPA_UID: () => vS,
	ATTR_K8S_HUGEPAGE_SIZE: () => yS,
	ATTR_K8S_JOB_ANNOTATION: () => zn,
	ATTR_K8S_JOB_LABEL: () => Bn,
	ATTR_K8S_JOB_NAME: () => Vn,
	ATTR_K8S_JOB_UID: () => Hn,
	ATTR_K8S_NAMESPACE_ANNOTATION: () => Un,
	ATTR_K8S_NAMESPACE_LABEL: () => Wn,
	ATTR_K8S_NAMESPACE_NAME: () => Gn,
	ATTR_K8S_NAMESPACE_PHASE: () => bS,
	ATTR_K8S_NODE_ANNOTATION: () => Kn,
	ATTR_K8S_NODE_CONDITION_STATUS: () => CS,
	ATTR_K8S_NODE_CONDITION_TYPE: () => DS,
	ATTR_K8S_NODE_LABEL: () => qn,
	ATTR_K8S_NODE_NAME: () => Jn,
	ATTR_K8S_NODE_SYSTEM_CONTAINER_NAME: () => NS,
	ATTR_K8S_NODE_UID: () => Yn,
	ATTR_K8S_PERSISTENTVOLUMECLAIM_ANNOTATION: () => JS,
	ATTR_K8S_PERSISTENTVOLUMECLAIM_LABEL: () => YS,
	ATTR_K8S_PERSISTENTVOLUMECLAIM_NAME: () => XS,
	ATTR_K8S_PERSISTENTVOLUMECLAIM_STATUS_PHASE: () => ZS,
	ATTR_K8S_PERSISTENTVOLUMECLAIM_UID: () => tC,
	ATTR_K8S_PERSISTENTVOLUME_ANNOTATION: () => PS,
	ATTR_K8S_PERSISTENTVOLUME_LABEL: () => FS,
	ATTR_K8S_PERSISTENTVOLUME_NAME: () => IS,
	ATTR_K8S_PERSISTENTVOLUME_RECLAIM_POLICY: () => LS,
	ATTR_K8S_PERSISTENTVOLUME_STATUS_PHASE: () => VS,
	ATTR_K8S_PERSISTENTVOLUME_UID: () => qS,
	ATTR_K8S_POD_ANNOTATION: () => Xn,
	ATTR_K8S_POD_HOSTNAME: () => Zn,
	ATTR_K8S_POD_IP: () => Qn,
	ATTR_K8S_POD_LABEL: () => $n,
	ATTR_K8S_POD_LABELS: () => nC,
	ATTR_K8S_POD_NAME: () => er,
	ATTR_K8S_POD_START_TIME: () => tr,
	ATTR_K8S_POD_STATUS_PHASE: () => rC,
	ATTR_K8S_POD_STATUS_REASON: () => lC,
	ATTR_K8S_POD_UID: () => nr,
	ATTR_K8S_REPLICASET_ANNOTATION: () => rr,
	ATTR_K8S_REPLICASET_LABEL: () => ir,
	ATTR_K8S_REPLICASET_NAME: () => ar,
	ATTR_K8S_REPLICASET_UID: () => or,
	ATTR_K8S_REPLICATIONCONTROLLER_NAME: () => hC,
	ATTR_K8S_REPLICATIONCONTROLLER_UID: () => gC,
	ATTR_K8S_RESOURCEQUOTA_NAME: () => _C,
	ATTR_K8S_RESOURCEQUOTA_RESOURCE_NAME: () => vC,
	ATTR_K8S_RESOURCEQUOTA_UID: () => yC,
	ATTR_K8S_SERVICE_ANNOTATION: () => bC,
	ATTR_K8S_SERVICE_ENDPOINT_ADDRESS_TYPE: () => xC,
	ATTR_K8S_SERVICE_ENDPOINT_CONDITION: () => TC,
	ATTR_K8S_SERVICE_ENDPOINT_ZONE: () => kC,
	ATTR_K8S_SERVICE_LABEL: () => AC,
	ATTR_K8S_SERVICE_NAME: () => jC,
	ATTR_K8S_SERVICE_PUBLISH_NOT_READY_ADDRESSES: () => MC,
	ATTR_K8S_SERVICE_SELECTOR: () => NC,
	ATTR_K8S_SERVICE_TRAFFIC_DISTRIBUTION: () => PC,
	ATTR_K8S_SERVICE_TYPE: () => FC,
	ATTR_K8S_SERVICE_UID: () => BC,
	ATTR_K8S_STATEFULSET_ANNOTATION: () => sr,
	ATTR_K8S_STATEFULSET_LABEL: () => cr,
	ATTR_K8S_STATEFULSET_NAME: () => lr,
	ATTR_K8S_STATEFULSET_UID: () => ur,
	ATTR_K8S_STORAGECLASS_NAME: () => VC,
	ATTR_K8S_VOLUME_NAME: () => HC,
	ATTR_K8S_VOLUME_TYPE: () => UC,
	ATTR_LINUX_MEMORY_SLAB_STATE: () => XC,
	ATTR_LOG_FILE_NAME: () => $C,
	ATTR_LOG_FILE_NAME_RESOLVED: () => ew,
	ATTR_LOG_FILE_PATH: () => tw,
	ATTR_LOG_FILE_PATH_RESOLVED: () => nw,
	ATTR_LOG_IOSTREAM: () => rw,
	ATTR_LOG_RECORD_ORIGINAL: () => ow,
	ATTR_LOG_RECORD_UID: () => sw,
	ATTR_MAINFRAME_LPAR_NAME: () => cw,
	ATTR_MCP_METHOD_NAME: () => lw,
	ATTR_MCP_PROTOCOL_VERSION: () => Fw,
	ATTR_MCP_RESOURCE_URI: () => Iw,
	ATTR_MCP_SESSION_ID: () => Lw,
	ATTR_MESSAGE_COMPRESSED_SIZE: () => Rw,
	ATTR_MESSAGE_ID: () => zw,
	ATTR_MESSAGE_TYPE: () => Bw,
	ATTR_MESSAGE_UNCOMPRESSED_SIZE: () => Uw,
	ATTR_MESSAGING_BATCH_MESSAGE_COUNT: () => Ww,
	ATTR_MESSAGING_CLIENT_ID: () => Gw,
	ATTR_MESSAGING_CONSUMER_GROUP_NAME: () => Kw,
	ATTR_MESSAGING_DESTINATION_ANONYMOUS: () => qw,
	ATTR_MESSAGING_DESTINATION_NAME: () => Jw,
	ATTR_MESSAGING_DESTINATION_PARTITION_ID: () => Yw,
	ATTR_MESSAGING_DESTINATION_PUBLISH_ANONYMOUS: () => $w,
	ATTR_MESSAGING_DESTINATION_PUBLISH_NAME: () => eT,
	ATTR_MESSAGING_DESTINATION_SUBSCRIPTION_NAME: () => Xw,
	ATTR_MESSAGING_DESTINATION_TEMPLATE: () => Zw,
	ATTR_MESSAGING_DESTINATION_TEMPORARY: () => Qw,
	ATTR_MESSAGING_EVENTHUBS_CONSUMER_GROUP: () => tT,
	ATTR_MESSAGING_EVENTHUBS_MESSAGE_ENQUEUED_TIME: () => nT,
	ATTR_MESSAGING_GCP_PUBSUB_MESSAGE_ACK_DEADLINE: () => rT,
	ATTR_MESSAGING_GCP_PUBSUB_MESSAGE_ACK_ID: () => iT,
	ATTR_MESSAGING_GCP_PUBSUB_MESSAGE_DELIVERY_ATTEMPT: () => aT,
	ATTR_MESSAGING_GCP_PUBSUB_MESSAGE_ORDERING_KEY: () => oT,
	ATTR_MESSAGING_KAFKA_CONSUMER_GROUP: () => sT,
	ATTR_MESSAGING_KAFKA_DESTINATION_PARTITION: () => cT,
	ATTR_MESSAGING_KAFKA_MESSAGE_KEY: () => lT,
	ATTR_MESSAGING_KAFKA_MESSAGE_OFFSET: () => uT,
	ATTR_MESSAGING_KAFKA_MESSAGE_TOMBSTONE: () => dT,
	ATTR_MESSAGING_KAFKA_OFFSET: () => fT,
	ATTR_MESSAGING_MESSAGE_BODY_SIZE: () => pT,
	ATTR_MESSAGING_MESSAGE_CONVERSATION_ID: () => mT,
	ATTR_MESSAGING_MESSAGE_ENVELOPE_SIZE: () => hT,
	ATTR_MESSAGING_MESSAGE_ID: () => gT,
	ATTR_MESSAGING_OPERATION: () => _T,
	ATTR_MESSAGING_OPERATION_NAME: () => vT,
	ATTR_MESSAGING_OPERATION_TYPE: () => yT,
	ATTR_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY: () => DT,
	ATTR_MESSAGING_RABBITMQ_MESSAGE_DELIVERY_TAG: () => OT,
	ATTR_MESSAGING_ROCKETMQ_CLIENT_GROUP: () => kT,
	ATTR_MESSAGING_ROCKETMQ_CONSUMPTION_MODEL: () => AT,
	ATTR_MESSAGING_ROCKETMQ_MESSAGE_DELAY_TIME_LEVEL: () => NT,
	ATTR_MESSAGING_ROCKETMQ_MESSAGE_DELIVERY_TIMESTAMP: () => PT,
	ATTR_MESSAGING_ROCKETMQ_MESSAGE_GROUP: () => FT,
	ATTR_MESSAGING_ROCKETMQ_MESSAGE_KEYS: () => IT,
	ATTR_MESSAGING_ROCKETMQ_MESSAGE_TAG: () => LT,
	ATTR_MESSAGING_ROCKETMQ_MESSAGE_TYPE: () => RT,
	ATTR_MESSAGING_ROCKETMQ_NAMESPACE: () => UT,
	ATTR_MESSAGING_SERVICEBUS_DESTINATION_SUBSCRIPTION_NAME: () => WT,
	ATTR_MESSAGING_SERVICEBUS_DISPOSITION_STATUS: () => GT,
	ATTR_MESSAGING_SERVICEBUS_MESSAGE_DELIVERY_COUNT: () => XT,
	ATTR_MESSAGING_SERVICEBUS_MESSAGE_ENQUEUED_TIME: () => ZT,
	ATTR_MESSAGING_SYSTEM: () => QT,
	ATTR_NETWORK_CARRIER_ICC: () => NE,
	ATTR_NETWORK_CARRIER_MCC: () => PE,
	ATTR_NETWORK_CARRIER_MNC: () => FE,
	ATTR_NETWORK_CARRIER_NAME: () => IE,
	ATTR_NETWORK_CONNECTION_STATE: () => LE,
	ATTR_NETWORK_CONNECTION_SUBTYPE: () => YE,
	ATTR_NETWORK_CONNECTION_TYPE: () => mD,
	ATTR_NETWORK_INTERFACE_NAME: () => bD,
	ATTR_NETWORK_IO_DIRECTION: () => xD,
	ATTR_NETWORK_LOCAL_ADDRESS: () => dr,
	ATTR_NETWORK_LOCAL_PORT: () => fr,
	ATTR_NETWORK_PEER_ADDRESS: () => pr,
	ATTR_NETWORK_PEER_PORT: () => mr,
	ATTR_NETWORK_PROTOCOL_NAME: () => hr,
	ATTR_NETWORK_PROTOCOL_VERSION: () => gr,
	ATTR_NETWORK_TRANSPORT: () => _r,
	ATTR_NETWORK_TYPE: () => xr,
	ATTR_NET_HOST_IP: () => uE,
	ATTR_NET_HOST_NAME: () => dE,
	ATTR_NET_HOST_PORT: () => fE,
	ATTR_NET_PEER_IP: () => pE,
	ATTR_NET_PEER_NAME: () => mE,
	ATTR_NET_PEER_PORT: () => hE,
	ATTR_NET_PROTOCOL_NAME: () => gE,
	ATTR_NET_PROTOCOL_VERSION: () => _E,
	ATTR_NET_SOCK_FAMILY: () => vE,
	ATTR_NET_SOCK_HOST_ADDR: () => SE,
	ATTR_NET_SOCK_HOST_PORT: () => CE,
	ATTR_NET_SOCK_PEER_ADDR: () => wE,
	ATTR_NET_SOCK_PEER_NAME: () => TE,
	ATTR_NET_SOCK_PEER_PORT: () => EE,
	ATTR_NET_TRANSPORT: () => DE,
	ATTR_NFS_OPERATION_NAME: () => wD,
	ATTR_NFS_SERVER_REPCACHE_STATUS: () => TD,
	ATTR_NODEJS_EVENTLOOP_STATE: () => ED,
	ATTR_OCI_MANIFEST_DIGEST: () => kD,
	ATTR_ONC_RPC_PROCEDURE_NAME: () => AD,
	ATTR_ONC_RPC_PROCEDURE_NUMBER: () => jD,
	ATTR_ONC_RPC_PROGRAM_NAME: () => MD,
	ATTR_ONC_RPC_VERSION: () => ND,
	ATTR_OPENAI_API_TYPE: () => PD,
	ATTR_OPENAI_REQUEST_SERVICE_TIER: () => LD,
	ATTR_OPENAI_RESPONSE_SERVICE_TIER: () => BD,
	ATTR_OPENAI_RESPONSE_SYSTEM_FINGERPRINT: () => VD,
	ATTR_OPENSHIFT_CLUSTERQUOTA_NAME: () => HD,
	ATTR_OPENSHIFT_CLUSTERQUOTA_UID: () => UD,
	ATTR_OPENTRACING_REF_TYPE: () => WD,
	ATTR_ORACLE_CLOUD_REALM: () => QD,
	ATTR_ORACLE_DB_DOMAIN: () => qD,
	ATTR_ORACLE_DB_INSTANCE_NAME: () => JD,
	ATTR_ORACLE_DB_NAME: () => YD,
	ATTR_ORACLE_DB_PDB: () => XD,
	ATTR_ORACLE_DB_SERVICE: () => ZD,
	ATTR_OS_BUILD_ID: () => $D,
	ATTR_OS_DESCRIPTION: () => eO,
	ATTR_OS_NAME: () => tO,
	ATTR_OS_TYPE: () => nO,
	ATTR_OS_VERSION: () => pO,
	ATTR_OTEL_COMPONENT_NAME: () => mO,
	ATTR_OTEL_COMPONENT_TYPE: () => hO,
	ATTR_OTEL_EVENT_NAME: () => wr,
	ATTR_OTEL_LIBRARY_NAME: () => MO,
	ATTR_OTEL_LIBRARY_VERSION: () => NO,
	ATTR_OTEL_SCOPE_NAME: () => Tr,
	ATTR_OTEL_SCOPE_SCHEMA_URL: () => PO,
	ATTR_OTEL_SCOPE_VERSION: () => Er,
	ATTR_OTEL_SPAN_PARENT_ORIGIN: () => FO,
	ATTR_OTEL_SPAN_SAMPLING_RESULT: () => zO,
	ATTR_OTEL_STATUS_CODE: () => Dr,
	ATTR_OTEL_STATUS_DESCRIPTION: () => kr,
	ATTR_PEER_SERVICE: () => UO,
	ATTR_POOL_NAME: () => WO,
	ATTR_PPROF_LOCATION_IS_FOLDED: () => GO,
	ATTR_PPROF_MAPPING_HAS_FILENAMES: () => KO,
	ATTR_PPROF_MAPPING_HAS_FUNCTIONS: () => qO,
	ATTR_PPROF_MAPPING_HAS_INLINE_FRAMES: () => JO,
	ATTR_PPROF_MAPPING_HAS_LINE_NUMBERS: () => YO,
	ATTR_PPROF_PROFILE_COMMENT: () => XO,
	ATTR_PPROF_PROFILE_DOC_URL: () => ZO,
	ATTR_PPROF_PROFILE_DROP_FRAMES: () => QO,
	ATTR_PPROF_PROFILE_KEEP_FRAMES: () => $O,
	ATTR_PPROF_SCOPE_DEFAULT_SAMPLE_TYPE: () => ek,
	ATTR_PPROF_SCOPE_SAMPLE_TYPE_ORDER: () => tk,
	ATTR_PROCESS_ARGS_COUNT: () => nk,
	ATTR_PROCESS_COMMAND: () => rk,
	ATTR_PROCESS_COMMAND_ARGS: () => ik,
	ATTR_PROCESS_COMMAND_LINE: () => ak,
	ATTR_PROCESS_CONTEXT_SWITCH_TYPE: () => ok,
	ATTR_PROCESS_CPU_STATE: () => lk,
	ATTR_PROCESS_CREATION_TIME: () => pk,
	ATTR_PROCESS_ENVIRONMENT_VARIABLE: () => mk,
	ATTR_PROCESS_EXECUTABLE_BUILD_ID_GNU: () => hk,
	ATTR_PROCESS_EXECUTABLE_BUILD_ID_GO: () => gk,
	ATTR_PROCESS_EXECUTABLE_BUILD_ID_HTLHASH: () => _k,
	ATTR_PROCESS_EXECUTABLE_BUILD_ID_PROFILING: () => vk,
	ATTR_PROCESS_EXECUTABLE_NAME: () => yk,
	ATTR_PROCESS_EXECUTABLE_PATH: () => bk,
	ATTR_PROCESS_EXIT_CODE: () => xk,
	ATTR_PROCESS_EXIT_TIME: () => Sk,
	ATTR_PROCESS_GROUP_LEADER_PID: () => Ck,
	ATTR_PROCESS_INTERACTIVE: () => wk,
	ATTR_PROCESS_LINUX_CGROUP: () => Tk,
	ATTR_PROCESS_OWNER: () => Ek,
	ATTR_PROCESS_PAGING_FAULT_TYPE: () => Dk,
	ATTR_PROCESS_PARENT_PID: () => Ak,
	ATTR_PROCESS_PID: () => jk,
	ATTR_PROCESS_REAL_USER_ID: () => Mk,
	ATTR_PROCESS_REAL_USER_NAME: () => Nk,
	ATTR_PROCESS_RUNTIME_DESCRIPTION: () => Pk,
	ATTR_PROCESS_RUNTIME_NAME: () => Fk,
	ATTR_PROCESS_RUNTIME_VERSION: () => Ik,
	ATTR_PROCESS_SAVED_USER_ID: () => Lk,
	ATTR_PROCESS_SAVED_USER_NAME: () => Rk,
	ATTR_PROCESS_SESSION_LEADER_PID: () => zk,
	ATTR_PROCESS_STATE: () => Bk,
	ATTR_PROCESS_TITLE: () => Gk,
	ATTR_PROCESS_USER_ID: () => Kk,
	ATTR_PROCESS_USER_NAME: () => qk,
	ATTR_PROCESS_VPID: () => Jk,
	ATTR_PROCESS_WORKING_DIRECTORY: () => Yk,
	ATTR_PROFILE_FRAME_TYPE: () => Xk,
	ATTR_RPC_CONNECT_RPC_ERROR_CODE: () => sA,
	ATTR_RPC_CONNECT_RPC_REQUEST_METADATA: () => wA,
	ATTR_RPC_CONNECT_RPC_RESPONSE_METADATA: () => TA,
	ATTR_RPC_GRPC_REQUEST_METADATA: () => EA,
	ATTR_RPC_GRPC_RESPONSE_METADATA: () => DA,
	ATTR_RPC_GRPC_STATUS_CODE: () => OA,
	ATTR_RPC_JSONRPC_ERROR_CODE: () => kA,
	ATTR_RPC_JSONRPC_ERROR_MESSAGE: () => AA,
	ATTR_RPC_JSONRPC_REQUEST_ID: () => jA,
	ATTR_RPC_JSONRPC_VERSION: () => MA,
	ATTR_RPC_MESSAGE_COMPRESSED_SIZE: () => NA,
	ATTR_RPC_MESSAGE_ID: () => PA,
	ATTR_RPC_MESSAGE_TYPE: () => FA,
	ATTR_RPC_MESSAGE_UNCOMPRESSED_SIZE: () => RA,
	ATTR_RPC_METHOD: () => zA,
	ATTR_RPC_METHOD_ORIGINAL: () => BA,
	ATTR_RPC_REQUEST_METADATA: () => VA,
	ATTR_RPC_RESPONSE_METADATA: () => HA,
	ATTR_RPC_RESPONSE_STATUS_CODE: () => UA,
	ATTR_RPC_SERVICE: () => WA,
	ATTR_RPC_SYSTEM: () => GA,
	ATTR_RPC_SYSTEM_NAME: () => $A,
	ATTR_SECURITY_RULE_CATEGORY: () => ij,
	ATTR_SECURITY_RULE_DESCRIPTION: () => aj,
	ATTR_SECURITY_RULE_LICENSE: () => oj,
	ATTR_SECURITY_RULE_NAME: () => sj,
	ATTR_SECURITY_RULE_REFERENCE: () => cj,
	ATTR_SECURITY_RULE_RULESET_NAME: () => lj,
	ATTR_SECURITY_RULE_UUID: () => uj,
	ATTR_SECURITY_RULE_VERSION: () => dj,
	ATTR_SERVER_ADDRESS: () => Ar,
	ATTR_SERVER_PORT: () => jr,
	ATTR_SERVICE_CRITICALITY: () => fj,
	ATTR_SERVICE_INSTANCE_ID: () => Mr,
	ATTR_SERVICE_NAME: () => Nr,
	ATTR_SERVICE_NAMESPACE: () => Pr,
	ATTR_SERVICE_PEER_NAME: () => gj,
	ATTR_SERVICE_PEER_NAMESPACE: () => _j,
	ATTR_SERVICE_VERSION: () => Fr,
	ATTR_SESSION_ID: () => vj,
	ATTR_SESSION_PREVIOUS_ID: () => yj,
	ATTR_SIGNALR_CONNECTION_STATUS: () => Ir,
	ATTR_SIGNALR_TRANSPORT: () => Br,
	ATTR_SOURCE_ADDRESS: () => bj,
	ATTR_SOURCE_PORT: () => xj,
	ATTR_STATE: () => Sj,
	ATTR_SYSTEM_CPU_LOGICAL_NUMBER: () => Tj,
	ATTR_SYSTEM_CPU_STATE: () => Ej,
	ATTR_SYSTEM_DEVICE: () => Pj,
	ATTR_SYSTEM_FILESYSTEM_MODE: () => Fj,
	ATTR_SYSTEM_FILESYSTEM_MOUNTPOINT: () => Ij,
	ATTR_SYSTEM_FILESYSTEM_STATE: () => Lj,
	ATTR_SYSTEM_FILESYSTEM_TYPE: () => Vj,
	ATTR_SYSTEM_MEMORY_LINUX_HUGEPAGES_STATE: () => Jj,
	ATTR_SYSTEM_MEMORY_LINUX_SLAB_STATE: () => Zj,
	ATTR_SYSTEM_MEMORY_STATE: () => eM,
	ATTR_SYSTEM_NETWORK_STATE: () => oM,
	ATTR_SYSTEM_PAGING_DIRECTION: () => yM,
	ATTR_SYSTEM_PAGING_FAULT_TYPE: () => bM,
	ATTR_SYSTEM_PAGING_STATE: () => CM,
	ATTR_SYSTEM_PAGING_TYPE: () => EM,
	ATTR_SYSTEM_PROCESSES_STATUS: () => PM,
	ATTR_SYSTEM_PROCESS_STATUS: () => kM,
	ATTR_TELEMETRY_DISTRO_NAME: () => Wr,
	ATTR_TELEMETRY_DISTRO_VERSION: () => Gr,
	ATTR_TELEMETRY_SDK_LANGUAGE: () => Kr,
	ATTR_TELEMETRY_SDK_NAME: () => ri,
	ATTR_TELEMETRY_SDK_VERSION: () => ii,
	ATTR_TEST_CASE_NAME: () => zM,
	ATTR_TEST_CASE_RESULT_STATUS: () => BM,
	ATTR_TEST_SUITE_NAME: () => UM,
	ATTR_TEST_SUITE_RUN_STATUS: () => WM,
	ATTR_THREAD_ID: () => ZM,
	ATTR_THREAD_NAME: () => QM,
	ATTR_TLS_CIPHER: () => $M,
	ATTR_TLS_CLIENT_CERTIFICATE: () => eN,
	ATTR_TLS_CLIENT_CERTIFICATE_CHAIN: () => tN,
	ATTR_TLS_CLIENT_HASH_MD5: () => nN,
	ATTR_TLS_CLIENT_HASH_SHA1: () => rN,
	ATTR_TLS_CLIENT_HASH_SHA256: () => iN,
	ATTR_TLS_CLIENT_ISSUER: () => aN,
	ATTR_TLS_CLIENT_JA3: () => oN,
	ATTR_TLS_CLIENT_NOT_AFTER: () => sN,
	ATTR_TLS_CLIENT_NOT_BEFORE: () => cN,
	ATTR_TLS_CLIENT_SERVER_NAME: () => lN,
	ATTR_TLS_CLIENT_SUBJECT: () => uN,
	ATTR_TLS_CLIENT_SUPPORTED_CIPHERS: () => dN,
	ATTR_TLS_CURVE: () => fN,
	ATTR_TLS_ESTABLISHED: () => pN,
	ATTR_TLS_NEXT_PROTOCOL: () => mN,
	ATTR_TLS_PROTOCOL_NAME: () => hN,
	ATTR_TLS_PROTOCOL_VERSION: () => gN,
	ATTR_TLS_RESUMED: () => _N,
	ATTR_TLS_SERVER_CERTIFICATE: () => vN,
	ATTR_TLS_SERVER_CERTIFICATE_CHAIN: () => yN,
	ATTR_TLS_SERVER_HASH_MD5: () => bN,
	ATTR_TLS_SERVER_HASH_SHA1: () => xN,
	ATTR_TLS_SERVER_HASH_SHA256: () => SN,
	ATTR_TLS_SERVER_ISSUER: () => CN,
	ATTR_TLS_SERVER_JA3S: () => wN,
	ATTR_TLS_SERVER_NOT_AFTER: () => TN,
	ATTR_TLS_SERVER_NOT_BEFORE: () => EN,
	ATTR_TLS_SERVER_SUBJECT: () => DN,
	ATTR_URL_DOMAIN: () => ON,
	ATTR_URL_EXTENSION: () => kN,
	ATTR_URL_FRAGMENT: () => ai,
	ATTR_URL_FULL: () => oi,
	ATTR_URL_ORIGINAL: () => AN,
	ATTR_URL_PATH: () => si,
	ATTR_URL_PORT: () => jN,
	ATTR_URL_QUERY: () => ci,
	ATTR_URL_REGISTERED_DOMAIN: () => MN,
	ATTR_URL_SCHEME: () => li,
	ATTR_URL_SUBDOMAIN: () => NN,
	ATTR_URL_TEMPLATE: () => PN,
	ATTR_URL_TOP_LEVEL_DOMAIN: () => FN,
	ATTR_USER_AGENT_NAME: () => HN,
	ATTR_USER_AGENT_ORIGINAL: () => ui,
	ATTR_USER_AGENT_OS_NAME: () => UN,
	ATTR_USER_AGENT_OS_VERSION: () => WN,
	ATTR_USER_AGENT_SYNTHETIC_TYPE: () => GN,
	ATTR_USER_AGENT_VERSION: () => qN,
	ATTR_USER_EMAIL: () => IN,
	ATTR_USER_FULL_NAME: () => LN,
	ATTR_USER_HASH: () => RN,
	ATTR_USER_ID: () => zN,
	ATTR_USER_NAME: () => BN,
	ATTR_USER_ROLES: () => VN,
	ATTR_V8JS_GC_TYPE: () => JN,
	ATTR_V8JS_HEAP_SPACE_NAME: () => $N,
	ATTR_V8JS_RESOURCE_TYPE: () => aP,
	ATTR_VCS_CHANGE_ID: () => dP,
	ATTR_VCS_CHANGE_STATE: () => fP,
	ATTR_VCS_CHANGE_TITLE: () => gP,
	ATTR_VCS_LINE_CHANGE_TYPE: () => _P,
	ATTR_VCS_OWNER_NAME: () => bP,
	ATTR_VCS_PROVIDER_NAME: () => xP,
	ATTR_VCS_REF_BASE_NAME: () => DP,
	ATTR_VCS_REF_BASE_REVISION: () => OP,
	ATTR_VCS_REF_BASE_TYPE: () => kP,
	ATTR_VCS_REF_HEAD_NAME: () => jP,
	ATTR_VCS_REF_HEAD_REVISION: () => MP,
	ATTR_VCS_REF_HEAD_TYPE: () => NP,
	ATTR_VCS_REF_TYPE: () => FP,
	ATTR_VCS_REPOSITORY_CHANGE_ID: () => LP,
	ATTR_VCS_REPOSITORY_CHANGE_TITLE: () => RP,
	ATTR_VCS_REPOSITORY_NAME: () => zP,
	ATTR_VCS_REPOSITORY_REF_NAME: () => BP,
	ATTR_VCS_REPOSITORY_REF_REVISION: () => VP,
	ATTR_VCS_REPOSITORY_REF_TYPE: () => HP,
	ATTR_VCS_REPOSITORY_URL_FULL: () => WP,
	ATTR_VCS_REVISION_DELTA_DIRECTION: () => GP,
	ATTR_WEBENGINE_DESCRIPTION: () => JP,
	ATTR_WEBENGINE_NAME: () => YP,
	ATTR_WEBENGINE_VERSION: () => XP,
	ATTR_ZOS_SMF_ID: () => ZP,
	ATTR_ZOS_SYSPLEX_NAME: () => QP,
	AWS_ECS_LAUNCHTYPE_VALUE_EC2: () => "ec2",
	AWS_ECS_LAUNCHTYPE_VALUE_FARGATE: () => Is,
	AZURE_COSMOSDB_CONNECTION_MODE_VALUE_DIRECT: () => fc,
	AZURE_COSMOSDB_CONNECTION_MODE_VALUE_GATEWAY: () => pc,
	AZURE_COSMOSDB_CONSISTENCY_LEVEL_VALUE_BOUNDED_STALENESS: () => hc,
	AZURE_COSMOSDB_CONSISTENCY_LEVEL_VALUE_CONSISTENT_PREFIX: () => gc,
	AZURE_COSMOSDB_CONSISTENCY_LEVEL_VALUE_EVENTUAL: () => _c,
	AZURE_COSMOSDB_CONSISTENCY_LEVEL_VALUE_SESSION: () => vc,
	AZURE_COSMOSDB_CONSISTENCY_LEVEL_VALUE_STRONG: () => yc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_ALL: () => "all",
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_ANY: () => "any",
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_EACH_QUORUM: () => Nc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_LOCAL_ONE: () => Pc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_LOCAL_QUORUM: () => Fc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_LOCAL_SERIAL: () => Ic,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_ONE: () => "one",
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_QUORUM: () => Lc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_SERIAL: () => Rc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_THREE: () => zc,
	CASSANDRA_CONSISTENCY_LEVEL_VALUE_TWO: () => "two",
	CICD_PIPELINE_ACTION_NAME_VALUE_BUILD: () => Kc,
	CICD_PIPELINE_ACTION_NAME_VALUE_RUN: () => "RUN",
	CICD_PIPELINE_ACTION_NAME_VALUE_SYNC: () => qc,
	CICD_PIPELINE_RESULT_VALUE_CANCELLATION: () => Xc,
	CICD_PIPELINE_RESULT_VALUE_ERROR: () => Zc,
	CICD_PIPELINE_RESULT_VALUE_FAILURE: () => Qc,
	CICD_PIPELINE_RESULT_VALUE_SKIP: () => $c,
	CICD_PIPELINE_RESULT_VALUE_SUCCESS: () => el,
	CICD_PIPELINE_RESULT_VALUE_TIMEOUT: () => tl,
	CICD_PIPELINE_RUN_STATE_VALUE_EXECUTING: () => il,
	CICD_PIPELINE_RUN_STATE_VALUE_FINALIZING: () => al,
	CICD_PIPELINE_RUN_STATE_VALUE_PENDING: () => ol,
	CICD_PIPELINE_TASK_RUN_RESULT_VALUE_CANCELLATION: () => dl,
	CICD_PIPELINE_TASK_RUN_RESULT_VALUE_ERROR: () => fl,
	CICD_PIPELINE_TASK_RUN_RESULT_VALUE_FAILURE: () => pl,
	CICD_PIPELINE_TASK_RUN_RESULT_VALUE_SKIP: () => ml,
	CICD_PIPELINE_TASK_RUN_RESULT_VALUE_SUCCESS: () => hl,
	CICD_PIPELINE_TASK_RUN_RESULT_VALUE_TIMEOUT: () => gl,
	CICD_PIPELINE_TASK_TYPE_VALUE_BUILD: () => yl,
	CICD_PIPELINE_TASK_TYPE_VALUE_DEPLOY: () => bl,
	CICD_PIPELINE_TASK_TYPE_VALUE_TEST: () => xl,
	CICD_WORKER_STATE_VALUE_AVAILABLE: () => El,
	CICD_WORKER_STATE_VALUE_BUSY: () => Dl,
	CICD_WORKER_STATE_VALUE_OFFLINE: () => Ol,
	CLOUD_PLATFORM_VALUE_AKAMAI_CLOUD_COMPUTE: () => Nl,
	CLOUD_PLATFORM_VALUE_ALIBABA_CLOUD_ECS: () => Pl,
	CLOUD_PLATFORM_VALUE_ALIBABA_CLOUD_FC: () => Fl,
	CLOUD_PLATFORM_VALUE_ALIBABA_CLOUD_OPENSHIFT: () => Il,
	CLOUD_PLATFORM_VALUE_AWS_APP_RUNNER: () => Ll,
	CLOUD_PLATFORM_VALUE_AWS_EC2: () => Rl,
	CLOUD_PLATFORM_VALUE_AWS_ECS: () => zl,
	CLOUD_PLATFORM_VALUE_AWS_EKS: () => Bl,
	CLOUD_PLATFORM_VALUE_AWS_ELASTIC_BEANSTALK: () => Vl,
	CLOUD_PLATFORM_VALUE_AWS_LAMBDA: () => Hl,
	CLOUD_PLATFORM_VALUE_AWS_OPENSHIFT: () => Ul,
	CLOUD_PLATFORM_VALUE_AZURE_AKS: () => Wl,
	CLOUD_PLATFORM_VALUE_AZURE_APP_SERVICE: () => Gl,
	CLOUD_PLATFORM_VALUE_AZURE_CONTAINER_APPS: () => Kl,
	CLOUD_PLATFORM_VALUE_AZURE_CONTAINER_INSTANCES: () => ql,
	CLOUD_PLATFORM_VALUE_AZURE_FUNCTIONS: () => Jl,
	CLOUD_PLATFORM_VALUE_AZURE_OPENSHIFT: () => Yl,
	CLOUD_PLATFORM_VALUE_AZURE_VM: () => Xl,
	CLOUD_PLATFORM_VALUE_GCP_AGENT_ENGINE: () => Zl,
	CLOUD_PLATFORM_VALUE_GCP_APP_ENGINE: () => Ql,
	CLOUD_PLATFORM_VALUE_GCP_BARE_METAL_SOLUTION: () => $l,
	CLOUD_PLATFORM_VALUE_GCP_CLOUD_FUNCTIONS: () => eu,
	CLOUD_PLATFORM_VALUE_GCP_CLOUD_RUN: () => tu,
	CLOUD_PLATFORM_VALUE_GCP_COMPUTE_ENGINE: () => nu,
	CLOUD_PLATFORM_VALUE_GCP_KUBERNETES_ENGINE: () => ru,
	CLOUD_PLATFORM_VALUE_GCP_OPENSHIFT: () => iu,
	CLOUD_PLATFORM_VALUE_HETZNER_CLOUD_SERVER: () => au,
	CLOUD_PLATFORM_VALUE_IBM_CLOUD_OPENSHIFT: () => ou,
	CLOUD_PLATFORM_VALUE_ORACLE_CLOUD_COMPUTE: () => su,
	CLOUD_PLATFORM_VALUE_ORACLE_CLOUD_OKE: () => cu,
	CLOUD_PLATFORM_VALUE_TENCENT_CLOUD_CVM: () => lu,
	CLOUD_PLATFORM_VALUE_TENCENT_CLOUD_EKS: () => uu,
	CLOUD_PLATFORM_VALUE_TENCENT_CLOUD_SCF: () => du,
	CLOUD_PLATFORM_VALUE_VULTR_CLOUD_COMPUTE: () => fu,
	CLOUD_PROVIDER_VALUE_AKAMAI_CLOUD: () => mu,
	CLOUD_PROVIDER_VALUE_ALIBABA_CLOUD: () => hu,
	CLOUD_PROVIDER_VALUE_AWS: () => "aws",
	CLOUD_PROVIDER_VALUE_AZURE: () => gu,
	CLOUD_PROVIDER_VALUE_GCP: () => "gcp",
	CLOUD_PROVIDER_VALUE_HEROKU: () => _u,
	CLOUD_PROVIDER_VALUE_HETZNER: () => vu,
	CLOUD_PROVIDER_VALUE_IBM_CLOUD: () => yu,
	CLOUD_PROVIDER_VALUE_ORACLE_CLOUD: () => bu,
	CLOUD_PROVIDER_VALUE_TENCENT_CLOUD: () => xu,
	CLOUD_PROVIDER_VALUE_VULTR: () => Su,
	CONTAINER_CPU_STATE_VALUE_KERNEL: () => Xu,
	CONTAINER_CPU_STATE_VALUE_SYSTEM: () => Zu,
	CONTAINER_CPU_STATE_VALUE_USER: () => Qu,
	CPU_MODE_VALUE_IDLE: () => dd,
	CPU_MODE_VALUE_INTERRUPT: () => fd,
	CPU_MODE_VALUE_IOWAIT: () => pd,
	CPU_MODE_VALUE_KERNEL: () => md,
	CPU_MODE_VALUE_NICE: () => hd,
	CPU_MODE_VALUE_STEAL: () => gd,
	CPU_MODE_VALUE_SYSTEM: () => _d,
	CPU_MODE_VALUE_USER: () => vd,
	CPYTHON_GC_GENERATION_VALUE_GENERATION_0: () => 0,
	CPYTHON_GC_GENERATION_VALUE_GENERATION_1: () => 1,
	CPYTHON_GC_GENERATION_VALUE_GENERATION_2: () => 2,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_ALL: () => "all",
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_ANY: () => "any",
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_EACH_QUORUM: () => xd,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_LOCAL_ONE: () => Sd,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_LOCAL_QUORUM: () => Cd,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_LOCAL_SERIAL: () => wd,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_ONE: () => "one",
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_QUORUM: () => Td,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_SERIAL: () => Ed,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_THREE: () => Dd,
	DB_CASSANDRA_CONSISTENCY_LEVEL_VALUE_TWO: () => "two",
	DB_CLIENT_CONNECTIONS_STATE_VALUE_IDLE: () => Bd,
	DB_CLIENT_CONNECTIONS_STATE_VALUE_USED: () => Vd,
	DB_CLIENT_CONNECTION_STATE_VALUE_IDLE: () => Id,
	DB_CLIENT_CONNECTION_STATE_VALUE_USED: () => Ld,
	DB_COSMOSDB_CONNECTION_MODE_VALUE_DIRECT: () => Gd,
	DB_COSMOSDB_CONNECTION_MODE_VALUE_GATEWAY: () => Kd,
	DB_COSMOSDB_CONSISTENCY_LEVEL_VALUE_BOUNDED_STALENESS: () => Jd,
	DB_COSMOSDB_CONSISTENCY_LEVEL_VALUE_CONSISTENT_PREFIX: () => Yd,
	DB_COSMOSDB_CONSISTENCY_LEVEL_VALUE_EVENTUAL: () => Xd,
	DB_COSMOSDB_CONSISTENCY_LEVEL_VALUE_SESSION: () => Zd,
	DB_COSMOSDB_CONSISTENCY_LEVEL_VALUE_STRONG: () => Qd,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_BATCH: () => tf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_CREATE: () => nf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_DELETE: () => rf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_EXECUTE: () => af,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_EXECUTE_JAVASCRIPT: () => of,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_HEAD: () => sf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_HEAD_FEED: () => cf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_INVALID: () => lf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_PATCH: () => uf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_QUERY: () => df,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_QUERY_PLAN: () => ff,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_READ: () => pf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_READ_FEED: () => mf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_REPLACE: () => hf,
	DB_COSMOSDB_OPERATION_TYPE_VALUE_UPSERT: () => gf,
	DB_SYSTEM_NAME_VALUE_ACTIAN_INGRES: () => Fp,
	DB_SYSTEM_NAME_VALUE_AWS_DYNAMODB: () => Ip,
	DB_SYSTEM_NAME_VALUE_AWS_REDSHIFT: () => Lp,
	DB_SYSTEM_NAME_VALUE_AZURE_COSMOSDB: () => Rp,
	DB_SYSTEM_NAME_VALUE_CASSANDRA: () => zp,
	DB_SYSTEM_NAME_VALUE_CLICKHOUSE: () => Bp,
	DB_SYSTEM_NAME_VALUE_COCKROACHDB: () => Vp,
	DB_SYSTEM_NAME_VALUE_COUCHBASE: () => Hp,
	DB_SYSTEM_NAME_VALUE_COUCHDB: () => Up,
	DB_SYSTEM_NAME_VALUE_DERBY: () => Wp,
	DB_SYSTEM_NAME_VALUE_ELASTICSEARCH: () => Gp,
	DB_SYSTEM_NAME_VALUE_FIREBIRDSQL: () => Kp,
	DB_SYSTEM_NAME_VALUE_GCP_SPANNER: () => qp,
	DB_SYSTEM_NAME_VALUE_GEODE: () => Jp,
	DB_SYSTEM_NAME_VALUE_H2DATABASE: () => Yp,
	DB_SYSTEM_NAME_VALUE_HBASE: () => Xp,
	DB_SYSTEM_NAME_VALUE_HIVE: () => Zp,
	DB_SYSTEM_NAME_VALUE_HSQLDB: () => Qp,
	DB_SYSTEM_NAME_VALUE_IBM_DB2: () => $p,
	DB_SYSTEM_NAME_VALUE_IBM_INFORMIX: () => em,
	DB_SYSTEM_NAME_VALUE_IBM_NETEZZA: () => tm,
	DB_SYSTEM_NAME_VALUE_INFLUXDB: () => nm,
	DB_SYSTEM_NAME_VALUE_INSTANTDB: () => rm,
	DB_SYSTEM_NAME_VALUE_INTERSYSTEMS_CACHE: () => im,
	DB_SYSTEM_NAME_VALUE_MARIADB: () => At,
	DB_SYSTEM_NAME_VALUE_MEMCACHED: () => am,
	DB_SYSTEM_NAME_VALUE_MICROSOFT_SQL_SERVER: () => jt,
	DB_SYSTEM_NAME_VALUE_MONGODB: () => om,
	DB_SYSTEM_NAME_VALUE_MYSQL: () => Mt,
	DB_SYSTEM_NAME_VALUE_NEO4J: () => sm,
	DB_SYSTEM_NAME_VALUE_OPENSEARCH: () => cm,
	DB_SYSTEM_NAME_VALUE_ORACLE_DB: () => lm,
	DB_SYSTEM_NAME_VALUE_OTHER_SQL: () => um,
	DB_SYSTEM_NAME_VALUE_POSTGRESQL: () => Nt,
	DB_SYSTEM_NAME_VALUE_REDIS: () => dm,
	DB_SYSTEM_NAME_VALUE_SAP_HANA: () => fm,
	DB_SYSTEM_NAME_VALUE_SAP_MAXDB: () => pm,
	DB_SYSTEM_NAME_VALUE_SOFTWAREAG_ADABAS: () => mm,
	DB_SYSTEM_NAME_VALUE_SQLITE: () => hm,
	DB_SYSTEM_NAME_VALUE_TERADATA: () => gm,
	DB_SYSTEM_NAME_VALUE_TRINO: () => _m,
	DB_SYSTEM_VALUE_ADABAS: () => Rf,
	DB_SYSTEM_VALUE_CACHE: () => zf,
	DB_SYSTEM_VALUE_CASSANDRA: () => Bf,
	DB_SYSTEM_VALUE_CLICKHOUSE: () => Vf,
	DB_SYSTEM_VALUE_CLOUDSCAPE: () => Hf,
	DB_SYSTEM_VALUE_COCKROACHDB: () => Uf,
	DB_SYSTEM_VALUE_COLDFUSION: () => Wf,
	DB_SYSTEM_VALUE_COSMOSDB: () => Gf,
	DB_SYSTEM_VALUE_COUCHBASE: () => Kf,
	DB_SYSTEM_VALUE_COUCHDB: () => qf,
	DB_SYSTEM_VALUE_DB2: () => "db2",
	DB_SYSTEM_VALUE_DERBY: () => Jf,
	DB_SYSTEM_VALUE_DYNAMODB: () => Yf,
	DB_SYSTEM_VALUE_EDB: () => "edb",
	DB_SYSTEM_VALUE_ELASTICSEARCH: () => Xf,
	DB_SYSTEM_VALUE_FILEMAKER: () => Zf,
	DB_SYSTEM_VALUE_FIREBIRD: () => Qf,
	DB_SYSTEM_VALUE_FIRSTSQL: () => $f,
	DB_SYSTEM_VALUE_GEODE: () => ep,
	DB_SYSTEM_VALUE_H2: () => "h2",
	DB_SYSTEM_VALUE_HANADB: () => tp,
	DB_SYSTEM_VALUE_HBASE: () => np,
	DB_SYSTEM_VALUE_HIVE: () => rp,
	DB_SYSTEM_VALUE_HSQLDB: () => ip,
	DB_SYSTEM_VALUE_INFLUXDB: () => ap,
	DB_SYSTEM_VALUE_INFORMIX: () => op,
	DB_SYSTEM_VALUE_INGRES: () => sp,
	DB_SYSTEM_VALUE_INSTANTDB: () => cp,
	DB_SYSTEM_VALUE_INTERBASE: () => lp,
	DB_SYSTEM_VALUE_INTERSYSTEMS_CACHE: () => up,
	DB_SYSTEM_VALUE_MARIADB: () => dp,
	DB_SYSTEM_VALUE_MAXDB: () => fp,
	DB_SYSTEM_VALUE_MEMCACHED: () => pp,
	DB_SYSTEM_VALUE_MONGODB: () => mp,
	DB_SYSTEM_VALUE_MSSQL: () => hp,
	DB_SYSTEM_VALUE_MSSQLCOMPACT: () => gp,
	DB_SYSTEM_VALUE_MYSQL: () => _p,
	DB_SYSTEM_VALUE_NEO4J: () => vp,
	DB_SYSTEM_VALUE_NETEZZA: () => yp,
	DB_SYSTEM_VALUE_OPENSEARCH: () => bp,
	DB_SYSTEM_VALUE_ORACLE: () => xp,
	DB_SYSTEM_VALUE_OTHER_SQL: () => Sp,
	DB_SYSTEM_VALUE_PERVASIVE: () => Cp,
	DB_SYSTEM_VALUE_POINTBASE: () => wp,
	DB_SYSTEM_VALUE_POSTGRESQL: () => Tp,
	DB_SYSTEM_VALUE_PROGRESS: () => Ep,
	DB_SYSTEM_VALUE_REDIS: () => Dp,
	DB_SYSTEM_VALUE_REDSHIFT: () => Op,
	DB_SYSTEM_VALUE_SPANNER: () => kp,
	DB_SYSTEM_VALUE_SQLITE: () => Ap,
	DB_SYSTEM_VALUE_SYBASE: () => jp,
	DB_SYSTEM_VALUE_TERADATA: () => Mp,
	DB_SYSTEM_VALUE_TRINO: () => Np,
	DB_SYSTEM_VALUE_VERTICA: () => Pp,
	DEPLOYMENT_ENVIRONMENT_NAME_VALUE_DEVELOPMENT: () => Ft,
	DEPLOYMENT_ENVIRONMENT_NAME_VALUE_PRODUCTION: () => It,
	DEPLOYMENT_ENVIRONMENT_NAME_VALUE_STAGING: () => Lt,
	DEPLOYMENT_ENVIRONMENT_NAME_VALUE_TEST: () => Rt,
	DEPLOYMENT_STATUS_VALUE_FAILED: () => Cm,
	DEPLOYMENT_STATUS_VALUE_SUCCEEDED: () => wm,
	DISK_IO_DIRECTION_VALUE_READ: () => Mm,
	DISK_IO_DIRECTION_VALUE_WRITE: () => Nm,
	DOTNET_GC_HEAP_GENERATION_VALUE_GEN0: () => Bt,
	DOTNET_GC_HEAP_GENERATION_VALUE_GEN1: () => Vt,
	DOTNET_GC_HEAP_GENERATION_VALUE_GEN2: () => Ht,
	DOTNET_GC_HEAP_GENERATION_VALUE_LOH: () => "loh",
	DOTNET_GC_HEAP_GENERATION_VALUE_POH: () => "poh",
	ERROR_TYPE_VALUE_OTHER: () => Wt,
	EVENT_APP_CRASH: () => KU,
	EVENT_APP_JANK: () => qU,
	EVENT_APP_SCREEN_CLICK: () => JU,
	EVENT_APP_WIDGET_CLICK: () => YU,
	EVENT_AZURE_RESOURCE_LOG: () => ZU,
	EVENT_AZ_RESOURCE_LOG: () => XU,
	EVENT_BROWSER_WEB_VITAL: () => QU,
	EVENT_DB_CLIENT_OPERATION_EXCEPTION: () => $U,
	EVENT_DEVICE_APP_LIFECYCLE: () => eW,
	EVENT_EXCEPTION: () => ca,
	EVENT_FAAS_INVOCATION_EXCEPTION: () => tW,
	EVENT_FEATURE_FLAG_EVALUATION: () => nW,
	EVENT_GEN_AI_ASSISTANT_MESSAGE: () => rW,
	EVENT_GEN_AI_CHOICE: () => iW,
	EVENT_GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS: () => aW,
	EVENT_GEN_AI_CLIENT_OPERATION_EXCEPTION: () => oW,
	EVENT_GEN_AI_EVALUATION_RESULT: () => sW,
	EVENT_GEN_AI_SYSTEM_MESSAGE: () => cW,
	EVENT_GEN_AI_TOOL_MESSAGE: () => lW,
	EVENT_GEN_AI_USER_MESSAGE: () => uW,
	EVENT_HTTP_CLIENT_REQUEST_EXCEPTION: () => dW,
	EVENT_HTTP_SERVER_REQUEST_EXCEPTION: () => fW,
	EVENT_MESSAGING_CREATE_EXCEPTION: () => pW,
	EVENT_MESSAGING_PROCESS_EXCEPTION: () => mW,
	EVENT_MESSAGING_RECEIVE_EXCEPTION: () => hW,
	EVENT_MESSAGING_SEND_EXCEPTION: () => gW,
	EVENT_MESSAGING_SETTLE_EXCEPTION: () => _W,
	EVENT_RPC_CLIENT_CALL_EXCEPTION: () => vW,
	EVENT_RPC_MESSAGE: () => yW,
	EVENT_RPC_SERVER_CALL_EXCEPTION: () => bW,
	EVENT_SESSION_END: () => xW,
	EVENT_SESSION_START: () => SW,
	FAAS_DOCUMENT_OPERATION_VALUE_DELETE: () => Jm,
	FAAS_DOCUMENT_OPERATION_VALUE_EDIT: () => Ym,
	FAAS_DOCUMENT_OPERATION_VALUE_INSERT: () => Xm,
	FAAS_INVOKED_PROVIDER_VALUE_ALIBABA_CLOUD: () => nh,
	FAAS_INVOKED_PROVIDER_VALUE_AWS: () => "aws",
	FAAS_INVOKED_PROVIDER_VALUE_AZURE: () => rh,
	FAAS_INVOKED_PROVIDER_VALUE_GCP: () => "gcp",
	FAAS_INVOKED_PROVIDER_VALUE_TENCENT_CLOUD: () => ih,
	FAAS_TRIGGER_VALUE_DATASOURCE: () => uh,
	FAAS_TRIGGER_VALUE_HTTP: () => dh,
	FAAS_TRIGGER_VALUE_OTHER: () => fh,
	FAAS_TRIGGER_VALUE_PUBSUB: () => ph,
	FAAS_TRIGGER_VALUE_TIMER: () => mh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_CACHED: () => bh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_DEFAULT: () => xh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_DISABLED: () => Sh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_ERROR: () => Ch,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_SPLIT: () => wh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_STALE: () => Th,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_STATIC: () => Eh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_TARGETING_MATCH: () => Dh,
	FEATURE_FLAG_EVALUATION_REASON_VALUE_UNKNOWN: () => Oh,
	FEATURE_FLAG_RESULT_REASON_VALUE_CACHED: () => Mh,
	FEATURE_FLAG_RESULT_REASON_VALUE_DEFAULT: () => Nh,
	FEATURE_FLAG_RESULT_REASON_VALUE_DISABLED: () => Ph,
	FEATURE_FLAG_RESULT_REASON_VALUE_ERROR: () => Fh,
	FEATURE_FLAG_RESULT_REASON_VALUE_SPLIT: () => Ih,
	FEATURE_FLAG_RESULT_REASON_VALUE_STALE: () => Lh,
	FEATURE_FLAG_RESULT_REASON_VALUE_STATIC: () => Rh,
	FEATURE_FLAG_RESULT_REASON_VALUE_TARGETING_MATCH: () => zh,
	FEATURE_FLAG_RESULT_REASON_VALUE_UNKNOWN: () => Bh,
	FILE_LOCK_TYPE_VALUE_READ: () => ag,
	FILE_LOCK_TYPE_VALUE_WRITE: () => og,
	GCP_APPHUB_DESTINATION_SERVICE_CRITICALITY_TYPE_VALUE_HIGH: () => Hg,
	GCP_APPHUB_DESTINATION_SERVICE_CRITICALITY_TYPE_VALUE_LOW: () => "LOW",
	GCP_APPHUB_DESTINATION_SERVICE_CRITICALITY_TYPE_VALUE_MEDIUM: () => Ug,
	GCP_APPHUB_DESTINATION_SERVICE_CRITICALITY_TYPE_VALUE_MISSION_CRITICAL: () => Wg,
	GCP_APPHUB_DESTINATION_SERVICE_ENVIRONMENT_TYPE_VALUE_DEVELOPMENT: () => Kg,
	GCP_APPHUB_DESTINATION_SERVICE_ENVIRONMENT_TYPE_VALUE_PRODUCTION: () => qg,
	GCP_APPHUB_DESTINATION_SERVICE_ENVIRONMENT_TYPE_VALUE_STAGING: () => Jg,
	GCP_APPHUB_DESTINATION_SERVICE_ENVIRONMENT_TYPE_VALUE_TEST: () => Yg,
	GCP_APPHUB_DESTINATION_WORKLOAD_CRITICALITY_TYPE_VALUE_HIGH: () => Qg,
	GCP_APPHUB_DESTINATION_WORKLOAD_CRITICALITY_TYPE_VALUE_LOW: () => "LOW",
	GCP_APPHUB_DESTINATION_WORKLOAD_CRITICALITY_TYPE_VALUE_MEDIUM: () => $g,
	GCP_APPHUB_DESTINATION_WORKLOAD_CRITICALITY_TYPE_VALUE_MISSION_CRITICAL: () => e_,
	GCP_APPHUB_DESTINATION_WORKLOAD_ENVIRONMENT_TYPE_VALUE_DEVELOPMENT: () => n_,
	GCP_APPHUB_DESTINATION_WORKLOAD_ENVIRONMENT_TYPE_VALUE_PRODUCTION: () => r_,
	GCP_APPHUB_DESTINATION_WORKLOAD_ENVIRONMENT_TYPE_VALUE_STAGING: () => i_,
	GCP_APPHUB_DESTINATION_WORKLOAD_ENVIRONMENT_TYPE_VALUE_TEST: () => a_,
	GCP_APPHUB_SERVICE_CRITICALITY_TYPE_VALUE_HIGH: () => yg,
	GCP_APPHUB_SERVICE_CRITICALITY_TYPE_VALUE_LOW: () => "LOW",
	GCP_APPHUB_SERVICE_CRITICALITY_TYPE_VALUE_MEDIUM: () => bg,
	GCP_APPHUB_SERVICE_CRITICALITY_TYPE_VALUE_MISSION_CRITICAL: () => xg,
	GCP_APPHUB_SERVICE_ENVIRONMENT_TYPE_VALUE_DEVELOPMENT: () => Cg,
	GCP_APPHUB_SERVICE_ENVIRONMENT_TYPE_VALUE_PRODUCTION: () => wg,
	GCP_APPHUB_SERVICE_ENVIRONMENT_TYPE_VALUE_STAGING: () => Tg,
	GCP_APPHUB_SERVICE_ENVIRONMENT_TYPE_VALUE_TEST: () => Eg,
	GCP_APPHUB_WORKLOAD_CRITICALITY_TYPE_VALUE_HIGH: () => kg,
	GCP_APPHUB_WORKLOAD_CRITICALITY_TYPE_VALUE_LOW: () => "LOW",
	GCP_APPHUB_WORKLOAD_CRITICALITY_TYPE_VALUE_MEDIUM: () => Ag,
	GCP_APPHUB_WORKLOAD_CRITICALITY_TYPE_VALUE_MISSION_CRITICAL: () => jg,
	GCP_APPHUB_WORKLOAD_ENVIRONMENT_TYPE_VALUE_DEVELOPMENT: () => Ng,
	GCP_APPHUB_WORKLOAD_ENVIRONMENT_TYPE_VALUE_PRODUCTION: () => Pg,
	GCP_APPHUB_WORKLOAD_ENVIRONMENT_TYPE_VALUE_STAGING: () => Fg,
	GCP_APPHUB_WORKLOAD_ENVIRONMENT_TYPE_VALUE_TEST: () => Ig,
	GEN_AI_OPENAI_REQUEST_RESPONSE_FORMAT_VALUE_JSON_OBJECT: () => D_,
	GEN_AI_OPENAI_REQUEST_RESPONSE_FORMAT_VALUE_JSON_SCHEMA: () => O_,
	GEN_AI_OPENAI_REQUEST_RESPONSE_FORMAT_VALUE_TEXT: () => k_,
	GEN_AI_OPENAI_REQUEST_SERVICE_TIER_VALUE_AUTO: () => M_,
	GEN_AI_OPENAI_REQUEST_SERVICE_TIER_VALUE_DEFAULT: () => N_,
	GEN_AI_OPERATION_NAME_VALUE_CHAT: () => F,
	GEN_AI_OPERATION_NAME_VALUE_CREATE_AGENT: () => I_,
	GEN_AI_OPERATION_NAME_VALUE_EMBEDDINGS: () => L_,
	GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL: () => R_,
	GEN_AI_OPERATION_NAME_VALUE_GENERATE_CONTENT: () => z_,
	GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT: () => I,
	GEN_AI_OPERATION_NAME_VALUE_INVOKE_WORKFLOW: () => B_,
	GEN_AI_OPERATION_NAME_VALUE_RETRIEVAL: () => V_,
	GEN_AI_OPERATION_NAME_VALUE_TEXT_COMPLETION: () => H_,
	GEN_AI_OUTPUT_TYPE_VALUE_IMAGE: () => W_,
	GEN_AI_OUTPUT_TYPE_VALUE_JSON: () => G_,
	GEN_AI_OUTPUT_TYPE_VALUE_SPEECH: () => K_,
	GEN_AI_OUTPUT_TYPE_VALUE_TEXT: () => q_,
	GEN_AI_PROVIDER_NAME_VALUE_ANTHROPIC: () => X_,
	GEN_AI_PROVIDER_NAME_VALUE_AWS_BEDROCK: () => Z_,
	GEN_AI_PROVIDER_NAME_VALUE_AZURE_AI_INFERENCE: () => Q_,
	GEN_AI_PROVIDER_NAME_VALUE_AZURE_AI_OPENAI: () => $_,
	GEN_AI_PROVIDER_NAME_VALUE_COHERE: () => ev,
	GEN_AI_PROVIDER_NAME_VALUE_DEEPSEEK: () => tv,
	GEN_AI_PROVIDER_NAME_VALUE_GCP_GEMINI: () => nv,
	GEN_AI_PROVIDER_NAME_VALUE_GCP_GEN_AI: () => rv,
	GEN_AI_PROVIDER_NAME_VALUE_GCP_VERTEX_AI: () => iv,
	GEN_AI_PROVIDER_NAME_VALUE_GROQ: () => av,
	GEN_AI_PROVIDER_NAME_VALUE_IBM_WATSONX_AI: () => ov,
	GEN_AI_PROVIDER_NAME_VALUE_MISTRAL_AI: () => z,
	GEN_AI_PROVIDER_NAME_VALUE_OPENAI: () => sv,
	GEN_AI_PROVIDER_NAME_VALUE_PERPLEXITY: () => cv,
	GEN_AI_PROVIDER_NAME_VALUE_X_AI: () => lv,
	GEN_AI_SYSTEM_VALUE_ANTHROPIC: () => Ev,
	GEN_AI_SYSTEM_VALUE_AWS_BEDROCK: () => Dv,
	GEN_AI_SYSTEM_VALUE_AZURE_AI_INFERENCE: () => Av,
	GEN_AI_SYSTEM_VALUE_AZURE_AI_OPENAI: () => jv,
	GEN_AI_SYSTEM_VALUE_AZ_AI_INFERENCE: () => Ov,
	GEN_AI_SYSTEM_VALUE_AZ_AI_OPENAI: () => kv,
	GEN_AI_SYSTEM_VALUE_COHERE: () => Mv,
	GEN_AI_SYSTEM_VALUE_DEEPSEEK: () => Nv,
	GEN_AI_SYSTEM_VALUE_GCP_GEMINI: () => Pv,
	GEN_AI_SYSTEM_VALUE_GCP_GEN_AI: () => Fv,
	GEN_AI_SYSTEM_VALUE_GCP_VERTEX_AI: () => Iv,
	GEN_AI_SYSTEM_VALUE_GEMINI: () => Lv,
	GEN_AI_SYSTEM_VALUE_GROQ: () => Rv,
	GEN_AI_SYSTEM_VALUE_IBM_WATSONX_AI: () => zv,
	GEN_AI_SYSTEM_VALUE_MISTRAL_AI: () => Bv,
	GEN_AI_SYSTEM_VALUE_OPENAI: () => Vv,
	GEN_AI_SYSTEM_VALUE_PERPLEXITY: () => Hv,
	GEN_AI_SYSTEM_VALUE_VERTEX_AI: () => Uv,
	GEN_AI_SYSTEM_VALUE_XAI: () => "xai",
	GEN_AI_TOKEN_TYPE_VALUE_COMPLETION: () => Kv,
	GEN_AI_TOKEN_TYPE_VALUE_INPUT: () => Gv,
	GEN_AI_TOKEN_TYPE_VALUE_OUTPUT: () => qv,
	GEO_CONTINENT_CODE_VALUE_AF: () => "AF",
	GEO_CONTINENT_CODE_VALUE_AN: () => "AN",
	GEO_CONTINENT_CODE_VALUE_AS: () => "AS",
	GEO_CONTINENT_CODE_VALUE_EU: () => "EU",
	GEO_CONTINENT_CODE_VALUE_NA: () => "NA",
	GEO_CONTINENT_CODE_VALUE_OC: () => "OC",
	GEO_CONTINENT_CODE_VALUE_SA: () => "SA",
	GO_CPU_STATE_VALUE_GC: () => "gc",
	GO_CPU_STATE_VALUE_IDLE: () => vy,
	GO_CPU_STATE_VALUE_SCAVENGE: () => yy,
	GO_CPU_STATE_VALUE_USER: () => by,
	GO_MEMORY_TYPE_VALUE_OTHER: () => Cy,
	GO_MEMORY_TYPE_VALUE_STACK: () => wy,
	GRAPHQL_OPERATION_TYPE_VALUE_MUTATION: () => Oy,
	GRAPHQL_OPERATION_TYPE_VALUE_QUERY: () => ky,
	GRAPHQL_OPERATION_TYPE_VALUE_SUBSCRIPTION: () => Ay,
	HOST_ARCH_VALUE_AMD64: () => Fy,
	HOST_ARCH_VALUE_ARM32: () => Iy,
	HOST_ARCH_VALUE_ARM64: () => Ly,
	HOST_ARCH_VALUE_IA64: () => Ry,
	HOST_ARCH_VALUE_PPC32: () => zy,
	HOST_ARCH_VALUE_PPC64: () => By,
	HOST_ARCH_VALUE_S390X: () => Vy,
	HOST_ARCH_VALUE_X86: () => "x86",
	HTTP_CONNECTION_STATE_VALUE_ACTIVE: () => ib,
	HTTP_CONNECTION_STATE_VALUE_IDLE: () => ab,
	HTTP_FLAVOR_VALUE_HTTP_1_0: () => "1.0",
	HTTP_FLAVOR_VALUE_HTTP_1_1: () => "1.1",
	HTTP_FLAVOR_VALUE_HTTP_2_0: () => "2.0",
	HTTP_FLAVOR_VALUE_HTTP_3_0: () => "3.0",
	HTTP_FLAVOR_VALUE_QUIC: () => sb,
	HTTP_FLAVOR_VALUE_SPDY: () => cb,
	HTTP_REQUEST_METHOD_VALUE_CONNECT: () => Qt,
	HTTP_REQUEST_METHOD_VALUE_DELETE: () => $t,
	HTTP_REQUEST_METHOD_VALUE_GET: () => "GET",
	HTTP_REQUEST_METHOD_VALUE_HEAD: () => en,
	HTTP_REQUEST_METHOD_VALUE_OPTIONS: () => tn,
	HTTP_REQUEST_METHOD_VALUE_OTHER: () => Zt,
	HTTP_REQUEST_METHOD_VALUE_PATCH: () => nn,
	HTTP_REQUEST_METHOD_VALUE_POST: () => rn,
	HTTP_REQUEST_METHOD_VALUE_PUT: () => "PUT",
	HTTP_REQUEST_METHOD_VALUE_QUERY: () => fb,
	HTTP_REQUEST_METHOD_VALUE_TRACE: () => an,
	HW_BATTERY_STATE_VALUE_CHARGING: () => kb,
	HW_BATTERY_STATE_VALUE_DISCHARGING: () => Ab,
	HW_GPU_TASK_VALUE_DECODER: () => Ib,
	HW_GPU_TASK_VALUE_ENCODER: () => Lb,
	HW_GPU_TASK_VALUE_GENERAL: () => Rb,
	HW_LIMIT_TYPE_VALUE_CRITICAL: () => Vb,
	HW_LIMIT_TYPE_VALUE_DEGRADED: () => Hb,
	HW_LIMIT_TYPE_VALUE_HIGH_CRITICAL: () => Ub,
	HW_LIMIT_TYPE_VALUE_HIGH_DEGRADED: () => Wb,
	HW_LIMIT_TYPE_VALUE_LOW_CRITICAL: () => Gb,
	HW_LIMIT_TYPE_VALUE_LOW_DEGRADED: () => Kb,
	HW_LIMIT_TYPE_VALUE_MAX: () => "max",
	HW_LIMIT_TYPE_VALUE_THROTTLED: () => qb,
	HW_LIMIT_TYPE_VALUE_TURBO: () => Jb,
	HW_LOGICAL_DISK_STATE_VALUE_FREE: () => Zb,
	HW_LOGICAL_DISK_STATE_VALUE_USED: () => Qb,
	HW_PHYSICAL_DISK_STATE_VALUE_REMAINING: () => sx,
	HW_STATE_VALUE_DEGRADED: () => fx,
	HW_STATE_VALUE_FAILED: () => px,
	HW_STATE_VALUE_NEEDS_CLEANING: () => mx,
	HW_STATE_VALUE_OK: () => "ok",
	HW_STATE_VALUE_PREDICTED_FAILURE: () => hx,
	HW_TAPE_DRIVE_OPERATION_TYPE_VALUE_CLEAN: () => _x,
	HW_TAPE_DRIVE_OPERATION_TYPE_VALUE_MOUNT: () => vx,
	HW_TAPE_DRIVE_OPERATION_TYPE_VALUE_UNMOUNT: () => yx,
	HW_TYPE_VALUE_BATTERY: () => xx,
	HW_TYPE_VALUE_CPU: () => "cpu",
	HW_TYPE_VALUE_DISK_CONTROLLER: () => Sx,
	HW_TYPE_VALUE_ENCLOSURE: () => Cx,
	HW_TYPE_VALUE_FAN: () => "fan",
	HW_TYPE_VALUE_GPU: () => "gpu",
	HW_TYPE_VALUE_LOGICAL_DISK: () => wx,
	HW_TYPE_VALUE_MEMORY: () => Tx,
	HW_TYPE_VALUE_NETWORK: () => Ex,
	HW_TYPE_VALUE_PHYSICAL_DISK: () => Dx,
	HW_TYPE_VALUE_POWER_SUPPLY: () => Ox,
	HW_TYPE_VALUE_TAPE_DRIVE: () => kx,
	HW_TYPE_VALUE_TEMPERATURE: () => Ax,
	HW_TYPE_VALUE_VOLTAGE: () => jx,
	IOS_APP_STATE_VALUE_ACTIVE: () => Px,
	IOS_APP_STATE_VALUE_BACKGROUND: () => Fx,
	IOS_APP_STATE_VALUE_FOREGROUND: () => Ix,
	IOS_APP_STATE_VALUE_INACTIVE: () => Lx,
	IOS_APP_STATE_VALUE_TERMINATE: () => Rx,
	IOS_STATE_VALUE_ACTIVE: () => Bx,
	IOS_STATE_VALUE_BACKGROUND: () => Vx,
	IOS_STATE_VALUE_FOREGROUND: () => Hx,
	IOS_STATE_VALUE_INACTIVE: () => Ux,
	IOS_STATE_VALUE_TERMINATE: () => Wx,
	JVM_MEMORY_TYPE_VALUE_HEAP: () => mn,
	JVM_MEMORY_TYPE_VALUE_NON_HEAP: () => hn,
	JVM_THREAD_STATE_VALUE_BLOCKED: () => vn,
	JVM_THREAD_STATE_VALUE_NEW: () => "new",
	JVM_THREAD_STATE_VALUE_RUNNABLE: () => yn,
	JVM_THREAD_STATE_VALUE_TERMINATED: () => bn,
	JVM_THREAD_STATE_VALUE_TIMED_WAITING: () => xn,
	JVM_THREAD_STATE_VALUE_WAITING: () => Sn,
	K8S_CONTAINER_EPHEMERAL_STORAGE_FS_TYPE_VALUE_LOGS: () => Xx,
	K8S_CONTAINER_EPHEMERAL_STORAGE_FS_TYPE_VALUE_ROOTFS: () => Zx,
	K8S_CONTAINER_STATUS_REASON_VALUE_COMPLETED: () => eS,
	K8S_CONTAINER_STATUS_REASON_VALUE_CONTAINER_CANNOT_RUN: () => tS,
	K8S_CONTAINER_STATUS_REASON_VALUE_CONTAINER_CREATING: () => nS,
	K8S_CONTAINER_STATUS_REASON_VALUE_CRASH_LOOP_BACK_OFF: () => rS,
	K8S_CONTAINER_STATUS_REASON_VALUE_CREATE_CONTAINER_CONFIG_ERROR: () => iS,
	K8S_CONTAINER_STATUS_REASON_VALUE_ERROR: () => oS,
	K8S_CONTAINER_STATUS_REASON_VALUE_ERR_IMAGE_PULL: () => aS,
	K8S_CONTAINER_STATUS_REASON_VALUE_IMAGE_PULL_BACK_OFF: () => sS,
	K8S_CONTAINER_STATUS_REASON_VALUE_OOM_KILLED: () => cS,
	K8S_CONTAINER_STATUS_STATE_VALUE_RUNNING: () => uS,
	K8S_CONTAINER_STATUS_STATE_VALUE_TERMINATED: () => dS,
	K8S_CONTAINER_STATUS_STATE_VALUE_WAITING: () => fS,
	K8S_NAMESPACE_PHASE_VALUE_ACTIVE: () => xS,
	K8S_NAMESPACE_PHASE_VALUE_TERMINATING: () => SS,
	K8S_NODE_CONDITION_STATUS_VALUE_CONDITION_FALSE: () => wS,
	K8S_NODE_CONDITION_STATUS_VALUE_CONDITION_TRUE: () => TS,
	K8S_NODE_CONDITION_STATUS_VALUE_CONDITION_UNKNOWN: () => ES,
	K8S_NODE_CONDITION_TYPE_VALUE_DISK_PRESSURE: () => OS,
	K8S_NODE_CONDITION_TYPE_VALUE_MEMORY_PRESSURE: () => kS,
	K8S_NODE_CONDITION_TYPE_VALUE_NETWORK_UNAVAILABLE: () => AS,
	K8S_NODE_CONDITION_TYPE_VALUE_PID_PRESSURE: () => jS,
	K8S_NODE_CONDITION_TYPE_VALUE_READY: () => MS,
	K8S_PERSISTENTVOLUMECLAIM_STATUS_PHASE_VALUE_BOUND: () => QS,
	K8S_PERSISTENTVOLUMECLAIM_STATUS_PHASE_VALUE_LOST: () => $S,
	K8S_PERSISTENTVOLUMECLAIM_STATUS_PHASE_VALUE_PENDING: () => eC,
	K8S_PERSISTENTVOLUME_RECLAIM_POLICY_VALUE_DELETE: () => RS,
	K8S_PERSISTENTVOLUME_RECLAIM_POLICY_VALUE_RECYCLE: () => zS,
	K8S_PERSISTENTVOLUME_RECLAIM_POLICY_VALUE_RETAIN: () => BS,
	K8S_PERSISTENTVOLUME_STATUS_PHASE_VALUE_AVAILABLE: () => HS,
	K8S_PERSISTENTVOLUME_STATUS_PHASE_VALUE_BOUND: () => US,
	K8S_PERSISTENTVOLUME_STATUS_PHASE_VALUE_FAILED: () => WS,
	K8S_PERSISTENTVOLUME_STATUS_PHASE_VALUE_PENDING: () => GS,
	K8S_PERSISTENTVOLUME_STATUS_PHASE_VALUE_RELEASED: () => KS,
	K8S_POD_STATUS_PHASE_VALUE_FAILED: () => iC,
	K8S_POD_STATUS_PHASE_VALUE_PENDING: () => aC,
	K8S_POD_STATUS_PHASE_VALUE_RUNNING: () => oC,
	K8S_POD_STATUS_PHASE_VALUE_SUCCEEDED: () => sC,
	K8S_POD_STATUS_PHASE_VALUE_UNKNOWN: () => cC,
	K8S_POD_STATUS_REASON_VALUE_EVICTED: () => uC,
	K8S_POD_STATUS_REASON_VALUE_NODE_AFFINITY: () => dC,
	K8S_POD_STATUS_REASON_VALUE_NODE_LOST: () => fC,
	K8S_POD_STATUS_REASON_VALUE_SHUTDOWN: () => pC,
	K8S_POD_STATUS_REASON_VALUE_UNEXPECTED_ADMISSION_ERROR: () => mC,
	K8S_SERVICE_ENDPOINT_ADDRESS_TYPE_VALUE_FQDN: () => SC,
	K8S_SERVICE_ENDPOINT_ADDRESS_TYPE_VALUE_IPV4: () => CC,
	K8S_SERVICE_ENDPOINT_ADDRESS_TYPE_VALUE_IPV6: () => wC,
	K8S_SERVICE_ENDPOINT_CONDITION_VALUE_READY: () => EC,
	K8S_SERVICE_ENDPOINT_CONDITION_VALUE_SERVING: () => DC,
	K8S_SERVICE_ENDPOINT_CONDITION_VALUE_TERMINATING: () => OC,
	K8S_SERVICE_TYPE_VALUE_CLUSTER_IP: () => IC,
	K8S_SERVICE_TYPE_VALUE_EXTERNAL_NAME: () => LC,
	K8S_SERVICE_TYPE_VALUE_LOAD_BALANCER: () => RC,
	K8S_SERVICE_TYPE_VALUE_NODE_PORT: () => zC,
	K8S_VOLUME_TYPE_VALUE_CONFIG_MAP: () => WC,
	K8S_VOLUME_TYPE_VALUE_DOWNWARD_API: () => GC,
	K8S_VOLUME_TYPE_VALUE_EMPTY_DIR: () => KC,
	K8S_VOLUME_TYPE_VALUE_LOCAL: () => qC,
	K8S_VOLUME_TYPE_VALUE_PERSISTENT_VOLUME_CLAIM: () => JC,
	K8S_VOLUME_TYPE_VALUE_SECRET: () => YC,
	LINUX_MEMORY_SLAB_STATE_VALUE_RECLAIMABLE: () => ZC,
	LINUX_MEMORY_SLAB_STATE_VALUE_UNRECLAIMABLE: () => QC,
	LOG_IOSTREAM_VALUE_STDERR: () => iw,
	LOG_IOSTREAM_VALUE_STDOUT: () => aw,
	MCP_METHOD_NAME_VALUE_COMPLETION_COMPLETE: () => uw,
	MCP_METHOD_NAME_VALUE_ELICITATION_CREATE: () => dw,
	MCP_METHOD_NAME_VALUE_INITIALIZE: () => fw,
	MCP_METHOD_NAME_VALUE_LOGGING_SET_LEVEL: () => pw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_CANCELLED: () => mw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_INITIALIZED: () => hw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_MESSAGE: () => gw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_PROGRESS: () => _w,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_PROMPTS_LIST_CHANGED: () => vw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_RESOURCES_LIST_CHANGED: () => yw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_RESOURCES_UPDATED: () => bw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_ROOTS_LIST_CHANGED: () => xw,
	MCP_METHOD_NAME_VALUE_NOTIFICATIONS_TOOLS_LIST_CHANGED: () => Sw,
	MCP_METHOD_NAME_VALUE_PING: () => Cw,
	MCP_METHOD_NAME_VALUE_PROMPTS_GET: () => ww,
	MCP_METHOD_NAME_VALUE_PROMPTS_LIST: () => Tw,
	MCP_METHOD_NAME_VALUE_RESOURCES_LIST: () => Ew,
	MCP_METHOD_NAME_VALUE_RESOURCES_READ: () => Dw,
	MCP_METHOD_NAME_VALUE_RESOURCES_SUBSCRIBE: () => Ow,
	MCP_METHOD_NAME_VALUE_RESOURCES_TEMPLATES_LIST: () => kw,
	MCP_METHOD_NAME_VALUE_RESOURCES_UNSUBSCRIBE: () => Aw,
	MCP_METHOD_NAME_VALUE_ROOTS_LIST: () => jw,
	MCP_METHOD_NAME_VALUE_SAMPLING_CREATE_MESSAGE: () => Mw,
	MCP_METHOD_NAME_VALUE_TOOLS_CALL: () => Nw,
	MCP_METHOD_NAME_VALUE_TOOLS_LIST: () => Pw,
	MESSAGE_TYPE_VALUE_RECEIVED: () => Vw,
	MESSAGE_TYPE_VALUE_SENT: () => Hw,
	MESSAGING_OPERATION_TYPE_VALUE_CREATE: () => bT,
	MESSAGING_OPERATION_TYPE_VALUE_DELIVER: () => xT,
	MESSAGING_OPERATION_TYPE_VALUE_PROCESS: () => ST,
	MESSAGING_OPERATION_TYPE_VALUE_PUBLISH: () => CT,
	MESSAGING_OPERATION_TYPE_VALUE_RECEIVE: () => wT,
	MESSAGING_OPERATION_TYPE_VALUE_SEND: () => TT,
	MESSAGING_OPERATION_TYPE_VALUE_SETTLE: () => ET,
	MESSAGING_ROCKETMQ_CONSUMPTION_MODEL_VALUE_BROADCASTING: () => jT,
	MESSAGING_ROCKETMQ_CONSUMPTION_MODEL_VALUE_CLUSTERING: () => MT,
	MESSAGING_ROCKETMQ_MESSAGE_TYPE_VALUE_DELAY: () => zT,
	MESSAGING_ROCKETMQ_MESSAGE_TYPE_VALUE_FIFO: () => BT,
	MESSAGING_ROCKETMQ_MESSAGE_TYPE_VALUE_NORMAL: () => VT,
	MESSAGING_ROCKETMQ_MESSAGE_TYPE_VALUE_TRANSACTION: () => HT,
	MESSAGING_SERVICEBUS_DISPOSITION_STATUS_VALUE_ABANDON: () => KT,
	MESSAGING_SERVICEBUS_DISPOSITION_STATUS_VALUE_COMPLETE: () => qT,
	MESSAGING_SERVICEBUS_DISPOSITION_STATUS_VALUE_DEAD_LETTER: () => JT,
	MESSAGING_SERVICEBUS_DISPOSITION_STATUS_VALUE_DEFER: () => YT,
	MESSAGING_SYSTEM_VALUE_ACTIVEMQ: () => $T,
	MESSAGING_SYSTEM_VALUE_AWS_SNS: () => eE,
	MESSAGING_SYSTEM_VALUE_AWS_SQS: () => tE,
	MESSAGING_SYSTEM_VALUE_EVENTGRID: () => nE,
	MESSAGING_SYSTEM_VALUE_EVENTHUBS: () => rE,
	MESSAGING_SYSTEM_VALUE_GCP_PUBSUB: () => iE,
	MESSAGING_SYSTEM_VALUE_JMS: () => "jms",
	MESSAGING_SYSTEM_VALUE_KAFKA: () => aE,
	MESSAGING_SYSTEM_VALUE_PULSAR: () => oE,
	MESSAGING_SYSTEM_VALUE_RABBITMQ: () => sE,
	MESSAGING_SYSTEM_VALUE_ROCKETMQ: () => cE,
	MESSAGING_SYSTEM_VALUE_SERVICEBUS: () => lE,
	METRIC_ASPNETCORE_AUTHENTICATION_AUTHENTICATE_DURATION: () => $P,
	METRIC_ASPNETCORE_AUTHENTICATION_CHALLENGES: () => eF,
	METRIC_ASPNETCORE_AUTHENTICATION_FORBIDS: () => tF,
	METRIC_ASPNETCORE_AUTHENTICATION_SIGN_INS: () => nF,
	METRIC_ASPNETCORE_AUTHENTICATION_SIGN_OUTS: () => rF,
	METRIC_ASPNETCORE_AUTHORIZATION_ATTEMPTS: () => iF,
	METRIC_ASPNETCORE_DIAGNOSTICS_EXCEPTIONS: () => di,
	METRIC_ASPNETCORE_IDENTITY_SIGN_IN_AUTHENTICATE_DURATION: () => aF,
	METRIC_ASPNETCORE_IDENTITY_SIGN_IN_CHECK_PASSWORD_ATTEMPTS: () => oF,
	METRIC_ASPNETCORE_IDENTITY_SIGN_IN_SIGN_INS: () => sF,
	METRIC_ASPNETCORE_IDENTITY_SIGN_IN_SIGN_OUTS: () => cF,
	METRIC_ASPNETCORE_IDENTITY_SIGN_IN_TWO_FACTOR_CLIENTS_FORGOTTEN: () => lF,
	METRIC_ASPNETCORE_IDENTITY_SIGN_IN_TWO_FACTOR_CLIENTS_REMEMBERED: () => uF,
	METRIC_ASPNETCORE_IDENTITY_USER_CHECK_PASSWORD_ATTEMPTS: () => dF,
	METRIC_ASPNETCORE_IDENTITY_USER_CREATE_DURATION: () => fF,
	METRIC_ASPNETCORE_IDENTITY_USER_DELETE_DURATION: () => pF,
	METRIC_ASPNETCORE_IDENTITY_USER_GENERATED_TOKENS: () => mF,
	METRIC_ASPNETCORE_IDENTITY_USER_UPDATE_DURATION: () => hF,
	METRIC_ASPNETCORE_IDENTITY_USER_VERIFY_TOKEN_ATTEMPTS: () => gF,
	METRIC_ASPNETCORE_MEMORY_POOL_ALLOCATED: () => _F,
	METRIC_ASPNETCORE_MEMORY_POOL_EVICTED: () => vF,
	METRIC_ASPNETCORE_MEMORY_POOL_POOLED: () => yF,
	METRIC_ASPNETCORE_MEMORY_POOL_RENTED: () => bF,
	METRIC_ASPNETCORE_RATE_LIMITING_ACTIVE_REQUEST_LEASES: () => fi,
	METRIC_ASPNETCORE_RATE_LIMITING_QUEUED_REQUESTS: () => pi,
	METRIC_ASPNETCORE_RATE_LIMITING_REQUESTS: () => gi,
	METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_LEASE_DURATION: () => hi,
	METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_TIME_IN_QUEUE: () => mi,
	METRIC_ASPNETCORE_ROUTING_MATCH_ATTEMPTS: () => _i,
	METRIC_AZURE_COSMOSDB_CLIENT_ACTIVE_INSTANCE_COUNT: () => xF,
	METRIC_AZURE_COSMOSDB_CLIENT_OPERATION_REQUEST_CHARGE: () => SF,
	METRIC_CICD_PIPELINE_RUN_ACTIVE: () => CF,
	METRIC_CICD_PIPELINE_RUN_DURATION: () => wF,
	METRIC_CICD_PIPELINE_RUN_ERRORS: () => TF,
	METRIC_CICD_SYSTEM_ERRORS: () => EF,
	METRIC_CICD_WORKER_COUNT: () => DF,
	METRIC_CONTAINER_CPU_TIME: () => OF,
	METRIC_CONTAINER_CPU_USAGE: () => kF,
	METRIC_CONTAINER_DISK_IO: () => AF,
	METRIC_CONTAINER_FILESYSTEM_AVAILABLE: () => jF,
	METRIC_CONTAINER_FILESYSTEM_CAPACITY: () => MF,
	METRIC_CONTAINER_FILESYSTEM_USAGE: () => NF,
	METRIC_CONTAINER_MEMORY_AVAILABLE: () => PF,
	METRIC_CONTAINER_MEMORY_PAGING_FAULTS: () => FF,
	METRIC_CONTAINER_MEMORY_RSS: () => IF,
	METRIC_CONTAINER_MEMORY_USAGE: () => LF,
	METRIC_CONTAINER_MEMORY_WORKING_SET: () => RF,
	METRIC_CONTAINER_NETWORK_IO: () => zF,
	METRIC_CONTAINER_UPTIME: () => BF,
	METRIC_CPU_FREQUENCY: () => VF,
	METRIC_CPU_TIME: () => HF,
	METRIC_CPU_UTILIZATION: () => UF,
	METRIC_CPYTHON_GC_COLLECTED_OBJECTS: () => WF,
	METRIC_CPYTHON_GC_COLLECTIONS: () => GF,
	METRIC_CPYTHON_GC_UNCOLLECTABLE_OBJECTS: () => KF,
	METRIC_DB_CLIENT_CONNECTIONS_CREATE_TIME: () => nI,
	METRIC_DB_CLIENT_CONNECTIONS_IDLE_MAX: () => rI,
	METRIC_DB_CLIENT_CONNECTIONS_IDLE_MIN: () => iI,
	METRIC_DB_CLIENT_CONNECTIONS_MAX: () => aI,
	METRIC_DB_CLIENT_CONNECTIONS_PENDING_REQUESTS: () => oI,
	METRIC_DB_CLIENT_CONNECTIONS_TIMEOUTS: () => sI,
	METRIC_DB_CLIENT_CONNECTIONS_USAGE: () => cI,
	METRIC_DB_CLIENT_CONNECTIONS_USE_TIME: () => lI,
	METRIC_DB_CLIENT_CONNECTIONS_WAIT_TIME: () => uI,
	METRIC_DB_CLIENT_CONNECTION_COUNT: () => qF,
	METRIC_DB_CLIENT_CONNECTION_CREATE_TIME: () => JF,
	METRIC_DB_CLIENT_CONNECTION_IDLE_MAX: () => YF,
	METRIC_DB_CLIENT_CONNECTION_IDLE_MIN: () => XF,
	METRIC_DB_CLIENT_CONNECTION_MAX: () => ZF,
	METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS: () => QF,
	METRIC_DB_CLIENT_CONNECTION_TIMEOUTS: () => $F,
	METRIC_DB_CLIENT_CONNECTION_USE_TIME: () => eI,
	METRIC_DB_CLIENT_CONNECTION_WAIT_TIME: () => tI,
	METRIC_DB_CLIENT_COSMOSDB_ACTIVE_INSTANCE_COUNT: () => dI,
	METRIC_DB_CLIENT_COSMOSDB_OPERATION_REQUEST_CHARGE: () => fI,
	METRIC_DB_CLIENT_OPERATION_DURATION: () => vi,
	METRIC_DB_CLIENT_RESPONSE_RETURNED_ROWS: () => pI,
	METRIC_DNS_LOOKUP_DURATION: () => mI,
	METRIC_DOTNET_ASSEMBLY_COUNT: () => yi,
	METRIC_DOTNET_EXCEPTIONS: () => bi,
	METRIC_DOTNET_GC_COLLECTIONS: () => xi,
	METRIC_DOTNET_GC_HEAP_TOTAL_ALLOCATED: () => Si,
	METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_FRAGMENTATION_SIZE: () => Ci,
	METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_SIZE: () => wi,
	METRIC_DOTNET_GC_LAST_COLLECTION_MEMORY_COMMITTED_SIZE: () => Ti,
	METRIC_DOTNET_GC_PAUSE_TIME: () => Ei,
	METRIC_DOTNET_JIT_COMPILATION_TIME: () => Di,
	METRIC_DOTNET_JIT_COMPILED_IL_SIZE: () => Oi,
	METRIC_DOTNET_JIT_COMPILED_METHODS: () => ki,
	METRIC_DOTNET_MONITOR_LOCK_CONTENTIONS: () => Ai,
	METRIC_DOTNET_PROCESS_CPU_COUNT: () => ji,
	METRIC_DOTNET_PROCESS_CPU_TIME: () => Mi,
	METRIC_DOTNET_PROCESS_MEMORY_WORKING_SET: () => Ni,
	METRIC_DOTNET_THREAD_POOL_QUEUE_LENGTH: () => Pi,
	METRIC_DOTNET_THREAD_POOL_THREAD_COUNT: () => Fi,
	METRIC_DOTNET_THREAD_POOL_WORK_ITEM_COUNT: () => Ii,
	METRIC_DOTNET_TIMER_COUNT: () => Li,
	METRIC_FAAS_COLDSTARTS: () => hI,
	METRIC_FAAS_CPU_USAGE: () => gI,
	METRIC_FAAS_ERRORS: () => _I,
	METRIC_FAAS_INIT_DURATION: () => vI,
	METRIC_FAAS_INVOCATIONS: () => yI,
	METRIC_FAAS_INVOKE_DURATION: () => bI,
	METRIC_FAAS_MEM_USAGE: () => xI,
	METRIC_FAAS_NET_IO: () => SI,
	METRIC_FAAS_TIMEOUTS: () => CI,
	METRIC_GEN_AI_CLIENT_OPERATION_DURATION: () => wI,
	METRIC_GEN_AI_CLIENT_OPERATION_TIME_PER_OUTPUT_CHUNK: () => TI,
	METRIC_GEN_AI_CLIENT_OPERATION_TIME_TO_FIRST_CHUNK: () => EI,
	METRIC_GEN_AI_CLIENT_TOKEN_USAGE: () => DI,
	METRIC_GEN_AI_SERVER_REQUEST_DURATION: () => OI,
	METRIC_GEN_AI_SERVER_TIME_PER_OUTPUT_TOKEN: () => kI,
	METRIC_GEN_AI_SERVER_TIME_TO_FIRST_TOKEN: () => AI,
	METRIC_GO_CONFIG_GOGC: () => jI,
	METRIC_GO_CPU_TIME: () => MI,
	METRIC_GO_GOROUTINE_COUNT: () => NI,
	METRIC_GO_MEMORY_ALLOCATED: () => PI,
	METRIC_GO_MEMORY_ALLOCATIONS: () => FI,
	METRIC_GO_MEMORY_GC_CYCLES: () => II,
	METRIC_GO_MEMORY_GC_GOAL: () => LI,
	METRIC_GO_MEMORY_GC_PAUSE_DURATION: () => RI,
	METRIC_GO_MEMORY_LIMIT: () => zI,
	METRIC_GO_MEMORY_USED: () => BI,
	METRIC_GO_PROCESSOR_LIMIT: () => VI,
	METRIC_GO_SCHEDULE_DURATION: () => HI,
	METRIC_HTTP_CLIENT_ACTIVE_REQUESTS: () => UI,
	METRIC_HTTP_CLIENT_CONNECTION_DURATION: () => WI,
	METRIC_HTTP_CLIENT_OPEN_CONNECTIONS: () => GI,
	METRIC_HTTP_CLIENT_REQUEST_BODY_SIZE: () => KI,
	METRIC_HTTP_CLIENT_REQUEST_DURATION: () => Ri,
	METRIC_HTTP_CLIENT_RESPONSE_BODY_SIZE: () => qI,
	METRIC_HTTP_SERVER_ACTIVE_REQUESTS: () => JI,
	METRIC_HTTP_SERVER_REQUEST_BODY_SIZE: () => YI,
	METRIC_HTTP_SERVER_REQUEST_DURATION: () => zi,
	METRIC_HTTP_SERVER_RESPONSE_BODY_SIZE: () => XI,
	METRIC_HW_BATTERY_CHARGE: () => ZI,
	METRIC_HW_BATTERY_CHARGE_LIMIT: () => QI,
	METRIC_HW_BATTERY_TIME_LEFT: () => $I,
	METRIC_HW_CPU_SPEED: () => eL,
	METRIC_HW_CPU_SPEED_LIMIT: () => tL,
	METRIC_HW_ENERGY: () => nL,
	METRIC_HW_ERRORS: () => rL,
	METRIC_HW_FAN_SPEED: () => iL,
	METRIC_HW_FAN_SPEED_LIMIT: () => aL,
	METRIC_HW_FAN_SPEED_RATIO: () => oL,
	METRIC_HW_GPU_IO: () => sL,
	METRIC_HW_GPU_MEMORY_LIMIT: () => cL,
	METRIC_HW_GPU_MEMORY_USAGE: () => lL,
	METRIC_HW_GPU_MEMORY_UTILIZATION: () => uL,
	METRIC_HW_GPU_UTILIZATION: () => dL,
	METRIC_HW_HOST_AMBIENT_TEMPERATURE: () => fL,
	METRIC_HW_HOST_ENERGY: () => pL,
	METRIC_HW_HOST_HEATING_MARGIN: () => mL,
	METRIC_HW_HOST_POWER: () => hL,
	METRIC_HW_LOGICAL_DISK_LIMIT: () => gL,
	METRIC_HW_LOGICAL_DISK_USAGE: () => _L,
	METRIC_HW_LOGICAL_DISK_UTILIZATION: () => vL,
	METRIC_HW_MEMORY_SIZE: () => yL,
	METRIC_HW_NETWORK_BANDWIDTH_LIMIT: () => bL,
	METRIC_HW_NETWORK_BANDWIDTH_UTILIZATION: () => xL,
	METRIC_HW_NETWORK_IO: () => SL,
	METRIC_HW_NETWORK_PACKETS: () => CL,
	METRIC_HW_NETWORK_UP: () => wL,
	METRIC_HW_PHYSICAL_DISK_ENDURANCE_UTILIZATION: () => TL,
	METRIC_HW_PHYSICAL_DISK_SIZE: () => EL,
	METRIC_HW_PHYSICAL_DISK_SMART: () => DL,
	METRIC_HW_POWER: () => OL,
	METRIC_HW_POWER_SUPPLY_LIMIT: () => kL,
	METRIC_HW_POWER_SUPPLY_USAGE: () => AL,
	METRIC_HW_POWER_SUPPLY_UTILIZATION: () => jL,
	METRIC_HW_STATUS: () => ML,
	METRIC_HW_TAPE_DRIVE_OPERATIONS: () => NL,
	METRIC_HW_TEMPERATURE: () => PL,
	METRIC_HW_TEMPERATURE_LIMIT: () => FL,
	METRIC_HW_VOLTAGE: () => IL,
	METRIC_HW_VOLTAGE_LIMIT: () => LL,
	METRIC_HW_VOLTAGE_NOMINAL: () => RL,
	METRIC_JVM_BUFFER_COUNT: () => zL,
	METRIC_JVM_BUFFER_MEMORY_LIMIT: () => BL,
	METRIC_JVM_BUFFER_MEMORY_USAGE: () => VL,
	METRIC_JVM_BUFFER_MEMORY_USED: () => HL,
	METRIC_JVM_CLASS_COUNT: () => Bi,
	METRIC_JVM_CLASS_LOADED: () => Vi,
	METRIC_JVM_CLASS_UNLOADED: () => Hi,
	METRIC_JVM_CPU_COUNT: () => Ui,
	METRIC_JVM_CPU_RECENT_UTILIZATION: () => Wi,
	METRIC_JVM_CPU_TIME: () => Gi,
	METRIC_JVM_FILE_DESCRIPTOR_COUNT: () => UL,
	METRIC_JVM_FILE_DESCRIPTOR_LIMIT: () => WL,
	METRIC_JVM_GC_DURATION: () => Ki,
	METRIC_JVM_MEMORY_COMMITTED: () => qi,
	METRIC_JVM_MEMORY_INIT: () => GL,
	METRIC_JVM_MEMORY_LIMIT: () => Ji,
	METRIC_JVM_MEMORY_USED: () => Yi,
	METRIC_JVM_MEMORY_USED_AFTER_LAST_GC: () => Xi,
	METRIC_JVM_SYSTEM_CPU_LOAD_1M: () => KL,
	METRIC_JVM_SYSTEM_CPU_UTILIZATION: () => qL,
	METRIC_JVM_THREAD_COUNT: () => Zi,
	METRIC_K8S_CONTAINER_CPU_LIMIT: () => JL,
	METRIC_K8S_CONTAINER_CPU_LIMIT_CURRENT: () => YL,
	METRIC_K8S_CONTAINER_CPU_LIMIT_DESIRED: () => XL,
	METRIC_K8S_CONTAINER_CPU_LIMIT_UTILIZATION: () => ZL,
	METRIC_K8S_CONTAINER_CPU_REQUEST: () => QL,
	METRIC_K8S_CONTAINER_CPU_REQUEST_CURRENT: () => $L,
	METRIC_K8S_CONTAINER_CPU_REQUEST_DESIRED: () => eR,
	METRIC_K8S_CONTAINER_CPU_REQUEST_UTILIZATION: () => tR,
	METRIC_K8S_CONTAINER_EPHEMERAL_STORAGE_LIMIT: () => nR,
	METRIC_K8S_CONTAINER_EPHEMERAL_STORAGE_REQUEST: () => rR,
	METRIC_K8S_CONTAINER_EPHEMERAL_STORAGE_USAGE: () => iR,
	METRIC_K8S_CONTAINER_MEMORY_LIMIT: () => aR,
	METRIC_K8S_CONTAINER_MEMORY_LIMIT_CURRENT: () => oR,
	METRIC_K8S_CONTAINER_MEMORY_LIMIT_DESIRED: () => sR,
	METRIC_K8S_CONTAINER_MEMORY_REQUEST: () => cR,
	METRIC_K8S_CONTAINER_MEMORY_REQUEST_CURRENT: () => lR,
	METRIC_K8S_CONTAINER_MEMORY_REQUEST_DESIRED: () => uR,
	METRIC_K8S_CONTAINER_READY: () => dR,
	METRIC_K8S_CONTAINER_RESTART_COUNT: () => fR,
	METRIC_K8S_CONTAINER_STATUS_REASON: () => pR,
	METRIC_K8S_CONTAINER_STATUS_STATE: () => mR,
	METRIC_K8S_CONTAINER_STORAGE_LIMIT: () => hR,
	METRIC_K8S_CONTAINER_STORAGE_REQUEST: () => gR,
	METRIC_K8S_CRONJOB_ACTIVE_JOBS: () => _R,
	METRIC_K8S_CRONJOB_JOB_ACTIVE: () => vR,
	METRIC_K8S_DAEMONSET_CURRENT_SCHEDULED_NODES: () => yR,
	METRIC_K8S_DAEMONSET_DESIRED_SCHEDULED_NODES: () => bR,
	METRIC_K8S_DAEMONSET_MISSCHEDULED_NODES: () => xR,
	METRIC_K8S_DAEMONSET_NODE_CURRENT_SCHEDULED: () => SR,
	METRIC_K8S_DAEMONSET_NODE_DESIRED_SCHEDULED: () => CR,
	METRIC_K8S_DAEMONSET_NODE_MISSCHEDULED: () => wR,
	METRIC_K8S_DAEMONSET_NODE_READY: () => TR,
	METRIC_K8S_DAEMONSET_READY_NODES: () => ER,
	METRIC_K8S_DEPLOYMENT_AVAILABLE_PODS: () => DR,
	METRIC_K8S_DEPLOYMENT_DESIRED_PODS: () => OR,
	METRIC_K8S_DEPLOYMENT_POD_AVAILABLE: () => kR,
	METRIC_K8S_DEPLOYMENT_POD_DESIRED: () => AR,
	METRIC_K8S_HPA_CURRENT_PODS: () => jR,
	METRIC_K8S_HPA_DESIRED_PODS: () => MR,
	METRIC_K8S_HPA_MAX_PODS: () => NR,
	METRIC_K8S_HPA_METRIC_TARGET_CPU_AVERAGE_UTILIZATION: () => PR,
	METRIC_K8S_HPA_METRIC_TARGET_CPU_AVERAGE_VALUE: () => FR,
	METRIC_K8S_HPA_METRIC_TARGET_CPU_VALUE: () => IR,
	METRIC_K8S_HPA_MIN_PODS: () => LR,
	METRIC_K8S_HPA_POD_CURRENT: () => RR,
	METRIC_K8S_HPA_POD_DESIRED: () => zR,
	METRIC_K8S_HPA_POD_MAX: () => BR,
	METRIC_K8S_HPA_POD_MIN: () => VR,
	METRIC_K8S_JOB_ACTIVE_PODS: () => HR,
	METRIC_K8S_JOB_DESIRED_SUCCESSFUL_PODS: () => UR,
	METRIC_K8S_JOB_FAILED_PODS: () => WR,
	METRIC_K8S_JOB_MAX_PARALLEL_PODS: () => GR,
	METRIC_K8S_JOB_POD_ACTIVE: () => KR,
	METRIC_K8S_JOB_POD_DESIRED_SUCCESSFUL: () => qR,
	METRIC_K8S_JOB_POD_FAILED: () => JR,
	METRIC_K8S_JOB_POD_MAX_PARALLEL: () => YR,
	METRIC_K8S_JOB_POD_SUCCESSFUL: () => XR,
	METRIC_K8S_JOB_SUCCESSFUL_PODS: () => ZR,
	METRIC_K8S_NAMESPACE_PHASE: () => QR,
	METRIC_K8S_NODE_ALLOCATABLE_CPU: () => $R,
	METRIC_K8S_NODE_ALLOCATABLE_EPHEMERAL_STORAGE: () => ez,
	METRIC_K8S_NODE_ALLOCATABLE_MEMORY: () => tz,
	METRIC_K8S_NODE_ALLOCATABLE_PODS: () => nz,
	METRIC_K8S_NODE_CONDITION_STATUS: () => rz,
	METRIC_K8S_NODE_CPU_ALLOCATABLE: () => iz,
	METRIC_K8S_NODE_CPU_TIME: () => az,
	METRIC_K8S_NODE_CPU_USAGE: () => oz,
	METRIC_K8S_NODE_EPHEMERAL_STORAGE_ALLOCATABLE: () => sz,
	METRIC_K8S_NODE_FILESYSTEM_AVAILABLE: () => cz,
	METRIC_K8S_NODE_FILESYSTEM_CAPACITY: () => lz,
	METRIC_K8S_NODE_FILESYSTEM_USAGE: () => uz,
	METRIC_K8S_NODE_MEMORY_ALLOCATABLE: () => dz,
	METRIC_K8S_NODE_MEMORY_AVAILABLE: () => fz,
	METRIC_K8S_NODE_MEMORY_PAGING_FAULTS: () => pz,
	METRIC_K8S_NODE_MEMORY_RSS: () => mz,
	METRIC_K8S_NODE_MEMORY_USAGE: () => hz,
	METRIC_K8S_NODE_MEMORY_WORKING_SET: () => gz,
	METRIC_K8S_NODE_NETWORK_ERRORS: () => _z,
	METRIC_K8S_NODE_NETWORK_IO: () => vz,
	METRIC_K8S_NODE_POD_ALLOCATABLE: () => yz,
	METRIC_K8S_NODE_SYSTEM_CONTAINER_CPU_TIME: () => bz,
	METRIC_K8S_NODE_SYSTEM_CONTAINER_CPU_USAGE: () => xz,
	METRIC_K8S_NODE_SYSTEM_CONTAINER_MEMORY_USAGE: () => Sz,
	METRIC_K8S_NODE_SYSTEM_CONTAINER_MEMORY_WORKING_SET: () => Cz,
	METRIC_K8S_NODE_UPTIME: () => wz,
	METRIC_K8S_PERSISTENTVOLUMECLAIM_STATUS_PHASE: () => Dz,
	METRIC_K8S_PERSISTENTVOLUMECLAIM_STORAGE_CAPACITY: () => Oz,
	METRIC_K8S_PERSISTENTVOLUMECLAIM_STORAGE_REQUEST: () => kz,
	METRIC_K8S_PERSISTENTVOLUME_STATUS_PHASE: () => Tz,
	METRIC_K8S_PERSISTENTVOLUME_STORAGE_CAPACITY: () => Ez,
	METRIC_K8S_POD_CPU_TIME: () => Az,
	METRIC_K8S_POD_CPU_USAGE: () => jz,
	METRIC_K8S_POD_FILESYSTEM_AVAILABLE: () => Mz,
	METRIC_K8S_POD_FILESYSTEM_CAPACITY: () => Nz,
	METRIC_K8S_POD_FILESYSTEM_USAGE: () => Pz,
	METRIC_K8S_POD_MEMORY_AVAILABLE: () => Fz,
	METRIC_K8S_POD_MEMORY_PAGING_FAULTS: () => Iz,
	METRIC_K8S_POD_MEMORY_RSS: () => Lz,
	METRIC_K8S_POD_MEMORY_USAGE: () => Rz,
	METRIC_K8S_POD_MEMORY_WORKING_SET: () => zz,
	METRIC_K8S_POD_NETWORK_ERRORS: () => Bz,
	METRIC_K8S_POD_NETWORK_IO: () => Vz,
	METRIC_K8S_POD_STATUS_PHASE: () => Hz,
	METRIC_K8S_POD_STATUS_REASON: () => Uz,
	METRIC_K8S_POD_UPTIME: () => Wz,
	METRIC_K8S_POD_VOLUME_AVAILABLE: () => Gz,
	METRIC_K8S_POD_VOLUME_CAPACITY: () => Kz,
	METRIC_K8S_POD_VOLUME_INODE_COUNT: () => qz,
	METRIC_K8S_POD_VOLUME_INODE_FREE: () => Jz,
	METRIC_K8S_POD_VOLUME_INODE_USED: () => Yz,
	METRIC_K8S_POD_VOLUME_USAGE: () => Xz,
	METRIC_K8S_REPLICASET_AVAILABLE_PODS: () => Zz,
	METRIC_K8S_REPLICASET_DESIRED_PODS: () => Qz,
	METRIC_K8S_REPLICASET_POD_AVAILABLE: () => $z,
	METRIC_K8S_REPLICASET_POD_DESIRED: () => eB,
	METRIC_K8S_REPLICATIONCONTROLLER_AVAILABLE_PODS: () => rB,
	METRIC_K8S_REPLICATIONCONTROLLER_DESIRED_PODS: () => iB,
	METRIC_K8S_REPLICATIONCONTROLLER_POD_AVAILABLE: () => aB,
	METRIC_K8S_REPLICATIONCONTROLLER_POD_DESIRED: () => oB,
	METRIC_K8S_REPLICATION_CONTROLLER_AVAILABLE_PODS: () => tB,
	METRIC_K8S_REPLICATION_CONTROLLER_DESIRED_PODS: () => nB,
	METRIC_K8S_RESOURCEQUOTA_CPU_LIMIT_HARD: () => sB,
	METRIC_K8S_RESOURCEQUOTA_CPU_LIMIT_USED: () => cB,
	METRIC_K8S_RESOURCEQUOTA_CPU_REQUEST_HARD: () => lB,
	METRIC_K8S_RESOURCEQUOTA_CPU_REQUEST_USED: () => uB,
	METRIC_K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_LIMIT_HARD: () => dB,
	METRIC_K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_LIMIT_USED: () => fB,
	METRIC_K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_REQUEST_HARD: () => pB,
	METRIC_K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_REQUEST_USED: () => mB,
	METRIC_K8S_RESOURCEQUOTA_HUGEPAGE_COUNT_REQUEST_HARD: () => hB,
	METRIC_K8S_RESOURCEQUOTA_HUGEPAGE_COUNT_REQUEST_USED: () => gB,
	METRIC_K8S_RESOURCEQUOTA_MEMORY_LIMIT_HARD: () => _B,
	METRIC_K8S_RESOURCEQUOTA_MEMORY_LIMIT_USED: () => vB,
	METRIC_K8S_RESOURCEQUOTA_MEMORY_REQUEST_HARD: () => yB,
	METRIC_K8S_RESOURCEQUOTA_MEMORY_REQUEST_USED: () => bB,
	METRIC_K8S_RESOURCEQUOTA_OBJECT_COUNT_HARD: () => xB,
	METRIC_K8S_RESOURCEQUOTA_OBJECT_COUNT_USED: () => SB,
	METRIC_K8S_RESOURCEQUOTA_PERSISTENTVOLUMECLAIM_COUNT_HARD: () => CB,
	METRIC_K8S_RESOURCEQUOTA_PERSISTENTVOLUMECLAIM_COUNT_USED: () => wB,
	METRIC_K8S_RESOURCEQUOTA_STORAGE_REQUEST_HARD: () => TB,
	METRIC_K8S_RESOURCEQUOTA_STORAGE_REQUEST_USED: () => EB,
	METRIC_K8S_SERVICE_ENDPOINT_COUNT: () => DB,
	METRIC_K8S_SERVICE_LOAD_BALANCER_INGRESS_COUNT: () => OB,
	METRIC_K8S_STATEFULSET_CURRENT_PODS: () => kB,
	METRIC_K8S_STATEFULSET_DESIRED_PODS: () => AB,
	METRIC_K8S_STATEFULSET_POD_CURRENT: () => jB,
	METRIC_K8S_STATEFULSET_POD_DESIRED: () => MB,
	METRIC_K8S_STATEFULSET_POD_READY: () => NB,
	METRIC_K8S_STATEFULSET_POD_UPDATED: () => PB,
	METRIC_K8S_STATEFULSET_READY_PODS: () => FB,
	METRIC_K8S_STATEFULSET_UPDATED_PODS: () => IB,
	METRIC_KESTREL_ACTIVE_CONNECTIONS: () => Qi,
	METRIC_KESTREL_ACTIVE_TLS_HANDSHAKES: () => $i,
	METRIC_KESTREL_CONNECTION_DURATION: () => ea,
	METRIC_KESTREL_QUEUED_CONNECTIONS: () => ta,
	METRIC_KESTREL_QUEUED_REQUESTS: () => na,
	METRIC_KESTREL_REJECTED_CONNECTIONS: () => ra,
	METRIC_KESTREL_TLS_HANDSHAKE_DURATION: () => ia,
	METRIC_KESTREL_UPGRADED_CONNECTIONS: () => aa,
	METRIC_MCP_CLIENT_OPERATION_DURATION: () => LB,
	METRIC_MCP_CLIENT_SESSION_DURATION: () => RB,
	METRIC_MCP_SERVER_OPERATION_DURATION: () => zB,
	METRIC_MCP_SERVER_SESSION_DURATION: () => BB,
	METRIC_MESSAGING_CLIENT_CONSUMED_MESSAGES: () => VB,
	METRIC_MESSAGING_CLIENT_OPERATION_DURATION: () => HB,
	METRIC_MESSAGING_CLIENT_PUBLISHED_MESSAGES: () => UB,
	METRIC_MESSAGING_CLIENT_SENT_MESSAGES: () => WB,
	METRIC_MESSAGING_PROCESS_DURATION: () => GB,
	METRIC_MESSAGING_PROCESS_MESSAGES: () => KB,
	METRIC_MESSAGING_PUBLISH_DURATION: () => qB,
	METRIC_MESSAGING_PUBLISH_MESSAGES: () => JB,
	METRIC_MESSAGING_RECEIVE_DURATION: () => YB,
	METRIC_MESSAGING_RECEIVE_MESSAGES: () => XB,
	METRIC_NFS_CLIENT_NET_COUNT: () => ZB,
	METRIC_NFS_CLIENT_NET_TCP_CONNECTION_ACCEPTED: () => QB,
	METRIC_NFS_CLIENT_OPERATION_COUNT: () => $B,
	METRIC_NFS_CLIENT_PROCEDURE_COUNT: () => eV,
	METRIC_NFS_CLIENT_RPC_AUTHREFRESH_COUNT: () => tV,
	METRIC_NFS_CLIENT_RPC_COUNT: () => nV,
	METRIC_NFS_CLIENT_RPC_RETRANSMIT_COUNT: () => rV,
	METRIC_NFS_SERVER_FH_STALE_COUNT: () => iV,
	METRIC_NFS_SERVER_IO: () => aV,
	METRIC_NFS_SERVER_NET_COUNT: () => oV,
	METRIC_NFS_SERVER_NET_TCP_CONNECTION_ACCEPTED: () => sV,
	METRIC_NFS_SERVER_OPERATION_COUNT: () => cV,
	METRIC_NFS_SERVER_PROCEDURE_COUNT: () => lV,
	METRIC_NFS_SERVER_REPCACHE_REQUESTS: () => uV,
	METRIC_NFS_SERVER_RPC_COUNT: () => dV,
	METRIC_NFS_SERVER_THREAD_COUNT: () => fV,
	METRIC_NODEJS_EVENTLOOP_DELAY_MAX: () => pV,
	METRIC_NODEJS_EVENTLOOP_DELAY_MEAN: () => mV,
	METRIC_NODEJS_EVENTLOOP_DELAY_MIN: () => hV,
	METRIC_NODEJS_EVENTLOOP_DELAY_P50: () => gV,
	METRIC_NODEJS_EVENTLOOP_DELAY_P90: () => _V,
	METRIC_NODEJS_EVENTLOOP_DELAY_P99: () => vV,
	METRIC_NODEJS_EVENTLOOP_DELAY_STDDEV: () => yV,
	METRIC_NODEJS_EVENTLOOP_TIME: () => bV,
	METRIC_NODEJS_EVENTLOOP_UTILIZATION: () => xV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_CPU_LIMIT_HARD: () => SV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_CPU_LIMIT_USED: () => CV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_CPU_REQUEST_HARD: () => wV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_CPU_REQUEST_USED: () => TV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_EPHEMERAL_STORAGE_LIMIT_HARD: () => EV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_EPHEMERAL_STORAGE_LIMIT_USED: () => DV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_EPHEMERAL_STORAGE_REQUEST_HARD: () => OV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_EPHEMERAL_STORAGE_REQUEST_USED: () => kV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_HUGEPAGE_COUNT_REQUEST_HARD: () => AV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_HUGEPAGE_COUNT_REQUEST_USED: () => jV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_MEMORY_LIMIT_HARD: () => MV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_MEMORY_LIMIT_USED: () => NV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_MEMORY_REQUEST_HARD: () => PV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_MEMORY_REQUEST_USED: () => FV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_OBJECT_COUNT_HARD: () => IV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_OBJECT_COUNT_USED: () => LV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_PERSISTENTVOLUMECLAIM_COUNT_HARD: () => RV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_PERSISTENTVOLUMECLAIM_COUNT_USED: () => zV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_STORAGE_REQUEST_HARD: () => BV,
	METRIC_OPENSHIFT_CLUSTERQUOTA_STORAGE_REQUEST_USED: () => VV,
	METRIC_OTEL_SDK_EXPORTER_LOG_EXPORTED: () => HV,
	METRIC_OTEL_SDK_EXPORTER_LOG_INFLIGHT: () => UV,
	METRIC_OTEL_SDK_EXPORTER_METRIC_DATA_POINT_EXPORTED: () => WV,
	METRIC_OTEL_SDK_EXPORTER_METRIC_DATA_POINT_INFLIGHT: () => GV,
	METRIC_OTEL_SDK_EXPORTER_OPERATION_DURATION: () => KV,
	METRIC_OTEL_SDK_EXPORTER_SPAN_EXPORTED: () => qV,
	METRIC_OTEL_SDK_EXPORTER_SPAN_EXPORTED_COUNT: () => JV,
	METRIC_OTEL_SDK_EXPORTER_SPAN_INFLIGHT: () => YV,
	METRIC_OTEL_SDK_EXPORTER_SPAN_INFLIGHT_COUNT: () => XV,
	METRIC_OTEL_SDK_LOG_CREATED: () => ZV,
	METRIC_OTEL_SDK_METRIC_READER_COLLECTION_DURATION: () => QV,
	METRIC_OTEL_SDK_PROCESSOR_LOG_PROCESSED: () => $V,
	METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_CAPACITY: () => eH,
	METRIC_OTEL_SDK_PROCESSOR_LOG_QUEUE_SIZE: () => tH,
	METRIC_OTEL_SDK_PROCESSOR_SPAN_PROCESSED: () => nH,
	METRIC_OTEL_SDK_PROCESSOR_SPAN_PROCESSED_COUNT: () => rH,
	METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY: () => iH,
	METRIC_OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE: () => aH,
	METRIC_OTEL_SDK_SPAN_ENDED: () => oH,
	METRIC_OTEL_SDK_SPAN_ENDED_COUNT: () => sH,
	METRIC_OTEL_SDK_SPAN_LIVE: () => cH,
	METRIC_OTEL_SDK_SPAN_LIVE_COUNT: () => lH,
	METRIC_OTEL_SDK_SPAN_STARTED: () => uH,
	METRIC_PROCESS_CONTEXT_SWITCHES: () => dH,
	METRIC_PROCESS_CPU_TIME: () => fH,
	METRIC_PROCESS_CPU_UTILIZATION: () => pH,
	METRIC_PROCESS_DISK_IO: () => mH,
	METRIC_PROCESS_MEMORY_USAGE: () => hH,
	METRIC_PROCESS_MEMORY_VIRTUAL: () => gH,
	METRIC_PROCESS_NETWORK_IO: () => _H,
	METRIC_PROCESS_OPEN_FILE_DESCRIPTOR_COUNT: () => vH,
	METRIC_PROCESS_PAGING_FAULTS: () => yH,
	METRIC_PROCESS_THREAD_COUNT: () => bH,
	METRIC_PROCESS_UNIX_FILE_DESCRIPTOR_COUNT: () => xH,
	METRIC_PROCESS_UPTIME: () => SH,
	METRIC_PROCESS_WINDOWS_HANDLE_COUNT: () => CH,
	METRIC_RPC_CLIENT_CALL_DURATION: () => wH,
	METRIC_RPC_CLIENT_DURATION: () => TH,
	METRIC_RPC_CLIENT_REQUESTS_PER_RPC: () => DH,
	METRIC_RPC_CLIENT_REQUEST_SIZE: () => EH,
	METRIC_RPC_CLIENT_RESPONSES_PER_RPC: () => kH,
	METRIC_RPC_CLIENT_RESPONSE_SIZE: () => OH,
	METRIC_RPC_SERVER_CALL_DURATION: () => AH,
	METRIC_RPC_SERVER_DURATION: () => jH,
	METRIC_RPC_SERVER_REQUESTS_PER_RPC: () => NH,
	METRIC_RPC_SERVER_REQUEST_SIZE: () => MH,
	METRIC_RPC_SERVER_RESPONSES_PER_RPC: () => FH,
	METRIC_RPC_SERVER_RESPONSE_SIZE: () => PH,
	METRIC_SIGNALR_SERVER_ACTIVE_CONNECTIONS: () => oa,
	METRIC_SIGNALR_SERVER_CONNECTION_DURATION: () => sa,
	METRIC_SYSTEM_CPU_FREQUENCY: () => IH,
	METRIC_SYSTEM_CPU_LOGICAL_COUNT: () => LH,
	METRIC_SYSTEM_CPU_PHYSICAL_COUNT: () => RH,
	METRIC_SYSTEM_CPU_TIME: () => zH,
	METRIC_SYSTEM_CPU_UTILIZATION: () => BH,
	METRIC_SYSTEM_DISK_IO: () => VH,
	METRIC_SYSTEM_DISK_IO_TIME: () => HH,
	METRIC_SYSTEM_DISK_LIMIT: () => UH,
	METRIC_SYSTEM_DISK_MERGED: () => WH,
	METRIC_SYSTEM_DISK_OPERATIONS: () => KH,
	METRIC_SYSTEM_DISK_OPERATION_TIME: () => GH,
	METRIC_SYSTEM_FILESYSTEM_LIMIT: () => qH,
	METRIC_SYSTEM_FILESYSTEM_LOCK_COUNT: () => JH,
	METRIC_SYSTEM_FILESYSTEM_USAGE: () => YH,
	METRIC_SYSTEM_FILESYSTEM_UTILIZATION: () => XH,
	METRIC_SYSTEM_LINUX_MEMORY_AVAILABLE: () => ZH,
	METRIC_SYSTEM_LINUX_MEMORY_SLAB_USAGE: () => QH,
	METRIC_SYSTEM_MEMORY_LIMIT: () => $H,
	METRIC_SYSTEM_MEMORY_LINUX_AVAILABLE: () => eU,
	METRIC_SYSTEM_MEMORY_LINUX_HUGEPAGES_LIMIT: () => tU,
	METRIC_SYSTEM_MEMORY_LINUX_HUGEPAGES_PAGE_SIZE: () => nU,
	METRIC_SYSTEM_MEMORY_LINUX_HUGEPAGES_RESERVED: () => rU,
	METRIC_SYSTEM_MEMORY_LINUX_HUGEPAGES_SURPLUS: () => iU,
	METRIC_SYSTEM_MEMORY_LINUX_HUGEPAGES_USAGE: () => aU,
	METRIC_SYSTEM_MEMORY_LINUX_HUGEPAGES_UTILIZATION: () => oU,
	METRIC_SYSTEM_MEMORY_LINUX_SHARED: () => sU,
	METRIC_SYSTEM_MEMORY_LINUX_SLAB_USAGE: () => cU,
	METRIC_SYSTEM_MEMORY_SHARED: () => lU,
	METRIC_SYSTEM_MEMORY_USAGE: () => uU,
	METRIC_SYSTEM_MEMORY_UTILIZATION: () => dU,
	METRIC_SYSTEM_NETWORK_CONNECTIONS: () => pU,
	METRIC_SYSTEM_NETWORK_CONNECTION_COUNT: () => fU,
	METRIC_SYSTEM_NETWORK_DROPPED: () => mU,
	METRIC_SYSTEM_NETWORK_ERRORS: () => hU,
	METRIC_SYSTEM_NETWORK_IO: () => gU,
	METRIC_SYSTEM_NETWORK_PACKETS: () => yU,
	METRIC_SYSTEM_NETWORK_PACKET_COUNT: () => _U,
	METRIC_SYSTEM_NETWORK_PACKET_DROPPED: () => vU,
	METRIC_SYSTEM_PAGING_FAULTS: () => bU,
	METRIC_SYSTEM_PAGING_OPERATIONS: () => xU,
	METRIC_SYSTEM_PAGING_USAGE: () => SU,
	METRIC_SYSTEM_PAGING_UTILIZATION: () => CU,
	METRIC_SYSTEM_PROCESS_COUNT: () => wU,
	METRIC_SYSTEM_PROCESS_CREATED: () => TU,
	METRIC_SYSTEM_UPTIME: () => EU,
	METRIC_V8JS_GC_DURATION: () => DU,
	METRIC_V8JS_HEAP_SPACE_AVAILABLE_SIZE: () => OU,
	METRIC_V8JS_HEAP_SPACE_PHYSICAL_SIZE: () => kU,
	METRIC_V8JS_MEMORY_HEAP_LIMIT: () => AU,
	METRIC_V8JS_MEMORY_HEAP_SPACE_AVAILABLE_SIZE: () => jU,
	METRIC_V8JS_MEMORY_HEAP_SPACE_PHYSICAL_SIZE: () => MU,
	METRIC_V8JS_MEMORY_HEAP_SPACE_SIZE: () => NU,
	METRIC_V8JS_MEMORY_HEAP_USED: () => PU,
	METRIC_V8JS_RESOURCE_ACTIVE: () => FU,
	METRIC_VCS_CHANGE_COUNT: () => IU,
	METRIC_VCS_CHANGE_DURATION: () => LU,
	METRIC_VCS_CHANGE_TIME_TO_APPROVAL: () => RU,
	METRIC_VCS_CHANGE_TIME_TO_MERGE: () => zU,
	METRIC_VCS_CONTRIBUTOR_COUNT: () => BU,
	METRIC_VCS_REF_COUNT: () => VU,
	METRIC_VCS_REF_LINES_DELTA: () => HU,
	METRIC_VCS_REF_REVISIONS_DELTA: () => UU,
	METRIC_VCS_REF_TIME: () => WU,
	METRIC_VCS_REPOSITORY_COUNT: () => GU,
	NETWORK_CONNECTION_STATE_VALUE_CLOSED: () => zE,
	NETWORK_CONNECTION_STATE_VALUE_CLOSE_WAIT: () => RE,
	NETWORK_CONNECTION_STATE_VALUE_CLOSING: () => BE,
	NETWORK_CONNECTION_STATE_VALUE_ESTABLISHED: () => VE,
	NETWORK_CONNECTION_STATE_VALUE_FIN_WAIT_1: () => HE,
	NETWORK_CONNECTION_STATE_VALUE_FIN_WAIT_2: () => UE,
	NETWORK_CONNECTION_STATE_VALUE_LAST_ACK: () => WE,
	NETWORK_CONNECTION_STATE_VALUE_LISTEN: () => GE,
	NETWORK_CONNECTION_STATE_VALUE_SYN_RECEIVED: () => KE,
	NETWORK_CONNECTION_STATE_VALUE_SYN_SENT: () => qE,
	NETWORK_CONNECTION_STATE_VALUE_TIME_WAIT: () => JE,
	NETWORK_CONNECTION_SUBTYPE_VALUE_CDMA: () => XE,
	NETWORK_CONNECTION_SUBTYPE_VALUE_CDMA2000_1XRTT: () => ZE,
	NETWORK_CONNECTION_SUBTYPE_VALUE_EDGE: () => QE,
	NETWORK_CONNECTION_SUBTYPE_VALUE_EHRPD: () => $E,
	NETWORK_CONNECTION_SUBTYPE_VALUE_EVDO_0: () => eD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_EVDO_A: () => tD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_EVDO_B: () => nD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_GPRS: () => rD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_GSM: () => "gsm",
	NETWORK_CONNECTION_SUBTYPE_VALUE_HSDPA: () => iD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_HSPA: () => aD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_HSPAP: () => oD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_HSUPA: () => sD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_IDEN: () => cD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_IWLAN: () => lD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_LTE: () => "lte",
	NETWORK_CONNECTION_SUBTYPE_VALUE_LTE_CA: () => uD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_NR: () => "nr",
	NETWORK_CONNECTION_SUBTYPE_VALUE_NRNSA: () => dD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_TD_SCDMA: () => fD,
	NETWORK_CONNECTION_SUBTYPE_VALUE_UMTS: () => pD,
	NETWORK_CONNECTION_TYPE_VALUE_CELL: () => hD,
	NETWORK_CONNECTION_TYPE_VALUE_UNAVAILABLE: () => gD,
	NETWORK_CONNECTION_TYPE_VALUE_UNKNOWN: () => _D,
	NETWORK_CONNECTION_TYPE_VALUE_WIFI: () => vD,
	NETWORK_CONNECTION_TYPE_VALUE_WIRED: () => yD,
	NETWORK_IO_DIRECTION_VALUE_RECEIVE: () => SD,
	NETWORK_IO_DIRECTION_VALUE_TRANSMIT: () => CD,
	NETWORK_TRANSPORT_VALUE_PIPE: () => vr,
	NETWORK_TRANSPORT_VALUE_QUIC: () => yr,
	NETWORK_TRANSPORT_VALUE_TCP: () => "tcp",
	NETWORK_TRANSPORT_VALUE_UDP: () => "udp",
	NETWORK_TRANSPORT_VALUE_UNIX: () => br,
	NETWORK_TYPE_VALUE_IPV4: () => Sr,
	NETWORK_TYPE_VALUE_IPV6: () => Cr,
	NET_SOCK_FAMILY_VALUE_INET: () => yE,
	NET_SOCK_FAMILY_VALUE_INET6: () => bE,
	NET_SOCK_FAMILY_VALUE_UNIX: () => xE,
	NET_TRANSPORT_VALUE_INPROC: () => OE,
	NET_TRANSPORT_VALUE_IP_TCP: () => kE,
	NET_TRANSPORT_VALUE_IP_UDP: () => AE,
	NET_TRANSPORT_VALUE_OTHER: () => jE,
	NET_TRANSPORT_VALUE_PIPE: () => ME,
	NODEJS_EVENTLOOP_STATE_VALUE_ACTIVE: () => DD,
	NODEJS_EVENTLOOP_STATE_VALUE_IDLE: () => OD,
	OPENAI_API_TYPE_VALUE_CHAT_COMPLETIONS: () => FD,
	OPENAI_API_TYPE_VALUE_RESPONSES: () => ID,
	OPENAI_REQUEST_SERVICE_TIER_VALUE_AUTO: () => RD,
	OPENAI_REQUEST_SERVICE_TIER_VALUE_DEFAULT: () => zD,
	OPENTRACING_REF_TYPE_VALUE_CHILD_OF: () => GD,
	OPENTRACING_REF_TYPE_VALUE_FOLLOWS_FROM: () => KD,
	OS_TYPE_VALUE_AIX: () => "aix",
	OS_TYPE_VALUE_DARWIN: () => rO,
	OS_TYPE_VALUE_DRAGONFLYBSD: () => iO,
	OS_TYPE_VALUE_FREEBSD: () => aO,
	OS_TYPE_VALUE_HPUX: () => oO,
	OS_TYPE_VALUE_LINUX: () => sO,
	OS_TYPE_VALUE_NETBSD: () => cO,
	OS_TYPE_VALUE_OPENBSD: () => lO,
	OS_TYPE_VALUE_SOLARIS: () => uO,
	OS_TYPE_VALUE_WINDOWS: () => dO,
	OS_TYPE_VALUE_ZOS: () => "zos",
	OS_TYPE_VALUE_Z_OS: () => fO,
	OTEL_COMPONENT_TYPE_VALUE_BATCHING_LOG_PROCESSOR: () => gO,
	OTEL_COMPONENT_TYPE_VALUE_BATCHING_SPAN_PROCESSOR: () => _O,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_GRPC_LOG_EXPORTER: () => vO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_GRPC_METRIC_EXPORTER: () => yO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_GRPC_SPAN_EXPORTER: () => bO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_JSON_LOG_EXPORTER: () => xO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_JSON_METRIC_EXPORTER: () => SO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_JSON_SPAN_EXPORTER: () => CO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_LOG_EXPORTER: () => wO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_METRIC_EXPORTER: () => TO,
	OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_SPAN_EXPORTER: () => EO,
	OTEL_COMPONENT_TYPE_VALUE_PERIODIC_METRIC_READER: () => DO,
	OTEL_COMPONENT_TYPE_VALUE_PROMETHEUS_HTTP_TEXT_METRIC_EXPORTER: () => OO,
	OTEL_COMPONENT_TYPE_VALUE_SIMPLE_LOG_PROCESSOR: () => kO,
	OTEL_COMPONENT_TYPE_VALUE_SIMPLE_SPAN_PROCESSOR: () => AO,
	OTEL_COMPONENT_TYPE_VALUE_ZIPKIN_HTTP_SPAN_EXPORTER: () => jO,
	OTEL_SPAN_PARENT_ORIGIN_VALUE_LOCAL: () => IO,
	OTEL_SPAN_PARENT_ORIGIN_VALUE_NONE: () => LO,
	OTEL_SPAN_PARENT_ORIGIN_VALUE_REMOTE: () => RO,
	OTEL_SPAN_SAMPLING_RESULT_VALUE_DROP: () => BO,
	OTEL_SPAN_SAMPLING_RESULT_VALUE_RECORD_AND_SAMPLE: () => VO,
	OTEL_SPAN_SAMPLING_RESULT_VALUE_RECORD_ONLY: () => HO,
	OTEL_STATUS_CODE_VALUE_ERROR: () => Or,
	OTEL_STATUS_CODE_VALUE_OK: () => "OK",
	PROCESS_CONTEXT_SWITCH_TYPE_VALUE_INVOLUNTARY: () => sk,
	PROCESS_CONTEXT_SWITCH_TYPE_VALUE_VOLUNTARY: () => ck,
	PROCESS_CPU_STATE_VALUE_SYSTEM: () => uk,
	PROCESS_CPU_STATE_VALUE_USER: () => dk,
	PROCESS_CPU_STATE_VALUE_WAIT: () => fk,
	PROCESS_PAGING_FAULT_TYPE_VALUE_MAJOR: () => Ok,
	PROCESS_PAGING_FAULT_TYPE_VALUE_MINOR: () => kk,
	PROCESS_STATE_VALUE_DEFUNCT: () => Vk,
	PROCESS_STATE_VALUE_RUNNING: () => Hk,
	PROCESS_STATE_VALUE_SLEEPING: () => Uk,
	PROCESS_STATE_VALUE_STOPPED: () => Wk,
	PROFILE_FRAME_TYPE_VALUE_BEAM: () => Zk,
	PROFILE_FRAME_TYPE_VALUE_CPYTHON: () => Qk,
	PROFILE_FRAME_TYPE_VALUE_DOTNET: () => $k,
	PROFILE_FRAME_TYPE_VALUE_GO: () => "go",
	PROFILE_FRAME_TYPE_VALUE_JVM: () => "jvm",
	PROFILE_FRAME_TYPE_VALUE_KERNEL: () => eA,
	PROFILE_FRAME_TYPE_VALUE_LUAJIT: () => tA,
	PROFILE_FRAME_TYPE_VALUE_NATIVE: () => nA,
	PROFILE_FRAME_TYPE_VALUE_PERL: () => rA,
	PROFILE_FRAME_TYPE_VALUE_PHP: () => "php",
	PROFILE_FRAME_TYPE_VALUE_RUBY: () => iA,
	PROFILE_FRAME_TYPE_VALUE_RUST: () => aA,
	PROFILE_FRAME_TYPE_VALUE_V8JS: () => oA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_ABORTED: () => cA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_ALREADY_EXISTS: () => lA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_CANCELLED: () => uA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_DATA_LOSS: () => dA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_DEADLINE_EXCEEDED: () => fA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_FAILED_PRECONDITION: () => pA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_INTERNAL: () => mA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_INVALID_ARGUMENT: () => hA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_NOT_FOUND: () => gA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_OUT_OF_RANGE: () => _A,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_PERMISSION_DENIED: () => vA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_RESOURCE_EXHAUSTED: () => yA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_UNAUTHENTICATED: () => bA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_UNAVAILABLE: () => xA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_UNIMPLEMENTED: () => SA,
	RPC_CONNECT_RPC_ERROR_CODE_VALUE_UNKNOWN: () => CA,
	RPC_GRPC_STATUS_CODE_VALUE_ABORTED: () => 10,
	RPC_GRPC_STATUS_CODE_VALUE_ALREADY_EXISTS: () => 6,
	RPC_GRPC_STATUS_CODE_VALUE_CANCELLED: () => 1,
	RPC_GRPC_STATUS_CODE_VALUE_DATA_LOSS: () => 15,
	RPC_GRPC_STATUS_CODE_VALUE_DEADLINE_EXCEEDED: () => 4,
	RPC_GRPC_STATUS_CODE_VALUE_FAILED_PRECONDITION: () => 9,
	RPC_GRPC_STATUS_CODE_VALUE_INTERNAL: () => 13,
	RPC_GRPC_STATUS_CODE_VALUE_INVALID_ARGUMENT: () => 3,
	RPC_GRPC_STATUS_CODE_VALUE_NOT_FOUND: () => 5,
	RPC_GRPC_STATUS_CODE_VALUE_OK: () => 0,
	RPC_GRPC_STATUS_CODE_VALUE_OUT_OF_RANGE: () => 11,
	RPC_GRPC_STATUS_CODE_VALUE_PERMISSION_DENIED: () => 7,
	RPC_GRPC_STATUS_CODE_VALUE_RESOURCE_EXHAUSTED: () => 8,
	RPC_GRPC_STATUS_CODE_VALUE_UNAUTHENTICATED: () => 16,
	RPC_GRPC_STATUS_CODE_VALUE_UNAVAILABLE: () => 14,
	RPC_GRPC_STATUS_CODE_VALUE_UNIMPLEMENTED: () => 12,
	RPC_GRPC_STATUS_CODE_VALUE_UNKNOWN: () => 2,
	RPC_MESSAGE_TYPE_VALUE_RECEIVED: () => IA,
	RPC_MESSAGE_TYPE_VALUE_SENT: () => LA,
	RPC_SYSTEM_NAME_VALUE_CONNECTRPC: () => ej,
	RPC_SYSTEM_NAME_VALUE_DUBBO: () => tj,
	RPC_SYSTEM_NAME_VALUE_GRPC: () => nj,
	RPC_SYSTEM_NAME_VALUE_JSONRPC: () => rj,
	RPC_SYSTEM_VALUE_APACHE_DUBBO: () => KA,
	RPC_SYSTEM_VALUE_CONNECT_RPC: () => qA,
	RPC_SYSTEM_VALUE_DOTNET_WCF: () => JA,
	RPC_SYSTEM_VALUE_GRPC: () => YA,
	RPC_SYSTEM_VALUE_JAVA_RMI: () => XA,
	RPC_SYSTEM_VALUE_JSONRPC: () => ZA,
	RPC_SYSTEM_VALUE_ONC_RPC: () => QA,
	SERVICE_CRITICALITY_VALUE_CRITICAL: () => pj,
	SERVICE_CRITICALITY_VALUE_HIGH: () => mj,
	SERVICE_CRITICALITY_VALUE_LOW: () => "low",
	SERVICE_CRITICALITY_VALUE_MEDIUM: () => hj,
	SIGNALR_CONNECTION_STATUS_VALUE_APP_SHUTDOWN: () => Lr,
	SIGNALR_CONNECTION_STATUS_VALUE_NORMAL_CLOSURE: () => Rr,
	SIGNALR_CONNECTION_STATUS_VALUE_TIMEOUT: () => zr,
	SIGNALR_TRANSPORT_VALUE_LONG_POLLING: () => Vr,
	SIGNALR_TRANSPORT_VALUE_SERVER_SENT_EVENTS: () => Hr,
	SIGNALR_TRANSPORT_VALUE_WEB_SOCKETS: () => Ur,
	STATE_VALUE_IDLE: () => Cj,
	STATE_VALUE_USED: () => wj,
	SYSTEM_CPU_STATE_VALUE_IDLE: () => Dj,
	SYSTEM_CPU_STATE_VALUE_INTERRUPT: () => Oj,
	SYSTEM_CPU_STATE_VALUE_IOWAIT: () => kj,
	SYSTEM_CPU_STATE_VALUE_NICE: () => Aj,
	SYSTEM_CPU_STATE_VALUE_STEAL: () => jj,
	SYSTEM_CPU_STATE_VALUE_SYSTEM: () => Mj,
	SYSTEM_CPU_STATE_VALUE_USER: () => Nj,
	SYSTEM_FILESYSTEM_STATE_VALUE_FREE: () => Rj,
	SYSTEM_FILESYSTEM_STATE_VALUE_RESERVED: () => zj,
	SYSTEM_FILESYSTEM_STATE_VALUE_USED: () => Bj,
	SYSTEM_FILESYSTEM_TYPE_VALUE_EXFAT: () => Hj,
	SYSTEM_FILESYSTEM_TYPE_VALUE_EXT4: () => Uj,
	SYSTEM_FILESYSTEM_TYPE_VALUE_FAT32: () => Wj,
	SYSTEM_FILESYSTEM_TYPE_VALUE_HFSPLUS: () => Gj,
	SYSTEM_FILESYSTEM_TYPE_VALUE_NTFS: () => Kj,
	SYSTEM_FILESYSTEM_TYPE_VALUE_REFS: () => qj,
	SYSTEM_MEMORY_LINUX_HUGEPAGES_STATE_VALUE_FREE: () => Yj,
	SYSTEM_MEMORY_LINUX_HUGEPAGES_STATE_VALUE_USED: () => Xj,
	SYSTEM_MEMORY_LINUX_SLAB_STATE_VALUE_RECLAIMABLE: () => Qj,
	SYSTEM_MEMORY_LINUX_SLAB_STATE_VALUE_UNRECLAIMABLE: () => $j,
	SYSTEM_MEMORY_STATE_VALUE_BUFFERS: () => tM,
	SYSTEM_MEMORY_STATE_VALUE_CACHED: () => nM,
	SYSTEM_MEMORY_STATE_VALUE_FREE: () => rM,
	SYSTEM_MEMORY_STATE_VALUE_SHARED: () => iM,
	SYSTEM_MEMORY_STATE_VALUE_USED: () => aM,
	SYSTEM_NETWORK_STATE_VALUE_CLOSE: () => sM,
	SYSTEM_NETWORK_STATE_VALUE_CLOSE_WAIT: () => cM,
	SYSTEM_NETWORK_STATE_VALUE_CLOSING: () => lM,
	SYSTEM_NETWORK_STATE_VALUE_DELETE: () => uM,
	SYSTEM_NETWORK_STATE_VALUE_ESTABLISHED: () => dM,
	SYSTEM_NETWORK_STATE_VALUE_FIN_WAIT_1: () => fM,
	SYSTEM_NETWORK_STATE_VALUE_FIN_WAIT_2: () => pM,
	SYSTEM_NETWORK_STATE_VALUE_LAST_ACK: () => mM,
	SYSTEM_NETWORK_STATE_VALUE_LISTEN: () => hM,
	SYSTEM_NETWORK_STATE_VALUE_SYN_RECV: () => gM,
	SYSTEM_NETWORK_STATE_VALUE_SYN_SENT: () => _M,
	SYSTEM_NETWORK_STATE_VALUE_TIME_WAIT: () => vM,
	SYSTEM_PAGING_DIRECTION_VALUE_IN: () => "in",
	SYSTEM_PAGING_DIRECTION_VALUE_OUT: () => "out",
	SYSTEM_PAGING_FAULT_TYPE_VALUE_MAJOR: () => xM,
	SYSTEM_PAGING_FAULT_TYPE_VALUE_MINOR: () => SM,
	SYSTEM_PAGING_STATE_VALUE_FREE: () => wM,
	SYSTEM_PAGING_STATE_VALUE_USED: () => TM,
	SYSTEM_PAGING_TYPE_VALUE_MAJOR: () => DM,
	SYSTEM_PAGING_TYPE_VALUE_MINOR: () => OM,
	SYSTEM_PROCESSES_STATUS_VALUE_DEFUNCT: () => FM,
	SYSTEM_PROCESSES_STATUS_VALUE_RUNNING: () => IM,
	SYSTEM_PROCESSES_STATUS_VALUE_SLEEPING: () => LM,
	SYSTEM_PROCESSES_STATUS_VALUE_STOPPED: () => RM,
	SYSTEM_PROCESS_STATUS_VALUE_DEFUNCT: () => AM,
	SYSTEM_PROCESS_STATUS_VALUE_RUNNING: () => jM,
	SYSTEM_PROCESS_STATUS_VALUE_SLEEPING: () => MM,
	SYSTEM_PROCESS_STATUS_VALUE_STOPPED: () => NM,
	TELEMETRY_SDK_LANGUAGE_VALUE_CPP: () => "cpp",
	TELEMETRY_SDK_LANGUAGE_VALUE_DOTNET: () => qr,
	TELEMETRY_SDK_LANGUAGE_VALUE_ERLANG: () => Jr,
	TELEMETRY_SDK_LANGUAGE_VALUE_GO: () => "go",
	TELEMETRY_SDK_LANGUAGE_VALUE_JAVA: () => Yr,
	TELEMETRY_SDK_LANGUAGE_VALUE_KOTLIN: () => Xr,
	TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS: () => Zr,
	TELEMETRY_SDK_LANGUAGE_VALUE_PHP: () => "php",
	TELEMETRY_SDK_LANGUAGE_VALUE_PYTHON: () => Qr,
	TELEMETRY_SDK_LANGUAGE_VALUE_RUBY: () => $r,
	TELEMETRY_SDK_LANGUAGE_VALUE_RUST: () => ei,
	TELEMETRY_SDK_LANGUAGE_VALUE_SWIFT: () => ti,
	TELEMETRY_SDK_LANGUAGE_VALUE_WEBJS: () => ni,
	TEST_CASE_RESULT_STATUS_VALUE_FAIL: () => VM,
	TEST_CASE_RESULT_STATUS_VALUE_PASS: () => HM,
	TEST_SUITE_RUN_STATUS_VALUE_ABORTED: () => GM,
	TEST_SUITE_RUN_STATUS_VALUE_FAILURE: () => KM,
	TEST_SUITE_RUN_STATUS_VALUE_IN_PROGRESS: () => qM,
	TEST_SUITE_RUN_STATUS_VALUE_SKIPPED: () => JM,
	TEST_SUITE_RUN_STATUS_VALUE_SUCCESS: () => YM,
	TEST_SUITE_RUN_STATUS_VALUE_TIMED_OUT: () => XM,
	TLS_PROTOCOL_NAME_VALUE_SSL: () => "ssl",
	TLS_PROTOCOL_NAME_VALUE_TLS: () => "tls",
	USER_AGENT_SYNTHETIC_TYPE_VALUE_BOT: () => "bot",
	USER_AGENT_SYNTHETIC_TYPE_VALUE_TEST: () => KN,
	V8JS_GC_TYPE_VALUE_INCREMENTAL: () => YN,
	V8JS_GC_TYPE_VALUE_MAJOR: () => XN,
	V8JS_GC_TYPE_VALUE_MINOR: () => ZN,
	V8JS_GC_TYPE_VALUE_WEAKCB: () => QN,
	V8JS_HEAP_SPACE_NAME_VALUE_CODE_SPACE: () => eP,
	V8JS_HEAP_SPACE_NAME_VALUE_LARGE_OBJECT_SPACE: () => tP,
	V8JS_HEAP_SPACE_NAME_VALUE_MAP_SPACE: () => nP,
	V8JS_HEAP_SPACE_NAME_VALUE_NEW_SPACE: () => rP,
	V8JS_HEAP_SPACE_NAME_VALUE_OLD_SPACE: () => iP,
	V8JS_RESOURCE_TYPE_VALUE_IMMEDIATE: () => oP,
	V8JS_RESOURCE_TYPE_VALUE_TCPSERVERWRAP: () => sP,
	V8JS_RESOURCE_TYPE_VALUE_TCPWRAP: () => cP,
	V8JS_RESOURCE_TYPE_VALUE_TIMEOUT: () => lP,
	V8JS_RESOURCE_TYPE_VALUE_TTYWRAP: () => uP,
	VCS_CHANGE_STATE_VALUE_CLOSED: () => pP,
	VCS_CHANGE_STATE_VALUE_MERGED: () => mP,
	VCS_CHANGE_STATE_VALUE_OPEN: () => hP,
	VCS_CHANGE_STATE_VALUE_WIP: () => "wip",
	VCS_LINE_CHANGE_TYPE_VALUE_ADDED: () => vP,
	VCS_LINE_CHANGE_TYPE_VALUE_REMOVED: () => yP,
	VCS_PROVIDER_NAME_VALUE_BITBUCKET: () => SP,
	VCS_PROVIDER_NAME_VALUE_GITEA: () => CP,
	VCS_PROVIDER_NAME_VALUE_GITHUB: () => wP,
	VCS_PROVIDER_NAME_VALUE_GITLAB: () => TP,
	VCS_PROVIDER_NAME_VALUE_GITTEA: () => EP,
	VCS_REF_BASE_TYPE_VALUE_BRANCH: () => AP,
	VCS_REF_BASE_TYPE_VALUE_TAG: () => "tag",
	VCS_REF_HEAD_TYPE_VALUE_BRANCH: () => PP,
	VCS_REF_HEAD_TYPE_VALUE_TAG: () => "tag",
	VCS_REF_TYPE_VALUE_BRANCH: () => IP,
	VCS_REF_TYPE_VALUE_TAG: () => "tag",
	VCS_REPOSITORY_REF_TYPE_VALUE_BRANCH: () => UP,
	VCS_REPOSITORY_REF_TYPE_VALUE_TAG: () => "tag",
	VCS_REVISION_DELTA_DIRECTION_VALUE_AHEAD: () => KP,
	VCS_REVISION_DELTA_DIRECTION_VALUE_BEHIND: () => qP
});
//#endregion
//#region node_modules/@mistralai/mistralai/esm/extra/observability/formatting.js
function wW(e) {
	if (e == null) return [];
	if (typeof e == "string") return [{
		type: "text",
		content: e
	}];
	if (!Array.isArray(e)) return [];
	let t = [];
	for (let n of e) if (typeof n == "string") t.push({
		type: "text",
		content: n
	});
	else if (typeof n == "object" && n) {
		let e = n, r = e.type || "";
		if (r === "text") t.push({
			type: "text",
			content: e.text || ""
		});
		else if (r === "thinking") {
			let n = e.thinking, r;
			r = Array.isArray(n) ? n.filter((e) => typeof e == "object" && !!e && e.type === "text").map((e) => e.text || "").join("\n") : String(n || ""), t.push({
				type: "reasoning",
				content: r
			});
		} else if (r === "image_url") {
			let n = e.image_url, r = typeof n == "object" && n ? n.url || "" : String(n || "");
			t.push({
				type: "uri",
				modality: "image",
				uri: r
			});
		} else t.push({ type: r });
	}
	return t;
}
function TW(e) {
	if (!e || !Array.isArray(e)) return [];
	let t = [];
	for (let n of e) {
		if (typeof n != "object" || !n) continue;
		let e = n, r = e.function || {}, i = {
			type: "tool_call",
			name: r.name || ""
		}, a = e.id;
		a != null && (i.id = a);
		let o = r.arguments;
		o != null && (i.arguments = o), t.push(i);
	}
	return t;
}
function EW(e) {
	if (e.type === "function.result") {
		let t = {
			type: "tool_call_response",
			response: e.result
		}, n = e.tool_call_id;
		return n != null && (t.id = n), {
			role: "tool",
			parts: [t]
		};
	}
	let t = e.role || "unknown", n = [];
	if (t === "tool") {
		let t = {
			type: "tool_call_response",
			response: e.content
		}, r = e.tool_call_id;
		r != null && (t.id = r), n.push(t);
	} else n.push(...wW(e.content)), n.push(...TW(e.tool_calls));
	return {
		role: t,
		parts: n
	};
}
function DW(e) {
	let t = e.message || {}, n = [];
	return n.push(...wW(t.content)), n.push(...TW(t.tool_calls)), {
		role: t.role || "assistant",
		parts: n,
		finish_reason: e.finish_reason || ""
	};
}
function OW(e) {
	let t = e.type || "function", n = e.function;
	if (!n) return null;
	let r = n.name;
	if (!r) return null;
	let i = {
		type: t,
		name: r
	}, a = n.description;
	a != null && (i.description = a);
	let o = n.parameters;
	return o != null && (i.parameters = o), i;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/extra/observability/streaming.js
function kW(e) {
	let t = JSON.parse(e);
	if (typeof t != "object" || !t || Array.isArray(t)) return e;
	let n = t;
	for (let e of [
		"object",
		"created",
		"usage"
	]) n[e] === null && delete n[e];
	let r = n.choices;
	if (Array.isArray(r)) {
		for (let e of r) if (typeof e == "object" && e && !Array.isArray(e)) {
			let t = e;
			"finish_reason" in t || (t.finish_reason = null);
		}
	}
	return JSON.stringify(n);
}
function AW(e) {
	let n = [], r = e.split("\n");
	for (let e of r) {
		let r = e.trim();
		if (!r.startsWith("data: ")) continue;
		let i = r.slice(6);
		if (i !== "[DONE]") try {
			let e = t(kW(i));
			e.ok && n.push(e.value);
		} catch {
			continue;
		}
	}
	return n;
}
function jW(e) {
	let t, r, i, a = /* @__PURE__ */ new Map();
	for (let n of e) {
		t ||= n.id, r ||= n.model, i ||= n.usage;
		for (let e of n.choices) {
			let t = a.get(e.index);
			t || (t = {
				message: {
					role: "assistant",
					content: ""
				},
				finish_reason: ""
			}, a.set(e.index, t));
			let n = t.message, r = e.delta;
			if (typeof r.role == "string" && (n.role = r.role), typeof r.content == "string" && r.content && (n.content += r.content), typeof e.finishReason == "string" && (t.finish_reason = e.finishReason), Array.isArray(r.toolCalls)) {
				n.tool_calls ||= [];
				let e = n.tool_calls;
				for (let t of r.toolCalls) {
					let n = t.index == null ? e.length : t.index;
					for (; e.length <= n;) e.push({
						id: null,
						function: {
							name: "",
							arguments: ""
						}
					});
					let r = e[n];
					t.id != null && t.id !== "null" && (r.id = t.id), t.function.name && (r.function.name += t.function.name), typeof t.function.arguments == "string" && t.function.arguments && (r.function.arguments += t.function.arguments);
				}
			}
		}
	}
	let o = Array.from(a.keys()).sort((e, t) => e - t), s = {
		id: t,
		model: r,
		choices: o.map((e) => a.get(e))
	};
	return i != null && (s.usage = n.parse(i)), s;
}
//#endregion
//#region node_modules/@mistralai/mistralai/esm/extra/observability/otel.js
var MW = "mistralai_sdk", NW = `${MW}_tracer`, PW = "agent.trace.public", FW;
function IW(e) {
	FW = e;
}
var LW = (() => {
	try {
		if (typeof globalThis < "u" && "process" in globalThis) return globalThis.process?.env?.MISTRAL_SDK_DEBUG_TRACING?.toLowerCase() === "true";
	} catch {}
	return !1;
})(), RW = "To see detailed tracing logs, set MISTRAL_SDK_DEBUG_TRACING=true.", W = {
	MISTRAL_AI_OCR_USAGE_PAGES_PROCESSED: "mistral_ai.ocr.usage.pages_processed",
	MISTRAL_AI_OCR_USAGE_DOC_SIZE_BYTES: "mistral_ai.ocr.usage.doc_size_bytes",
	MISTRAL_AI_ERROR_CODE: "mistral_ai.error.code"
}, G = {
	FAILED_TO_CREATE_SPAN_FOR_REQUEST: "Failed to create span for request.",
	FAILED_TO_ENRICH_SPAN_WITH_RESPONSE: "Failed to enrich span with response.",
	FAILED_TO_HANDLE_ERROR_IN_SPAN: "Failed to handle error in span.",
	FAILED_TO_END_SPAN: "Failed to end span."
};
function K(e) {
	return new Date(e).getTime();
}
function q(e) {
	return e.includes("chat_completion") || e === "stream_chat" ? F : (e.includes("agents_create") || e.includes("agents_update")) && !e.includes("alias") ? I_ : e.includes("agents_completion") || e === "stream_agents" || e.includes("conversations") && (e.includes("start") || e.includes("append") || e.includes("restart")) ? I : e.includes("fim") ? H_ : e.includes("embeddings") ? L_ : e.includes("ocr_post") ? z_ : null;
}
function zW(e) {
	return q(e) !== null;
}
function BW(e) {
	let t = e?.split(";")[0]?.trim().toLowerCase();
	return t === "application/json" || t === "text/json" || t?.endsWith("+json") === !0;
}
function J(e, t) {
	if (e === "create_agent" || e === "invoke_agent") {
		let n = t.name;
		return n ? `${e} ${n}` : e;
	}
	if (e === "execute_tool") {
		let n = t.name;
		return n ? `${e} ${n}` : e;
	}
	let n = t.model;
	return n ? `${e} ${n}` : e;
}
function Y(e, t) {
	for (let [n, r] of Object.entries(t)) r != null && r !== "" && e.setAttribute(n, r);
}
function X(e) {
	e.setAttribute(PW, "");
}
function VW(e, t, n, r) {
	let i = t.port ? parseInt(t.port, 10) : -1;
	i === -1 && (t.protocol === "https:" ? i = 443 : t.protocol === "http:" && (i = 80)), e.setAttributes({
		[Xt]: n,
		[oi]: t.toString(),
		[Ar]: r,
		[jr]: i
	});
}
function HW(e, t, n) {
	e.updateName(J(t, n));
	let r = {
		[uv]: n.n,
		[dv]: n.encoding_formats,
		[fv]: n.frequency_penalty,
		[pv]: n.max_tokens,
		[B]: n.model,
		[mv]: n.presence_penalty,
		[hv]: n.random_seed,
		[gv]: n.stop,
		[vv]: n.temperature,
		[bv]: n.top_p,
		[yv]: n.top_k
	}, i = n.messages || n.inputs;
	typeof i == "string" ? r[N] = JSON.stringify([EW({
		role: "user",
		content: i
	})]) : Array.isArray(i) && (r[N] = JSON.stringify(i.map((e) => EW(e))));
	let a = n.tools;
	if (a) {
		let e = a.map((e) => OW(e)).filter((e) => e !== null);
		e.length > 0 && (r[Zv] = JSON.stringify(e));
	}
	Y(e, r);
}
function UW(e, t, n, r, i, a) {
	VW(e, n, r, i);
	let o = q(t);
	if (o === null) return e;
	if (e.setAttributes({
		[P]: o,
		[R]: z
	}), a) try {
		HW(e, o, JSON.parse(a));
	} catch {}
	return e;
}
function WW(e, t, n) {
	let r = {};
	t !== "create_agent" && (r[V] = n.id), r[H] = n.model;
	let i = n.choices || [], a = i.map((e) => e.finish_reason).filter((e) => !!e);
	a.length > 0 && (r[xv] = a), i.length > 0 && (r[L] = JSON.stringify(i.map((e) => DW(e))));
	let o = n.usage;
	o && (r[iy] = o.prompt_tokens || 0, r[ay] = o.completion_tokens || 0), Y(e, r);
}
function GW(e, t) {
	Y(e, {
		[g_]: t.description,
		[j]: t.id,
		[__]: t.name,
		"gen_ai.agent.version": String(t.version),
		[B]: t.model,
		[U]: t.instructions
	});
}
function KW(e) {
	return typeof e == "string" ? e : e ? JSON.stringify(e) : null;
}
function qW(e, t, n) {
	let r = K(n.created_at), i = K(n.completed_at), a = R_, o = J(a, n), s = e.startSpan(o, { startTime: r }, t);
	X(s);
	let c = n.arguments, l = n.info;
	Y(s, {
		[P]: a,
		[R]: z,
		[Yv]: n.id,
		[Jv]: KW(c),
		[Xv]: KW(l),
		[$v]: n.name,
		[ey]: "extension"
	}), s.end(i);
}
function JW(e, t, n) {
	let r = K(n.created_at), i = K(n.completed_at), a = F, o = J(a, n), s = e.startSpan(o, { startTime: r }, t);
	X(s);
	let c = {
		message: n,
		finish_reason: n.finish_reason || ""
	};
	Y(s, {
		[P]: a,
		[R]: z,
		[V]: n.id,
		[j]: n.agent_id,
		[H]: n.model,
		[L]: JSON.stringify([DW(c)])
	}), s.end(i);
}
function YW(e, t, n) {
	Y(t, { [M]: n.conversation_id });
	let r = n.outputs || [], i = k.setSpan(T.active(), t);
	for (let t of r) {
		let n = t.type;
		n && n !== "function.call" && (n === "tool.execution" ? qW(e, i, t) : n === "message.output" && JW(e, i, t));
	}
}
function XW(e, t) {
	let n = t.usage_info;
	n && Y(e, {
		[W.MISTRAL_AI_OCR_USAGE_PAGES_PROCESSED]: n.pages_processed,
		[W.MISTRAL_AI_OCR_USAGE_DOC_SIZE_BYTES]: n.doc_size_bytes
	});
}
function Z(e, t, n, r) {
	let i = q(n);
	i !== null && (WW(t, i, r), i === "create_agent" ? GW(t, r) : i === "invoke_agent" && YW(e, t, r), n === "ocr_v1_ocr_post" && XW(t, r));
}
function ZW() {
	return (FW ?? k.getTracerProvider()).getTracer(NW);
}
function QW(e) {
	return k.setSpan(T.active(), e);
}
function $W(e, t) {
	return T.with(e, t);
}
async function eG(e, t) {
	let n = k.getSpan(e);
	n && await aG(n, null, t);
}
function Q(e, t) {
	LW ? console.warn(e, t) : console.warn(e, RW);
}
async function tG(e, t, n) {
	let r = e.startSpan(t);
	if (!r.isRecording()) return {
		request: n,
		span: r,
		body: null
	};
	try {
		X(r);
		let e = Ge.getBaggage(T.active())?.getEntry(M)?.value;
		e && r.setAttribute(M, e);
		let i = null;
		if (n.body && zW(t) && BW(n.headers.get("content-type"))) try {
			i = await n.clone().text();
		} catch {}
		let a = new Headers(n.headers), o = {};
		Ge.inject(k.setSpan(T.active(), r), o);
		for (let [e, t] of Object.entries(o)) a.set(e, t);
		let s = new Request(n, { headers: a }), c = new URL(n.url);
		return UW(r, t, c, n.method, a.get("host") || c.host, i), {
			request: s,
			span: r,
			body: i
		};
	} catch (e) {
		Q(G.FAILED_TO_CREATE_SPAN_FOR_REQUEST, e);
		try {
			r.end();
		} catch {}
		return {
			request: n,
			span: r,
			body: null
		};
	}
}
async function nG(e, t, n, r) {
	if (!t.isRecording()) return r;
	try {
		t.setStatus({ code: w.OK }), t.setAttribute(A, r.status);
		let i = zW(n), a = r.headers.get("content-type");
		if (i && !r.bodyUsed && a?.toLowerCase().includes("text/event-stream") === !0 && r.body) return rG(r, t, e, n);
		if (i && !r.bodyUsed && BW(a)) {
			let i = r.clone();
			try {
				Z(e, t, n, await i.json());
			} catch {}
		}
		return $(t), r;
	} catch (e) {
		return Q(G.FAILED_TO_ENRICH_SPAN_WITH_RESPONSE, e), $(t), r;
	}
}
function rG(e, t, n, r) {
	let i = e.body, a = [], o = new TextDecoder(), s = i.getReader(), c = !1, l = () => {
		if (c) return;
		let e = o.decode();
		e && a.push(e), c = !0, iG(a, t, n, r);
	}, u = new ReadableStream({
		async pull(e) {
			try {
				let { done: t, value: n } = await s.read();
				if (t) {
					l(), e.close();
					return;
				}
				a.push(o.decode(n, { stream: !0 })), e.enqueue(n);
			} catch (t) {
				l(), e.error(t);
				try {
					await s.cancel(t);
				} catch {}
			}
		},
		async cancel(e) {
			l(), await s.cancel(e);
		}
	}, { highWaterMark: 0 });
	return new Response(u, {
		status: e.status,
		statusText: e.statusText,
		headers: e.headers
	});
}
function iG(e, t, n, r) {
	try {
		let i = AW(e.join(""));
		i.length > 0 && Z(n, t, r, jW(i));
	} catch (e) {
		Q("Failed to enrich span with streaming response.", e);
	}
	$(t);
}
async function aG(e, t, n) {
	if (!e.isRecording()) return {
		response: t,
		error: n
	};
	try {
		if (n && (e.recordException(n), e.setStatus({
			code: w.ERROR,
			message: String(n)
		})), !t) return $(e), {
			response: t,
			error: n
		};
		try {
			let n = await t.clone().json();
			if (n.object === "error") {
				let r = n.message || "", i = n.type || "";
				if (r) {
					e.setStatus({
						code: w.ERROR,
						message: r
					}), e.addEvent("exception", {
						"exception.type": i || "api_error",
						"exception.message": r
					});
					let a = { [A]: t.status };
					i && (a[Ut] = i), n.code && (a[W.MISTRAL_AI_ERROR_CODE] = n.code), Y(e, a);
				}
			}
		} catch {}
		$(e);
	} catch (t) {
		Q(G.FAILED_TO_HANDLE_ERROR_IN_SPAN, t);
		try {
			e.end();
		} catch {}
	}
	return {
		response: t,
		error: n
	};
}
function $(e) {
	try {
		e.end();
	} catch (e) {
		Q(G.FAILED_TO_END_SPAN, e);
	}
}
async function oG(e, t) {
	let n = ZW().startSpan(e);
	try {
		return await t(n);
	} finally {
		n.end();
	}
}
//#endregion
export { NW as MISTRAL_SDK_OTEL_TRACER_NAME, W as MistralAIAttributes, MW as OTEL_SERVICE_NAME, G as TracingErrors, UW as enrichSpanFromRequest, Z as enrichSpanFromResponse, ZW as getOrCreateOtelTracer, aG as getResponseAndError, QW as getSpanContext, tG as getTracedRequestAndSpan, nG as getTracedResponse, eG as recordRequestError, IW as registerTracerProvider, $W as runWithContext, CW as semConvAttributes, oG as traceAsync };
