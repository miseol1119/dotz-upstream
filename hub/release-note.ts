// The note of a release (docs/releases.md): one patch-note line per user-visible commit since the previous tag, grouped by topic.
// The convention in CONTRIBUTING.md feeds it: a subject says what changed for a user, and the first plain sentence of its 왜: (or else 어떻게:) follows as the reason, labels dropped. Internal work closes the note as one count.
import { scrub, type Term } from "./public-scrub.ts";

export type NoteCommit = { subject: string; body?: string; files: string[] };
export type NoteInput = { tag: string; commits: readonly NoteCommit[]; terms: readonly Term[] };

export const NOTE_LOG_FORMAT = "%x1e%s%x1d%b%x1f";
const NOTE_MAX = 120_000; // GitHub takes 125,000 characters in a release body
const INTERNAL = "내부 정리";
const OTHER = "그 밖의 변경";
const NOT_A_CHANGE = /^(?:release: |Merge )/;
const INTERNAL_SUBJECT = /^내부 정리\s*:/;
const TICKET = /\s*\(#\d+\)$/;
const LABEL_SPLIT = /(?:^|\s)(왜|어떻게)\s*:\s*/m;
// A reason that quotes, names a file or runs long reads like the conversation behind the change, not a patch note.
const NOT_A_REASON = /["“”`]|[\w.-]+\/[\w.-]+\.\w+/;
const REASON_MAX = 160;
const TEST_FILE = /\.test\.[jt]sx?$|(?:^|\/)(?:test|tests|fixtures)\//;
// Plain Korean topics, by where a commit's files are; the first match per file wins and the commit goes to the topic with the most files.
const TOPICS: [topic: string, re: RegExp][] = [
	["메신저", /^(?:hub\/(?:messenger|discord|telegram|slack|kakao|jandi)|docs\/messengers|features\/kakao)/],
	["메일·답장·댓글", /^(?:features\/(?:reply-drafts|webmail|comments|publish-voice|youtube)|hub\/(?:mail|comments))/],
	["설치·업데이트", /^(?:install\.sh|setup\.ts|onboard\/|firstrun\/|\.github\/|hub\/(?:selfupdate|release|update|history-rewrite|git-hooks|onboarding))/],
	["세션·작업 실행", /^(?:extension\/|MODE|hub\/(?:lane|orchestrator|runtime\/|session|prompts|bgwork|watch))/],
	["웹 앱", /^web\//],
	["소개 사이트", /^site\//],
	["문서", /^(?:docs\/|README|CONTRIBUTING|THIRD_PARTY)/],
	["부가 기능", /^features\//],
	["게이트웨이", /^hub\//],
];

export function parseNoteCommits(raw: string): NoteCommit[] {
	return raw.split("\x1e").filter(r => r.trim()).map(record => {
		const [head, files] = record.split("\x1f");
		const [subject, body = ""] = head.split("\x1d");
		return { subject: subject.trim(), body: body.trim(), files: files.split("\n").map(f => f.trim()).filter(Boolean) };
	});
}

function topicOf(files: readonly string[]): string {
	const counts = new Map<string, number>();
	const product = files.filter(f => !TEST_FILE.test(f) && f !== "VERSION");
	if (files.length && !product.length) return INTERNAL;
	for (const file of product) {
		const topic = TOPICS.find(([, re]) => re.test(file))?.[0] ?? OTHER;
		counts.set(topic, (counts.get(topic) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? OTHER;
}

function firstSentence(text: string): string {
	const sentence = text.trim().split(/(?<=[.!?])\s+|\n/)[0]?.replace(TICKET, "").trim() ?? "";
	return sentence && !/[.!?]$/.test(sentence) ? `${sentence}.` : sentence;
}

// One or two sentences: what changed, then why. Labelled parts may sit in the body or, from a one-line commit, in the subject itself.
function noteItem({ subject, body = "" }: NoteCommit): string {
	const inline = subject.split(LABEL_SPLIT);
	const what = inline[0].replace(TICKET, "").trim();
	const labelled = [...inline.slice(1), ...body.split(LABEL_SPLIT).slice(1)];
	const parts = (label: string) => labelled.flatMap((part, i) => (i % 2 === 0 && part === label ? [labelled[i + 1] ?? ""] : []));
	const reason = [...parts("왜"), ...parts("어떻게")].map(firstSentence).find(s => s && s.length <= REASON_MAX && !NOT_A_REASON.test(s));
	if (!reason) return what;
	return `${/[.!?]$/.test(what) ? what : `${what}.`} ${reason}`;
}

export function buildReleaseNote({ tag, commits, terms }: NoteInput): string {
	const groups = new Map<string, string[]>();
	for (const c of commits) {
		if (NOT_A_CHANGE.test(c.subject)) continue;
		const topic = INTERNAL_SUBJECT.test(c.subject) ? INTERNAL : topicOf(c.files);
		groups.set(topic, [...(groups.get(topic) ?? []), noteItem(c)]);
	}
	const order = [...TOPICS.map(([topic]) => topic), OTHER].filter(topic => groups.has(topic));
	const sections = order.map(topic => `### ${topic}\n${groups.get(topic)!.map(subject => `- ${subject}`).join("\n")}`);
	if (!sections.length) sections.push("이번 버전에는 바뀐 기능이 없어요.");
	if (groups.has(INTERNAL)) sections.push(`내부 정리 ${groups.get(INTERNAL)!.length}건도 함께 들어갔어요.`);
	const note = scrub([`# dotz ${tag}`, ...sections].join("\n\n"), terms).text;
	return note.length > NOTE_MAX ? `${note.slice(0, note.lastIndexOf("\n", NOTE_MAX))}\n\n… 나머지는 커밋 기록을 봐 주세요.` : note;
}
