# Stillwave

Animate an illustration by painting the parts that should move. Import a flat
PNG or a layered PSD, mark eyes, hair, head and chest, refine the result, and
export a GIF, video or frame sequence. No bones and no rig to wire up.

## Run it

Needs Node 20+ and a current Chrome or Edge on Windows, macOS or Linux (WebGL2 required).

```
cd stillwave
npm install
npm run dev        # then open http://localhost:5173
```

For a static build: `npm run build`, then `npm run preview` (or serve `dist/`).
Nothing leaves your machine. There is no server, account or API.

## The workflow

1. **Artwork**: drop in a PNG, several PNGs or a layered PSD. Move, scale, rotate,
   reorder and set a layer near or far for parallax. Retouch any layer with the
   brush, clone tool, eraser and eyedropper (`I`, with a magnifier and recent
   colours); the original pixels are always kept and can be restored. Add an empty **repair layer** to paint over problems without
   touching the artwork. Paint modes: *Over*, *Behind* (fills only empty pixels,
   for underpainting) and *Inside* (recolours only existing pixels).
2. **Motion**: add motions and place them on the picture.
   - **Eye**: fit the outline to the opening. Pull the tab beside it to close the
     lid; it stays where you leave it. Double-click a lid line to add a shaping
     point. For exact work switch the eye to **Precise**: four Bézier curves
     (lash line, carried band, stretching skin, lower lid) with nodes, tangent
     handles, Alt for corners, arrow-key nudging, closure presets and
     **Crease follow**. Simple stays the default, and both shapes are kept. Choose how hidden skin is made (*Blend skin* or *Pull skin down*), and
     when the automatic result isn't enough, paint the lid yourself: **Lid skin**
     (brush or clone), **Lashes** (extra lashes that travel with the lid) and
     **Keep** (hair or detail the blink must never touch). Mirror to the other eye.
   - **Sway**: brush over a lock from root to tip. Choose **Swing** (turns as one
     piece), **Bend** (curls toward the tip) or **Flutter** (bend plus a quick,
     light tip). The strand bends along a smooth path from root to tip: use
     **Follow the paint** to lay it down the middle of the painted strand, or
     add, drag, nudge (arrow keys) and remove points yourself in the Path
     section (double-click the line adds a point, Delete removes the selected one).
     **Lift onto its own layer** cuts the lock out, fills the gap behind it with
     a guess, and lets it move over the picture instead of dragging it.
   - **Head**, **Breath**, **Mouth** as before, and **Hold still**: paint anything
     that must never move, such as a face under swaying hair or a shoulder.

   Paused shows tinted washes and handles; hover any motion to watch only that
   part move. **Rhythm** has one-click looks (*Still life*, *Natural*, *Lively*,
   *Breezy*) plus timing, blink shape and drift controls. **Expression** holds a
   pose (lids, mouth, head, per-expression layer swaps) that blinking and sway
   play over.
3. **Export**: the canvas shows the finished animation. Choose an expression and
   background, then save an **animated GIF**, **WebM video** (with transparency in
   Chromium), a **zip of PNG frames**, or an **interactive page** (one offline
   HTML file that plays live). Pointer-following and the microphone are tucked
   under *Live preview extras*.

Everything is undoable, including brush strokes, eye paint, lifting and
deleting a motion (trash button on each row, or Delete). **New** puts the
current animation aside after asking whether to save it; until you start on
something else it can be picked up again from the start screen. The last
session is autosaved in the browser; **Save** writes a `.stillwave` file that
holds every image, mask and setting. Projects from the first build still open.

Shortcuts: `Space` play/pause, `V` select, `B` brush, `E` eraser, `C` clone
(Alt-click sets the source), `I` eyedropper (Alt-click while painting does the
same), arrow keys nudge a selected point, `[` `]`
brush size, `1`–`9` expressions, `F` fit view, `Tab` panels, `Ctrl+Z` /
`Ctrl+Shift+Z`, `Ctrl+S`, `Ctrl+E` export. Wheel zooms; middle-drag or
Space-drag pans.

## Architecture

```
src/engine/   framework-free animation core, shared by the editor and the exported page
  types.ts    document model (+ normalizeDoc for older files)
  assets.ts   image and mask registries, project pack/unpack, garbage collection
  rig.ts      Animator: fixed 120 Hz step -> RigFrame (blinks, breath, sway springs, expressions)
  gl.ts       WebGL2 renderer: per-layer grid mesh, sway transport, fold guard, eye/mouth shader
  geom.ts     lid curves (peak or monotone spline through points), sway spine
  retouch.ts  brush/clone/erase strokes, pull-push hole filling, lifting a region to its own layer
  paint.ts    motion-mask brush
src/state/    zustand store with immer; undo history, actions
src/io/       PNG/PSD import, project save/open/autosave, exporters
src/ui/       React UI; Stage.tsx owns the canvas and every direct-manipulation gesture
src/player/   standalone runtime, built to one script and inlined into exported pages
tests/        Playwright browser tests and fixtures (see tests/README.md)
```

Motion is split by scale:

- **Mesh (CPU)** for broad motion. Each layer is a grid. Sway carries every
  vertex along a root-to-tip spine: each point keeps its offset from the spine
  and turns with it, so a lock keeps its drawn width. The paint weight scales
  the *angle* a point receives rather than blending positions, so soft edges
  twist gently instead of smearing. Overlapping sways share a vertex by squared
  weight. Hold-still paint pins vertices after all motion. Fold protection then
  projects grid edges and diagonals back into range, unfolds any inside-out
  triangles locally, and only as a last resort scales back the motion of the
  one connected region that still folds.
- **Shader (per pixel)** for the face. Eyelids, gaze and mouth remap texture
  lookups in rest-pose space, so they stay sharp and ride along with the mesh.
  Each eye's lids reach the shader as a lookup table across the eye (lid
  heights, carried-band and stretching-skin thickness), so simple and precise
  shapes use the same blink.
  The lash band is slid down over the eye; the uncovered skin is a blend of the
  skin tones above and below the eye (rejecting samples whose hue doesn't match
  skin, such as a fringe), with brushwork carried over from the strip above the
  lashes. Hand-painted lid skin, lash and keep marks are stored per eye and read
  by the same pass.

Pixel data is immutable and referenced by id. A retouch stroke, a mask stroke
or a lift produces new images and swaps ids in the document, which is what makes
every edit a normal undo step. Unreferenced images are collected periodically.

[docs/REFERENCE_STUDY.md](docs/REFERENCE_STUDY.md) compares this implementation
with the earlier Stillwave project it learned from, with rendered comparisons.

## Known limitations

- Flattened art is bent, not separated. Lifting a strand helps, but the gap
  behind it is a smooth guess that usually needs repainting on detailed art.
- On painterly art the blended lid skin reads well at normal size but looks like
  a patch when zoomed in; hand-painted or cloned lid skin is the fix. Eyes and
  mouths are fitted by hand; there is no lash or face detection, and a careless
  fit (the upper curve on top of the lash stroke instead of below it) gives a
  visibly wrong blink. Precise curves must be a single height across the eye
  (no overhangs).
- Swing on a flat mask stretches the soft border more than Bend does. Hold-still
  can tear a soft strand where it crosses a held area.
- Eye paint is stored at 256 × 256 per eye. Up to 8 eyes per project (4 on any
  one layer), 2 mouths per layer, 6 points per lid or spine. Clone samples the
  visible artwork at rest, up to 2048 px.
- At very large swings, fold protection keeps the picture intact by giving up
  some motion (84–100% kept in the tests); it is not a physical simulation.
- PSD blend modes, clipping masks and layer effects are ignored. GIF has 256
  colours and hard-edged transparency. WebM is recorded in real time;
  transparency was verified in Chromium only.
- No keyframe timeline, physics collisions or automatic segmentation.
- Performance was measured only under software rendering in a headless browser.
  A still, paused picture is not redrawn at all; real-GPU cost on large PSDs has
  not been profiled.
