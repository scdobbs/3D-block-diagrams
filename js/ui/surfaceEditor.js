// Editor for a surface parameter set. Used twice: once for the land surface
// on the Terrain tab, once for the erosion surface under an unconformity.

import { el, clear, numberRow, selectRow, compassDial } from './widgets.js';
import { SURFACE_KINDS } from '../geo/surfaces.js';

/**
 * @param {object} surface  the live surface object (read for initial values)
 * @param {(patch:object, coalesceKey:string) => void} onChange
 * @param {{showBase?: boolean}} [opts]  an unconformity's datum is derived from
 *   its unit count rather than set by hand, so that panel hides the control.
 */
export function surfaceEditor(surface, onChange, opts = {}) {
  const root = el('div', { class: 'surface-editor' });

  const build = () => {
    clear(root);
    const s = surface;
    const set = (key) => (v) => onChange({ [key]: v }, `surf:${key}`);

    root.appendChild(selectRow({
      label: 'Landform',
      value: s.kind,
      options: SURFACE_KINDS.map((k) => ({ value: k.id, label: k.label })),
      onChange: (v) => { surface.kind = v; onChange({ kind: v }, 'surf:kind'); build(); },
    }));

    const hint = SURFACE_KINDS.find((k) => k.id === s.kind)?.hint;
    if (hint) root.appendChild(el('div', { class: 'ctl-hint standalone', text: hint }));

    switch (s.kind) {
      case 'slope':
        root.appendChild(numberRow({
          label: 'Slope angle', value: s.slopeAngle, min: 0, max: 45, step: 0.5,
          unit: '°', onChange: set('slopeAngle'),
        }));
        root.appendChild(compassDial({
          label: 'Downhill direction', value: s.azimuth,
          onChange: (v) => onChange({ azimuth: v }, 'surf:azimuth'),
        }));
        break;

      case 'hills':
        root.appendChild(numberRow({
          label: 'Relief', value: s.amplitude, min: 10, max: 800, step: 5,
          unit: 'm', onChange: set('amplitude'),
        }));
        root.appendChild(numberRow({
          label: 'Hill spacing', value: s.wavelength, min: 150, max: 4000, step: 25,
          unit: 'm', onChange: set('wavelength'),
        }));
        break;

      case 'valley':
      case 'ridge':
        root.appendChild(numberRow({
          label: s.kind === 'valley' ? 'Depth' : 'Height',
          value: s.amplitude, min: 10, max: 900, step: 5, unit: 'm', onChange: set('amplitude'),
        }));
        root.appendChild(numberRow({
          label: 'Half-width', value: s.radius, min: 50, max: 2500, step: 25,
          unit: 'm', onChange: set('radius'),
        }));
        root.appendChild(compassDial({
          label: s.kind === 'valley' ? 'Valley trend' : 'Ridge trend',
          value: s.azimuth,
          onChange: (v) => onChange({ azimuth: v }, 'surf:azimuth'),
        }));
        root.appendChild(numberRow({
          label: 'Downstream gradient', value: s.gradient, min: -300, max: 300, step: 5,
          unit: 'm/km', onChange: set('gradient'),
          hint: 'Tilt along the trend — needed for the rule of Vs to show.',
        }));
        root.appendChild(offsetRow(s, onChange, 'Axis offset'));
        break;

      case 'mountain':
        root.appendChild(numberRow({
          label: 'Peak height', value: s.amplitude, min: 20, max: 1500, step: 10,
          unit: 'm', onChange: set('amplitude'),
        }));
        root.appendChild(numberRow({
          label: 'Radius', value: s.radius, min: 100, max: 3000, step: 25,
          unit: 'm', onChange: set('radius'),
        }));
        root.appendChild(offsetRow(s, onChange, 'Peak position'));
        break;

      default:
        break;
    }

    if (opts.showBase !== false) {
      root.appendChild(numberRow({
        label: 'Base elevation', value: s.base, min: -2000, max: 1500, step: 10,
        unit: 'm', onChange: set('base'),
      }));
    }

    if (s.kind !== 'flat') {
      root.appendChild(numberRow({
        label: 'Roughness', value: s.roughness, min: 0, max: 1, step: 0.05,
        onChange: set('roughness'),
        hint: 'Adds fine hills over the main landform.',
      }));
    }
  };

  build();
  return root;
}

function offsetRow(s, onChange, label) {
  return el('div', { class: 'ctl-pair' }, [
    numberRow({
      label: `${label} E`, value: s.centerX, min: -2000, max: 2000, step: 25,
      unit: 'm', onChange: (v) => onChange({ centerX: v }, 'surf:cx'),
    }),
    numberRow({
      label: `${label} N`, value: s.centerY, min: -2000, max: 2000, step: 25,
      unit: 'm', onChange: (v) => onChange({ centerY: v }, 'surf:cy'),
    }),
  ]);
}
