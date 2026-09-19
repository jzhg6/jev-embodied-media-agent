import type { AgentAction } from "../shared/types";

export class MediaController {
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onClose: () => void,
  ) {}

  async apply(action: AgentAction) {
    switch (action) {
      case "pause":
        this.video.pause();
        return "视频已暂停";
      case "play":
        await this.video.play();
        return "视频继续播放";
      case "speed_up":
        this.video.playbackRate = Math.min(2.5, this.video.playbackRate + 0.25);
        return `播放速度 ${this.video.playbackRate.toFixed(2)}×`;
      case "slow_down":
        this.video.playbackRate = Math.max(0.25, this.video.playbackRate - 0.25);
        return `播放速度 ${this.video.playbackRate.toFixed(2)}×`;
      case "close_page":
        this.video.pause();
        this.onClose();
        return "已执行关闭意图";
      default:
        return "未执行动作";
    }
  }
}
