// ===== 40-boat.js =====
// ============================================================================
// TIDEWRIGHT — 40-boat.js
// The skiff: a 6.2 m clinker-built double-ender with a tanbark standing lug,
// a storm lantern on an iron crook at the bow and the hooded tidewright at
// the tiller. All geometry is procedural and built once in init().
// OWNER: agent BOAT-FX.
//
// Conventions (boat-local): +Z bow, +Y up, +X port. Waterline y = 0.
//   state.boat.boom   : Ry(boom) about the mast; boom > 0 swings the boom end to -X (starboard).
//   state.boat.rudder : > 0 steers right; blade trailing edge to -X, tiller to +X.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW, M = TW.M;

  // ---------------------------------------------------------------- hull lines
  const ZM = 0.9;            // mast position (z)
  const NSTR = 8;            // strakes per side
  const LAP = 0.03;          // how far each plank stands proud of the one below
  const KH = 0.036;          // half thickness of keel / stem
  const SAILX = 0.075;       // the sail hangs on the port side of the mast
  const SV = []; for (let k = 0; k <= NSTR; k++) SV.push(Math.pow(k / NSTR, 1.25));
  const sheerY = (t) => 0.63 + (t > 0 ? 0.46 : 0.36) * Math.pow(Math.abs(t), 2.3);
  const keelY = (t) => -0.35 + 0.17 * Math.pow(Math.abs(t), 2.6);
  const zBow = (v) => 2.45 + 0.68 * Math.pow(Math.max(v, 0), 0.62);
  const zStern = (v) => -(2.50 + 0.54 * Math.pow(Math.max(v, 0), 0.72));
  const halfBeam = (t) => {
    const a = Math.min(1, Math.abs(t));
    return t > 0 ? KH + 0.92 * Math.pow(1 - Math.pow(a, 1.9), 1.05) : KH + 0.92 * Math.pow(1 - Math.pow(a, 2.3), 0.95);
  };
  // surface point: u 0 (stern) .. 1 (bow), v 0 (keel) .. 1 (sheer), sx +1 port / -1 starboard
  function hullPt(u, v, sx, out) {
    const t = u * 2 - 1, a = Math.min(1, Math.abs(t));
    const e = 0.46 + 0.80 * Math.pow(a, 1.7);
    const vv = Math.max(v, 0);
    out[0] = sx * (KH + (halfBeam(t) - KH) * Math.pow(vv, e));
    out[1] = keelY(t) + (sheerY(t) - keelY(t)) * v;
    out[2] = zStern(v) + (zBow(v) - zStern(v)) * u;
    return out;
  }
  const _a = [0, 0, 0], _b = [0, 0, 0], _c = [0, 0, 0], _d = [0, 0, 0];
  // point P, outward unit normal N and unit "up the section" tangent Tv
  function hullN(u, v, sx, P, N, Tv) {
    const e = 0.003;
    hullPt(u, v, sx, P);
    hullPt(Math.max(0, u - e), v, sx, _a); hullPt(Math.min(1, u + e), v, sx, _b);
    hullPt(u, Math.max(0.0005, v - e), sx, _c); hullPt(u, v + e, sx, _d);
    const ux = _b[0] - _a[0], uy = _b[1] - _a[1], uz = _b[2] - _a[2];
    let vx = _d[0] - _c[0], vy = _d[1] - _c[1], vz = _d[2] - _c[2];
    let nx = (vy * uz - vz * uy) * sx, ny = (vz * ux - vx * uz) * sx, nz = (vx * uy - vy * ux) * sx;
    let l = Math.hypot(nx, ny, nz) || 1; N[0] = nx / l; N[1] = ny / l; N[2] = nz / l;
    l = Math.hypot(vx, vy, vz) || 1; Tv[0] = vx / l; Tv[1] = vy / l; Tv[2] = vz / l;
  }
  const uAtZ = (z, v) => (z - zStern(v)) / (zBow(v) - zStern(v));
  // (u, v) of the hull at a given z and height y
  function uvAt(z, y) {
    let v = 0.5, u = 0.5;
    for (let i = 0; i < 5; i++) {
      u = TW.clamp(uAtZ(z, v), 0, 1);
      const t = u * 2 - 1;
      v = TW.clamp((y - keelY(t)) / (sheerY(t) - keelY(t)), 0.001, 1.1);
    }
    return [u, v];
  }
  // point on the inside of the planking at (z, y)
  function inAt(z, y, sx, inset) {
    const uv = uvAt(z, y), P = [0, 0, 0], N = [0, 0, 0], Tv = [0, 0, 0];
    hullN(uv[0], uv[1], sx, P, N, Tv);
    const x = P[0] - N[0] * inset;
    return [sx * Math.max(sx * x, 0.004), P[1] - N[1] * inset, P[2] - N[2] * inset];
  }

  // ---------------------------------------------------------------- tiny vec helpers (init-time only)
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const num = (x, f, i) => (typeof x === 'function' ? x(f, i) : x);

  // ---------------------------------------------------------------- mesh builder
  // vertex: pos(3) normal(3) uv(2) colour(rgb + material id) part(part id, flutter weight, aux, 0)
  function Builder() {
    const p = [], n = [], uv = [], c = [], pt = [], th = [], idx = [];
    const st = { col: [1, 1, 1], mat: 0, part: 0, w: 0, aux: 0, inside: 0, rad: 0, thin: 0 };
    const b = {
      p, n, uv, c, pt, th, idx, st,
      set(col, mat, part, w, aux) { st.col = col; st.mat = mat || 0; st.part = part || 0; st.w = w || 0; st.aux = aux || 0; return b; },
      v(P, N, s, t, w) {
        p.push(P[0], P[1], P[2]); n.push(N[0], N[1], N[2]); uv.push(s || 0, t || 0);
        c.push(st.col[0], st.col[1], st.col[2], st.mat); pt.push(st.part, w === undefined ? st.w : w, st.aux, st.inside); th.push(st.rad, st.thin);
        return p.length / 3 - 1;
      },
      // triangles are wound to agree with their vertex normals, so callers never worry about winding
      tri(i0, i1, i2) {
        const ax = p[i0 * 3], ay = p[i0 * 3 + 1], az = p[i0 * 3 + 2];
        const e1x = p[i1 * 3] - ax, e1y = p[i1 * 3 + 1] - ay, e1z = p[i1 * 3 + 2] - az;
        const e2x = p[i2 * 3] - ax, e2y = p[i2 * 3 + 1] - ay, e2z = p[i2 * 3 + 2] - az;
        const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
        const d = fx * (n[i0 * 3] + n[i1 * 3] + n[i2 * 3]) + fy * (n[i0 * 3 + 1] + n[i1 * 3 + 1] + n[i2 * 3 + 1]) + fz * (n[i0 * 3 + 2] + n[i1 * 3 + 2] + n[i2 * 3 + 2]);
        if (d < 0) idx.push(i0, i2, i1); else idx.push(i0, i1, i2);
      },
      quad(i0, i1, i2, i3) { b.tri(i0, i1, i2); b.tri(i0, i2, i3); },
    };
    return b;
  }
  // flat quad; ref = a direction the face should look toward
  function flatQuad(b, p0, p1, p2, p3, ref, uvs) {
    let nn = vnorm(vcross(vsub(p1, p0), vsub(p3, p0)));
    if (Math.hypot(nn[0], nn[1], nn[2]) < 0.5) nn = vnorm(vcross(vsub(p2, p1), vsub(p3, p1)));
    if (ref && vdot(nn, ref) < 0) nn = vmul(nn, -1);
    uvs = uvs || [0, 0, 1, 0, 1, 1, 0, 1];
    b.quad(b.v(p0, nn, uvs[0], uvs[1]), b.v(p1, nn, uvs[2], uvs[3]), b.v(p2, nn, uvs[4], uvs[5]), b.v(p3, nn, uvs[6], uvs[7]));
  }
  // box from 4 top corners (in order around) and a thickness downward
  function slab(b, t, thick, uvScale) {
    const bt = t.map((q) => [q[0], q[1] - thick, q[2]]);
    const cen = vmul(vadd(vadd(t[0], t[1]), vadd(t[2], t[3])), 0.25);
    const s = uvScale || 1;
    flatQuad(b, t[0], t[1], t[2], t[3], [0, 1, 0], [t[0][2] * s, t[0][0] * s, t[1][2] * s, t[1][0] * s, t[2][2] * s, t[2][0] * s, t[3][2] * s, t[3][0] * s]);
    flatQuad(b, bt[0], bt[1], bt[2], bt[3], [0, -1, 0]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mid = vmul(vadd(t[i], t[j]), 0.5);
      flatQuad(b, t[i], t[j], bt[j], bt[i], [mid[0] - cen[0], 0, mid[2] - cen[2]], [0, 0, 0.5, 0, 0.5, 0.1, 0, 0.1]);
    }
  }
  // round-section sweep along a polyline. rad: number | fn(frac, i). o: {up, sn, sb, cap0, cap1, uvNorm, wfn, sides}
  function tube(b, pts, rad, sides, o) {
    o = o || {};
    const n = pts.length, R = [], T = [];
    for (let i = 0; i < n; i++) {
      R.push(num(rad, n > 1 ? i / (n - 1) : 0, i));
      T.push(vnorm(vsub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)])));
    }
    let up = o.up || (Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    let N = vnorm(vsub(up, vmul(T[0], vdot(up, T[0]))));
    const sn = o.sn || 1, sb = o.sb || 1;
    const rings = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      N = vnorm(vsub(N, vmul(T[i], vdot(N, T[i]))));
      const B = vcross(T[i], N);
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, n - 1);
      const ds = Math.hypot(pts[i1][0] - pts[i0][0], pts[i1][1] - pts[i0][1], pts[i1][2] - pts[i0][2]);
      const k = ds > 1e-6 ? (R[i1] - R[i0]) / ds : 0;
      const f = n > 1 ? i / (n - 1) : 0, ring = [];
      const w = o.wfn ? o.wfn(f) : undefined;
      b.st.rad = o.thin ? R[i] : 0; b.st.thin = o.thin || 0;
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const pos = [pts[i][0] + (N[0] * ca * sn + B[0] * sa * sb) * R[i], pts[i][1] + (N[1] * ca * sn + B[1] * sa * sb) * R[i], pts[i][2] + (N[2] * ca * sn + B[2] * sa * sb) * R[i]];
        const nor = vnorm([N[0] * ca / sn + B[0] * sa / sb - T[i][0] * k, N[1] * ca / sn + B[1] * sa / sb - T[i][1] * k, N[2] * ca / sn + B[2] * sa / sb - T[i][2] * k]);
        ring.push(b.v(pos, nor, o.uvNorm ? f : len, j / sides, w));
      }
      rings.push(ring);
      if (i < n - 1) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
    }
    b.st.rad = 0; b.st.thin = 0;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) b.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]);
    const cap = (i, sgn) => {
      if (R[i] < 0.004) return;
      const nn = vmul(T[i], sgn), w = o.wfn ? o.wfn(i ? 1 : 0) : undefined;
      const cidx = b.v(pts[i], nn, 0, 0, w), rv = [];
      for (let j = 0; j <= sides; j++) { const q = rings[i][j]; rv.push(b.v([b.p[q * 3], b.p[q * 3 + 1], b.p[q * 3 + 2]], nn, 0, 0, w)); }
      for (let j = 0; j < sides; j++) b.tri(cidx, rv[j], rv[j + 1]);
    };
    if (o.cap0 !== false) cap(0, -1);
    if (o.cap1 !== false) cap(n - 1, 1);
  }
  // surface of revolution about a vertical axis: prof = [[y, r], ...]
  function lathe(b, cx, cz, prof, sides, o) {
    o = o || {}; o.up = [1, 0, 0];
    tube(b, prof.map((q) => [cx, q[0], cz]), (f, i) => prof[i][1], sides, o);
  }
  // rectangular-section sweep. ups: one vec3 or one per point (the section's "height" axis); w across, h along up.
  function beam(b, pts, ups, w, h, o) {
    o = o || {};
    const n = pts.length, single = typeof ups[0] === 'number';
    const fr = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      const T = vnorm(vsub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
      let U = single ? ups : ups[i];
      U = vnorm(vsub(U, vmul(T, vdot(U, T))));
      const S = vcross(T, U), f = n > 1 ? i / (n - 1) : 0;
      fr.push({ T, U, S, w: num(w, f, i) * 0.5, h: num(h, f, i) * 0.5, len });
      if (i < n - 1) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
    }
    const corner = (i, a, c) => { const q = fr[i]; return [pts[i][0] + q.S[0] * a * q.w + q.U[0] * c * q.h, pts[i][1] + q.S[1] * a * q.w + q.U[1] * c * q.h, pts[i][2] + q.S[2] * a * q.w + q.U[2] * c * q.h]; };
    const faces = [[-1, 1, 1, 1, 'U', 1], [1, 1, 1, -1, 'S', 1], [1, -1, -1, -1, 'U', -1], [-1, -1, -1, 1, 'S', -1]];
    faces.forEach((F, fi) => {
      let prev = null;
      for (let i = 0; i < n; i++) {
        const q = fr[i], nn = vmul(q[F[4]], F[5]);
        const cur = [b.v(corner(i, F[0], F[1]), nn, q.len, fi * 0.25), b.v(corner(i, F[2], F[3]), nn, q.len, fi * 0.25 + 0.25)];
        if (prev) b.quad(prev[0], prev[1], cur[1], cur[0]);
        prev = cur;
      }
    });
    if (o.caps !== false) {
      flatQuad(b, corner(0, -1, 1), corner(0, 1, 1), corner(0, 1, -1), corner(0, -1, -1), vmul(fr[0].T, -1));
      flatQuad(b, corner(n - 1, -1, 1), corner(n - 1, 1, 1), corner(n - 1, 1, -1), corner(n - 1, -1, -1), fr[n - 1].T);
    }
  }

  // ---------------------------------------------------------------- palette (linear)
  const C = {
    tar: [0.060, 0.046, 0.034], ledge: [0.020, 0.016, 0.012], oak: [0.125, 0.086, 0.049], oakMid: [0.09, 0.062, 0.036], oakDark: [0.064, 0.043, 0.025],
    bone: [0.24, 0.22, 0.17], iron: [0.035, 0.035, 0.04], spar: [0.21, 0.15, 0.085], rope: [0.24, 0.195, 0.125], ropeDark: [0.13, 0.105, 0.07],
    skin: [0.024, 0.036, 0.030], skinDark: [0.017, 0.027, 0.023], boot: [0.03, 0.028, 0.027], face: [0.012, 0.012, 0.016], glass: [1.0, 0.6, 0.25],
    eye: [1.0, 0.62, 0.22], cask: [0.20, 0.13, 0.07], blade: [0.20, 0.15, 0.09],
  };

  // key points shared between the mesh and the animation code
  const LC = TW.env.lanternLocal;                       // lantern centre (the light source)
  const PIV = [LC[0], LC[1] + 0.31, LC[2]];             // lantern pendulum pivot (tip of the crook)
  const FIG = [0.12, 0.34, -1.45];                      // where the tidewright sits (top of the helm thwart)
  const SHOULDER = [FIG[0] - 0.235, FIG[1] + 0.50, FIG[2] - 0.04];
  // rudder hinge line
  const RD = vnorm([0, 1.33, -0.50]);                   // along the stern post, upward
  const RE = [0, RD[2], -RD[1]];                        // aft, perpendicular to the hinge, in the centre plane
  const RA0 = vadd([0, -0.25, -2.56], vmul(RE, 0.10));  // a point on the hinge
  const rudPt = (a, d, x) => [x || 0, RA0[1] + RD[1] * a + RE[1] * d, RA0[2] + RD[2] * a + RE[2] * d];
  const TILL0 = rudPt(1.50, 0.02), TILL1 = [0, 0.80, -2.14];
  const GRIP = vlerp(TILL0, TILL1, 0.92);
  const SHEET_A = [0, 0.375, -2.50], BOOM_END = [SAILX, 1.215, ZM - 2.9];
  // sail corners as (distance aft of the mast, height): tack, clew, throat, peak
  const CORNERS = new Float32Array([-0.12, 1.20, 3.0, 1.27, -0.75, 4.02, 2.05, 6.62]);

  function buildBoat() {
    const b = Builder();
    const P = [0, 0, 0], N = [0, 0, 0], Tv = [0, 0, 0];
    const NU = 30;

    // ---- outer planking: six lapped strakes a side
    for (let side = 0; side < 2; side++) {
      const sx = side ? -1 : 1;
      for (let k = 0; k < NSTR; k++) {
        b.set(C.tar, 1, 0);
        const rows = [];
        for (let r = 0; r < 3; r++) {
          const v = TW.lerp(SV[k], SV[k + 1], r / 2), row = [];
          for (let i = 0; i <= NU; i++) {
            const u = i / NU;
            hullN(u, v, sx, P, N, Tv);
            const off = LAP * (1 - r / 2);
            row.push(b.v([P[0] + N[0] * off, P[1] + N[1] * off, P[2] + N[2] * off], vnorm([N[0] + Tv[0] * 0.3, N[1] + Tv[1] * 0.3, N[2] + Tv[2] * 0.3]), u * 6.2, k + r * 0.4995));
          }
          rows.push(row);
        }
        for (let r = 0; r < 2; r++) for (let i = 0; i < NU; i++) b.quad(rows[r][i], rows[r][i + 1], rows[r + 1][i + 1], rows[r + 1][i]);
        if (k > 0) { // the little shadowed ledge under each lap
          b.set(C.ledge, 0, 0);
          let pa = -1, pb = -1;
          for (let i = 0; i <= NU; i++) {
            hullN(i / NU, SV[k], sx, P, N, Tv);
            const nn = [-Tv[0], -Tv[1], -Tv[2]];
            const ia = b.v([P[0], P[1], P[2]], nn, 0, 0), ib = b.v([P[0] + N[0] * LAP, P[1] + N[1] * LAP, P[2] + N[2] * LAP], nn, 0, 0);
            if (pa >= 0) b.quad(pa, pb, ib, ia);
            pa = ia; pb = ib;
          }
        }
      }
      // ---- inside of the planking
      b.st.inside = 1;
      b.set(C.oakDark, 7, 0);
      const NV = 11, irows = [];
      for (let j = 0; j <= NV; j++) {
        const v = Math.pow(j / NV, 1.3), row = [];
        for (let i = 0; i <= NU; i++) {
          hullN(i / NU, v, sx, P, N, Tv);
          const x = P[0] - N[0] * 0.028;
          row.push(b.v([sx * Math.max(sx * x, 0.004), P[1] - N[1] * 0.028, P[2] - N[2] * 0.028], [-N[0], -N[1], -N[2]], i / NU * 6.2, NSTR * Math.pow(v, 1 / 1.25)));
        }
        irows.push(row);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) b.quad(irows[j][i], irows[j][i + 1], irows[j + 1][i + 1], irows[j + 1][i]);

      b.st.inside = 0;
      // ---- gunwale and the pale rubbing strake under the sheer strake
      b.set(C.oak, 0, 0);
      const gp = [], rp = [], rn = [];
      for (let i = 0; i <= NU; i++) {
        hullN(i / NU, 1, sx, P, N, Tv);
        gp.push([P[0] + N[0] * 0.004, P[1] + 0.012, P[2] + N[2] * 0.004]);
        hullN(i / NU, SV[NSTR - 1], sx, P, N, Tv);
        rp.push([P[0] + N[0] * (LAP + 0.012), P[1] + N[1] * (LAP + 0.012), P[2] + N[2] * (LAP + 0.012)]);
        rn.push([N[0], N[1], N[2]]);
      }
      beam(b, gp, [0, 1, 0], 0.088, 0.046);
      b.set(C.bone, 0, 0);
      beam(b, rp, rn, 0.032, 0.028);

      // ---- ribs
      b.st.inside = 1;
      b.set(C.oakMid, 0, 0);
      for (let zr = -2.4; zr <= 2.01; zr += 0.4) {
        const pts = [], ups = [];
        for (let j = 0; j <= 9; j++) {
          const v = 0.02 + 0.95 * j / 9, u = TW.clamp(uAtZ(zr, v), 0, 1);
          hullN(u, v, sx, P, N, Tv);
          const x = P[0] - N[0] * 0.042;
          pts.push([sx * Math.max(sx * x, 0.01), P[1] - N[1] * 0.042, P[2] - N[2] * 0.042]);
          ups.push([-N[0], -N[1], -N[2]]);
        }
        beam(b, pts, ups, 0.042, 0.032, { caps: false });
      }
    }

    b.st.inside = 0;
    // ---- keel, stem and stern post: one continuous timber
    {
      b.set(C.tar, 0, 0);
      const raw = [];
      for (let j = 0; j <= 8; j++) { const v = 1.07 * (1 - j / 8); raw.push([0, keelY(-1) + (sheerY(-1) - keelY(-1)) * v, zStern(v)]); }
      for (let i = 1; i < 20; i++) { hullPt(i / 20, 0, 1, P); raw.push([0, P[1], P[2]]); }
      for (let j = 0; j <= 9; j++) { const v = 1.13 * j / 9; raw.push([0, keelY(1) + (sheerY(1) - keelY(1)) * v, zBow(v)]); }
      const pts = [], ups = [];
      for (let i = 0; i < raw.length; i++) {
        const T = vnorm(vsub(raw[Math.min(i + 1, raw.length - 1)], raw[Math.max(i - 1, 0)]));
        const U = [0, -T[2], T[1]];
        ups.push(U); pts.push(vadd(raw[i], vmul(U, 0.026)));
      }
      beam(b, pts, ups, 0.074, 0.11);
    }

    // ---- floorboards
    b.st.inside = 1;
    {
      b.set([0.075, 0.053, 0.031], 7, 0);
      const yf = -0.13;
      let pl = -1, pr = -1;
      for (let i = 0; i <= 16; i++) {
        const z = -2.15 + 4.1 * i / 16;
        const L = inAt(z, yf, 1, 0.04), R = inAt(z, yf, -1, 0.04);
        const il = b.v([L[0], yf, z], [0, 1, 0], z, L[0] / 0.13), ir = b.v([R[0], yf, z], [0, 1, 0], z, R[0] / 0.13);
        if (pl >= 0) b.quad(pl, il, ir, pr);
        pl = il; pr = ir;
      }
    }

    // ---- thwarts, stern sheets
    const thwart = (zc, hw, y, thick, col) => {
      b.set(col || C.oak, 0, 0);
      slab(b, [inAt(zc - hw, y, 1, 0.02), inAt(zc + hw, y, 1, 0.02), inAt(zc + hw, y, -1, 0.02), inAt(zc - hw, y, -1, 0.02)].map((q) => [q[0], y, q[2]]), thick, 1);
    };
    thwart(FIG[2], 0.13, 0.34, 0.036);
    thwart(-0.2, 0.12, 0.34, 0.036);
    thwart(ZM, 0.15, 0.36, 0.045);
    thwart(-2.47, 0.36, 0.36, 0.03, C.oakMid);

    b.st.inside = 0;
    // ---- foredeck with its coaming
    {
      b.set([0.10, 0.071, 0.041], 7, 0);
      const u0 = uAtZ(1.85, 1);
      let pl = -1, pr = -1, firstL = null, firstR = null;
      for (let i = 0; i <= 9; i++) {
        const u = TW.lerp(u0, 1, i / 9);
        hullPt(u, 1, 1, P);
        const L = [P[0], P[1] - 0.008, P[2]], R = [-P[0], P[1] - 0.008, P[2]];
        if (!firstL) { firstL = L; firstR = R; }
        const il = b.v(L, [0, 1, 0], L[2], L[0] / 0.11), ir = b.v(R, [0, 1, 0], R[2], R[0] / 0.11);
        if (pl >= 0) b.quad(pl, il, ir, pr);
        pl = il; pr = ir;
      }
      b.set(C.oak, 0, 0);
      beam(b, [[firstL[0], firstL[1] - 0.01, firstL[2]], [0, firstL[1] + 0.035, firstL[2] - 0.03], [firstR[0], firstR[1] - 0.01, firstR[2]]], [0, 1, 0], 0.05, 0.10);
    }

    // ---- mast, partner band, truck
    b.set(C.spar, 0, 0);
    tube(b, [[0, -0.22, ZM], [0, 1.0, ZM], [0, 3.4, ZM], [0, 5.7, ZM]], (f) => 0.062 - 0.026 * f, 9);
    b.set(C.iron, 2, 0);
    lathe(b, 0, ZM, [[0.355, 0.066], [0.36, 0.078], [0.40, 0.078], [0.405, 0.064]], 9, { cap0: false, cap1: false });
    b.set(C.bone, 0, 0);
    lathe(b, 0, ZM, [[5.69, 0.03], [5.71, 0.052], [5.75, 0.052], [5.78, 0.02]], 8);
    // shrouds
    b.set(C.ropeDark, 5, 0);
    for (let side = 0; side < 2; side++) {
      const sx = side ? -1 : 1;
      hullPt(uAtZ(0.5, 1), 1, sx, P);
      tube(b, [[0, 5.5, ZM], [P[0] * 0.5, (5.5 + P[1]) * 0.5, (ZM + P[2]) * 0.5], [P[0], P[1] + 0.03, P[2]]], 0.011, 4, { cap0: false, cap1: false, thin: 0.8 });
    }

    // ---- iron crook for the lantern
    {
      b.set(C.iron, 2, 0);
      const zc = PIV[2] - 0.47, pts = [];
      for (let i = 0; i <= 5; i++) pts.push([0, TW.lerp(0.78, PIV[1], i / 5), zc]);
      const Rr = 0.235, cz = zc + Rr;
      for (let i = 1; i <= 14; i++) { const a = Math.PI - (Math.PI + 0.75) * i / 14, rr = i > 10 ? Rr * (1 - (i - 10) * 0.05) : Rr; pts.push([0, PIV[1] + rr * Math.sin(a), cz + rr * Math.cos(a) + (Rr - rr)]); }
      tube(b, pts, (f) => 0.021 - 0.010 * f, 6, { thin: 0.8 });
      lathe(b, 0, zc, [[0.775, 0.02], [0.78, 0.055], [0.80, 0.05], [0.83, 0.024]], 8);
    }

    // ---- storm lantern (part 2: swings from PIV)
    {
      const cx = LC[0], cy = LC[1], cz = LC[2];
      b.set(C.iron, 2, 2);
      lathe(b, cx, cz, [[cy - 0.192, 0.03], [cy - 0.188, 0.084], [cy - 0.152, 0.088], [cy - 0.146, 0.07]], 10);
      lathe(b, cx, cz, [[cy + 0.098, 0.07], [cy + 0.104, 0.102], [cy + 0.118, 0.098], [cy + 0.168, 0.05], [cy + 0.196, 0.036], [cy + 0.20, 0.046], [cy + 0.222, 0.042], [cy + 0.232, 0.012]], 10);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.26, x = cx + Math.cos(a) * 0.093, z = cz + Math.sin(a) * 0.093;
        tube(b, [[x, cy - 0.15, z], [x, cy + 0.10, z]], 0.006, 4, { cap0: false, cap1: false, thin: 0.4 });
      }
      for (let r = 0; r < 2; r++) {
        const pts = [], y = cy - 0.07 + r * 0.10;
        for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push([cx + Math.cos(a) * 0.094, y, cz + Math.sin(a) * 0.094]); }
        tube(b, pts, 0.005, 4, { cap0: false, cap1: false, thin: 0.4 });
      }
      { // bail
        const pts = [];
        for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10; pts.push([cx + Math.cos(a) * 0.085, cy + 0.12 + Math.sin(a) * 0.19, cz]); }
        tube(b, pts, 0.006, 4, { cap0: false, cap1: false, thin: 0.45 });
      }
      b.set(C.glass, 4, 2);
      lathe(b, cx, cz, [[cy - 0.148, 0.064], [cy - 0.09, 0.08], [cy - 0.02, 0.084], [cy + 0.05, 0.078], [cy + 0.10, 0.062]], 12, { cap0: false, cap1: false, uvNorm: true });
    }

    // ---- rudder and tiller (part 1)
    {
      b.set(C.tar, 0, 1);
      const poly = [[-0.24, 0.02], [-0.33, 0.40], [0.30, 0.50], [0.78, 0.30], [1.50, 0.17], [1.52, 0.0]];
      const th = 0.02;
      const cen = rudPt(0.55, 0.22);
      for (let s = -1; s <= 1; s += 2) {
        const nn = [s, 0, 0], ci = b.v([s * th, cen[1], cen[2]], nn, 0, 0), ring = poly.map((q) => { const w = rudPt(q[0], q[1], s * th); return b.v(w, nn, w[2], w[1] * 4); });
        for (let i = 0; i < poly.length; i++) b.tri(ci, ring[i], ring[(i + 1) % poly.length]);
      }
      for (let i = 0; i < poly.length; i++) {
        const q0 = poly[i], q1 = poly[(i + 1) % poly.length];
        const a0 = rudPt(q0[0], q0[1]), a1 = rudPt(q1[0], q1[1]), mid = vmul(vadd(a0, a1), 0.5);
        flatQuad(b, [th, a0[1], a0[2]], [th, a1[1], a1[2]], [-th, a1[1], a1[2]], [-th, a0[1], a0[2]], vsub(mid, cen));
      }
      b.set(C.iron, 2, 1);   // pintle straps
      for (let i = 0; i < 2; i++) { const a = 0.35 + i * 0.75, p0 = rudPt(a, -0.10), p1 = rudPt(a, 0.20); beam(b, [p0, p1], [1, 0, 0], 0.035, 0.052); }
      b.set(C.oak, 0, 1);
      tube(b, [TILL0, vlerp(TILL0, TILL1, 0.5), TILL1], (f) => 0.03 - 0.011 * f, 6, { thin: 0.9 });
    }

    // ---- boom, yard, halyard (part 4: swing about the mast)
    {
      b.set(C.spar, 0, 4);
      const rp = (a, y) => [SAILX, y, ZM - a];
      tube(b, [rp(-0.22, 1.165), rp(1.4, 1.19), rp(3.12, 1.225)], (f) => 0.036 - 0.008 * f, 7, { thin: 1.0 });
      const th = [CORNERS[4], CORNERS[5]], pk = [CORNERS[6], CORNERS[7]];
      const yd = (f) => rp(th[0] + (pk[0] - th[0]) * f, th[1] + (pk[1] - th[1]) * f + 0.03);
      tube(b, [yd(-0.05), yd(0.25), yd(0.6), yd(1.05)], (f) => 0.022 + 0.014 * Math.sin(Math.PI * (0.15 + 0.7 * f)), 6, { thin: 1.0 });
      b.set(C.ropeDark, 5, 4);
      const sl = yd(0.26);
      tube(b, [[0, 5.62, ZM], [sl[0] * 0.5, (5.62 + sl[1]) * 0.5, ZM], sl], 0.01, 4, { cap0: false, cap1: false, thin: 0.8 });
      // jaws where the boom meets the mast
      b.set(C.oakMid, 0, 4);
      beam(b, [[-0.02, 1.165, ZM + 0.10], [0.11, 1.165, ZM + 0.10]], [0, 1, 0], 0.06, 0.05);
    }

    // ---- ropes strung between two animated points (part 5): mainsheet (aux 0), the tidewright's arm (aux 1)
    {
      const line = (aux, n, rad, sides, col, mat) => {
        b.set(col, mat, 5, 0, aux);
        const pts = [];
        for (let i = 0; i <= n; i++) pts.push([0, 0, i / n]);
        tube(b, pts, rad, sides, { up: [1, 0, 0], wfn: (f) => f, uvNorm: false, thin: aux === 0 ? 0.8 : 0 });
      };
      line(0, 8, 0.012, 5, C.rope, 5);
      line(1, 6, (f) => 0.068 - 0.026 * f + 0.008 * Math.sin(Math.PI * f), 7, C.skin, 3);
    }

    // ---- the tidewright (part 3)
    {
      const fx = FIG[0], fy = FIG[1], fz = FIG[2];
      // long oilskin coat: narrow, flat-backed
      b.set(C.skin, 3, 3);
      const cprof = [[-0.25, 0.30, 1.0], [-0.10, 0.285, 0.6], [0.03, 0.26, 0.2], [0.22, 0.205, 0.0], [0.42, 0.21, 0.0], [0.52, 0.195, 0.0], [0.575, 0.10, 0.0], [0.64, 0.07, 0.0]];
      tube(b, cprof.map((q) => [fx, fy + q[0], fz + 0.03 - 0.05 * Math.max(0, q[0] - 0.2)]), (f, i) => cprof[i][1], 10, { up: [1, 0, 0], sn: 1.15, sb: 0.72, wfn: (f) => cprof[Math.round(f * (cprof.length - 1))][2], cap0: false });
      // short cape: broad square shoulders
      b.set(C.skinDark, 3, 3);
      const kprof = [[0.385, 0.305, 0.5], [0.40, 0.30, 0.3], [0.47, 0.285, 0.0], [0.545, 0.245, 0.0], [0.585, 0.13, 0.0], [0.625, 0.085, 0.0]];
      tube(b, kprof.map((q) => [fx, fy + q[0], fz - 0.02]), (f, i) => kprof[i][1], 8, { up: [1, 0, 0], sn: 1.28, sb: 0.70, wfn: (f) => kprof[Math.round(f * (kprof.length - 1))][2], cap0: false });
      // head (in shadow under the hat)
      b.set(C.face, 0, 3);
      lathe(b, fx, fz + 0.01, [[fy + 0.615, 0.05], [fy + 0.66, 0.088], [fy + 0.71, 0.092], [fy + 0.76, 0.07]], 8);
      // sou'wester: domed crown and a brim that runs long over the collar
      b.set(C.skin, 3, 3);
      lathe(b, fx, fz + 0.0, [[fy + 0.742, 0.112], [fy + 0.79, 0.108], [fy + 0.835, 0.084], [fy + 0.862, 0.045], [fy + 0.87, 0.008]], 9, { cap0: false });
      b.set(C.skinDark, 3, 3);
      lathe(b, fx, fz - 0.045, [[fy + 0.722, 0.10], [fy + 0.724, 0.205], [fy + 0.735, 0.212], [fy + 0.748, 0.10]], 10, { sb: 1.38, cap0: false, cap1: false });
      // boots braced on the floorboards
      b.set(C.boot, 3, 3);
      for (let s = -1; s <= 1; s += 2) tube(b, [[fx + s * 0.11, fy - 0.10, fz + 0.26], [fx + s * 0.12, fy - 0.38, fz + 0.40], [fx + s * 0.125, fy - 0.435, fz + 0.50], [fx + s * 0.125, fy - 0.445, fz + 0.60]], (f) => 0.062 - 0.018 * f, 6);
    }

    // ---- three crew copies, kept in the shared boat mesh so bots get them too
    // They use the same low-poly character geometry, with small local offsets and
    // a slightly reduced scale. Part 0 lets them follow the hull without swinging
    // around the helmsman's animation pivot.
    function addCrewMember(ox, oz, scale) {
      const tx = (x) => FIG[0] + ox + (x - FIG[0]) * scale;
      const ty = (y) => FIG[1] + (y - FIG[1]) * scale;
      const tz = (z) => FIG[2] + oz + (z - FIG[2]) * scale;
      const point = (q) => [tx(q[0]), ty(q[1]), tz(q[2])];
      const crewTube = (pts, rad, sides, o) => tube(b, pts.map(point), typeof rad === 'function' ? (f, i) => rad(f, i) * scale : rad * scale, sides, o);
      const crewLathe = (x, z, prof, sides, o) => lathe(b, tx(x), tz(z), prof.map((q) => [ty(q[0]), q[1] * scale]), sides, o);

      b.set(C.skin, 3, 0);
      const cprof = [[-0.25, 0.30, 1.0], [-0.10, 0.285, 0.6], [0.03, 0.26, 0.2], [0.22, 0.205, 0.0], [0.42, 0.21, 0.0], [0.52, 0.195, 0.0], [0.575, 0.10, 0.0], [0.64, 0.07, 0.0]];
      crewTube(cprof.map((q) => [FIG[0], FIG[1] + q[0], FIG[2] + 0.03 - 0.05 * Math.max(0, q[0] - 0.2)]), (f, i) => cprof[i][1], 10, { up: [1, 0, 0], sn: 1.15, sb: 0.72, wfn: (f) => cprof[Math.round(f * (cprof.length - 1))][2], cap0: false });
      b.set(C.skinDark, 3, 0);
      const kprof = [[0.385, 0.305, 0.5], [0.40, 0.30, 0.3], [0.47, 0.285, 0.0], [0.545, 0.245, 0.0], [0.585, 0.13, 0.0], [0.625, 0.085, 0.0]];
      crewTube(kprof.map((q) => [FIG[0], FIG[1] + q[0], FIG[2] - 0.02]), (f, i) => kprof[i][1], 8, { up: [1, 0, 0], sn: 1.28, sb: 0.70, wfn: (f) => kprof[Math.round(f * (kprof.length - 1))][2], cap0: false });
      b.set(C.face, 0, 0);
      crewLathe(FIG[0], FIG[2] + 0.01, [[FIG[1] + 0.615, 0.05], [FIG[1] + 0.66, 0.088], [FIG[1] + 0.71, 0.092], [FIG[1] + 0.76, 0.07]], 8);
      b.set(C.skin, 3, 0);
      crewLathe(FIG[0], FIG[2], [[FIG[1] + 0.742, 0.112], [FIG[1] + 0.79, 0.108], [FIG[1] + 0.835, 0.084], [FIG[1] + 0.862, 0.045], [FIG[1] + 0.87, 0.008]], 9, { cap0: false });
      b.set(C.skinDark, 3, 0);
      crewLathe(FIG[0], FIG[2] - 0.045, [[FIG[1] + 0.722, 0.10], [FIG[1] + 0.724, 0.205], [FIG[1] + 0.735, 0.212], [FIG[1] + 0.748, 0.10]], 10, { sb: 1.38, cap0: false, cap1: false });
      b.set(C.boot, 3, 0);
      for (let s = -1; s <= 1; s += 2) crewTube([[FIG[0] + s * 0.11, FIG[1] - 0.10, FIG[2] + 0.26], [FIG[0] + s * 0.12, FIG[1] - 0.38, FIG[2] + 0.40], [FIG[0] + s * 0.125, FIG[1] - 0.435, FIG[2] + 0.50], [FIG[0] + s * 0.125, FIG[1] - 0.445, FIG[2] + 0.60]], (f) => 0.062 - 0.018 * f, 6);
    }
    const crewDefaults = [{ x: 0.46, z: 0.12, scale: 0.90 }, { x: -0.46, z: 0.12, scale: 0.90 }, { x: 0.00, z: 0.56, scale: 0.86 }];
    const crewMembers = (((TW.settings || {}).navigation || {}).crew || {}).members || [];
    crewDefaults.forEach((d, i) => {
      const c = crewMembers[i] || d;
      const x = Number.isFinite(Number(c.x)) ? Math.max(-1.2, Math.min(1.2, Number(c.x))) : d.x;
      const z = Number.isFinite(Number(c.z)) ? Math.max(-0.8, Math.min(1.8, Number(c.z))) : d.z;
      const scale = Number.isFinite(Number(c.scale)) ? Math.max(0.60, Math.min(1.10, Number(c.scale))) : d.scale;
      addCrewMember(x, z, scale);
    });

    // ---- dressing: shipped oars, a cask, a coil of rope
    b.st.inside = 1;
    {
      for (let s = -1; s <= 1; s += 2) {
        b.set(C.blade, 0, 0);
        const a = [s * 0.50, 0.366, -1.75], c = [s * 0.44, 0.366, 0.85], d = [s * 0.43, 0.366, 1.47];
        tube(b, [a, vlerp(a, c, 0.5), c], (f) => 0.021 + 0.004 * (1 - f), 6);
        tube(b, [c, vlerp(c, d, 0.25), vlerp(c, d, 0.6), d], (f) => 0.024 + 0.055 * TW.smoothstep(0, 0.45, f) - 0.012 * f, 7, { up: [0, 1, 0], sn: 0.2 });
      }
      b.set(C.cask, 0, 0);
      const kx = -0.27, kz = 0.34, ky = -0.13;
      lathe(b, kx, kz, [[ky, 0.10], [ky + 0.08, 0.128], [ky + 0.20, 0.14], [ky + 0.32, 0.128], [ky + 0.40, 0.10]], 10);
      b.set(C.iron, 2, 0);
      [0.07, 0.33].forEach((h) => lathe(b, kx, kz, [[ky + h - 0.014, 0.128], [ky + h - 0.012, 0.134], [ky + h + 0.012, 0.134], [ky + h + 0.014, 0.128]], 10, { cap0: false, cap1: false }));
      b.set(C.rope, 5, 0);
      const coil = [];
      for (let i = 0; i <= 44; i++) { const a = i * 0.5, r = 0.17 - i * 0.0012; coil.push([0.25 + Math.cos(a) * r, -0.105 + i * 0.0018, 1.3 + Math.sin(a) * r]); }
      tube(b, coil, 0.02, 5);
    }

    b.st.inside = 0;
    // ---- invisible deck cap (depth only): keeps the sea out of the boat
    const cap = [], capIdx = [];
    for (let i = 0; i <= NU; i++) {
      hullPt(i / NU, 1, 1, P);
      cap.push(P[0] - 0.01, P[1] - 0.012, P[2], -P[0] + 0.01, P[1] - 0.012, P[2]);
      if (i < NU) { const a = i * 2; capIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    return { b, cap: new Float32Array(cap), capIdx: new Uint16Array(capIdx) };
  }

  // ---------------------------------------------------------------- shaders
  const VS = `
#include <env>
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aCol;
layout(location=4) in vec4 aPart;
layout(location=5) in vec2 aThin;   // tube radius, minimum apparent radius in pixels (0 = leave alone)
uniform mat4 uModel;
uniform mat4 uPart[5];
uniform vec4 uRopeA[2];
uniform vec4 uRopeB[2];
uniform vec4 uWindL;
out vec3 vP; out vec3 vN; out vec3 vL; out vec2 vUV; out vec4 vCol; out float vIn;
void main(){
  int part = int(aPart.x + 0.5);
  vec3 lp; vec3 ln;
  if (part == 5) {
    int k = int(aPart.z + 0.5);
    vec3 A = uRopeA[k].xyz; vec3 B = uRopeB[k].xyz;
    vec3 ax = normalize(B - A);
    vec3 s1 = normalize(cross(ax, vec3(0.0, 1.0, 0.03)));
    vec3 s2 = cross(ax, s1);
    float w = aPart.y;
    lp = mix(A, B, w) + vec3(0.0, -uRopeA[k].w*sin(3.14159*w), 0.0) + s1*aPos.x + s2*aPos.y;
    ln = normalize(s1*aNor.x + s2*aNor.y + ax*aNor.z);
  } else {
    mat4 m = uPart[part];
    lp = (m*vec4(aPos, 1.0)).xyz;
    ln = mat3(m)*aNor;
    float fw = aPart.y;
    if (fw > 0.0) {
      float ph = uTime*8.0 + aPos.y*17.0 + aPos.x*11.0 + aPos.z*13.0;
      lp += uWindL.xyz*(fw*uWindL.w*(0.05 + 0.04*sin(ph))) + vec3(0.0, fw*0.02*sin(ph*1.7), 0.0);
    }
  }
  if (aThin.y > 0.0) {   // keep rigging and thin ironwork from shrinking into flickering hairlines
    float dist = distance((uModel*vec4(lp, 1.0)).xyz, uCamPos.xyz);
    float px = 2.0*dist/(uProj[1][1]*uScreen.y);
    lp += normalize(ln)*max(0.0, aThin.y*px - aThin.x);
  }
  vL = lp; vIn = aPart.w;
  vec4 wp = uModel*vec4(lp, 1.0);
  vP = wp.xyz; vN = mat3(uModel)*ln; vUV = aUV; vCol = aCol;
  gl_Position = uViewProj*wp;
}`;

  const FS = `
#include <noise>
#include <light>
#include <fog>
in vec3 vP; in vec3 vN; in vec3 vL; in vec2 vUV; in vec4 vCol; in float vIn;
uniform vec4 uLamp;   // x = intensity*flicker, y = intensity, z = hull health
  uniform vec4 uHeartL; // xyz = Heartlight lamp, w = strength of its ignition flash here
  uniform vec4 uTint;   // rgb = fleet identity tint; player uses white
out vec4 o;
const vec3 FIGP = vec3(FIGX, FIGY, FIGZ);
float sq(float x){ return x*x; }
// the skiff's own lantern, with a tight physical falloff so its light pools near the bow
vec3 lanternLight(vec3 P, vec3 N, float wrap){
  vec3 L = uLantern.xyz - P; float d2 = dot(L, L);
  return uLanternColor.rgb*(uLantern.w*7.0/(1.0 + d2/1.3)*twWrap(dot(N, L*inversesqrt(d2 + 1e-4)), wrap));
}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos.xyz - vP);
  float ndv = max(dot(N, V), 0.0);
  int mt = int(vCol.a + 0.5);
  vec3 alb = vCol.rgb; float rough = 0.55; float spec = 0.22; vec3 emis = vec3(0.0);
  float grain = twTexNoise(vec2(vUV.x*0.13, vUV.y*1.35)).r;             // long streaks along the timber
  vec4 nB = twTexNoise(vL.zy*0.37 + vL.x*0.29 + 0.31);
  float blot = nB.g;
  // ---- baked occlusion inside the hull
  float ao = 1.0; float lanOcc = 1.0;
  if (vIn > 0.5) {
    ao = mix(0.26, 1.0, smoothstep(-0.32, 0.40, vL.y));
    float below = smoothstep(0.335, 0.19, vL.y);
    float th = exp(-sq((vL.z + 1.45)/0.21)) + exp(-sq((vL.z + 0.2)/0.20)) + exp(-sq((vL.z - 0.9)/0.23)) + smoothstep(-2.02, -2.22, vL.z);
    ao *= 1.0 - 0.6*clamp(th, 0.0, 1.0)*below;
    float fd = smoothstep(1.68, 2.0, vL.z);
    ao *= mix(1.0, 0.22, fd); lanOcc = 1.0 - fd;
    vec3 df = vL - FIGP;
    ao *= 1.0 - 0.55*exp(-dot(df.xz, df.xz)/0.15)*smoothstep(0.7, 0.05, df.y);
  }
  if (mt == 1) {
    float k = floor(vUV.y), f = fract(vUV.y);
    float g2 = twTexNoise(vec2(vUV.x*0.11 + k*0.37, vUV.y*1.6)).r;
    vec3 col = vec3(0.052, 0.039, 0.029)*(0.5 + 1.0*g2)*(0.82 + 0.36*twHash(vec2(k, 1.7)));
    float chip = smoothstep(0.30, 0.46, blot + 0.22*g2);
    if (k > 6.5) col = mix(vec3(0.12, 0.09, 0.055)*(0.6 + 0.8*g2), vec3(0.026, 0.088, 0.070)*(0.65 + 0.7*nB.r), chip);
    float wob = (blot - 0.5)*0.05;
    float under = smoothstep(0.05, 0.0, vL.y + wob);
    col = mix(col, mix(vec3(0.15, 0.045, 0.032), vec3(0.05, 0.08, 0.045), nB.b*0.7)*(0.6 + 0.6*g2), under*0.9);
    float boot = smoothstep(0.19, 0.13, vL.y + wob)*(1.0 - under);                 // dark boot-top band
    col = mix(col, vec3(0.012, 0.012, 0.014), boot*0.85);
    float salt = smoothstep(0.02, 0.07, vL.y)*smoothstep(0.30, 0.10, vL.y)*smoothstep(0.42, 0.75, nB.r + g2*0.3);
    col = mix(col, vec3(0.26, 0.28, 0.27), salt*0.35);
    // laps: a hard shadow tucked under the plank above, a bright worn edge on the plank's own lower lip
    float aa = fwidth(vUV.y)*1.5;
    float sh = smoothstep(0.80 - aa, 0.97, f);
    float lip = 1.0 - smoothstep(0.035, 0.085 + aa, f);
    col *= mix(1.0, 0.22, sh);
    col *= 1.0 + 0.75*lip;
    vec2 rv = vec2((fract(vUV.x/0.17) - 0.5)*0.17, (f - 0.15)*0.16);
    col = mix(col, vec3(0.24, 0.13, 0.05), smoothstep(0.014, 0.007, length(rv))*0.8);
    col *= mix(0.55, 1.0, uLamp.z*0.5 + 0.5);
    alb = col; rough = mix(0.16, 0.36, smoothstep(0.0, 0.7, vL.y)) - 0.06*lip; spec = 0.85 + 0.6*lip;
  } else if (mt == 0) {
    alb *= (0.55 + 0.9*grain)*mix(0.72, 1.05, blot); rough = 0.42; spec = 0.38;
  } else if (mt == 7) {
    float f = fract(vUV.y); float aa = fwidth(vUV.y);
    float ln = smoothstep(0.02, 0.05 + aa, min(f, 1.0 - f));
    alb *= (0.55 + 0.9*grain)*mix(0.22, 1.0, ln)*(0.85 + 0.3*twHash(vec2(floor(vUV.y), 4.1))); rough = 0.36; spec = 0.4;
  } else if (mt == 2) {
    alb = mix(alb, vec3(0.13, 0.05, 0.02), smoothstep(0.45, 0.75, blot)*0.6); rough = 0.24; spec = 1.3;
  } else if (mt == 3) {
    // wet black-olive oilskin: dark and glossy, with soft fold shading
    vec3 df = vL - FIGP;
    float fold = sin(atan(df.x, df.z)*7.0 + df.y*5.0 + nB.r*3.0);
    alb *= (0.7 + 0.3*smoothstep(-0.7, 0.8, fold))*(0.85 + 0.3*nB.r);
    rough = 0.24; spec = 0.5;
    float rimF = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.4);
    // lantern warmth only on the edges that face forward to it
    emis = lanternLight(vP, N, 0.15)*(rimF*0.9 + 0.05)*vec3(1.0, 0.8, 0.55);
    // a cool wet rim from moon and sky so the silhouette holds against the dark hull
    emis += uMoonColor.rgb*(rimF*0.22*twWrap(dot(N, uMoonDir.xyz), 0.8)) + uAmbient.rgb*(rimF*0.26 + 0.05);
  } else if (mt == 4) {
    float I = uLamp.x;
    float hgt = vUV.x;
    float core = pow(ndv, 6.0)*exp(-sq((hgt - 0.38)*4.5));
    float flick = 0.85 + 0.15*sin(uTime*31.0 + hgt*9.0);
    emis = uLanternColor.rgb*I*(0.55 + 1.5*pow(ndv, 0.8))*(0.7 + 0.6*exp(-sq((hgt - 0.4)*2.2))) + vec3(1.0, 0.84, 0.52)*(I*core*46.0*flick);
    emis += vec3(0.30, 0.05, 0.012)*(core*(1.0 - clamp(uLamp.y, 0.0, 1.0)));
    alb = vec3(0.02); rough = 0.08; spec = 0.9;
  } else if (mt == 5) {
    alb *= (0.75 + 0.25*sin(vUV.x*260.0 + vUV.y*6.283))*(0.7 + 0.5*blot); rough = 0.9; spec = 0.05;
  } else {
    emis = vCol.rgb*(0.4 + uLamp.y)*2.2; alb = vec3(0.0);
  }
  if (mt == 0 || mt == 1 || mt == 2 || mt == 5) alb *= uTint.rgb;
  vec3 Ln = normalize(uLantern.xyz - vP);
  vec3 E = twIrradiance(vP, N) - twLanternAt(vP)*twWrap(dot(N, Ln), 0.45);        // shared lighting without its flat lantern wash
  vec3 lan = lanternLight(vP, N, 0.18)*lanOcc;
  vec3 c = alb*(E*ao + lan*mix(1.0, ao, 0.4));
  // specular: take the shared lantern highlight out (it has no falloff and floods the boat) and put a physical one back
  float shin = mix(220.0, 6.0, clamp(rough, 0.0, 1.0));
  float lsp = twSpecTerm(N, V, Ln, shin);
  vec3 Lq = uLantern.xyz - vP;
  vec3 sp = max(twSpecular(vP, N, V, rough) - twLanternAt(vP)*lsp, vec3(0.0));
  sp += uLanternColor.rgb*(uLantern.w*7.0/(1.0 + dot(Lq, Lq)/1.3)*min(lsp, 2.5)*0.35*lanOcc);
  c += sp*(spec*0.6*ao);
  float fr = pow(clamp(1.0 - ndv, 0.0, 1.0), 4.0);
  c += twAmbient(reflect(-V, N))*(fr*spec*0.9*ao);
  if (uHeartL.w > 0.001) {   // the Heartlight catching: warm key and rim from the lamp side
    vec3 Lh = normalize(uHeartL.xyz - vP);
    float nh = twWrap(dot(N, Lh), 0.25);
    c += vec3(1.0, 0.78, 0.46)*(uHeartL.w*ao)*(alb*nh*2.2 + nh*pow(1.0 - ndv, 3.0)*(0.10 + 0.25*spec));
  }
  c += emis;
  o = vec4(twFog(c, vP), 1.0);
}`;

  const SAIL_VS = `
#include <env>
layout(location=0) in vec2 aST;
uniform mat4 uModel; uniform mat4 uRig;
uniform vec4 uSail;      // x = amount set 0..1, y = belly (m, signed), z = luff 0..1, w = wind 0..1
uniform vec2 uCorner[4]; // tack, clew, throat, peak as (aft of mast, height)
uniform vec3 uRigO;      // x = sail plane offset from the mast centre, z = mast z
out vec3 vP; out vec3 vN; out vec2 vST; out float vFold;
vec3 sailPos(vec2 st){
  float s = st.x, t = st.y, f = uSail.x;
  float r = 1.0 - f;                              // fraction of the cloth gathered into a roll under the working foot
  float tt = max(t, r);
  float te = (tt - r)/max(f, 0.001);              // 0 at the working foot .. 1 at the head
  float inRoll = step(t, r)*step(0.002, r);
  float q = t/max(r, 0.002);                      // 0 at the cloth's own foot .. 1 where it joins the set sail
  vec2 foot = mix(uCorner[0], uCorner[1], s);
  vec2 head = mix(uCorner[2], uCorner[3], s);
  vec2 p = mix(foot, head, tt);
  float sp = sin(3.14159*s);
  p.x += 0.20*sin(3.14159*te)*s*s*f;
  p.y -= 0.07*sp*(1.0 - te)*f;
  p.y -= 0.10*r*f*sp*(1.0 - te);                  // a brailed foot hangs in a shallow swag
  float bs = sin(3.14159*pow(max(s, 0.0), 0.8));
  float bt = pow(max(1.0 - te, 0.0), 0.6)*(0.45 + 0.55*te)*1.9;
  float tw = s*s*sin(3.14159*te)*0.55;
  float x = uSail.y*(bs*bt + tw)*mix(0.35, 1.0, f);
  float tm = uTime;
  x += 0.018*uSail.w*f*sin(s*17.0 - tm*10.0 + te*6.0)*s;
  x += 0.012*uSail.w*f*sin(s*7.0 + te*23.0 - tm*6.3)*s*(1.0 - te);
  float lf = uSail.z*f;
  x += lf*(0.08 + 0.30*s)*sin(s*8.0 - tm*16.0 + te*5.0)*(1.0 - 0.5*te);
  x += lf*0.07*s*sin(s*21.0 + tm*27.0 + te*13.0);
  // the gathered cloth: neat horizontal folds wound into a bundle
  float rr = (0.03 + 0.085*r)*sqrt(max(1.0 - q, 0.0))*(0.55 + 0.45*sp);
  float ang = q*6.2832*(1.5 + 3.0*r);
  x += inRoll*rr*sin(ang);
  p.y -= inRoll*rr*(1.15 - cos(ang));
  x += uRigO.x;
  if (x < uRigO.x) x = uRigO.x + (x - uRigO.x)*smoothstep(0.04, 0.85, abs(p.x));   // bad tack: the cloth lies flat by the mast and eases away from it, no ridge
  return vec3(x, p.y, uRigO.z - p.x);
}
void main(){
  float e = 0.012;
  vec3 p0 = sailPos(aST);
  vec3 p1 = sailPos(aST + vec2(e, 0.0));
  vec3 p2 = sailPos(aST + vec2(0.0, e));
  vec3 n = normalize(cross(p1 - p0, p2 - p0) + vec3(1e-6, 0.0, 0.0));
  mat4 m = uModel*uRig;
  vec4 wp = m*vec4(p0, 1.0);
  vP = wp.xyz; vN = mat3(m)*n; vST = aST; vFold = step(aST.y, 1.0 - uSail.x)*step(0.002, 1.0 - uSail.x);
  gl_Position = uViewProj*wp;
}`;

  const SAIL_FS = `
#include <noise>
#include <light>
#include <fog>
in vec3 vP; in vec3 vN; in vec2 vST; in float vFold;
uniform vec4 uSail;
  uniform vec4 uHeartL;
  uniform vec4 uTint;
uniform sampler2D uSailDecal;
uniform float uDecalOn;
out vec4 o;
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos.xyz - vP);
  float s = vST.x, t = vST.y;
  // ---- cloth: seven cloths parallel to the leech
  float pc = s*7.0 + t*0.35;
  float pid = floor(pc), pf = fract(pc);
  float pd = min(pf, 1.0 - pf);
  float aw = fwidth(pc);
  float seam = 1.0 - smoothstep(0.035, 0.05 + aw*1.5, pd);
  float stitch = (1.0 - smoothstep(0.055, 0.07 + aw, abs(pd - 0.085)*2.0))*step(0.5, fract(t*90.0));
  vec4 n1 = twTexNoise(vec2(s*5.0, t*9.0));
  vec4 n2 = twTexNoise(vec2(s*0.9 + 0.3, t*1.4 + 0.1));
  vec4 n3 = twTexNoise(vec2(s*3.1 + pid*0.13, t*0.5));                    // rain-streak stains run down the cloth
  float weave = twTexNoise(vec2(s*38.0, t*70.0)).a;
  vec3 tan1 = vec3(0.092, 0.021, 0.015), tan2 = vec3(0.142, 0.037, 0.025);     // deep oxblood: moonlight tints it, never bleaches it
  float ph = twHash(vec2(pid, 3.7));
  vec3 alb = mix(tan1, tan2, 0.30*ph + 0.5*smoothstep(0.35, 0.8, n2.r));
  alb *= (0.78 + 0.34*n1.r)*(0.90 + 0.20*weave);
  alb *= mix(0.60, 1.0, smoothstep(0.30, 0.62, n3.r));                    // darker damp streaks
  alb = mix(alb, vec3(dot(alb, vec3(0.4)))*vec3(1.25, 1.0, 0.9), 0.22*smoothstep(0.55, 0.85, n2.b)); // sun-bleached blooms
  alb *= mix(0.55, 1.0, smoothstep(0.0, 0.40, t + (n2.g - 0.5)*0.30));    // wet, dark foot
  // reef bands and points
  float rb = 0.0, rp = 0.0;
  for (int i = 0; i < 2; i++) {
    float dtb = t - (0.20 + 0.20*float(i));
    rb += 1.0 - smoothstep(0.007, 0.014, abs(dtb));
    float sp = fract(s*13.0 + 0.5) - 0.5;
    rp += (1.0 - smoothstep(0.03, 0.07, abs(sp)))*smoothstep(-0.052, -0.042, dtb)*(1.0 - smoothstep(-0.004, 0.002, dtb));
  }
  rb = clamp(rb, 0.0, 1.0); rp = clamp(rp, 0.0, 1.0);
  alb = mix(alb, tan1*0.6, rb*0.28);
  alb = mix(alb, vec3(0.16, 0.13, 0.10), rp*0.45);
  // a stitched patch
  vec2 pq = vec2(s - 0.62, (t - 0.55)*1.6);
  pq = vec2(pq.x*0.96 - pq.y*0.28, pq.x*0.28 + pq.y*0.96);
  float pm = max(abs(pq.x)/0.085, abs(pq.y)/0.075);
  float ptch = 1.0 - smoothstep(0.9, 1.0, pm);
  float pedge = ptch*smoothstep(0.72, 0.86, pm);
  alb = mix(alb, alb*1.28 + vec3(0.014, 0.008, 0.006), ptch);   // newer cloth of the same stuff: a shade lighter, same weave and light
  alb *= 1.0 - 0.32*pedge;
  // tabling along luff / foot / leech / head, with a pale bolt-rope on the very edge
  float ed = min(min(s, 1.0 - s), min(t*1.4, (1.0 - t)*1.4));
  float tabl = 1.0 - smoothstep(0.022, 0.034, ed);
  float rope = 1.0 - smoothstep(0.004, 0.010, ed);
  alb *= 1.0 - max(seam*0.27, tabl*0.30);            // stitched lines, not a grid
  alb *= 1.0 - 0.10*stitch*(1.0 - seam);
  alb = mix(alb, vec3(0.10, 0.085, 0.07), rope*0.5);
  float thick = max(max(seam, tabl), max(ptch*0.7, rb));
  // ---- form: the belly reads as a volume, wrinkles fan out of the corners
  float bulge = clamp(sin(3.14159*pow(max(s, 0.0), 0.8))*pow(max(1.0 - t, 0.0), 0.6)*(0.45 + 0.55*t)*1.9, 0.0, 1.0);
  float amt = clamp(abs(uSail.y)/0.45, 0.0, 1.0)*uSail.x;
  bool convex = (gl_FrontFacing == (uSail.y > 0.0));
  float form = convex ? mix(0.55, 1.12, bulge) : mix(1.05, 0.50, bulge);
  form = mix(1.0, form, amt);
  vec2 d0 = vec2(s, t*1.9), d1 = vec2(s, (1.0 - t)*1.9), d2 = vec2(1.0 - s, t*1.9);
  float wr = sin(atan(d0.y, d0.x)*44.0 + n2.r*9.0)*exp(-length(d0)*3.4)
           + sin(atan(d1.y, d1.x)*38.0 + n2.g*9.0)*exp(-length(d1)*3.4)
           + sin(atan(d2.y, d2.x)*40.0 + n2.b*8.0)*exp(-length(d2)*4.0);
  form *= 1.0 + 0.15*wr*(0.5 + n1.g);
  // broad soft gradient: darker toward the luff and the working foot, fullest light on the shoulder of the belly
  float te = clamp((t - (1.0 - uSail.x))/max(uSail.x, 0.001), 0.0, 1.0);
  form *= mix(0.55, 1.0, smoothstep(0.0, 0.30, s))*mix(0.62, 1.0, smoothstep(0.0, 0.38, te))*mix(1.0, 0.82, smoothstep(0.75, 1.0, te));
  // gathered cloth: plain, in soft shadow; its folds come from the geometry
  float roll = clamp(vFold, 0.0, 1.0);
  alb = mix(alb, mix(tan1, tan2, 0.35)*(0.8 + 0.3*n1.r), roll);
  form = mix(form, 0.8, roll);
  // Sponsor print follows the sail UVs, so it deforms with the existing cloth mesh.
  // Keep the printed colours independent from the boat's fleet tint.
  vec4 sponsor = texture(uSailDecal, vec2(s, t));
  float printMask = sponsor.a * uDecalOn * (1.0 - roll);
  alb = mix(alb * uTint.rgb, sponsor.rgb, printMask);
  // ---- light: the sail is a lit object. Cool moon on the cloth, the lantern only as a pool low by the tack.
  vec3 Lv = uLantern.xyz - vP; float d2l = dot(Lv, Lv); vec3 Ld = Lv*inversesqrt(d2l + 1e-4);
  float teL = clamp((t - (1.0 - uSail.x))/max(uSail.x, 0.001), 0.0, 1.0);
  float pool = 1.0 - smoothstep(0.0, 0.62, teL); pool *= pool*(1.0 - roll);       // a smooth pool rising from the tack: no band, no edge
  vec3 lanC = uLanternColor.rgb*(uLantern.w*3.0/(1.0 + d2l/3.2))*pool;
  vec3 shared = twLanternAt(vP);
  vec3 moonF = uMoonColor.rgb*twWrap(dot(N, uMoonDir.xyz), 0.35);
  vec3 Ef = twIrradiance(vP, N) - shared*twWrap(dot(N, Ld), 0.45);
  Ef -= twAmbient(N)*0.12;                                                      // the far side falls to near black-brown
  vec3 Eb = max(twIrradiance(vP, -N) - twAmbient(-N) - shared*twWrap(dot(-N, Ld), 0.45), vec3(0.0));
  vec3 c = alb*(max(Ef, vec3(0.0))*form + lanC*(twWrap(dot(N, Ld), 0.2)*0.42));
  c += moonF*vec3(0.010, 0.006, 0.006)*form;                                    // a breath of sheen on the moon-facing side
  c += alb*vec3(1.6, 0.75, 0.62)*Eb*(0.09*(1.0 - 0.3*thick));                    // the faintest show-through of moon and lightning
  // translucency only where the lantern really is behind the cloth as seen from here
  float behind = twWrap(dot(-N, Ld), 0.1)*pow(max(dot(-V, Ld), 0.0), 1.5);
  c += vec3(1.0, 0.27, 0.07)*(0.25 + 1.7*alb.r)*lanC*(behind*0.16*(1.0 - 0.3*thick));
  // thin cool rim along the leech, and a touch on the bolt-rope
  float leech = smoothstep(0.972, 0.992, s)*(1.0 - roll);
  c += uMoonColor.rgb*(leech*0.10*(0.35 + 0.65*twWrap(dot(N, uMoonDir.xyz), 1.0)));
  c += uMoonColor.rgb*(rope*0.03*twWrap(dot(N, uMoonDir.xyz), 1.0));
  c += max(twSpecular(vP, N, V, 0.55) - shared*twSpecTerm(N, V, Ld, 110.9), vec3(0.0))*(0.04*form);
  if (uHeartL.w > 0.001) {   // and the sail catches the gold, a little of it through the cloth
    vec3 Lh = normalize(uHeartL.xyz - vP);
    c += vec3(1.0, 0.78, 0.46)*uHeartL.w*alb*(twWrap(dot(N, Lh), 0.3)*2.6*form + twWrap(dot(-N, Lh), 0.2)*0.7);
  }
  o = vec4(twFog(c, vP), 1.0);
}`;

  const CAP_VS = `
#include <env>
layout(location=0) in vec3 aPos;
uniform mat4 uModel;
void main(){ gl_Position = uViewProj*(uModel*vec4(aPos, 1.0)); }`;
  const CAP_FS = `out vec4 o; void main(){ o = vec4(0.0); }`;

  // ---------------------------------------------------------------- runtime
  let gl = null, prog = null, sailProg = null, capProg = null, mesh = null, sailMesh = null, capMesh = null, ready = false;
  let sponsorTextures = null;
  const model = M.create();
  const parts = new Float32Array(16 * 5);
  const ropeA = new Float32Array(8), ropeB = new Float32Array(8);
  const tmp3 = [0, 0, 0];
  const anim = { sx: 0, sz: 0, vx: 0, vz: 0, rudder: 0, belly: 0, sail: 0.7, wlx: 0, wlz: 1, wstr: 0.5, started: false };

  function makeSailTexture(source) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, 512, 512);
    if (source && source.width && source.height) {
      if (source.dataset && source.dataset.twSailDemo === '1') ctx.drawImage(source, 0, 0, 512, 512);
      else {
        const scale = Math.min(440 / source.width, 360 / source.height);
        const w = source.width * scale, h = source.height * scale;
        ctx.drawImage(source, (512 - w) * 0.5, (512 - h) * 0.5, w, h);
      }
    }
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  function createSponsorTextures() {
    const slots = { player: 'sail_player', prudent: 'sail_prudent', competitor: 'sail_competitor', aggressive: 'sail_aggressive' };
    const out = {};
    Object.keys(slots).forEach((key) => {
      const fallback = TW.sponsors && TW.sponsors.getSailFallback ? TW.sponsors.getSailFallback(slots[key]) : null;
      out[key] = makeSailTexture(fallback);
    });
    return out;
  }
  let sponsorTextureRevision = 0;
  function refreshSponsorTextures() {
    if (!TW.sponsors || typeof TW.sponsors.getSailImage !== 'function' || !gl) return;
    const revision = ++sponsorTextureRevision;
    const slots = { player: 'sail_player', prudent: 'sail_prudent', competitor: 'sail_competitor', aggressive: 'sail_aggressive' };
    Promise.all(Object.keys(slots).map(async (key) => [key, await TW.sponsors.getSailImage(slots[key])]))
      .then((entries) => {
        if (revision !== sponsorTextureRevision || !gl || gl.isContextLost()) return;
        entries.forEach(([key, image]) => {
          const next = makeSailTexture(image);
          if (!next) return;
          const previous = sponsorTextures && sponsorTextures[key];
          sponsorTextures[key] = next;
          if (previous && previous !== next) gl.deleteTexture(previous);
        });
      })
      .catch((e) => console.warn('[TW] sponsor sail texture failed:', e));
  }

  // parts[k] = T(p) * R(axis, angle) * T(-p)
  function setPivot(k, ax, ay, az, ang, px, py, pz) {
    const o = k * 16, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const m = parts;
    m[o] = t * ax * ax + c; m[o + 1] = t * ax * ay + s * az; m[o + 2] = t * ax * az - s * ay; m[o + 3] = 0;
    m[o + 4] = t * ax * ay - s * az; m[o + 5] = t * ay * ay + c; m[o + 6] = t * ay * az + s * ax; m[o + 7] = 0;
    m[o + 8] = t * ax * az + s * ay; m[o + 9] = t * ay * az - s * ax; m[o + 10] = t * az * az + c; m[o + 11] = 0;
    m[o + 12] = px - (m[o] * px + m[o + 4] * py + m[o + 8] * pz);
    m[o + 13] = py - (m[o + 1] * px + m[o + 5] * py + m[o + 9] * pz);
    m[o + 14] = pz - (m[o + 2] * px + m[o + 6] * py + m[o + 10] * pz);
    m[o + 15] = 1;
  }
  function xfPart(k, p, out, oo) {
    const o = k * 16, m = parts, x = p[0], y = p[1], z = p[2];
    out[oo] = m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12];
    out[oo + 1] = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13];
    out[oo + 2] = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
  }

  function init() {
    gl = TW.gl;
    sponsorTextures = createSponsorTextures();
    if (TW.sponsors && TW.sponsors.onChange) TW.sponsors.onChange(refreshSponsorTextures);
    refreshSponsorTextures();
    const built = buildBoat(), b = built.b;
    mesh = TW.glx.mesh({
      attribs: [
        { loc: 0, size: 3, data: new Float32Array(b.p) }, { loc: 1, size: 3, data: new Float32Array(b.n) },
        { loc: 2, size: 2, data: new Float32Array(b.uv) }, { loc: 3, size: 4, data: new Float32Array(b.c) },
        { loc: 4, size: 4, data: new Float32Array(b.pt) }, { loc: 5, size: 2, data: new Float32Array(b.th) },
      ],
      indices: b.p.length / 3 > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx),
    });
    capMesh = TW.glx.mesh({ attribs: [{ loc: 0, size: 3, data: built.cap }], indices: built.capIdx });
    // sail grid
    const NS = 22, NT = 30, st = new Float32Array((NS + 1) * (NT + 1) * 2), si = new Uint16Array(NS * NT * 6);
    let k = 0;
    for (let j = 0; j <= NT; j++) for (let i = 0; i <= NS; i++) { st[k++] = i / NS; st[k++] = j / NT; }
    k = 0;
    for (let j = 0; j < NT; j++) for (let i = 0; i < NS; i++) {
      const a = j * (NS + 1) + i;
      si[k++] = a; si[k++] = a + 1; si[k++] = a + NS + 1; si[k++] = a + 1; si[k++] = a + NS + 2; si[k++] = a + NS + 1;
    }
    sailMesh = TW.glx.mesh({ attribs: [{ loc: 0, size: 2, data: st }], indices: si });
    prog = TW.glx.program(VS, FS.replace('FIGX', FIG[0].toFixed(3)).replace('FIGY', FIG[1].toFixed(3)).replace('FIGZ', FIG[2].toFixed(3)), 'boat');
    sailProg = TW.glx.program(SAIL_VS, SAIL_FS, 'boat-sail');
    if (TW.sponsors && TW.sponsors.setConnected) ['sail_player', 'sail_prudent', 'sail_competitor', 'sail_aggressive'].forEach((id) => TW.sponsors.setConnected(id, !!(prog.ok && sailProg.ok && sailMesh)));
    capProg = TW.glx.program(CAP_VS, CAP_FS, 'boat-cap');
    if (sailProg.ok) {
      sailProg.use();
      gl.uniform2fv(sailProg.loc('uCorner[0]'), CORNERS);
      sailProg.set3f('uRigO', SAILX, 0, ZM);
    }
    for (let i = 0; i < 5; i++) setPivot(i, 0, 1, 0, 0, 0, 0, 0);
    TW.boat.verts = b.p.length / 3; TW.boat.tris = b.idx.length / 3;
    ready = true;
  }

  function update(dt) {
    if (!ready) return;
    const S = TW.state, bt = S.boat;
    if (S.phase === 'paused' || !(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    // apparent wind in boat-local space
    const ws = S.wind.speed * (1 + S.wind.gust);
    const ax = S.wind.dirX * ws - bt.vx, az = S.wind.dirZ * ws - bt.vz;
    const ch = Math.cos(bt.heading), sh = Math.sin(bt.heading);
    const lx = ax * ch - az * sh, lz = ax * sh + az * ch, al = Math.hypot(lx, lz);
    anim.wlx = al > 0.01 ? lx / al : 0; anim.wlz = al > 0.01 ? lz / al : 1; anim.wstr = TW.clamp(al / 14, 0.15, 1.5);
    // belly: the cloth fills away from the wind
    const cb = Math.cos(bt.boom), sb = Math.sin(bt.boom);
    const wn = lx * cb - lz * sb;
    const target = TW.clamp(wn / 5, -1, 1) * Math.min(0.80, 0.24 + 0.03 * al) * (1 - 0.75 * TW.saturate(bt.luff));
    const rud = TW.clamp(bt.rudder || 0, -1, 1), sl = DBG_SAIL >= 0 ? DBG_SAIL : TW.saturate(bt.sail);
    if (DBG_LUFF >= 0) bt.luff = DBG_LUFF;
    if (!anim.started) { anim.started = true; anim.belly = target; anim.rudder = rud; anim.sail = sl; anim.sx = -bt.pitch; anim.sz = -bt.roll; }
    anim.belly = TW.damp(anim.belly, target, 4.5, dt);
    anim.rudder = TW.damp(anim.rudder, rud, 9, dt);
    anim.sail = TW.damp(anim.sail, sl, 7, dt);
    // lantern: a damped pendulum that tries to hang plumb while the boat moves under it
    const h = dt * 0.5, w2 = 30, c = 1.5;
    for (let i = 0; i < 2; i++) {
      anim.vx += (-w2 * (anim.sx + bt.pitch) - c * anim.vx) * h; anim.sx += anim.vx * h;
      anim.vz += (-w2 * (anim.sz + bt.roll) - c * anim.vz) * h; anim.sz += anim.vz * h;
    }
    if (anim.sx > 0.45) { anim.sx = 0.45; anim.vx = 0; } else if (anim.sx < -0.45) { anim.sx = -0.45; anim.vx = 0; }
    if (anim.sz > 0.45) { anim.sz = 0.45; anim.vz = 0; } else if (anim.sz < -0.45) { anim.sz = -0.45; anim.vz = 0; }
  }

  function draw() {
    if (!ready || !prog.ok) return;
    const S = TW.state, bt = S.boat;
    TW.boatMatrix(model);
    // part matrices
    setPivot(1, RD[0], RD[1], RD[2], anim.rudder * 0.61, RA0[0], RA0[1], RA0[2]);
    const sa = Math.hypot(anim.sx, anim.sz);
    if (sa > 1e-5) setPivot(2, anim.sx / sa, 0, anim.sz / sa, sa, PIV[0], PIV[1], PIV[2]); else setPivot(2, 1, 0, 0, 0, 0, 0, 0);
    const lz = TW.clamp(-bt.roll * 0.6 + anim.rudder * 0.07, -0.4, 0.4), lx = TW.clamp(-bt.pitch * 0.45, -0.3, 0.3) + 0.03 * Math.sin(S.time * 0.9);
    const la = Math.hypot(lx, lz);
    if (la > 1e-5) setPivot(3, lx / la, 0, lz / la, la, FIG[0], FIG[1] - 0.05, FIG[2]); else setPivot(3, 1, 0, 0, 0, 0, 0, 0);
    setPivot(4, 0, 1, 0, bt.boom, 0, 0, ZM);
    // ropes
    ropeA[0] = SHEET_A[0]; ropeA[1] = SHEET_A[1]; ropeA[2] = SHEET_A[2]; ropeA[3] = 0.04 + 0.16 * (1 - Math.min(1, Math.abs(bt.boom) / 1.2)) + 0.1 * TW.saturate(bt.luff);
    xfPart(4, BOOM_END, ropeB, 0); ropeB[3] = 0;
    xfPart(3, SHOULDER, ropeA, 4); ropeA[7] = 0.07;
    xfPart(1, GRIP, ropeB, 4); ropeB[5] += 0.03; ropeB[7] = 0;

    const lampI = Math.max(0, S.lantern.intensity), flick = S.lantern.flicker;
    prog.use();
    prog.setMat4('uModel', model);
    gl.uniformMatrix4fv(prog.loc('uPart[0]'), false, parts);
    gl.uniform4fv(prog.loc('uRopeA[0]'), ropeA);
    gl.uniform4fv(prog.loc('uRopeB[0]'), ropeB);
    prog.set4f('uWindL', anim.wlx, 0, anim.wlz, anim.wstr);
    prog.set4f('uTint', 1, 1, 1, 1);
    // the Heartlight's ignition flash as it reaches the skiff: quick rise, ~2 s decay to a gentle standing key
    let hw = 0, hx = 0, hy = 0, hz = 0;
    { const h = S.heart;
      if (h && h.t >= 0) {
        hx = h.x; hy = h.y; hz = h.z;
        const d = Math.hypot(h.x - bt.x, h.z - bt.z);
        hw = TW.smoothstep(0, 0.14, h.t) * (0.22 + 0.78 * Math.exp(-h.t * 1.25)) / (1 + d / 260);
      } }
    prog.set4f('uHeartL', hx, hy, hz, hw);
    prog.set4f('uLamp', lampI * flick, lampI, bt.hull === undefined ? 1 : bt.hull, 0);
    mesh.draw();

    if (sailProg.ok) {
      gl.disable(gl.CULL_FACE);
      sailProg.use();
      const playerTexture = sponsorTextures && sponsorTextures.player;
      sailProg.setTex('uSailDecal', 0, playerTexture);
      sailProg.set1f('uDecalOn', playerTexture ? 1 : 0);
      sailProg.setMat4('uModel', model);
      gl.uniformMatrix4fv(sailProg.loc('uRig'), false, rigView);
      sailProg.set4f('uHeartL', hx, hy, hz, hw);
      sailProg.set4f('uTint', 1, 1, 1, 1);
      sailProg.set4f('uSail', anim.sail, anim.belly, TW.saturate(bt.luff), Math.min(1.3, anim.wstr));
      sailMesh.draw();
      gl.enable(gl.CULL_FACE);
    }

    // depth-only deck cap so the ocean (drawn next) cannot show inside the hull
    if (capProg.ok) {
      gl.colorMask(false, false, false, false);
      gl.disable(gl.CULL_FACE);
      capProg.use();
      capProg.setMat4('uModel', model);
      capMesh.draw();
      gl.enable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
    }
    if (TW.fleet && TW.fleet.draw) TW.fleet.draw();
    gl.bindVertexArray(null);
  }

  // Fleet rendering entry point. It reuses the player hull/sail meshes and shaders,
  // but receives an independent boat state. The player draw() above remains the
  // authoritative path for TW.state.boat and is intentionally unchanged.
  function drawState(st, visual) {
    if (!ready || !prog.ok || !st) return;
    const bt = st, v = visual || {};
    const model2 = M.create();
    M.fromTRS(model2, bt.x, bt.y, bt.z, bt.heading, bt.pitch || 0, bt.roll || 0);
    const rud = TW.clamp(bt.rudder || 0, -1, 1), boom = bt.boom || 0;
    setPivot(1, RD[0], RD[1], RD[2], rud * 0.61, RA0[0], RA0[1], RA0[2]);
    const sx = -(bt.pitch || 0), sz = -(bt.roll || 0), sa = Math.hypot(sx, sz);
    if (sa > 1e-5) setPivot(2, sx / sa, 0, sz / sa, sa, PIV[0], PIV[1], PIV[2]); else setPivot(2, 1, 0, 0, 0, 0, 0, 0);
    const lx = TW.clamp(-(bt.pitch || 0) * 0.45, -0.3, 0.3), lz = TW.clamp(-(bt.roll || 0) * 0.6 + rud * 0.07, -0.4, 0.4), la = Math.hypot(lx, lz);
    if (la > 1e-5) setPivot(3, lx / la, 0, lz / la, la, FIG[0], FIG[1] - 0.05, FIG[2]); else setPivot(3, 1, 0, 0, 0, 0, 0, 0);
    setPivot(4, 0, 1, 0, boom, 0, 0, ZM);
    ropeA[0] = SHEET_A[0]; ropeA[1] = SHEET_A[1]; ropeA[2] = SHEET_A[2]; ropeA[3] = 0.04 + 0.16 * (1 - Math.min(1, Math.abs(boom) / 1.2)) + 0.1 * TW.saturate(bt.luff || 0);
    xfPart(4, BOOM_END, ropeB, 0); ropeB[3] = 0; xfPart(3, SHOULDER, ropeA, 4); ropeA[7] = 0.07; xfPart(1, GRIP, ropeB, 4); ropeB[5] += 0.03; ropeB[7] = 0;
    const wind = TW.state.wind, ws = wind.speed * (1 + wind.gust), ax = wind.dirX * ws - (bt.vx || 0), az = wind.dirZ * ws - (bt.vz || 0), ch = Math.cos(bt.heading), sh = Math.sin(bt.heading);
    const wlX = ax * ch - az * sh, wlZ = ax * sh + az * ch, al = Math.hypot(wlX, wlZ);
    const wlx = al > 0.01 ? wlX / al : 0, wlz = al > 0.01 ? wlZ / al : 1, wstr = TW.clamp(al / 14, 0.15, 1.5);
    const sail = TW.saturate(bt.sail === undefined ? 0.7 : bt.sail), belly = v.belly === undefined ? 0.25 : v.belly;
    const tint = v.tint || [1, 1, 1];
    prog.use(); prog.setMat4('uModel', model2); gl.uniformMatrix4fv(prog.loc('uPart[0]'), false, parts); gl.uniform4fv(prog.loc('uRopeA[0]'), ropeA); gl.uniform4fv(prog.loc('uRopeB[0]'), ropeB); prog.set4f('uWindL', wlx, 0, wlz, wstr); prog.set4f('uHeartL', 0, 0, 0, 0); prog.set4f('uLamp', 0, 0, bt.hull === undefined ? 1 : bt.hull, 0); prog.set4f('uTint', tint[0], tint[1], tint[2], 1); mesh.draw();
    if (sailProg.ok) { gl.disable(gl.CULL_FACE); sailProg.use(); const fleetTexture = sponsorTextures && sponsorTextures[bt.id]; sailProg.setTex('uSailDecal', 0, fleetTexture); sailProg.set1f('uDecalOn', fleetTexture ? 1 : 0); sailProg.setMat4('uModel', model2); gl.uniformMatrix4fv(sailProg.loc('uRig'), false, rigView); sailProg.set4f('uHeartL', 0, 0, 0, 0); sailProg.set4f('uTint', tint[0], tint[1], tint[2], 1); sailProg.set4f('uSail', sail, belly, TW.saturate(bt.luff || 0), Math.min(1.3, wstr)); sailMesh.draw(); gl.enable(gl.CULL_FACE); }
    if (capProg.ok) { gl.colorMask(false, false, false, false); gl.disable(gl.CULL_FACE); capProg.use(); capProg.setMat4('uModel', model2); capMesh.draw(); gl.enable(gl.CULL_FACE); gl.colorMask(true, true, true, true); }
    gl.bindVertexArray(null);
  }
  const rigView = parts.subarray(64, 80);
  const DBG_SAIL = TW.qf('sailamt', -1), DBG_LUFF = TW.qf('luff', -1);   // look-dev overrides (?sailamt=0.3&luff=1)

  TW.boat = { init, update, draw, drawState, verts: 0, tris: 0 };
})();
