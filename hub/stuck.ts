// Stuck-turn detection for an agent process (an orchestrator session or a lane): an open turn that shows no progress for
// stuckTurnMs() is aborted, and restarted when the abort does not end the turn within ABORT_GRACE_MS. Progress is any event
// from the process, growth of its session file, or >= 2 s of CPU time used by its process tree between two samples (a long test
// run emits no event but burns CPU). Nothing is done while the caller says a wait is legitimate (workers, compaction, an open
// owner question) or the turn is not open. At most STUCK_CAP recoveries per hour; past that the caller is alerted once.
import { statSync } from "node:fs";
import { log, stuckTurnMs } from "./config.ts";

export const ABORT_GRACE_MS = 60_000;
export const STUCK_CAP = 3;
export const STUCK_WINDOW_MS = 60 * 60_000;
const CPU_GROWTH_S = 2;

export type StuckState = { lastAt: number; abortedAt?: number; recoveries: number[]; capped: boolean };
export type StuckStep = "none" | "abort" | "restart" | "cap";

export function stuckDecision(s: StuckState, now: number, stuckMs: number): StuckStep {
	if (s.abortedAt !== undefined) return now - s.abortedAt >= ABORT_GRACE_MS ? "restart" : "none";
	if (now - s.lastAt < stuckMs) return "none";
	if (s.recoveries.filter(at => now - at < STUCK_WINDOW_MS).length >= STUCK_CAP) return s.capped ? "none" : "cap";
	return "abort";
}

// `ps` TIME: [dd-][hh:]mm:ss[.cc]
export function parseCpuTime(t: string): number {
	const [days, rest] = t.includes("-") ? t.split("-") : ["0", t];
	const parts = rest!.split(":").map(Number).reverse();
	return Number(days) * 86400 + (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
}

/** Cumulative CPU seconds of `pid` and all its descendants from `ps -A -o pid=,ppid=,time=` output; undefined when `pid` is not listed. */
export function treeCpuSeconds(ps: string, pid: number): number | undefined {
	const cpu = new Map<number, number>();
	const kids = new Map<number, number[]>();
	for (const line of ps.split("\n")) {
		const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
		if (!m) continue;
		const [id, parent] = [Number(m[1]), Number(m[2])];
		cpu.set(id, parseCpuTime(m[3]!));
		kids.set(parent, [...(kids.get(parent) ?? []), id]);
	}
	if (!cpu.has(pid)) return undefined;
	let total = 0;
	const seen = new Set<number>();
	for (const stack = [pid]; stack.length; ) {
		const id = stack.pop()!;
		if (seen.has(id)) continue;
		seen.add(id);
		total += cpu.get(id) ?? 0;
		stack.push(...(kids.get(id) ?? []));
	}
	return total;
}

export type CpuSampler = (pid: number) => Promise<number | undefined>;
let sampler: CpuSampler = async pid => {
	try {
		const p = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,time="], { stdout: "pipe", stderr: "ignore" });
		const out = await new Response(p.stdout).text();
		await p.exited;
		return treeCpuSeconds(out, pid);
	} catch {
		return undefined;
	}
};
/** Tests replace the CPU sampling. */
export const setCpuSampler = (fn: CpuSampler): void => void (sampler = fn);

const sizeOf = (file: string | undefined): number | undefined => {
	try {
		return file ? statSync(file).size : undefined;
	} catch {
		return undefined;
	}
};

export type StuckWatchOpts = {
	key: string;
	pid: () => number | undefined;
	sessionFile: () => string | undefined;
	/** A wait that is not a stall is going on (workers, compaction, an open owner question) or the turn is not open: nothing is done. */
	exempt: () => boolean;
	/** Mark the turn failed (its request stays open) and abort the process. */
	abort: () => void;
	restart: (why: string) => void;
	/** The abort was just sent after `minutes` of no progress. */
	stuck: (minutes: number) => void;
	/** The hourly recovery cap is reached: told once until a turn ends normally. */
	capped: (minutes: number) => void;
};

export function createStuckWatch(o: StuckWatchOpts) {
	const s: StuckState = { lastAt: Date.now(), recoveries: [], capped: false };
	let timer: ReturnType<typeof setInterval> | undefined;
	let every = 60_000;
	let last = "turn start";
	let size: number | undefined;
	let cpu: number | undefined;
	let busy = false;
	let abortedAfter = 0;

	function progress(signal: string): void {
		s.lastAt = Date.now();
		last = signal;
	}
	function stop(): void {
		clearInterval(timer);
		timer = undefined;
		s.abortedAt = undefined;
		size = cpu = undefined;
	}
	/** A turn opens: sampling starts. */
	function begin(): void {
		stop();
		progress("turn start");
		size = sizeOf(o.sessionFile());
		every = Math.min(60_000, Math.max(250, stuckTurnMs() / 4));
		timer = setInterval(() => void tick(), every);
		(timer as { unref?: () => void }).unref?.();
	}
	/** The turn ended. True when it ended because of this watch's abort: the caller restarts right now, before its idle handling. */
	function end(): boolean {
		const aborted = s.abortedAt !== undefined;
		stop();
		if (!aborted) s.capped = false;
		return aborted;
	}
	async function tick(): Promise<void> {
		if (!timer || busy) return;
		busy = true;
		try {
			let now = Date.now();
			if (o.exempt()) {
				s.lastAt = now;
				if (s.abortedAt !== undefined) s.abortedAt = now;
				return;
			}
			const grown = sizeOf(o.sessionFile());
			if (grown !== undefined) {
				if (size !== undefined && grown > size) progress("session file");
				size = grown;
			}
			const pid = o.pid();
			if (pid !== undefined && now - s.lastAt >= every) {
				const c = await sampler(pid);
				if (!timer) return;
				if (c !== undefined) {
					if (cpu !== undefined && c - cpu >= CPU_GROWTH_S) progress("cpu");
					cpu = c;
				}
				now = Date.now();
			}
			const minutes = Math.max(1, Math.round((now - s.lastAt) / 60_000));
			switch (stuckDecision(s, now, stuckTurnMs())) {
				case "abort":
					log(`stuck: ${o.key} no progress for ${minutes} min (${last}); aborting`);
					s.recoveries = s.recoveries.filter(at => now - at < STUCK_WINDOW_MS);
					s.recoveries.push(now);
					s.abortedAt = now;
					abortedAfter = minutes;
					o.stuck(minutes);
					o.abort();
					break;
				case "restart":
					log(`stuck: ${o.key} no progress for ${abortedAfter} min (${last}); restarting`);
					s.abortedAt = undefined;
					s.lastAt = now;
					o.restart(`no progress for ${abortedAfter} min`);
					break;
				case "cap":
					log(`stuck: ${o.key} no progress for ${minutes} min (${last}); recovery cap reached`);
					s.capped = true;
					o.capped(minutes);
					break;
			}
		} catch (e) {
			log(`stuck: ${o.key} check failed: ${e}`);
		} finally {
			busy = false;
		}
	}
	return { progress, begin, end, reset: stop, tick };
}
