import { describe, expect, it } from "vitest";
import type { PerceptionState } from "../shared/types.js";
import { buildJevRequest, ruleDecision } from "../server/decision-policy.js";

function state(overrides: Partial<PerceptionState> = {}): PerceptionState {
  return {
    timestamp: Date.now(),
    gesture: { name: "None", confidence: 0, stableMs: 0 },
    gaze: {
      calibrated: true,
      topRightScore: 0,
      dwellMs: 0,
      armed: false,
      ready: false,
    },
    media: { hasSource: true, paused: false, playbackRate: 1 },
    safety: {
      allowClose: false,
      closePolicy: "calibrated-continuous-dwell",
    },
    ...overrides,
  };
}

describe("offline Jev-contract simulator", () => {
  it("maps a stable open palm to pause", () => {
    const result = ruleDecision(
      state({
        gesture: { name: "Open_Palm", confidence: 0.91, stableMs: 500 },
      }),
    );
    expect(result.action).toBe("pause");
  });

  it("does not act on an unstable gesture", () => {
    const result = ruleDecision(
      state({
        gesture: { name: "Thumb_Up", confidence: 0.95, stableMs: 100 },
      }),
    );
    expect(result.action).toBe("none");
  });

  it("requires both completed dwell and explicit close permission", () => {
    const gaze = {
      calibrated: true,
      topRightScore: 0.97,
      dwellMs: 3_200,
      armed: true,
      ready: true,
    };
    expect(ruleDecision(state({ gaze })).action).toBe("none");
    expect(
      ruleDecision(
        state({
          gaze,
          safety: {
            allowClose: true,
            closePolicy: "calibrated-continuous-dwell",
          },
        }),
      ).action,
    ).toBe("close_page");
  });

  it("describes every supported action to Jev", () => {
    const request = buildJevRequest(state(), "jev-latest");
    expect(Object.keys(request.questions.action.criteria)).toEqual([
      "none",
      "pause",
      "play",
      "speed_up",
      "slow_down",
      "close_page",
    ]);
  });
});
