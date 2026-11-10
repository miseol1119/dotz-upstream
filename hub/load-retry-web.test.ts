import { afterAll, expect, test } from "bun:test";
import { fakeHub, on } from "./test-web.ts";

// A screen that could not load says so and offers 다시 시도 (emptyNode's retry); a later redraw must not turn it back into 불러오는 중.
const hub = fakeHub({ stream: "fake" });
afterAll(() => hub.stop());
const view = await hub.view({ width: 390, height: 844 });
const { waitFor } = on(view);
const opened = hub.nextStream();
await view.navigate(`${hub.origin}/`);
await opened;
await waitFor(`typeof loadModels === "function" && S && NT.loaded`);

test("모델: a failed load keeps its 다시 시도 through a redraw, and pressing it loads the screen", async () => {
	await view.evaluate(`(window.__api = api, api = (p, ...r) => (p === "/api/models" ? Promise.reject(new Error("연결할 수 없어요")) : __api(p, ...r)), M = null, go("models"), 0)`);
	await waitFor(`current === "models" && !!document.querySelector('#models [data-k="retry"]')`);
	expect(await view.evaluate(`(renderModels(), !!document.querySelector('#models [data-k="retry"]'))`)).toBe(true);
	await view.evaluate(`(api = __api, document.querySelector('#models [data-k="retry"]').click(), 0)`);
	await waitFor(`!!M && !document.querySelector("#models .empty")`);
});
