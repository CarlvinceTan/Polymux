import { i as e } from "./rolldown-runtime-CJfroGDQ.js";
//#region node_modules/@earendil-works/pi-ai/dist/utils/provider-env.js
var t = null;
function n(n) {
	if (!(typeof process > "u" || !process.versions?.bun || Object.keys(process.env).length > 0)) {
		if (t === null) {
			t = /* @__PURE__ */ new Map();
			try {
				let { readFileSync: n } = e("node:fs"), r = n("/proc/self/environ", "utf-8");
				for (let e of r.split("\0")) {
					let n = e.indexOf("=");
					n > 0 && t.set(e.slice(0, n), e.slice(n + 1));
				}
			} catch {}
		}
		return t.get(n);
	}
}
function r(e, t) {
	return t?.[e] || (typeof process < "u" ? process.env[e] : void 0) || n(e) || void 0;
}
//#endregion
export { r as t };
