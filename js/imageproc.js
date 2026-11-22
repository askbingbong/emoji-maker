/* Sprite preparation: resize, background removal, auto-crop, outline/glow/shadow, hue shift. */
(function (g) {
  'use strict';

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctxOf(c, read) { return c.getContext('2d', read ? { willReadFrequently: true } : undefined); }

  function srcSize(s) { return [s.naturalWidth || s.videoWidth || s.width, s.naturalHeight || s.videoHeight || s.height]; }

  /* Resize with step-down for decent quality in all browsers. */
  function fromSource(src, maxDim) {
    let [w, h] = srcSize(src);
    const k = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    let cur = src, cw = w, ch = h;
    while (cw / 2 > tw && ch / 2 > th) {
      const c = makeCanvas(Math.ceil(cw / 2), Math.ceil(ch / 2));
      const x = ctxOf(c); x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, c.width, c.height);
      cur = c; cw = c.width; ch = c.height;
    }
    const out = makeCanvas(tw, th);
    const x = ctxOf(out, true); x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, tw, th);
    return out;
  }

  function hex(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function removeBackground(canvas, mode, tolPct, keyHex) {
    if (mode === 'off') return;
    const w = canvas.width, h = canvas.height, x = ctxOf(canvas, true);
    const id = x.getImageData(0, 0, w, h), d = id.data;
    const thr = (tolPct / 100) * 441.7, thr2 = thr * thr;
    const soft = thr * 1.5, soft2 = soft * soft;
    let bg;
    if (mode === 'key') bg = hex(keyHex);
    else {
      const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [px, py] of pts) {
        const i = (py * w + px) * 4;
        if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      }
      if (!n) return;
      bg = [r / n, gg / n, b / n];
    }
    const dist2 = (i) => {
      const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
      return dr * dr + dg * dg + db * db;
    };
    const removed = new Uint8Array(w * h);
    if (mode === 'key') {
      for (let p = 0; p < w * h; p++) if (dist2(p * 4) <= thr2) removed[p] = 1;
    } else {
      const stack = [];
      const push = (p) => { if (!removed[p] && (d[p * 4 + 3] < 10 || dist2(p * 4) <= thr2)) { removed[p] = 1; stack.push(p); } };
      for (let xx = 0; xx < w; xx++) { push(xx); push((h - 1) * w + xx); }
      for (let yy = 0; yy < h; yy++) { push(yy * w); push(yy * w + w - 1); }
      while (stack.length) {
        const p = stack.pop(), px = p % w, py = (p / w) | 0;
        if (px > 0) push(p - 1);
        if (px < w - 1) push(p + 1);
        if (py > 0) push(p - w);
        if (py < h - 1) push(p + w);
      }
    }
    // soften the boundary: kept pixels touching removed ones fade based on colour distance
    const alpha = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) alpha[p] = removed[p] ? 0 : d[p * 4 + 3];
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const p = yy * w + xx;
        if (removed[p]) continue;
        const touch = (xx > 0 && removed[p - 1]) || (xx < w - 1 && removed[p + 1]) ||
          (yy > 0 && removed[p - w]) || (yy < h - 1 && removed[p + w]);
        if (!touch) continue;
        const dd = dist2(p * 4);
        if (dd < soft2) {
          const t = Math.max(0, (Math.sqrt(dd) - thr) / (soft - thr));
          alpha[p] = Math.round(alpha[p] * Math.min(1, t * 0.5 + 0.5 * t * t));
        }
      }
    }
    for (let p = 0; p < w * h; p++) d[p * 4 + 3] = alpha[p];
    x.putImageData(id, 0, 0);
  }

  function autoCrop(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = ctxOf(canvas, true).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return canvas;
    const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
    ctxOf(out).drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function silhouette(canvas, color) {
    const s = makeCanvas(canvas.width, canvas.height), x = ctxOf(s);
    x.drawImage(canvas, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, s.width, s.height);
    return s;
  }

  /* Returns { canvas, cw, ch }: canvas includes padding for effects; cw/ch = content size. */
  function applyEffects(src, o) {
    const cw = src.width, ch = src.height, m = Math.max(cw, ch);
    const ow = o.outlineW / 100 * m, gl = o.glow / 100 * m, sh = o.shadow / 100 * m;
    if (ow <= 0 && gl <= 0 && sh <= 0) return { canvas: src, cw, ch };
    const pad = Math.ceil(ow + gl * 1.6 + sh * 1.6 + 2);
    const out = makeCanvas(cw + pad * 2, ch + pad * 2);
    const base = makeCanvas(out.width, out.height), bx = ctxOf(base);
    if (ow > 0) {
      const sil = silhouette(src, o.outlineColor);
      const rings = ow > 5 ? [ow, ow * 0.5] : [ow];
      for (const r of rings) for (let a = 0; a < 24; a++) {
        const t = a / 24 * Math.PI * 2;
        bx.drawImage(sil, pad + Math.cos(t) * r, pad + Math.sin(t) * r);
      }
      bx.drawImage(sil, pad, pad);
    }
    bx.drawImage(src, pad, pad);
    const x = ctxOf(out);
    if (sh > 0) {
      x.save();
      x.shadowColor = o.shadowColor; x.shadowBlur = sh * 1.2;
      x.shadowOffsetX = sh * 0.5; x.shadowOffsetY = sh * 0.8;
      x.drawImage(base, 0, 0); x.restore();
    }
    if (gl > 0) {
      for (let i = 0; i < 3; i++) {
        x.save(); x.shadowColor = o.glowColor; x.shadowBlur = gl * 1.5;
        x.drawImage(base, 0, 0); x.restore();
      }
    }
    x.drawImage(base, 0, 0);
    return { canvas: out, cw, ch };
  }

  function prepare(src, o) {
    let c = fromSource(src, 512);
    removeBackground(c, o.bgRemove, o.bgTol, o.bgKey);
    if (o.autoCrop || o.bgRemove !== 'off') c = autoCrop(c);
    return applyEffects(c, o);
  }

  function hueMatrix(deg) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ];
  }

  /* Rotate hue of a region of ImageData in place. */
  function hueRegion(data, stride, x0, x1, h, deg) {
    const m = hueMatrix(deg);
    for (let y = 0; y < h; y++) {
      let i = (y * stride + x0) * 4;
      const end = (y * stride + x1) * 4;
      for (; i < end; i += 4) {
        if (data[i + 3] === 0) continue;
        const r = data[i], gg = data[i + 1], b = data[i + 2];
        data[i] = m[0] * r + m[1] * gg + m[2] * b;
        data[i + 1] = m[3] * r + m[4] * gg + m[5] * b;
        data[i + 2] = m[6] * r + m[7] * gg + m[8] * b;
      }
    }
  }

  function hueCanvas(canvas, deg) {
    const out = makeCanvas(canvas.width, canvas.height), x = ctxOf(out, true);
    x.drawImage(canvas, 0, 0);
    const id = x.getImageData(0, 0, out.width, out.height);
    hueRegion(id.data, out.width, 0, out.width, out.height, deg);
    x.putImageData(id, 0, 0);
    return out;
  }

  function sampleSprite() {
    const c = makeCanvas(256, 256), x = ctxOf(c);
    const grd = x.createRadialGradient(100, 90, 20, 128, 128, 120);
    grd.addColorStop(0, '#ffe45e'); grd.addColorStop(1, '#ffb400');
    x.fillStyle = grd; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.fill();
    x.strokeStyle = '#c98a00'; x.lineWidth = 8; x.stroke();
    x.fillStyle = '#3a2a00';
    x.beginPath(); x.ellipse(90, 100, 14, 22, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(166, 100, 14, 22, 0, 0, 7); x.fill();
    x.lineWidth = 12; x.lineCap = 'round'; x.strokeStyle = '#3a2a00';
    x.beginPath(); x.arc(128, 140, 58, 0.2, Math.PI - 0.2); x.stroke();
    return c;
  }

  g.ImageProc = { makeCanvas, prepare, hueRegion, hueCanvas, sampleSprite };
})(window);
