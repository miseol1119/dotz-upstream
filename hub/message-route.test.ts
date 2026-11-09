import { afterAll, describe, expect, test } from "bun:test";
import { setupEnv } from "../features/reply-drafts/test/helpers.ts";
import { HUB_TOKEN } from "./config.ts";
import { makeRoute } from "./routes.ts";

// POST /api/message: what the composer sends is stored once.
const env = setupEnv();
afterAll(env.cleanup);

const route = makeRoute({ busyNow: () => [], restartGateway: () => "", restartGatewayNow: () => "" });
const call = (method: string, path: string, body?: object) => route(new Request(`http://hub.test${path}`, { method, headers: { "x-dotz-token": HUB_TOKEN, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const lines = async (text: string) => ((await (await call("GET", "/api/history?target=main&limit=500")).json()) as { events?: Array<{ text?: string }> }).events?.filter(e => e.text === text).length;

describe("POST /api/message", () => {
	test("the same client id sent twice is stored once and answers the same", async () => {
		const first = await call("POST", "/api/message", { text: "중복 시험", cid: "c-1" });
		const again = await call("POST", "/api/message", { text: "중복 시험", cid: "c-1" });
		expect(first.status).toBe(200);
		expect(await again.json()).toEqual(await first.json());
		expect(await lines("중복 시험")).toBe(1);
		await call("POST", "/api/message", { text: "중복 시험", cid: "c-2" });
		expect(await lines("중복 시험")).toBe(2);
	});
});
