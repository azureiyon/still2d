# Manual one-eye blinking: current workflow

The repair/crease iteration is documented in [BLINK_REFINEMENT.md](BLINK_REFINEMENT.md), including both illustration styles. That guide supersedes the older repair/roll limitations below.

Double-click **Launch Stillwave.cmd**, then **Open project → blink-study.stillwave**. This sample contains the original open-eye illustration, traced curves, a manually refined lash selection and a chosen clean-skin donor. Use **Edit curves → Focus eye**, then **0%, 25%, 50%, 75%, 100%**. Uncheck **Curve guides** for an unobstructed preview. **Original** bypasses the blink; the **0%** button restores the unchanged open eye. Transport Reset resets motion time; manual closure remains at the chosen value.

## Setting up your illustration

1. Import PNG/JPG. **Place eye**: drag from left corner to right corner, following the eye's tilt. **Focus eye** zooms in.
2. At 0%, select **Upper lash line** and **Lower lid / landing** and trace the original aperture with the square curve handles. White circles move the corners. In **Upper lid → lower curve** mode, the upper lash lands on that lower curve at 100%. **Lower lid lift** defaults to 0% (stationary), with an optional rise of at most 15% of the original eye height. The closure slider drives upper-lid travel. Blue support curves define the working extent and constrain editing; they do not supply a broad boundary-color fill.
3. Choose **Paint lash selection / Erase lash selection** under **Eye editing**. Magenta shows which original pixels will move. Include individual lash tips; exclude hair, iris, skin and the upper crease. These modes return closure to 0% so painting always uses source coordinates. **Auto-select lashes again** discards manual selection and creates a fresh starting point. **Auto-selection reach** affects that automatic starting point; it does not widen a stored manual matte.
4. Choose **Pick clean skin rectangle** and drag over clear skin. The view fits the illustration so you can choose a donor away from the eye. Pick a patch with similar tone/texture, excluding hair, lines and iris. Switch back to **Curve handles**, focus the eye and preview closure again.
5. **Cleanup margin** removes remnants around the old lashes. Too little leaves a ghost; too much can damage nearby details. **Lash roll**, now under Advanced blink settings, controls texture foreshortening/fold. New eyes use 50% strength with a gentler response; old saved angle values remain intact. 0% disables the fold.
6. Check all five poses. Undo/redo supports curves, lash paint/erase, donor selection and settings. Save the project normally; masks, donor, roll, margin and curves reopen with the original image intact.

There is one manually controlled eye. No automatic blink timing, second eye or general artwork-painting tools have been added. Existing motion regions, anchors, colors and project behavior remain available.

New eyes and the updated sample use the upper-led model. Older eyes keep their authored motion: select **Lid motion → Upper lid → lower curve** to convert one. Switching back to **Legacy · shared seam** restores the original pink seam and two-boundary behavior; that curve is retained in the project. Mode and lift edits support undo and save/reopen. Pink dashed preview in upper-led mode shows the moving upper-lid position; the inactive legacy seam is hidden.

## Renderer

`eye-textures.js` prepares a source-space RGBA lash patch and clean face patch. Actual selected source pixels are separated from their estimated skin background, including antialiased tips. The clean face replaces only the original aperture and a feathered dilation of the selected lashes. Nearby crease, brow, shading and hair remain original wherever they are outside that repair footprint.

Skin comes from a chosen source crop, mirrored at native texel scale rather than stretched across the whole eye. Bounded color correction diffuses across the repair, retaining donor texture while limiting dark contamination from hair boundaries. This is cloned texture, not recovered hidden artwork.

`blink.js` clips the original stationary iris as the upper lid travels down to the lower curve, transports the actual lash patch using source/destination curve tangent frames, and composites it over the clean face. At zero lower lift, the lower rim uses original artwork even where skin-repair feathering extends past it; moving upper lashes can still overlap it naturally. Lash roll is a normal foreshortening/fold heuristic, eased later into closure. It remains experimental near the edge-on pose. No averaged-color synthetic lash stroke remains. The compositor feeds the existing connected mesh, so the blink follows body/hair deformation.

At 0%, no eye, or a disabled eye, the compositor returns the original GPU texture directly. It never writes into the source texture or embedded artwork. The CPU patch is cached across closure changes, capped at 1024 pixels on its longest side. Skin donor reads are cropped rather than duplicating the full source image. The regular animation renderer is retained.

## Compatibility and validation

Project version stays 1. Optional `eyes[0].lashMatte` contains a bounded raster-alpha record in original pixel coordinates; `skinDonor`, `lashRoll`, `repairMargin`, `lidMotion` and `lowerLidLift` are additive. Old eyes without `lidMotion` retain shared-seam motion; new eyes explicitly store `upper-led`. Lift is normalized 0–0.15, not a percentage integer. Existing projects without eyes still load. New fields are checked before replacing the open project. Use this updated build for refined eyes; older builds may ignore the new fields and render with their previous algorithm.

See [BLINK_QUALITY.md](BLINK_QUALITY.md) for the five rendered poses, recording comparison, checks and remaining visual issues. The initial proposal remains in [BLINK_IMPLEMENTATION_PLAN.md](BLINK_IMPLEMENTATION_PLAN.md); its quality gates are not all satisfied. The optional artwork layer design is in [LAYER_ARCHITECTURE.md](LAYER_ARCHITECTURE.md).
