import type { PerceptionState } from "../shared/types";

export const OPEN_PALM_REFLEX_CONFIDENCE = 0.54;
export const OPEN_PALM_REFLEX_STABLE_MS = 220;

export function shouldPauseWithOpenPalmReflex(state: PerceptionState) {
  return (
    state.gesture.name === "Open_Palm" &&
    state.gesture.confidence >= OPEN_PALM_REFLEX_CONFIDENCE &&
    state.gesture.stableMs >= OPEN_PALM_REFLEX_STABLE_MS &&
    state.media.hasSource &&
    state.media.ready &&
    !state.media.paused
  );
}
