import { describe, expect, it, vi } from "vitest";
import { MediaController } from "../src/media-controller.js";

function fakeVideo() {
  const video = {
    paused: false,
    playbackRate: 1,
    pause() {
      this.paused = true;
    },
    async play() {
      this.paused = false;
    },
  };
  return video as unknown as HTMLVideoElement;
}

describe("media actuator feedback", () => {
  it("pauses and verifies the resulting player state", async () => {
    const video = fakeVideo();
    const controller = new MediaController(video, vi.fn());

    const result = await controller.apply("pause");

    expect(video.paused).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.detail).toContain("paused = true");
  });

  it("changes playback rate and verifies the effect", async () => {
    const video = fakeVideo();
    const controller = new MediaController(video, vi.fn());

    const result = await controller.apply("speed_up");

    expect(video.playbackRate).toBe(1.25);
    expect(result.verified).toBe(true);
  });
});
