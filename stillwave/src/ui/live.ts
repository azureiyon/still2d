// Things that live outside React: the animator, the microphone and the
// current canvas view. The stage's frame loop reads and writes these directly.
import { Animator } from '../engine/rig';
import { Voice } from '../engine/voice';
import type { View } from '../engine/gl';

export const live = {
  anim: new Animator(Date.now() & 0xffff),
  voice: new Voice(),
  view: { zoom: 1, panX: 0, panY: 0 } as View,
  voiceLevel: 0,
};
