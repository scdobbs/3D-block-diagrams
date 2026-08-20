// Application shell: layout, tabs, the identify tool, and file handling.

import { el, svg, clear } from './widgets.js';
import { swatchEl } from './swatch.js';
import { tabIcon } from './icons.js';
import { layersPanel, historyPanel, terrainPanel, viewPanel } from './panels.js';
import { BlockScene } from '../render/scene.js';
import { Store, loadSaved, exportJSON, importJSON } from '../store.js';
import { defaultDocument, rock } from '../geo/model.js';
import { compileHistory, describeAt, beddingAt } from '../geo/unmake.js';
import { quadrantBearing } from '../geo/math.js';

const TABS = [
  { id: 'layers', label: 'Layers', build: layersPanel },
  { id: 'history', label: 'History', build: historyPanel },
  { id: 'terrain', label: 'Terrain', build: terrainPanel },
  { id: 'view', label: 'View', build: viewPanel },
];

export class App {
  constructor(root) {
    this.root = root;
    this.store = new Store(loadSaved() || defaultDocument());
    this.selectedEventId = null;
    this.activeTab = 'layers';
    this.sheetState = 'half';   // 'peek' | 'half' | 'full'
    this._history = null;

    this._buildDOM();
    this.scene = new BlockScene(this.canvas);
    this.scene.controls.onTap = (x, y) => this.identify(x, y);

    // Handed to every panel. `selectedEventId` is a live getter so a panel
    // rebuilt at any moment sees the current selection.
    this.ctx = {
      store: this.store,
      get selectedEventId() { return this._app.selectedEventId; },
      _app: this,
      selectEvent: (id, tab) => this.selectEvent(id, tab),
      applyPreset: (p) => this.applyPreset(p),
      setView: (az, elev) => { this.scene.controls.setView(az, elev); },
      frame: () => this.scene.frame(this.store.doc),
      exportFile: () => this.exportFile(),
      importFile: () => this.importFile(),
      exportImage: () => this.exportImage(),
    };

    this.panels = {};
    this._renderTabs();
    this._syncAll({ structural: true });

    this.store.subscribe((doc, info) => this._onChange(doc, info));
    window.addEventListener('resize', () => this.scene.resize());
    this._bindKeys();

    this.scene.resize();
    this.scene.frame(this.store.doc);
    this._loop();
  }

  // -------------------------------------------------------------------------

  _buildDOM() {
    clear(this.root);

    this.canvas = el('canvas', { class: 'viewport', id: 'viewport' });

    this.undoBtn = iconBtn('↶', 'Undo', () => this.store.undo());
    this.redoBtn = iconBtn('↷', 'Redo', () => this.store.redo());

    this.compass = compassRose();
    this.readout = el('div', { class: 'readout hidden' });
    // Blocks are dimensionless without a stated size, and students need one
    // to read thicknesses off the section.
    this.scaleChip = el('div', { class: 'scale-chip' });

    this.tabBar = el('nav', { class: 'tabbar' });
    this.sheetBody = el('div', { class: 'sheet-body' });
    this.handle = el('button', { class: 'sheet-handle', 'aria-label': 'Resize panel' });
    this.sheet = el('section', { class: 'sheet half' }, [this.handle, this.tabBar, this.sheetBody]);

    this.root.append(
      el('div', { class: 'stage' }, [
        this.canvas,
        el('div', { class: 'hud hud-left' }, [this.undoBtn, this.redoBtn]),
        el('div', { class: 'hud hud-right' }, [this.compass.node]),
        this.scaleChip,
        this.readout,
      ]),
      this.sheet,
    );

    this._bindSheet();
  }

  _renderTabs() {
    clear(this.tabBar);
    for (const t of TABS) {
      const b = el('button', {
        class: `tab ${t.id === this.activeTab ? 'active' : ''}`, type: 'button',
        onclick: () => this.setTab(t.id),
      }, [
        el('span', { class: 'tab-icon' }, [tabIcon(t.id)]),
        el('span', { class: 'tab-label', text: t.label }),
      ]);
      this.tabBar.appendChild(b);
    }
    this._renderPanel();
  }

  _renderPanel() {
    clear(this.sheetBody);
    const t = TABS.find((x) => x.id === this.activeTab);
    const panel = t.build(this.ctx);
    this.panels[this.activeTab] = panel;
    this.sheetBody.appendChild(panel);
  }

  setTab(id) {
    if (this.activeTab === id && this.sheetState === 'peek') { this._setSheet('half'); return; }
    this.activeTab = id;
    if (this.sheetState === 'peek') this._setSheet('half');
    this._renderTabs();
  }

  selectEvent(id, tab) {
    this.selectedEventId = id;
    if (tab && this.activeTab !== tab) { this.activeTab = tab; this._renderTabs(); }
    else this._renderPanel();
    this._syncHelper();
  }

  // -------------------------------------------------------------------------

  _onChange(doc, info) {
    this._history = null;
    this.scene.syncDocument(doc);
    this._syncHelper();
    this.undoBtn.disabled = !this.store.canUndo;
    this.redoBtn.disabled = !this.store.canRedo;
    this.compass.node.style.display = doc.settings.showCompass ? '' : 'none';

    const b = doc.block;
    const w = Math.round(b.width - (b.cutE || 0));
    const d = Math.round(b.depth - (b.cutN || 0));
    const ex = doc.settings.exaggeration || 1;
    this.scaleChip.textContent =
      `${w} × ${d} × ${Math.round(b.height)} m${ex !== 1 ? `  ·  ${ex}× vertical` : ''}`;

    if (info.structural) this._renderPanel();
  }

  _syncAll(info) { this._onChange(this.store.doc, info); }

  _syncHelper() {
    const ev = this.store.doc.events.find((e) => e.id === this.selectedEventId);
    this.scene.showHelper(this.store.doc, ev || null);
  }

  applyPreset(preset) {
    const doc = JSON.parse(JSON.stringify(this.store.doc));
    doc.events = preset.build();
    doc.name = preset.label;
    this.selectedEventId = null;
    this.store.replace(doc);
    this.activeTab = 'history';
    this._renderTabs();
  }

  // -------------------------------------------------------------------------
  // Identify tool
  // -------------------------------------------------------------------------

  identify(clientX, clientY) {
    const hit = this.scene.pick(clientX, clientY);
    if (!hit) { this.readout.classList.add('hidden'); return; }

    if (!this._history) this._history = compileHistory(this.store.doc);
    const info = describeAt(this._history, hit.point);
    const bed = beddingAt(this._history, hit.point);
    const r = rock(info.rockId);

    clear(this.readout);
    this.readout.classList.remove('hidden');
    this.readout.append(
      swatchEl(r.color, r.pattern, 'swatch small'),
      el('div', { class: 'readout-text' }, [
        el('div', { class: 'readout-name', text: info.label }),
        el('div', { class: 'readout-sub', text: info.detail }),
        bed
          ? el('div', { class: 'readout-orient' }, [
            el('strong', { text: `${pad3(bed.strike)}/${Math.round(bed.dip)}` }),
            el('span', { text: ` ${quadrantBearing(bed.strike)} · dip ${Math.round(bed.dip)}°` }),
          ])
          : el('div', { class: 'readout-orient dim', text: 'no bedding here' }),
        el('div', { class: 'readout-xyz', text: `${Math.round(hit.point[0])} E, ${Math.round(hit.point[1])} N, ${Math.round(hit.point[2])} m` }),
      ]),
      el('button', {
        class: 'readout-close', text: '×', 'aria-label': 'Close',
        onclick: () => this.readout.classList.add('hidden'),
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  exportFile() {
    const blob = new Blob([exportJSON(this.store.doc)], { type: 'application/json' });
    downloadBlob(blob, `${slug(this.store.doc.name)}.block.json`);
  }

  importFile() {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const doc = importJSON(await file.text());
        this.selectedEventId = null;
        this.store.replace(doc);
        this.scene.frame(doc);
      } catch (err) {
        alert(`Could not open that file.\n${err.message}`);
      }
    });
    input.click();
  }

  exportImage() {
    // The drawing buffer is not preserved between frames, so draw and grab
    // the pixels in the same turn of the event loop.
    this.scene.renderer.render(this.scene.scene, this.scene.camera);
    this.scene.renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${slug(this.store.doc.name)}.png`);
    }, 'image/png');
  }

  // -------------------------------------------------------------------------

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo(); else this.store.undo();
      }
    });
  }

  /** Bottom-sheet drag between its three heights. */
  _bindSheet() {
    let startY = 0;
    let startState = this.sheetState;
    let dragging = false;

    const order = ['peek', 'half', 'full'];
    const onDown = (e) => {
      dragging = true; startY = e.clientY; startState = this.sheetState;
      this.handle.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const i = order.indexOf(startState);
      if (dy < -60 && i < order.length - 1) { this._setSheet(order[i + 1]); dragging = false; }
      if (dy > 60 && i > 0) { this._setSheet(order[i - 1]); dragging = false; }
    };
    const onUp = () => { dragging = false; };

    this.handle.addEventListener('pointerdown', onDown);
    this.handle.addEventListener('pointermove', onMove);
    this.handle.addEventListener('pointerup', onUp);
    this.handle.addEventListener('click', () => {
      this._setSheet(this.sheetState === 'peek' ? 'half' : this.sheetState === 'half' ? 'full' : 'peek');
    });
  }

  _setSheet(state) {
    this.sheetState = state;
    this.sheet.className = `sheet ${state}`;
    requestAnimationFrame(() => this.scene.resize());
  }

  _loop() {
    const tick = () => {
      this.scene.render();
      this.compass.update(this.scene.controls.azimuth, this.scene.controls.elevation);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------------------

function iconBtn(glyph, label, onClick) {
  return el('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, onclick: onClick }, [
    el('span', { text: glyph }),
  ]);
}

/** Small rose that spins with the camera so north is never in doubt. */
function compassRose() {
  const node = svg('svg', { viewBox: '0 0 64 64', class: 'compass' });
  node.appendChild(svg('circle', { cx: 32, cy: 32, r: 29, class: 'compass-face' }));
  const dial = svg('g', {});
  dial.appendChild(svg('text', { x: 32, y: 13, 'text-anchor': 'middle', class: 'compass-n', text: 'N' }));
  dial.appendChild(svg('path', { d: 'M32 16 L38 33 L32 28 L26 33 Z', class: 'needle-n' }));
  dial.appendChild(svg('path', { d: 'M32 55 L26 33 L32 38 L38 33 Z', class: 'needle-s' }));
  node.appendChild(dial);

  return {
    node,
    update(azimuth) {
      // Camera azimuth is the direction we look from, so the rose counter-rotates.
      dial.setAttribute('transform', `rotate(${-azimuth} 32 32)`);
    },
  };
}

function pad3(v) { return String(Math.round(v)).padStart(3, '0'); }

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
