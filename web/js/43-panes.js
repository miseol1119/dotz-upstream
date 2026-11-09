/* ---------- 분할 창 (docs/split-panes.md): the model ----------
   Panes are leaves {id, kind: "chat"|"project", t, at, stick, dot} of a tree whose branches are {dir: "row"|"col", a, b, r} (r = a's share, 0.2..0.8);
   one is active and holds the real section. The screen is 43-panes-view.js, the inactive panes are 43-panes-mirror.js. With one pane (or none) nothing here touches the page. */
const PANE_KEY = "dotz-panes", PANE_MAX = 4;
let PN = { root: null, active: "", seq: 0 };
const paneLeaf = n => !n.dir;
function paneLeaves(n = PN.root) { return !n ? [] : paneLeaf(n) ? [n] : [...paneLeaves(n.a), ...paneLeaves(n.b)]; }
function paneCount() { return paneLeaves().length; }
function paneList() { return paneLeaves().map(p => ({ id: p.id, kind: p.kind, t: p.t, active: p.id === PN.active })); }
const paneFind = id => paneLeaves().find(p => p.id === id) || null;
const paneOpenIn = (kind, t) => paneLeaves().find(p => p.kind === kind && p.t === t) || null;
const paneNew = (kind, t) => ({ id: `p${++PN.seq}`, kind, t, at: null, stick: true, dot: "" });
// What the page shows now, as a pane's content (a screen that is neither chat nor project counts as the chat).
const paneHere = () => (current === "project" ? { kind: "project", t: ppCur } : { kind: "chat", t: target });
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

// Opens t next to the active pane (side: right | left | top | bottom). A target already open in a pane is not opened twice: that pane becomes active.
function paneSplit(t, kind, side) {
  if (paneCount() < 2) {
    const h = paneHere();
    PN.root = paneNew(h.kind, h.t); PN.active = PN.root.id;
  }
  const dup = paneOpenIn(kind, t);
  if (dup) { paneFocus(dup.id); return dup.id; }
  if (paneCount() >= PANE_MAX) return "";
  const at = paneFind(PN.active), np = paneNew(kind, t), first = side === "left" || side === "top";
  paneSwap(at, { dir: side === "left" || side === "right" ? "row" : "col", a: first ? np : at, b: first ? at : np, r: 0.5 });
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

// The saved layout, after the first go(): panes whose target is gone are dropped; the page keeps what it shows (the active pane takes it over, paneSync).
function paneRestore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(PANE_KEY) || "null"); } catch { /* a broken value is no layout */ }
  if (!d || !d.root) return;
  const ok = p => p && (p.kind === "chat" ? validTarget(p.t) : p.kind === "project" && typeof p.t === "string" && (p.t.startsWith("builtin:") || !PRJ || PRJ.projects.some(x => x.key === p.t)));
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
  const root = prune(d.root);
  if (!root) return;
  PN = { root, active: "", seq: Math.max(Number(d.seq) || 0, ...paneLeaves(root).map(p => Number(p.id.slice(1)) || 0)) };
  PN.active = (paneFind(d.active) || paneLeaves()[0]).id;
  paneSync();
  panePersist();
}
