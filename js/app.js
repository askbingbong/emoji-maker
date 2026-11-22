(function () {
  'use strict';
  const LIMIT = 256 * 1024;
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    name: 'emoji', count: 1, size: 128, delay: 4,
    mode: 'motion',
    motion: 'jump', duration: 1, cycles: 1, amp: 100, dir: 1, layout: 'cells', fit: 'contain', phase: 0, scale: 80,
    travel: 'bounce', loopMode: 'once', tCount: 5, tInterval: 0.35, tTravel: 2, tStart: 0.1, tEnd: 0.2,
    tDir: 'ltr', tSize: 60, tSizeVar: 20, tEase: 'linear', tSpin: 0, tRotRand: 0, tOrder: 'seq', tSeed: 1,
    tFade: 0, tSpeedVar: 0, tJitter: 0,
    tHop: 1, tHopH: 30, tSquash: 25, tAmp: 25, tWaves: 1, tSway: 10, tGravity: 50, tSpread: 70, tPower: 90, tRandHue: false,
    hueCycle: 0, hueSpread: 0, bgOn: false, bgFill: '#5865f2',
    outlineW: 0, outlineColor: '#ffffff', glow: 0, glowColor: '#ffe066', shadow: 0, shadowColor: '#000000',
    bgRemove: 'off', bgTol: 30, bgKey: '#ffffff', autoCrop: true,
    autoFit: true, maxColors: 256, alphaThr: 128, matteOn: false, matte: '#2b2d31',
  };
  const SPRITE_KEYS = new Set(['bgRemove', 'bgTol', 'bgKey', 'autoCrop', 'outlineW', 'outlineColor', 'glow', 'glowColor', 'shadow', 'shadowColor']);
  const STORE = 'emojimaker.v1';

  let state = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    for (const k in saved) if (k in DEFAULTS && typeof saved[k] === typeof DEFAULTS[k]) state[k] = saved[k];
  } catch (e) { /* ignore */ }

  /* ---------------- control schema ---------------- */
  const R = (k, label, min, max, step, unit, show) => ({ t: 'range', k, label, min, max, step, unit: unit || '', show });
  const SEL = (k, label, opts, show) => ({ t: 'select', k, label, opts, show });
  const CHK = (k, label, show) => ({ t: 'check', k, label, show });
  const COL = (k, label, show) => ({ t: 'color', k, label, show });
  const TXT = (k, label, show) => ({ t: 'text', k, label, show });
  const GRP = (label, show) => ({ t: 'group', label, show });
  const isMotion = (s) => s.mode === 'motion';
  const isTravel = (s) => s.mode === 'travel';
  const tv = (...l) => (s) => s.mode === 'travel' && l.includes(s.travel);

  const MOTIONS = [['jump', 'Jump up & down'], ['spin', 'Spin'], ['flip', 'Flip (3D turn)'], ['shake', 'Shake'], ['pulse', 'Pulse'],
    ['heartbeat', 'Heartbeat'], ['wobble', 'Wobble'], ['swing', 'Swing (pendulum)'], ['float', 'Float'], ['zoom', 'Zoom in/out'],
    ['jelly', 'Jelly squish'], ['tada', 'Ta-da!'], ['orbit', 'Orbit circle'], ['blink', 'Blink / fade'], ['waddle', 'Waddle'], ['drop', 'Drop in & squash']];

  const SCHEMA = {
    prep: [
      SEL('bgRemove', 'Background removal', [['off', 'Keep image as is'], ['edge', 'Remove background (flood from edges)'], ['key', 'Remove one colour everywhere']]),
      R('bgTol', 'Tolerance', 2, 80, 1, '%', (s) => s.bgRemove !== 'off'),
      COL('bgKey', 'Colour to remove', (s) => s.bgRemove === 'key'),
      CHK('autoCrop', 'Auto-crop empty space around the image'),
    ],
    set: [
      TXT('name', 'Emoji name (files become name_1, name_2…)'),
      R('count', 'Emojis working together', 1, 12, 1),
      SEL('size', 'Size per emoji', [[128, '128 px (recommended)'], [96, '96 px'], [64, '64 px'], [48, '48 px'], [32, '32 px']]),
      SEL('delay', 'Frame rate', [[2, '50 fps (smoothest, biggest)'], [3, '33 fps'], [4, '25 fps'], [5, '20 fps'], [6, '16 fps'], [8, '12.5 fps'], [10, '10 fps (smallest)']]),
    ],
    anim: [
      SEL('mode', 'Animation type', [['motion', 'Motion (image moves in place)'], ['travel', 'Travel (images cross the whole set)']]),
      /* motion */
      SEL('motion', 'Motion', MOTIONS, isMotion),
      R('duration', 'Loop length', 0.3, 6, 0.1, ' s', isMotion),
      R('cycles', 'Repeats per loop', 1, 12, 1, '×', isMotion),
      R('amp', 'Strength', 20, 250, 5, '%', isMotion),
      R('scale', 'Image size', 20, 200, 5, '%', isMotion),
      SEL('dir', 'Direction', [[1, 'Clockwise / forward'], [-1, 'Counter-clockwise / reverse']], (s) => isMotion(s) && ['spin', 'orbit'].includes(s.motion)),
      SEL('layout', 'Layout', [['cells', 'Each emoji has its own copy'], ['big', 'One big image across all emojis']], (s) => isMotion(s) && s.count > 1),
      SEL('fit', 'Big image fit', [['contain', 'Fit inside'], ['cover', 'Fill (crop)'], ['stretch', 'Stretch to fill']], (s) => isMotion(s) && s.count > 1 && s.layout === 'big'),
      R('phase', 'Wave delay between emojis', 0, 50, 1, '%', (s) => isMotion(s) && s.count > 1 && s.layout === 'cells'),
      /* travel */
      SEL('travel', 'Path', [['bounce', 'Bounce across'], ['slide', 'Slide across'], ['wave', 'Wavy path'], ['fall', 'Fall (rain)'], ['rise', 'Rise (bubbles)'], ['burst', 'Fountain burst']], isTravel),
      SEL('loopMode', 'Loop style', [['once', 'Play once, pause, repeat'], ['wrap', 'Endless flow (seamless)']], isTravel),
      GRP('Spawning', isTravel),
      R('tCount', 'Number of images', 1, 40, 1, '', isTravel),
      R('tInterval', 'Spawn interval (lower = faster)', 0.05, 2, 0.05, ' s', isTravel),
      R('tTravel', 'Travel time per image', 0.4, 8, 0.1, ' s', isTravel),
      R('tStart', 'Start delay', 0, 3, 0.05, ' s', (s) => isTravel(s) && s.loopMode === 'once'),
      R('tEnd', 'Pause at end', 0, 3, 0.05, ' s', (s) => isTravel(s) && s.loopMode === 'once'),
      SEL('tDir', 'Direction', [['ltr', 'Left → right'], ['rtl', 'Right → left']], tv('bounce', 'slide', 'wave')),
      SEL('tOrder', 'Image order', [['seq', 'In order'], ['random', 'Random (seeded)']], (s) => isTravel(s)),
      GRP('Look', isTravel),
      R('tSize', 'Image size', 15, 150, 1, '%', isTravel),
      R('tSizeVar', 'Size variation', 0, 80, 1, '%', isTravel),
      R('tSpin', 'Spin (turns while crossing)', -6, 6, 0.25, '×', isTravel),
      R('tRotRand', 'Random tilt', 0, 180, 5, '°', isTravel),
      R('tFade', 'Fade in/out', 0, 50, 1, '%', isTravel),
      SEL('tEase', 'Speed curve', [['linear', 'Constant'], ['in', 'Speed up'], ['out', 'Slow down'], ['inout', 'Ease in & out']], tv('bounce', 'slide', 'wave')),
      R('tSpeedVar', 'Speed variation', 0, 80, 1, '%', isTravel),
      GRP('Path details', isTravel),
      R('tHop', 'Hops per emoji width', 0.25, 4, 0.25, '', tv('bounce')),
      R('tHopH', 'Hop height', 5, 100, 1, '%', tv('bounce')),
      R('tSquash', 'Squash on landing', 0, 50, 1, '%', tv('bounce')),
      R('tJitter', 'Random height', 0, 40, 1, '%', tv('slide')),
      R('tAmp', 'Wave height', 0, 60, 1, '%', tv('wave')),
      R('tWaves', 'Waves per emoji width', 0.25, 4, 0.25, '', tv('wave')),
      R('tSway', 'Side-to-side sway', 0, 50, 1, '%', tv('fall', 'rise')),
      R('tWaves', 'Sway speed', 0.5, 5, 0.5, '×', tv('fall', 'rise')),
      R('tGravity', 'Gravity feel', 0, 100, 1, '%', tv('fall', 'rise')),
      R('tSpread', 'Horizontal spread', 10, 100, 1, '%', tv('burst')),
      R('tPower', 'Launch height', 20, 150, 1, '%', tv('burst')),
      R('tSeed', 'Randomness seed', 1, 99, 1, '', isTravel),
    ],
    fx: [
      GRP('Colour'),
      R('hueCycle', 'Rainbow cycles per loop', 0, 4, 1, '×'),
      R('hueSpread', 'Rainbow shift per emoji', 0, 180, 5, '°', (s) => s.count > 1),
      CHK('tRandHue', 'Random colour for each image', isTravel),
      CHK('bgOn', 'Solid background colour'),
      COL('bgFill', 'Background colour', (s) => s.bgOn),
      GRP('Image styling'),
      R('outlineW', 'Outline', 0, 12, 0.5, '%'),
      COL('outlineColor', 'Outline colour', (s) => s.outlineW > 0),
      R('glow', 'Glow', 0, 30, 1, '%'),
      COL('glowColor', 'Glow colour', (s) => s.glow > 0),
      R('shadow', 'Drop shadow', 0, 20, 1, '%'),
      COL('shadowColor', 'Shadow colour', (s) => s.shadow > 0),
    ],
    out: [
      CHK('autoFit', 'Auto-shrink each GIF to fit Discord’s 256 KB limit'),
      SEL('maxColors', 'Max colours', [[256, '256 (best)'], [128, '128'], [64, '64'], [32, '32'], [16, '16']]),
      R('alphaThr', 'Transparency cut-off', 10, 250, 5, '', null),
      CHK('matteOn', 'Blend soft edges into a colour (reduces halos)'),
      COL('matte', 'Edge blend colour', (s) => s.matteOn),
    ],
  };

  const controls = []; // {def,row,input,out}

  function fmt(def, v) {
    return (Number.isInteger(v) ? v : +v.toFixed(2)) + def.unit;
  }

  function buildControls() {
    for (const [sec, list] of Object.entries(SCHEMA)) {
      const host = $('ctl-' + sec);
      for (const def of list) {
        const row = document.createElement('div');
        row.className = 'row';
        let input = null, out = null;
        if (def.t === 'group') {
          row.className = 'row group-title'; row.textContent = def.label;
        } else if (def.t === 'check') {
          row.className = 'row inline';
          const l = document.createElement('label'); l.textContent = def.label; l.htmlFor = 'c-' + def.k;
          input = document.createElement('input'); input.type = 'checkbox'; input.id = 'c-' + def.k;
          row.append(l, input);
        } else if (def.t === 'color') {
          row.className = 'row inline';
          const l = document.createElement('label'); l.textContent = def.label; l.htmlFor = 'c-' + def.k;
          input = document.createElement('input'); input.type = 'color'; input.id = 'c-' + def.k;
          row.append(l, input);
        } else {
          const lab = document.createElement('div'); lab.className = 'lab';
          const l = document.createElement('label'); l.textContent = def.label;
          lab.append(l);
          if (def.t === 'range') {
            input = document.createElement('input'); input.type = 'range';
            input.min = def.min; input.max = def.max; input.step = def.step;
            out = document.createElement('output'); lab.append(out);
          } else if (def.t === 'select') {
            input = document.createElement('select');
            for (const [v, t] of def.opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; input.append(o); }
          } else {
            input = document.createElement('input'); input.type = 'text'; input.maxLength = 28; input.autocomplete = 'off';
          }
          input.id = 'c-' + def.k + (def.t === 'range' && controls.some((c) => c.def.k === def.k) ? '2' : '');
          l.htmlFor = input.id;
          row.append(lab, input);
        }
        host.append(row);
        const c = { def, row, input, out };
        controls.push(c);
        if (input) input.addEventListener(def.t === 'select' || def.t === 'check' ? 'change' : 'input', () => onInput(c));
      }
    }
  }

  function syncControls() {
    for (const c of controls) {
      const { def, input, out } = c;
      if (!input) continue;
      const v = state[def.k];
      if (def.t === 'check') input.checked = !!v; else input.value = v;
      if (out) out.textContent = fmt(def, +v);
    }
    updateVisibility();
  }

  function updateVisibility() {
    // groups hide when all following rows until the next group are hidden
    let lastGroup = null, groupHasVisible = false;
    const flush = () => { if (lastGroup) lastGroup.row.hidden = lastGroup.hide || !groupHasVisible; };
    for (const c of controls) {
      const vis = !c.def.show || c.def.show(state);
      if (c.def.t === 'group') {
        flush();
        lastGroup = c; c.hide = !vis; groupHasVisible = false;
        continue;
      }
      c.row.hidden = !vis;
      if (vis && lastGroup && c.row.parentNode === lastGroup.row.parentNode) groupHasVisible = true;
    }
    flush();
  }

  function onInput(c) {
    const { def, input } = c;
    let v;
    if (def.t === 'check') v = input.checked;
    else if (typeof DEFAULTS[def.k] === 'number') v = parseFloat(input.value);
    else v = input.value;
    state[def.k] = v;
    if (c.out) c.out.textContent = fmt(def, v);
    // keep duplicate-key sliders in sync
    for (const o of controls) if (o !== c && o.def.k === def.k && o.input) { o.input.value = v; if (o.out) o.out.textContent = fmt(o.def, v); }
    updateVisibility();
    save();
    if (SPRITE_KEYS.has(def.k)) scheduleSprites(); else scheduleScene();
  }

  let saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ } }, 300);
  }

  /* ---------------- quick starts ---------------- */
  const CHIPS = [
    ['🦘 Jumping', { mode: 'motion', motion: 'jump', count: 1, duration: 0.9 }],
    ['🌀 Spin', { mode: 'motion', motion: 'spin', count: 1, duration: 1 }],
    ['🏀 Bounce across ×4', { mode: 'travel', travel: 'bounce', count: 4, tCount: 5, tInterval: 0.35, tTravel: 2.2, tSize: 62, tSpin: 1, loopMode: 'once', tHopH: 30 }],
    ['🌧️ Rain ×5', { mode: 'travel', travel: 'fall', count: 5, tCount: 14, tInterval: 0.18, tTravel: 1.1, tSize: 40, tSizeVar: 40, loopMode: 'wrap', tSpin: 0.5, tRotRand: 40, tGravity: 60 }],
    ['🐍 Conveyor wave ×6', { mode: 'travel', travel: 'wave', count: 6, tCount: 7, tInterval: 0.4, tTravel: 2.8, tSize: 55, loopMode: 'wrap', tAmp: 22, tWaves: 0.5, tSizeVar: 0 }],
    ['⛲ Fountain ×3', { mode: 'travel', travel: 'burst', count: 3, tCount: 12, tInterval: 0.12, tTravel: 1.4, tSize: 38, tSizeVar: 30, loopMode: 'wrap', tSpin: 1, tRandHue: false }],
    ['🎈 Bubbles ×3', { mode: 'travel', travel: 'rise', count: 3, tCount: 8, tInterval: 0.3, tTravel: 2.4, tSize: 40, tSizeVar: 40, loopMode: 'wrap', tSway: 12, tGravity: 0, tFade: 15 }],
    ['🪩 Disco', { mode: 'motion', motion: 'pulse', count: 1, duration: 0.8, cycles: 2, hueCycle: 1 }],
    ['🌊 Giant wave ×4', { mode: 'motion', motion: 'jump', count: 4, layout: 'cells', phase: 12, duration: 1.2, scale: 80 }],
    ['🖼️ Giant jelly ×4', { mode: 'motion', motion: 'jelly', count: 4, layout: 'big', fit: 'contain', duration: 1, scale: 100 }],
    ['😡 Rage shake', { mode: 'motion', motion: 'shake', count: 1, duration: 0.5, cycles: 6, amp: 120 }],
    ['💓 Heartbeat', { mode: 'motion', motion: 'heartbeat', count: 1, duration: 1 }],
  ];
  function buildChips() {
    for (const [label, patch] of CHIPS) {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = label;
      b.onclick = () => {
        const keep = { name: state.name };
        for (const k of SPRITE_KEYS) keep[k] = state[k];
        for (const k of ['autoFit', 'maxColors', 'alphaThr', 'matteOn', 'matte', 'size', 'delay']) keep[k] = state[k];
        state = Object.assign({}, DEFAULTS, keep, patch);
        syncControls(); save(); scheduleScene();
      };
      $('chips').append(b);
    }
  }

  /* ---------------- images ---------------- */
  let images = []; // {id, bmp, name}
  let sprites = [];
  let uid = 1;

  async function loadFile(file) {
    if (!file.type.startsWith('image/')) return null;
    try { return await createImageBitmap(file); } catch (e) { /* fall back */ }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => res(im); im.onerror = rej; im.src = url;
    });
  }
  async function addFiles(files) {
    for (const f of Array.from(files).slice(0, 30)) {
      const bmp = await loadFile(f);
      if (bmp) images.push({ id: uid++, bmp, name: f.name });
    }
    scheduleSprites(0);
  }

  function renderThumbs() {
    const host = $('thumbs'); host.innerHTML = '';
    if (!images.length) {
      const p = document.createElement('div'); p.className = 'hint'; p.textContent = 'Showing a sample smiley. Add your own images to replace it.';
      host.append(p); return;
    }
    images.forEach((im, i) => {
      const d = document.createElement('div'); d.className = 'thumb';
      const box = document.createElement('div'); box.className = 'im';
      const sp = sprites[i];
      if (sp) {
        const c = document.createElement('canvas'); c.width = 80; c.height = 80;
        const k = Math.min(80 / sp.canvas.width, 80 / sp.canvas.height);
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        x.drawImage(sp.canvas, (80 - sp.canvas.width * k) / 2, (80 - sp.canvas.height * k) / 2, sp.canvas.width * k, sp.canvas.height * k);
        box.append(c);
      }
      const acts = document.createElement('div'); acts.className = 'acts';
      const mk = (t, f, dis) => { const b = document.createElement('button'); b.textContent = t; b.disabled = dis; b.onclick = f; b.setAttribute('aria-label', t); return b; };
      acts.append(
        mk('◀', () => { [images[i - 1], images[i]] = [images[i], images[i - 1]]; scheduleSprites(0); }, i === 0),
        mk('✕', () => { images.splice(i, 1); scheduleSprites(0); }, false),
        mk('▶', () => { [images[i + 1], images[i]] = [images[i], images[i + 1]]; scheduleSprites(0); }, i === images.length - 1));
      d.append(box, acts); host.append(d);
    });
  }

  let spriteT, spriteTok = 0;
  function scheduleSprites(delay) {
    clearTimeout(spriteT);
    spriteT = setTimeout(rebuildSprites, delay === undefined ? 140 : delay);
  }
  function rebuildSprites() {
    const tok = ++spriteTok;
    const srcs = images.length ? images.map((i) => i.bmp) : [ImageProc.sampleSprite()];
    const out = [];
    for (const s of srcs) {
      try { out.push(ImageProc.prepare(s, state)); } catch (e) { console.error(e); }
    }
    if (tok !== spriteTok) return;
    sprites = out.length ? out : [ImageProc.prepare(ImageProc.sampleSprite(), state)];
    renderThumbs();
    rebuildScene();
  }

  /* ---------------- preview ---------------- */
  const stage = $('stage');
  let sctx = null, scene = null, playing = true, curFrame = 0, t0 = 0, dirty = true;
  let chatBig = [], chatSmall = [], chatKey = '';
  let sceneT;
  function scheduleScene() { clearTimeout(sceneT); sceneT = setTimeout(rebuildScene, 70); }

  function rebuildScene() {
    try {
      scene = Engine.build(Object.assign({}, state), sprites);
    } catch (e) { console.error(e); $('info').textContent = 'Error: ' + e.message; return; }
    stage.width = scene.W; stage.height = scene.H;
    sctx = stage.getContext('2d', { willReadFrequently: true });
    const secs = (scene.frameCount * scene.delay / 100).toFixed(2);
    $('info').textContent = `${scene.N} emoji · ${scene.S}px · ${scene.frameCount} frames · ${secs}s`;
    const key = scene.N;
    if (key !== chatKey) {
      chatKey = key;
      for (const [host, arr] of [[$('chatBig'), chatBig = []], [$('chatSmall'), chatSmall = []]]) {
        host.innerHTML = '';
        for (let n = 0; n < scene.N; n++) { const c = document.createElement('canvas'); host.append(c); arr.push(c); }
      }
    }
    invalidateResults();
    layout();
    t0 = performance.now() - curFrame * scene.delay * 10;
    dirty = true;
  }

  function layout() {
    if (!scene) return;
    const boxW = $('stageBox').clientWidth || 300;
    const maxH = window.innerWidth < 900 ? Math.max(110, Math.min(190, window.innerHeight * 0.24)) : 240;
    const w = Math.min(boxW, maxH * scene.W / scene.H);
    stage.style.width = w + 'px'; stage.style.height = (w * scene.H / scene.W) + 'px';
    const avail = ($('chat').clientWidth || 300) - 20;
    const big = Math.max(16, Math.min(48, Math.floor((avail * 0.62 - scene.N * 2) / scene.N)));
    const small = Math.max(10, Math.min(22, Math.floor(big * 0.46)));
    chatBig.forEach((c) => { c.width = c.height = big * 2; c.style.width = c.style.height = big + 'px'; });
    chatSmall.forEach((c) => { c.width = c.height = small * 2; c.style.width = c.style.height = small + 'px'; });
    dirty = true;
  }
  window.addEventListener('resize', layout);

  function frame(now) {
    requestAnimationFrame(frame);
    if (!scene) return;
    let fi = curFrame;
    if (playing) fi = Math.floor((now - t0) / (scene.delay * 10)) % scene.frameCount;
    if (fi === curFrame && !dirty) return;
    curFrame = fi; dirty = false;
    scene.render(fi, sctx);
    const S = scene.S;
    for (let n = 0; n < scene.N; n++) {
      for (const c of [chatBig[n], chatSmall[n]]) {
        if (!c) continue;
        const x = c.getContext('2d');
        x.clearRect(0, 0, c.width, c.height);
        x.imageSmoothingQuality = 'high';
        x.drawImage(stage, n * S, 0, S, S, 0, 0, c.width, c.height);
      }
    }
  }
  requestAnimationFrame(frame);

  $('playBtn').onclick = () => {
    playing = !playing;
    $('playBtn').textContent = playing ? '⏸ Pause' : '▶ Play';
    if (playing && scene) t0 = performance.now() - curFrame * scene.delay * 10;
  };
  let lightChat = false;
  $('themeBtn').onclick = () => {
    lightChat = !lightChat;
    $('chat').dataset.theme = lightChat ? 'light' : 'dark';
    $('themeBtn').textContent = lightChat ? '☀️ Light' : '🌙 Dark';
  };
  $('pinChk').onchange = (e) => $('previewCol').classList.toggle('unpinned', !e.target.checked);

  /* ---------------- export ---------------- */
  let building = false, results = null;

  function invalidateResults() {
    if (results && !building) { $('resultStatus').className = 'status warn'; $('resultStatus').textContent = 'Settings changed – press “Create GIFs” to rebuild.'; }
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));
  function setProgress(frac, text) {
    $('progress').hidden = false;
    $('progressBar').style.width = Math.round(frac * 100) + '%';
    $('progressText').textContent = text;
  }

  function extract(data, W, S, e, out) {
    for (let y = 0; y < S; y++) out.set(data.subarray((y * W + e * S) * 4, (y * W + e * S + S) * 4), y * S * 4);
  }

  function safeName() {
    let n = (state.name || 'emoji').replace(/[^A-Za-z0-9_]/g, '_');
    if (n.length < 2) n = (n + 'emoji').slice(0, 6);
    return n.slice(0, 24);
  }

  async function buildGifs() {
    if (building) return;
    building = true; $('buildBtn').disabled = true;
    try {
      const cfg = Object.assign({}, state);
      const thr = cfg.alphaThr, matte = cfg.matteOn ? GIF.hexToRgb(cfg.matte) : null;
      const S = cfg.size, N = cfg.count;
      const scratch = document.createElement('canvas');
      const sx = scratch.getContext('2d', { willReadFrequently: true });
      const sliceBuf = new Uint8ClampedArray(S * S * 4);
      const idxBuf = new Uint8Array(S * S);

      // pass 1: colour histograms
      let baseScene = Engine.build(cfg, sprites);
      scratch.width = baseScene.W; scratch.height = baseScene.H;
      const hists = Array.from({ length: N }, () => new GIF.Histogram());
      for (let i = 0; i < baseScene.frameCount; i++) {
        baseScene.render(i, sx);
        const data = sx.getImageData(0, 0, baseScene.W, baseScene.H).data;
        for (let e = 0; e < N; e++) { extract(data, baseScene.W, S, e, sliceBuf); hists[e].add(sliceBuf, thr, matte); }
        if (i % 4 === 0) { setProgress(0.25 * i / baseScene.frameCount, 'Analysing colours…'); await tick(); }
      }
      let heavy = 0;
      hists.forEach((h, e) => { if (h.opaque > hists[heavy].opaque) heavy = e; });

      async function encode(sc, colors, list, label, base) {
        const qs = list.map((e) => GIF.quantize(hists[e], colors));
        const encs = list.map((e, k) => new GIF.Encoder(S, S, qs[k], sc.delay));
        for (let i = 0; i < sc.frameCount; i++) {
          sc.render(i, sx);
          const data = sx.getImageData(0, 0, sc.W, sc.H).data;
          list.forEach((e, k) => {
            extract(data, sc.W, S, e, sliceBuf);
            GIF.mapFrame(sliceBuf, qs[k], thr, matte, idxBuf);
            encs[k].addFrame(idxBuf);
          });
          if (i % 3 === 0) { setProgress(base + 0.7 * i / sc.frameCount * 0.25, label); await tick(); }
        }
        const out = {};
        list.forEach((e, k) => { out[e] = encs[k].finish(); });
        return out;
      }

      const all = Array.from({ length: N }, (_, i) => i);
      const colorOpts = [256, 128, 64, 32, 16].filter((c) => c <= cfg.maxColors);
      const d = cfg.delay;
      const delays = [d, Math.ceil(d * 1.5), d * 2, d * 3].filter((v, i, a) => a.indexOf(v) === i && v <= 12);
      const steps = [];
      if (cfg.autoFit) { for (const dl of delays) for (const c of colorOpts) steps.push({ delay: dl, colors: c }); }
      else steps.push({ delay: d, colors: cfg.maxColors });

      let final = null, chosen = null, attempt = 0;
      for (const st of steps) {
        attempt++;
        const sc = st.delay === d ? baseScene : Engine.build(Object.assign({}, cfg, { delay: st.delay }), sprites);
        scratch.width = sc.W; scratch.height = sc.H;
        const lbl = `Encoding (try ${attempt}/${steps.length})…`;
        const base = 0.25 + 0.7 * Math.min(1, (attempt - 1) / steps.length);
        let res = await encode(sc, st.colors, cfg.autoFit && N > 1 ? [heavy] : all, lbl, base);
        if (cfg.autoFit && N > 1) {
          if (res[heavy].length > LIMIT && attempt < steps.length) continue;
          const rest = all.filter((e) => e !== heavy);
          Object.assign(res, await encode(sc, st.colors, rest, lbl, base));
        }
        final = res; chosen = Object.assign({ scene: sc }, st);
        const worst = Math.max(...all.map((e) => res[e].length));
        if (!cfg.autoFit || worst <= LIMIT) break;
      }

      showResults(final, chosen, cfg);
      setProgress(1, 'Done!');
      setTimeout(() => { $('progress').hidden = true; }, 1200);
    } catch (e) {
      console.error(e);
      setProgress(0, 'Something went wrong: ' + e.message);
    } finally {
      building = false; $('buildBtn').disabled = false;
    }
  }

  function fmtKB(n) { return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; }

  function showResults(bytes, chosen, cfg) {
    if (results) results.urls.forEach((u) => URL.revokeObjectURL(u));
    const N = cfg.count, base = safeName();
    const pad = String(N).length;
    const files = [], urls = [];
    for (let e = 0; e < N; e++) {
      const name = N === 1 ? base : `${base}_${String(e + 1).padStart(pad, '0')}`;
      const blob = new Blob([bytes[e]], { type: 'image/gif' });
      const url = URL.createObjectURL(blob); urls.push(url);
      files.push({ name, filename: name + '.gif', data: bytes[e], blob, url, size: bytes[e].length });
    }
    results = { files, urls };
    $('results').hidden = false;
    const grid = $('resultGrid'); grid.innerHTML = '';
    let bad = 0;
    for (const f of files) {
      const ok = f.size <= LIMIT; if (!ok) bad++;
      const c = document.createElement('div'); c.className = 'rcard';
      c.innerHTML = `<img alt=""><div class="nm"></div><span class="badge ${ok ? 'good' : 'bad'}">${fmtKB(f.size)}${ok ? '' : ' – too big'}</span><a download>Download</a>`;
      c.querySelector('img').src = f.url; c.querySelector('.nm').textContent = f.name;
      const a = c.querySelector('a'); a.href = f.url; a.download = f.filename;
      grid.append(c);
    }
    const acts = $('resultActions'); acts.innerHTML = '';
    if (N > 1) {
      const z = document.createElement('button'); z.className = 'btn primary small'; z.textContent = 'Download all (ZIP)';
      z.onclick = () => {
        const blob = ZIP.makeZip(files.map((f) => ({ name: f.filename, data: f.data })));
        const u = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = u; a.download = base + '.zip'; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 10000);
      };
      acts.append(z);
      const cp = document.createElement('button'); cp.className = 'btn small'; cp.textContent = 'Copy chat text';
      const text = files.map((f) => ':' + f.name + ':').join('');
      cp.onclick = async () => { try { await navigator.clipboard.writeText(text); cp.textContent = 'Copied!'; } catch (e) { cp.textContent = text; } setTimeout(() => { cp.textContent = 'Copy chat text'; }, 2000); };
      acts.append(cp);
    }
    try {
      const fl = files.map((f) => new File([f.blob], f.filename, { type: 'image/gif' }));
      if (navigator.canShare && navigator.canShare({ files: fl })) {
        const sh = document.createElement('button'); sh.className = 'btn small'; sh.textContent = 'Share / save';
        sh.onclick = () => navigator.share({ files: fl }).catch(() => {});
        acts.append(sh);
      }
    } catch (e) { /* ignore */ }

    const st = $('resultStatus');
    const worst = Math.max(...files.map((f) => f.size));
    const fps = (100 / chosen.delay).toFixed(chosen.delay === 8 ? 1 : 0);
    const notes = [];
    if (chosen.delay !== cfg.delay) notes.push(`frame rate lowered to ${fps} fps`);
    if (chosen.colors < cfg.maxColors || (cfg.autoFit && chosen.colors < 256)) notes.push(`${chosen.colors} colours`);
    if (bad) {
      st.className = 'status bad';
      st.textContent = `${bad} GIF${bad > 1 ? 's are' : ' is'} over Discord’s 256 KB limit. Try a smaller size, fewer images, a shorter loop or a lower frame rate.`;
    } else {
      st.className = 'status good';
      st.textContent = `All ${N} GIF${N > 1 ? 's' : ''} fit Discord’s limit (largest ${fmtKB(worst)})` + (notes.length ? ' – ' + notes.join(', ') : '') + '.';
    }
    $('howto').textContent = N > 1
      ? `In Discord: Server Settings → Emoji → Upload all ${N} files, then send them in one message with no spaces, in order: ${files.map((f) => ':' + f.name + ':').join('')}`
      : 'In Discord: Server Settings → Emoji → Upload, then use it like any emoji. (Animated emojis need Nitro to use outside this server.)';
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- wiring ---------------- */
  $('buildBtn').onclick = buildGifs;
  $('addBtn').onclick = () => $('file').click();
  $('file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', (e) => {
    const fl = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (fl.length) addFiles(fl);
  });
  $('resetBtn').onclick = () => {
    if (!confirm('Reset all settings?')) return;
    state = Object.assign({}, DEFAULTS); syncControls(); save(); scheduleSprites(0);
  };

  buildControls();
  buildChips();
  syncControls();
  rebuildSprites();
  window.__emojiMaker = { state: () => state, buildGifs, get results() { return results; }, set: (p) => { Object.assign(state, p); syncControls(); scheduleSprites(0); } };
})();
