/* ---------- 분할 창: an inactive pane is a mirror (docs/split-panes.md) ----------
   Head (same markup as the chat head), a copy of the timeline taken when the pane went inactive, the messages that came since (the one event stream,
   99-boot.js calls paneEvent), and a composer stub that shows the draft. Nothing here exists with one pane. */
const PNM = new Map();   // pane id -> its mirror {p, node, list, wrap, keys, q, dot, state}
const PNS = new Map();   // pane id -> what it showed when it went inactive {n, keys}
const paneDirty = new Set();
let paneRaf = 0;

function paneForget(id) { PNM.delete(id); PNS.delete(id); }
function paneMirrorsClear() { PNM.clear(); PNS.clear(); paneDirty.clear(); }
function paneLeave(p) {
  PNM.delete(p.id);
  if (p.kind === "chat" && current === "chat" && target === p.t) {
    p.at = chatAnchor(); p.stick = chatStick;
    PNS.set(p.id, { n: tl.cloneNode(true), keys: new Set(ts(p.t).mk) });
  } else if (p.kind === "project" && current === "project" && ppCur === p.t) PNS.set(p.id, { n: $("#v-project").cloneNode(true) });
  else if (p.kind === "view" && current === paneViewName(p.t)) PNS.set(p.id, { n: $(`#v-${current}`).cloneNode(true) });
  else PNS.delete(p.id);
}

// A view pane is named by its screen's title, a 모니터링 item by the item.
function paneViewLabel(t) {
  const [name, k] = String(t).split("|"), it = k && monItems().find(i => i.key === k);
  return it ? it.name : name === "home" ? "홈" : titles[name] || name;
}
const paneName = p => (p.kind === "view" ? paneViewLabel(p.t) : p.t === "builtin:custom" ? "커스텀" : targetName(p.t));
function paneState(p) {
  if (p.kind === "project") return "프로젝트";
  if (p.kind === "view") return String(p.t).includes("|") ? titles[paneViewName(p.t)] : "";
  const i = targetInfo(p.t);
  return isRelayT(p.t) ? RELAY.note[p.t] || "" : isFixedT(p.t) ? FIXED_DESC[p.t] : i.alive ? statusKo(i.status) : "종료됨";
}
// A copy that lives on its own: no id twice on the page, no hidden or in-pane marks of the real section.
function paneBare(n) {
  n.removeAttribute("id"); n.hidden = false; n.classList.remove("in-pane");
  for (const x of n.querySelectorAll("[id]")) x.removeAttribute("id");
  return n;
}

function paneMirror(p) {
  const had = PNM.get(p.id);
  if (had) return had.node;
  const snap = PNS.get(p.id);
  PNS.delete(p.id);
  const { head, dot, state } = paneHeadEl(p);
  const m = { p, dot, state, keys: new Set(), q: [] };
  if (p.kind === "chat") {
    m.list = snap ? paneBare(snap.n) : el("div", { class: "tl-in" });
    m.wrap = el("div", { class: "timeline pane-tl" }, m.list);
    m.wrap.addEventListener("scroll", () => edgeFade(m.wrap), { passive: true });
    if (snap) m.keys = snap.keys; else paneFill(m);
    const draft = String(ts(p.t).draft || "");
    const stub = el("button", { class: "pane-cmp", type: "button", "aria-label": "이 창에서 메시지 쓰기", onclick: () => { paneFocus(p.id); $("#text").focus(); } },
      el("span", { class: "pane-cmp-plus" }, icon("add")), el("span", { class: draft ? "pane-cmp-t" : "pane-cmp-t pane-cmp-ph" }, draft || "메시지 또는 /명령"));
    m.node = el("div", { class: "pane-mir" }, head, m.wrap, stub);
  } else {
    m.node = el("div", { class: "pane-mir" }, head, el("div", { class: "pane-pj" }, snap ? paneBare(snap.n) : el("div", { class: "empty", text: p.kind === "view" ? "이 창을 누르면 화면이 열려요" : "이 창을 누르면 프로젝트가 열려요" })));
  }
  PNM.set(p.id, m);
  return m.node;
}
// The head of a mirror, and of the active pane when it holds a screen (which has no head of its own): name, state line, close.
function paneHeadEl(p) {
  const name = paneName(p), s = paneState(p), dot = el("span", { class: `dot ${p.dot}` }), state = el("span", { class: "cv-hd-s", text: s });
  dot.hidden = !p.dot;
  const x = el("button", { class: "ib pane-x", type: "button", "aria-label": "창 닫기", title: "창 닫기", onclick: () => paneClose(p.id) }, icon("close"));
  return { head: el("div", { class: "pane-hd" }, el("span", { class: "cv-hd-b" }, el("span", { class: "cv-hd-t", title: name }, dot, name), s || p.kind !== "view" ? state : null), x), dot, state };
}
// A mirror without a copy (the page was reloaded, or the pane lost its screen to another pane): drawn from the messages the page holds.
function paneFill(m) {
  const t = m.p.t, s = ts(t);
  clear(m.list);
  m.keys = new Set(s.mk);
  for (const e of s.msgs.slice(-60)) paneAppend(m, e);
  if (!s.hLoaded && !s.loading) loadTarget(t, true).then(() => { if (PNM.get(m.p.id) === m) { paneFill(m); m.wrap.scrollTop = m.wrap.scrollHeight; } }, () => { /* the pane shows what it has */ });
}
// msgNode reads the global target (a lane report's look), so it is the pane's own for the call.
function paneAppend(m, e) {
  const was = target;
  let n = null;
  target = m.p.t;
  try { n = msgNode(e); } finally { target = was; }
  if (!n) return;
  n.dataset.ts = e.ts;
  const key = e.kind === "out" && e.update_key ? `${e.target ?? ""}|${e.update_key}` : "";
  if (key) {
    for (const old of m.list.querySelectorAll("[data-pk]")) if (old.dataset.pk === key) old.remove();
    n.dataset.pk = key;
  }
  m.list.append(n);
}
function paneMirrorsPlace() {
  for (const m of PNM.values()) {
    if (!m.wrap) continue;
    const at = m.p.stick ? null : m.p.at, n = at && [...m.list.querySelectorAll("[data-ts]")].find(x => x.dataset.ts === at.ts);
    m.wrap.scrollTop = n ? n.getBoundingClientRect().top - m.wrap.getBoundingClientRect().top + m.wrap.scrollTop - at.off : m.wrap.scrollHeight;
    edgeFade(m.wrap);
  }
}

// The one event stream (99-boot.js): a message of an inactive pane's target is added to its mirror, one frame's worth at a time.
function paneEvent(e) {
  if (!PNM.size) return;
  const t = eventTarget(e);
  if (!t) return;
  const k = msgKey(e);
  for (const m of PNM.values()) {
    if (m.p.kind !== "chat" || m.p.t !== t || !ts(t).mk.has(k) || m.keys.has(k)) continue;
    m.keys.add(k); m.q.push(e); paneDirty.add(m);
  }
  if (paneDirty.size && !paneRaf) paneRaf = requestAnimationFrame(paneFlush);
}
function paneFlush() {
  paneRaf = 0;
  for (const m of paneDirty) {
    const w = m.wrap, stuck = w.scrollTop + w.clientHeight >= w.scrollHeight - 40;
    for (const e of m.q.splice(0)) paneAppend(m, e);
    if (stuck) w.scrollTop = w.scrollHeight;
  }
  paneDirty.clear();
}
// notify() (02-basic-markdown.js): a notice for a target an inactive pane shows is that pane's head dot, not a toast.
function paneNotify(e) {
  if (!PNV.el || PNV.el.hidden) return false;
  const t = e.kind === "lane_report" ? `lane:${e.lane || ""}` : String(e.target || "");
  const p = paneLeaves().find(x => x.t === t && x.id !== PN.active);
  if (!p) return false;
  p.dot = e.tone || (e.kind === "lane_report" ? "ok" : e.target === "alert" ? "err" : "att");
  const m = PNM.get(p.id);
  if (m) { m.dot.className = `dot ${p.dot}`; m.dot.hidden = false; }
  panePersist();
  return true;
}
// convPaint (31-conversations.js) keeps the state line of every mirror's head current.
function paneHeads() {
  for (const m of PNM.values()) {
    const s = paneState(m.p);
    if (m.state.textContent !== s) m.state.textContent = s;
  }
}
