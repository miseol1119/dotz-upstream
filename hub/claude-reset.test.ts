// The Claude 리셋권 (hub/usage-account.ts claudeResets, hub/claude-reset.ts) against a fake upstream only: the usage GET carries the
// cedar_ember query and a Claude Code user-agent, the count is parsed per kind, and POST /api/quota/reset-credit with provider
// "anthropic" spends one only with confirm: true, after a fresh read. This file's own OmO agent dir holds fake accounts, so no test
// reads the machine's auth.json, keychain or Claude CLI dir; every request goes to the fake, which throws on any other URL.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetAccountUsage, refreshQuota, resetQuotaForTest } from "./providers.ts";
import { routeSettings } from "./routes-settings.ts";
import { AccountUsage, CLAUDE_USAGE_URL, claudeResets } from "./usage-account.ts";

const ORG = "11111111-2222-3333-4444-555555555555";
const DIR_ID = "a".repeat(32);
const realFetch = globalThis.fetch;
const prevAgent = process.env.OMO_CODING_AGENT_DIR;
const agent = mkdtempSync(join(tmpdir(), "dotz-claude-reset-"));
process.env.OMO_CODING_AGENT_DIR = agent;
writeFileSync(
	join(agent, "auth.json"),
	JSON.stringify({
		"anthropic-subscription": {
			type: "oauth",
			pinned: "main",
			accounts: [
				{ name: "main", access: "tok-main", expires: 4_000_000_000_000, dirId: DIR_ID },
				{ name: "no-org", access: "tok-no-org", expires: 4_000_000_000_000 },
				{ name: "old", access: "tok-old", expires: 1_000, refresh: "never-used" },
			],
		},
	}),
);
mkdirSync(join(agent, "anthropic-subscription-claude", DIR_ID), { recursive: true });
writeFileSync(join(agent, "anthropic-subscription-claude", DIR_ID, ".claude.json"), JSON.stringify({ oauthAccount: { organizationUuid: ORG } }));
afterAll(() => {
	globalThis.fetch = realFetch;
	if (prevAgent === undefined) delete process.env.OMO_CODING_AGENT_DIR;
	else process.env.OMO_CODING_AGENT_DIR = prevAgent;
	rmSync(agent, { recursive: true, force: true });
});

type Json = Record<string, any>;
const grant = (id: string, label: string, ends: string, over: Json = {}): Json => ({ id, label, resets_total: 1, resets_left: 1, ends_at: ends, type: "weekly", usable_now: true, paused: false, ...over });
const GRANTS = [
	grant("fable-12mo", "+1 Fable reset at 12 months tenure", "2030-03-09T07:59:00Z", { type: "full" }),
	grant("free_reset_weekly", "Free limit reset (weekly)", "2029-12-16T04:59:00Z"),
	grant("launch-fable", "Fable reset (Max)", "2030-03-09T07:59:00Z", { type: "full", resets_total: 2, resets_left: 2 }),
	grant("spent", "Fable reset", "2029-01-01T00:00:00Z", { resets_left: 0 }),
];
const usage = (cedar: Json | null = { eligible: true, next_grant_id: "free_reset_weekly", grants: GRANTS }): Json => ({
	five_hour: { utilization: 40, resets_at: "2029-01-01T05:00:00Z" },
	seven_day: { utilization: 100, resets_at: "2029-01-03T00:00:00Z" },
	cedar_ember: cedar,
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: Json };
const RESET_URL = `https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`;
function upstream(body: Json, status = 200, resetBody: Json = { result: "reset", resets_left: 0, cleared: ["seven_day"] }): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = String(input), method = init.method ?? "GET";
		calls.push({ url, method, headers: init.headers as Record<string, string>, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
		if (method === "GET" && url === CLAUDE_USAGE_URL) return status === 200 ? Response.json(body) : new Response("", { status });
		if (method === "POST" && url === RESET_URL) return Response.json(resetBody);
		throw new Error(`unexpected request ${method} ${url}`);
	}) as typeof fetch;
	return calls;
}
const resetsCalls = (calls: Call[]) => calls.filter(c => c.method === "POST");
const post = async (b: unknown) => {
	const url = new URL("http://x/api/quota/reset-credit");
	const res = (await routeSettings(new Request(url, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }), url, ["api", "quota", "reset-credit"]))!;
	return { status: res.status, body: (await res.json()) as Json };
};

beforeEach(() => {
	resetQuotaForTest();
	for (const n of ["main", "no-org", "old"]) forgetAccountUsage(n);
});

test("several grants: the count sums what is left, by kind, with the nearest expiry and the grant named next", () => {
	expect(claudeResets(usage(), () => true)).toEqual({
		held: 4,
		usable: true,
		expires_at: Date.parse("2029-12-16T04:59:00Z"),
		kinds: [{ kind: "주간", left: 1 }, { kind: "Fable", left: 3 }],
		grant: { id: "free_reset_weekly", kind: "주간" },
	});
	// no org id known locally: shown, not usable
	expect(claudeResets(usage(), () => false)).toMatchObject({ held: 4, usable: false });
});

test("null (no query), ineligible with no grants and a missing block show nothing", () => {
	expect(claudeResets(usage(null), () => true)).toBeUndefined();
	expect(claudeResets(usage({ eligible: false, ineligible_reason: "surface", grants: [] }), () => true)).toBeUndefined();
	expect(claudeResets({ five_hour: { utilization: 1 } }, () => true)).toBeUndefined();
	// ineligible for now but holding some: the count shows and cannot be used
	expect(claudeResets(usage({ eligible: false, ineligible_reason: "cooldown", grants: GRANTS }), () => true)).toMatchObject({ held: 4, usable: false });
});

test("the usage GET asks for cedar_ember with a Claude Code user-agent, and only reads", async () => {
	const calls = upstream(usage());
	const r = await new AccountUsage().report({ name: "main", pinned: true, token: "tok-main", expiresAt: null });
	expect(calls.length).toBe(1);
	expect(calls[0]?.method).toBe("GET");
	expect(new URL(calls[0]!.url).searchParams.get("cedar_ember")).toBe("1");
	expect(new URL(calls[0]!.url).searchParams.get("skip_spend")).toBe("1");
	expect(calls[0]?.headers["user-agent"]).toMatch(/^claude-cli\/\d+\.\d+\.\d+ \(external, cli\)$/);
	expect(r.resets).toMatchObject({ held: 4, usable: true, grant: { id: "free_reset_weekly" } });
	expect(r.limits.map(l => l.id)).toEqual(["anthropic:5h", "anthropic:7d"]);
});

test("401 and an expired token: no count, and nothing but the one GET (no refresh)", async () => {
	const calls = upstream(usage(), 401);
	const r = await new AccountUsage().report({ name: "main", pinned: true, token: "tok-main", expiresAt: null });
	expect(r.problem).toBe("expired");
	expect(r.resets).toBeUndefined();
	expect(calls.map(c => [c.method, c.url])).toEqual([["GET", CLAUDE_USAGE_URL]]);
	const none = upstream(usage());
	const old = await new AccountUsage().report({ name: "old", pinned: false, token: "tok-old", expiresAt: 1_000 });
	expect(old.resets).toBeUndefined();
	expect(none).toEqual([]);
});

test("the route refuses without confirm: true or a grant, and asks the upstream nothing", async () => {
	const calls = upstream(usage());
	for (const b of [{ provider: "anthropic", account: "main", grant_id: "free_reset_weekly" }, { provider: "anthropic", account: "main", grant_id: "free_reset_weekly", confirm: "true" }, { provider: "anthropic", account: "main", confirm: true }, { provider: "anthropic" }])
		expect((await post(b)).status).toBe(400);
	expect(calls).toEqual([]);
});

test("with confirm: true it reads afresh and sends one reset for that grant to the account's organization", async () => {
	const calls = upstream(usage());
	expect(await post({ provider: "anthropic", account: "main", grant_id: "launch-fable", confirm: true })).toEqual({ status: 200, body: { ok: true, outcome: "reset", left: 3 } });
	const used = resetsCalls(calls);
	expect(used.length).toBe(1);
	expect(used[0]?.url).toBe(RESET_URL);
	expect(used[0]?.headers).toMatchObject({ authorization: "Bearer tok-main" });
	expect(used[0]?.body).toMatchObject({ program: "cedar_ember", grant_id: "launch-fable" });
	expect(used[0]?.body?.request_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
	expect(calls.findIndex(c => c.method === "GET")).toBeLessThan(calls.indexOf(used[0]!));
	// the route started a usage re-read; it settles here, while the fake upstream still answers
	await refreshQuota();
});

test("an answer to the reset that is not one of the known outcomes is not a success: an error answer, no ok, no count", async () => {
	for (const known of ["reset", "nothing_to_reset", "not_limited", "no_credit", "already_redeemed", "already_used", "cooldown"]) {
		upstream(usage(), 200, { result: known });
		const r = await post({ provider: "anthropic", account: "main", grant_id: "launch-fable", confirm: true });
		expect([known, r.status, r.body.ok]).toEqual([known, 200, true]);
		await refreshQuota();
	}
	for (const odd of [{ result: "" }, { result: "brand_new_outcome" }, {}, { result: null }, { result: 1 }]) {
		const calls = upstream(usage(), 200, odd);
		const r = await post({ provider: "anthropic", account: "main", grant_id: "launch-fable", confirm: true });
		expect(resetsCalls(calls).length).toBe(1);
		expect(r.status).not.toBe(200);
		expect(r.body.ok).toBeUndefined();
		expect(r.body.left).toBeUndefined();
		expect(typeof r.body.error).toBe("string");
	}
});

test("confirmed but spent, unknown, expired or without an org id: refused, no reset sent", async () => {
	const cases: [Json, Json, number?][] = [
		[usage(), { grant_id: "spent" }],
		[usage(), { grant_id: "no-such-grant" }],
		[usage({ eligible: true, grants: [grant("free_reset_weekly", "weekly", "2029-12-16T04:59:00Z", { usable_now: false })] }), { grant_id: "free_reset_weekly" }],
		[usage(), { grant_id: "free_reset_weekly" }, 401],
		[usage(), { account: "old", grant_id: "free_reset_weekly" }],
		[usage(), { account: "no-org", grant_id: "free_reset_weekly" }],
	];
	for (const [body, b, status] of cases) {
		const calls = upstream(body, status);
		expect((await post({ provider: "anthropic", account: "main", confirm: true, ...b })).status).toBe(409);
		expect(resetsCalls(calls)).toEqual([]);
	}
});
