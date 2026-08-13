//#region node_modules/@earendil-works/pi-ai/dist/utils/headers.js
function e(e) {
	let t = {};
	for (let [n, r] of e.entries()) t[n] = r;
	return t;
}
function t(e) {
	if (!e) return;
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== null && (t[n] = r);
	return Object.keys(t).length > 0 ? t : void 0;
}
//#endregion
export { t as n, e as t };
