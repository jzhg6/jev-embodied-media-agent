import type {
  AgentAction,
  DecisionCheck,
  DecisionResult,
  JevJudgment,
  PerceptionState,
} from "../shared/types.js";

const expectedGesture: Partial<Record<AgentAction, string>> = {
  pause: "Open_Palm",
  play: "Closed_Fist",
  speed_up: "Thumb_Up",
  slow_down: "Thumb_Down",
};

const probabilityThreshold: Record<AgentAction, number> = {
  none: 1,
  pause: 0.52,
  play: 0.52,
  speed_up: 0.65,
  slow_down: 0.65,
  close_page: 0.82,
};

function check(key: string, passed: boolean, detail: string): DecisionCheck {
  return { key, passed, detail };
}

export function filterJudgment(
  state: PerceptionState,
  judgment: JevJudgment,
): DecisionResult {
  const candidate = judgment.candidateAction;
  const actionProbability = judgment.probabilities[candidate] ?? 0;
  const checks: DecisionCheck[] = [];

  if (candidate === "none") {
    return {
      ...judgment,
      action: "none",
      accepted: false,
      filterReason: "System One 没有检测到明确的受支持意图",
      checks: [check("candidate", false, "候选动作是 none")],
    };
  }

  checks.push(
    check(
      "probability",
      actionProbability >= probabilityThreshold[candidate],
      `动作概率 ${(actionProbability * 100).toFixed(0)}% / 阈值 ${(probabilityThreshold[candidate] * 100).toFixed(0)}%`,
    ),
    check(
      "intent",
      judgment.intentionalControlProbability >= 0.5,
      `意图概率 ${(judgment.intentionalControlProbability * 100).toFixed(0)}% / 阈值 50%`,
    ),
    check(
      "quality",
      judgment.signalQualityScore >= 0.45,
      `信号质量 ${judgment.signalQualityScore.toFixed(2)} / 阈值 0.45`,
    ),
  );

  if (candidate === "close_page") {
    checks.push(
      check(
        "close-safety",
        state.gaze.calibrated && state.gaze.ready && state.safety.allowClose,
        "关闭必须通过双点校准、连续凝视和本地许可",
      ),
    );
  } else {
    checks.push(
      check("media-source", state.media.hasSource, "播放器必须已有视频源"),
      check("media-ready", state.media.ready, "视频元数据必须加载完成"),
      check(
        "gesture-contract",
        state.gesture.name === expectedGesture[candidate],
        `传感器手势 ${state.gesture.name} / 动作要求 ${expectedGesture[candidate] ?? "—"}`,
      ),
      check(
        "stable-dwell",
        state.gesture.stableMs >= 220,
        `稳定 ${Math.round(state.gesture.stableMs)} ms / 阈值 220 ms`,
      ),
    );

    if (candidate === "pause") {
      checks.push(check("not-noop", !state.media.paused, "视频当前应处于播放状态"));
    } else if (candidate === "play") {
      checks.push(check("not-noop", state.media.paused, "视频当前应处于暂停状态"));
    }
  }

  const failed = checks.find((item) => !item.passed);
  return {
    ...judgment,
    action: failed ? "none" : candidate,
    accepted: !failed,
    filterReason: failed ? failed.detail : "所有概率门槛与本地安全条件均通过",
    checks,
    guarded: Boolean(failed),
  };
}
