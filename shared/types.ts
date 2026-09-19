export type GestureName =
  | "None"
  | "Open_Palm"
  | "Closed_Fist"
  | "Thumb_Up"
  | "Thumb_Down"
  | string;

export type AgentAction =
  | "none"
  | "pause"
  | "play"
  | "speed_up"
  | "slow_down"
  | "close_page";

export interface PerceptionState {
  timestamp: number;
  gesture: {
    name: GestureName;
    confidence: number;
    stableMs: number;
  };
  gaze: {
    calibrated: boolean;
    topRightScore: number;
    dwellMs: number;
    armed: boolean;
    ready: boolean;
  };
  media: {
    hasSource: boolean;
    paused: boolean;
    playbackRate: number;
  };
  safety: {
    allowClose: boolean;
    closePolicy: "calibrated-continuous-dwell";
  };
}

export interface DecisionResult {
  action: AgentAction;
  confidence: number;
  probabilities: Partial<Record<AgentAction, number>>;
  closeIntentProbability: number;
  provider: "jev" | "rule";
  model: string;
  latencyMs: number;
  guarded?: boolean;
}
