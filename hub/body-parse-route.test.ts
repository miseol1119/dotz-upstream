import { afterAll, describe, expect, test } from "bun:test";
import { setupEnv } from "../features/reply-drafts/test/helpers.ts";
import { HUB_TOKEN } from "./config.ts";
import { makeRoute } from "./routes.ts";

// A JSON body that cannot be parsed is refused with 400 and a short Korean error; an empty body still works as before (hub/routes-util.ts body).
const env = setupEnv();
afterAll(env.cleanup);

const route = makeRoute({ busyNow: () => [], restartGateway: () => "", restartGatewayNow: () => "" });
const call = (method: string, path: string, body?: string) => route(new Request(`http://hub.test${path}`, { method, headers: { "x-dotz-token": HUB_TOKEN, "content-type": "application/json" }, ...(body === undefined ? {} : { body }) }));

const ROUTES: Array<[string, string]> = [
	["POST", "/api/notices/read"],
	["PUT", "/api/api-budget"],
	["PUT", "/api/machine"],
];

describe("malformed JSON body", () => {
	for (const [method, path] of ROUTES)
		test(`${method} ${path} answers 400 with a Korean error`, async () => {
			const r = await call(method, path, "{not json");
			expect(r.status).toBe(400);
			const { error } = (await r.json()) as { error: string };
			expect(error).toMatch(/[가-힣]/);
		});

	test("an empty body is still read as no fields", async () => {
		expect((await call("POST", "/api/notices/read")).status).toBe(200);
		expect((await call("POST", "/api/notices/read", "")).status).toBe(200);
		expect((await call("POST", "/api/notices/read", "{}")).status).toBe(200);
	});
});
