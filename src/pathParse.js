// SVG path data → flat polylines. Pure, so it is testable and shared by the
// SVG and Illustrator importers.
//
// Written rather than borrowed from the browser (SVGPathElement.getPointAtLength
// would flatten any path for free) because that only works inside a live
// document: it cannot be unit-tested, and an import path that cannot be tested
// is one you find out about from a user. Every command in the spec is handled
// here, arcs included, and each has a test.
//
// Curves are flattened to line segments. `tol` is the sampling density — a
// segment count per curve — because these polylines become a traced underlay,
// not a rendered artwork: 16 steps is invisible at drawing scale and keeps a
// site plan from arriving as a hundred thousand points.

const CMD = /([astvzqmhlcASTVZQMHLC])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

/** Split path data into [command, ...numbers] runs. */
export function tokenizePath(d) {
  const out = [];
  let cur = null;
  let m;
  CMD.lastIndex = 0;
  while ((m = CMD.exec(String(d || '')))) {
    if (m[1]) {
      if (cur) out.push(cur);
      cur = { cmd: m[1], args: [] };
    } else if (cur) {
      cur.args.push(Number(m[2]));
    }
  }
  if (cur) out.push(cur);
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

function cubic(p0, p1, p2, p3, steps, push) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)];
    const b = [lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t)];
    const c = [lerp(p2[0], p3[0], t), lerp(p2[1], p3[1], t)];
    const d = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    const e = [lerp(b[0], c[0], t), lerp(b[1], c[1], t)];
    push([lerp(d[0], e[0], t), lerp(d[1], e[1], t)]);
  }
}

/**
 * Elliptical arc, endpoint parameterisation → centre, per SVG 1.1 F.6.5.
 * The radii correction in F.6.6 matters: real files contain arcs whose radii
 * are too small to span the endpoints, and without it they produce NaN.
 */
function arc(p0, rx, ry, xRot, largeArc, sweep, p1, steps, push) {
  if (rx === 0 || ry === 0) { push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (xRot * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cosP * dx + sinP * dy;
  const y1 = -sinP * dx + cosP * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cosP * cx1 - sinP * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  for (let i = 1; i <= steps; i++) {
    const t = t1 + (dt * i) / steps;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
  }
}

/**
 * Flatten SVG path data into subpaths.
 * @param {string} d
 * @param {number} steps Segments per curve.
 * @returns {Array<{ closed: boolean, pts: Array<[number, number]> }>}
 */
export function pathToPolylines(d, steps = 16) {
  const toks = tokenizePath(d);
  const subs = [];
  let cur = null;
  let pos = [0, 0];
  let start = [0, 0];
  let lastCubicCtrl = null;
  let lastQuadCtrl = null;

  const open = () => { cur = { closed: false, pts: [] }; subs.push(cur); };
  const push = (p) => {
    // A NaN slipping in poisons the rest of the subpath and, worse, the bounds
    // of the whole import — so refuse it at the door.
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    if (!cur) open();
    cur.pts.push([+p[0], +p[1]]);
    pos = p;
  };

  // Arguments each command needs. Letters also occur inside ordinary words, so
  // text that is not path data ("garbage" contains a valid `a`) would otherwise
  // parse as a command with no arguments and emit NaN coordinates.
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

  for (const { cmd, args } of toks) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const need = ARITY[C];
    if (need === undefined) continue;
    if (need > 0 && args.length < need) continue; // not path data
    if (args.some((n) => !Number.isFinite(n))) continue;
    const R = (x, y) => (rel ? [pos[0] + x, pos[1] + y] : [x, y]);
    let i = 0;
    // A command may carry several coordinate sets; repeats behave as implicit
    // repeats of the command, which is how real files are written.
    do {
      if (C === 'M') {
        const p = R(args[i], args[i + 1]); i += 2;
        open(); push(p); start = p;
        // Subsequent pairs after an M are implicit L, per the spec.
        while (i + 1 < args.length) { const q = rel ? [pos[0] + args[i], pos[1] + args[i + 1]] : [args[i], args[i + 1]]; push(q); i += 2; }
      } else if (C === 'L') { push(R(args[i], args[i + 1])); i += 2; }
      else if (C === 'H') { push([rel ? pos[0] + args[i] : args[i], pos[1]]); i += 1; }
      else if (C === 'V') { push([pos[0], rel ? pos[1] + args[i] : args[i]]); i += 1; }
      else if (C === 'C') {
        const c1 = R(args[i], args[i + 1]); const c2 = R(args[i + 2], args[i + 3]); const p = R(args[i + 4], args[i + 5]);
        cubic(pos, c1, c2, p, steps, push); lastCubicCtrl = c2; i += 6;
      } else if (C === 'S') {
        const c1 = lastCubicCtrl ? [2 * pos[0] - lastCubicCtrl[0], 2 * pos[1] - lastCubicCtrl[1]] : pos;
        const c2 = R(args[i], args[i + 1]); const p = R(args[i + 2], args[i + 3]);
        cubic(pos, c1, c2, p, steps, push); lastCubicCtrl = c2; i += 4;
      } else if (C === 'Q') {
        const q = R(args[i], args[i + 1]); const p = R(args[i + 2], args[i + 3]);
        // Quadratic → cubic, so one flattener serves both.
        cubic(pos, [pos[0] + (2 / 3) * (q[0] - pos[0]), pos[1] + (2 / 3) * (q[1] - pos[1])],
          [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p, steps, push);
        lastQuadCtrl = q; i += 4;
      } else if (C === 'T') {
        const q = lastQuadCtrl ? [2 * pos[0] - lastQuadCtrl[0], 2 * pos[1] - lastQuadCtrl[1]] : pos;
        const p = R(args[i], args[i + 1]);
        cubic(pos, [pos[0] + (2 / 3) * (q[0] - pos[0]), pos[1] + (2 / 3) * (q[1] - pos[1])],
          [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p, steps, push);
        lastQuadCtrl = q; i += 2; // T carries only its endpoint
      } else if (C === 'A') {
        const p = rel ? [pos[0] + args[i + 5], pos[1] + args[i + 6]] : [args[i + 5], args[i + 6]];
        arc(pos, args[i], args[i + 1], args[i + 2], !!args[i + 3], !!args[i + 4], p, Math.max(steps, 12), push);
        i += 7;
      } else if (C === 'Z') {
        if (cur && cur.pts.length) { cur.closed = true; pos = start; }
        break;
      } else break;
      if (C !== 'C' && C !== 'S') lastCubicCtrl = null;
      if (C !== 'Q' && C !== 'T') lastQuadCtrl = null;
      // Only repeat while a WHOLE further coordinate set remains — a trailing
      // stray number must not drive a half-read command.
    } while (need > 0 && args.length - i >= need);
  }
  return subs.filter((s) => s.pts.length >= 2);
}
