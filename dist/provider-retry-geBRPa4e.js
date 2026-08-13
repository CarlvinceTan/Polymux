function e(e) {
	return !(e instanceof Error) || !("status" in e) || !("headers" in e) ? !1 : (e.status === void 0 || typeof e.status == "number") && (e.headers === void 0 || e.headers instanceof Headers);
}
function t(e) {
	let t = e.headers?.get("x-should-retry");
	return t === "true" ? !0 : t === "false" ? !1 : e.status === void 0 || e.status === 408 || e.status === 409 || e.status === 429 || typeof e.status == "number" && e.status >= 500;
}
function n(e, t, n) {
	let r = t ?? 6e4;
	if (r > 0 && e > r) throw Error(`Server requested ${Math.ceil(e / 1e3)}s retry delay (max: ${Math.ceil(r / 1e3)}s). ${n}`);
	return e;
}
function r(e, t, r) {
	let i = e.headers?.get("retry-after-ms");
	if (i) {
		let t = Number.parseFloat(i);
		if (!Number.isNaN(t)) return n(t, r, e.message);
	}
	let a = e.headers?.get("retry-after");
	if (a) {
		let t = Number.parseFloat(a);
		return n(Number.isNaN(t) ? Date.parse(a) - Date.now() : t * 1e3, r, e.message);
	}
	return Math.min(.5 * 2 ** t, 8) * 1e3 * (1 - Math.random() * .25);
}
function i() {
	let e = /* @__PURE__ */ Error("Request aborted");
	return e.name = "AbortError", e;
}
function a(e, t) {
	return new Promise((n, r) => {
		if (t?.aborted) {
			r(i());
			return;
		}
		let a = () => {
			clearTimeout(o), r(i());
		}, o = setTimeout(() => {
			t?.removeEventListener("abort", a), n();
		}, Math.max(0, e));
		t?.addEventListener("abort", a, { once: !0 });
	});
}
async function o(n, o = {}) {
	let s = o.maxRetries ?? 0, c = s;
	for (;;) try {
		return await n();
	} catch (n) {
		if (o.signal?.aborted) throw i();
		if (c <= 0 || !e(n) || !t(n)) throw n;
		let l = s - c;
		c--, await a(r(n, l, o.maxRetryDelayMs), o.signal);
	}
}
//#endregion
export { o as t };
