import { afterAll, expect, test } from "bun:test";
import { fakeHub, on } from "./test-web.ts";

// On a phone the toast sits above whatever fixed bar the screen has at the bottom: the tab bar, or the composer inside a conversation.
const hub = fakeHub({ stream: "fake" });
afterAll(() => hub.stop());
const view = await hub.view({ width: 390, height: 844 });
const { waitFor } = on(view);
const opened = hub.nextStream();
await view.navigate(`${hub.origin}/`);
await opened;
await waitFor(`typeof openTarget === "function" && S && NT.loaded`);

const RECTS = (bar: string) => `JSON.stringify((() => { const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }; return { snack: box(".snack"), bar: box(${JSON.stringify(bar)}) }; })())`;
type Box = { top: number; bottom: number; left: number; right: number };
const apart = async (bar: string) => {
	const { snack, bar: b } = JSON.parse((await view.evaluate(RECTS(bar))) as string) as { snack: Box; bar: Box };
	return snack.bottom <= b.top || snack.top >= b.bottom;
};
const toastAt = async (go: string, ready: string, before = "") => {
	await view.evaluate(`(${go}, 0)`);
	await waitFor(ready);
	if (before) await view.evaluate(`(${before}, 0)`);
	await view.evaluate(`Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))).then(() => 0)`);
	await view.evaluate(`(toast("저장했어요"), 0)`);
	await waitFor(`!!document.querySelector(".snack")`);
	await view.evaluate(`Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))).then(() => 0)`);
};

test("in a conversation the toast does not cover the composer", async () => {
	await toastAt(`openTarget("main", "chat")`, `current === "chat" && CV.placed && document.querySelector("#composer").getBoundingClientRect().height > 0`);
	expect(await apart("#composer")).toBe(true);
});

// The line the app draws above the composer while subagents run (renderSubs); the toast must clear it too, mail threads share this view.
const SUBS_LINE = `(() => { const box = document.querySelector("#v-chat > .subs"); box.hidden = false; box.replaceChildren(el("button", { class: "subsum", type: "button" }, el("span", { class: "nm", text: "서브에이전트 2개 진행 중" }))); })()`;

test("in a conversation the toast does not cover the subagent line above the composer", async () => {
	await toastAt(`openTarget("main", "chat")`, `current === "chat" && CV.placed && document.querySelector("#composer").getBoundingClientRect().height > 0`, SUBS_LINE);
	await waitFor(`document.querySelector("#v-chat > .subs .subsum").getBoundingClientRect().height > 0`);
	expect(await apart("#v-chat > .subs .subsum")).toBe(true);
	expect(await apart("#composer")).toBe(true);
});

test("on a screen with the tab bar the toast stays above the tab bar", async () => {
	await toastAt(`go("home")`, `current === "home" && document.querySelector("#nav").getBoundingClientRect().height > 0`);
	expect(await apart("#nav")).toBe(true);
});
