import "./style.css";
import type {
  AgentAction,
  DecisionResult,
  PerceptionState,
} from "../shared/types";
import { GazeCalibrator } from "./gaze";
import { MediaController } from "./media-controller";
import { VisionRuntime, type VisionObservation } from "./vision";

const get = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const media = get<HTMLVideoElement>("media");
const camera = get<HTMLVideoElement>("camera");
const videoFile = get<HTMLInputElement>("video-file");
const emptyState = get("empty-state");
const startCamera = get<HTMLButtonElement>("start-camera");
const calibrateCenter = get<HTMLButtonElement>("calibrate-center");
const calibrateClose = get<HTMLButtonElement>("calibrate-close");
const calibrationStatus = get("calibration-status");
const visionStatus = get("vision-status");
const cameraLabel = get("camera-label");
const gestureState = get("gesture-state");
const gestureConfidence = get("gesture-confidence");
const gazeScore = get("gaze-score");
const gazeMeterFill = get("gaze-meter-fill");
const gazeProgress = get("gaze-progress");
const gazeLabel = get("gaze-label");
const gazeTarget = get<HTMLButtonElement>("gaze-target");
const playState = get("play-state");
const rateState = get("rate-state");
const decisionAction = get("decision-action");
const decisionConfidence = get("decision-confidence");
const decisionMeta = get("decision-meta");
const confidenceBar = get("confidence-bar");
const providerLabel = get("provider-label");
const providerPill = get("provider-pill");
const providerDot = get("provider-dot");
const actionToast = get("action-toast");
const eventLog = get<HTMLOListElement>("event-log");
const clearLog = get<HTMLButtonElement>("clear-log");
const closedScreen = get("closed-screen");
const reopenSession = get<HTMLButtonElement>("reopen-session");

const calibrator = new GazeCalibrator();
let vision: VisionRuntime | undefined;
let latestObservation: VisionObservation | undefined;
let gazeStartedAt: number | undefined;
let closeRequested = false;
let lastCloseDecisionAt = -Infinity;
let latchedGesture = "None";
let decisionPending = false;
let toastTimer = 0;
let videoObjectUrl: string | undefined;
let calibrationCapture:
  | {
      target: "center" | "topRight";
      samples: number[][];
      endsAt: number;
    }
  | undefined;

const CLOSE_ARM_MS = 1_500;
const CLOSE_READY_MS = 3_000;
const GAZE_THRESHOLD = 0.62;

const controller = new MediaController(media, () => {
  closeRequested = true;
  void vision?.stop();
  try {
    window.close();
  } finally {
    window.setTimeout(() => {
      get("app").setAttribute("hidden", "");
      closedScreen.removeAttribute("hidden");
    }, 120);
  }
});

function logEvent(message: string) {
  if (eventLog.children.length === 1 && eventLog.textContent?.includes("等待启动")) {
    eventLog.replaceChildren();
  }
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const text = document.createElement("span");
  text.textContent = message;
  item.append(time, text);
  eventLog.prepend(item);
  while (eventLog.children.length > 7) eventLog.lastElementChild?.remove();
}

function showToast(message: string) {
  actionToast.textContent = message;
  actionToast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => actionToast.classList.remove("visible"), 1_700);
}

function updateMediaReadout() {
  playState.textContent = !media.src
    ? "等待视频"
    : media.paused
      ? "已暂停"
      : "播放中";
  rateState.textContent = `${media.playbackRate.toFixed(2)}×`;
}

function perceptionState(observation: VisionObservation, dwellMs: number, score: number): PerceptionState {
  const calibrated = calibrator.calibrated;
  const ready = calibrated && dwellMs >= CLOSE_READY_MS;
  return {
    timestamp: Date.now(),
    gesture: observation.gesture,
    gaze: {
      calibrated,
      topRightScore: score,
      dwellMs,
      armed: calibrated && dwellMs >= CLOSE_ARM_MS,
      ready,
    },
    media: {
      hasSource: Boolean(media.src),
      paused: media.paused,
      playbackRate: media.playbackRate,
    },
    safety: {
      allowClose: ready,
      closePolicy: "calibrated-continuous-dwell",
    },
  };
}

async function requestDecision(state: PerceptionState) {
  if (decisionPending || closeRequested) return;
  decisionPending = true;
  try {
    const response = await fetch("/api/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    const body = (await response.json()) as DecisionResult & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "决策服务请求失败");
    renderDecision(body);

    // The browser repeats the irreversible-action guard even though the server
    // already applies it. A remote model can never bypass the local contract.
    if (body.action === "close_page" && !state.safety.allowClose) {
      logEvent("本地安全层拦截了未完成凝视的关闭动作");
      return;
    }

    if (body.action !== "none") {
      const message = await controller.apply(body.action);
      showToast(message);
      logEvent(`${body.action.toUpperCase()} · ${Math.round(body.confidence * 100)}%`);
      updateMediaReadout();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "决策失败";
    logEvent(message);
    providerDot.classList.add("error");
  } finally {
    decisionPending = false;
  }
}

function renderDecision(decision: DecisionResult) {
  decisionAction.textContent = decision.action.toUpperCase();
  decisionConfidence.textContent = `${Math.round(decision.confidence * 100)}%`;
  confidenceBar.style.width = `${Math.round(decision.confidence * 100)}%`;
  decisionMeta.textContent = `${decision.model} · ${decision.latencyMs} ms${decision.guarded ? " · guarded" : ""}`;
  providerPill.textContent = decision.provider === "jev" ? "LIVE JEV" : "LOCAL CONTRACT";
}

function beginCalibration(target: "center" | "topRight") {
  calibrationCapture = {
    target,
    samples: [],
    endsAt: performance.now() + 1_600,
  };
  calibrationStatus.textContent = target === "center" ? "请凝视视频中心…" : "请凝视右上角 × …";
  logEvent(target === "center" ? "开始中心凝视校准" : "开始右上角凝视校准");
}

function finishCalibration() {
  const capture = calibrationCapture;
  calibrationCapture = undefined;
  if (!capture) return;
  try {
    calibrator.save(capture.target, capture.samples);
    calibrationStatus.textContent = calibrator.calibrated ? "校准完成" : "还需另一校准点";
    logEvent(capture.target === "center" ? "中心校准完成" : "右上角校准完成");
  } catch (error) {
    calibrationStatus.textContent = "校准失败";
    logEvent(error instanceof Error ? error.message : "校准失败");
  }
}

function onVisionObservation(observation: VisionObservation) {
  latestObservation = observation;
  gestureState.textContent = observation.gesture.name.replaceAll("_", " ");
  gestureConfidence.textContent = `${Math.round(observation.gesture.confidence * 100)}%`;
  cameraLabel.textContent = observation.faceDetected ? "面部与手势感知中" : "请保持面部可见";

  if (calibrationCapture && observation.faceDetected) {
    calibrationCapture.samples.push(observation.gazeVector);
    if (observation.at >= calibrationCapture.endsAt) finishCalibration();
  }

  const gaze = calibrator.evaluate(observation.gazeVector);
  const onTarget = observation.faceDetected && gaze.calibrated && gaze.score >= GAZE_THRESHOLD;
  if (onTarget) gazeStartedAt ??= observation.at;
  else gazeStartedAt = undefined;
  const dwellMs = gazeStartedAt ? observation.at - gazeStartedAt : 0;
  const progress = Math.min(1, dwellMs / CLOSE_READY_MS);

  gazeMeterFill.style.width = `${Math.round(gaze.score * 100)}%`;
  gazeScore.textContent = gaze.calibrated
    ? `目标分数 ${Math.round(gaze.score * 100)}%`
    : "需要双点校准";
  gazeProgress.style.setProperty("--progress", `${progress * 360}deg`);
  gazeTarget.classList.toggle("armed", dwellMs >= CLOSE_ARM_MS);
  gazeLabel.textContent =
    dwellMs >= CLOSE_ARM_MS
      ? `保持 ${Math.max(0, (CLOSE_READY_MS - dwellMs) / 1000).toFixed(1)}s`
      : "凝视关闭";

  const state = perceptionState(observation, dwellMs, gaze.score);
  if (
    state.gaze.ready &&
    !closeRequested &&
    observation.at - lastCloseDecisionAt >= 1_500
  ) {
    lastCloseDecisionAt = observation.at;
    void requestDecision(state);
  }

  const supportedGesture = ["Open_Palm", "Closed_Fist", "Thumb_Up", "Thumb_Down"].includes(
    observation.gesture.name,
  );
  if (
    supportedGesture &&
    observation.gesture.confidence >= 0.72 &&
    observation.gesture.stableMs >= 350 &&
    observation.gesture.name !== latchedGesture
  ) {
    latchedGesture = observation.gesture.name;
    void requestDecision(state);
  } else if (observation.gesture.name === "None" || observation.gesture.confidence < 0.55) {
    latchedGesture = "None";
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const health = (await response.json()) as { provider: string; hasApiKey: boolean };
    providerLabel.textContent =
      health.provider === "jev" ? "Jev 决策服务在线" : "本地 Jev 契约模拟器";
    providerPill.textContent = health.provider === "jev" ? "LIVE JEV" : "LOCAL CONTRACT";
    providerDot.classList.add("online");
    if (health.provider !== "jev") {
      logEvent("当前为离线契约模拟；配置 API key 后启用真实 Jev");
    }
  } catch {
    providerLabel.textContent = "决策服务离线";
    providerDot.classList.add("error");
  }
}

videoFile.addEventListener("change", () => {
  const file = videoFile.files?.[0];
  if (!file) return;
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(file);
  media.src = videoObjectUrl;
  emptyState.setAttribute("hidden", "");
  media.load();
  updateMediaReadout();
  logEvent(`已载入本地视频：${file.name}`);
});

for (const event of ["play", "pause", "ratechange", "loadedmetadata"] as const) {
  media.addEventListener(event, updateMediaReadout);
}

startCamera.addEventListener("click", async () => {
  startCamera.disabled = true;
  startCamera.textContent = "正在加载视觉模型…";
  visionStatus.textContent = "加载中";
  try {
      vision = new VisionRuntime(camera, onVisionObservation, (status) => {
        if (status === "awaiting-camera") {
          startCamera.textContent = "请在浏览器中允许摄像头…";
          visionStatus.textContent = "等待授权";
        }
      });
    await vision.start();
    startCamera.textContent = "摄像头已启动";
    visionStatus.textContent = "运行中";
    cameraLabel.textContent = "本地视觉模型运行中";
    calibrateCenter.disabled = false;
    calibrateClose.disabled = false;
    calibrationStatus.textContent = calibrator.calibrated ? "已加载校准" : "未校准";
    logEvent("MediaPipe 手势与面部模型已启动");
  } catch (error) {
    startCamera.disabled = false;
    startCamera.textContent = "重试启动摄像头";
    visionStatus.textContent = "启动失败";
    logEvent(error instanceof Error ? error.message : "摄像头启动失败");
  }
});

calibrateCenter.addEventListener("click", () => beginCalibration("center"));
calibrateClose.addEventListener("click", () => beginCalibration("topRight"));
clearLog.addEventListener("click", () => eventLog.replaceChildren());
gazeTarget.addEventListener("click", () => {
  showToast("关闭只能由完成校准的持续凝视触发");
});
reopenSession.addEventListener("click", () => {
  closeRequested = false;
  closedScreen.setAttribute("hidden", "");
  get("app").removeAttribute("hidden");
  startCamera.disabled = false;
  startCamera.textContent = "重新启动摄像头与模型";
  visionStatus.textContent = "已停止";
  logEvent("会话已重新打开");
});

window.addEventListener("beforeunload", () => {
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  void vision?.stop();
});

updateMediaReadout();
void loadHealth();
