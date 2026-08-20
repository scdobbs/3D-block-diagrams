// Document store: mutation, undo/redo, and offline persistence.
//
// Undo entries are coalesced by key so that dragging a dip slider through
// forty intermediate values leaves one undo step, not forty.

import { defaultDocument, SCHEMA_VERSION, faultKindFromRake } from './geo/model.js';

const KEY = 'blockdiagram.doc.v1';
const COALESCE_MS = 900;
const MAX_UNDO = 60;

export class Store {
  constructor(doc = defaultDocument()) {
    this.doc = doc;
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this._lastKey = null;
    this._lastAt = 0;
    this._saveTimer = null;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /**
   * Apply a mutation.
   * @param {(doc:object)=>void} mutator
   * @param {object} opts
   *   coalesce  key that merges consecutive edits into one undo step
   *   structural  true when the change alters the shape of the history or the
   *               layer list, so the UI must rebuild rather than just repaint
   */
  edit(mutator, opts = {}) {
    const { coalesce = null, structural = false, silent = false } = opts;
    const now = performance.now();
    const sameRun = coalesce != null
      && coalesce === this._lastKey
      && now - this._lastAt < COALESCE_MS;

    if (!sameRun) {
      this.undoStack.push(snapshot(this.doc));
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this._lastKey = coalesce;
    this._lastAt = now;

    mutator(this.doc);
    if (!silent) this._emit({ structural });
    this._scheduleSave();
  }

  /** Replace the whole document (load, preset, reset). Always undoable. */
  replace(doc, structural = true) {
    this.undoStack.push(snapshot(this.doc));
    this.redoStack.length = 0;
    this._lastKey = null;
    this.doc = doc;
    this._emit({ structural });
    this._scheduleSave();
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(snapshot(this.doc));
    this.doc = this.undoStack.pop();
    this._lastKey = null;
    this._emit({ structural: true });
    this._scheduleSave();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(snapshot(this.doc));
    this.doc = this.redoStack.pop();
    this._lastKey = null;
    this._emit({ structural: true });
    this._scheduleSave();
    return true;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Force the next edit to start a fresh undo step. */
  breakCoalesce() { this._lastKey = null; }

  _emit(info) { for (const fn of this.listeners) fn(this.doc, info); }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 400);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.doc));
    } catch (err) {
      // Private browsing or a full quota. Losing autosave is survivable;
      // losing the session is not, so carry on silently.
      console.warn('autosave failed', err);
    }
  }
}

function snapshot(doc) { return JSON.parse(JSON.stringify(doc)); }

export function loadSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw);
    if (!doc || doc.version !== SCHEMA_VERSION) return null;
    return migrate(doc);
  } catch {
    return null;
  }
}

/** Fill in anything a saved document predates, so old saves keep opening. */
function migrate(doc) {
  const base = defaultDocument();
  doc.settings = { ...base.settings, ...(doc.settings || {}) };
  doc.block = { ...base.block, ...(doc.block || {}) };
  doc.topo = { ...base.topo, ...(doc.topo || {}) };
  doc.events = (doc.events || []).map((e) => {
    const ev = { enabled: true, ...e };
    // Faults used to store a bare rake. Recover the kind and obliquity the
    // editor now works in, so older saves keep their geometry exactly.
    if (ev.type === 'fault' && ev.kind == null) {
      Object.assign(ev, faultKindFromRake(ev.rake ?? 90));
      delete ev.rake;
    }
    return ev;
  });
  doc.basementRockId = doc.basementRockId || base.basementRockId;
  return doc;
}

export function exportJSON(doc) {
  return JSON.stringify({ ...doc, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const doc = JSON.parse(text);
  if (!doc.layers || !Array.isArray(doc.layers)) throw new Error('Not a block diagram file');
  return migrate({ ...defaultDocument(), ...doc });
}
