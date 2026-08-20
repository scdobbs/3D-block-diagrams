// Small DOM helpers and the orientation widgets.
//
// Strike, dip and plunge each get a graphical control as well as a number
// box. Typing 042/30 is faster once you know what it means; dragging the
// compass is how you learn what it means. Both edit the same value.

import { quadrantBearing, clamp, wrap360 } from '../geo/math.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  applyProps(n, props);
  append(n, children);
  return n;
}

export function svg(tag, props = {}, children = []) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  append(n, children);
  return n;
}

function applyProps(n, props) {
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
}

function append(n, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

// ---------------------------------------------------------------------------
// Number row: label, slider, and a typed value that agree with each other
// ---------------------------------------------------------------------------

export function numberRow(opts) {
  const {
    label, value, min = 0, max = 100, step = 1, unit = '',
    onChange, hint, ends,
  } = opts;

  // Range and bounds are set BEFORE the value, and the value is assigned as a
  // property rather than an attribute. Setting value first makes the browser
  // clamp it to the default 0..100 range and snap it to the default step, so
  // the thumb ends up parked at the minimum however sensible the number was.
  const num = el('input', {
    class: 'num', type: 'number', min, max, step, inputmode: 'decimal',
  });
  const range = el('input', { class: 'range', type: 'range', min, max, step });
  num.value = fmt(value, step);
  range.value = value;

  let current = value;

  // The filled portion of the track is painted from this custom property, so
  // the thumb always sits at the end of a visible bar rather than floating on
  // an unmarked line. It is a unitless 0..1 fraction, not a percentage: the
  // thumb's centre travels over (track width - thumb width), so the CSS has to
  // inset it by half a thumb at each end for the bar to end under the knob.
  const paintFill = () => {
    const t = max > min ? (current - min) / (max - min) : 0;
    range.style.setProperty('--p', clamp(t, 0, 1));
  };

  const push = (v, fromRange) => {
    current = clamp(Number(v), min, max);
    if (Number.isNaN(current)) return;
    if (fromRange) num.value = fmt(current, step);
    else range.value = current;
    paintFill();
    onChange(current);
  };

  range.addEventListener('input', () => push(range.value, true));
  num.addEventListener('change', () => push(num.value, false));
  num.addEventListener('blur', () => { num.value = fmt(current, step); });

  // Optional labels at each end, for sliders where the direction of travel
  // needs naming rather than numbering.
  const endL = ends ? el('span', { text: ends[0] }) : null;
  const endR = ends ? el('span', { text: ends[1] }) : null;

  const row = el('div', { class: 'ctl' }, [
    el('div', { class: 'ctl-head' }, [
      el('label', { class: 'ctl-label', text: label }),
      el('div', { class: 'ctl-value' }, [num, unit ? el('span', { class: 'unit', text: unit }) : null]),
    ]),
    range,
    ends ? el('div', { class: 'ctl-ends' }, [endL, endR]) : null,
    hint ? el('div', { class: 'ctl-hint', text: hint }) : null,
  ]);

  row.setEnds = (a, b) => { if (endL) { endL.textContent = a; endR.textContent = b; } };

  row.setValue = (v) => {
    current = clamp(Number(v), min, max);
    num.value = fmt(current, step);
    range.value = current;
    paintFill();
  };
  paintFill();
  return row;
}

function fmt(v, step) {
  const dec = step >= 1 ? 0 : String(step).split('.')[1]?.length || 1;
  return Number(v).toFixed(dec);
}

export function selectRow({ label, value, options, onChange }) {
  const sel = el('select', { class: 'select' },
    options.map((o) => el('option', {
      value: o.value, text: o.label, selected: o.value === value,
    })));
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'ctl' }, [
    el('div', { class: 'ctl-head' }, [el('label', { class: 'ctl-label', text: label })]),
    sel,
  ]);
}

export function toggleRow({ label, value, onChange, hint }) {
  const box = el('button', {
    class: `toggle ${value ? 'on' : ''}`,
    type: 'button',
    'aria-pressed': value ? 'true' : 'false',
  }, [el('span', { class: 'knob' })]);
  box.addEventListener('click', () => {
    const next = !box.classList.contains('on');
    box.classList.toggle('on', next);
    box.setAttribute('aria-pressed', next ? 'true' : 'false');
    onChange(next);
  });
  return el('div', { class: 'ctl ctl-inline' }, [
    el('div', {}, [
      el('label', { class: 'ctl-label', text: label }),
      hint ? el('div', { class: 'ctl-hint', text: hint }) : null,
    ]),
    box,
  ]);
}

// ---------------------------------------------------------------------------
// Compass — azimuth 0-360, drawn as a geologic strike-and-dip symbol
// ---------------------------------------------------------------------------

export function compassDial({ value, dip = null, onChange, label = 'Strike' }) {
  const R = 52, C = 62;
  const face = svg('svg', { viewBox: '0 0 124 124', class: 'dial-svg' });

  face.appendChild(svg('circle', { cx: C, cy: C, r: R, class: 'dial-face' }));
  for (let a = 0; a < 360; a += 15) {
    const major = a % 45 === 0;
    const r1 = R - (major ? 9 : 5);
    const p1 = polar(C, a, r1), p2 = polar(C, a, R - 1);
    face.appendChild(svg('line', {
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      class: major ? 'tick major' : 'tick',
    }));
  }
  for (const [a, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const p = polar(C, a, R - 20);
    face.appendChild(svg('text', {
      x: p.x, y: p.y + 4, 'text-anchor': 'middle', class: 'dial-card', text: t,
    }));
  }

  const strikeLine = svg('line', { class: 'dial-strike' });
  const dipTick = svg('line', { class: 'dial-dip' });
  const knob = svg('circle', { r: 6.5, class: 'dial-knob' });
  face.append(strikeLine, dipTick, knob);

  const readout = el('div', { class: 'dial-readout' });
  const num = el('input', {
    class: 'num num-wide', type: 'number', min: 0, max: 360, step: 1, inputmode: 'numeric',
  });

  let current = wrap360(value);

  const draw = () => {
    const a = current;
    const p1 = polar(C, a, R - 6), p2 = polar(C, a + 180, R - 6);
    strikeLine.setAttribute('x1', p1.x); strikeLine.setAttribute('y1', p1.y);
    strikeLine.setAttribute('x2', p2.x); strikeLine.setAttribute('y2', p2.y);
    knob.setAttribute('cx', p1.x); knob.setAttribute('cy', p1.y);

    // The short tick points down-dip: 90 degrees clockwise from strike.
    const len = dip == null ? 0 : 10 + (dip / 90) * 12;
    const d = polar(C, a + 90, len);
    dipTick.setAttribute('x1', C); dipTick.setAttribute('y1', C);
    dipTick.setAttribute('x2', d.x); dipTick.setAttribute('y2', d.y);
    dipTick.style.display = dip == null ? 'none' : '';

    num.value = Math.round(a);
    readout.textContent = quadrantBearing(a);
  };

  const set = (v, notify = true) => {
    current = wrap360(v);
    draw();
    if (notify) onChange(current);
  };

  const fromPointer = (e) => {
    const r = face.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width * 124 - C;
    const dy = (e.clientY - r.top) / r.height * 124 - C;
    if (Math.hypot(dx, dy) < 8) return;
    // Screen up is north, and azimuth runs clockwise.
    set(Math.round(Math.atan2(dx, -dy) * 180 / Math.PI));
  };

  let dragging = false;
  face.addEventListener('pointerdown', (e) => {
    dragging = true; face.setPointerCapture(e.pointerId); fromPointer(e); e.preventDefault();
  });
  face.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
  face.addEventListener('pointerup', () => { dragging = false; });
  face.addEventListener('pointercancel', () => { dragging = false; });
  num.addEventListener('change', () => set(Number(num.value)));

  draw();

  const wrap = el('div', { class: 'dial' }, [
    face,
    el('div', { class: 'dial-side' }, [
      el('label', { class: 'ctl-label', text: label }),
      el('div', { class: 'ctl-value' }, [num, el('span', { class: 'unit', text: '°' })]),
      readout,
    ]),
  ]);
  wrap.setValue = (v) => set(v, false);
  wrap.setDip = (d) => { dip = d; draw(); };
  return wrap;
}

function polar(c, azDeg, r) {
  const a = (azDeg - 90) * Math.PI / 180;
  return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
}

// ---------------------------------------------------------------------------
// Protractor — dip or plunge, 0 to max degrees below horizontal
// ---------------------------------------------------------------------------

export function protractor({ value, onChange, label = 'Dip', max = 90 }) {
  // Origin at the upper left; angles open downward, the way a dip does.
  const W = 118, H = 92, OX = 14, OY = 12, R = 74;
  const face = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'prot-svg' });

  face.appendChild(svg('line', {
    x1: OX, y1: OY, x2: OX + R + 6, y2: OY, class: 'prot-horizon',
  }));
  for (let a = 0; a <= max; a += 15) {
    const p = protPoint(OX, OY, R + 4, a);
    const q = protPoint(OX, OY, R - 4, a);
    face.appendChild(svg('line', { x1: q.x, y1: q.y, x2: p.x, y2: p.y, class: 'tick' }));
  }
  face.appendChild(svg('path', { d: arcPath(OX, OY, R, 0, max), class: 'prot-arc' }));

  const ray = svg('line', { class: 'prot-ray' });
  const wedge = svg('path', { class: 'prot-wedge' });
  const knob = svg('circle', { r: 6.5, class: 'dial-knob' });
  face.append(wedge, ray, knob);

  const num = el('input', {
    class: 'num num-wide', type: 'number', min: 0, max, step: 1, inputmode: 'numeric',
  });

  let current = clamp(value, 0, max);

  const draw = () => {
    const p = protPoint(OX, OY, R, current);
    ray.setAttribute('x1', OX); ray.setAttribute('y1', OY);
    ray.setAttribute('x2', p.x); ray.setAttribute('y2', p.y);
    knob.setAttribute('cx', p.x); knob.setAttribute('cy', p.y);
    wedge.setAttribute('d', `M ${OX} ${OY} L ${OX + R} ${OY} ${arcPath(OX, OY, R, 0, current).slice(1)} Z`);
    num.value = Math.round(current);
  };

  const set = (v, notify = true) => {
    current = clamp(v, 0, max);
    draw();
    if (notify) onChange(current);
  };

  const fromPointer = (e) => {
    const r = face.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * W - OX;
    const y = (e.clientY - r.top) / r.height * H - OY;
    // Angle opens downward from the horizontal, which is exactly a dip.
    set(Math.round(clamp(Math.atan2(y, Math.max(1, x)) * 180 / Math.PI, 0, max)));
  };

  let dragging = false;
  face.addEventListener('pointerdown', (e) => {
    dragging = true; face.setPointerCapture(e.pointerId); fromPointer(e); e.preventDefault();
  });
  face.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
  face.addEventListener('pointerup', () => { dragging = false; });
  face.addEventListener('pointercancel', () => { dragging = false; });
  num.addEventListener('change', () => set(Number(num.value)));

  draw();

  const wrap = el('div', { class: 'dial' }, [
    face,
    el('div', { class: 'dial-side' }, [
      el('label', { class: 'ctl-label', text: label }),
      el('div', { class: 'ctl-value' }, [num, el('span', { class: 'unit', text: '°' })]),
    ]),
  ]);
  wrap.setValue = (v) => set(v, false);
  return wrap;
}

function protPoint(ox, oy, r, aDeg) {
  const a = aDeg * Math.PI / 180;
  return { x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r };
}

function arcPath(ox, oy, r, a0, a1) {
  const p0 = protPoint(ox, oy, r, a0);
  const p1 = protPoint(ox, oy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}
