import { afterAll, expect, test } from "bun:test";
import { ev, fakeHub, idleState, json, run, waitFor } from "./test-web.ts";
import { SPLIT_SHOTS } from "./split-shots.ts";

// Split panes (web/js/43-panes*.js) on a wide window: the second pane puts #split in place of the one section, the active pane holds the real
// #v-chat, the others are mirrors; the divider resizes, a closed pane gives the page back, an event for a pane that is not active lands in its mirror.
const at = (i: number) => new Date(Date.UTC(2026, 9, 20, 1, i)).toISOString();
const lane = (name: string) => ({ name, status: "working", live: true, session: name });
const history = (target: string) => Array.from({ length: 6 }, (_, i) => ({ ts: at(i), kind: "out", source: "orchestrator", target, text: `${target} 답변 ${i}` }));
const hub = fakeHub({
	stream: "fake",
	state: () => idleState({ lanes: [lane("가나"), lane("다라")] }),
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

const open = async () => {
	const v = await hub.view({ width: 1280, height: 800 }, "/#chat");
	await waitFor(v, `target === "main" && CV.placed && tl.querySelectorAll(".bm").length >= 1`);
	return v;
};
const split = async (v: Awaited<ReturnType<typeof open>>, t: string, side = "right") => {
	await run(v, `paneSplit(${JSON.stringify(t)}, "chat", ${JSON.stringify(side)})`);
	await waitFor(v, `document.querySelectorAll("#split .pane").length === paneCount() && document.querySelector("#split .pane.on") && CV.placed`);
};

test("the second pane builds #split, the third splits the active one, a full set refuses a fifth", async () => {
	const v = await open();
	expect(await ev(v, `paneCount()`)).toBe(0);
	expect(await ev(v, `!document.querySelector("#split")`)).toBe(true);

	await split(v, "lane:가나");
	expect(await ev(v, `paneList().map(p => [p.t, p.active])`)).toEqual([["main", false], ["lane:가나", true]]);
	expect(await ev(v, `[document.querySelectorAll("#v-chat").length, document.querySelectorAll("#text").length, $("#split").contains($("#v-chat")), $("#split").contains(convSide)]`)).toEqual([1, 1, true, true]);
	expect(await ev(v, `target`)).toBe("lane:가나");
	expect(await ev(v, `$("#split .pane:not(.on) .pane-hd .cv-hd-t").textContent.trim()`)).toBe(await ev(v, `targetName("main")`));
	expect(await ev(v, `$("#split .pane:not(.on) .pane-tl").textContent.includes("main 답변 5")`)).toBe(true);

	await split(v, "lane:다라", "bottom");
	expect(await ev(v, `paneCount()`)).toBe(3);
	expect(await ev(v, `!!$("#split .pane-col")`)).toBe(true);
	expect(await ev(v, `paneSplit("alert", "chat", "right")`)).toBe("p4");
	expect(await ev(v, `paneSplit("worklog", "chat", "right")`)).toBe("");
	expect(await ev(v, `paneCount()`)).toBe(4);
	expect(SPLIT_SHOTS.map(s => s.name)).toEqual(["drag", "two", "three", "four"]);
});

test("a pane that is already open takes the focus instead of a second copy", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await run(v, `paneSplit("main", "chat", "right")`);
	await waitFor(v, `target === "main" && $("#split .pane.on").dataset.id === paneList().find(p => p.t === "main").id`);
	expect(await ev(v, `paneCount()`)).toBe(2);
	expect(await ev(v, `paneReplace(paneList().find(p => !p.active).id, "lane:다라", "chat")`)).toBe(true);
	await waitFor(v, `paneList().some(p => p.t === "lane:다라") && $("#split .pane:not(.on) .cv-hd-t").textContent.includes(targetName("lane:다라"))`);
});

test("the divider resizes within its limits and a double click makes it half and half", async () => {
	const v = await open();
	await split(v, "lane:가나");
	const share = `(() => { const [a, b] = [...$("#split .pane-row").children].filter(n => n.classList.contains("pane")).map(n => n.getBoundingClientRect().width); return a / (a + b); })()`;
	expect(Math.abs((await ev<number>(v, share)) - 0.5)).toBeLessThan(0.02);
	await run(v, `const bar = $("#split .pane-bar"), r = bar.getBoundingClientRect(), y = r.top + r.height / 2;
		const fire = (type, x) => bar.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
		bar.setPointerCapture = () => {};
		fire("pointerdown", r.left + r.width / 2); fire("pointermove", r.left - 150); fire("pointerup", r.left - 150);`);
	const moved = await ev<number>(v, share);
	expect(moved).toBeLessThan(0.45);
	expect(moved).toBeGreaterThanOrEqual(0.2);
	await run(v, `$("#split .pane-bar").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
	await waitFor(v, `Math.abs((${share}) - 0.5) < 0.02`);
});

test("closing the panes gives the page back as it was", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await run(v, `paneClose(paneList().find(p => !p.active).id)`);
	await waitFor(v, `!document.querySelector("#split")`);
	expect(await ev(v, `[paneCount(), $("#views").contains($("#v-chat")), $("#v-chat").contains(convSide), $("#v-chat").classList.contains("in-pane"), current, target]`)).toEqual([1, true, true, false, "chat", "lane:가나"]);
	expect(await ev(v, `$("#v-chat").hidden`)).toBe(false);
});

test("a message for a pane that is not active lands in its mirror; a notice for it is its head dot, not a toast", async () => {
	const connected = hub.nextStream();
	const v = await open();
	await connected;
	await split(v, "lane:가나");
	hub.push({ ts: at(30), kind: "out", source: "orchestrator", target: "main", text: "새 소식입니다" });
	await waitFor(v, `$("#split .pane:not(.on) .pane-tl").textContent.includes("새 소식입니다")`);
	await run(v, `paneFocus(paneList().find(p => p.t === "main").id)`);
	await waitFor(v, `target === "main" && CV.placed && tl.textContent.includes("새 소식입니다")`);
	hub.push({ ts: new Date().toISOString(), kind: "lane_report", lane: "가나", tone: "err", text: "확인이 필요해요" });
	await waitFor(v, `!$("#split .pane:not(.on) .pane-hd .dot").hidden`);
	expect(await ev(v, `$("#split .pane:not(.on) .pane-hd .dot").className`)).toContain("err");
	expect(await ev(v, `!document.querySelector(".ntf")`)).toBe(true);
});

test("the layout survives a reload; a narrow window shows the one section again", async () => {
	const v = await open();
	await split(v, "lane:가나");
	await v.navigate(`${hub.origin}/?again#chat`);
	await waitFor(v, `paneCount() === 2 && document.querySelectorAll("#split .pane").length === 2`);
	await v.resize(800, 800);
	await waitFor(v, `!document.querySelector("#split") && $("#views").contains($("#v-chat"))`);
	await v.resize(1280, 800);
	await waitFor(v, `document.querySelectorAll("#split .pane").length === 2`);
});
