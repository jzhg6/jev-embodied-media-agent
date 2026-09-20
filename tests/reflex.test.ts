import { describe, expect, it } from "vitest";
import type { PerceptionState } from "../shared/types.js";
import { shouldPauseWithOpenPalmReflex } from "../src/reflex.js";

function state(overrides: Partial<PerceptionState> = {}): PerceptionState {
  return {
    timestamp: Date.now(),
    gesture: { name: "Open_Palm", confidence: 0.55, stableMs: 240 },
    gaze: {
      calibrated: false,
      topRightScore: 0,
      dwellMs: 0,
      armed: false,
      ready: false,
    },
    media: { hasSource: true, ready: true, paused: false, playbackRate: 1 },
    safety: {
      allowClose: false,
      closePolicy: "calibrated-continuous-dwell",
    },
    ...overrides,
  };
}

describe("Open Palm safety reflex", () => {
  it("pauses without waiting for a model when the gesture is stable", () => {
    expect(shouldPauseWithOpenPalmReflex(state())).toBe(true);
  });

  it("does not fire without a ready, currently playing video", () => {
    expect(
      shouldPauseWithOpenPalmReflex(
        state({ media: { hasSource: true, ready: true, paused: true, playbackRate: 1 } }),
      ),
    ).toBe(false);
  });
});
