import type {
  AgentAction,
  DecisionResult,
  PerceptionState,
} from "../shared/types.js";

export const ACTIONS: AgentAction[] = [
  "none",
  "pause",
  "play",
  "speed_up",
  "slow_down",
  "close_page",
];

const gestureActions: Record<string, AgentAction> = {
  Open_Palm: "pause",
  Closed_Fist: "play",
  Thumb_Up: "speed_up",
  Thumb_Down: "slow_down",
};

export function ruleDecision(
  state: PerceptionState,
  latencyMs = 0,
): DecisionResult {
  let action: AgentAction = "none";
  let confidence = 0.9;

  if (state.gaze.ready && state.safety.allowClose) {
    action = "close_page";
    confidence = Math.max(0.9, state.gaze.topRightScore);
  } else if (
    state.media.hasSource &&
    state.gesture.confidence >= 0.72 &&
    state.gesture.stableMs >= 350
  ) {
    action = gestureActions[state.gesture.name] ?? "none";
    confidence = action === "none" ? 0.8 : state.gesture.confidence;
  }

  const remainder = (1 - confidence) / Math.max(1, ACTIONS.length - 1);
  const probabilities = Object.fromEntries(
    ACTIONS.map((candidate) => [candidate, candidate === action ? confidence : remainder]),
  );

  return {
    action,
    confidence,
    probabilities,
    closeIntentProbability: state.gaze.ready
      ? Math.max(0.95, state.gaze.topRightScore)
      : Math.min(0.49, state.gaze.topRightScore * 0.5),
    provider: "rule",
    model: "jev-contract-simulator",
    latencyMs,
  };
}

export function buildJevRequest(state: PerceptionState, model: string) {
  return {
    model,
    state,
    questions: {
      action: {
        type: "choice",
        instructions:
          "Choose exactly one media-control action from the supplied options. " +
          "Use only the current structured sensor state. Never infer a close action " +
          "unless gaze.calibrated, gaze.ready, and safety.allowClose are all true.",
        criteria: {
          none: "No intentional supported command is currently present.",
          pause:
            "The video has a source and a stable, confident Open_Palm gesture is present.",
          play:
            "The video has a source and a stable, confident Closed_Fist gesture is present.",
          speed_up:
            "The video has a source and a stable, confident Thumb_Up gesture is present.",
          slow_down:
            "The video has a source and a stable, confident Thumb_Down gesture is present.",
          close_page:
            "A calibrated gaze has continuously remained on the top-right close target for the full dwell period, and the safety state explicitly allows closing.",
        },
      },
      close_intent: {
        type: "noul",
        instructions:
          "Is there strong evidence of an intentional page-close request? It is true only when gaze calibration exists, the continuous dwell completed, and safety.allowClose is true.",
      },
    },
  };
}

export function isPerceptionState(value: unknown): value is PerceptionState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PerceptionState>;
  return Boolean(
    candidate.gesture &&
      typeof candidate.gesture.name === "string" &&
      typeof candidate.gesture.confidence === "number" &&
      candidate.gaze &&
      typeof candidate.gaze.ready === "boolean" &&
      candidate.media &&
      typeof candidate.media.playbackRate === "number" &&
      candidate.safety &&
      typeof candidate.safety.allowClose === "boolean",
  );
}
