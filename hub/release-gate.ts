// The release gate (docs/releases.md): the full suite on the head of origin/main before a slot dispatches release.yml. Not a CI step: the suite has
// only been shown green on the owner's machine. The owner's slot watch kills a tick after ~2 minutes and the suite takes minutes, so the gate runs
// across ticks: one tick starts a detached runner (`release.ts --gate-run`) and returns; later ticks only read the state it leaves in the watch's
// state dir. The runner keeps its own clone there, because the install that runs the watch is usually a tarball with no .git.
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../firstrun/atomic.ts"; // not hub/config.ts: it needs a data dir at load

type Output = { code: number; out: string };
export type GitFn = (args: readonly string[], cwd: string) => Promise<Output>;
export type SuiteResult = { green: boolean; failed: string[]; detail: string };
export type SuiteFn = (dir: string) => Promise<SuiteResult>;

// What the tick needs from the machine: start a detached runner (its pid), ask if a pid lives, kill a runner with its children.
export type GateEnv = {
	origin: string;
	spawn: (cmd: readonly string[], logFile: string) => number;
	alive: (pid: number) => boolean;
	kill: (pid: number) => void;
};
export type GateCtx = GateEnv & { stateDir: string; slot: string; now: Date };
export type GateOutcome =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "nothing"; sha: string } // nothing on main since the newest release tag: the suite was not run
	| { kind: "green"; sha: string; release?: ReleaseResult } // release: what releasing that commit did (a runner from before the release moved here has none)
	| { kind: "red"; sha: string; failed: string[]; detail: string }
	| { kind: "unrunnable"; reason: string };

export type ReleaseResult = { code: number; out: string };
type RunFile = { slot: string; pid: number; startedAt: string };
type ResultFile = { slot: string; sha?: string; nothing?: boolean; green?: boolean; failed?: string[]; detail?: string; release?: ReleaseResult; error?: string };
const RELEASE_OUT_CHARS = 1500;

const RUN_FILE = "gate-run.json";
const RESULT_FILE = "gate-result.json";
const LOG_FILE = "gate.log";
const MAX_RUN_MS = 45 * 60_000; // the suite's own limit is 40 minutes; past this the run is taken for lost
const SUITE_TIMEOUT_MS = 40 * 60_000;
const LAST_RESULT = ".dotz-last-test.xml"; // written by every run: bunfig.toml, [test.reporter]

function readState<T>(file: string): T | null {
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return null; // half-written or damaged: taken as no state, the tick starts over
	}
}

export function clearGate(stateDir: string): void {
	rmSync(join(stateDir, RUN_FILE), { force: true });
	rmSync(join(stateDir, RESULT_FILE), { force: true });
}

function stopRun(c: GateCtx, run: RunFile): void {
	if (c.alive(run.pid)) c.kill(run.pid);
	clearGate(c.stateDir);
}

// Reads the state of the gate for this slot, and cleans up what a lost or old run left. Fast: files and one pid check, no git.
export function gateStatus(c: GateCtx): GateOutcome {
	const run = readState<RunFile>(join(c.stateDir, RUN_FILE));
	if (!run) {
		clearGate(c.stateDir);
		return { kind: "idle" };
	}
	if (run.slot !== c.slot) {
		stopRun(c, run); // a new slot: the old run is stopped before a new one starts
		return { kind: "idle" };
	}
	const result = readState<ResultFile>(join(c.stateDir, RESULT_FILE));
	if (result && result.slot === c.slot) {
		if (result.error !== undefined || !result.sha) {
			stopRun(c, run);
			return { kind: "unrunnable", reason: result.error ?? "결과 파일이 비어 있어요" };
		}
		if (result.nothing) return { kind: "nothing", sha: result.sha };
		if (result.green) return { kind: "green", sha: result.sha, release: result.release };
		return { kind: "red", sha: result.sha, failed: result.failed ?? [], detail: result.detail ?? "" };
	}
	if (c.now.getTime() - Date.parse(run.startedAt) > MAX_RUN_MS) {
		stopRun(c, run);
		return { kind: "unrunnable", reason: "45분이 지나도 시험이 끝나지 않아 멈췄어요" };
	}
	if (!c.alive(run.pid)) {
		stopRun(c, run);
		return { kind: "unrunnable", reason: "시험 프로세스가 결과 없이 끝났어요" };
	}
	return { kind: "running" };
}

// Starts the runner for this slot and records its pid. `cmd` is the runner's command line (release.ts --gate-run ...).
export function startGate(c: GateCtx, cmd: readonly string[]): void {
	clearGate(c.stateDir);
	const pid = c.spawn(cmd, join(c.stateDir, LOG_FILE));
	writeAtomic(join(c.stateDir, RUN_FILE), `${JSON.stringify({ slot: c.slot, pid, startedAt: c.now.toISOString() } satisfies RunFile)}\n`);
}

export function realGateEnv(origin: string): GateEnv {
	return {
		origin,
		spawn: (cmd, logFile) => {
			const fd = openSync(logFile, "w");
			try {
				const proc = Bun.spawn([...cmd], { stdin: "ignore", stdout: fd, stderr: fd, detached: true, timeout: MAX_RUN_MS }); // detached: its own process group
				proc.unref();
				return proc.pid;
			} finally {
				closeSync(fd);
			}
		},
		alive: pid => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false; // no such process
			}
		},
		kill: pid => {
			try {
				process.kill(-pid, "SIGTERM"); // the group: the suite's children go with it
			} catch {
				// already gone
			}
		},
	};
}

// hasNewCommits(repo, sha): whether `sha` has anything to release since the newest release tag in `repo`; release.ts passes the rule --auto uses.
// release(dir, sha): releases the commit the suite was green on, from the worktree `dir`; its code and last output go into the result.
export type RunGateOptions = {
	stateDir: string;
	slot: string;
	origin: string;
	git: GitFn;
	runSuite: SuiteFn;
	hasNewCommits: (repo: string, sha: string) => Promise<boolean>;
	release?: (dir: string, sha: string) => Promise<ReleaseResult>;
};

// The detached runner. Clones origin once into the state dir, fetches main and the tags, leaves a "nothing" result when main has nothing to release
// since the newest tag (no suite), otherwise runs the suite on a worktree of the fetched commit, removes the worktree
// and leaves the result file for the ticks. Any failure to get that far is written as an error result: the gate did not run, the slot stays open.
export async function runGate(o: RunGateOptions): Promise<void> {
	const resultFile = join(o.stateDir, RESULT_FILE);
	const repo = join(o.stateDir, "gate-repo");
	const tree = join(o.stateDir, "gate-tree");
	try {
		if (!existsSync(join(repo, ".git")) || (await o.git(["rev-parse", "--git-dir"], repo)).code !== 0) {
			const part = `${repo}.part`; // cloned aside and renamed, so a killed clone never looks like a repo
			rmSync(repo, { recursive: true, force: true });
			rmSync(part, { recursive: true, force: true });
			const cloned = await o.git(["clone", "--quiet", "--no-checkout", o.origin, part], o.stateDir);
			if (cloned.code !== 0) throw new Error(`저장소를 받지 못했어요: ${cloned.out}`);
			renameSync(part, repo);
		}
		const fetched = await o.git(["fetch", "--quiet", "--tags", "origin", "main"], repo);
		if (fetched.code !== 0) throw new Error(`origin/main을 가져오지 못했어요: ${fetched.out}`);
		const head = await o.git(["rev-parse", "origin/main"], repo);
		if (head.code !== 0) throw new Error(`origin/main의 커밋을 읽지 못했어요: ${head.out}`);
		const sha = head.out;
		if (!(await o.hasNewCommits(repo, sha))) {
			writeAtomic(resultFile, `${JSON.stringify({ slot: o.slot, sha, nothing: true } satisfies ResultFile)}\n`);
			return;
		}
		// A runner killed in the middle of a run leaves its worktree behind: the fixed path is cleared before the next one.
		if (existsSync(tree)) await o.git(["worktree", "remove", "--force", tree], repo);
		rmSync(tree, { recursive: true, force: true });
		await o.git(["worktree", "prune"], repo);
		const added = await o.git(["worktree", "add", "--detach", tree, sha], repo);
		if (added.code !== 0) throw new Error(`시험용 작업 폴더를 만들지 못했어요: ${added.out}`);
		try {
			const suite = await o.runSuite(tree);
			let release: ReleaseResult | undefined;
			if (suite.green && o.release) {
				const made = await o.release(tree, sha).catch((e: unknown): ReleaseResult => ({ code: 1, out: e instanceof Error ? e.message : String(e) }));
				release = { code: made.code, out: made.out.slice(-RELEASE_OUT_CHARS) };
			}
			writeAtomic(resultFile, `${JSON.stringify({ slot: o.slot, sha, ...suite, ...(release ? { release } : {}) } satisfies ResultFile)}\n`);
		} finally {
			await o.git(["worktree", "remove", "--force", tree], repo);
			rmSync(tree, { recursive: true, force: true });
		}
	} catch (e) {
		writeAtomic(resultFile, `${JSON.stringify({ slot: o.slot, error: e instanceof Error ? e.message : String(e) } satisfies ResultFile)}\n`);
	}
}

async function spawn(cmd: readonly string[], cwd: string): Promise<Output> {
	const proc = Bun.spawn([...cmd], { cwd, env: process.env, stdout: "pipe", stderr: "pipe", timeout: SUITE_TIMEOUT_MS });
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return { code: await proc.exited, out: `${out}${err}` };
}

// The test files that failed, from the junit file the run leaves in `dir`.
export function failedFiles(xml: string): string[] {
	return [...new Set([...xml.matchAll(/<testsuite name="[^"]*" file="([^"]*)"[^>]* failures="[1-9]/g)].map(m => m[1]!))];
}

// Installs from the lockfile and runs `bun run test` (the heavy slot, like any full run) in `dir`. An install that fails throws: that is the
// gate not running, not the suite failing.
export async function runSuiteIn(dir: string): Promise<SuiteResult> {
	const installed = await spawn(["bun", "install", "--frozen-lockfile"], dir);
	if (installed.code !== 0) throw new Error(`bun install이 실패했어요: ${installed.out.trim().slice(-300)}`);
	const tested = await spawn(["bun", "run", "test"], dir);
	const green = tested.code === 0 && /^\s*0 fail/m.test(tested.out);
	if (green) return { green, failed: [], detail: "" };
	const file = join(dir, LAST_RESULT);
	return { green, failed: existsSync(file) ? failedFiles(readFileSync(file, "utf8")) : [], detail: tested.out.trim().slice(-300) };
}
