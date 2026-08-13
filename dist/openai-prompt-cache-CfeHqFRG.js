function e(e) {
	if (e === void 0) return;
	let t = Array.from(e);
	return t.length <= 64 ? e : t.slice(0, 64).join("");
}
//#endregion
export { e as t };
