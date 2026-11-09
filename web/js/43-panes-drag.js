/* ---------- 분할 창: dragging (docs/split-panes.md 배치) ----------
   A row of the chat list (a conversation) or of the project list (a project), or a pane's head, is pulled over a pane: after 6px a ghost of the title follows the pointer and the
   hovered zone (the outer quarter at an edge, or the middle) is drawn over that pane. Pointer events on the document, so nothing is added to the rows; Escape cancels. */
const PD_MOVE = 6;
let PD = null;   // {src, x, y, on, dead, ghost, zone, hit}

function paneDragSource(ev) {
  const t = ev.target;
  if (ev.button !== 0 || PD || narrowChat() || !(t instanceof Element)) return null;
  const row = !monCtx && t.closest("#chat-convo .cv-row[data-t]");
  if (row && !row.dataset.k && validTarget(row.dataset.t)) return { kind: "chat", t: row.dataset.t, label: targetName(row.dataset.t) };
  const pj = t.closest("#v-projects .pl-row[data-key]");
  if (pj && PRJ && PRJ.projects.some(p => p.key === pj.dataset.key)) return { kind: "project", t: pj.dataset.key, label: (pj.querySelector(".pl-n") || pj).textContent };
  const hd = t.closest(".pane-hd, #cv-head, .pmv-head"), pane = hd && !t.closest("button, a, input, textarea, select, [contenteditable]") && hd.closest(".pane");
  if (pane && PNV.el && PNV.el.contains(pane)) return { pane: pane.dataset.id, label: paneName(paneFind(pane.dataset.id)) };
  return null;
}
document.addEventListener("pointerdown", ev => {
  const src = paneDragSource(ev);
  if (!src) return;
  PD = { src, x: ev.clientX, y: ev.clientY, on: false, dead: false, ghost: null, zone: null, hit: null };
  for (const [type, fn] of PD_EVENTS) document.addEventListener(type, fn, true);
}, true);

// Where the pointer can drop: every pane when split, else the open conversation (head to composer) or the project page.
function paneDragBoxes() {
  if (paneCount() > 1 && PNV.el && !PNV.el.hidden) return [...PNV.el.querySelectorAll(".pane")].map(n => ({ id: n.dataset.id, r: n.getBoundingClientRect() }));
  if (current === "project") return [{ id: "", r: $("#v-project").getBoundingClientRect() }];
  if (current !== "chat") return [];
  const a = $("#cv-head").getBoundingClientRect(), b = $("#composer").getBoundingClientRect();
  return [{ id: "", r: new DOMRect(a.left, a.top, a.width, b.bottom - a.top) }];
}
// The nearest edge when the pointer is in the outer quarter of that side, else the middle; edges are off when they cannot add a pane.
function paneDragZone(r, x, y, edges) {
  const nearest = [["left", (x - r.left) / r.width], ["right", (r.right - x) / r.width], ["top", (y - r.top) / r.height], ["bottom", (r.bottom - y) / r.height]].sort((a, b) => a[1] - b[1])[0];
  return edges && nearest[1] < 0.25 ? nearest[0] : "center";
}
function paneDragAim(x, y) {
  const box = paneDragBoxes().find(b => b.id !== PD.src.pane && x >= b.r.left && x < b.r.right && y >= b.r.top && y < b.r.bottom);
  PD.hit = box ? { id: box.id, r: box.r, side: paneDragZone(box.r, x, y, !!PD.src.pane || paneCount() < PANE_MAX) } : null;
  paneDragPaint();
}
function paneDragPaint() {
  const h = PD.hit;
  if (!h) { if (PD.zone) PD.zone.remove(); PD.zone = null; return; }
  const { r, side } = h, w = side === "left" || side === "right" ? r.width / 4 : r.width, ht = side === "top" || side === "bottom" ? r.height / 4 : r.height;
  if (!PD.zone) { PD.zone = el("div", { class: "pn-zone" }); document.body.append(PD.zone); }
  Object.assign(PD.zone.style, { left: `${side === "right" ? r.right - w : r.left}px`, top: `${side === "bottom" ? r.bottom - ht : r.top}px`, width: `${w}px`, height: `${ht}px` });
}

function paneDragMove(ev) {
  if (!PD || PD.dead) return;
  if (!PD.on) {
    if (Math.hypot(ev.clientX - PD.x, ev.clientY - PD.y) < PD_MOVE) return;
    PD.on = true;
    PD.ghost = el("div", { class: "pn-ghost", text: PD.src.label });
    document.body.append(PD.ghost);
    document.body.classList.add("pn-drag");
  }
  ev.preventDefault();
  getSelection().removeAllRanges();
  const gw = PD.ghost.offsetWidth, flip = ev.clientX + 12 + gw > innerWidth;
  Object.assign(PD.ghost.style, { left: `${flip ? ev.clientX - 12 - gw : ev.clientX + 12}px`, top: `${ev.clientY + 12}px` });
  paneDragAim(ev.clientX, ev.clientY);
}
function paneDragEnd() {
  const was = PD;
  PD = null;
  for (const [type, fn] of PD_EVENTS) document.removeEventListener(type, fn, true);
  if (!was || !was.on) return;
  if (was.ghost) was.ghost.remove();
  if (was.zone) was.zone.remove();
  document.body.classList.remove("pn-drag");
  // The click that follows a drag must not open the row it started on.
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener("click", stop, true);
  setTimeout(() => window.removeEventListener("click", stop, true), 0);
}
function paneDragUp(ev) {
  if (!PD) return;
  if (PD.on && !PD.dead) paneDragAim(ev.clientX, ev.clientY);
  const { src, hit, on, dead } = PD;
  paneDragEnd();
  if (on && !dead && hit) paneDrop(src, hit);
}
// Escape drops the drag but keeps listening until the button is up, so the click that follows is still swallowed.
function paneDragKey(ev) {
  if (ev.key !== "Escape" || !PD) return;
  ev.preventDefault(); ev.stopPropagation();
  PD.dead = true; PD.hit = null;
  if (PD.ghost) PD.ghost.remove();
  PD.ghost = null;
  paneDragPaint();
}
const PD_EVENTS = [["pointermove", paneDragMove], ["pointerup", paneDragUp], ["pointercancel", () => { if (PD) { PD.dead = true; paneDragEnd(); } }], ["keydown", paneDragKey]];

// What a drop does. A pane's head: swap (middle) or move next to the pane. A list row: an edge splits next to that pane, the middle replaces it (one pane: opens in place);
// a target that is already open only brings its pane forward.
function paneDrop(src, { id, side }) {
  if (src.pane) { paneMove(src.pane, id, side); return; }
  const { kind, t } = src;
  if (paneCount() > 1) {
    const dup = paneOpenIn(kind, t);
    if (dup) paneFocus(dup.id);
    else if (side === "center") paneReplace(id, t, kind);
    else paneSplit(t, kind, side, id);
    return;
  }
  const here = paneHere();
  if (here.kind === kind && here.t === t) return;
  if (side === "center") go(kind, t); else paneSplit(t, kind, side);
}
