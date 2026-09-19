import { describe, expect, it } from "vitest";
import type { PerceptionState } from "../shared/types.js";
import { filterJudgment } from "../server/decision-filter.js";
import { buildJevRequest, ruleJudgment } from "../server/decision-policy.js";

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
    media: { hasSource: true, ready: true, paused: false, playbackRate: 1 },
    safety: {
      allowClose: false,
      closePolicy: "calibrated-continuous-dwell",
    },
    ...overrides,
  };
}

describe("offline Jev-contract simulator", () => {
  it("maps a stable open palm to pause", () => {
    const current = state({
        gesture: { name: "Open_Palm", confidence: 0.91, stableMs: 500 },
      });
    const result = filterJudgment(current, ruleJudgment(current));
    expect(result.candidateAction).toBe("pause");
    expect(result.action).toBe("pause");
    expect(result.accepted).toBe(true);
  });

  it("does not act on an unstable gesture", () => {
    const current = state({
        gesture: { name: "Thumb_Up", confidence: 0.95, stableMs: 100 },
      });
    const result = filterJudgment(current, ruleJudgment(current));
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
    const disallowed = state({ gaze });
    expect(filterJudgment(disallowed, ruleJudgment(disallowed)).action).toBe("none");
    const allowed = state({
      gaze,
      safety: {
        allowClose: true,
        closePolicy: "calibrated-continuous-dwell",
      },
    });
    expect(
      filterJudgment(allowed, ruleJudgment(allowed)).action,
    ).toBe("close_page");
  });

  it("filters a pause no-op when the video is already paused", () => {
    const current = state({
      gesture: { name: "Open_Palm", confidence: 0.94, stableMs: 700 },
      media: { hasSource: true, ready: true, paused: true, playbackRate: 1 },
    });
    const result = filterJudgment(current, ruleJudgment(current));
    expect(result.candidateAction).toBe("pause");
    expect(result.action).toBe("none");
    expect(result.filterReason).toContain("播放状态");
  });

  it("describes every supported action and all three typed primitives to Jev", () => {
    const request = buildJevRequest(state(), "jev-latest");
    expect(Object.keys(request.questions.action.criteria)).toEqual([
      "none",
      "pause",
      "play",
      "speed_up",
      "slow_down",
      "close_page",
    ]);
    expect(request.questions.intentional_control.type).toBe("noul");
    expect(request.questions.signal_quality.type).toBe("score");
  });
});
