/* ---------- 분할 창 (docs/split-panes.md): the model ----------
   Panes are leaves {id, kind: "chat"|"project"|"app", t, at, stick, dot} (an app pane is 모니터링: t is "list", an item key, or an item key and
   "#kk:<room>" / "#cm:<source>:<thread>:<title>" / "#dm:<id>:<peer>" for a room, thread or DM of an in-app app, owner 78c482b1) of a tree: one pane, or two side by side as {dir: "row", a, b, r} (r = a's share, 0.2..0.8;
   at most two, left and right only, owner 950d715f);
   one is active and holds the real section. The screen is 43-panes-view.js, the inactive panes are 43-panes-mirror.js. With one pane (or none) nothing here touches the page. */
const PANE_KEY = "dotz-panes", PANE_MAX = 2;
let PN = { root: null, active: "", seq: 0 };
const paneLeaf = n => !n.dir;
function paneLeaves(n = PN.root) { return !n ? [] : paneLeaf(n) ? [n] : [...paneLeaves(n.a), ...paneLeaves(n.b)]; }
function paneCount() { return paneLeaves().length; }
function paneList() { return paneLeaves().map(p => ({ id: p.id, kind: p.kind, t: p.t, active: p.id === PN.active })); }
const paneFind = id => paneLeaves().find(p => p.id === id) || null;
const paneOpenIn = (kind, t) => paneLeaves().find(p => p.kind === kind && p.t === t) || null;
const paneNew = (kind, t) => ({ id: `p${++PN.seq}`, kind, t, at: null, stick: true, dot: "" });
// The room, thread or DM open in an in-app app (30-kakao.js, 30-monitoring-comments*.js), as the part of an app pane's t after "#".
function paneAppSub() {
  const sel = monItems().find(i => i.key === MON.sel);
  if (kkItem(sel) && KK.open) return `kk:${enc(KK.open)}`;
  if (!sel || !cmAppOf(sel.key) || CM.app !== cmAppOf(sel.key)) return "";   // CM still holds the last app's thread until this item paints
  return DM.open ? `dm:${enc(DM.open.id)}:${enc(DM.open.peer || "")}` : CM.open ? `cm:${enc(CM.open.source)}:${enc(CM.open.thread)}:${enc(CM.open.title || "")}` : "";
}
// The 모니터링 screen as a pane's content: its list, or the item open in it with its room, thread or DM.
function paneAppKey() {
  if (MON.list || !MON.sel) return "list";
  const sub = paneAppSub();
  return sub ? `${MON.sel}#${sub}` : MON.sel;
}
const paneAppParts = t => { const [key, sub = ""] = String(t).split("#"), [kind = "", a = "", b = "", c = ""] = sub.split(":").map(decodeURIComponent); return { key, kind, a, b, c }; };
// Opens an app pane's item, then its room, thread or DM the way its row would.
// Midway (the item open, its room not yet) the page is neither: the active pane does not follow it (paneAdopt) and takes t once it is there.
function paneGoApp(t) {
  const { key, kind, a, b, c } = paneAppParts(t);
  PN.going = true;
  try {
    go("monitoring", key);
    if (kind === "kk") kkOpen(a);
    else if (kind === "cm") { cmTab("comments"); cmOpen(CM.threads.find(x => x.source === a && x.thread === b) || { source: a, thread: b, title: c }); }
    else if (kind === "dm") { cmTab("dm"); dmOpen(DM.convs.find(c => c.id === a) || { id: a, peer: b }); }
  } finally { PN.going = false; }
  const p = paneFind(PN.active);
  if (p && p.kind === "app") { p.t = t; paneHeadSync(); panePersist(); }
}
// What the page shows now, as a pane's content (the terminal view and the other screens count as the chat).
const paneHere = () => (current === "project" ? { kind: "project", t: ppCur } : current === "monitoring" ? { kind: "app", t: paneAppKey() } : { kind: "chat", t: target });
const paneGo = (kind, t) => (kind === "app" ? paneGoApp(t) : go(kind, t));
function paneParent(n, p) {
  if (paneLeaf(n)) return null;
  return n.a === p || n.b === p ? n : paneParent(n.a, p) || paneParent(n.b, p);
}
function paneSwap(old, next) {
  const par = paneParent(PN.root, old);
  if (!par) PN.root = next; else if (par.a === old) par.a = next; else par.b = next;
}
function panePersist() {
  try {
    if (paneCount() < 2) localStorage.removeItem(PANE_KEY);
    else localStorage.setItem(PANE_KEY, JSON.stringify({ root: PN.root, active: PN.active, seq: PN.seq }));
  } catch { /* storage blocked: the layout only lasts until reload */ }
}

// Opens t next to the active pane, or next to pane atId (side: right | left). A target already open in a pane is not opened twice: that pane becomes active.
function paneSplit(t, kind, side, atId = "") {
  if (paneCount() < 2) {
    const h = paneHere();
    PN.root = paneNew(h.kind, h.t); PN.active = PN.root.id;
  }
  const dup = paneOpenIn(kind, t);
  if (dup) { paneFocus(dup.id); return dup.id; }
  if (paneCount() >= PANE_MAX) return "";
  const at = paneFind(atId) || paneFind(PN.active), np = paneNew(kind, t), first = side === "left";
  paneSwap(at, { dir: "row", a: first ? np : at, b: first ? at : np, r: 0.5 });
  paneFocus(np.id);
  return np.id;
}
function paneReplace(id, t, kind) {
  const p = paneFind(id);
  if (!p) return false;
  const dup = paneOpenIn(kind, t);
  if (dup && dup !== p) { paneFocus(dup.id); return false; }
  if (p.kind === kind && p.t === t) return true;
  Object.assign(p, { kind, t, at: null, stick: true, dot: "" });
  paneForget(p.id);
  if (p.id === PN.active) paneEnter(p); else paneSync();
  panePersist();
  return true;
}
function paneFocus(id) {
  const p = paneFind(id);
  if (!p || p.id === PN.active) return;
  paneLeave(paneFind(PN.active));
  PN.active = p.id; p.dot = "";
  paneEnter(p);
  panePersist();
}
// A pane dragged by its head: onto the middle of another pane the two swap places, onto an edge (side) it moves next to that pane.
function paneMove(id, dst, side) {
  const x = paneFind(id), y = paneFind(dst);
  if (!x || !y || x === y) return false;
  if (side === "center") {
    const px = paneParent(PN.root, x), py = paneParent(PN.root, y);
    if (px === py) [px.a, px.b] = [px.b, px.a];
    else {
      if (px.a === x) px.a = y; else px.b = y;
      if (py.a === y) py.a = x; else py.b = x;
    }
  } else {
    const par = paneParent(PN.root, x), first = side === "left";
    paneSwap(par, par.a === x ? par.b : par.a);
    paneSwap(y, { dir: "row", a: first ? x : y, b: first ? y : x, r: 0.5 });
  }
  paneSync();
  panePersist();
  return true;
}
function paneClose(id) {
  const p = paneFind(id);
  if (!p || paneCount() < 2) return false;
  const par = paneParent(PN.root, p), sib = par.a === p ? par.b : par.a;
  paneSwap(par, sib);
  paneForget(id);
  if (PN.active === id) {
    const next = paneLeaves(sib)[0];
    PN.active = next.id; next.dot = "";
    paneEnter(next);
  } else paneSync();
  panePersist();
  return true;
}

// A saved layout {root, active, seq} as a live tree: panes whose target is gone or already shown are dropped, the first PANE_MAX stay, side by side
// (a layout saved with three or four panes, or one above another, before 950d715f). null when nothing is left.
function panePrune(d) {
  if (!d || !d.root) return null;
  const ok = p => p && (p.kind === "chat" ? validTarget(p.t) : p.kind === "app" ? typeof p.t === "string" && !!p.t : p.kind === "project" && typeof p.t === "string" && (p.t.startsWith("builtin:") || !PRJ || PRJ.projects.some(x => x.key === p.t)));
  const seen = new Set();
  let left = PANE_MAX;
  const prune = n => {
    if (!n || typeof n !== "object") return null;
    if (n.dir) {
      const a = prune(n.a), b = prune(n.b);
      return !a ? b : !b ? a : { dir: n.dir === "col" ? "col" : "row", a, b, r: Math.min(0.8, Math.max(0.2, Number(n.r) || 0.5)) };
    }
    const key = `${n.kind}|${n.t}`;
    if (!ok(n) || seen.has(key) || left < 1) return null;
    seen.add(key); left--;
    return { id: String(n.id), kind: n.kind, t: n.t, at: n.at && n.at.ts ? { ts: String(n.at.ts), off: Number(n.at.off) || 0 } : null, stick: n.stick !== false, dot: "" };
  };
  const tree = prune(d.root);
  if (!tree) return null;
  const lv = paneLeaves(tree), root = lv.length < 2 ? lv[0] : { dir: "row", a: lv[0], b: lv[1], r: tree.dir === "row" && tree.a === lv[0] ? tree.r : 0.5 };
  return { root, active: (lv.find(p => p.id === d.active) || lv[0]).id, seq: Math.max(Number(d.seq) || 0, ...lv.map(p => Number(p.id.slice(1)) || 0)) };
}
// The saved layout, after the first go(): the page keeps what it shows (the active pane takes it over, paneSync).
function paneRestore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(PANE_KEY) || "null"); } catch { /* a broken value is no layout */ }
  const r = panePrune(d);
  if (!r) return;
  PN = r;
  paneSync();
  panePersist();
}
