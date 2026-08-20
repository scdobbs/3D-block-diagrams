# Block — 3D geologic block diagrams

By **Stephen Dobbs** · [AGPL-3.0](LICENSE)

An offline-first phone app for building and interrogating 3D geologic block
diagrams. Rotate the block in any direction, stack a stratigraphic column,
apply a history of tilts, folds, faults, intrusions and unconformities, drape
a landscape over the top, and tap anywhere to identify the unit and read its
strike and dip.

It runs with **no signal** — the point is to use it standing on the outcrop.

---

# Open it

## 🔗 [scdobbs.github.io/3D-block-diagrams](https://scdobbs.github.io/3D-block-diagrams/)

## On a computer

Just open the link — Chrome, Safari, Firefox and Edge all work. Nothing to
install.

- **Left-drag** turns the block
- **Scroll** zooms; **right-drag** or **shift-drag** pans
- **Click the block** to identify the unit and read its strike and dip

Start on the **View** tab, load an example like *Anticline & syncline* or
*Horst & graben*, then take it apart on the **History** tab.

## On a phone

Opening the link works straight away. But to have it **available in the field
with no signal**, add it to your home screen.
### iPhone / iPad

1. Open the link in **Safari**. (Chrome on iOS cannot install it properly.)
2. **Wait for the block to appear**, then give it ~5 more seconds. This is when
   the app stores itself for offline use.
3. Tap **Share** — the square with the arrow, bottom center.
4. **Scroll down** the share sheet to the list of actions and tap **Add to Home
   Screen**. 
5. Tap **Add**.
6. **Open it from the new home screen icon while you still have signal** and let
   it load once. iOS gives a home-screen app its own storage, separate from
   Safari's, so this is when *that* copy gets stored.

### Android

1. Open the link in **Chrome**.
2. **Wait for the block to appear**, then ~5 more seconds.
3. Tap the **Install** prompt if one appears — otherwise **⋮** (top right) →
   **Add to Home screen** / **Install app**.
4. Confirm, then open it from the new icon.

### Check it before you rely on it

Turn on **Airplane mode** and open the app from the home screen icon. It should
load completely normally.

If you get an error page instead, turn airplane mode off, open it again, let it
sit ten seconds, close it fully and retest. It only means the download in step 2
got cut short.

### Once it is installed

- Opens **full screen**, no browser bars, like any other app
- **Saves your work by itself** — close it mid-block and it comes back as you left it
- **One finger** turns, **two fingers** pinch to zoom and drag to pan, **tap**
  identifies the unit under your finger
- The panel has a **drag handle** — pull up for more room, push down for more block

When a new version ships you will see a small **"A newer version is ready —
Reload"** banner next time you open it *with* a connection. Tap it. Offline, it
keeps running the copy you already have.

---

# Using it

**Layers** — build the column. Tap a unit to set rock type, thickness and
color, or reorder and delete it. Lithology patterns follow the usual map
conventions and are drawn procedurally, so they stay crisp at any scale.

**History** — the geologic timeline, newest at the top. Add events, then tap
one to edit it. Strike and trend get a compass you can drag; dip and plunge
get a protractor. Both accept typed numbers too. **Drag an event by its grip
to move it through time** (the arrow buttons in the editor do the same thing),
and disable one without deleting it — the fastest way to see what it was
actually doing.

**Terrain** — the land surface: flat, slope, hills, valley, ridge or mountain,
with roughness on top. A valley with an axial gradient is what you want for
demonstrating the rule of Vs. **Contour lines** are drawn on the map face,
with every fifth one heavier and **labelled with its elevation**; the interval
is chosen from the terrain's own relief so it stays around a dozen lines
whatever the landform, and you can pin it to a fixed value instead.
This tab also holds block size, vertical
exaggeration (display only — strikes and dips are unaffected), and the
**cutaway**, which slides the east and north walls into the block to expose
fresh cross-sections. The cutaway is the only way to see a pluton that sits
entirely inside the block.

**View** — worked examples to load and take apart, canned viewpoints (map view,
the four section views), display toggles, and save/open/export.

**Tap the block** anywhere to identify the unit under your finger and read the
strike and dip of bedding at that point — recovered the same way a field
measurement is, from the orientation of the bedding surface itself.

---

## Conventions

- **X = East, Y = North, Z = Up.** Metres throughout.
- **Strike** follows the right-hand rule: with the strike direction ahead of
  you, the beds dip down to your right. Recorded as azimuth, 0–360° from north.
- **Dip** and **plunge** are measured down from horizontal.
- **Faults** are described the way a student describes them: pick a type —
  normal, reverse/thrust, dextral or sinistral — then dial **oblique slip**
  from −90° to +90° to mix in the other component. Zero is the pure form of
  the type you chose; the ends are the pure opposite. The editor reports the
  resulting **rake** (measured in the fault plane from the strike direction,
  rotating toward down-dip: `90°` normal, `270°` reverse, `0°` sinistral,
  `180°` dextral), because that is what the literature uses. Rake is derived,
  never stored, so there is only one source of truth; older files that saved a
  bare rake are converted on load without changing their geometry.
- The **stratigraphic column** is listed youngest at the top, as you would
  draw it. Below the deepest unit is undifferentiated basement.
- Above the top of the column, the youngest unit is extended upward. The block
  has to be made of something everywhere, and repeating the top unit is the
  reading a geologist expects.

---

# Under the hood

## How the geology works

The block is never meshed into layers. Instead, every fragment on screen asks
one question: *what rock is at this point?* — and answers it by running the
geologic history **backwards**.

Undo the youngest event, then the next, and so on, until the point lands back
in the flat layer cake it was deposited in. Then it is just a matter of which
layer that depth falls in.

Every deformation is exactly invertible, which is what makes this work:

| Event | Forward | Why the inverse is exact |
|---|---|---|
| **Tilt** | rigid rotation about the strike line | rotations invert |
| **Fold** | an upright fold (vertical displacement, wave read across the horizontal `perp` axis), then a rigid tilt about `perp` by the plunge | neither step changes the `perp` coordinate the wave is read from |
| **Dome / basin** | vertical displacement depending only on map position | map position is unchanged by vertical motion |
| **Fault** | rigid translation of the hanging wall, parallel to the fault plane | slip lies in the plane, so the hanging-wall test gives the same answer before and after |
| **Unconformity** | splits the column: units above the erosion surface skip all older history | a branch, not a transform |
| **Dike / pluton** | paints rock inside a region, at its own point in the history | a test, not a transform |

Two consequences worth knowing:

- **Contacts are pin-sharp at any zoom.** Nothing is tessellated, so there are
  no stair-steps at layer boundaries no matter how far you zoom in.
- **Order matters, exactly as it does in the field.** Move a fault later in
  the history and it starts cutting the fold instead of being folded by it.
  That is the whole point of the timeline.

The history's *shape* (how many events, of which types, in what order) is
compiled into generated GLSL; its *numbers* are uniforms. So dragging a dip
slider is a uniform upload, and only adding, deleting, reordering or disabling
an event triggers a recompile.

`js/geo/unmake.js` is a CPU implementation of the same walk. It powers the
identify tool and it is the reference the shader must agree with — **if you
change one, change the other.**

---

## Layout

```
index.html            shell
app.webmanifest       install metadata
sw.js                 offline cache  (bump CACHE when you change files)
dev-server.py         no-cache static server for development
css/app.css
vendor/three.module.js
js/
  main.js             bootstrap, service worker, update prompt
  store.js            document state, undo/redo, autosave, import/export
  geo/
    math.js           strike/dip/rake vectors and frames
    model.js          rock types, event definitions, defaults, presets
    surfaces.js       topography and erosion-surface generator
    unmake.js         the inverse history, on the CPU
    glsl.js           the inverse history, generated as GLSL
  render/
    block.js          block geometry with a terrain lid and cutaway
    material.js       document → uniforms; decides when to recompile
    controls.js       touch-first orbit controls
    scene.js          renderer, camera, event helper geometry, picking
    contours.js       traces index contours to place elevation labels
  ui/
    app.js            shell, tabs, identify tool, files
    panels.js         layers / history / terrain / view panels
    widgets.js        controls, compass dial, protractor
    surfaceEditor.js  shared surface parameter editor
    swatch.js         canvas lithology swatches
    icons.js          drawn SVG marks for tabs and event types
```

Caps: 20 layers, 16 events. Both exist to keep the generated shader inside the
fragment uniform budget of older mobile GPUs.

---

## Notes and limits

- **Faults are planar and slip is uniform.** Listric and bend faults, and blind
  thrusts whose slip tapers to a tip line, break the exactly-invertible
  property that the whole model rests on, so they need a different (iterative)
  approach. The fault code is written around a signed distance to the fault
  surface so a curved surface can be slotted in later.
- Folds are similar folds (Class 2): layer thickness is preserved parallel to
  the axial surface, not perpendicular to bedding.
- A plunging fold is built as an upright fold plus a rigid tilt about the
  horizontal axis perpendicular to its trend, so the whole fold train tilts —
  which is what puts the nose in the map view. Merely leaning the displacement
  direction over does not plunge anything; it shears the fold and leaves the
  hinge of a flat bed horizontal.
- Intrusions cut everything older than themselves and are deformed by
  everything younger, which is correct, but they have no chilled margins or
  contact aureoles.
- Erosion is applied at unconformities and at the land surface; there is no
  separate erosion event.
- Roughness is remembered per surface but is not applied to the **Flat**
  landform, so switching back to Flat always gives a level plain.
- Contours are shaded per fragment from elevation, not traced as polylines, so
  they cost nothing to redraw and stay sharp at any zoom. The index contours
  *are* traced on the CPU, but only to decide where their elevation labels go;
  each label then tells the shader to break the line around it, the way a map
  puts the number in a gap rather than on top of the contour. They fade out before
  they can alias into a solid wash, and switch to a light line on dark rock so
  they stay visible over coal and basement.

---

# Working on the code

Only needed if you want to change the app. There is no build step and no
`node_modules` — plain ES modules plus a locally vendored copy of three.js.

```
python3 dev-server.py 8777
```

then open <http://127.0.0.1:8777/>. Any static file server works; the included
one just disables caching so edits show up on reload.

## Deploying

GitHub Pages serves `main` from the repository root, so **pushing to `main`
deploys**. It goes live a minute or two later.

⚠️ **Bump `CACHE` in `sw.js` whenever you change any precached file.** The
service worker is cache-first, so a browser that already has the app keeps
serving the old copy until that name changes. No error — it just silently
stays old.

Two things that will fool you when checking a deploy:

- GitHub Pages sends `max-age=600`, so for ~10 minutes your browser may hand you
  the old files even though the deploy is live. Reload a second time.
- The first load after an update runs the *old* cached copy by design and shows
  the "newer version is ready" banner. That is correct behavior, not a failure.

Any static host works, as long as it serves over **HTTPS** — that is what the
service worker requires, and the service worker is what makes it work offline.

## Wrapping it as a store app

The code is a plain static site with no build step, so it drops into
[Capacitor](https://capacitorjs.com) unchanged when you want App Store and
Play Store binaries — `npx cap add ios`, point `webDir` at this folder. That
does need Node and Xcode; the PWA route above does not.

---

## License and attribution

Copyright © 2026 **Stephen Dobbs**.

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

In short: you are free to use it, study it, share it and build on it. If you
modify it and make it available to anyone — **including by hosting it on a
website** — you have to publish your modified source under the same license and
keep the attribution. That network clause is the point: it is what stops a
modified copy being rebranded and run as someone else's product.

Using the app as-is with your students needs no permission at all.

Bundled third-party code and its license is listed in [NOTICE](NOTICE):
[three.js](https://threejs.org) (MIT).

Not legal advice.
