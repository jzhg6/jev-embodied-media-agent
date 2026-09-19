import type { AgentAction } from "../shared/types";

export interface ActuationResult {
  message: string;
  verified: boolean;
  detail: string;
}

export class MediaController {
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onClose: () => void,
  ) {}

  async apply(action: AgentAction) {
    switch (action) {
      case "pause":
        this.video.pause();
        return {
          message: "视频已暂停",
          verified: this.video.paused,
          detail: this.video.paused ? "HTMLMediaElement.paused = true" : "播放器未进入暂停状态",
        };
      case "play":
        await this.video.play();
        return {
          message: "视频继续播放",
          verified: !this.video.paused,
          detail: !this.video.paused ? "HTMLMediaElement.paused = false" : "播放器仍处于暂停状态",
        };
      case "speed_up":
        const previousFastRate = this.video.playbackRate;
        this.video.playbackRate = Math.min(2.5, this.video.playbackRate + 0.25);
        return {
          message: `播放速度 ${this.video.playbackRate.toFixed(2)}×`,
          verified:
            this.video.playbackRate > previousFastRate || previousFastRate === 2.5,
          detail: `playbackRate = ${this.video.playbackRate.toFixed(2)}`,
        };
      case "slow_down":
        const previousSlowRate = this.video.playbackRate;
        this.video.playbackRate = Math.max(0.25, this.video.playbackRate - 0.25);
        return {
          message: `播放速度 ${this.video.playbackRate.toFixed(2)}×`,
          verified:
            this.video.playbackRate < previousSlowRate || previousSlowRate === 0.25,
          detail: `playbackRate = ${this.video.playbackRate.toFixed(2)}`,
        };
      case "close_page":
        this.video.pause();
        this.onClose();
        return {
          message: "已执行关闭意图",
          verified: true,
          detail: "已进入关闭流程",
        };
      default:
        return {
          message: "未执行动作",
          verified: true,
          detail: "动作是 none",
        };
    }
  }
}
