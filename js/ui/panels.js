// The four editor panels. Each returns an element with a `refresh()` for
// cheap text updates, so dragging a slider never rebuilds the DOM under the
// user's finger.

import {
  el, svg, clear, numberRow, selectRow, toggleRow, compassDial, protractor,
} from './widgets.js';
import { swatchEl, drawSwatch } from './swatch.js';
import { surfaceEditor } from './surfaceEditor.js';
import { eventIcon } from './icons.js';
import {
  ROCKS, rock, makeLayer, makeEvent, EVENT_TYPES, EVENT_ORDER,
  MAX_LAYERS, MAX_EVENTS, PRESETS, defaultDocument, totalThickness,
  FAULT_KINDS, FAULT_KIND_ORDER, faultRake, faultSense,
} from '../geo/model.js';
import { quadrantBearing } from '../geo/math.js';
import { surfaceRange, niceContourInterval } from '../geo/surfaces.js';

// ---------------------------------------------------------------------------
// Stratigraphy
// ---------------------------------------------------------------------------

export function layersPanel(ctx) {
  const root = el('div', { class: 'panel' });
  let expanded = null;

  const build = () => {
    clear(root);
    const doc = ctx.store.doc;

    root.appendChild(sectionHead(
      'Stratigraphic column',
      'Youngest unit at the top, the way you would draw it in a notebook.',
    ));

    const list = el('div', { class: 'layer-list' });

    // Unconformities live in the event history but they cut the column, so
    // they are drawn here too, at the level they truncate.
    const uncBefore = new Map();
    for (const ev of doc.events) {
      if (ev.type === 'unconformity' && ev.enabled !== false) {
        const at = Math.min(Math.max(0, ev.aboveCount | 0), doc.layers.length);
        if (!uncBefore.has(at)) uncBefore.set(at, []);
        uncBefore.get(at).push(ev);
      }
    }

    doc.layers.forEach((layer, i) => {
      for (const ev of uncBefore.get(i) || []) list.appendChild(unconformityDivider(ctx, ev));
      list.appendChild(layerRow(ctx, layer, i, expanded === layer.id, (id) => {
        expanded = expanded === id ? null : id;
        build();
      }));
    });
    for (const ev of uncBefore.get(doc.layers.length) || []) {
      list.appendChild(unconformityDivider(ctx, ev));
    }

    list.appendChild(basementRow(ctx));
    root.appendChild(list);

    const total = Math.round(totalThickness(doc.layers));
    root.appendChild(el('div', { class: 'panel-foot' }, [
      el('button', {
        class: 'btn primary',
        text: '+ Add unit',
        disabled: doc.layers.length >= MAX_LAYERS,
        onclick: () => {
          ctx.store.edit((d) => {
            d.layers.unshift(makeLayer(pickNextRock(d.layers), 150));
          }, { structural: true });
        },
      }),
      el('span', { class: 'foot-note', text: `${doc.layers.length} units · ${total} m total` }),
    ]));
  };

  build();
  root.refresh = build;
  return root;
}

function pickNextRock(layers) {
  const used = layers[0]?.rockId;
  const order = ['sandstone', 'shale', 'limestone', 'siltstone', 'conglomerate', 'dolostone'];
  return order.find((r) => r !== used) || 'sandstone';
}

function layerRow(ctx, layer, index, isOpen, toggle) {
  const doc = ctx.store.doc;
  const r = rock(layer.rockId);
  const color = layer.color || r.color;
  const pattern = layer.pattern != null ? layer.pattern : r.pattern;

  const sw = swatchEl(color, pattern, 'swatch');
  const head = el('button', { class: `layer-head ${isOpen ? 'open' : ''}`, type: 'button' }, [
    sw,
    el('div', { class: 'layer-title' }, [
      el('div', { class: 'layer-name', text: layer.name || r.label }),
      el('div', { class: 'layer-sub', text: `${Math.round(layer.thickness)} m · unit ${doc.layers.length - index}` }),
    ]),
    el('span', { class: 'chev', text: isOpen ? '▾' : '▸' }),
  ]);
  head.addEventListener('click', () => toggle(layer.id));

  const row = el('div', { class: 'layer-row' }, [head]);
  if (!isOpen) return row;

  const body = el('div', { class: 'layer-body' });

  body.appendChild(el('div', { class: 'ctl' }, [
    el('label', { class: 'ctl-label', text: 'Rock type' }),
    rockPicker(layer.rockId, (id) => {
      ctx.store.edit((d) => {
        const L = d.layers[index];
        const nr = rock(id);
        L.rockId = id;
        L.name = nr.label;
        L.color = nr.color;
        L.pattern = nr.pattern;
      }, { structural: true });
    }),
  ]));

  body.appendChild(numberRow({
    label: 'Thickness', value: layer.thickness, min: 5, max: 1200, step: 5, unit: 'm',
    onChange: (v) => ctx.store.edit((d) => { d.layers[index].thickness = v; },
      { coalesce: `thk:${layer.id}` }),
  }));

  body.appendChild(el('div', { class: 'ctl' }, [
    el('label', { class: 'ctl-label', text: 'Color' }),
    colorStrip(color, (hex) => {
      ctx.store.edit((d) => { d.layers[index].color = hex; }, { structural: true });
    }),
  ]));

  body.appendChild(el('div', { class: 'row-actions' }, [
    el('button', {
      class: 'btn small', text: '↑ Younger', disabled: index === 0,
      onclick: () => ctx.store.edit((d) => {
        [d.layers[index - 1], d.layers[index]] = [d.layers[index], d.layers[index - 1]];
      }, { structural: true }),
    }),
    el('button', {
      class: 'btn small', text: '↓ Older', disabled: index === doc.layers.length - 1,
      onclick: () => ctx.store.edit((d) => {
        [d.layers[index + 1], d.layers[index]] = [d.layers[index], d.layers[index + 1]];
      }, { structural: true }),
    }),
    el('button', {
      class: 'btn small danger', text: 'Delete', disabled: doc.layers.length <= 1,
      onclick: () => ctx.store.edit((d) => {
        d.layers.splice(index, 1);
        // Unconformities count layers from the top, so anything below the
        // deleted unit has to shift up with it.
        for (const ev of d.events) {
          if (ev.type === 'unconformity' && ev.aboveCount > index) ev.aboveCount--;
        }
      }, { structural: true }),
    }),
  ]));

  row.appendChild(body);
  return row;
}

function basementRow(ctx) {
  const doc = ctx.store.doc;
  const r = rock(doc.basementRockId);
  return el('div', { class: 'layer-row basement' }, [
    el('div', { class: 'layer-head static' }, [
      swatchEl(r.color, r.pattern, 'swatch'),
      el('div', { class: 'layer-title' }, [
        el('div', { class: 'layer-name', text: 'Basement' }),
        el('div', { class: 'layer-sub', text: 'everything below the column' }),
      ]),
    ]),
  ]);
}

function unconformityDivider(ctx, ev) {
  // A row of humps all on the same side, the way the symbol is drawn on a
  // section. Written out rather than using smooth-curve reflection, which
  // alternates the humps above and below the line and pushes half of them
  // outside the viewBox.
  let d = 'M0 11';
  for (let x = 0; x < 200; x += 20) d += ` Q ${x + 10} 1 ${x + 20} 11`;
  const wave = svg('svg', {
    viewBox: '0 0 200 14', class: 'unc-wave', preserveAspectRatio: 'none',
  }, [svg('path', { d, fill: 'none' })]);
  return el('button', {
    class: 'unc-divider', type: 'button',
    onclick: () => ctx.selectEvent(ev.id, 'history'),
  }, [wave, el('span', { class: 'unc-label', text: ev.name })]);
}

function rockPicker(currentId, onPick) {
  const grid = el('div', { class: 'rock-grid' });
  let lastGroup = null;
  for (const r of ROCKS) {
    if (r.id === 'basement') continue;
    if (r.group !== lastGroup) {
      lastGroup = r.group;
      grid.appendChild(el('div', { class: 'rock-group', text: r.group }));
    }
    const cv = document.createElement('canvas');
    cv.className = 'rock-swatch';
    requestAnimationFrame(() => drawSwatch(cv, r.color, r.pattern, 0.7));
    const b = el('button', {
      class: `rock-btn ${r.id === currentId ? 'active' : ''}`, type: 'button',
      title: r.label, onclick: () => onPick(r.id),
    }, [cv, el('span', { text: r.label })]);
    grid.appendChild(b);
  }
  return grid;
}

const PALETTE = [
  '#e8c86a', '#d7c08d', '#c9955c', '#c46b4a', '#a8452f',
  '#8fb6cd', '#6f97b8', '#4d7fa3', '#a9c4b6', '#7d8a83',
  '#96917c', '#8a9c78', '#5c6b64', '#2f2f33', '#d98f8f',
  '#b07f95', '#6e6a80', '#c09a86', '#dfe3e0', '#ded0e4',
];

function colorStrip(current, onPick) {
  const wrap = el('div', { class: 'color-strip' });
  for (const c of PALETTE) {
    wrap.appendChild(el('button', {
      class: `color-dot ${c.toLowerCase() === String(current).toLowerCase() ? 'active' : ''}`,
      type: 'button', style: { background: c }, title: c,
      onclick: () => onPick(c),
    }));
  }
  const custom = el('input', { class: 'color-input', type: 'color', value: current });
  custom.addEventListener('change', () => onPick(custom.value));
  wrap.appendChild(custom);
  return wrap;
}

// ---------------------------------------------------------------------------
// Geologic history
// ---------------------------------------------------------------------------

export function historyPanel(ctx) {
  const root = el('div', { class: 'panel' });

  const build = () => {
    clear(root);
    const doc = ctx.store.doc;

    root.appendChild(sectionHead(
      'Geologic history',
      'Newest event at the top. Each event deforms everything older than it.',
    ));

    const add = el('div', { class: 'add-grid' });
    for (const type of EVENT_ORDER) {
      const def = EVENT_TYPES[type];
      add.appendChild(el('button', {
        class: 'add-btn', type: 'button', title: def.blurb,
        disabled: doc.events.length >= MAX_EVENTS,
        onclick: () => {
          const ev = makeEvent(type);
          ctx.store.edit((d) => { d.events.push(ev); }, { structural: true });
          ctx.selectEvent(ev.id, 'history');
        },
      }, [
        el('span', { class: 'add-icon' }, [eventIcon(type)]),
        el('span', { text: def.label }),
      ]));
    }
    root.appendChild(add);

    if (!doc.events.length) {
      root.appendChild(el('div', { class: 'empty' }, [
        el('p', { text: 'No events yet — the beds are flat-lying.' }),
        el('p', { class: 'dim', text: 'Add a tilt, fold or fault above, or load a preset from the View tab.' }),
      ]));
      return;
    }

    const list = el('div', { class: 'event-list' });
    // Displayed youngest-first so the list reads like the block does.
    for (let i = doc.events.length - 1; i >= 0; i--) {
      list.appendChild(eventRow(ctx, doc.events[i], i));
    }
    enableDragReorder(list, ctx);
    root.appendChild(el('div', { class: 'timeline' }, [
      el('span', { class: 'time-cap', text: 'youngest' }),
      list,
      el('span', { class: 'time-cap', text: 'oldest' }),
    ]));
  };

  build();
  root.refresh = build;
  return root;
}

function eventRow(ctx, ev, index) {
  const doc = ctx.store.doc;
  const def = EVENT_TYPES[ev.type];
  const isOpen = ctx.selectedEventId === ev.id;
  const disabled = ev.enabled === false;

  const head = el('button', {
    class: `event-head ${isOpen ? 'open' : ''} ${disabled ? 'off' : ''}`, type: 'button',
  }, [
    el('span', { class: 'event-icon' }, [eventIcon(ev.type)]),
    el('div', { class: 'event-title' }, [
      el('div', { class: 'event-name', text: ev.name }),
      el('div', { class: 'event-sub', text: summarise(ev) }),
    ]),
    el('span', { class: 'chev', text: isOpen ? '▾' : '▸' }),
  ]);
  head.addEventListener('click', () => ctx.selectEvent(isOpen ? null : ev.id, 'history'));

  // The grip sits outside the header so grabbing it never toggles the editor.
  const grip = el('button', {
    class: 'event-grip', type: 'button',
    'aria-label': 'Drag to move this event in time',
    title: 'Drag to move this event in time',
  }, [el('span', { text: '⠿' })]);

  const row = el('div', { class: 'event-row' }, [
    el('div', { class: 'event-main' }, [grip, head]),
  ]);
  row.dataset.evId = ev.id;
  if (!isOpen) return row;

  const body = el('div', { class: 'event-body' });
  body.appendChild(el('div', { class: 'ctl-hint standalone', text: def.blurb }));
  buildEventControls(ctx, ev, index, body);

  body.appendChild(el('div', { class: 'row-actions' }, [
    el('button', {
      class: 'btn small', text: '↑ Later', disabled: index === doc.events.length - 1,
      title: 'Move this event forward in time',
      onclick: () => ctx.store.edit((d) => {
        [d.events[index + 1], d.events[index]] = [d.events[index], d.events[index + 1]];
      }, { structural: true }),
    }),
    el('button', {
      class: 'btn small', text: '↓ Earlier', disabled: index === 0,
      title: 'Move this event back in time',
      onclick: () => ctx.store.edit((d) => {
        [d.events[index - 1], d.events[index]] = [d.events[index], d.events[index - 1]];
      }, { structural: true }),
    }),
    el('button', {
      class: 'btn small', text: disabled ? 'Enable' : 'Disable',
      title: 'Temporarily remove this event without deleting it',
      onclick: () => ctx.store.edit((d) => {
        d.events[index].enabled = d.events[index].enabled === false;
      }, { structural: true }),
    }),
    el('button', {
      class: 'btn small danger', text: 'Delete',
      onclick: () => ctx.store.edit((d) => { d.events.splice(index, 1); }, { structural: true }),
    }),
  ]));

  row.appendChild(body);
  return row;
}

function summarise(ev) {
  const p = (n) => String(Math.round(n)).padStart(3, '0');
  switch (ev.type) {
    case 'tilt': return `${p(ev.strike)}/${Math.round(ev.dip)}  (${quadrantBearing(ev.strike)})`;
    case 'fold': return `axis ${p(ev.trend)}→${Math.round(ev.plunge)}° · λ ${Math.round(ev.wavelength)} m · A ${Math.round(ev.amplitude)} m`;
    case 'domebasin': return `${ev.amplitude >= 0 ? 'Dome' : 'Basin'} · ${Math.round(Math.abs(ev.amplitude))} m · r ${Math.round(ev.radiusA)} m`;
    case 'fault': return `${p(ev.strike)}/${Math.round(ev.dip)} · ${faultSense(ev)} · slip ${Math.round(ev.slip)} m`;
    case 'dike': return `${p(ev.strike)}/${Math.round(ev.dip)} · ${Math.round(ev.thickness)} m · ${rock(ev.rockId).label}`;
    case 'pluton': return `${rock(ev.rockId).label} · ${Math.round(ev.radiusX)}×${Math.round(ev.radiusY)}×${Math.round(ev.radiusZ)} m`;
    case 'unconformity': return `${ev.aboveCount} unit${ev.aboveCount === 1 ? '' : 's'} above · ${ev.surface.kind} surface`;
    default: return '';
  }
}

/**
 * Drag an event up or down the timeline by its grip.
 *
 * The dragged row is only translated, never re-parented mid-drag — a drop
 * line marks where it will land. That keeps the geometry stable while the
 * finger is down, which matters because the list is inside a scroller.
 */
function enableDragReorder(list, ctx) {
  let drag = null;
  const line = el('div', { class: 'drop-line' });

  const others = () => [...list.querySelectorAll('.event-row')].filter((r) => r !== drag.row);

  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.event-grip');
    if (!grip || drag) return;
    const row = grip.closest('.event-row');
    if (!row || list.querySelectorAll('.event-row').length < 2) return;

    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    drag = { row, grip, pointerId: e.pointerId, startY: e.clientY, target: null };
    row.classList.add('dragging');
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.row.style.transform = `translateY(${e.clientY - drag.startY}px)`;

    const rows = others();
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i].getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) { idx = i; break; }
    }
    drag.target = idx;
    if (idx < rows.length) list.insertBefore(line, rows[idx]);
    else list.appendChild(line);
  });

  const finish = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const { row, target } = drag;
    row.classList.remove('dragging');
    row.style.transform = '';
    line.remove();
    drag = null;

    if (target == null) return;
    // Work in ids: the list is drawn youngest-first, so the model order is
    // this order reversed.
    const shown = [...list.querySelectorAll('.event-row')].map((r) => r.dataset.evId);
    const id = row.dataset.evId;
    const without = shown.filter((x) => x !== id);
    without.splice(target, 0, id);   // target === length appends
    const modelOrder = without.slice().reverse();
    ctx.store.edit((d) => {
      const byId = new Map(d.events.map((x) => [x.id, x]));
      const next = modelOrder.map((x) => byId.get(x)).filter(Boolean);
      if (next.length === d.events.length) d.events = next;
    }, { structural: true });
  };

  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);
}

// --- per-event parameter controls ------------------------------------------

function buildEventControls(ctx, ev, index, body) {
  const set = (key) => (v) => ctx.store.edit((d) => { d.events[index][key] = v; },
    { coalesce: `${ev.id}:${key}` });

  const nameRow = el('input', { class: 'name-input', type: 'text', value: ev.name });
  nameRow.addEventListener('change', () => ctx.store.edit(
    (d) => { d.events[index].name = nameRow.value || EVENT_TYPES[ev.type].label; },
    { structural: true },
  ));
  body.appendChild(el('div', { class: 'ctl' }, [
    el('label', { class: 'ctl-label', text: 'Label' }), nameRow,
  ]));

  switch (ev.type) {
    case 'tilt': {
      const dial = compassDial({ label: 'Strike', value: ev.strike, dip: ev.dip, onChange: set('strike') });
      body.appendChild(dial);
      body.appendChild(protractor({
        label: 'Dip', value: ev.dip, max: 89,
        onChange: (v) => { dial.setDip(v); set('dip')(v); },
      }));
      break;
    }

    case 'fold': {
      body.appendChild(compassDial({ label: 'Axis trend', value: ev.trend, onChange: set('trend') }));
      body.appendChild(protractor({ label: 'Plunge', value: ev.plunge, max: 80, onChange: set('plunge') }));
      body.appendChild(numberRow({
        label: 'Wavelength', value: ev.wavelength, min: 200, max: 6000, step: 25, unit: 'm',
        onChange: set('wavelength'), hint: 'Crest-to-crest distance.',
      }));
      body.appendChild(numberRow({
        label: 'Amplitude', value: ev.amplitude, min: 0, max: 1200, step: 10, unit: 'm',
        onChange: set('amplitude'), hint: 'Half the height from trough to crest.',
      }));
      body.appendChild(numberRow({
        label: 'Hinge shift', value: ev.phase, min: -180, max: 180, step: 5, unit: '°',
        onChange: set('phase'), hint: 'Slides the anticlines across the block.',
      }));
      body.appendChild(centerRow(ctx, ev, index, ['centerX', 'centerY']));
      break;
    }

    case 'domebasin': {
      body.appendChild(numberRow({
        label: 'Amplitude', value: ev.amplitude, min: -1200, max: 1200, step: 10, unit: 'm',
        onChange: set('amplitude'), hint: 'Positive makes a dome, negative a basin.',
      }));
      body.appendChild(numberRow({
        label: 'Radius (long)', value: ev.radiusA, min: 100, max: 3000, step: 25, unit: 'm',
        onChange: set('radiusA'),
      }));
      body.appendChild(numberRow({
        label: 'Radius (short)', value: ev.radiusB, min: 100, max: 3000, step: 25, unit: 'm',
        onChange: set('radiusB'),
      }));
      body.appendChild(compassDial({ label: 'Long-axis trend', value: ev.azimuth, onChange: set('azimuth') }));
      body.appendChild(centerRow(ctx, ev, index, ['centerX', 'centerY']));
      break;
    }

    case 'fault': {
      const dial = compassDial({ label: 'Strike', value: ev.strike, dip: ev.dip, onChange: set('strike') });
      body.appendChild(dial);
      body.appendChild(protractor({
        label: 'Dip', value: ev.dip, max: 90,
        onChange: (v) => { dial.setDip(v); set('dip')(v); },
      }));

      // Kind first, obliquity second. Rake is the derived quantity and is
      // reported rather than dialed, because "normal" is what a student
      // means and 090 is only how it gets written down.
      const kindDef = () => FAULT_KINDS[ev.kind] || FAULT_KINDS.normal;
      const senseNote = el('div', { class: 'sense-note' });
      const refreshNote = () => {
        const k = kindDef();
        senseNote.textContent = `${faultSense(ev)} · rake ${Math.round(faultRake(ev))}°`;
        obliqRow.setEnds(k.neg, k.pos);
      };

      body.appendChild(el('div', { class: 'ctl' }, [
        el('label', { class: 'ctl-label', text: 'Fault type' }),
        el('div', { class: 'segmented' }, FAULT_KIND_ORDER.map((id) => el('button', {
          class: `seg ${ev.kind === id ? 'active' : ''}`, type: 'button',
          title: FAULT_KINDS[id].blurb, text: FAULT_KINDS[id].label,
          onclick: () => ctx.store.edit((d) => { d.events[index].kind = id; }, { structural: true }),
        }))),
      ]));
      body.appendChild(el('div', { class: 'ctl-hint standalone', text: kindDef().blurb }));

      const obliqRow = numberRow({
        label: 'Oblique slip', value: ev.obliquity || 0, min: -90, max: 90, step: 5, unit: '°',
        ends: [kindDef().neg, kindDef().pos],
        hint: 'Zero is a pure slip of the chosen type; the ends are the pure opposite.',
        onChange: (v) => {
          ev.obliquity = v;             // keep the local copy in step for the note
          refreshNote();
          set('obliquity')(v);
        },
      });
      body.appendChild(obliqRow);
      body.appendChild(senseNote);
      refreshNote();

      body.appendChild(numberRow({
        label: 'Slip', value: ev.slip, min: 0, max: 2000, step: 10, unit: 'm',
        onChange: set('slip'), hint: 'Displacement of the hanging wall along the rake.',
      }));
      body.appendChild(centerRow(ctx, ev, index, ['centerX', 'centerY', 'centerZ']));
      break;
    }

    case 'dike': {
      const dial = compassDial({ label: 'Strike', value: ev.strike, dip: ev.dip, onChange: set('strike') });
      body.appendChild(dial);
      body.appendChild(protractor({
        label: 'Dip', value: ev.dip, max: 90,
        onChange: (v) => { dial.setDip(v); set('dip')(v); },
        // A dip near 0 makes this a sill rather than a dike.
      }));
      body.appendChild(numberRow({
        label: 'Thickness', value: ev.thickness, min: 5, max: 600, step: 5, unit: 'm',
        onChange: set('thickness'),
      }));
      body.appendChild(rockRow(ctx, ev, index, ['basalt', 'gabbro', 'granite', 'diorite', 'tuff']));
      body.appendChild(numberRow({
        label: 'Top', value: ev.topZ, min: -2000, max: 1500, step: 25, unit: 'm',
        onChange: set('topZ'), hint: 'Set below the surface for a blind intrusion.',
      }));
      body.appendChild(numberRow({
        label: 'Bottom', value: ev.bottomZ, min: -4000, max: 500, step: 25, unit: 'm',
        onChange: set('bottomZ'),
      }));
      body.appendChild(centerRow(ctx, ev, index, ['centerX', 'centerY']));
      break;
    }

    case 'pluton': {
      body.appendChild(rockRow(ctx, ev, index, ['granite', 'diorite', 'gabbro', 'basalt']));
      body.appendChild(numberRow({
        label: 'Radius E–W', value: ev.radiusX, min: 50, max: 2500, step: 25, unit: 'm', onChange: set('radiusX'),
      }));
      body.appendChild(numberRow({
        label: 'Radius N–S', value: ev.radiusY, min: 50, max: 2500, step: 25, unit: 'm', onChange: set('radiusY'),
      }));
      body.appendChild(numberRow({
        label: 'Radius vertical', value: ev.radiusZ, min: 50, max: 2500, step: 25, unit: 'm', onChange: set('radiusZ'),
      }));
      body.appendChild(compassDial({ label: 'Long-axis trend', value: ev.azimuth, onChange: set('azimuth') }));
      body.appendChild(centerRow(ctx, ev, index, ['centerX', 'centerY', 'centerZ']));
      break;
    }

    case 'unconformity': {
      const doc = ctx.store.doc;
      body.appendChild(numberRow({
        label: 'Units above', value: ev.aboveCount, min: 0, max: doc.layers.length, step: 1,
        onChange: (v) => ctx.store.edit((d) => { d.events[index].aboveCount = Math.round(v); },
          { structural: true }),
        hint: 'How many units from the top of the column were deposited after the erosion.',
      }));
      body.appendChild(selectRow({
        label: 'Younger beds',
        value: ev.fill || 'flat',
        options: [
          { value: 'flat', label: 'Lie flat and onlap the surface' },
          { value: 'drape', label: 'Drape over the buried topography' },
        ],
        onChange: (v) => ctx.store.edit((d) => { d.events[index].fill = v; }, { structural: true }),
      }));
      body.appendChild(el('div', { class: 'sub-head', text: 'Erosion surface' }));
      body.appendChild(surfaceEditor(ev.surface, (patch, key) => {
        ctx.store.edit((d) => { Object.assign(d.events[index].surface, patch); },
          { coalesce: `${ev.id}:${key}` });
      }));
      break;
    }
  }
}

function centerRow(ctx, ev, index, keys) {
  const labels = { centerX: 'Position E', centerY: 'Position N', centerZ: 'Depth' };
  const ranges = { centerX: [-2500, 2500], centerY: [-2500, 2500], centerZ: [-3000, 800] };
  return el('div', { class: 'ctl-pair' }, keys.map((k) => numberRow({
    label: labels[k], value: ev[k], min: ranges[k][0], max: ranges[k][1], step: 25, unit: 'm',
    onChange: (v) => ctx.store.edit((d) => { d.events[index][k] = v; },
      { coalesce: `${ev.id}:${k}` }),
  })));
}

function rockRow(ctx, ev, index, ids) {
  const wrap = el('div', { class: 'ctl' }, [el('label', { class: 'ctl-label', text: 'Rock type' })]);
  const strip = el('div', { class: 'rock-strip' });
  for (const id of ids) {
    const r = rock(id);
    const cv = document.createElement('canvas');
    cv.className = 'rock-swatch';
    requestAnimationFrame(() => drawSwatch(cv, r.color, r.pattern, 0.7));
    strip.appendChild(el('button', {
      class: `rock-btn ${ev.rockId === id ? 'active' : ''}`, type: 'button',
      onclick: () => ctx.store.edit((d) => { d.events[index].rockId = id; }, { structural: true }),
    }, [cv, el('span', { text: r.label })]));
  }
  wrap.appendChild(strip);
  return wrap;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function terrainPanel(ctx) {
  const root = el('div', { class: 'panel' });

  const build = () => {
    clear(root);
    const doc = ctx.store.doc;

    root.appendChild(sectionHead(
      'Land surface',
      'The map face of the block. Relief is what makes outcrop patterns interesting.',
    ));

    root.appendChild(surfaceEditor(doc.topo, (patch, key) => {
      ctx.store.edit((d) => { Object.assign(d.topo, patch); }, { coalesce: `topo:${key}` });
    }));

    root.appendChild(el('div', { class: 'sub-head', text: 'Contours' }));
    root.appendChild(toggleRow({
      label: 'Contour lines', value: doc.settings.showContours !== false,
      hint: 'Drawn on the map face only. Every fifth line is heavier.',
      onChange: (v) => ctx.store.edit((d) => { d.settings.showContours = v; },
        { structural: true }),
    }));
    if (doc.settings.showContours !== false) {
      const { lo, hi } = surfaceRange(doc.topo, doc.block.width, doc.block.depth);
      const auto = niceContourInterval(hi - lo);
      root.appendChild(selectRow({
        label: 'Interval',
        value: String(doc.settings.contourInterval || 0),
        options: [
          { value: '0', label: auto ? `Automatic — ${fmtInterval(auto)}` : 'Automatic — ground is flat' },
          ...[5, 10, 20, 25, 50, 100, 200, 500].map((v) => ({ value: String(v), label: `${v} m` })),
        ],
        onChange: (v) => ctx.store.edit((d) => { d.settings.contourInterval = Number(v); },
          { structural: true }),
      }));
      root.appendChild(el('div', { class: 'ctl-hint standalone', text: `Relief across the block: ${Math.round(hi - lo)} m` }));
    }

    root.appendChild(el('div', { class: 'sub-head', text: 'Block size' }));
    for (const [key, label, max] of [
      ['width', 'Width (E–W)', 6000],
      ['depth', 'Depth (N–S)', 6000],
      ['height', 'Height', 4000],
    ]) {
      root.appendChild(numberRow({
        label, value: doc.block[key], min: 400, max, step: 100, unit: 'm',
        onChange: (v) => ctx.store.edit((d) => { d.block[key] = v; }, { coalesce: `block:${key}` }),
      }));
    }

    root.appendChild(el('div', { class: 'sub-head', text: 'Cutaway' }));
    root.appendChild(el('div', { class: 'ctl-hint standalone', text: 'Slide a wall into the block to expose a fresh cross-section. The geology does not move — you are cutting a new face through it.' }));
    for (const [key, label, dim] of [['cutE', 'Cut in from the east', 'width'], ['cutN', 'Cut in from the north', 'depth']]) {
      root.appendChild(numberRow({
        label, value: doc.block[key] || 0, min: 0, max: Math.round(doc.block[dim] * 0.85), step: 25, unit: 'm',
        onChange: (v) => ctx.store.edit((d) => { d.block[key] = v; }, { coalesce: `block:${key}` }),
      }));
    }

    root.appendChild(el('div', { class: 'sub-head', text: 'Display' }));
    root.appendChild(numberRow({
      label: 'Vertical exaggeration', value: doc.settings.exaggeration, min: 0.5, max: 4, step: 0.1,
      unit: '×',
      onChange: (v) => ctx.store.edit((d) => { d.settings.exaggeration = v; },
        { coalesce: 'exag' }),
      hint: 'Display only — strikes and dips are unchanged.',
    }));
  };

  build();
  root.refresh = build;
  return root;
}

// ---------------------------------------------------------------------------
// View, presets and files
// ---------------------------------------------------------------------------

export function viewPanel(ctx) {
  const root = el('div', { class: 'panel' });

  const build = () => {
    clear(root);
    const doc = ctx.store.doc;

    root.appendChild(sectionHead('Examples', 'Load a worked structure, then take it apart.'));
    const grid = el('div', { class: 'preset-grid' });
    for (const p of PRESETS) {
      grid.appendChild(el('button', {
        class: 'preset-btn', type: 'button', title: p.blurb,
        onclick: () => ctx.applyPreset(p),
      }, [
        el('span', { class: 'preset-name', text: p.label }),
        el('span', { class: 'preset-blurb', text: p.blurb }),
      ]));
    }
    root.appendChild(grid);

    root.appendChild(el('div', { class: 'sub-head', text: 'Viewpoint' }));
    root.appendChild(el('div', { class: 'view-grid' }, [
      viewBtn(ctx, 'Map view', 0, 89),
      viewBtn(ctx, 'Oblique', 35, 28),
      viewBtn(ctx, 'Look north', 0, 6),
      viewBtn(ctx, 'Look east', 90, 6),
      viewBtn(ctx, 'Look south', 180, 6),
      viewBtn(ctx, 'Look west', 270, 6),
    ]));
    root.appendChild(el('button', {
      class: 'btn wide', text: 'Recenter block', onclick: () => ctx.frame(),
    }));

    root.appendChild(el('div', { class: 'sub-head', text: 'Display' }));
    root.appendChild(toggleRow({
      label: 'Lithology patterns', value: doc.settings.showPatterns,
      onChange: (v) => ctx.store.edit((d) => { d.settings.showPatterns = v; }, { structural: false }),
    }));
    root.appendChild(toggleRow({
      label: 'Contact lines', value: doc.settings.showContacts,
      hint: 'Dark line where two units meet.',
      onChange: (v) => ctx.store.edit((d) => { d.settings.showContacts = v; }, { structural: false }),
    }));
    root.appendChild(toggleRow({
      label: 'Compass', value: doc.settings.showCompass,
      onChange: (v) => ctx.store.edit((d) => { d.settings.showCompass = v; }, { structural: true }),
    }));
    root.appendChild(selectRow({
      label: 'Rendering quality',
      value: doc.settings.quality,
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: 'high', label: 'High — smooth contacts' },
        { value: 'low', label: 'Low — save battery' },
      ],
      onChange: (v) => ctx.store.edit((d) => { d.settings.quality = v; }, { structural: false }),
    }));

    root.appendChild(el('div', { class: 'sub-head', text: 'This block' }));
    const nameInput = el('input', { class: 'name-input', type: 'text', value: doc.name });
    nameInput.addEventListener('change', () => ctx.store.edit(
      (d) => { d.name = nameInput.value || 'Untitled block'; }, { structural: true },
    ));
    root.appendChild(el('div', { class: 'ctl' }, [
      el('label', { class: 'ctl-label', text: 'Name' }), nameInput,
    ]));

    root.appendChild(el('div', { class: 'row-actions wrap' }, [
      el('button', { class: 'btn', text: 'Save to file', onclick: () => ctx.exportFile() }),
      el('button', { class: 'btn', text: 'Open file', onclick: () => ctx.importFile() }),
      el('button', { class: 'btn', text: 'Save image', onclick: () => ctx.exportImage() }),
      el('button', {
        class: 'btn danger', text: 'Start over',
        onclick: () => { if (confirm('Discard this block and start fresh?')) ctx.store.replace(defaultDocument()); },
      }),
    ]));

    // Attribution and license. The source link is not decorative: the AGPL
    // requires that people who use the app over a network be able to get at
    // the source, and anyone who forks and rehosts inherits that obligation.
    root.appendChild(el('div', { class: 'about' }, [
      el('p', { text: 'Works with no signal. Add it to your home screen and it will open like any other app.' }),
      el('div', { class: 'about-rule' }),
      el('p', { class: 'about-title', text: 'Block — 3D geologic block diagrams' }),
      el('p', {}, [
        'Created by ',
        el('strong', { text: 'Stephen Dobbs' }),
        '. © 2026.',
      ]),
      el('p', {}, [
        'Licensed ',
        el('a', {
          href: 'https://www.gnu.org/licenses/agpl-3.0.html',
          target: '_blank', rel: 'noopener noreferrer', text: 'AGPL-3.0',
        }),
        '. Free to use, study and share; if you modify it and host it, you must publish your source and keep this attribution.',
      ]),
      el('p', {}, [
        el('a', {
          class: 'about-link',
          href: 'https://github.com/scdobbs/3D-block-diagrams',
          target: '_blank', rel: 'noopener noreferrer', text: 'Source code on GitHub',
        }),
      ]),
      el('p', { class: 'about-dim' }, [
        '3D rendering by ',
        el('a', {
          href: 'https://threejs.org', target: '_blank', rel: 'noopener noreferrer', text: 'three.js',
        }),
        ' (MIT).',
      ]),
    ]));
  };

  build();
  root.refresh = build;
  return root;
}

function viewBtn(ctx, label, az, el_) {
  return el('button', {
    class: 'btn small', type: 'button', text: label,
    onclick: () => ctx.setView(az, el_),
  });
}

function fmtInterval(v) {
  return v >= 1 ? `${Math.round(v)} m` : `${v} m`;
}

function sectionHead(title, sub) {
  return el('div', { class: 'section-head' }, [
    el('h2', { text: title }),
    sub ? el('p', { text: sub }) : null,
  ]);
}
