//#region node_modules/@earendil-works/pi-ai/dist/utils/deferred-tools.js
var e = (e) => e;
function t(t, n, r = e) {
	let i = /* @__PURE__ */ new Map();
	for (let e of t.tools ?? []) i.set(r(e.name), e);
	if (!n) return {
		immediate: [...i.values()],
		deferred: /* @__PURE__ */ new Map()
	};
	let a = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Set();
	for (let e of t.messages) if (e.role === "assistant") for (let t of e.content) t.type === "toolCall" && o.add(r(t.name));
	else if (e.role === "toolResult") for (let t of e.addedToolNames ?? []) {
		let e = r(t);
		o.has(e) || a.add(e);
	}
	let s = [], c = /* @__PURE__ */ new Map();
	for (let [e, t] of i) a.has(e) ? c.set(e, t) : s.push(t);
	return {
		immediate: s,
		deferred: c
	};
}
//#endregion
export { t };
