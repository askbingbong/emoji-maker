/* Minimal GIF89a encoder: 15-bit histogram median-cut palette, transparency,
 * per-frame bounding-box cropping, LZW. No dependencies. */
(function (g) {
  'use strict';
  const BINS = 32768;

  function hexToRgb(hex) {
    if (!hex) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function Histogram() {
    this.count = new Uint32Array(BINS);
    this.sr = new Uint32Array(BINS);
    this.sg = new Uint32Array(BINS);
    this.sb = new Uint32Array(BINS);
    this.transparent = false;
    this.opaque = 0;
  }

  Histogram.prototype.add = function (data, thr, matte) {
    const n = data.length, cnt = this.count, sr = this.sr, sg = this.sg, sb = this.sb;
    for (let i = 0; i < n; i += 4) {
      const a = data[i + 3];
      if (a < thr) { this.transparent = true; continue; }
      let r = data[i], gg = data[i + 1], b = data[i + 2];
      if (matte && a < 255) {
        const t = a / 255;
        r = (matte[0] + (r - matte[0]) * t) | 0;
        gg = (matte[1] + (gg - matte[1]) * t) | 0;
        b = (matte[2] + (b - matte[2]) * t) | 0;
      }
      const bin = ((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3);
      cnt[bin]++; sr[bin] += r; sg[bin] += gg; sb[bin] += b;
      this.opaque++;
    }
  };

  function chan(bin, c) { return c === 0 ? bin >> 10 : c === 1 ? (bin >> 5) & 31 : bin & 31; }

  function quantize(h, maxColors) {
    const reserve = h.transparent ? 1 : 0;
    const target = Math.max(1, maxColors - reserve);
    const list = [];
    for (let b = 0; b < BINS; b++) if (h.count[b]) list.push(b);
    const idx = Uint16Array.from(list);
    const lookup = new Uint8Array(BINS);
    const colors = [];

    if (idx.length) {
      const stat = (box) => {
        let r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 0 + 31, b1 = 0, cnt = 0;
        for (let i = box.s; i < box.e; i++) {
          const bin = idx[i];
          const r = bin >> 10, gg = (bin >> 5) & 31, b = bin & 31;
          if (r < r0) r0 = r; if (r > r1) r1 = r;
          if (gg < g0) g0 = gg; if (gg > g1) g1 = gg;
          if (b < b0) b0 = b; if (b > b1) b1 = b;
          cnt += h.count[bin];
        }
        const rr = r1 - r0, gr = g1 - g0, br = b1 - b0;
        box.cnt = cnt;
        box.ch = rr >= gr && rr >= br ? 0 : gr >= br ? 1 : 2;
        box.range = Math.max(rr, gr, br);
        box.score = (box.range + 1) * Math.sqrt(cnt);
      };
      const boxes = [{ s: 0, e: idx.length }];
      stat(boxes[0]);
      while (boxes.length < target) {
        let best = -1, bs = -1;
        for (let i = 0; i < boxes.length; i++) {
          const bx = boxes[i];
          if (bx.e - bx.s >= 2 && bx.score > bs) { bs = bx.score; best = i; }
        }
        if (best < 0) break;
        const bx = boxes[best];
        const c = bx.ch;
        idx.subarray(bx.s, bx.e).sort((a, b) => chan(a, c) - chan(b, c));
        let acc = 0, mid = bx.s + 1;
        const half = bx.cnt / 2;
        for (let i = bx.s; i < bx.e - 1; i++) {
          acc += h.count[idx[i]];
          mid = i + 1;
          if (acc >= half) break;
        }
        const nb = { s: mid, e: bx.e };
        bx.e = mid;
        stat(bx); stat(nb);
        boxes.push(nb);
      }
      for (let k = 0; k < boxes.length; k++) {
        const bx = boxes[k];
        let r = 0, gg = 0, b = 0, cnt = 0;
        for (let i = bx.s; i < bx.e; i++) {
          const bin = idx[i];
          r += h.sr[bin]; gg += h.sg[bin]; b += h.sb[bin]; cnt += h.count[bin];
          lookup[bin] = k + reserve;
        }
        colors.push([Math.round(r / cnt), Math.round(gg / cnt), Math.round(b / cnt)]);
      }
    } else {
      colors.push([0, 0, 0]);
    }
    let total = colors.length + reserve;
    if (total < 2) total = 2;
    let bits = 1;
    while ((1 << bits) < total) bits++;
    const palette = new Uint8Array((1 << bits) * 3);
    for (let k = 0; k < colors.length; k++) {
      palette[(k + reserve) * 3] = colors[k][0];
      palette[(k + reserve) * 3 + 1] = colors[k][1];
      palette[(k + reserve) * 3 + 2] = colors[k][2];
    }
    return { palette, bits, minCode: Math.max(2, bits), lookup, tIndex: reserve ? 0 : -1 };
  }

  function mapFrame(data, q, thr, matte, out) {
    const n = data.length, lk = q.lookup, t = q.tIndex < 0 ? 0 : q.tIndex;
    for (let i = 0, p = 0; i < n; i += 4, p++) {
      const a = data[i + 3];
      if (a < thr) { out[p] = t; continue; }
      let r = data[i], gg = data[i + 1], b = data[i + 2];
      if (matte && a < 255) {
        const k = a / 255;
        r = (matte[0] + (r - matte[0]) * k) | 0;
        gg = (matte[1] + (gg - matte[1]) * k) | 0;
        b = (matte[2] + (b - matte[2]) * k) | 0;
      }
      out[p] = lk[((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3)];
    }
  }

  function Sink() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  Sink.prototype.need = function (k) {
    if (this.n + k <= this.buf.length) return;
    let c = this.buf.length * 2;
    while (c < this.n + k) c *= 2;
    const nb = new Uint8Array(c); nb.set(this.buf.subarray(0, this.n)); this.buf = nb;
  };
  Sink.prototype.byte = function (b) { this.need(1); this.buf[this.n++] = b; };
  Sink.prototype.u16 = function (v) { this.byte(v & 255); this.byte((v >> 8) & 255); };
  Sink.prototype.bytes = function (a) { this.need(a.length); this.buf.set(a, this.n); this.n += a.length; };
  Sink.prototype.str = function (s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); };

  const TABLE = new Uint16Array(1 << 20);

  function lzw(sink, minCode, idx) {
    sink.byte(minCode);
    const clear = 1 << minCode, eoi = clear + 1;
    let next = eoi + 1, size = minCode + 1;
    let cur = 0, shift = 0;
    const block = new Uint8Array(255);
    let bp = 0;
    const flushBlock = () => {
      if (bp) { sink.byte(bp); sink.bytes(block.subarray(0, bp)); bp = 0; }
    };
    const emit = (code) => {
      cur |= code << shift; shift += size;
      while (shift >= 8) {
        block[bp++] = cur & 255; cur >>>= 8; shift -= 8;
        if (bp === 255) flushBlock();
      }
    };
    TABLE.fill(0);
    emit(clear);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i];
      const key = (prefix << 8) | k;
      const c = TABLE[key];
      if (c !== 0) { prefix = c; continue; }
      emit(prefix);
      if (next === 4096) {
        emit(clear); next = eoi + 1; size = minCode + 1; TABLE.fill(0);
      } else {
        if (next >= (1 << size)) size++;
        TABLE[key] = next++;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (shift > 0) block[bp++] = cur & 255;
    flushBlock();
    sink.byte(0);
  }

  function Encoder(w, h, q, delayCs) {
    this.w = w; this.h = h; this.q = q;
    this.delay = Math.max(2, delayCs | 0);
    const s = this.sink = new Sink();
    s.str('GIF89a'); s.u16(w); s.u16(h);
    s.byte(0x80 | (7 << 4) | (q.bits - 1)); s.byte(0); s.byte(0);
    s.bytes(q.palette);
    s.byte(0x21); s.byte(0xFF); s.byte(11); s.str('NETSCAPE2.0');
    s.byte(3); s.byte(1); s.u16(0); s.byte(0);
    this.sub = new Uint8Array(w * h);
  }

  Encoder.prototype.addFrame = function (indices) {
    const { w, h, q, sink: s } = this;
    const trans = q.tIndex >= 0;
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (trans) {
      const t = q.tIndex;
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          if (indices[row + x] !== t) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
    }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    let data;
    if (fw === w && fh === h) data = indices;
    else {
      data = this.sub.subarray(0, fw * fh);
      for (let y = 0; y < fh; y++) {
        data.set(indices.subarray((y + y0) * w + x0, (y + y0) * w + x0 + fw), y * fw);
      }
    }
    s.byte(0x21); s.byte(0xF9); s.byte(4);
    s.byte(((trans ? 2 : 1) << 2) | (trans ? 1 : 0));
    s.u16(this.delay); s.byte(trans ? q.tIndex : 0); s.byte(0);
    s.byte(0x2C); s.u16(x0); s.u16(y0); s.u16(fw); s.u16(fh); s.byte(0);
    lzw(s, q.minCode, data);
  };

  Encoder.prototype.finish = function () {
    this.sink.byte(0x3B);
    return this.sink.buf.slice(0, this.sink.n);
  };

  g.GIF = { Histogram, quantize, mapFrame, Encoder, hexToRgb };
})(typeof window !== 'undefined' ? window : globalThis);
