import { afterAll, expect, test } from "bun:test";
import { ev, fakeHub, idleState, json, run, waitFor } from "./test-web.ts";

// Split panes, step 2: rows and pane heads dragged over the panes, the ⌥⌘ keys, and named layouts. The pointer events are dispatched the way the
// page gets them (down on the row, moves and up on the document); a drop is awaited as a page condition.
const at = (i: number) => new Date(Date.UTC(2026, 9, 20, 1, i)).toISOString();
const lane = (name: string) => ({ name, status: "working", live: true, session: name });
const history = (target: string) => Array.from({ length: 4 }, (_, i) => ({ ts: at(i), kind: "out", source: "orchestrator", target, text: `${target} 답변 ${i}` }));
const hub = fakeHub({
	stream: "fake",
	state: () => idleState({ lanes: [lane("가나"), lane("다라"), lane("마바"), lane("사아")] }),
	api: (_req, url) => {
		const p = url.pathname;
		if (p === "/api/history") { const t = url.searchParams.get("target") ?? "main"; return json({ target: t, events: history(t) }); }
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations" || p === "/api/monitors") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		return undefined;
	},
});
afterAll(() => hub.stop());

type V = Awaited<ReturnType<typeof open>>;
const open = async () => {
	const v = await hub.view({ width: 1280, height: 800 }, "/#chat");
	await waitFor(v, `target === "main" && CV.placed && tl.querySelectorAll(".bm").length >= 1 && !!document.querySelector('#chat-convo .cv-row[data-t="lane:다라"]')`);
	return v;
};
const split = async (v: V, t: string, side = "right") => {
	await run(v, `paneSplit(${JSON.stringify(t)}, "chat", ${JSON.stringify(side)})`);
	await waitFor(v, `document.querySelectorAll("#split .pane").length === paneCount() && document.querySelector("#split .pane.on") && CV.placed`);
};
const ids = (v: V) => ev<string[]>(v, `paneList().map(p => p.t)`);

// The conversation as a drop box when there is one pane: from the head to the bottom of the composer.
const ONE = `(() => { const a = $("#cv-head").getBoundingClientRect(), b = $("#composer").getBoundingClientRect(); return new DOMRect(a.left, a.top, a.width, b.bottom - a.top); })()`;
const PANE = (t: string) => `$("#split .pane[data-id='" + paneList().find(p => p.t === ${JSON.stringify(t)}).id + "']").getBoundingClientRect()`;
// Pulls `from` (a selector) over the box `to` (an expression for its rect) at fraction (fx, fy) of it, then lets go unless `drop` is false.
const drag = (v: V, from: string, to: string, fx: number, fy: number, drop = true) => run(v, `
	const s = document.querySelector(${JSON.stringify(from)}), a = s.getBoundingClientRect(), r = ${to};
	const fire = (type, x, y) => document.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
	s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: a.left + 20, clientY: a.top + 10, pointerId: 1, button: 0 }));
	fire("pointermove", a.left + 40, a.top + 20);
	const x = r.left + r.width * ${fx}, y = r.top + r.height * ${fy};
	fire("pointermove", x, y);
	${drop ? `fire("pointerup", x, y);` : ""}`);
const ROW = (t: string) => `#chat-convo .cv-row[data-t="${t}"]`;
const key = (v: V, code: string, extra = "") => run(v, `document.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)}, key: "x", bubbles: true, cancelable: true, ${extra} ...(isMac ? { metaKey: true } : { ctrlKey: true }) }))`);

test("a session row dropped on the right edge of the one conversation splits it; the click after the drag opens nothing", async () => {
	const v = await open();
	await drag(v, ROW("lane:가나"), ONE, 0.5, 0.5, false);
	await waitFor(v, `!!document.querySelector(".pn-zone") && !!document.querySelector(".pn-ghost")`);
	await run(v, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);
	await waitFor(v, `!document.querySelector(".pn-zone") && !document.querySelector(".pn-ghost")`);
	await run(v, `document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0 }))`);
	expect(await ev(v, `[paneCount(), target]`)).toEqual([0, "main"]);

	await drag(v, ROW("lane:가나"), ONE, 0.95, 0.5);
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2 && CV.placed`);
	expect(await ids(v)).toEqual(["main", "lane:가나"]);
	expect(await ev(v, `!document.querySelector(".pn-zone, .pn-ghost") && !document.body.classList.contains("pn-drag")`)).toBe(true);
});

test("the middle of a pane replaces it; a target that is already open only takes the focus", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await drag(v, ROW("lane:다라"), PANE("main"), 0.5, 0.5);
	await waitFor(v, `paneList().map(p => p.t).join() === "lane:다라,lane:가나"`);
	await drag(v, ROW("lane:가나"), PANE("lane:다라"), 0.5, 0.5);
	await waitFor(v, `paneList().find(p => p.t === "lane:가나").active`);
	expect(await ids(v)).toEqual(["lane:다라", "lane:가나"]);
});

test("a full set takes no fifth pane: an edge drop is a middle drop", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await split(v, "lane:다라", "bottom");
	await split(v, "lane:마바");
	expect(await ev(v, `paneCount()`)).toBe(4);
	await drag(v, ROW("lane:사아"), PANE("main"), 0.97, 0.5, false);
	await waitFor(v, `PD && PD.hit && PD.hit.side === "center"`);
	await run(v, `{ const r = PD.hit.r; document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + r.width * 0.97, clientY: r.top + r.height / 2, pointerId: 1, button: 0 })); }`);
	await waitFor(v, `paneList().some(p => p.t === "lane:사아")`);
	expect(await ev(v, `paneCount()`)).toBe(4);
});

test("a pane head dragged onto the middle of another swaps the two; onto an edge it moves next to it", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await drag(v, "#split .pane:not(.on) .pane-hd .cv-hd-t", PANE("lane:가나"), 0.5, 0.5);
	await waitFor(v, `paneList().map(p => p.t).join() === "lane:가나,main"`);
	await split(v, "lane:다라");
	expect(await ids(v)).toEqual(["lane:가나", "main", "lane:다라"]);
	await run(v, `paneFocus(paneList().find(p => p.t === "lane:다라").id)`);
	await waitFor(v, `target === "lane:다라" && CV.placed`);
	await drag(v, "#split .pane:not(.on) .pane-hd .cv-hd-t", PANE("lane:다라"), 0.5, 0.97);
	await waitFor(v, `!!$("#split .pane-col")`);
	expect(await ev(v, `paneCount()`)).toBe(3);
});

test("⌥⌘\\ splits, ⌥⌘1 and ⌥⌘W work the panes, and ⌘\\ alone still folds the sidebar", async () => {
	const v = await open();
	await key(v, "Backslash", "altKey: true,");
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2`);
	expect(await ids(v)).toEqual(["main", "worklog"]);
	await key(v, "Digit1", "altKey: true,");
	await waitFor(v, `paneList()[0].active`);
	await key(v, "KeyW", "altKey: true,");
	await waitFor(v, `paneCount() === 1 && !document.querySelector("#split")`);
	expect(await ids(v)).toEqual(["worklog"]);

	expect(await ev(v, `document.documentElement.classList.contains("side-min")`)).toBe(false);
	await key(v, "Backslash");
	expect(await ev(v, `document.documentElement.classList.contains("side-min")`)).toBe(true);
	expect(await ev(v, `paneCount()`)).toBe(1);
});

test("a saved layout comes back by name after the panes are closed, and the palette offers it", async () => {
	const v = await open();
	expect(await ev(v, `paneLayoutItems("").map(i => i.label)`)).toEqual([]);
	await split(v, "lane:가나");
	await split(v, "lane:다라", "bottom");
	expect(await ev(v, `paneLayoutItems("").map(i => i.label)`)).toEqual(["배치 저장"]);
	await run(v, `paneLayoutSave("셋")`);
	expect(await ev(v, `Object.keys(JSON.parse(localStorage.getItem("dotz-pane-layouts")))`)).toEqual(["셋"]);
	await run(v, `while (paneCount() > 1) paneClose(paneList().find(p => !p.active).id)`);
	await waitFor(v, `paneCount() === 1 && !document.querySelector("#split")`);

	expect(await ev(v, `paneLayoutItems("").map(i => i.label)`)).toEqual(["배치: 셋", "배치 지우기: 셋"]);
	await run(v, `paneLayoutItems("").find(i => i.label === "배치: 셋").act()`);
	await waitFor(v, `paneCount() === 3 && document.querySelectorAll("#split .pane").length === 3 && CV.placed`);
	expect(await ids(v)).toHaveLength(3);
	await run(v, `paneLayoutItems("").find(i => i.label === "배치 지우기: 셋").act()`);
	expect(await ev(v, `Object.keys(paneLayouts())`)).toEqual([]);
});
