// A lane whose turn goes silent is aborted, then recovered on the same session with the owner messages steered into that turn;
// a lane with a running subagent is left alone; an owner abort the process ignores kills and resumes the lane idle.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Lanes from "./lanes.ts";
import { cfg } from "./config.ts";
import { msg } from "./i18n.ts";
import { adapters } from "./runtime/index.ts";
import { omp } from "./runtime/omp.ts";
import { advance, flush } from "./runtime/test-clock.ts";
import type { AgentEvent, AgentProcess, RuntimeAdapter, SpawnOpts } from "./runtime/types.ts";
import * as stuck from "./stuck.ts";

const DATA = process.env.DOTZ_DIR!;
const STUCK_MS = 10 * 60_000;
process.env.DOTZ_STUCK_MS = String(STUCK_MS);
const l: typeof Lanes = await import("./lanes.ts");
(await import("./lanestate.ts")).resetLaneStateForTest();

class FakeAgent implements AgentProcess {
	pid = 7600;
	sent: string[] = [];
	aborts = 0;
	endOnAbort = true;
	private queue: AgentEvent[] = [];
	private wake?: () => void;
	private closed = false;
	private exit = Promise.withResolvers<number>();
	readonly exited = this.exit.promise;
	readonly events: AsyncIterable<AgentEvent> = {
		[Symbol.asyncIterator]: async function* (this: FakeAgent) {
			for (;;) {
				while (this.queue.length) yield this.queue.shift()!;
				if (this.closed) return;
				await new Promise<void>(r => (this.wake = r));
			}
		}.bind(this),
	};
	push(ev: AgentEvent): void {
		this.queue.push(ev);
		this.wake?.();
	}
	send = (text: string) => void this.sent.push(text);
	abort = () => {
		this.aborts++;
		if (this.endOnAbort) {
			this.push({ type: "assistant", text: "", stop: "aborted" });
			this.push({ type: "turn_end" });
		}
	};
	compact = () => {};
	refreshUsage = () => {};
	refreshSession = () => {};
	watchSubagents = () => {};
	kill = () => {
		this.closed = true;
		this.wake?.();
		this.exit.resolve(137);
	};
}
const spawns: { opts: SpawnOpts; agent: FakeAgent }[] = [];
const fake: RuntimeAdapter = {
	id: "omo",
	caps: { steer: "native", subagents: "none", contextNumbers: "none", compact: "none", sessionTranscript: true, promptCacheKeepalive: false },
	start(opts) {
		const agent = new FakeAgent();
		spawns.push({ opts, agent });
		return agent;
	},
	classifyError: omp.classifyError,
	recentExchanges: () => "",
	detect: async () => ({ installed: true }),
};
const savedCfg = { lanes: cfg.lanes };
const reports: string[] = [];
const notices: string[] = [];
beforeAll(() => {
	adapters.fakeomo = fake;
	cfg.lanes = { ...cfg.lanes, runtime: "fakeomo" };
	stuck.setCpuSampler(async () => undefined);
	l.setReportHandler((_lane, text) => void reports.push(text));
	l.setNoticeHandler((_lane, text) => void notices.push(text));
	l.setIdleHandler(() => {});
});
afterAll(() => {
	delete adapters.fakeomo;
	Object.assign(cfg, savedCfg);
});

async function working(name: string): Promise<{ lane: Lanes.Lane; agent: FakeAgent }> {
	const cwd = join(DATA, "stuck-lane-work");
	mkdirSync(cwd, { recursive: true });
	const lane = l.launch(name, cwd, "Polish the theme.\nDone when: owner approves");
	const agent = spawns.at(-1)!.agent;
	const session = join(DATA, `${name}.jsonl`);
	writeFileSync(session, "");
	lane.sessionFile = session;
	agent.push({ type: "turn_start" });
	await flush();
	return { lane, agent };
}
const quiet = async (ms: number) => {
	await advance(ms);
	await flush();
};

test("h) a silent lane is aborted, then recovered on its session with the owner text steered into the turn; one line in its channel", async () => {
	notices.length = reports.length = 0;
	const { lane, agent } = await working("stuck-lane-a");
	l.sendToLane("stuck-lane-a", "[owner via web] 색도 바꿔 주세요");
	agent.push({ type: "assistant", text: "", stop: "other" });
	await flush();
	await quiet(STUCK_MS);
	expect(agent.aborts).toBe(1);
	const before = spawns.length;
	await quiet(500);
	expect(spawns.length).toBe(before + 1);
	const back = spawns.at(-1)!;
	expect(back.opts.resume).toBe(lane.sessionFile);
	const revive = back.agent.sent.join("\n");
	expect(revive).toContain(msg().laneStopped);
	expect(revive).toContain("색도 바꿔 주세요");
	expect(notices).toHaveLength(1);
	expect(notices[0]).toContain("10분");
	expect(reports).toEqual([]);
	l.stopLane("stuck-lane-a");
	await quiet(300);
});

test("h) a lane that ignores the stuck abort is killed after the grace and resumed with the revive text", async () => {
	notices.length = reports.length = 0;
	const { agent } = await working("stuck-lane-b");
	agent.endOnAbort = false;
	await quiet(STUCK_MS);
	expect(agent.aborts).toBe(1);
	const before = spawns.length;
	await quiet(stuck.ABORT_GRACE_MS);
	expect(spawns.length).toBe(before + 1);
	expect(spawns.at(-1)!.agent.sent.join("\n")).toContain(msg().laneStopped);
	l.stopLane("stuck-lane-b");
	await quiet(300);
});

test("h) a lane with a running subagent is untouched", async () => {
	notices.length = reports.length = 0;
	const { agent } = await working("stuck-lane-c");
	agent.push({ type: "subagent", update: { id: "lane-worker", status: "running" } });
	await flush();
	await quiet(STUCK_MS * 3);
	expect(agent.aborts).toBe(0);
	expect(notices).toEqual([]);
	agent.push({ type: "subagent", update: { id: "lane-worker", status: "done" } });
	l.stopLane("stuck-lane-c");
	await quiet(300);
});

test("h) the fourth stuck turn in an hour is reported once as [lane stuck] and not restarted again", async () => {
	notices.length = reports.length = 0;
	let { agent } = await working("stuck-lane-d");
	for (let n = 0; n < 3; n++) {
		await quiet(STUCK_MS);
		expect(agent.aborts).toBe(1);
		await quiet(500);
		agent = spawns.at(-1)!.agent;
		agent.push({ type: "turn_start" });
		await flush();
	}
	expect(reports).toEqual([]);
	const count = spawns.length;
	await quiet(STUCK_MS);
	expect(agent.aborts).toBe(0);
	expect(reports).toHaveLength(1);
	expect(reports[0]).toStartWith("[lane stuck]");
	await quiet(STUCK_MS * 3);
	expect(reports).toHaveLength(1);
	expect(spawns.length).toBe(count);
	l.stopLane("stuck-lane-d");
	await quiet(300);
});

test("h) an owner abort the process ignores: killed after the grace and resumed idle, without a continue text", async () => {
	notices.length = reports.length = 0;
	const { lane, agent } = await working("stuck-lane-e");
	agent.endOnAbort = false;
	l.abortLane("stuck-lane-e");
	expect(agent.aborts).toBe(1);
	const before = spawns.length;
	await quiet(stuck.ABORT_GRACE_MS - 1000);
	expect(spawns.length).toBe(before);
	await quiet(1000 + 500);
	expect(spawns.length).toBe(before + 1);
	const back = spawns.at(-1)!;
	expect(back.opts.resume).toBe(lane.sessionFile);
	expect(back.agent.sent).toEqual([]);
	expect(lane.status).toBe("idle");
	expect(lane.recoveries ?? []).toEqual([]);
	expect(notices).toEqual([]);
	l.stopLane("stuck-lane-e");
	await quiet(300);
});
