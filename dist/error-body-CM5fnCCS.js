function e(e) {
	if (!(e instanceof Error)) return {
		message: c(e),
		messageCarriesBody: !1
	};
	let r = e, i = t(r), a = n(r), o = a === void 0 || e.message.includes(a);
	return {
		status: i,
		body: a,
		message: e.message,
		messageCarriesBody: o
	};
}
function t(e) {
	if (typeof e.statusCode == "number") return e.statusCode;
	if (typeof e.status == "number") return e.status;
	if (typeof e.$metadata?.httpStatusCode == "number") return e.$metadata.httpStatusCode;
	if (typeof e.$response?.statusCode == "number") return e.$response.statusCode;
}
function n(e) {
	let t = r(e);
	if (t === void 0) return;
	let n = t.trim();
	if (n.length !== 0) return s(n, 4e3);
}
function r(e) {
	if (typeof e.body == "string") return e.body;
	if (a(e.error)) return c(e.error);
	let t = e.$response?.body;
	if (typeof t == "string") return t;
	if (!i(t) && a(t)) return c(t);
}
function i(e) {
	return typeof e == "object" && !!e && "pipe" in e && typeof e.pipe == "function";
}
function a(e) {
	if (typeof e != "object" || !e) return !1;
	let t = Object.getPrototypeOf(e);
	return t !== Object.prototype && t !== null ? !1 : Object.keys(e).length > 0;
}
function o(e, t) {
	return e.messageCarriesBody || e.status === void 0 || e.body === void 0 ? t !== void 0 && e.status !== void 0 ? `${t} (${e.status}): ${e.message}` : e.message : t === void 0 ? `${e.status}: ${e.body}` : `${t} (${e.status}): ${e.body}`;
}
function s(e, t) {
	return e.length <= t ? e : `${e.slice(0, t)}... [truncated ${e.length - t} chars]`;
}
function c(e) {
	try {
		let t = JSON.stringify(e);
		return t === void 0 ? String(e) : t;
	} catch {
		return String(e);
	}
}
//#endregion
export { e as n, o as t };
