import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
} from "@mediapipe/tasks-vision";
import { GAZE_FEATURE_NAMES } from "./gaze";

export interface VisionObservation {
  at: number;
  gesture: {
    name: string;
    confidence: number;
    stableMs: number;
  };
  gazeVector: number[];
  faceDetected: boolean;
}

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const GESTURE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export class VisionRuntime {
  private gestureRecognizer?: GestureRecognizer;
  private faceLandmarker?: FaceLandmarker;
  private stream?: MediaStream;
  private frameId = 0;
  private lastInferenceAt = 0;
  private gestureName = "None";
  private gestureStartedAt = 0;
  private running = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onObservation: (observation: VisionObservation) => void,
    private readonly onStatus?: (status: "loading-models" | "awaiting-camera") => void,
  ) {}

  async start() {
    if (this.running) return;

    this.onStatus?.("loading-models");
    const files = await FilesetResolver.forVisionTasks(WASM_ROOT);
    const createModels = async (delegate: "GPU" | "CPU") => {
      this.gestureRecognizer = await GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      this.faceLandmarker = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
    };

    try {
      await createModels("GPU");
    } catch {
      await this.gestureRecognizer?.close();
      await this.faceLandmarker?.close();
      await createModels("CPU");
    }

    this.onStatus?.("awaiting-camera");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.loop();
  }

  async stop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    await this.gestureRecognizer?.close();
    await this.faceLandmarker?.close();
    this.gestureRecognizer = undefined;
    this.faceLandmarker = undefined;
  }

  private loop = () => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (
      now - this.lastInferenceAt < 100 ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !this.gestureRecognizer ||
      !this.faceLandmarker
    ) {
      return;
    }
    this.lastInferenceAt = now;

    const gestureResult = this.gestureRecognizer.recognizeForVideo(this.video, now);
    const topGesture = gestureResult.gestures?.[0]?.[0];
    const name = topGesture?.categoryName ?? "None";
    const confidence = topGesture?.score ?? 0;
    if (name !== this.gestureName || confidence < 0.55) {
      this.gestureName = confidence >= 0.55 ? name : "None";
      this.gestureStartedAt = now;
    }

    const faceResult = this.faceLandmarker.detectForVideo(this.video, now);
    const categories = faceResult.faceBlendshapes?.[0]?.categories ?? [];
    const scoreByName = new Map(
      categories.map((category) => [category.categoryName, category.score]),
    );
    const gazeVector = GAZE_FEATURE_NAMES.map(
      (feature) => scoreByName.get(feature) ?? 0,
    );

    this.onObservation({
      at: now,
      gesture: {
        name: this.gestureName,
        confidence: this.gestureName === "None" ? 0 : confidence,
        stableMs: this.gestureName === "None" ? 0 : now - this.gestureStartedAt,
      },
      gazeVector,
      faceDetected: Boolean(faceResult.faceLandmarks?.length),
    });
  };
}
