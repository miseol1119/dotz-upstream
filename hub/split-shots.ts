// Screenshot scenarios of the split panes (web/js/43-panes*.js) on the demo page, for the shot tool of the split-panes lane (bun <tool> <root> <out> <prefix>).
import type { View } from "./layout-measure.ts";

type Lm = typeof import("./layout-measure.ts");
export type SplitShot = { name: string; widths: number[]; run: (view: View, lm: Lm) => Promise<void> };

const LANE = "lane:랜딩-점검", LANE2 = "lane:공지-초안", PROJECT = "ch:5";

// Splits the active pane (or the pane at index `at` of paneList()) and waits until the new pane is drawn.
async function split(view: View, lm: Lm, n: number, t: string, kind: string, side: string, at = -1): Promise<void> {
	if (at >= 0) await view.evaluate(`paneFocus(paneList()[${at}].id)`);
	await view.evaluate(`paneSplit(${JSON.stringify(t)}, ${JSON.stringify(kind)}, ${JSON.stringify(side)})`);
	await lm.waitFor(view, `paneCount() === ${n} && document.querySelectorAll("#split .pane").length === ${n} && document.querySelector("#split .pane.on")`);
}
const open = (view: View, lm: Lm) => lm.goScreen(view, "chat-open");

export const SPLIT_SHOTS: SplitShot[] = [
	{ name: "two", widths: [1280, 1600], run: async (view, lm) => {
		await open(view, lm);
		await split(view, lm, 2, LANE, "chat", "right");
	} },
	{ name: "three", widths: [1280, 1600], run: async (view, lm) => {
		await open(view, lm);
		await split(view, lm, 2, LANE, "chat", "right");
		await split(view, lm, 3, PROJECT, "project", "bottom");
	} },
	{ name: "four", widths: [1280, 1600], run: async (view, lm) => {
		await open(view, lm);
		await split(view, lm, 2, LANE, "chat", "right");
		await split(view, lm, 3, LANE2, "chat", "bottom", 0);
		await split(view, lm, 4, PROJECT, "project", "bottom", 1);
	} },
];
