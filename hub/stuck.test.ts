// A turn that emits a tool call and then goes silent is aborted, then restarted with its open requests redelivered; progress
// signals (events, session file, process-tree CPU) and the exemptions (workers, compaction, open owner question, idle) keep a long
// normal turn untouched; at most three recoveries per hour.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./config.ts";
import { createPrompts } from "./prompts.ts";
import type * as Orchestrator from "./orchestrator.ts";
import { adapters } from "./runtime/index.ts";
import { omp } from "./runtime/omp.ts";
import { advance, flush } from "./runtime/test-clock.ts";
import type { AgentEvent, AgentProcess, RuntimeAdapter, SendMode, SpawnOpts } from "./runtime/types.ts";
import * as stuck from "./stuck.ts";

const DATA = process.env.DOTZ_DIR!;
const STUCK_MS = 10 * 60_000;
process.env.DOTZ_STUCK_MS = String(STUCK_MS);
const mod: typeof Orchestrator = await import("./orchestrator.ts?stuck");

class FakeAgent implements AgentProcess {
	static next = 9100;
	pid = FakeAgent.next++;
	sent: { text: string; mode: SendMode }[] = [];
	aborts = 0;
	kills: boolean[] = [];
	endOnAbort = true;
	ignoreTerm = false;
	private queue: AgentEvent[] = [];
	private wake = Promise.withResolvers<void>();
	private exit = Promise.withResolvers<number>();
	readonly exited = this.exit.promise;
	readonly events = this.stream();
	constructor(readonly opts: SpawnOpts) {}
	private async *stream(): AsyncGenerator<AgentEvent> {
		for (;;) {
			while (this.queue.length) yield this.queue.shift()!;
			await this.wake.promise;
			this.wake = Promise.withResolvers<void>();
		}
	}
	async push(...events: AgentEvent[]): Promise<void> {
		this.queue.push(...events);
		this.wake.resolve();
		await flush();
	}
	send(text: string, mode: SendMode): void {
		this.sent.push({ text, mode });
	}
	abort = () => {
		this.aborts++;
		if (this.endOnAbort) void this.push({ type: "assistant", text: "", stop: "aborted" }, { type: "turn_end" });
	};
	compact = () => {};
	refreshUsage = () => {};
	refreshSession = () => {};
	watchSubagents = () => {};
	kill = (force?: boolean) => {
		this.kills.push(!!force);
		if (!this.ignoreTerm || force) this.exit.resolve(force ? 137 : 143);
	};
}

const started: FakeAgent[] = [];
const fake: RuntimeAdapter = {
	id: "omp",
	caps: { steer: "native", subagents: "none", contextNumbers: "none", compact: "none", sessionTranscript: false, promptCacheKeepalive: false },
	start(opts) {
		const agent = new FakeAgent(opts);
		started.push(agent);
		return agent;
	},
	classifyError: omp.classifyError,
	recentExchanges: () => "",
};

let cpu: number | undefined;
const savedCfg = { orchestrator: cfg.orchestrator };
beforeAll(() => {
	adapters.fake = fake;
	cfg.orchestrator = { ...cfg.orchestrator, runtime: "fake" };
	stuck.setCpuSampler(async () => cpu);
});
afterAll(() => {
	delete adapters.fake;
	Object.assign(cfg, savedCfg);
});

let seq = 0;
// One orchestrator instance wired like hub/outbound.ts wires a session: its own prompt queue, reopen on restart, settle at idle.
function session(key: string) {
	const conv = key !== "main";
	const o = mod.createOrchestrator({ key, stateFile: join(DATA, `stuck-${++seq}.json`), source: `stuck:${key}:${seq}`, keepalive: false, env: conv ? { DOTZ_CONV: key } : undefined, scope: conv ? () => `scope of ${key}` : undefined, asks: conv ? false : undefined });
	const q = createPrompts({
		deliver: text => o.deliver(text, true),
		steer: o.steer,
		working: () => o.orch.status === "working",
		note: (_t, _r, text) => `[note] ${text}`,
		isNote: text => text.startsWith("[note]"),
		post: async () => ({ delivered: true }),
		clearProgress: () => {},
		persist: () => {},
		log: () => {},
		answered: [],
		recent: () => [],
	});
	const alerts: string[] = [];
	const notices: { minutes: number; target?: string }[] = [];
	o.setRestartedHandler(() => q.reopen(t => `[replay] ${t}`));
	o.setIdleHandler(() => {
		q.settleTurn(o.turnFailed());
		q.redeliverSteered();
	});
	o.setAlertHandler(t => void alerts.push(t));
	o.setStuckHandler(minutes => void notices.push({ minutes, target: q.current()?.target }));
	const mine = () => started.filter(a => (conv ? a.opts.env?.DOTZ_CONV === key : !a.opts.env?.DOTZ_CONV) && a.opts.env !== undefined && a.opts.cwd !== undefined).length;
	return { o, q, alerts, notices, mine, key };
}
const chat = (target: string, replyTo: string) => ({ target, replyTo });
// A turn on the newest process: the request goes in, the turn starts and ends in a tool call.
async function turn(s: ReturnType<typeof session>, text: string, reply: { target: string; replyTo: string }): Promise<FakeAgent> {
	s.q.deliver(text, reply);
	const agent = started.at(-1)!;
	await agent.push({ type: "session", ref: join(DATA, `stuck-${s.key.replace(/\W/g, "_")}-${seq}.jsonl`) }, { type: "turn_start" });
	s.q.onPrompt(text);
	await agent.push({ type: "assistant", text: "", stop: "other" });
	return agent;
}
const quiet = async (ms: number) => {
	await advance(ms);
	await flush();
};

test("the decision: silence past the limit aborts once, the grace then restarts, the fourth in an hour is capped", () => {
	const s = { lastAt: 0, recoveries: [] as number[], capped: false } as stuck.StuckState;
	expect(stuck.stuckDecision(s, STUCK_MS - 1, STUCK_MS)).toBe("none");
	expect(stuck.stuckDecision(s, STUCK_MS, STUCK_MS)).toBe("abort");
	s.abortedAt = STUCK_MS;
	expect(stuck.stuckDecision(s, STUCK_MS + stuck.ABORT_GRACE_MS - 1, STUCK_MS)).toBe("none");
	expect(stuck.stuckDecision(s, STUCK_MS + stuck.ABORT_GRACE_MS, STUCK_MS)).toBe("restart");
	s.abortedAt = undefined;
	s.recoveries = [1, 2, 3];
	expect(stuck.stuckDecision(s, STUCK_MS, STUCK_MS)).toBe("cap");
	s.capped = true;
	expect(stuck.stuckDecision(s, STUCK_MS, STUCK_MS)).toBe("none");
	s.recoveries = [1, 2, 3];
	expect(stuck.stuckDecision(s, 61 * 60_000 + 4, STUCK_MS)).toBe("abort"); // the window slid past all three
});

test("the process tree's CPU time is its pid and every descendant", () => {
	const ps = ["  10     1   0:01.50", "  11    10   1:00.00", "  12    11   0:00.50", "  13    10 1-00:00:01", "  99     1   5:00.00"].join("\n");
	expect(stuck.treeCpuSeconds(ps, 10)).toBeCloseTo(1.5 + 60 + 0.5 + 86401, 5);
	expect(stuck.treeCpuSeconds(ps, 77)).toBeUndefined();
});

test("a) main: a tool call then silence is aborted at the limit; with no turn_end it is killed and restarted, the open request sent again", async () => {
	const s = session("main");
	s.q.deliver("do the thing", chat("chat", "m1"));
	const first = started.at(-1)!;
	first.endOnAbort = false;
	await first.push({ type: "session", ref: join(DATA, "stuck-a.jsonl") }, { type: "turn_start" });
	s.q.onPrompt("do the thing");
	await first.push({ type: "assistant", text: "", stop: "other" });
	await quiet(STUCK_MS - 60_000);
	expect(first.aborts).toBe(0);
	await quiet(60_000);
	expect(first.aborts).toBe(1);
	expect(s.o.turnFailed()).toBe(true);
	const before = started.length;
	await quiet(stuck.ABORT_GRACE_MS);
	expect(first.kills[0]).toBe(false);
	expect(started.length).toBe(before + 1);
	const second = started.at(-1)!;
	expect(second.sent.some(m => m.text.includes("do the thing"))).toBe(true);
	expect(s.q.current()).toBeUndefined();
	s.o.stop();
	await quiet(1000);
});

test("a) the abort that does end the turn restarts right at turn_end and the request is redelivered", async () => {
	const s = session("main");
	const first = await turn(s, "answer me", chat("chat", "m7"));
	await quiet(STUCK_MS);
	expect(first.aborts).toBe(1);
	const second = started.at(-1)!;
	expect(second).not.toBe(first);
	expect(first.kills.length).toBe(1);
	expect(second.sent.some(m => m.text.includes("answer me"))).toBe(true);
	s.o.stop();
	await quiet(1000);
});

test("b) conversation: a message steered into the stuck turn is redelivered to that session only; the notice names only its conversation", async () => {
	const a = session("ch:stuck-a");
	const b = session("ch:stuck-b");
	const bAgent = await turn(b, "other conversation", chat("ch:b", "b1"));
	const first = await turn(a, "first question", chat("ch:a", "a1"));
	a.q.deliver("also this", chat("ch:a", "a2"));
	expect(first.sent.at(-1)).toMatchObject({ mode: "steer" });
	const bSent = bAgent.sent.length;
	const bStarted = b.mine();
	// B finishes normally; only A stays silent
	await bAgent.push({ type: "assistant", text: "ok", stop: "stop" }, { type: "turn_end" });
	await quiet(STUCK_MS);
	expect(first.aborts).toBe(1);
	expect(bAgent.aborts).toBe(0);
	const second = started.at(-1)!;
	expect(second.opts.env?.DOTZ_CONV).toBe("ch:stuck-a");
	const texts = second.sent.map(m => m.text).join("\n");
	expect(texts).toContain("first question");
	expect(texts).toContain("also this");
	expect(bAgent.sent.length).toBe(bSent);
	expect(b.mine()).toBe(bStarted);
	expect(a.notices).toEqual([{ minutes: 10, target: "ch:a" }]);
	expect(b.notices).toEqual([]);
	a.o.stop();
	b.o.stop();
	await quiet(1000);
});

test("c) a process that ignores abort and TERM is killed, then the session resumes", async () => {
	const s = session("main");
	const first = await turn(s, "stubborn", chat("chat", "m3"));
	first.endOnAbort = false;
	first.ignoreTerm = true;
	await quiet(STUCK_MS);
	expect(first.aborts).toBe(1);
	await quiet(stuck.ABORT_GRACE_MS);
	expect(first.kills).toEqual([false]);
	const before = started.length;
	await quiet(10_000);
	expect(first.kills).toEqual([false, true]);
	expect(started.length).toBe(before + 1);
	expect(started.at(-1)!.sent.some(m => m.text.includes("stubborn"))).toBe(true);
	s.o.stop();
	await quiet(1000);
});

test("d) an owner abort the process ignores: restarted after the grace, the cancelled request is not replayed", async () => {
	for (const key of ["main", "ch:stuck-d"]) {
		const s = session(key);
		const first = await turn(s, "cancel me", chat(key === "main" ? "chat" : "ch:d", "c1"));
		first.endOnAbort = false;
		let cancels = 0;
		s.o.setOwnerCancel(() => (cancels++, s.q.cancel()));
		s.o.cancelByOwner();
		expect(cancels).toBe(1);
		expect(first.aborts).toBe(1);
		await quiet(stuck.ABORT_GRACE_MS - 1000);
		expect(first.kills).toEqual([]);
		const before = started.length;
		await quiet(1000);
		expect(first.kills[0]).toBe(false);
		expect(started.length).toBe(before + 1);
		expect(started.at(-1)!.sent.some(m => m.text.includes("cancel me"))).toBe(false);
		expect(s.q.queued().length).toBe(0);
		expect(s.notices).toEqual([]);
		s.o.stop();
		await quiet(1000);
	}
});

test("d) an owner abort that works cancels the grace restart", async () => {
	const s = session("main");
	const first = await turn(s, "stop soon", chat("chat", "m9"));
	s.o.setOwnerCancel(() => s.q.cancel());
	s.o.cancelByOwner();
	await flush();
	const before = started.length;
	await quiet(stuck.ABORT_GRACE_MS * 2);
	expect(first.kills).toEqual([]);
	expect(started.length).toBe(before);
	s.o.stop();
	await quiet(1000);
});

test("e) a long tool with no events but growing process-tree CPU, or a growing session file, is left alone past twice the limit", async () => {
	const s = session("main");
	const first = await turn(s, "run the tests", chat("chat", "m4"));
	cpu = 100;
	for (let i = 0; i < 24; i++) {
		cpu += 5;
		await quiet(60_000);
	}
	expect(first.aborts).toBe(0);
	cpu = undefined;
	const file = join(DATA, "stuck-grow.jsonl");
	writeFileSync(file, "x");
	await first.push({ type: "session", ref: file });
	for (let i = 0; i < 24; i++) {
		appendFileSync(file, "more\n");
		await quiet(60_000);
	}
	expect(first.aborts).toBe(0);
	expect(s.notices).toEqual([]);
	// the signals stop: the limit then runs from the last growth
	await quiet(STUCK_MS);
	expect(first.aborts).toBe(1);
	s.o.stop();
	await quiet(1000);
});

test("f) a [later] wait, running workers, an open owner question and a compaction are left alone", async () => {
	const later = session("main");
	const l1 = await turn(later, "wait for the worker", chat("chat", "m5"));
	await l1.push({ type: "assistant", text: "[later] 워커를 기다려요", stop: "stop" }, { type: "turn_end" });
	await quiet(STUCK_MS * 3);
	expect(l1.aborts).toBe(0);
	later.o.stop();

	const workers = session("main");
	const w1 = await turn(workers, "spawn workers", chat("chat", "m6"));
	await w1.push({ type: "subagent", update: { id: "w-stuck", status: "running" } });
	await quiet(STUCK_MS * 3);
	expect(w1.aborts).toBe(0);
	await w1.push({ type: "subagent", update: { id: "w-stuck", status: "done" } });
	workers.o.stop();

	const asked = session("main");
	const a1 = await turn(asked, "needs the owner", chat("chat", "m8"));
	let open = true;
	asked.o.setStuckGuard(() => open);
	await quiet(STUCK_MS * 3);
	expect(a1.aborts).toBe(0);
	open = false;
	await quiet(STUCK_MS);
	expect(a1.aborts).toBe(1);
	asked.o.stop();

	const compacting = session("main");
	const c1 = await turn(compacting, "compact meanwhile", chat("chat", "m10"));
	compacting.o.orch.ctx.compaction.state = "compacting";
	await quiet(STUCK_MS * 3);
	expect(c1.aborts).toBe(0);
	compacting.o.orch.ctx.compaction.state = "idle";
	compacting.o.stop();
	await quiet(1000);
});

test("g) the fourth stuck turn in an hour is alerted once and not restarted a fourth time", async () => {
	const s = session("main");
	let agent = await turn(s, "again and again", chat("chat", "m11"));
	for (let n = 1; n <= 3; n++) {
		await quiet(STUCK_MS);
		expect(agent.aborts).toBe(1);
		agent = started.at(-1)!;
		await agent.push({ type: "session", ref: join(DATA, "stuck-g.jsonl") }, { type: "turn_start" });
	}
	expect(s.alerts).toEqual([]);
	const spawns = started.length;
	await quiet(STUCK_MS);
	expect(agent.aborts).toBe(0);
	expect(s.alerts).toHaveLength(1);
	await quiet(STUCK_MS * 3);
	expect(s.alerts).toHaveLength(1);
	expect(started.length).toBe(spawns);
	expect(agent.kills).toEqual([]);
	s.o.stop();
	await quiet(1000);
});
