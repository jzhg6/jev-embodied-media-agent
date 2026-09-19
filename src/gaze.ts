export const GAZE_FEATURE_NAMES = [
  "eyeLookUpLeft",
  "eyeLookUpRight",
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
] as const;

type GazeProfile = number[];

interface StoredProfiles {
  center?: GazeProfile;
  topRight?: GazeProfile;
}

const STORAGE_KEY = "jev-media-agent:gaze-calibration:v1";

function distance(a: number[], b: number[]) {
  return Math.sqrt(a.reduce((sum, value, index) => {
    const delta = value - (b[index] ?? 0);
    return sum + delta * delta;
  }, 0));
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return GAZE_FEATURE_NAMES.map(() => 0);
  return GAZE_FEATURE_NAMES.map((_, index) =>
    vectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0) /
    vectors.length,
  );
}

export class GazeCalibrator {
  private profiles: StoredProfiles = {};

  constructor() {
    try {
      this.profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredProfiles;
    } catch {
      this.profiles = {};
    }
  }

  get calibrated() {
    return Boolean(this.profiles.center && this.profiles.topRight);
  }

  save(target: "center" | "topRight", samples: number[][]) {
    if (samples.length < 3) throw new Error("校准样本不足，请保持面部可见后重试");
    this.profiles[target] = averageVectors(samples);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
  }

  evaluate(vector: number[]) {
    const { center, topRight } = this.profiles;
    if (!center || !topRight) return { calibrated: false, score: 0 };

    const separation = Math.max(0.08, distance(center, topRight));
    const targetDistance = distance(vector, topRight);
    const centerDistance = distance(vector, center);
    const proximity = 1 - targetDistance / separation;
    const preference = (centerDistance - targetDistance) / separation;
    return {
      calibrated: true,
      score: clamp(proximity * 0.65 + (preference + 1) * 0.175),
    };
  }
}
