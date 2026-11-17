# Stillwave

Turn a character illustration into a blinking, breathing 2D avatar by painting
the parts that should move. No bones, no parameters to wire up.

## Run it

Needs Node 20+ and a modern browser (Chrome or Edge recommended; WebGL2 required).

```
npm install
npm run dev        # http://localhost:5173
```

For a static build: `npm run build`, then `npm run preview` (or serve `dist/`).

Nothing leaves your machine. There is no server, account or API.

## How it works for the artist

1. **Artwork** – drop a PNG, several PNGs, or a layered PSD. Move, resize, rotate
   and reorder layers. Set a layer "near" or "far" for parallax.
2. **Motion** – add motions and place them directly on the picture:
   - **Eye**: fit an outline to the eye opening. Pull the small tab beside it to
     close the lid by hand. Mirror it to the other eye.
   - **Mouth**: fit a line to the lips.
   - **Head / Sway / Breath**: brush over the area. Paint from root to tip for
     hair and the direction is set for you.
   Pause shows the still drawing with tinted washes and handles; hover any
   motion to watch only that part move. Play shows the live result.
3. **Stage** – perform with moods (keys 1–9), pointer tracking and microphone
   lip movement, then export.

## What is implemented

| Area | Status |
| --- | --- |
| PNG / WebP / JPEG import, multi-file | Working |
| Layered PSD import (pixel layers, groups flattened, position, opacity, hidden) | Working; blend modes, masks, adjustment and text layers are not interpreted |
| Layer move / scale / rotate / reorder / hide / depth | Working |
| Blink with editable shape, interval, irregularity, half and double blinks | Working |
| Eyelids on flattened art (upper and lower lid, closing curve) | Working |
| Gaze (iris shift), pointer following, wandering gaze | Working |
| Breathing, idle head drift, body sway | Working |
| Head turn / nod / tilt with fake depth | Working |
| Hair and cloth sway with spring physics, breeze, ripple | Working |
| Moods (expressions) with eased transitions and per-mood layer swaps | Working |
| Mouth open / smile, microphone-driven | Working |
| Undo / redo (including brush strokes), keyboard shortcuts | Working |
| Save / open `.stillwave` projects, autosaved last session | Working |
| Export: standalone avatar HTML, GIF, WebM, PNG frame zip | Working |

Shortcuts: `Space` play/pause, `V` select, `B` brush, `E` erase, `[` `]` brush
size, `1`–`9` moods, `F` fit view, `Tab` panels, `Ctrl+Z` / `Ctrl+Shift+Z`,
`Ctrl+S`, `Ctrl+E`. Wheel zooms, middle-drag or Space-drag pans.

## Architecture

```
src/engine/   framework-free animation core (shared by editor and exported player)
  types.ts    document model
  assets.ts   image + mask registries, project pack/unpack
  rig.ts      Animator: fixed 120 Hz step -> RigFrame (blink, breath, springs, moods)
  gl.ts       WebGL2 renderer: per-layer grid mesh + warp shader
  paint.ts    motion brush
  geom.ts     eye/mouth curve maths (mirrors the shader)
src/state/    zustand store with immer; undo history, actions
src/io/       import (PNG/PSD), project save/open/autosave, exporters
src/ui/       React UI; Stage.tsx owns the canvas and all direct manipulation
src/player/   standalone runtime, built to one IIFE and inlined into exported HTML
src/sample/   the built-in sample character, drawn with canvas paths
```

Two kinds of deformation are combined:

- **Mesh warp (CPU)** for broad motion. Every layer is a grid; painted masks give
  each vertex a weight per motion. Sway bends vertices around a root with a
  spring whose history is replayed along the length, so tips trail roots.
- **Texture remap (fragment shader)** for fine motion. Eyelids, gaze and mouth
  are computed per pixel in rest-pose space, so they stay crisp and ride along
  with the mesh.

An eyelid is not drawn. The lash line and a thin strip of skin above it are
slid down over the eye, and that strip stretches to fill the gap. The iris is
covered, never squashed, and the lid is made of the artist's own pixels.

Pixel data is immutable and referenced by id, which is what makes brush strokes
undoable: undo swaps a mask id back.

## Known limitations

- Flattened artwork is bent, not separated. Large head turns stretch the neck,
  and anything hidden behind something else cannot be revealed. The app says so
  in the Artwork panel. Layers remove these limits.
- The eyelid needs a fairly clean strip of skin above the lashes. An eyebrow or
  fringe sitting right on the lash line will be stretched into the lid.
- Eyes and mouths are placed by hand; there is no automatic face detection.
- The mouth is a simple open/smile warp with a flat inside colour: no teeth,
  tongue or phoneme shapes. For drawn mouth shapes, use per-mood layer swaps.
- Up to 4 eyes and 2 mouths per layer. Artwork is capped at 4096 px per side.
- GIF has 256 colours and 1-bit transparency. WebM is recorded in real time by
  the browser's own encoder; transparency was verified in Chromium only.
- PSD blend modes, clipping masks and layer effects are ignored.
- Not built yet: timeline-style keyframes, physics collisions, VTube-style
  webcam face tracking, mobile/touch layout.
- Frame rate was only measured under software rendering in a headless test
  browser. Script time per frame is small, but real-GPU performance on large
  PSDs has not been profiled.
