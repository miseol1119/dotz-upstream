// Result chips on finished rows (web/js/08-home.js resultChips, 19-project-main.js): a finished job that names a file, a commit and a link shows
// three chips under its row (홈 작업내역, 최근 끝난 작업, the project's 완료 and 결과 rows), each opening its own target; one that names none shows nothing.
import { afterAll, expect, test } from "bun:test";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

const ago = (min: number) => Date.now() - min * 60_000;
const agoIso = (min: number) => new Date(ago(min)).toISOString();
const FILE = { path: "/tmp/result-chips/공지 초안.pdf", name: "공지 초안.pdf", size: 2048 };
const COMMIT = { kind: "commit", hash: "00a4484c", url: "https://github.com/acme/site/commit/00a4484c1111111111111111111111111111aaaa" };
const LINK = { kind: "link", url: "https://github.com/acme/site/releases/tag/v1" };
const MADE = { files: [FILE], links: [COMMIT, LINK] };
const WORK = [
	{ id: "st_made", description: "배포 공지 다듬기", status: "done", started_at: ago(30), ended_at: ago(20), ...MADE },
	{ id: "st_none", description: "메일 분류", status: "done", started_at: ago(30), ended_at: ago(25) },
];
const LANES = [
	{ name: "docs", title: "공문 양식 읽기", status: "idle", startedAt: agoIso(60), lastText: "끝났어요" },
	{ name: "plain", title: "로그 훑기", status: "idle", startedAt: agoIso(60), lastText: "끝났어요" },
];
const RUNS = { "lane:docs": { kind: "done", since: agoIso(5) }, "lane:plain": { kind: "done", since: agoIso(6) } };
const note = (id: string, kind: string, key: string, title: string, extra = {}) => ({ id, kind, tone: "done", title, text: `${title} 끝났어요`, open: key, key, read: true, ts: agoIso(5), ...extra });
const NOTICES = [note("n1", "result", "lane:docs", "공문 양식 읽기", MADE), note("n2", "result", "lane:plain", "로그 훑기"), note("n3", "worklog", "w3", "배포 마무리", MADE), note("n4", "worklog", "w4", "메일 정리")];
const json = (v: unknown) => Response.json(v);
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	idleTimeout: 0,
	fetch(req) {
		const url = new URL(req.url), p = url.pathname;
		if (p === "/") return indexPage(req);
		const asset = appAsset(req, p);
		if (asset) return asset;
		if (p === "/api/events") return sseResponse(req.headers.get("last-event-id") ?? url.searchParams.get("last"));
		if (p === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle", lastText: "ok" }, lanes: LANES, terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0, work: WORK, convs: [], work_now: Date.now(), runs: RUNS });
		if (p === "/api/notices") return json({ unread: 0, items: NOTICES });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/todo") return json({ phases: [] });
		return p.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});

type View = InstanceType<typeof Bun.WebView>;
const views: View[] = [];
afterAll(() => { for (const v of views) v.close(); server.stop(true); });
const waitFor = (v: View, expr: string, ms = 10_000) =>
	v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout: " + ${JSON.stringify(expr)})), ${ms}); const tick = () => { let ok = false; try { ok = !!(${expr}); } catch {} if (ok) { clearTimeout(t); res(true); } else requestAnimationFrame(tick); }; tick(); })`);
const q = async <T>(v: View, body: string): Promise<T> => JSON.parse(String(await v.evaluate(`JSON.stringify((() => { ${body} })())`))) as T;
// Each chip under a row: its name, its meta word and where it goes.
const CHIPS = `const chips = box => box ? [...box.querySelectorAll(".hrx-f .fatt")].map(c => ({ n: c.querySelector(".fi-n").textContent, m: c.querySelector(".fi-m").textContent, href: c.getAttribute("href"), tab: c.getAttribute("target") })) : null;`;
const boot = async () => {
	const v = new Bun.WebView({ width: 1280, height: 900 });
	views.push(v);
	await v.navigate(`http://127.0.0.1:${server.port}/#home`);
	await waitFor(v, `document.querySelector('[data-k="ended-work"]') && document.querySelector('.bi[data-id="notices:worklog"] .hc-row')`);
	return v;
};
const expectThree = (c: { n: string; m: string; href: string | null; tab: string | null }[] | null) => {
	expect(c?.map(x => x.n)).toEqual(["공지 초안.pdf", "00a4484c", "github.com/tag/v1"]);
	expect(c!.slice(1).map(x => x.m)).toEqual(["커밋", "링크"]);
	expect(c![0]!.href).toContain(encodeURIComponent(FILE.path));
	expect(c!.map(x => x.tab)).toEqual(["_blank", "_blank", "_blank"]);
	expect(c![1]!.href).toBe(COMMIT.url);
	expect(c![2]!.href).toBe(LINK.url);
};

test("home: a finished task, a finished session and a 작업내역 row with results show three chips; the others none", async () => {
	const v = await boot();
	const r = await q<Record<string, ReturnType<typeof Array.prototype.slice> | null>>(v, `${CHIPS}
		const ended = document.querySelector('[data-k="ended-work"]'), log = document.querySelector('.bi[data-id="notices:worklog"]');
		const lane = n => ended.querySelector('[data-t="lane:' + n + '"]'), work = id => ended.querySelector('[data-work="' + id + '"]');
		const row = t => [...log.querySelectorAll(".hc-row")].find(x => x.textContent.includes(t));
		return { work: chips(work("st_made")), workNone: chips(work("st_none")), lane: chips(lane("docs")?.closest(".hrx") ?? null), laneNone: chips(lane("plain")),
			log: chips(row("배포 마무리")), logNone: chips(row("메일 정리")) };`);
	for (const k of ["work", "lane", "log"]) expectThree(r[k] as never);
	expect([r.workNone, r.laneNone, r.logNone]).toEqual([[], [], []]);
});

test("project detail: a finished task's 완료 row and a session's result row show three chips; a row with none shows nothing", async () => {
	const v = await boot();
	const r = await q<Record<string, unknown>>(v, `${CHIPS}
		const report = lane => ({ kind: "report", at: "${agoIso(5)}", lane, tone: "done", title: "확인됨", text: "", verified: true });
		const box = n => { const d = document.createElement("div"); d.append(n); return d; };
		return { work: chips(box(pmWorkRow(S.work[0]))), workNone: chips(box(pmWorkRow(S.work[1]))), report: chips(box(pmResultRow(report("docs")))), reportNone: chips(box(pmResultRow(report("plain")))), reportOld: chips(box(pmResultRow({ ...report("docs"), at: "${agoIso(120)}" }))),
			commitNone: chips(box(pmResultRow({ kind: "commit", at: "${agoIso(9)}", title: "고침", hash: "abc1234" }))),
			past: chips(pmRecent([{ name: "docs", title: "공문 양식 읽기", at: ${ago(5)} }], [])) };`);
	for (const k of ["work", "report", "past"]) expectThree(r[k] as never);
	expect([r.workNone, r.reportNone, r.reportOld, r.commitNone]).toEqual([[], [], [], []]);
});
