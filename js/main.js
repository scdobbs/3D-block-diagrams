/**
 * Block — 3D geologic block diagrams
 * Copyright (C) 2026 Stephen Dobbs
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file, or
 * <https://www.gnu.org/licenses/>.
 *
 * Source: https://github.com/scdobbs/3D-block-diagrams
 */

import { App } from './ui/app.js';

function fail(message, detail) {
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="fatal">
      <h1>Can't start</h1>
      <p>${message}</p>
      ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  fail('This device or browser does not have WebGL available, which the 3D block needs.');
} else {
  try {
    window.app = new App(document.getElementById('app'));
    document.body.classList.add('ready');
  } catch (err) {
    console.error(err);
    fail('Something went wrong starting the app.', err && err.stack);
  }
}

// Offline support. Registration failing is not fatal — the app still runs,
// it just will not be available without a connection until it succeeds.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // A cache-first worker will happily serve yesterday's app forever, so
      // say so when a newer one has installed behind it.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('service worker registration failed', err);
    }
  });
}

function showUpdateBanner() {
  if (document.querySelector('.update-banner')) return;
  const bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.innerHTML = '<span>A newer version is ready.</span>';
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.addEventListener('click', () => location.reload());
  bar.appendChild(btn);
  document.body.appendChild(bar);
}
