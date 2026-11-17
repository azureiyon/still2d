# Optional visual layers — proposal, not implemented

## Direction

Keep the default workflow: import a flattened PNG/JPG, paint motion regions, animate. Advanced artwork preparation opens only when requested. Layers should raise the quality ceiling without becoming required setup. Retain the current WebGL renderer, motion solver and immutable original; add composition around them incrementally.

## One document, distinct jobs

| Item | Meaning | Interaction |
| --- | --- | --- |
| Visual layer | Actual RGBA artwork with order, visibility and opacity | Owns a source-space texture and optional mesh; can contain several motion regions. Imported flat artwork begins as one layer. |
| Visibility mask | Which pixels of a visual layer are shown | Extraction hides copied pixels here, without deleting them from the original. It does not control motion. |
| Motion region | Weighted procedural movement on one visual layer | Existing presets/settings and overlap solver; explicitly targets a layer. Several regions can influence the same mesh. |
| Anchors | Suppress movement of vertices on that layer | Keep current stationary-root behavior; legacy global anchors target the implicit base layer. |
| Edit protection | Prevent source-space repair/painting over selected pixels | Protects hair/crease during repair. It does not pin animation. Show it only while editing artwork; do not add a second motion-lock tool. |
| Underpainting | Ordinary paint layer behind an extracted part | Holds manually repaired background/skin. It is a role/preset for a visual layer, not another compositing system. |

All masks can share raster storage, brush infrastructure, source coordinates, undo transactions and color/opacity display controls. Their **roles remain explicit**. Offer “Copy selection to…” to initialize another mask, rather than linking visibility and movement implicitly. Blink's lash matte is local feature isolation, not a general motion mask; its donor/repair data stays attached to the eye modifier.

## Extraction and repair

“Extract selection” creates a transparent layer from selected source pixels and a complementary hide mask on the source layer, as one undoable transaction. Keep original asset bytes and the extraction mask. A no-motion composition must match the original before enabling movement. Feathered edges require careful foreground/background unmatting; naively stacking two partially transparent copies causes fringes or double edges.

Offer an empty **Repair underneath** layer immediately below the extracted part. Brush, eraser, clone and bucket operate through one raster-paint target selector. Clone samples a named source layer or visible source-space composite; bucket fills a contiguous area with explicit tolerance. Eraser changes repair-layer alpha, never original bytes. Show the extracted part temporarily hidden while repairing. Missing background is genuinely unknown; no automatic reconstruction is promised. Optional source-clone assistance can reuse the blink donor idea.

## Rendering integration

For each visible layer, build a cached source texture from its immutable asset plus repair paint, visibility mask and local modifiers (including blink). Then deform that layer's mesh with its targeted motion regions and anchors. Composite premultiplied RGBA back to front; apply shared camera/view last. Keep overlays separate from artwork and eventual export.

The basic one-layer case uses today's path without extra passes. Extracted parts get independent meshes, avoiding contradictory displacement demands on a shared flattened vertex. Within a layer, retain existing overlap blending and local strain constraints. Layers determine occlusion; protection does not. Repairs attached to a moving part share its source space/deformation; stationary background repairs live below it on the base/background layer. Rebuild only dirty tiles/textures and use bounded GPU caches before increasing supported document sizes.

## Project format and compatibility

**Current pass:** version 1 remains unchanged except additive eye-correction fields. No speculative layer fields are written.

**When layers ship:** introduce version 2 with an asset table, stable layer IDs/order, RGBA paint assets, typed mask assets, and explicit layer IDs on motion regions, anchors and eye modifiers. Store all geometry and clone coordinates in the owning layer's source pixels; store placement separately. Use content-addressed assets or a local archive to avoid repeating original images in undo/project data. Save through the chosen local-file/download path and validate asset bounds, sizes and references before replacing a document.

A version-1 loader synthesizes one base layer holding the existing source, regions, anchors and eye. Saving migration must preserve all those fields and rest-pose appearance. Keep the original source asset permanently. Older builds must reject version 2 rather than silently flattening or dropping edits. An explicitly named flattened-image export can serve interchange; it is not an editable backward-compatible project.

## Small implementation steps

1. Internal single-layer adapter with unchanged UI/output; round-trip every legacy fixture and pixel-compare rest poses.
2. Optional layer panel with import/order/visibility and independent meshes; test transparent edges and overlapping movement.
3. Non-destructive extraction plus an empty underpaint layer; verify exact reconstruction at rest and undo.
4. Shared repair brush/eraser, then clone and bucket. Add edit protection and tiled history only as these tools need them.

Automatic isolation, new motion presets, curve timelines and animation export stay in the backlog. Blink quality on multiple eye styles comes before any of these implementation steps.
