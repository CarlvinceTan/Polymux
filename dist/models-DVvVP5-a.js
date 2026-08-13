import { i as e, t } from "./event-stream-D07JAHnY.js";
//#region node_modules/@earendil-works/pi-ai/dist/auth/context.js
var n = function(e, t) {
	return typeof e == "string" && /^\.\.?\//.test(e) ? e.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(e, n, r, i, a) {
		return n ? t ? ".jsx" : ".js" : r && (!i || !a) ? e : r + i + "." + a.toLowerCase() + "js";
	}) : e;
}, r = (e) => import(n(e));
function i() {
	return globalThis.process?.env;
}
function a() {
	return {
		async env(e) {
			let t = i()?.[e];
			return typeof t == "string" && t.trim().length > 0 ? t : void 0;
		},
		async fileExists(e) {
			try {
				let t = await r("node:fs/promises"), n = e;
				return n.startsWith("~") && (n = (await r("node:os")).homedir() + n.slice(1)), await t.access(n), !0;
			} catch {
				return !1;
			}
		}
	};
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/utils/abort.js
function o(e) {
	if (e.reason !== void 0) return e.reason;
	let t = /* @__PURE__ */ Error("The operation was aborted");
	return t.name = "AbortError", t;
}
function s(e) {
	return e ?? new AbortController().signal;
}
function c(e, t) {
	return t.aborted ? (e.catch(() => {}), Promise.reject(o(t))) : new Promise((n, r) => {
		let i = !1, a = () => t.removeEventListener("abort", s), s = () => {
			i || (i = !0, a(), r(o(t)));
		};
		t.addEventListener("abort", s, { once: !0 }), e.then((e) => {
			i || (i = !0, a(), n(e));
		}, (e) => {
			i || (i = !0, a(), r(e));
		}), t.aborted && s();
	});
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/auth/credential-store.js
var l = class {
	credentials = /* @__PURE__ */ new Map();
	chains = /* @__PURE__ */ new Map();
	enqueue(e, t, n) {
		let r = s(n?.signal), i = this.chains.get(e) ?? Promise.resolve(), a = (async () => (await i.catch(() => {}), r.throwIfAborted(), t()))(), o = a.catch(() => {});
		return this.chains.set(e, o), o.then(() => {
			this.chains.get(e) === o && this.chains.delete(e);
		}), c(a, r);
	}
	async read(e, t) {
		return t?.signal?.throwIfAborted(), this.credentials.get(e);
	}
	async list(e) {
		return e?.signal?.throwIfAborted(), [...this.credentials].map(([e, t]) => ({
			providerId: e,
			type: t.type
		}));
	}
	modify(e, t, n) {
		return this.enqueue(e, async () => {
			let r = this.credentials.get(e), i = await t(r);
			return n?.signal?.throwIfAborted(), i !== void 0 && this.credentials.set(e, i), i ?? r;
		}, n);
	}
	delete(e, t) {
		return this.enqueue(e, async () => {
			this.credentials.delete(e);
		}, t);
	}
}, u = class extends Error {
	code;
	constructor(e, t, n) {
		super(d(t, n?.cause), n), this.name = "ModelsError", this.code = e;
	}
};
function d(t, n) {
	if (n == null) return t;
	let r = e(n).trim();
	return !r || t.includes(r) ? t : `${t}: ${r}`;
}
function f(e, t, n, r) {
	let i = s(r?.signal);
	return c(p(e, t, n, r, i), i);
}
async function p(e, t, n, r, i) {
	i.throwIfAborted();
	let a = r?.env ? m(n, r.env) : n;
	if (r?.apiKey !== void 0 && e.auth.apiKey) return v(a, e.auth.apiKey, e.id, {
		type: "api_key",
		key: r.apiKey,
		env: r.env
	}, i);
	let o = await y(t, e.id, i);
	if (o) {
		if (o.type === "oauth" && e.auth.oauth) return _(t, e.id, e.auth.oauth, o, i, r?.minOAuthValidityMs);
		if (o.type === "api_key" && e.auth.apiKey) {
			let t = r?.env ? {
				...o,
				env: {
					...o.env,
					...r.env
				}
			} : o;
			return v(a, e.auth.apiKey, e.id, t, i);
		}
		return;
	}
	return e.auth.apiKey ? v(a, e.auth.apiKey, e.id, void 0, i) : void 0;
}
function m(e, t) {
	return {
		env: async (n) => t[n] || await e.env(n),
		fileExists: (t) => e.fileExists(t)
	};
}
var h = 3e5, g = 15e3;
async function _(e, t, n, r, i, a) {
	let o = Math.max(h, a ?? 0), s = (e) => Date.now() + o >= e.expires, c = r;
	if (s(c)) {
		let r;
		try {
			r = await e.modify(t, async (e) => {
				if (e?.type === "oauth" && s(e)) try {
					let t = AbortSignal.any([i, AbortSignal.timeout(g)]);
					return await n.refresh(e, t);
				} catch (e) {
					throw new u("oauth", `OAuth refresh failed for ${t}`, { cause: e });
				}
			}, { signal: i });
		} catch (e) {
			throw e instanceof u ? e : new u("auth", `Credential store modify failed for ${t}`, { cause: e });
		}
		if (r?.type !== "oauth") return;
		if (c = r, a !== void 0 && s(c)) throw new u("oauth", `OAuth refresh returned a token that expires too soon for ${t}`);
	}
	try {
		return {
			auth: await n.toAuth(c),
			source: "OAuth"
		};
	} catch (e) {
		throw new u("oauth", `OAuth auth derivation failed for ${t}`, { cause: e });
	}
}
async function v(e, t, n, r, i) {
	try {
		return await t.resolve({
			ctx: e,
			credential: r,
			signal: i
		});
	} catch (e) {
		throw new u("auth", `API key auth failed for provider ${n}`, { cause: e });
	}
}
async function y(e, t, n) {
	try {
		return await e.read(t, { signal: n });
	} catch (e) {
		throw new u("auth", `Credential store read failed for ${t}`, { cause: e });
	}
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/api/lazy.js
function b(e, t) {
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
		stopReason: "error",
		errorMessage: t instanceof Error ? t.message : String(t),
		timestamp: Date.now()
	};
}
function x(e) {
	return typeof e.result == "function";
}
async function S(e, t) {
	for await (let n of t) e.push(n);
	e.end(x(t) ? await t.result() : void 0);
}
function C(e, n) {
	let r = new t();
	return n().then((e) => S(r, e)).catch((t) => {
		let n = b(e, t);
		r.push({
			type: "error",
			reason: "error",
			error: n
		}), r.end(n);
	}), r;
}
function w(e, t) {
	let n = {
		stream: (t, n, r) => C(t, async () => (await e()).stream(t, n, r)),
		streamSimple: (t, n, r) => C(t, async () => (await e()).streamSimple(t, n, r))
	};
	return t?.fetchDeferred && (n.fetchDeferred = (t, n, r) => C(t, async () => {
		let i = await e();
		if (!i.fetchDeferred) throw Error("API does not support deferred responses");
		return i.fetchDeferred(t, n, r);
	})), t?.cancelDeferred && (n.cancelDeferred = async (t, n, r) => {
		let i = await e();
		if (!i.cancelDeferred) throw Error("API cannot cancel deferred responses");
		await i.cancelDeferred(t, n, r);
	}), n;
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/models-store.js
var T = class {
	entries = /* @__PURE__ */ new Map();
	async read(e, t) {
		t?.signal?.throwIfAborted();
		let n = this.entries.get(e);
		return n ? structuredClone(n) : void 0;
	}
	async write(e, t, n) {
		n?.signal?.throwIfAborted(), this.entries.set(e, structuredClone(t));
	}
	async delete(e, t) {
		t?.signal?.throwIfAborted(), this.entries.delete(e);
	}
};
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/models.js
function E(e, t) {
	if (!e && !t) return;
	let n = { ...e };
	for (let [e, r] of Object.entries(t ?? {})) {
		let t = e.toLowerCase();
		for (let e of Object.keys(n)) e.toLowerCase() === t && delete n[e];
		n[e] = r;
	}
	return n;
}
var D = class {
	providers = /* @__PURE__ */ new Map();
	credentials;
	modelsStore;
	authContext;
	refreshGenerations = /* @__PURE__ */ new Map();
	refreshControllers = /* @__PURE__ */ new Map();
	publicationChains = /* @__PURE__ */ new Map();
	constructor(e) {
		this.credentials = e?.credentials ?? new l(), this.modelsStore = e?.modelsStore ?? new T(), this.authContext = e?.authContext ?? a();
	}
	setProvider(e) {
		this.supersedeProviderRefresh(e.id), this.providers.set(e.id, e);
	}
	deleteProvider(e) {
		this.supersedeProviderRefresh(e), this.providers.delete(e);
	}
	clearProviders() {
		for (let e of /* @__PURE__ */ new Set([...this.providers.keys(), ...this.refreshControllers.keys()])) this.supersedeProviderRefresh(e);
		this.providers.clear();
	}
	getProviders() {
		return Array.from(this.providers.values());
	}
	getProvider(e) {
		return this.providers.get(e);
	}
	getModels(e) {
		if (e !== void 0) {
			let t = this.providers.get(e);
			if (!t) return [];
			try {
				return t.getModels();
			} catch {
				return [];
			}
		}
		let t = [];
		for (let e of this.providers.values()) try {
			t.push(...e.getModels());
		} catch {}
		return t;
	}
	getModel(e, t) {
		return this.getModels(e).find((e) => e.id === t);
	}
	supersedeProviderRefresh(e) {
		let t = (this.refreshGenerations.get(e) ?? 0) + 1;
		this.refreshGenerations.set(e, t);
		let n = this.refreshControllers.get(e);
		return n && (this.refreshControllers.delete(e), n.abort()), t;
	}
	beginProviderRefresh(e) {
		let t = this.supersedeProviderRefresh(e), n = new AbortController();
		return this.refreshControllers.set(e, n), {
			generation: t,
			controller: n
		};
	}
	publishProviderModels(e, t, n, r) {
		let i = this.publicationChains.get(e) ?? Promise.resolve(), a = (async () => (await i.catch(() => {}), n.aborted || this.refreshGenerations.get(e) !== t || (r.persist === null ? await this.modelsStore.delete(e, { signal: n }) : r.persist !== void 0 && await this.modelsStore.write(e, structuredClone(r.persist), { signal: n }), n.aborted || this.refreshGenerations.get(e) !== t) ? !1 : (r.update?.(), !0)))(), o = a.catch(() => {});
		return this.publicationChains.set(e, o), o.then(() => {
			this.publicationChains.get(e) === o && this.publicationChains.delete(e);
		}), c(a, n);
	}
	async runProviderRefreshPhase(e, t, n, r, i, a) {
		let o = await this.modelsStore.read(e.id, { signal: a });
		await e.refreshModels({
			credential: t,
			stored: o ? structuredClone(o) : void 0,
			publish: (t) => this.publishProviderModels(e.id, i, a, t),
			allowNetwork: n,
			force: n ? r : void 0,
			signal: a
		});
	}
	async refresh(e = {}) {
		let t = e.allowNetwork ?? !0, n = s(e.signal), r = /* @__PURE__ */ new Map();
		if (n.aborted) return {
			aborted: !0,
			errors: r
		};
		let i = e.providers ? new Set(e.providers) : void 0, a = Array.from(this.providers.values()).filter((e) => e.refreshModels !== void 0 && (!i || i.has(e.id))), o = Promise.all(a.map(async (i) => {
			let { generation: a, controller: o } = this.beginProviderRefresh(i.id), s = AbortSignal.any([n, o.signal]), l = (async () => {
				let n, r;
				try {
					n = await this.readCredential(i.id, s);
				} catch (e) {
					r = e;
				}
				if (await this.runProviderRefreshPhase(i, n, !1, void 0, a, s), r !== void 0) throw r;
				if (!t || s.aborted) return;
				let o = await this.resolveRefreshCredential(i, n, s);
				o && await this.runProviderRefreshPhase(i, o, !0, e.force, a, s);
			})();
			try {
				await c(l, s);
			} catch (e) {
				s.aborted || r.set(i.id, e instanceof Error ? e : new u("model_source", `Model refresh failed for ${i.id}`, { cause: e }));
			} finally {
				this.refreshControllers.get(i.id) === o && this.refreshControllers.delete(i.id);
			}
		}));
		try {
			await c(o, n);
		} catch (e) {
			if (!n.aborted) throw e;
		}
		return {
			aborted: n.aborted,
			errors: new Map(r)
		};
	}
	async resolveRefreshCredential(e, t, n) {
		if (t?.type === "oauth") {
			let r = e.auth.oauth;
			if (!r) return;
			if (Date.now() < t.expires) return t;
			if (n.aborted) return;
			let i = await this.credentials.modify(e.id, async (e) => {
				if (!(e?.type !== "oauth" || Date.now() < e.expires)) return r.refresh(e, n);
			}, { signal: n });
			return i?.type === "oauth" ? i : void 0;
		}
		let r = e.auth.apiKey;
		if (!r) return;
		let i = t?.type === "api_key" ? t : void 0, a = await r.resolve({
			ctx: this.authContext,
			credential: i,
			signal: n
		});
		if (a) return {
			type: "api_key",
			key: a.auth.apiKey,
			env: a.env
		};
	}
	async readCredential(e, t) {
		try {
			return await this.credentials.read(e, { signal: t });
		} catch (t) {
			throw new u("auth", `Credential store read failed for ${e}`, { cause: t });
		}
	}
	async checkProviderAuth(e, t, n) {
		if (t?.type === "oauth") return e.auth.oauth ? {
			source: "OAuth",
			type: "oauth"
		} : void 0;
		let r = e.auth.apiKey;
		if (!r) return;
		if (r.check) try {
			return await r.check({
				ctx: this.authContext,
				credential: t?.type === "api_key" ? t : void 0,
				signal: n
			});
		} catch (t) {
			throw new u("auth", `API key auth check failed for provider ${e.id}`, { cause: t });
		}
		let i = await f(e, this.credentials, this.authContext, { signal: n });
		return i ? {
			source: i.source,
			type: "api_key"
		} : void 0;
	}
	checkAuth(e, t) {
		let n = s(t?.signal);
		return c((async () => {
			n.throwIfAborted();
			let t = this.providers.get(e);
			if (t) return this.checkProviderAuth(t, await this.readCredential(e, n), n);
		})(), n);
	}
	getAvailable(e, t) {
		let n = s(t?.signal);
		return c((async () => {
			n.throwIfAborted();
			let t = e ? [this.providers.get(e)].filter((e) => e !== void 0) : this.getProviders();
			return (await Promise.all(t.map(async (e) => {
				let t = await this.readCredential(e.id, n);
				return {
					provider: e,
					credential: t,
					auth: await this.checkProviderAuth(e, t, n)
				};
			}))).flatMap(({ provider: e, credential: t, auth: n }) => {
				if (!n) return [];
				let r = e.getModels();
				return e.filterModels?.(r, t) ?? r;
			});
		})(), n);
	}
	async getAuth(e, t) {
		let n = s(t?.signal), r = typeof e == "string" ? e : e.provider, i = this.providers.get(r);
		if (!i) return;
		let a = await f(i, this.credentials, this.authContext, {
			...t,
			signal: n
		});
		return !a || typeof e == "string" || !e.headers ? a : {
			...a,
			auth: {
				...a.auth,
				headers: E(a.auth.headers, e.headers)
			}
		};
	}
	async login(e, t, n) {
		let r = s(n.signal);
		r.throwIfAborted();
		let i = this.providers.get(e);
		if (!i) throw new u("provider", `Unknown provider: ${e}`);
		let a = t === "oauth" ? i.auth.oauth : i.auth.apiKey;
		if (!a?.login) throw new u("auth", `${i.name} does not support ${t} login`);
		let o = await c(a.login({
			...n,
			signal: r
		}), r), l = !1, d, f = new Promise((e) => {
			d = e;
		}), p = this.credentials.modify(e, async () => (l = !0, d?.(), o), { signal: r });
		p.catch(() => {});
		try {
			await new Promise((e, t) => {
				let n = () => {
					l || t(r.reason);
				};
				r.addEventListener("abort", n, { once: !0 }), Promise.race([f, p]).then(() => {
					r.removeEventListener("abort", n), e();
				}, (e) => {
					r.removeEventListener("abort", n), t(e);
				}), r.aborted && n();
			}), await p;
		} catch (t) {
			throw r.throwIfAborted(), new u("auth", `Credential store modify failed for ${e}`, { cause: t });
		}
		return o;
	}
	async logout(e, t) {
		let n = s(t?.signal);
		n.throwIfAborted();
		try {
			await this.credentials.delete(e, { signal: n });
		} catch (t) {
			throw n.throwIfAborted(), new u("auth", `Credential store delete failed for ${e}`, { cause: t });
		}
	}
	requireProvider(e) {
		let t = this.providers.get(e.provider);
		if (!t) throw new u("provider", `Unknown provider: ${e.provider}`);
		return t;
	}
	async applyAuth(e, t) {
		this.requireProvider(e);
		let n = await this.getAuth(e, {
			apiKey: t?.apiKey,
			env: t?.env,
			signal: t?.signal
		});
		if (!n) throw new u("auth", `Provider is not configured: ${e.provider}`);
		let r = n.auth, i = t?.apiKey ?? r.apiKey, a = E(r.headers, t?.headers);
		t?.transformHeaders && (a = await t.transformHeaders(a ?? {}));
		let o = n.env || t?.env ? {
			...n.env ?? {},
			...t?.env ?? {}
		} : void 0, s = r.baseUrl ? {
			...e,
			baseUrl: r.baseUrl
		} : e, { transformHeaders: c, ...l } = t ?? {};
		return {
			requestModel: s,
			requestOptions: {
				...l,
				apiKey: i,
				headers: a,
				env: o
			}
		};
	}
	stream(e, t, n) {
		return C(e, async () => {
			let r = this.requireProvider(e), { requestModel: i, requestOptions: a } = await this.applyAuth(e, n);
			return r.stream(i, t, a);
		});
	}
	async complete(e, t, n) {
		return this.stream(e, t, n).result();
	}
	streamSimple(e, t, n) {
		return C(e, async () => {
			let r = this.requireProvider(e), { requestModel: i, requestOptions: a } = await this.applyAuth(e, n);
			return r.streamSimple(i, t, a);
		});
	}
	async completeSimple(e, t, n) {
		return this.streamSimple(e, t, n).result();
	}
	async fetchDeferred(e, t, n) {
		return C(e, async () => {
			let r = this.requireProvider(e);
			if (!r.fetchDeferred) throw new u("provider", `Provider ${e.provider} does not support deferred responses`);
			let { requestModel: i, requestOptions: a } = await this.applyAuth(e, n);
			return r.fetchDeferred(i, t, a);
		}).result();
	}
	async cancelDeferred(e, t, n) {
		let r = this.requireProvider(e);
		if (!r.cancelDeferred) throw new u("provider", `Provider ${e.provider} does not support deferred responses`);
		let { requestModel: i, requestOptions: a } = await this.applyAuth(e, n);
		await r.cancelDeferred(i, t, a);
	}
};
function O(e) {
	return new D(e);
}
function k(e) {
	let t = e.models, n = [], r = e.fetchModels, i = () => {
		let e = [...t];
		for (let t of n) {
			let n = e.findIndex((e) => e.id === t.id);
			n >= 0 ? e[n] = t : e.push(t);
		}
		return e;
	}, a = typeof e.api.stream == "function" ? e.api : void 0, o = a ? void 0 : e.api, s = (e) => a ?? o?.[e.api], c = (t, n) => {
		let r = s(t);
		return r ? n(r) : C(t, async () => {
			throw new u("stream", `Provider ${e.id} has no API implementation for "${t.api}"`);
		});
	}, l = {
		id: e.id,
		name: e.name ?? e.id,
		baseUrl: e.baseUrl,
		headers: e.headers,
		auth: e.auth,
		getModels: i,
		refreshModels: r ? async (t) => {
			if (t.stored) {
				let r = t.stored.models.filter((t) => t.provider === e.id).map((e) => e);
				if (!await t.publish({ update: () => {
					n = r;
				} })) return;
			}
			if (!t.allowNetwork || t.signal.aborted) return;
			let i = await r(t);
			t.signal.aborted || await t.publish({
				persist: {
					models: i,
					checkedAt: Date.now()
				},
				update: () => {
					n = i;
				}
			});
		} : void 0,
		filterModels: e.filterModels,
		stream: (e, t, n) => c(e, (r) => r.stream(e, t, n)),
		streamSimple: (e, t, n) => c(e, (r) => r.streamSimple(e, t, n))
	}, d = a ? [a] : Object.values(o ?? {}).filter((e) => e !== void 0);
	return d.some((e) => e.fetchDeferred !== void 0) && (l.fetchDeferred = (t, n, r) => C(t, async () => {
		let i = s(t);
		if (!i?.fetchDeferred) throw new u("provider", `Provider ${e.id} does not support deferred responses for "${t.api}"`);
		return i.fetchDeferred(t, n, r);
	})), d.some((e) => e.cancelDeferred !== void 0) && (l.cancelDeferred = async (t, n, r) => {
		let i = s(t);
		if (!i?.cancelDeferred) throw new u("provider", `Provider ${e.id} cannot cancel deferred responses for "${t.api}"`);
		await i.cancelDeferred(t, n, r);
	}), l;
}
function A(e, t) {
	let n = t.input + t.cacheRead + t.cacheWrite, r = e.cost, i = -1;
	for (let t of e.cost.tiers ?? []) n > t.inputTokensAbove && t.inputTokensAbove > i && (r = t, i = t.inputTokensAbove);
	let a = t.cacheWrite1h ?? 0, o = t.cacheWrite - a;
	return t.cost.input = r.input / 1e6 * t.input, t.cost.output = r.output / 1e6 * t.output, t.cost.cacheRead = r.cacheRead / 1e6 * t.cacheRead, t.cost.cacheWrite = (r.cacheWrite * o + r.input * 2 * a) / 1e6, t.cost.total = t.cost.input + t.cost.output + t.cost.cacheRead + t.cost.cacheWrite, t.cost;
}
var j = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function M(e) {
	return e.reasoning ? j.filter((t) => {
		let n = e.thinkingLevelMap?.[t];
		return n === null ? !1 : t === "xhigh" || t === "max" ? n !== void 0 : !0;
	}) : ["off"];
}
function N(e, t) {
	let n = M(e);
	if (n.includes(t)) return t;
	let r = j.indexOf(t);
	if (r === -1) return n[0] ?? "off";
	for (let e = r; e < j.length; e++) {
		let t = j[e];
		if (n.includes(t)) return t;
	}
	for (let e = r - 1; e >= 0; e--) {
		let t = j[e];
		if (n.includes(t)) return t;
	}
	return n[0] ?? "off";
}
//#endregion
export { w as a, k as i, N as n, O as r, A as t };
