# Connected studio pass — architecture and checkpoint

Checkpoint: `_checkpoints/2026-11-10-pre-studio-v1.zip`, with SHA-256 manifest. It contains the previous runtime, projects, docs and regression checks. Recover by extracting into a separate folder; do not overwrite your current projects blindly.

## Existing architecture reviewed

`app.js` owns document state, source-coordinate painting, history and version-1 JSON. `engine.js` owns a shared connected mesh with immutable UVs, mask blending, anchors and local strain constraints. `blink.js` renders two independent source-derived eye patches and combines them before the shared mesh. `eye-textures.js` prepares lash/skin/mask rasters. `eye-editor.js` edits the selected eye. The original embedded image and GPU texture are immutable.

Current constraints explain several issues: old curves use one cubic plus a fixed-x bulge; the shader requires y(x). Eye painting is forced to open/full closure. The “Blink edit area” is a final modifier footprint, not a skin-generation mask. Flat hair shares facial/background vertices. Existing repairs are eye-local, and history must include any new raster/document assets.

## Internal order

1. Optional monotone-x cubic chains, independent crease endpoints, node add/remove, lookup sampling and legacy fallback. Geometry copy/mirror uses an explicit centerline; painting is copied only by explicit choice.
2. Retained closure preview and source-space brush mapping, shared brush controls, contextual UI and one-setting slider resets.
3. A focused document repair surface, clone stamp and source-image patch transforms; reversible snapshots and bounded assets.
4. Color flood/lasso/manual-role selection and region isolation. No semantic subject/hair claims.
5. Optional extracted region mattes and holdouts, underpainting, stacking and thickness-preserving pivot/path deformation. Existing flat masks and root tool remain valid. Independent locks inherit the base mesh's root frame; arbitrary lock hierarchies are deferred if they complicate reliable ownership.
6. Legacy/new round trips, undo, reset, source alignment and actual cel/detailed visual studies. Document complete versus experimental results after testing.

## Integration contract

- The loader accepts version 1 and version 2. Documents using paths, cutouts or backing repairs save as version 2 so old builds reject them instead of silently dropping new artwork. Documents without these additions retain version 1. Load missing fields as the previous behavior. Validate all new geometry, paths, masks and transforms before replacing a document. Never silently discard known old settings.
- Separate visual matte, motion weight, anchor and artwork protection roles. Share painting infrastructure and explicit copy/combine actions, not implicit linked masks.
- New optional artwork preparation is cached; the no-extraction/no-document-repair case retains the current rendering path.
- Extracted hair is source texture, not generated content. Hidden pixels require artist repair. Default hard cut prioritizes exact rest reconstruction; feathered edges require a clean backing and remain a quality-sensitive option.
- Preserve source artwork, eye closure 0%, both-eye controls and current mask visibility. Keep advanced operations contextual rather than opening every control at once.

## Reference decisions

[Live2D material preparation](https://docs.live2d.com/en/cubism-editor-tutorials/psd/) emphasizes separating moving parts and painting concealed areas. Stillwave will offer optional cutouts and a backing repair surface, without PSD or a mandatory separated-art workflow.

[Deform paths](https://docs.live2d.com/en/cubism-editor-manual/deformpath/) motivates editable root-to-tip controls and influence visualization. [Skinning](https://docs.live2d.com/en/cubism-editor-manual/skinning/) motivates rotationally coherent motion along long thin parts. Stillwave will use a small original path-transport model and a rigid Swing mode, not Cubism's deformer/parameter architecture or code.
