/* ---------- 분할 창: the screen (docs/split-panes.md) ----------
   #split sits in #views from the second pane on, on a wide screen only: [list column][tree of panes]. The active pane holds the real #v-chat / #v-project
   (go() finds the sections by id), the list column holds convSide / #v-projects. Back to one pane or a narrow window: every node goes where it was and #split goes. */
let PNV = { el: null, side: null, tree: null, sig: "", order: null, list: "chat", cmp: null };

function paneRoot() {
  if (PNV.el) return PNV.el;
  PNV.order = [...$("#views").children].map(n => n.id);
  PNV.side = el("div", { class: "pane-side" });
  PNV.tree = el("div", { class: "pane-tree" });
  PNV.el = el("div", { id: "split", class: "view fill split", hidden: true }, PNV.side, PNV.tree);
  $("#views").append(PNV.el);
  return PNV.el;
}
// Called at the end of go()'s view switch, on a resize across 1100px, and by the model after every change.
function paneSync() {
  if (!PNV.el && paneCount() < 2) return;
  if (paneCount() < 2 || narrowChat()) { paneTeardown(); return; }
  const show = current === "chat" || current === "project" || paneAppIn();
  if (show) paneAdopt();
  paneRoot().hidden = !show;
  if (!show) return;
  $("#views").classList.remove("pp");
  const sig = paneSig();
  if (sig !== PNV.sig) { PNV.sig = sig; paneDraw(); }
  paneHeadSync();
}
// The active screen's head follows the screen without a redraw (a 모니터링 item opened inside it).
function paneHeadSync() {
  const a = paneFind(PN.active), n = a.kind === "app" && PNV.el.querySelector(".pane.on > .pane-hd .cv-hd-t"), name = n && paneName(a);
  if (n && n.lastChild.textContent !== name) { n.lastChild.textContent = name; n.title = name; }
}
matchMedia("(max-width: 1099px)").addEventListener("change", paneSync);

// 모니터링 is in the split only while a pane holds it (the active one or another); otherwise it takes the whole page as before and the panes wait.
const paneAppOf = () => paneLeaves().find(p => p.kind === "app") || null;
const paneAppIn = () => current === "monitoring" && (paneFind(PN.active).kind === "app" || !!paneAppOf());
// The real 모니터링 screen sits in a pane: as narrow as a phone's column, so its back arrow closes an open room first (30-kakao.js kkBack).
const paneMonIn = () => $("#v-monitoring").classList.contains("in-pane");

// What the active pane shows is whatever the page shows: go() and openTarget() change its content (a target open in another pane activates that pane instead).
function paneAdopt() {
  const a = paneFind(PN.active), h = paneHere();
  if (!a || PN.going || (a.kind === h.kind && a.t === h.t)) return;
  // Moving inside 모니터링 stays in the active app pane; coming to it from a conversation goes to an app pane.
  const dup = paneOpenIn(h.kind, h.t) || (h.kind === "app" && a.kind !== "app" && paneAppOf());
  if (dup) { PN.active = dup.id; dup.t = h.t; dup.dot = ""; paneForget(dup.id); }
  else Object.assign(a, { kind: h.kind, t: h.t, at: null, stick: true, dot: "" });
  paneForget(a.id);
  panePersist();
}
const paneShape = n => (paneLeaf(n) ? [n.id, n.kind, n.id === PN.active ? "" : n.t] : [n.dir, paneShape(n.a), paneShape(n.b)]);
const paneSig = () => JSON.stringify([PN.active, paneShape(PN.root)]);

function paneHome(n) {
  const views = $("#views");
  if (n === convSide) { $("#v-chat").insertBefore(convSide, convHead); return; }
  const next = PNV.order.slice(PNV.order.indexOf(n.id) + 1).map(id => document.getElementById(id)).find(x => x && x.parentNode === views);
  views.insertBefore(n, next || null);
}
function paneRelease() {
  for (const n of [$("#v-chat"), $("#v-project"), $("#v-projects"), $("#v-monitoring")]) {
    n.classList.remove("in-pane");
    if (n.parentNode !== $("#views")) paneHome(n);
  }
  if (convSide.parentNode !== $("#v-chat")) paneHome(convSide);
}
function paneTeardown() {
  if (!PNV.el) return;
  const chat = current === "chat", at = chat ? chatAnchor() : null, stick = chatStick;
  paneRelease();
  PNV.el.remove(); PNV.el = PNV.side = PNV.tree = null; PNV.sig = "";
  paneMirrorsClear();
  const pp = current === "project" && ppWide();
  $("#views").classList.toggle("pp", pp);
  $("#v-projects").hidden = !(pp || current === "projects");
  if (chat) paneLand(at, stick);
}
function paneDraw() {
  const chat = current === "chat", at = chat ? chatAnchor() : null, stick = chatStick;
  paneRelease();
  PNV.cmp = $("#composer");   // the open pane's section leaves the document while its pane is built, so the mirrors take the composer from here
  const kind = paneFind(PN.active).kind, sec = $(kind === "project" ? "#v-project" : kind === "app" ? "#v-monitoring" : "#v-chat");
  sec.classList.add("in-pane");
  // 모니터링 keeps the list that was there, so focusing it does not move every pane sideways.
  if (kind !== "app") PNV.list = kind;
  PNV.side.replaceChildren(PNV.list === "project" ? $("#v-projects") : convSide);
  PNV.tree.replaceChildren(paneNode(PN.root, sec));
  paneMirrorsPlace();
  if (chat) paneLand(at, stick);
}

function paneNode(n, sec) {
  if (paneLeaf(n)) return paneLeafEl(n, sec);
  const row = n.dir === "row", a = paneNode(n.a, sec), b = paneNode(n.b, sec);
  const bar = el("div", { class: "pane-bar", role: "separator", "aria-orientation": row ? "vertical" : "horizontal", title: "끌어서 크기를 바꿔요, 두 번 누르면 반반이에요" });
  const box = el("div", { class: `pane-${n.dir}` }, a, bar, b);
  paneShare(n, box);
  bar.addEventListener("pointerdown", ev => paneDrag(ev, n, box, bar));
  bar.addEventListener("dblclick", () => { n.r = 0.5; paneShare(n, box); panePersist(); });
  return box;
}
function paneShare(n, box) {
  box.firstElementChild.style.flex = `${n.r} 1 0px`;
  box.lastElementChild.style.flex = `${1 - n.r} 1 0px`;
}
function paneLeafEl(p, sec) {
  const on = p.id === PN.active;
  const x = el("button", { class: "ib pane-x", type: "button", "aria-label": "창 닫기", title: "창 닫기", onclick: () => paneClose(p.id) }, icon("close"));
  const kids = !on ? (p.kind === "chat" ? [paneMirror(p), x] : [paneMirror(p)]) : p.kind === "app" ? [paneHeadEl(p).head, sec] : [sec, x];
  const box = el("div", { class: `pane${on ? " on" : ""}`, "data-id": p.id, "data-kind": p.kind }, ...kids);
  box.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || p.id === PN.active || ev.target.closest(".pane-x")) return;
    const stub = !!ev.target.closest(".pane-chat .composer");
    paneFocus(p.id);
    if (stub) requestAnimationFrame(() => $("#text").focus());
  }, true);
  return box;
}
// The divider between two children: a drag changes r (a pane keeps 280px wide / 240px high at least, r stays 0.2..0.8); a double click is 반반.
function paneDrag(ev, n, box, bar) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const row = n.dir === "row", min = row ? 280 : 240, rect = box.getBoundingClientRect(), bw = row ? bar.offsetWidth : bar.offsetHeight;
  const total = (row ? rect.width : rect.height) - bw, from = row ? rect.left : rect.top;
  const lo = Math.max(0.2, min / total), hi = Math.min(0.8, 1 - min / total);
  bar.setPointerCapture(ev.pointerId);
  const move = e => {
    const r = ((row ? e.clientX : e.clientY) - from - bw / 2) / total;
    n.r = lo > hi ? 0.5 : Math.min(hi, Math.max(lo, r));
    paneShare(n, box);
  };
  const done = () => {
    bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", done); bar.removeEventListener("pointercancel", done);
    panePersist();
  };
  bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", done); bar.addEventListener("pointercancel", done);
}

// Goes to the pane's content (the page follows the active pane: address, back button) and puts the reader back where this pane was left.
function paneEnter(p) {
  const h = paneHere(), on = h.kind === p.kind && h.t === p.t && (p.kind !== "chat" || current === "chat");
  if (!on) paneGo(p.kind, p.t);
  else paneSync();
  paneLand(p.at, p.stick);
}
// The place of a conversation, the way closeChatList keeps it: the first message in view and its distance from the top, or the bottom.
function paneLand(at, stick) {
  if (current !== "chat") return;
  chatUnpin();
  if (!stick && at) { CV.pinTs = at.ts; CV.pinOff = at.off; chatPin("at"); }
  else timeline.scrollTop = timeline.scrollHeight;
  chatStick = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40;
  $("#chat-jump").hidden = chatStick;
}
