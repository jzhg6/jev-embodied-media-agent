import "./style.css";
import type {
  AgentAction,
  DecisionResult,
  PerceptionState,
} from "../shared/types";
import { GazeCalibrator } from "./gaze";
import { MediaController } from "./media-controller";
import {
  OPEN_PALM_REFLEX_CONFIDENCE,
  OPEN_PALM_REFLEX_STABLE_MS,
  shouldPauseWithOpenPalmReflex,
} from "./reflex";
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
const stopCamera = get<HTMLButtonElement>("stop-camera");
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
const choiceOutput = get("choice-output");
const intentOutput = get("intent-output");
const qualityOutput = get("quality-output");
const tracePerception = get("trace-perception");
const traceJudgment = get("trace-judgment");
const traceFilter = get("trace-filter");
const traceActuator = get("trace-actuator");
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
let lastGestureDispatchAt = -Infinity;
let decisionPending = false;
let queuedDecisionState: PerceptionState | undefined;
let reflexPausePending = false;
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
const GESTURE_TRIGGER_CONFIDENCE = OPEN_PALM_REFLEX_CONFIDENCE;
const GESTURE_STABLE_MS = OPEN_PALM_REFLEX_STABLE_MS;
const GESTURE_RETRY_MS = 1_200;

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
      ready: media.readyState >= HTMLMediaElement.HAVE_METADATA,
      paused: media.paused,
      playbackRate: media.playbackRate,
    },
    safety: {
      allowClose: ready,
      closePolicy: "calibrated-continuous-dwell",
    },
  };
}

function describePerception(state: PerceptionState) {
  if (state.gaze.ready) {
    return `凝视右上角 · ${Math.round(state.gaze.dwellMs)} ms · 分数 ${Math.round(state.gaze.topRightScore * 100)}%`;
  }
  return `${state.gesture.name.replaceAll("_", " ")} · ${Math.round(state.gesture.confidence * 100)}% · 稳定 ${Math.round(state.gesture.stableMs)} ms`;
}

function setTrace(
  element: HTMLElement,
  text: string,
  state?: "pass" | "blocked" | "error",
) {
  element.textContent = text;
  element.classList.remove("pass", "blocked", "error");
  if (state) element.classList.add(state);
}

async function applyOpenPalmSafetyReflex(state: PerceptionState) {
  if (reflexPausePending || !shouldPauseWithOpenPalmReflex(state)) {
    return;
  }

  reflexPausePending = true;
  try {
    setTrace(traceFilter, "本地安全反射：Open Palm 可直接暂停", "pass");
    const result = await controller.apply("pause");
    decisionAction.textContent = "PAUSE";
    showToast(result.message);
    setTrace(
      traceActuator,
      result.verified
        ? `安全反射已执行并验证：${result.detail}`
        : `安全反射执行未验证：${result.detail}`,
      result.verified ? "pass" : "error",
    );
    logEvent(`PAUSE · Open Palm 本地安全反射${result.verified ? "已验证" : "未验证"}`);
    updateMediaReadout();
  } finally {
    reflexPausePending = false;
  }
}

async function processDecision(state: PerceptionState) {
  setTrace(tracePerception, describePerception(state));
  setTrace(traceJudgment, "正在并行计算 Choice / Noul / Score…");
  setTrace(traceFilter, "等待判断输出");
  setTrace(traceActuator, "等待过滤器放行");
  try {
    const response = await fetch("/api/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    const body = (await response.json()) as DecisionResult & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "决策服务请求失败");
    renderDecision(body);

    if (body.action !== "none") {
      // The browser repeats the irreversible-action guard even though the server
      // already applies it. A remote model can never bypass the local contract.
      if (body.action === "close_page" && !state.safety.allowClose) {
        setTrace(traceActuator, "浏览器安全层再次拦截关闭动作", "blocked");
        logEvent("本地安全层拦截了未完成凝视的关闭动作");
        return;
      }

      const result = await controller.apply(body.action);
      showToast(result.message);
      setTrace(
        traceActuator,
        result.verified ? `已执行并验证：${result.detail}` : `执行未验证：${result.detail}`,
        result.verified ? "pass" : "error",
      );
      logEvent(
        `${body.action.toUpperCase()} · ${result.verified ? "执行已验证" : "执行未验证"}`,
      );
      updateMediaReadout();
    } else {
      setTrace(traceActuator, "未执行：过滤器没有放行动作", "blocked");
      if (body.candidateAction !== "none") {
        logEvent(`${body.candidateAction.toUpperCase()} 被过滤：${body.filterReason}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "决策失败";
    logEvent(message);
    setTrace(traceJudgment, message, "error");
    setTrace(traceFilter, "决策请求失败，未执行", "error");
    setTrace(traceActuator, "未执行", "error");
    providerDot.classList.add("error");
  }
}

async function requestDecision(state: PerceptionState) {
  if (closeRequested) return;
  queuedDecisionState = state;
  if (decisionPending) {
    setTrace(traceJudgment, "已有判断运行中；最新感知已进入单槽队列");
    return;
  }

  decisionPending = true;
  try {
    while (queuedDecisionState && !closeRequested) {
      const nextState = queuedDecisionState;
      queuedDecisionState = undefined;
      await processDecision(nextState);
    }
  } finally {
    decisionPending = false;
  }
}

function renderDecision(decision: DecisionResult) {
  decisionAction.textContent = decision.action.toUpperCase();
  const actionProbability = decision.probabilities[decision.candidateAction] ?? 0;
  decisionConfidence.textContent = `${Math.round(actionProbability * 100)}%`;
  confidenceBar.style.width = `${Math.round(actionProbability * 100)}%`;
  decisionMeta.textContent = `${decision.model} · ${decision.latencyMs} ms${decision.guarded ? " · guarded" : ""}`;
  choiceOutput.textContent = `${decision.candidateAction} · ${Math.round(actionProbability * 100)}%`;
  intentOutput.textContent = `${Math.round(decision.intentionalControlProbability * 100)}%`;
  qualityOutput.textContent = `${decision.signalQualityScore.toFixed(2)} / 2`;
  setTrace(
    traceJudgment,
    `Choice=${decision.candidateAction}；Noul=${Math.round(decision.intentionalControlProbability * 100)}%；Score=${decision.signalQualityScore.toFixed(2)}`,
  );
  setTrace(
    traceFilter,
    decision.accepted ? `通过：${decision.filterReason}` : `拦截：${decision.filterReason}`,
    decision.accepted ? "pass" : "blocked",
  );
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
  if (!decisionPending) {
    setTrace(
      tracePerception,
      `${observation.gesture.name.replaceAll("_", " ")} · ${Math.round(observation.gesture.confidence * 100)}% · 稳定 ${Math.round(observation.gesture.stableMs)} ms`,
    );
  }
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
    observation.gesture.confidence >= GESTURE_TRIGGER_CONFIDENCE &&
    observation.gesture.stableMs >= GESTURE_STABLE_MS &&
    (observation.gesture.name !== latchedGesture ||
      observation.at - lastGestureDispatchAt >= GESTURE_RETRY_MS)
  ) {
    latchedGesture = observation.gesture.name;
    lastGestureDispatchAt = observation.at;
    if (observation.gesture.name === "Open_Palm") {
      void applyOpenPalmSafetyReflex(state);
    }
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

document.querySelectorAll<HTMLButtonElement>(".simulate-gesture").forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.dataset.gesture;
    if (!name) return;
    const observation: VisionObservation = {
      at: performance.now(),
      gesture: { name, confidence: 0.94, stableMs: 700 },
      gazeVector: [],
      faceDetected: false,
    };
    gestureState.textContent = name.replaceAll("_", " ");
    gestureConfidence.textContent = "94%";
    logEvent(`教学模拟：${name}`);
    const state = perceptionState(observation, 0, 0);
    if (name === "Open_Palm") void applyOpenPalmSafetyReflex(state);
    void requestDecision(state);
  });
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
    stopCamera.disabled = false;
    cameraLabel.textContent = "本地视觉模型运行中";
    calibrateCenter.disabled = false;
    calibrateClose.disabled = false;
    calibrationStatus.textContent = calibrator.calibrated ? "已加载校准" : "未校准";
    logEvent("MediaPipe 手势与面部模型已启动");
  } catch (error) {
    await vision?.stop();
    vision = undefined;
    startCamera.disabled = false;
    startCamera.textContent = "重试启动摄像头";
    stopCamera.disabled = true;
    visionStatus.textContent = "启动失败";
    logEvent(error instanceof Error ? error.message : "摄像头启动失败");
  }
});

stopCamera.addEventListener("click", async () => {
  stopCamera.disabled = true;
  stopCamera.textContent = "正在关闭…";
  await vision?.stop();
  vision = undefined;
  latestObservation = undefined;
  gazeStartedAt = undefined;
  calibrationCapture = undefined;
  latchedGesture = "None";
  queuedDecisionState = undefined;
  cameraLabel.textContent = "摄像头已关闭";
  visionStatus.textContent = "已关闭";
  gestureState.textContent = "—";
  gestureConfidence.textContent = "0%";
  calibrateCenter.disabled = true;
  calibrateClose.disabled = true;
  startCamera.disabled = false;
  startCamera.textContent = "重新启动摄像头与模型";
  stopCamera.textContent = "关闭摄像头";
  setTrace(tracePerception, "摄像头已关闭");
  logEvent("摄像头与本地视觉模型已关闭");
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
  stopCamera.disabled = true;
  visionStatus.textContent = "已停止";
  logEvent("会话已重新打开");
});

window.addEventListener("beforeunload", () => {
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  void vision?.stop();
});

updateMediaReadout();
void loadHealth();
