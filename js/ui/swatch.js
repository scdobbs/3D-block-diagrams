// Canvas lithology swatches for the UI. These mirror the shader patterns in
// glsl.js closely enough that a swatch in the layer list reads as the same
// rock you see on the block face.

const CELL = 13;

export function drawSwatch(canvas, color, pattern, scale = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 36;
  const h = canvas.clientHeight || 36;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  g.fillStyle = color;
  g.fillRect(0, 0, w, h);

  // Ink is clipped to the tile so patterns never bleed past the rounded edge,
  // and drawn a little darker than before so fine ornament survives at 30px.
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();

  g.strokeStyle = 'rgba(0,0,0,0.62)';
  g.fillStyle = 'rgba(0,0,0,0.62)';
  g.lineWidth = Math.max(0.9, 1.1 * scale);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const c = CELL * scale;
  const rows = Math.ceil(h / c) + 1;
  const cols = Math.ceil(w / c) + 1;
  const odd = (r) => (r % 2 ? c / 2 : 0);

  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };

  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const x = i * c + odd(r);
      const y = r * c;
      const cx = x + c / 2, cy = y + c / 2;
      switch (pattern) {
        case 1: dot(cx, cy, c * 0.09); break;                       // sandstone
        case 10: dot(cx, cy, c * 0.055); dot(cx + c * 0.3, cy + c * 0.3, c * 0.055); break;
        case 2: line(cx - c * 0.3, cy, cx + c * 0.3, cy); break;    // shale
        case 11: line(cx, cy - c * 0.3, cx, cy + c * 0.3); break;   // evaporite
        case 3:                                                      // limestone
          line(x, y + c, x + c, y + c);
          line(cx, y, cx, y + c);
          break;
        case 9:                                                      // dolostone
          line(x, y + c, x + c, y + c);
          line(cx, y, cx, y + c);
          line(x + c * 0.15, y + c * 0.85, x + c * 0.85, y + c * 0.15);
          break;
        case 4:                                                      // conglomerate
          g.beginPath();
          g.ellipse(cx, cy, c * 0.3, c * 0.21, (i + r) * 0.7, 0, Math.PI * 2);
          g.stroke();
          break;
        case 5:                                                      // plutonic
          line(cx - c * 0.2, cy, cx + c * 0.2, cy);
          line(cx, cy - c * 0.2, cx, cy + c * 0.2);
          break;
        case 6:                                                      // volcanic
          line(cx - c * 0.22, cy - c * 0.16, cx, cy + c * 0.16);
          line(cx, cy + c * 0.16, cx + c * 0.22, cy - c * 0.16);
          break;
        case 7:                                                      // metamorphic
          g.beginPath();
          g.moveTo(x - c * 0.5, cy);
          g.quadraticCurveTo(cx - c * 0.25, cy - c * 0.28, cx, cy);
          g.quadraticCurveTo(cx + c * 0.25, cy + c * 0.28, x + c * 1.5, cy);
          g.stroke();
          break;
        case 12:                                                     // tuff
          dot(cx, cy, c * 0.06);
          line(cx - c * 0.16, cy + c * 0.22, cx, cy + c * 0.06);
          break;
        case 13: break;                                              // basement, below
        default: break;                                              // 0, 8: plain
      }
    }
  }

  // Basement is drawn as one continuous fabric rather than per cell: steeply
  // inclined, contorted foliation, so it reads as deformed crystalline rock
  // rather than as another set of flat-lying beds.
  if (pattern === 13) {
    const step = c * 0.62;
    const lean = 0.55;
    for (let k = -Math.ceil(h * lean / step) - 1; k < (w + h * lean) / step + 1; k++) {
      g.beginPath();
      for (let y = -1; y <= h + 1; y += 2) {
        const x = k * step + y * lean
          + Math.sin(y / (c * 1.5)) * c * 0.22
          + Math.sin(y / (c * 0.6) + k) * c * 0.08;
        if (y < 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  g.restore();

  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
}

/** A swatch element that redraws itself when told to. */
export function swatchEl(color, pattern, cls = 'swatch') {
  const cv = document.createElement('canvas');
  cv.className = cls;
  const paint = () => drawSwatch(cv, color, pattern);
  // Size comes from CSS, so wait a tick for layout before the first paint.
  requestAnimationFrame(paint);
  cv.update = (c, p) => { color = c; pattern = p; paint(); };
  return cv;
}
