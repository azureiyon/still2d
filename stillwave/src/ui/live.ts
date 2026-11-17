// Things that live outside React: the animator, the microphone and the
// current canvas view. The stage's frame loop reads and writes these directly.
import { Animator } from '../engine/rig';
import { Voice } from '../engine/voice';
import type { Renderer, View } from '../engine/gl';

export const live = {
  anim: new Animator(Date.now() & 0xffff),
  voice: new Voice(),
  view: { zoom: 1, panX: 0, panY: 0 } as View,
  voiceLevel: 0,
  renderer: null as Renderer | null,
  /** Mesh edges the fold guard corrected in the last frame. */
  guarded: 0,
  /** Frames actually drawn (a still picture is not redrawn). */
  frames: 0,
  overlays: 0,
  /** Testing aid: hold every eye's lid at this height. */
  scrubAll: null as number | null,
};
