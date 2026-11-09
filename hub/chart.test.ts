// In-message charts (hub/chart.ts): a ```chart fence becomes a Chart element, the gateway checks and draws it (SVG for the web, PNG for Discord),
// a spec it refuses stays readable as JSON with a note, and ztd-charts never loads on the gateway start path.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chartFiles, chartRoute, checkChart } from "./chart.ts";
import { deriveSpec } from "./message-spec-derive.ts";
import { specChildren } from "./message-spec.ts";

const BAR = JSON.stringify({ type: "bar", data: [{ x: "1월", y: 3 }, { x: "2월", y: 5 }] });
const fence = (body: string) => `매출이에요.\n\n\`\`\`chart\n${body}\n\`\`\``;
const post = (spec: unknown, width?: number) => chartRoute(new Request("http://x/api/chart", { method: "POST", body: JSON.stringify({ spec, width }) }));

test("a chart fence is a Chart element; text that is not a JSON object is a json code block with a note", () => {
	const ok = deriveSpec(fence(BAR))!;
	expect(specChildren(ok).map(e => e.type)).toEqual(["Text", "Chart"]);
	expect(specChildren(ok)[1]!.props).toEqual({ spec: BAR });
	const bad = deriveSpec(fence("{not json"))!;
	expect(specChildren(bad).map(e => e.type)).toEqual(["Text", "Code", "Meta"]);
	expect(specChildren(bad)[1]!.props).toEqual({ code: "{not json", lang: "json" });
});

test("a valid spec draws an svg in both themes; an invalid one or a remote data source gets a note instead", async () => {
	const ok = (await (await post(BAR)).json()) as { ok: boolean; light: string; dark: string };
	expect(ok.ok).toBe(true);
	expect(ok.light.startsWith("<svg")).toBe(true);
	expect(ok.dark.startsWith("<svg")).toBe(true);
	expect(ok.light).not.toBe(ok.dark);
	// drawn at the width the page shows it, in 40 px steps
	expect(((await (await post(BAR, 351)).json()) as { light: string }).light).toContain('width="360"');
	const bad = (await (await post(JSON.stringify({ type: "nope", data: [] }))).json()) as { ok: boolean; note: string };
	expect(bad.ok).toBe(false);
	expect(bad.note).toContain("type");
	expect(await checkChart(JSON.stringify({ type: "bar", data: { url: "http://127.0.0.1/x.json" } }))).toMatchObject({ ok: false });
});

test("Discord: a chart fence leaves the text as a PNG attachment; a refused spec stays as a json block with its note", async () => {
	const ok = await chartFiles({ text: fence(BAR), files: [] });
	expect(ok.text).toBe("매출이에요.");
	expect(ok.files).toHaveLength(1);
	expect([...readFileSync(ok.files[0]!).subarray(1, 4)].map(c => String.fromCharCode(c)).join("")).toBe("PNG");
	const bad = await chartFiles({ text: fence('{"type":"nope","data":[]}'), files: [] });
	expect(bad.files).toEqual([]);
	expect(bad.text).toContain('```json\n{"type":"nope","data":[]}\n```\n-# ');
});

// Static imports only: what the gateway loads when it starts. hub/chart.ts must be reachable and load ztd-charts and resvg by dynamic import alone.
test("the gateway start path reaches hub/chart.ts but never imports ztd-charts, resvg or react statically", () => {
	const seen = new Set<string>(), heavy: string[] = [];
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		const src = readFileSync(file, "utf8");
		for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) {
			const spec = (m[1] ?? m[2])!;
			if (/^(ztd-charts|@resvg\/|react)/.test(spec)) heavy.push(`${file}: ${spec}`);
			if (spec.startsWith(".") && /\.ts$/.test(spec)) walk(resolve(dirname(file), spec));
		}
	};
	walk(join(import.meta.dir, "main.ts"));
	expect(seen.has(join(import.meta.dir, "chart.ts"))).toBe(true);
	expect(heavy).toEqual([]);
});
