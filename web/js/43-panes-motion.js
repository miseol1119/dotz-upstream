/* ---------- 분할 창: what a drag leaves behind (43-panes-drag.js) ---------- */
function paneGhostLift() {}
function paneGhostDrop(g) { g.remove(); }
function paneGhostBack(g) { g.remove(); }
function paneZoneOut(z) { z.remove(); }
function paneDropMoving(src, hit) { paneDrop(src, hit); }
