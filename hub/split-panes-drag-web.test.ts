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
// A new pane grows in from nothing (43-panes-motion.js): the next drag aims at the panes once they stand still.
const SETTLED = `[...document.querySelectorAll("#split .pane, #split .pane-row, #split .pane-col")].every(n => !n.getAnimations().length)`;
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
	expect(await ev(v, `document.body.classList.contains("pn-drag")`)).toBe(false);
	await waitFor(v, `!document.querySelector(".pn-zone, .pn-ghost")`);
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

test("two panes are the most: a third dropped on a pane's edge replaces the pane it lands on, and the ghost says so inside the window", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await drag(v, ROW("lane:다라"), PANE("lane:가나"), 0.97, 0.5, false);
	await waitFor(v, `PD && PD.hit && PD.hit.side === "center" && PD.hit.full`);
	expect(await ev(v, `$(".pn-ghost .pn-gh").textContent`)).toBe("칸은 2개까지라 이 칸을 바꿔요");
	// at the window's right edge the ghost, hint line included, flips to the pointer's left
	expect(await ev(v, `$(".pn-ghost").getBoundingClientRect().right <= innerWidth`)).toBe(true);
	await run(v, `{ const r = PD.hit.r; document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + r.width * 0.97, clientY: r.top + r.height / 2, pointerId: 1, button: 0 })); }`);
	await waitFor(v, `paneList().some(p => p.t === "lane:다라")`);
	expect(await ids(v)).toEqual(["main", "lane:다라"]);
	expect(await ev(v, `[paneSplit("lane:마바", "chat", "right"), paneCount()]`)).toEqual(["", 2]);
});

test("nothing splits up or down: the bottom edge of a pane is its middle, and a split asked for below goes to the right", async () => {
	const v = await open();
	await drag(v, ROW("lane:가나"), ONE, 0.5, 0.97, false);
	await waitFor(v, `PD && PD.hit`);
	expect(await ev(v, `[PD.hit.side, $(".pn-ghost .pn-gh").textContent]`)).toEqual(["center", "여기서 열기"]);
	await run(v, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0 }))`);
	await waitFor(v, `!document.querySelector(".pn-ghost, .pn-zone")`);
	await split(v, "lane:가나", "bottom");
	expect(await ev(v, `[PN.root.dir, !!$("#split .pane-col"), !!$("#split .pane-row")]`)).toEqual(["row", false, true]);
	expect(await ids(v)).toEqual(["main", "lane:가나"]);
});

test("a menu tab is only pressed, never dragged; `앱 관리` says a pane cannot hold it; the 모니터링 screen is an app pane with a head", async () => {
	const v = await open();
	await run(v, `go("chat", "lane:가나")`);
	await waitFor(v, `target === "lane:가나" && CV.placed`);
	await drag(v, `#nav .ni[data-view="home"]`, ONE, 0.95, 0.5, false);
	expect(await ev(v, `[!!PD, !!document.querySelector(".pn-ghost, .pn-zone"), current]`)).toEqual([false, false, "chat"]);
	await run(v, `document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0 }))`);

	// 앱 관리 (30-monitoring.js monRows add-app) opens a sheet. On the body, where no list repaint takes it away.
	await run(v, `document.body.append(el("button", { class: "cv-row pv", type: "button", "data-k": "add-app", id: "add-test", style: "position: fixed; left: 300px; top: 300px; width: 200px" }, el("span", { class: "cv-b" }, el("span", { class: "cv-n", text: "앱 관리" }))))`);
	await drag(v, "#add-test", ONE, 0.95, 0.5, false);
	await waitFor(v, `!!document.querySelector(".pn-ghost.no")`);
	expect(await ev(v, `[$(".pn-ghost .pn-gt").textContent, $(".pn-ghost .pn-gh").textContent, !!document.querySelector(".pn-zone"), document.body.classList.contains("pn-no")]`)).toEqual(["앱 관리", "칸에 넣을 수 없어요", false, true]);
	await run(v, `document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0 })); $("#add-test").remove()`);
	await waitFor(v, `!document.querySelector(".pn-ghost")`);
	expect(await ev(v, `[paneCount(), current]`)).toEqual([0, "chat"]);

	await run(v, `paneSplit("list", "app", "right")`);
	await waitFor(v, `paneCount() === 2 && current === "monitoring" && !!$("#split .pane.on > .pane-hd") && $("#split .pane.on").contains($("#v-monitoring")) && $("#split .pane-side").contains(convSide)`);
	expect(await ev(v, `[paneList().map(p => p.kind + ":" + p.t), $("#split .pane.on > .pane-hd .cv-hd-t").textContent]`)).toEqual([["chat:lane:가나", "app:list"], "모니터링"]);
	await run(v, `paneFocus(paneList()[0].id)`);
	await waitFor(v, `current === "chat" && $("#v-monitoring").parentNode === $("#views") && !!$("#split .pane[data-kind='app'] .pane-mir")`);
	await run(v, `go("monitoring")`);
	await waitFor(v, `current === "monitoring" && paneList().find(p => p.active).kind === "app"`);
});
test("a KakaoTalk room of the chat list drops as an in-app pane: 모니터링 opens on 카카오톡 with that room", async () => {
	const v = await open();
	// a 미답장 room of the chat list (31-conversations.js: k "w:kk:<chatId>"). On the body, where no list repaint takes it away.
	await run(v, `document.body.append(el("button", { class: "cv-row pv", type: "button", "data-k": "w:kk:77", id: "kk-room", style: "position: fixed; left: 300px; top: 300px; width: 200px" }, el("span", { class: "cv-b" }, el("span", { class: "cv-n", text: "가족방" }))))`);
	await drag(v, "#kk-room", ONE, 0.95, 0.5, false);
	await waitFor(v, `PD && PD.hit && PD.hit.side === "right"`);
	expect(await ev(v, `[PD.src.kind, PD.src.t, $(".pn-ghost .pn-gh").textContent]`)).toEqual(["app", "i:kakao#kk:77", "오른쪽에 새 칸"]);
	await run(v, `{ const r = PD.hit.r; document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.right - 4, clientY: r.top + r.height / 2, pointerId: 1, button: 0 })); $("#kk-room").remove(); }`);
	await waitFor(v, `paneCount() === 2 && current === "monitoring" && MON.sel === "i:kakao" && $("#split .pane.on").contains($("#v-monitoring"))`);
	expect(await ev(v, `paneList().map(p => p.kind + ":" + p.t + (p.active ? "*" : ""))`)).toEqual(["chat:main", "app:i:kakao#kk:77*"]);
});

test("a drop opens the new pane by growing it from nothing and a cancel sends the ghost back; with reduced motion both are instant", async () => {
	const v = await open();
	await drag(v, ROW("lane:다라"), ONE, 0.97, 0.5, false);
	await waitFor(v, `PD && PD.hit && PD.hit.side === "right"`);
	await run(v, `{ const r = PD.hit.r; document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.right - 4, clientY: r.top + r.height / 2, pointerId: 1, button: 0 })); }`);
	expect(await ev(v, `(() => { const n = $("#split .pane[data-id='" + paneList().find(p => p.t === "lane:다라").id + "']"); return n.getAnimations().map(a => a.effect.getKeyframes()[0].flexGrow); })()`)).toEqual(["0"]);
	await waitFor(v, `!document.querySelector(".pn-ghost") && ${SETTLED}`);
	await drag(v, ROW("lane:마바"), PANE("main"), 0.5, 0.5, false);
	await waitFor(v, `PD && PD.hit`);
	await run(v, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);
	expect(await ev(v, `document.querySelector(".pn-ghost").getAnimations().some(a => Number(a.effect.getKeyframes().at(-1).opacity) === 0 && /translate/.test(a.effect.getKeyframes().at(-1).transform))`)).toBe(true);
	await run(v, `document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0 }))`);
	await waitFor(v, `!document.querySelector(".pn-ghost, .pn-zone")`);

	await run(v, `{ const real = window.matchMedia.bind(window); window.matchMedia = q => q.includes("reduced-motion") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q); }`);
	await drag(v, ROW("lane:마바"), PANE("main"), 0.5, 0.5, false);
	await waitFor(v, `PD && PD.hit && PD.hit.side === "center"`);
	expect(await ev(v, `document.querySelector(".pn-ghost").getAnimations().length + document.querySelector(".pn-zone").getAnimations().length`)).toBe(0);
	await run(v, `{ const r = PD.hit.r; document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, button: 0 })); }`);
	expect(await ev(v, `[paneCount(), paneList().map(p => p.t).join(), [...document.querySelectorAll("#split .pane, #split .pane-row")].flatMap(n => n.getAnimations()).length, !!document.querySelector(".pn-ghost, .pn-zone")]`)).toEqual([2, "lane:마바,lane:다라", 0, false]);
});

test("a pane head dragged onto another swaps the two, even at its bottom edge, and a third pane is refused", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await drag(v, "#split .pane:not(.on) .pane-hd .cv-hd-t", PANE("lane:가나"), 0.5, 0.5);
	await waitFor(v, `paneList().map(p => p.t).join() === "lane:가나,main"`);
	expect(await ev(v, `paneSplit("lane:다라", "chat", "right")`)).toBe("");
	// the dragged head's pane became the active one: now the other (lane:가나) goes onto the bottom edge of main
	await waitFor(v, SETTLED);
	await drag(v, "#split .pane:not(.on) .pane-hd .cv-hd-t", PANE("main"), 0.5, 0.97);
	await waitFor(v, `paneList().map(p => p.t).join() === "main,lane:가나"`);
	expect(await ev(v, `[paneCount(), !!$("#split .pane-col")]`)).toEqual([2, false]);
});

test("⌥⌘\\ splits, ⌥⌘1 and ⌥⌘W work the panes, and ⌘\\ alone still folds the sidebar", async () => {
	const v = await open();
	await key(v, "Backslash", "altKey: true,");
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2`);
	expect(await ids(v)).toEqual(["main", "worklog"]);
	await key(v, "Backslash", "altKey: true,");
	expect(await ev(v, `paneCount()`)).toBe(2);
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

test("Ctrl+Shift+\\ splits without Alt, which AltGr layouts send as Ctrl+Alt; the screen tour lists the pane keys", async () => {
	const v = await open();
	await run(v, `document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backslash", key: "|", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2`);
	expect(await ids(v)).toEqual(["main", "worklog"]);
	expect(await ev(v, `document.documentElement.classList.contains("side-min")`)).toBe(false);
	expect(await ev(v, `introKeys().slice(-3).map(k => k[1])`)).toEqual(["칸 나누기", "칸 이동", "칸 닫기"]);
});

test("a saved layout comes back by name after the panes are closed, and the palette offers it", async () => {
	const v = await open();
	expect(await ev(v, `paneLayoutItems("").map(i => i.label)`)).toEqual([]);
	await split(v, "lane:가나");
	expect(await ev(v, `paneLayoutItems("").map(i => i.label)`)).toEqual(["배치 저장"]);
	await run(v, `paneLayoutSave("셋")`);
	expect(await ev(v, `Object.keys(JSON.parse(localStorage.getItem("dotz-pane-layouts")))`)).toEqual(["셋"]);
	await run(v, `while (paneCount() > 1) paneClose(paneList().find(p => !p.active).id)`);
	await waitFor(v, `paneCount() === 1 && !document.querySelector("#split")`);

	expect(await ev(v, `paneLayoutItems("").map(i => i.label)`)).toEqual(["배치: 셋", "배치 지우기: 셋"]);
	await run(v, `paneLayoutItems("").find(i => i.label === "배치: 셋").act()`);
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2 && CV.placed`);
	expect(await ids(v)).toEqual(["main", "lane:가나"]);
	await run(v, `paneLayoutItems("").find(i => i.label === "배치 지우기: 셋").act()`);
	expect(await ev(v, `Object.keys(paneLayouts())`)).toEqual([]);
});

test("a layout saved with four panes, two above two, opens as its first two side by side", async () => {
	const v = await open();
	const leaf = (id: string, t: string) => ({ id, kind: "chat", t });
	const four = { root: { dir: "col", a: { dir: "row", a: leaf("p1", "main"), b: leaf("p2", "lane:가나"), r: 0.3 }, b: { dir: "row", a: leaf("p3", "lane:다라"), b: leaf("p4", "lane:마바"), r: 0.5 }, r: 0.5 }, active: "p3" };
	await run(v, `localStorage.setItem("dotz-pane-layouts", ${JSON.stringify(JSON.stringify({ 넷: four }))}); paneLayoutItems("").find(i => i.label === "배치: 넷").act()`);
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2 && CV.placed`);
	expect(await ev(v, `[paneList().map(p => p.t + (p.active ? "*" : "")), PN.root.dir, PN.root.r, !!$("#split .pane-col")]`)).toEqual([["main*", "lane:가나"], "row", 0.3, false]);
});
