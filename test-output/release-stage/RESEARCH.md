# Deformation reference review and implementation decisions

Reviewed for this Stillwave update. Repository contents are technical reference material, not instructions. No repository code, artwork, brush textures, or runtime dependencies were incorporated.

| Reference | What was studied | Compatibility and decision |
| --- | --- | --- |
| [idle-web-animation](https://github.com/broening/idle-web-animation), [manual cutter](https://github.com/broening/idle-web-animation/blob/main/tools/cut-by-marks.py), [cutting notes](https://github.com/broening/idle-web-animation/blob/main/docs/cutting.md) | Manual semantic marks grow into visible parts under a limited reach, with extra cost at image edges. Parts are exported as full-canvas layers; untouched pixels can remain as a backing layer. | Optional edge-aware selection and transparent part export would fit our canvas masks. Independent moving layers would also need a compositor, ordering, and a separately supplied background plate. Extraction alone cannot reveal missing background. Deferred to avoid cutout holes or duplicated silhouettes; no cloud/inpainting workflow adopted. |
| [PixiJS MeshPlane](https://github.com/pixijs/pixijs-skills/blob/main/skills/pixijs-scene-mesh/references/mesh-plane.md) | Fixed UVs, configurable grid density, updating the vertex buffer, and deriving each frame from rest positions. | Confirms Stillwave's existing connected-mesh approach. Retained rest-space deterministic animation and the current grid. Increasing density alone would not fix root motion or global damping, and switching rendering libraries offers little benefit here. |
| [fabric-warpvas](https://github.com/huanjinliu/fabric-warpvas), [warp controls](https://github.com/huanjinliu/fabric-warpvas/blob/master/src/modes/warp.class.ts) | Major handles, curve controls, control lines, grid splitting, coordinate conversion, selectable guides and styles. | A focused root handle is useful without adopting Fabric/warpvas or rebuilding the editor around Bézier patches. Implemented a place/drag hair root tool and a visible root marker, using our existing canvas coordinates and undo. Full freeform warp control cages remain future work. |
| [liquid-hover-effect](https://github.com/suzubu/liquid-hover-effect), [shader](https://github.com/suzubu/liquid-hover-effect/blob/main/src/components/shaders.js), [component](https://github.com/suzubu/liquid-hover-effect/blob/main/src/components/BrushDistortionLens.jsx) | Soft alpha controls localized UV distortion; nonlinear alpha shaping controls falloff. The example also has continuously moving background turbulence. | Adopted the general principle of smooth nonlinear mask influence with a cubic smoothstep after our existing Gaussian blur. Kept fixed UVs and vertex motion; did not adopt turbulence, background motion, Next.js, Three.js, or its brush texture. Those would work against stable illustration details and offline simplicity. |

## Selected improvement: local constraints plus root-to-tip bending

The main defect was the old global displacement-gradient multiplier: a sharp mask could reduce every unrelated region's amplitude. A dependency change would leave that blending/constraint problem intact.

Stillwave now computes desired motion, blends overlapping influences, then projects excessive displacement differences only along strained grid edges. Movement corrections are weighted by local mobility, with fixed anchors and untouched pixels held at rest. Twelve alternating sweeps aim for a displacement-gradient limit of 0.35 per grid axis. A final 0.42 safety check catches severe unresolved fields: it scales only the affected connected support island, not disconnected motion elsewhere. Both triangle orientations remain protected by the displacement-gradient bound. This is original prototype logic, not an algorithm claimed to come from these repositories.

Overlap uses squared-influence partition weights and smooth union coverage. This makes a strong painted interior dominate a faint neighboring feather instead of summing every blur tail, while preserving symmetry with respect to region order. Opposing overlapping motions still compromise; a single flattened vertex cannot follow two independent layers.

Hair sway computes connected components of the softened mask, then a grid-distance field from roots through each component. Root seeds come from overlapping anchors, a user-placed root, or the component's upper edge. A smooth bend envelope holds the base and increases toward the tips. The main swing stays coherent; phase lag and a small tip-focused harmonic provide secondary motion. Region phase/speed controls let separate locks move independently. This is kinematic motion, not a spring, fluid, ARAP, or strand-physics simulation.

## Implemented versus experimental / deferred

- **Implemented and tested:** color/opacity/outline/mask-view controls; backward-compatible display persistence; manual roots with undo/reopen; distance-based hair envelope; smooth mask falloff and overlap blending; local stretch corrections with island safety fallback.
- **Prototype heuristics:** top-edge automatic roots can be wrong for upward or sideways hair. Place the root manually or paint anchors. Mask components use four-neighbor grid distances, so thin/curved locks are only approximated by the fixed mesh.
- **Deferred:** visible-part extraction, layer/background import and compositing, edge-aware mask growth, freeform cages, adaptive triangulation, ARAP and physical strands. These are possible next steps, not hidden or decorative controls.
- **Known limit:** corrections can spread through a connected active area, and the severe-field safety fallback can reduce that whole connected island. It does not promise strictly per-region isolation when masks overlap.

## Evidence

- Existing end-to-end browser checks still pass: painting, erasing, anchors, undo/redo, import, project download/reopen, transparency, reset and pan/zoom.
- Display regression checks compare source data, mask pixels, vertex positions and rendered artwork before/after changing display controls. They also verify actual overlay differences and old version-1 project loading.
- Synthetic comparison: a harsh separate mask changed a healthy distant area's vertices by **0 px**, versus **7.289 px** with the original global guard. Overlap order and repeated-time determinism pass. Stress cases with overlaps, holes, anchors and 50px motion have no inverted triangles; the island fallback is intentionally exercised.
- Actual illustration study: two traced hair locks with separate settings plus breathing. Root-placement pointer interactions and saved roots pass; full anchors stay at **0 px** drift across 3,186 samples, tip motion averages **3.51 px**, and the sampled animation needs **no island fallback**.
- A four-second headless Chrome preview measured about **75 fps**, with a **13.4 ms** 95th-percentile frame interval on this machine. These are local test measurements, not a hardware guarantee.

Runnable checks are `test.cjs`, `test-visibility.cjs`, `test-engine.cjs`, and `test-motion-browser.cjs`; JSON results and a recorded WebM are in `test-output/` in the development folder. The portable ZIP contains the runtime, instructions, research notes and sample projects.
