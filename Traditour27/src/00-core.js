// ===== 00-core.js =====
// ============================================================================
// TIDEWRIGHT — 00-core.js
// Namespace, event bus, math, RNG/noise, WebGL2 helpers, shader chunk registry.
// OWNER: lead. Other modules must not edit this file.
// ============================================================================
(function () {
  'use strict';
  const TW = (window.TW = { version: '1.0' });

  // ---- query params (debug only; all optional) ---------------------------------
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { q = new URLSearchParams(''); }
  TW.q = q;
  TW.qf = (k, d) => (q.has(k) && isFinite(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);
  TW.qs = (k, d) => (q.has(k) ? q.get(k) : d);

  // ---- event bus ---------------------------------------------------------------
  const handlers = Object.create(null);
  TW.on = (name, fn) => { (handlers[name] || (handlers[name] = [])).push(fn); };
  TW.emit = (name, data) => {
    const h = handlers[name];
    if (!h) return;
    for (let i = 0; i < h.length; i++) {
      try { h[i](data); } catch (e) { console.error('[TW] handler error for "' + name + '"', e); }
    }
  };

  // ---- scalar helpers ----------------------------------------------------------
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  // frame-rate independent exponential approach: damp(current, target, rate, dt)
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  const wrapAngle = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  TW.clamp = clamp; TW.lerp = lerp; TW.saturate = saturate; TW.smoothstep = smoothstep; TW.damp = damp; TW.wrapAngle = wrapAngle;

  // ---- vec3 (plain arrays) -----------------------------------------------------
  const V = (TW.V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  });

  // ---- mat4 (Float32Array, column-major, right-handed, -Z forward in view) ------
  const M = (TW.M = {
    create: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    identity: (m) => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    copy: (o, a) => { o.set(a); return o; },
    multiply: (o, a, b) => {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return o;
    },
    perspective: (o, fovyRad, aspect, near, far) => {
      const f = 1 / Math.tan(fovyRad / 2), nf = 1 / (near - far);
      o.fill(0);
      o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
      return o;
    },
    lookAt: (o, eye, target, up) => {
      let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    invert: (o, a) => {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M.identity(o);
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    translation: (o, x, y, z) => { M.identity(o); o[12] = x; o[13] = y; o[14] = z; return o; },
    scaling: (o, x, y, z) => { M.identity(o); o[0] = x; o[5] = y; o[10] = z; return o; },
    rotationX: (o, a) => { const c = Math.cos(a), s = Math.sin(a); M.identity(o); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
    rotationY: (o, a) => { const c = Math.cos(a), s = Math.sin(a); M.identity(o); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
    rotationZ: (o, a) => { const c = Math.cos(a), s = Math.sin(a); M.identity(o); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; },
    // o = T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll) * S(scale)
    fromTRS: (o, x, y, z, yaw, pitch, roll, sx, sy, sz) => {
      const t = M._t || (M._t = [M.create(), M.create()]);
      M.translation(o, x, y, z);
      M.multiply(o, o, M.rotationY(t[0], yaw || 0));
      if (pitch) M.multiply(o, o, M.rotationX(t[0], pitch));
      if (roll) M.multiply(o, o, M.rotationZ(t[0], roll));
      if (sx !== undefined && (sx !== 1 || sy !== 1 || sz !== 1)) M.multiply(o, o, M.scaling(t[1], sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
      return o;
    },
    transformPoint: (m, p) => {
      const x = p[0], y = p[1], z = p[2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    },
    transformDir: (m, d) => [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]],
  });

  // ---- RNG + CPU noise (deterministic) -----------------------------------------
  TW.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  TW.seed = (TW.qf('seed', 7341) | 0) || 7341;
  const hash2 = (x, y, s) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  TW.hash2 = hash2;
  // value noise in [0,1], quintic interpolation
  TW.noise2 = function (x, y, seed) {
    seed = seed | 0;
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // fbm in ~[0,1]
  TW.fbm2 = function (x, y, octaves, seed, lacunarity, gain) {
    octaves = octaves || 5; lacunarity = lacunarity || 2.03; gain = gain || 0.5;
    let amp = 0.5, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * TW.noise2(x, y, (seed | 0) + i * 131);
      norm += amp; amp *= gain; x = x * lacunarity + 17.3; y = y * lacunarity - 9.1;
    }
    return sum / norm;
  };
  // ridged fbm in ~[0,1]
  TW.ridged2 = function (x, y, octaves, seed) {
    octaves = octaves || 5;
    let amp = 0.5, sum = 0, norm = 0, prev = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(TW.noise2(x, y, (seed | 0) + i * 197) * 2 - 1);
      n *= n; sum += n * amp * prev; norm += amp; prev = n; amp *= 0.5; x = x * 2.07 + 5.2; y = y * 2.07 + 1.3;
    }
    return sum / norm;
  };

  // ---- WebGL2 ------------------------------------------------------------------
  const glx = (TW.glx = {});
  TW.glsl = Object.create(null); // shader chunks: TW.glsl.name = "glsl source"; used via `#include <name>`
  TW.caps = { floatRT: false, floatLinear: false, maxTex: 2048 };

  TW.initGL = function (canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: TW.q.has('pdb'),
    });
    if (!gl) return null;
    TW.gl = gl; TW.canvas = canvas;
    TW.caps.floatRT = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    TW.caps.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    TW.caps.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    // fullscreen triangle
    glx._fsVAO = gl.createVertexArray();
    gl.bindVertexArray(glx._fsVAO);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // shared tiling noise texture on unit 6
    glx.noiseTex = makeNoiseTexture(gl);
    return gl;
  };

  const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
  function resolveIncludes(src, seen) {
    seen = seen || {};
    return src.replace(/^[ \t]*#include\s+<([\w-]+)>[ \t]*$/gm, (m, name) => {
      if (seen[name]) return '// (already included: ' + name + ')';
      seen[name] = true;
      const chunk = TW.glsl[name];
      if (chunk === undefined) { console.error('[TW] missing shader chunk <' + name + '>'); return '// MISSING CHUNK ' + name; }
      return '// ---- chunk <' + name + '> ----\n' + resolveIncludes(chunk, seen) + '\n// ---- end <' + name + '> ----';
    });
  }
  function compile(gl, type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || '';
      const lines = src.split('\n');
      const bad = {};
      log.replace(/ERROR:\s*\d+:(\d+)/g, (m, l) => { bad[+l] = 1; return m; });
      let ctx = '';
      Object.keys(bad).slice(0, 6).forEach((l) => {
        l = +l;
        for (let i = Math.max(1, l - 2); i <= Math.min(lines.length, l + 2); i++) ctx += (i === l ? '>> ' : '   ') + i + ': ' + lines[i - 1] + '\n';
        ctx += '   ...\n';
      });
      console.error('[TW] shader compile error in "' + name + '" (' + (type === gl.VERTEX_SHADER ? 'vertex' : 'fragment') + ')\n' + log + '\n' + ctx);
      TW.shaderErrors = (TW.shaderErrors || 0) + 1; (TW.shaderErrorNames || (TW.shaderErrorNames = [])).push(name);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  // Create a program. Sources must NOT contain #version/precision (added automatically).
  // `#include <chunk>` lines are resolved against TW.glsl at call time.
  // Auto-bound if present: uniform block `Env` -> binding 0, sampler `uNoiseTex` -> unit 6, sampler `uWorldMap` -> unit 7.
  // Returns { prog, use(), loc(name), set1i/1f/2f/3f/4f/3fv/4fv/Mat4(name, ...) } or a harmless dummy (ok=false) on failure.
  glx.program = function (vsSrc, fsSrc, name) {
    const gl = TW.gl;
    name = name || 'unnamed';
    const vs = compile(gl, gl.VERTEX_SHADER, HEADER + resolveIncludes(vsSrc), name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, HEADER + resolveIncludes(fsSrc), name);
    const prog = gl.createProgram();
    let ok = !!(vs && fs);
    if (ok) {
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[TW] program link error in "' + name + '": ' + gl.getProgramInfoLog(prog));
        ok = false; TW.shaderErrors = (TW.shaderErrors || 0) + 1; (TW.shaderErrorNames || (TW.shaderErrorNames = [])).push(name + ' (link)');
      }
    }
    const cache = Object.create(null);
    const p = {
      prog, ok, name,
      use() { gl.useProgram(ok ? prog : null); return p; },
      loc(n) { let l = cache[n]; if (l === undefined) l = cache[n] = ok ? gl.getUniformLocation(prog, n) : null; return l; },
      set1i(n, v) { gl.uniform1i(p.loc(n), v); return p; },
      set1f(n, v) { gl.uniform1f(p.loc(n), v); return p; },
      set2f(n, a, b) { gl.uniform2f(p.loc(n), a, b); return p; },
      set3f(n, a, b, c) { gl.uniform3f(p.loc(n), a, b, c); return p; },
      set4f(n, a, b, c, d) { gl.uniform4f(p.loc(n), a, b, c, d); return p; },
      set3fv(n, v) { gl.uniform3fv(p.loc(n), v); return p; },
      set4fv(n, v) { gl.uniform4fv(p.loc(n), v); return p; },
      setMat4(n, m) { gl.uniformMatrix4fv(p.loc(n), false, m); return p; },
      // bind a texture to a unit and point sampler `n` at it. Units 6 and 7 are reserved.
      setTex(n, unit, tex, target) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target || gl.TEXTURE_2D, tex); gl.uniform1i(p.loc(n), unit); return p; },
    };
    if (ok) {
      const bi = gl.getUniformBlockIndex(prog, 'Env');
      if (bi !== gl.INVALID_INDEX && bi !== -1) gl.uniformBlockBinding(prog, bi, 0);
      gl.useProgram(prog);
      const ln = gl.getUniformLocation(prog, 'uNoiseTex'); if (ln) gl.uniform1i(ln, 6);
      const lw = gl.getUniformLocation(prog, 'uWorldMap'); if (lw) gl.uniform1i(lw, 7);
    }
    return p;
  };

  // Create a VAO mesh.
  // spec = { attribs: [{ loc, size, data (TypedArray), divisor?, usage?, normalized?, type? }], indices?: Uint16Array|Uint32Array, mode? }
  // Attribute location convention: 0 = position, 1 = normal, 2 = uv, 3 = color, 4..7 = per-instance / custom.
  // Returns { vao, count, draw(instances?), buffers[], update(attribIndex, data), setCount(n), dispose() }
  glx.mesh = function (spec) {
    const gl = TW.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = [];
    let vcount = 0;
    spec.attribs.forEach((a) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, a.data, a.usage || gl.STATIC_DRAW);
      gl.enableVertexAttribArray(a.loc);
      const type = a.type || (a.data instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.FLOAT);
      gl.vertexAttribPointer(a.loc, a.size, type, a.normalized !== undefined ? a.normalized : type !== gl.FLOAT, 0, 0);
      if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
      else if (!vcount) vcount = a.data.length / a.size;
      buffers.push(buf);
    });
    let ibuf = null, itype = 0, count = vcount;
    if (spec.indices) {
      ibuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, spec.indices, gl.STATIC_DRAW);
      itype = spec.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      count = spec.indices.length;
    }
    gl.bindVertexArray(null);
    const mode = spec.mode !== undefined ? spec.mode : gl.TRIANGLES;
    const mesh = {
      vao, count, buffers, mode,
      draw(instances) {
        gl.bindVertexArray(vao);
        if (instances !== undefined) {
          if (ibuf) gl.drawElementsInstanced(mesh.mode, mesh.count, itype, 0, instances);
          else gl.drawArraysInstanced(mesh.mode, 0, mesh.count, instances);
        } else if (ibuf) gl.drawElements(mesh.mode, mesh.count, itype, 0);
        else gl.drawArrays(mesh.mode, 0, mesh.count);
      },
      // re-upload attribute i (same or smaller size -> bufferSubData; larger -> bufferData)
      update(i, data) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
        const a = spec.attribs[i];
        if (data.byteLength <= a.data.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        else { gl.bufferData(gl.ARRAY_BUFFER, data, a.usage || gl.DYNAMIC_DRAW); a.data = data; }
      },
      setCount(n) { mesh.count = n; },
      dispose() { buffers.forEach((b) => gl.deleteBuffer(b)); if (ibuf) gl.deleteBuffer(ibuf); gl.deleteVertexArray(vao); },
    };
    return mesh;
  };

  // Draw a fullscreen triangle with the currently bound program. Vertex shader should use
  //   layout(location=0) in vec2 aPos;  gl_Position = vec4(aPos, 0., 1.);  vUV = aPos*0.5+0.5;
  // or simply use TW.glsl.fsvs as the vertex source (provides `out vec2 vUV`).
  glx.drawFS = function () { const gl = TW.gl; gl.bindVertexArray(glx._fsVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  TW.glsl.fsvs = 'layout(location=0) in vec2 aPos;\nout vec2 vUV;\nvoid main(){ vUV = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }\n';

  // Create a 2D texture.
  // o = { w, h, data?, internal? ('RGBA8'), format? ('RGBA'), type? ('UNSIGNED_BYTE'), filter? ('LINEAR'|'NEAREST'), wrap? ('CLAMP_TO_EDGE'|'REPEAT'|'MIRRORED_REPEAT'), mips? }
  glx.texture = function (o) {
    const gl = TW.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl[o.internal || 'RGBA8'], o.w, o.h, 0, gl[o.format || 'RGBA'], gl[o.type || 'UNSIGNED_BYTE'], o.data || null);
    const f = gl[o.filter || 'LINEAR'];
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mips ? gl.LINEAR_MIPMAP_LINEAR : f);
    const w = gl[o.wrap || 'CLAMP_TO_EDGE'];
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    if (o.mips) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  };

  // Create a render target.
  // o = { hdr? (true -> RGBA16F when supported, else RGBA8), depth? (false | true (renderbuffer) | 'texture'), filter? }
  // Returns { fbo, tex, depthTex, w, h, hdr, bind(), resize(w,h) }. bind() also sets the viewport.
  glx.target = function (w, h, o) {
    const gl = TW.gl;
    o = o || {};
    const hdr = !!o.hdr && TW.caps.floatRT;
    const t = { fbo: gl.createFramebuffer(), tex: null, depthTex: null, depthRb: null, w: 0, h: 0, hdr };
    t.resize = function (nw, nh) {
      nw = Math.max(1, nw | 0); nh = Math.max(1, nh | 0);
      if (nw === t.w && nh === t.h) return;
      t.w = nw; t.h = nh;
      if (t.tex) gl.deleteTexture(t.tex);
      t.tex = glx.texture({ w: nw, h: nh, internal: hdr ? 'RGBA16F' : 'RGBA8', format: 'RGBA', type: hdr ? 'HALF_FLOAT' : 'UNSIGNED_BYTE', filter: o.filter || 'LINEAR' });
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      if (o.depth === 'texture') {
        if (t.depthTex) gl.deleteTexture(t.depthTex);
        t.depthTex = glx.texture({ w: nw, h: nh, internal: 'DEPTH_COMPONENT24', format: 'DEPTH_COMPONENT', type: 'UNSIGNED_INT', filter: 'NEAREST' });
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depthTex, 0);
      } else if (o.depth) {
        if (t.depthRb) gl.deleteRenderbuffer(t.depthRb);
        t.depthRb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, t.depthRb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, nw, nh);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.depthRb);
      }
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) console.error('[TW] framebuffer incomplete: 0x' + st.toString(16));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    t.bind = function () { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.viewport(0, 0, t.w, t.h); };
    t.resize(w, h);
    return t;
  };

  // ---- shared tiling noise texture (256², RGBA8, REPEAT, mipmapped) -------------
  // R: tiling fbm A   G: tiling fbm B (decorrelated)   B: tiling Worley F1 (0 at cell centres)   A: white noise
  function makeNoiseTexture(gl) {
    const N = 256, data = new Uint8Array(N * N * 4);
    const tnoise = (x, y, per, seed) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const w = (a) => ((a % per) + per) % per;
      const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed), c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const tfbm = (x, y, seed) => {
      let s = 0, a = 0.5, per = 4, n = 0;
      for (let o = 0; o < 6; o++) { s += a * tnoise((x / N) * per, (y / N) * per, per, seed + o * 17); n += a; a *= 0.5; per *= 2; }
      return s / n;
    };
    const C = 12; // worley cells per side
    const pts = [];
    for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) pts.push([(i + hash2(i, j, 901)) / C, (j + hash2(i, j, 902)) / C]);
    const worley = (x, y) => {
      const u = x / N, v = y / N, ci = Math.floor(u * C), cj = Math.floor(v * C);
      let best = 9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + C) % C, jj = (cj + dj + C) % C, p = pts[jj * C + ii];
        let dx = Math.abs(p[0] - u), dy = Math.abs(p[1] - v);
        if (dx > 0.5) dx = 1 - dx; if (dy > 0.5) dy = 1 - dy;
        const d = Math.hypot(dx, dy) * C; if (d < best) best = d;
      }
      return Math.min(1, best);
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = (tfbm(x, y, 11) * 255) | 0;
      data[i + 1] = (tfbm(x + 37.5, y + 91.5, 4242) * 255) | 0;
      data[i + 2] = (worley(x, y) * 255) | 0;
      data[i + 3] = (hash2(x, y, 77) * 255) | 0;
    }
    const tex = glx.texture({ w: N, h: N, data, wrap: 'REPEAT', mips: true });
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, tex); gl.activeTexture(gl.TEXTURE0);
    return tex;
  }

  // ---- GLSL: noise chunk -------------------------------------------------------
  TW.glsl.noise = `
uniform sampler2D uNoiseTex; // unit 6 (auto-bound). R fbm, G fbm2, B worley F1, A white. 256x256, tiling.
float twHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float twHash3(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec2  twHash22(vec2 p){ vec3 a = fract(p.xyx*vec3(123.34,234.34,345.65)); a += dot(a, a+34.45); return fract(vec2(a.x*a.y, a.y*a.z)); }
float twNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(twHash(i),twHash(i+vec2(1,0)),u.x), mix(twHash(i+vec2(0,1)),twHash(i+vec2(1,1)),u.x), u.y); }
float twNoise3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
  return mix(mix(mix(twHash3(i),twHash3(i+vec3(1,0,0)),u.x), mix(twHash3(i+vec3(0,1,0)),twHash3(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(twHash3(i+vec3(0,0,1)),twHash3(i+vec3(1,0,1)),u.x), mix(twHash3(i+vec3(0,1,1)),twHash3(i+vec3(1,1,1)),u.x),u.y), u.z); }
float twFbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*twNoise(p); p=p*2.03+vec2(17.3,-9.1); a*=0.5; } return s/0.96875; }
float twFbm3(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<3;i++){ s+=a*twNoise(p); p=p*2.03+vec2(17.3,-9.1); a*=0.5; } return s/0.875; }
// cheap texture noise (one fetch): uv in "noise tiles" (1.0 = one 256px tile)
vec4  twTexNoise(vec2 uv){ return texture(uNoiseTex, uv); }
`;
})();

