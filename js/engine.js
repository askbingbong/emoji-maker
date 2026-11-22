/* Animation engine: builds a scene {W,H,S,N,frameCount,delay,render(i,ctx)}.
 * Everything is drawn on one wide "stage" (N emojis side by side) which is then sliced. */
(function (g) {
  'use strict';
  const TAU = Math.PI * 2;
  const frac = (x) => x - Math.floor(x);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  function rng(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ease(kind, u) {
    switch (kind) {
      case 'in': return u * u;
      case 'out': return 1 - (1 - u) * (1 - u);
      case 'inout': return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      default: return u;
    }
  }

  /* ---- in-place motions ----
   * returns offsets in units of S (dx,dy), scale sx/sy, rotation (rad), alpha, pivot py (fraction of height from center) */
  function motion(type, p, c, a, dir) {
    const o = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, py: 0 };
    const ph = TAU * c * p, v = frac(c * p);
    switch (type) {
      case 'jump': {
        const h = 4 * v * (1 - v);
        const s = Math.max(0, 1 - Math.min(v, 1 - v) / 0.12);
        o.dy = -0.30 * a * h;
        o.sx = 1 + 0.22 * a * s - 0.05 * a * h;
        o.sy = 1 - 0.22 * a * s + 0.10 * a * h;
        o.py = 0.5; break;
      }
      case 'spin': o.rot = dir * ph; break;
      case 'flip': o.sx = Math.cos(ph); if (Math.abs(o.sx) < 0.02) o.sx = 0.02; break;
      case 'shake': o.dx = 0.07 * a * Math.sin(ph); o.rot = 0.05 * a * Math.sin(ph + 1); break;
      case 'pulse': o.sx = o.sy = 1 + 0.25 * a * Math.sin(ph); break;
      case 'heartbeat': {
        const b = Math.exp(-Math.pow((v - 0.12) / 0.06, 2)) + 0.75 * Math.exp(-Math.pow((v - 0.34) / 0.07, 2));
        o.sx = o.sy = 1 + 0.3 * a * b; break;
      }
      case 'wobble': o.rot = 0.35 * a * Math.sin(ph); o.py = 0.5; break;
      case 'swing': o.rot = 0.7 * a * Math.sin(ph); o.py = -0.5; break;
      case 'float': o.dy = 0.08 * a * Math.sin(ph); o.rot = 0.08 * a * Math.sin(ph + 1.3); break;
      case 'zoom': o.sx = o.sy = 1 + 0.4 * a * (0.5 - 0.5 * Math.cos(ph)); break;
      case 'jelly': {
        const s = Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.8);
        o.sx = 1 + 0.16 * a * s; o.sy = 1 - 0.16 * a * s; o.py = 0.5; break;
      }
      case 'tada': {
        const env = v < 0.6 ? Math.sin(Math.PI * v / 0.6) : 0;
        o.sx = o.sy = 1 + 0.18 * a * env;
        o.rot = 0.22 * a * env * Math.sin(TAU * 5 * v / 0.6); break;
      }
      case 'orbit': o.dx = 0.12 * a * Math.cos(dir * ph); o.dy = 0.12 * a * Math.sin(dir * ph); break;
      case 'blink': o.alpha = 0.12 + 0.88 * (0.5 + 0.5 * Math.cos(ph)); break;
      case 'waddle': o.rot = 0.25 * a * Math.sin(ph); o.dy = -0.04 * a * Math.abs(Math.sin(ph)); o.py = 0.5; break;
      case 'drop': {
        // fall from above, squash, settle
        const t = Math.min(1, v / 0.55);
        if (v < 0.55) { o.dy = -(1 - t * t) * 1.1 * a; }
        else {
          const s = Math.exp(-(v - 0.55) * 9) * Math.cos((v - 0.55) * 40);
          o.sx = 1 + 0.25 * a * s; o.sy = 1 - 0.25 * a * s; o.py = 0.5;
        }
        break;
      }
    }
    return o;
  }

  function build(cfg, sprites) {
    const S = cfg.size, N = cfg.count, W = S * N, H = S;
    const delay = cfg.delay;
    const K = sprites.length;
    const hueVar = new Map();

    function variant(si, deg) {
      const bucket = Math.round(((deg % 360) + 360) % 360 / 15) * 15 % 360;
      if (!bucket) return sprites[si].canvas;
      const key = si + ':' + bucket;
      let v = hueVar.get(key);
      if (!v) { v = ImageProc.hueCanvas(sprites[si].canvas, bucket); hueVar.set(key, v); }
      return v;
    }

    /* draw helper: center cx,cy; dw,dh final size; pivot py as fraction of dh */
    function drawItem(ctx, canvas, cx, cy, dw, dh, rot, sx, sy, py, alpha) {
      if (alpha <= 0.003) return;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      if (py) ctx.translate(0, py * dh);
      ctx.scale(sx, sy);
      if (py) ctx.translate(0, -py * dh);
      ctx.drawImage(canvas, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    let frameCount, drawScene;

    if (cfg.mode === 'motion') {
      frameCount = Math.max(2, Math.round(cfg.duration * 100 / delay));
      const order = [];
      for (let n = 0; n < N; n++) order.push(n % K);
      const a = cfg.amp / 100, cyc = Math.max(1, Math.round(cfg.cycles)), dir = cfg.dir;
      const big = cfg.layout === 'big' && N >= 1;
      drawScene = (ctx, i) => {
        const p = i / frameCount;
        if (big) {
          const sp = sprites[0];
          const m = motion(cfg.motion, p, cyc, a, dir);
          let kx, ky;
          const sc = cfg.scale / 100;
          if (cfg.fit === 'stretch') { kx = W / sp.cw * sc; ky = H / sp.ch * sc; }
          else if (cfg.fit === 'cover') { kx = ky = Math.max(W / sp.cw, H / sp.ch) * sc; }
          else { kx = ky = Math.min(W / sp.cw, H / sp.ch) * sc; }
          drawItem(ctx, sp.canvas, W / 2 + m.dx * S, H / 2 + m.dy * S,
            sp.canvas.width * kx, sp.canvas.height * ky, m.rot, m.sx, m.sy, m.py, m.alpha);
        } else {
          for (let n = 0; n < N; n++) {
            const si = order[n];
            const sp = sprites[si];
            const pn = frac(p + n * cfg.phase / 100);
            const m = motion(cfg.motion, pn, cyc, a, dir);
            const k = S * cfg.scale / 100 / Math.max(sp.cw, sp.ch);
            drawItem(ctx, sp.canvas, (n + 0.5) * S + m.dx * S, S / 2 + m.dy * S,
              sp.canvas.width * k, sp.canvas.height * k, m.rot, m.sx, m.sy, m.py, m.alpha);
          }
        }
      };
    } else {
      /* ---- travel mode ---- */
      const M = Math.max(1, Math.round(cfg.tCount));
      const R = rng(cfg.tSeed * 7919 + 13);
      const perm = Array.from({ length: M }, (_, i) => i);
      for (let i = M - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      const wrap = cfg.loopMode === 'wrap';
      const specs = [];
      let D = 0;
      for (let j = 0; j < M; j++) {
        const r = rng(cfg.tSeed * 104729 + j * 31 + 7);
        const sp = {
          j,
          img: cfg.tOrder === 'random' ? Math.floor(r() * K) : j % K,
          r1: r(), r2: r(), r3: r(), r4: r(), r5: r(), r6: r(),
        };
        sp.spawn = wrap ? j * cfg.tInterval : cfg.tStart + j * cfg.tInterval;
        sp.life = Math.max(0.2, cfg.tTravel * (1 + (cfg.tSpeedVar || 0) / 100 * (2 * sp.r1 - 1)));
        sp.xFrac = (perm[j] + sp.r4) / M;
        sp.size = S * cfg.tSize / 100 * (1 + cfg.tSizeVar / 100 * (2 * sp.r2 - 1));
        sp.rot0 = (cfg.tRotRand * Math.PI / 180) * (2 * sp.r3 - 1);
        sp.hue = sp.r5 * 360;
        specs.push(sp);
        D = Math.max(D, sp.spawn + sp.life);
      }
      let maxLife = 0; specs.forEach((s) => { maxLife = Math.max(maxLife, s.life); });
      if (wrap) D = Math.max(0.1, M * cfg.tInterval); else D += cfg.tEnd;
      frameCount = clamp(Math.round(D * 100 / delay), 2, 400);
      const ltr = cfg.tDir !== 'rtl';

      function place(sp, u, sz, ch) {
        // returns {cx, cy, rot, sx, sy, py, alpha}
        const o = { cx: 0, cy: 0, rot: sp.rot0 + cfg.tSpin * TAU * u, sx: 1, sy: 1, py: 0, alpha: 1 };
        const m = sz * 0.8;
        const e = ease(cfg.tEase, u);
        switch (cfg.travel) {
          case 'bounce': {
            const x = ltr ? lerp(-m, W + m, e) : lerp(W + m, -m, e);
            const hops = Math.max(1, Math.round(cfg.tHop * (W + 2 * m) / S));
            const v = frac(u * hops);
            const h = 4 * v * (1 - v);
            const s = Math.max(0, 1 - Math.min(v, 1 - v) / 0.14);
            const sq = cfg.tSquash / 100;
            o.sx = 1 + sq * s; o.sy = 1 - sq * s;
            const ground = H * 0.96;
            o.cx = x; o.cy = ground - ch / 2 - h * cfg.tHopH / 100 * S;
            o.py = 0.5; break;
          }
          case 'slide': {
            const x = ltr ? lerp(-m, W + m, e) : lerp(W + m, -m, e);
            o.cx = x; o.cy = H / 2 + (2 * sp.r6 - 1) * cfg.tJitter / 100 * S; break;
          }
          case 'wave': {
            const x = ltr ? lerp(-m, W + m, e) : lerp(W + m, -m, e);
            const amp = cfg.tAmp / 100 * S, k = TAU * cfg.tWaves / S;
            o.cx = x; o.cy = H / 2 + amp * Math.sin(k * x);
            const slope = amp * k * Math.cos(k * x);
            o.rot += Math.atan(slope) * (ltr ? 1 : -1) * 0.8; break;
          }
          case 'fall': case 'rise': {
            const gr = cfg.tGravity / 100;
            let t = (1 - gr) * u + gr * u * u;
            if (cfg.travel === 'rise') t = (1 - gr) * u + gr * (1 - (1 - u) * (1 - u));
            const sway = cfg.tSway / 100 * S * Math.sin(TAU * cfg.tWaves * u + sp.r6 * TAU);
            o.cx = sz / 2 + sp.xFrac * Math.max(0, W - sz) + sway;
            o.cy = cfg.travel === 'fall' ? lerp(-m, H + m, t) : lerp(H + m, -m, t);
            break;
          }
          case 'burst': {
            const apex = H * cfg.tPower / 100 * (0.45 + 0.55 * sp.r2);
            const Tt = u;
            const oy = H + m * 0.8;
            const spread = cfg.tSpread / 100 * W / 2;
            o.cx = W / 2 + (2 * sp.r4 - 1) * spread * Tt;
            o.cy = oy - 4 * apex * Tt * (1 - Tt) * 1.0;
            break;
          }
        }
        if (cfg.tFade > 0) {
          const f = cfg.tFade / 100;
          o.alpha = Math.min(1, u / f, (1 - u) / f);
        }
        return o;
      }

      drawScene = (ctx, i) => {
        const t = i * delay / 100;
        const inst = [];
        for (const sp of specs) {
          if (wrap) {
            for (let k = 0; k <= Math.ceil(sp.life / D) + 1; k++) {
              const tau = t - sp.spawn + k * D;
              if (tau >= 0 && tau < sp.life) inst.push({ sp, tau });
            }
          } else {
            const tau = t - sp.spawn;
            if (tau >= 0 && tau < sp.life) inst.push({ sp, tau });
          }
        }
        inst.sort((a, b) => b.tau - a.tau);
        for (const { sp, tau } of inst) {
          const spr = sprites[sp.img];
          const kk = sp.size / Math.max(spr.cw, spr.ch);
          const dw = spr.canvas.width * kk, dh = spr.canvas.height * kk;
          const o = place(sp, tau / sp.life, sp.size, spr.ch * kk);
          const cv = cfg.tRandHue ? variant(sp.img, sp.hue) : spr.canvas;
          drawItem(ctx, cv, o.cx, o.cy, dw, dh, o.rot, o.sx, o.sy, o.py, o.alpha);
        }
      };
    }

    const bgOn = cfg.bgOn, hueCycle = cfg.hueCycle, hueSpread = cfg.hueSpread;
    function render(i, ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      if (bgOn) { ctx.fillStyle = cfg.bgFill; ctx.fillRect(0, 0, W, H); }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      drawScene(ctx, i);
      if (hueCycle > 0 || hueSpread > 0) {
        const id = ctx.getImageData(0, 0, W, H);
        for (let n = 0; n < N; n++) {
          const deg = 360 * hueCycle * (i / frameCount) + hueSpread * n;
          if (deg % 360 !== 0) ImageProc.hueRegion(id.data, W, n * S, (n + 1) * S, H, deg);
        }
        ctx.putImageData(id, 0, 0);
      }
    }

    return { W, H, S, N, frameCount, delay, render };
  }

  g.Engine = { build };
})(window);
