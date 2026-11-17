# Stillwave tests

Browser tests drive the running app (`npm run dev`, port 5173) with Playwright's Chromium,
using real pointer and keyboard input. Run them from the `stillwave/` folder; output goes to `test-out/`.

| Script | What it checks |
| --- | --- |
| `node tests/workflow.cjs` | The whole workflow: opening a first-build project, PNG import, brush, clone and repair-layer retouching with undo/redo, eye shaping points, lid skin and Keep paint, sway styles and path points, hold-still, lifting, play, save and exact reopen, and all four exports. |
| `node tests/psd.cjs` | Layered PSD import: positions, opacity, hidden layers, groups. |
| `node tests/lids.cjs layers` / `flat` then `python3 tests/sheet.py layers` | Lid closure at 0/35/70/100% and every expression, as contact sheets. |
| `node tests/hair.cjs` | Renders one strong hair pose with each sway style, hold-still and lifting, and measures how much the strand's mesh stretches. |
| `node tests/precise.cjs` | Precise eye editing through the interface: conversion, node drag, smooth and Alt-broken tangents, arrow nudging and undo, adding and removing nodes, closure presets, crease follow, Simple/Precise round trip, mirroring, save and reopen. |
| `node tests/eye-fidelity.cjs` | Offscreen renders comparing a simple eye with its precise conversion at five closures, plus crease follow. |
| `node tests/fold.cjs` | Folded triangles at extreme poses with fold protection off and on, plus how much motion is kept and the cost per frame. |
| `STILLWAVE_REF_IMAGE=path node tests/real-illustration.cjs` | Blink on a real illustration, both skin modes, plus hand refinement with the Keep and clone brushes. |

`tests/fixtures/v1-project.stillwave` was saved by the first build and must keep opening.
