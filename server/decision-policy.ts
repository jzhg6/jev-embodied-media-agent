import type {
  AgentAction,
  JevJudgment,
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

export const GESTURE_STABLE_MS = 220;

const gestureActions: Record<string, AgentAction> = {
  Open_Palm: "pause",
  Closed_Fist: "play",
  Thumb_Up: "speed_up",
  Thumb_Down: "slow_down",
};

export function ruleJudgment(
  state: PerceptionState,
  latencyMs = 0,
): JevJudgment {
  let candidateAction: AgentAction = "none";

  if (state.gaze.ready && state.safety.allowClose) {
    candidateAction = "close_page";
  } else if (
    state.gesture.confidence >= 0.55 &&
    state.gesture.stableMs >= GESTURE_STABLE_MS
  ) {
    candidateAction = gestureActions[state.gesture.name] ?? "none";
  }

  const candidateProbability =
    candidateAction === "close_page"
      ? Math.max(0.9, state.gaze.topRightScore)
      : candidateAction === "none"
        ? 0.88
        : Math.max(0.01, Math.min(0.99, state.gesture.confidence));
  const remainder = (1 - candidateProbability) / Math.max(1, ACTIONS.length - 1);
  const probabilities = Object.fromEntries(
    ACTIONS.map((candidate) => [
      candidate,
      candidate === candidateAction ? candidateProbability : remainder,
    ]),
  ) as Record<AgentAction, number>;

  const entropy = -Object.values(probabilities).reduce(
    (sum, probability) =>
      sum + (probability > 0 ? probability * Math.log(probability) : 0),
    0,
  );
  const confidence = Math.max(0, 1 - entropy / Math.log(ACTIONS.length));
  const stableFactor = Math.min(1, state.gesture.stableMs / GESTURE_STABLE_MS);
  const intentionalControlProbability =
    candidateAction === "close_page"
      ? 0.98
      : candidateAction === "none"
        ? 0.08
        : Math.min(0.99, state.gesture.confidence * stableFactor);
  const signalQualityScore =
    candidateAction === "close_page"
      ? Math.min(2, state.gaze.topRightScore * 2)
      : candidateAction === "none"
        ? 0
        : Math.min(2, Math.max(0, (state.gesture.confidence - 0.45) * 5));

  return {
    candidateAction,
    confidence,
    probabilities,
    intentionalControlProbability,
    signalQualityScore,
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
            "A stable, confident Open_Palm gesture requests that playback pause.",
          play:
            "A stable, confident Closed_Fist gesture requests that playback continue.",
          speed_up:
            "A stable, confident Thumb_Up gesture requests faster playback.",
          slow_down:
            "A stable, confident Thumb_Down gesture requests slower playback.",
          close_page:
            "A calibrated gaze has continuously remained on the top-right close target for the full dwell period, and the safety state explicitly allows closing.",
        },
      },
      close_intent: {
        type: "noul",
        instructions:
          "Is there strong evidence of an intentional page-close request? It is true only when gaze calibration exists, the continuous dwell completed, and safety.allowClose is true.",
      },
      intentional_control: {
        type: "noul",
        instructions:
          "Does the structured sensor state show a deliberate, stable command from the person, rather than a transient pose or ambiguous observation?",
      },
      signal_quality: {
        type: "score",
        instructions:
          "Rate whether the current sensor evidence is reliable enough for an embodied controller to act on immediately.",
        criteria: [
          "Unreliable: missing, unstable, or contradictory evidence",
          "Ambiguous: plausible evidence but meaningful uncertainty remains",
          "Reliable: stable, confident, and internally consistent evidence",
        ],
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
      typeof candidate.media.ready === "boolean" &&
      typeof candidate.media.playbackRate === "number" &&
      candidate.safety &&
      typeof candidate.safety.allowClose === "boolean",
  );
}
