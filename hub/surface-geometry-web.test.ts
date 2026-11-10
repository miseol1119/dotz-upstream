import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { painted, startDemoServer, waitFor, type View } from "./layout-measure.ts";

// Geometry and value checks for the plain bugs a full golden-rule pass found, one group per shared cause. Each opens the real page on the demo server
// (fake data only) in a headless Bun.WebView and measures rects or computed values, never copy. Screenshots are written only when SURFACE_SHOTS names a
// folder (SURFACE_PREFIX = before | after).
const SHOTS = process.env.SURFACE_SHOTS;
const PREFIX = process.env.SURFACE_PREFIX ?? "after";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const NAME = "서울 한가운데 있는 아주 오래된 가짜 회사 이름을 일부러 한 줄이 넘도록 길게 적은 이름이에요 그래서 줄이 바뀌어야 해요";
const TOKEN = "가나다라마바사아자차카타파하".repeat(7) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";

const server = startDemoServer({ now: Date.UTC(2026, 10, 9, 3) });
const views: View[] = [];
afterEach(() => { for (const v of views.splice(0)) v.close(); });
afterAll(() => { for (const v of views) v.close(); server.stop(); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => {
	if (!SHOTS) return;
	await painted(v);
	await Bun.write(join(SHOTS, `${PREFIX}-${name}.png`), await v.screenshot());
};
// The demo page at a width and theme, then `open` (a page-side statement) and a `ready` expression to wait on.
const page = async (width: number, theme: "light" | "dark", open: string, ready: string): Promise<View> => {
	const v = new Bun.WebView({ width, height: width < 600 ? 844 : 800 });
	views.push(v);
	await v.navigate(`${server.origin}/?lm=${Math.random().toString(36).slice(2)}#home`);
	await waitFor(v, `typeof S !== "undefined" && S && typeof target === "string" && CV.loaded && NT.loaded`);
	await v.evaluate(`(() => { localStorage.setItem("dotz-theme", ${JSON.stringify(theme)}); document.documentElement.dataset.theme = ${JSON.stringify(theme)}; return 0; })()`);
	await v.evaluate(`void (${open})`);
	await waitFor(v, ready);
	await painted(v);
	return v;
};

/* 1. menu item secondary text (.mi .ml small) */
const MENU_ITEMS = JSON.stringify([{ value: "a", label: NAME, sub: NAME }, { value: "b", label: TOKEN, sub: "설명" }, { value: "c", label: "셋째 항목", sub: TOKEN }, { value: "d", label: "넷째 항목" }]);
const openMenu = (w: number, theme: "light" | "dark") => page(w, theme, `showMenu($("#title"), ${MENU_ITEMS}, { onPick() {} })`, `document.querySelectorAll(".menu .mi").length === 4`);
type MenuGeo = { items: { label: number; smallIn: boolean; overlap: boolean }[] };
const menuGeo = (v: View) => q<MenuGeo>(v, `
	const menu = document.querySelector(".menu"), mr = menu.getBoundingClientRect();
	const items = [...menu.querySelectorAll(".mi")].map(mi => {
		const ml = mi.querySelector(".ml"), small = ml.querySelector("small");
		const rng = document.createRange(); rng.selectNodeContents(ml.firstChild);
		const lines = [...rng.getClientRects()], widest = Math.max(...lines.map(r => r.width));
		if (!small) return { label: widest, smallIn: true, overlap: false };
		const s = small.getBoundingClientRect();
		return { label: widest, smallIn: s.left >= mr.left - 1 && s.right <= mr.right + 1 && s.right <= innerWidth + 1,
			overlap: lines.some(r => r.left < s.right - 1 && r.right > s.left + 1 && r.top < s.bottom - 1 && r.bottom > s.top + 1) };
	});
	return { items };`);
test("390px: a menu item with long secondary text keeps its label readable, clear of the secondary text and inside the menu", async () => {
	const v = await openMenu(390, "light");
	await shot(v, "1-menu-long");
	const g = await menuGeo(v);
	expect(g.items.map(i => i.smallIn)).toEqual([true, true, true, true]);
	expect(g.items.map(i => i.overlap)).toEqual([false, false, false, false]);
	expect(g.items.map(i => i.label >= 48)).toEqual([true, true, true, true]);
});
const ratio = (v: View) => q<{ small: number; hover: number }>(v, `
	const probe = document.createElement("i"); document.body.append(probe);
	const rgb = c => { probe.style.color = c; const m = getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number); return m; };
	const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
	const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
	const menu = document.querySelector(".menu"), fg = rgb(getComputedStyle(menu.querySelector(".ml small")).color);
	const row = (bg) => cr(fg, rgb(bg));
	const out = { small: row(getComputedStyle(menu).backgroundColor), hover: row(getComputedStyle(menu).getPropertyValue("--hover")) };
	probe.remove(); return out;`);
test("390px dark: the secondary text of a menu item reaches 4.5:1 on the menu and on a hovered or focused item", async () => {
	const v = await openMenu(390, "dark");
	await shot(v, "1-menu-dark");
	const c = await ratio(v);
	expect(c.small).toBeGreaterThanOrEqual(4.5);
	expect(c.hover).toBeGreaterThanOrEqual(4.5);
});
