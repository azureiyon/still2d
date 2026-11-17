# OBS reference study and next-feature plan: editable blinking

Current implementation status: two independently authored eyes, shared timing and improved crease follow are implemented; see [BLINK_TWO_EYES.md](BLINK_TWO_EYES.md). The original proposal and historical analysis below are retained; their deferred-feature wording is not the current feature list.

This records the original analysis and proposal; Stillwave's application files were unchanged during that study. The first manual one-eye milestone and a subsequent texture-quality pass are implemented; see [BLINK_MILESTONE.md](BLINK_MILESTONE.md) for the current workflow and [BLINK_QUALITY.md](BLINK_QUALITY.md) for actual results and remaining defects. The multi-style quality gates below remain open; automatic timing has not been started. No PrettyUp algorithm is identified or claimed to have been reverse engineered.

## Inspection and evidence

Source: user-provided `C:/Users/ruian/Videos/2026-11-09 14-03-20.mp4`. Local decoding reports **761.4 seconds (12:41.4), 1920 × 1080**. The mirrored portrait app occupies approximately x=680–1240 of the OBS frame.

The study sampled the interface throughout all five requested ranges, added closer sampling around blink controls, and inspected ten short frame sequences covering blinking, the six motion presets, camera/body motion and effects. The blink sequence samples 24 frames over 1:54.40–1:56.80. This is representative sampling, not a claim that every frame or every interaction was inspected. Decoding and evidence extraction used the local browser; no upload or cloud processing occurred.

Evidence is under `reference-study/obs-2026-11-09/`:

- `metadata.json`: decoded duration and dimensions.
- `frame-00025.png`, `frame-00060.png`, `frame-00085.png`: editable eye guides at different configurations.
- `blink-control-values.png`: timing controls, including the **0.0s** tooltip for Eye Closed at 2:04.
- `blink-evidence.png`: observed open, closing and closed eye frames at approximately 1:54.92, 1:55.03 and 1:55.13.
- `motion-blink.png`: the full sampled closing/reopening sequence, including a second blink.
- `frame-00180.png`, `frame-00240.png`, `frame-00440.png`: masks on side hair and bangs.
- `frame-00310.png`–`frame-00410.png`: preset controls and selection states.
- `frame-00540.png`, `frame-00560.png`: three region entries and selected-region settings.
- `frame-00580.png`, `frame-00620.png`, `frame-00660.png`, `frame-00750.png`: camera, body selection, body deformation and effects panels.
- `motion-*.png`: timestamped short motion contact sheets. Names indicate the selected preset sampled, not a recovered internal implementation.

## What is directly demonstrated

| Recording evidence | Observable behavior | Boundary of the observation |
| --- | --- | --- |
| About 0:25–1:30 | Dashed eye-area curves and green draggable points; the guide shape changes while editing at high zoom. Both eyes have guides in the wider view. | The exact curve representation and the purpose of every surrounding guide are not exposed. Inner/outer guides suggest a support area but do not prove its deformation model. |
| About 1:40–2:10 | Speed, Interval and Eye Closed sliders; animated closing and reopening of both eyes. Eye Closed displays seconds at 2:04. | A closed-hold duration is the likely meaning of Eye Closed. Do not treat it as a proven closure-depth control. The exact timing law is unknown. |
| 1:54.40–1:56.80 sequence | The aperture narrows, the iris becomes hidden at closure, a lash-shaped line remains, then the eyes reopen. At this viewing scale the rest of the face stays substantially similar. | This does not establish whether PrettyUp uses texture warping, meshes, a composite, reconstruction, or preprocessed layers. |
| About 2:30–4:00 | Purple selection paint on left and right hair locks, brush/eraser-style controls and brush-size adjustment. Paint-area options include Full, Hair, Figure, Exclude Hair and Exclude Figure. | The labels do not establish how those semantic selections are calculated or whether any processing is local. |
| About 4:30–6:50 | Flutter 1, Flutter 2, Swing, Nod 1, Nod 2 and Squash choices; different panels expose direction, speed/range, rotation, twist, stretch, nod and squash parameters. | Their names are not a mathematical specification. Some screenshots show a control being changed, so those moments are not controlled comparisons of one variable. |
| About 7:10–9:20 | Additional masks on bangs and the decorative toast ring; a sidebar containing Layer1, Layer2 and Layer3; selected-region parameter editing and combined playback. | A UI entry called Layer does not prove that a separate RGBA image was extracted or that hidden background pixels were reconstructed. |
| About 9:40 onward | Camera Shake has vertical/horizontal/circular/static choices and speed, range, zoom and sharpening controls. Body Shake has its own painted area and deformation presets. | A global camera transform and a body-local warp are plausible independent implementations for Stillwave, not identified PrettyUp code paths. |
| About 12:00–12:30 | Effect presets and moving decorative overlays; speed and transparency controls. | These are compositing behaviors, separate from evidence about hair or eyelid deformation. |

## What Stillwave can already reproduce

**Existing implementation:** painted and erased masks; brush sizing/hardness; zoom/pan; multiple independently configured regions; region colors and opacity/outlines; periodic localized motion; held hair roots and delayed tips; breathing, bounce and oscillation; preview/pause/reset; undo/redo; saving and reopening.

**Partial visual overlap, not equivalent presets:** our hair sway can approximate gentle flutter/swing, oscillation can approximate directional back-and-forth motion, and breathing provides limited expansion. We do not have the demonstrated separate rotation/twist/stretch channels, dedicated nod modes or axis-controlled squash presets. Renaming the current presets would not implement them.

**Absent:** editable eyelid curves, true blink occlusion and blink timing, semantic Hair/Figure selection, a separate animated camera channel, body-specific motion controls and an effects compositor. A broad painted region can move a body area today, but that is not the same as the demonstrated Body Shake system.

## Deformation improvements worth considering after blinking

1. **Curve-guided local patches.** Eyelashes need sampling along their shape. A small dense eye patch is more appropriate than increasing the entire 144-cell lattice. This is consistent with Live2D's recommendation to use meshes tailored to facial details: [manual mesh editing](https://docs.live2d.com/en/cubism-editor-manual/mesh-edit-manual/).
2. **Separate motion channels.** Represent translation, local rotation about a root, longitudinal stretch and transverse bend separately. Flutter can then be a coherent bend plus small tip lag; swing a root-pivot arc; nod a controlled directional bend; squash a bounded local scale. These are proposed original definitions, not claims of matching PrettyUp's formulas.
3. **Better hair coordinates.** Extend the current root-distance envelope with an optional root-to-tip guide spline. Bend along the lock with approximately preserved longitudinal length, instead of treating travel distance alone as strand geometry. This should reduce rubbery widening and sideways collapse. A centerline is a better next step than adding more unrelated sine waves.
4. **Clear ownership in overlaps.** Keep the current order-independent soft blending for ordinary regions. Give facial features explicit support boundaries and parent motion, so a blink is not averaged away by a hair mask. Longer term, distinguish attached rigid accessories from flexible cloth/hair; a single soft average cannot satisfy incompatible motions in one pixel.
5. **Keep the local guard.** The current guard and connected-island fallback are useful for ordinary motion. More advanced local rotation-preserving or ARAP-like corrections should follow measured failures, rather than replacing the working engine preemptively.
6. **Separate final camera motion.** Implement camera shake as a final view transform, including image-edge/crop handling, rather than another deformation field. Defer particles and cosmetic effects until blinking is convincing.

## Recommended blink architecture

**Add an eye-specific image-space compositor before the existing textured mesh.** Keep painting, body/hair masks and the regular mesh intact. The pipeline becomes:

`immutable original texture → curve-driven blink patches → existing connected mesh → optional future camera/effects`

The eye patch is defined in original image coordinates, so the existing mesh carries the completed blink along with the face. It does not become a screen-space sticker that slips when the body moves. Curve editing begins in the original pose, following the editor's existing pause-for-edit behavior.

### Why the current motion guard should not perform eye closure

The current guard limits displacement differences to protect triangles. Bringing the upper and lower eye boundaries all the way together requires a locally singular compression if modeled as one continuously textured eye mesh. The guard would weaken that movement; removing it would invite degenerate geometry and a compressed stripe of iris/eye-white pixels. Full closure should use **occlusion and texture resampling**, with an explicit closed state, rather than forcing the whole image mesh to collapse.

Live2D's separated-art workflow likewise distinguishes shaping the lashes from hiding the iris with clipping. That supports the design principle, not an assertion that its implementation transfers directly to a flattened image: [facial expressions tutorial](https://docs.live2d.com/4.2/en/cubism-editor-tutorials/expression/).

### Eye definition and editing

For each eye, store shared inner/outer corners, an open upper-lid curve **U**, an open lower-lid curve **L**, and a closed seam **C**. Add upper/lower outer support curves **A/B** marking where skin movement returns to the untouched face. These are our proposed controls; do not label the guides in the recording as this exact model.

Use a small number of cubic Bézier segments in an eye-local coordinate system aligned with its corners. Shared endpoints prevent corners separating. Handle constraints and a sampled validity check prevent self-intersections, reversed support bands or upper/lower curves crossing prematurely. Tilted/asymmetric eyes get independent curves; mirroring is optional assistance, not forced symmetry.

At closure amount **c** from 0 to 1, the moving boundaries are:

`U_c = (1 − c) U + c C`

`L_c = (1 − c) L + c C`

This makes both curves meet at the authored closed line. The closed curve determines how much each lid travels; an explicit upper/lower bias can be added later if needed.

### Rendering a closed eye from a flattened source, without AI

1. **Keep the eye interior stable and clip it.** Sample the original eye where it is still visible through the shrinking aperture between U_c and L_c. Occlude the iris instead of shrinking the whole pupil vertically.
2. **Cover the disappearing aperture with nearby skin.** Inverse-map the source skin band A–U into A–U_c, and the source skin band L–B into L_c–B. The outer boundaries stay fixed. This stretches/reuses existing skin pixels; it does not discover genuine hidden eyelid artwork.
3. **Preserve the lash line separately.** Transport a narrow source ribbon following the upper lashes to U_c, keeping its thickness controlled. Allow a small manual lash mask where a simple ribbon includes too much eye color or skin. Remove its original-position duplicate inside the replacement patch.
4. **Handle full closure explicitly.** When the aperture is below a subpixel threshold, render no eye interior. Meet the skin bands at C and render the transported closed lash line. Do not divide by a zero-height aperture or leave a colored iris sliver.
5. **Blend only at the outer support boundary.** Feather the patch into the unchanged face at A/B and the eye corners. Do not blur the iris into skin at the closing edge. Preserve premultiplied alpha for transparent illustrations.
6. **Protect overlaps.** An optional protection mask keeps hair strands, brows and other occluders out of skin donor bands and blink replacement. Strong hair crossing an eye may require manual masking. This first version will not reconstruct the hidden part of the eye.

Implement the prepass in WebGL using an offscreen color texture/framebuffer, sampling the immutable source into the eye rectangles. Never sample from the texture currently attached as the render target. Keep curve lookup and clipping at pixel resolution; a modest local tessellation or lookup table can map curve coordinates. Reuse the existing main mesh shader with the composed texture bound as its image input. Avoid CPU readbacks or re-uploading the full artwork every frame.

At c=0, bypass the patch and use the original source texture exactly. Copy/restore original eye rectangles before updating an active patch to prevent trails. Keep the source texture and project source image immutable.

### Honest limitations and a manual fallback

No non-AI method can recover a truly hidden eyelid's painted detail from an open-eye image alone. Adjacent-skin resampling can work well for relatively clean illustrations; it can stretch heavy makeup, complex shading or unusual lash shapes. Provide editable support bands and, after the first version works, a local clone/touch-up tool or optional user-painted closed-eye PNG. The optional asset would improve difficult eyes, not become a requirement for importing ordinary images.

### Timing controls

- **Blink duration / speed:** controls closing and opening transition times, with clear units.
- **Interval:** time from one blink's onset to the next, constrained to exceed its total duration.
- **Closed hold:** explicit dwell time at full closure, separate from closure amount. This is the proposed counterpart to the seconds-valued Eye Closed control.
- **Closure preview:** manual 0–100% slider, separate from automatic playback. This is essential for checking a curve at half and full closure.
- **Linked eyes:** share a timer by default, with independent shape definitions. Separate enable/offset controls can later permit winks or small asymmetry.

A deterministic close–hold–open envelope with eased transitions should be the first implementation. Reasonable initial authored values to test are roughly 80 ms closing, 30 ms hold and 140 ms reopening, with a multi-second interval. These are starting settings for Stillwave, not inferred PrettyUp values or a medical statement about blinking. Add seeded interval variation only after the deterministic version is reliable. Keep manual preview and reset reproducible.

## Implementation order and completion gates

1. **One-eye manual prototype.** Add an eye definition and draggable corners/curves, with closure preview and undo. Implement the patch rendering on one real illustration. Completion: a visible, convincing 0%, 50% and 100% closure; no ghost iris or doubled lashes. No autoplay needed yet.
2. **Quality at closure.** Tune skin-band mapping, corner falloff, lash transport and the explicit closed branch. Exercise a tilted eye, a heavily outlined eye and a hair-overlapped eye. Completion: fixed outer support, no visible rectangular seam, no brow collapse, no zero-area numerical failure.
3. **Two eyes and timing.** Add shared timing, independent shapes, speed/duration, interval and closed-hold controls, play/pause/reset and one-shot blink preview. Completion: both eyes blink coherently and survive body/hair animation without sliding.
4. **Project integration.** Save optional eye definitions, support/protection masks, timing and any manual patch assets. Older version-1 files with no eye data load as an empty eye list. Validate new fields before replacing current state; extend history for curve drags as one undo operation. Do not silently discard future blink data in older builds.
5. **Regression and performance gate.** Run current tests plus eye-open pixel equality, fully hidden iris at closure, unchanged pixels outside support, curve validity checks, transparency, save/reopen, zoom/pan editing and combined motion. On the actual illustration, verify playback remains close to the existing baseline without making a hardware-independent FPS promise.

The next major feature should stop at usable two-eye curve-based blinking with project persistence. Camera shake, extra motion names, particles, automatic segmentation and broad architecture changes are later work.
