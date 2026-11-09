/* ---------- 분할 창: keys (docs/split-panes.md 단축키) ----------
   ⌥⌘ on a Mac, Ctrl+Alt elsewhere (ev.code, because Option changes ev.key): \ splits right, - splits down, 1..4 go to a pane, W closes the active one.
   ⌘\ (sidebar), ⌘1..6 (tabs) and ⌘K never get here: they have no Alt.
   Ctrl+Shift+\ also splits right on every system: AltGr arrives as Ctrl+Alt on Windows, so Ctrl+Alt+\ can collide with typing \ there. */
const PANE_KEY_SIDE = { Backslash: "right", Minus: "bottom" };
// The rows the screen tour lists (42-intro.js introKeys); none below 1100px, where nothing splits.
const paneTourKeys = () => {
  if (narrowChat()) return [];
  const m = isMac ? "⌥⌘" : "Ctrl+Alt+";
  return [[isMac ? "⌥⌘\\" : "Ctrl+Shift+\\", "칸 나누기"], [`${m}1 ~ ${m}4`, "칸 이동"], [`${m}W`, "칸 닫기"]];
};

// A split from the keyboard opens the main chat, or when that is open 작업내역, or the first running session that is not open yet.
function paneKeySplit(side) {
  if (paneCount() >= PANE_MAX) { toast("창은 네 개까지 열 수 있어요", true); return; }
  const here = paneHere(), shown = t => (paneCount() > 1 ? !!paneOpenIn("chat", t) : here.kind === "chat" && here.t === t);
  const { wait, run } = sessionsNow();
  const t = [MAIN, "worklog", ...[...wait, ...run].map(l => `lane:${l.name}`)].find(x => !shown(x));
  if (!t) { toast("나란히 열 대화가 더 없어요", true); return; }
  paneSplit(t, "chat", side);
}
document.addEventListener("keydown", ev => {
  const mod = isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
  const shiftSplit = ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && ev.code === "Backslash";
  if (ev.isComposing || (!shiftSplit && (!ev.altKey || ev.shiftKey || !mod)) || narrowChat() || document.querySelector("dialog[open]:not([data-leaving])")) return;
  const side = shiftSplit ? "right" : PANE_KEY_SIDE[ev.code], n = /^Digit([1-4])$/.exec(ev.code || "")?.[1];
  if ((!side && !n && ev.code !== "KeyW") || (current !== "chat" && current !== "project")) return;
  ev.preventDefault();
  if (side) paneKeySplit(side);
  else if (n) { const p = paneList()[n - 1]; if (p) paneFocus(p.id); }
  else if (paneCount() > 1) paneClose(PN.active);
});
