import { afterAll, expect, test } from "bun:test";
import { fakeHub, json } from "./test-web.ts";

// The browser's back button as the stack of what was showing (web/js/32-history-nav.js): a press beside the view (another tab, another item)
// stacks an entry, and back returns to the view that was showing. Real history.back() in a headless Bun.WebView against a small fake hub;
// every step awaits the popstate it caused and then the exact state, never a sleep.
const now = new Date().toISOString();
const MAIL = (n: number, subject: string) => ({ subject, from: "Alex <alex@example.com>", source: "fx", at: now, summary: "요약", n });
const hub = fakeHub({
	api: (_req, url) => {
		if (url.pathname === "/api/notices") return json({ items: [], unread: 0 });
		if (url.pathname === "/api/monitors") return json({ items: [] });
		if (url.pathname === "/api/integrations") return json({ items: [{ key: "mail", label: "메일", icon: "mail", conv: ["mail:"], unread: 0, notices: [] }] });
		if (url.pathname === "/api/conversations") return json({ items: Array.from({ length: 40 }, (_, i) => ({ target: `mail:fx-${i}`, unread: 0, last: { ts: now, text: `메일 ${i}`, from: "bot" }, mail: MAIL(i, `메일 ${i}`) })) });
	},
});
afterAll(() => hub.stop());

type V = InstanceType<typeof Bun.WebView>;
const until = (v: V, cond: string, what: string) => v.evaluate(`new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { let ok = false; try { ok = (${cond}); } catch {} if (ok) res(true); else if (Date.now() - t0 > 10000) rej(new Error(${JSON.stringify(what)})); else requestAnimationFrame(tick); }; tick(); })`);
const ev = async <T>(v: V, code: string) => JSON.parse((await v.evaluate(`JSON.stringify(${code})`)) as string) as T;
// history.back() and the popstate it causes, then the view the page settled on
const back = async (v: V) => {
	await v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no popstate")), 8000); addEventListener("popstate", () => { clearTimeout(t); res(true); }, { once: true }); history.back(); })`);
};
const tab = (v: V, k: string) => v.evaluate(`document.querySelector('#nav .ni[data-view="${k}"]').click()`);
const where = (v: V) => ev<{ cur: string; hash: string; len: number }>(v, `({ cur: current, hash: location.hash, len: history.length })`);
async function open(width: number, hash = "home") {
	const v = await hub.view({ width, height: 900 });
	await v.navigate(`${hub.origin}/`);
	await v.evaluate(`(localStorage.setItem("dotz-theme", "light"), true)`);
	await v.navigate(`${hub.origin}/?light#${hash}`);
	await until(v, `typeof go === "function" && typeof INTG !== "undefined" && CV.loaded && current === ${JSON.stringify(hash.split("/")[0])}`, "page not ready");
	return v;
}
const MAIL_LIST = "#monitoring/i%3Amail";

test("390: back after another tab returns to the mail item that was showing, then its list, then 홈", async () => {
	const v = await open(390);
	const len0 = (await where(v)).len;
	await tab(v, "monitoring");
	await until(v, `current === "monitoring"`, "monitoring not shown");
	await v.evaluate(`go("monitoring", "i:mail")`);
	await until(v, `current === "monitoring" && MON.sel === "i:mail" && location.hash === ${JSON.stringify(MAIL_LIST)} && document.querySelectorAll("#mon-tl .mr").length > 0`, "mail list not shown");
	await v.evaluate(`document.querySelector("#mon-tl .mr").click()`);
	await until(v, `current === "chat" && monCtx && location.hash.startsWith("#monitoring/c:")`, "mail not opened");
	const mailHash = (await where(v)).hash;
	await tab(v, "settings");
	await until(v, `current === "settings"`, "settings not shown");
	expect((await where(v)).len - len0).toBe(4);   // 모니터링, list, mail, 설정: one entry each, no entry twice for one press

	await back(v);
	await until(v, `current === "chat" && monCtx && location.hash === ${JSON.stringify(mailHash)}`, "back did not return to the mail");
	await back(v);
	await until(v, `current === "monitoring" && MON.sel === "i:mail" && location.hash === ${JSON.stringify(MAIL_LIST)}`, "back did not return to the mail list");
	await back(v);
	await until(v, `current === "monitoring" && MON.list`, "back did not return to the monitoring list");
	await back(v);
	await until(v, `current === "home"`, "back did not return to 홈");
	expect((await where(v)).len - len0).toBe(4);   // going back adds no entry
});

test("390: back after a tab keeps the list scroll of the screen that was showing", async () => {
	const v = await open(390, "monitoring/i:mail");
	await until(v, `current === "monitoring" && document.querySelectorAll("#mon-tl .mr").length === 40`, "mail list not drawn");
	const top = await ev<number>(v, `(() => { const s = [...document.querySelectorAll("#mon-tl .mr")][0].closest("#mon-timeline, .views, #v-monitoring") || document.scrollingElement; s.scrollTop = 600; return s.scrollTop; })()`);
	expect(top).toBeGreaterThan(0);
	await tab(v, "settings");
	await until(v, `current === "settings"`, "settings not shown");
	await back(v);
	await until(v, `current === "monitoring" && document.querySelectorAll("#mon-tl .mr").length === 40`, "list not back");
	expect(await ev<number>(v, `([...document.querySelectorAll("#mon-tl .mr")][0].closest("#mon-timeline, .views, #v-monitoring") || document.scrollingElement).scrollTop`)).toBe(top);
});

test("390: settings → 메신저 → Slack, back goes up one level at a time", async () => {
	const v = await open(390);
	await tab(v, "settings");
	await until(v, `current === "settings"`, "settings not shown");
	await v.evaluate(`go("messengers")`);
	await until(v, `current === "messengers"`, "messengers not shown");
	await v.evaluate(`go("slack")`);
	await until(v, `current === "slack"`, "slack not shown");
	await back(v);
	await until(v, `current === "messengers"`, "back did not return to the messengers");
	await back(v);
	await until(v, `current === "settings"`, "back did not return to the settings");
});

test("390: tab A → B → A, back returns to B then A; the same tab again adds no entry", async () => {
	const v = await open(390);
	await tab(v, "settings");
	await until(v, `current === "settings"`, "A not shown");
	await tab(v, "monitoring");
	await until(v, `current === "monitoring"`, "B not shown");
	await tab(v, "settings");
	await until(v, `current === "settings"`, "A not shown again");
	const len = (await where(v)).len;
	await tab(v, "settings");
	await until(v, `current === "settings"`, "A still shown");
	expect((await where(v)).len).toBe(len);
	await back(v);
	await until(v, `current === "monitoring"`, "back did not return to B");
	await back(v);
	await until(v, `current === "settings"`, "back did not return to A");
	await back(v);
	await until(v, `current === "home"`, "back did not return to 홈");
});

test("390: a sheet opened after a tab switch closes on back and leaves the screen; the next back is the screen before the tab", async () => {
	const v = await open(390);
	await tab(v, "monitoring");
	await until(v, `current === "monitoring"`, "monitoring not shown");
	await tab(v, "settings");
	await until(v, `current === "settings"`, "settings not shown");
	const before = await where(v);
	await v.evaluate(`window.__sheet = fsOpen({ label: "시험", cls: "mid" })`);
	await until(v, `!!document.querySelector(".fs-card")`, "sheet not open");
	await back(v);
	await until(v, `!document.querySelector(".fs-card") && current === "settings"`, "back did not close the sheet only");
	expect((await where(v)).hash).toBe(before.hash);
	await back(v);
	await until(v, `current === "monitoring"`, "back did not return to the screen before the tab");
});

test("390: reloading on an address opens the same screen, and back from it still lands on the screen before", async () => {
	const v = await open(390);
	await tab(v, "monitoring");
	await until(v, `current === "monitoring"`, "monitoring not shown");
	await tab(v, "settings");
	await until(v, `current === "settings"`, "settings not shown");
	const href = await ev<string>(v, `location.href`);
	await v.navigate(href);
	await until(v, `typeof go === "function" && CV.loaded && current === "settings"`, "reload did not open the same screen");
});

test("installed app: back from 홈 stays on the exit guard instead of leaving", async () => {
	const v = await open(390);
	await v.evaluate(`(Object.defineProperty(navigator, "standalone", { value: true, configurable: true }), history.replaceState(null, "", "#home"), histSeed(), true)`);
	await until(v, `history.state && history.state.dz && !history.state.g`, "home entry not seeded");
	await back(v);
	await until(v, `history.state && history.state.g === 1 && current === "home"`, "back from 홈 did not stop on the guard");
});

type St = { cur: string; hash: string; tgt: string; mon: string; n: number };
const state = (v: V) => ev<St>(v, `({ cur: current, hash: location.hash, tgt: target, mon: monCtx, n: history.state.c.length })`);
const press = (sel: string) => `(document.querySelector(${JSON.stringify(sel)}).click(), true)`;
const MR = (i: number) => `(document.querySelectorAll("#mon-tl .mr")[${i}].click(), true)`;
const mailOpen = (prev: St) => `current === "chat" && monCtx.startsWith("mail:") && target === monCtx && location.hash.startsWith("#monitoring/c:") && location.hash !== ${JSON.stringify(prev.hash)}`;

// The chat list's and the mail list's rows and the 홈 tab are presses beside the view like any other: each stacks one entry on a wide screen
// too, and the conversation an entry shows is its own (a mail never shows in the chat tab's entry, nor the chat's in 모니터링's).
for (const width of [390, 1280]) test(`${width}: every press beside or below the view stacks one entry (a list's other row and the 홈 tab too), and as many backs return through each view with its own conversation`, async () => {
	const v = await open(width);
	const wide = width >= 1100;
	const steps: [string, (prev: St) => string][] = [
		...(wide ? [
			[press('#nav .ni[data-view="chat"]'), () => `current === "chat" && monCtx === "" && target === "main" && location.hash === "#chat/main" && !!document.querySelector('.cv-row[data-t="worklog"]')`],
			[press('.cv-row[data-t="worklog"]'), () => `current === "chat" && monCtx === "" && target === "worklog" && location.hash === "#chat/worklog"`],
		] as [string, (prev: St) => string][] : []),
		[press('#nav .ni[data-view="monitoring"]'), () => `current === "monitoring" && location.hash === "#monitoring"`],
		[`(go("monitoring", "i:mail"), true)`, () => `location.hash === ${JSON.stringify(MAIL_LIST)} && document.querySelectorAll("#mon-tl .mr").length > 1`],
		[MR(0), mailOpen],
		...(wide ? [[MR(1), mailOpen] as [string, (prev: St) => string]] : []),
		[press('#nav .ni[data-view="home"]'), () => `current === "home" && location.hash === "#home"`],
		[press('#nav .ni[data-view="settings"]'), () => `current === "settings"`],
		[press('#nav .ni[data-view="home"]'), () => `current === "home" && location.hash === "#home"`],
	];
	const seen = [await state(v)];
	for (const [run, cond] of steps) {
		await v.evaluate(run);
		await until(v, cond(seen[seen.length - 1]), `step ${seen.length} not reached`);
		seen.push(await state(v));
		expect(seen[seen.length - 1].n).toBe(seen.length);   // one entry for one press
	}
	for (let i = seen.length - 2; i >= 0; i--) {
		const s = seen[i];
		await back(v);
		await until(v, `current === ${JSON.stringify(s.cur)} && location.hash === ${JSON.stringify(s.hash)} && monCtx === ${JSON.stringify(s.mon)} && history.state.c.length === ${s.n}${s.cur === "chat" ? ` && target === ${JSON.stringify(s.tgt)}` : ""}`, `back ${seen.length - 1 - i} did not return to ${s.hash}`);
	}
});
