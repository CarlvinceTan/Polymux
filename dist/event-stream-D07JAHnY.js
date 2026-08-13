//#region node_modules/@earendil-works/pi-ai/dist/utils/diagnostics.js
function e(e) {
	return e instanceof Error ? e.message || e.name : typeof e == "string" ? e : String(e);
}
function t(t) {
	if (!(t instanceof Error)) return {
		name: "ThrownValue",
		message: e(t)
	};
	let n = t.code;
	return {
		name: t.name || void 0,
		message: t.message || t.name,
		stack: t.stack,
		code: typeof n == "string" || typeof n == "number" ? n : void 0
	};
}
function n(e, n, r) {
	return {
		type: e,
		timestamp: Date.now(),
		error: t(n),
		details: r
	};
}
function r(e, t) {
	e.diagnostics = [...e.diagnostics ?? [], t];
}
//#endregion
//#region node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js
var i = class {
	queue = [];
	waiting = [];
	done = !1;
	finalResultPromise;
	resolveFinalResult;
	isComplete;
	extractResult;
	constructor(e, t) {
		this.isComplete = e, this.extractResult = t, this.finalResultPromise = new Promise((e) => {
			this.resolveFinalResult = e;
		});
	}
	push(e) {
		if (this.done) return;
		this.isComplete(e) && (this.done = !0, this.resolveFinalResult(this.extractResult(e)));
		let t = this.waiting.shift();
		t ? t({
			value: e,
			done: !1
		}) : this.queue.push(e);
	}
	end(e) {
		for (this.done = !0, e !== void 0 && this.resolveFinalResult(e); this.waiting.length > 0;) this.waiting.shift()({
			value: void 0,
			done: !0
		});
	}
	async *[Symbol.asyncIterator]() {
		for (;;) if (this.queue.length > 0) yield this.queue.shift();
		else if (this.done) return;
		else {
			let e = await new Promise((e) => this.waiting.push(e));
			if (e.done) return;
			yield e.value;
		}
	}
	result() {
		return this.finalResultPromise;
	}
}, a = class extends i {
	constructor() {
		super((e) => e.type === "done" || e.type === "error", (e) => {
			if (e.type === "done") return e.message;
			if (e.type === "error") return e.error;
			throw Error("Unexpected event type for final result");
		});
	}
};
//#endregion
export { e as i, r as n, n as r, a as t };
