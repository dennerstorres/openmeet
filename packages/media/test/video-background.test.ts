import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundProcessorWrapper, SwitchBackgroundProcessorOptions } from "@livekit/track-processors";
import type { LocalVideoTrack } from "livekit-client";
import { BLUR_RADIUS_MAX, BLUR_RADIUS_MIN, clampBlurRadius, VideoBackground } from "../src/video-background.js";

test("background blur stays local, switches without replacing the processor and follows a new camera track", async () => {
  const created: unknown[] = [];
  const switched: SwitchBackgroundProcessorOptions[] = [];
  const attached: unknown[] = [];
  const processor = {
    async switchTo(options: SwitchBackgroundProcessorOptions) {
      switched.push(options);
    },
  };
  const effect = new VideoBackground({
    supported: () => true,
    assetBase: () => "https://meet.example/media/",
    create: (options) => {
      created.push(options);
      return processor;
    },
  });
  const makeTrack = () =>
    ({
      async setProcessor(value: BackgroundProcessorWrapper) {
        attached.push(value);
      },
    }) as LocalVideoTrack;
  const first = makeTrack();
  const second = makeTrack();

  await effect.setEnabled(undefined, true);
  assert.equal(effect.isEnabled, true);
  await effect.apply(first);
  await effect.apply(first);
  await effect.setEnabled(first, false);
  await effect.setEnabled(second, true);

  assert.equal(created.length, 2);
  assert.equal(attached.length, 2);
  assert.deepEqual(switched, [{ mode: "background-blur", blurRadius: 10 }, { mode: "disabled" }]);
  assert.deepEqual(created[0], {
    mode: "background-blur",
    blurRadius: 10,
    assetPaths: {
      tasksVisionFileSet: "https://meet.example/media/vision",
      modelAssetPath: "https://meet.example/media/selfie_segmenter.tflite",
    },
  });
});

test("unsupported clients reject enabling blur and can keep it disabled", async () => {
  const effect = new VideoBackground({ supported: () => false });
  assert.equal(effect.isSupported, false);
  await effect.setEnabled(undefined, false);
  await assert.rejects(effect.setEnabled(undefined, true), /not supported/);
  assert.equal(effect.isEnabled, false);
});

test("blur strength changes in place on the published track and is clamped", async () => {
  const created: unknown[] = [];
  const switched: SwitchBackgroundProcessorOptions[] = [];
  let attached = 0;
  const effect = new VideoBackground({
    supported: () => true,
    assetBase: () => "https://meet.example/media/",
    blurRadius: 99,
    create: (options) => {
      assert.equal(options.mode, "background-blur");
      created.push({ mode: options.mode, blurRadius: options.blurRadius });
      return {
        async switchTo(next: SwitchBackgroundProcessorOptions) {
          switched.push(next);
        },
      };
    },
  });
  const track = {
    async setProcessor() {
      attached += 1;
    },
  } as unknown as LocalVideoTrack;

  assert.equal(effect.blurRadius, BLUR_RADIUS_MAX);
  await effect.setBlurRadius(4);
  assert.deepEqual(switched, [], "no processor yet, only the saved strength changes");
  await effect.setEnabled(track, true);
  await effect.setBlurRadius(20);
  await effect.setBlurRadius(-5);
  await effect.setEnabled(track, false);
  await effect.setBlurRadius(12);

  assert.equal(attached, 1, "changing the strength never replaces the processor");
  assert.deepEqual(created, [{ mode: "background-blur", blurRadius: 4 }]);
  assert.deepEqual(switched, [{ mode: "background-blur", blurRadius: 20 }, { mode: "background-blur", blurRadius: BLUR_RADIUS_MIN }, { mode: "disabled" }]);
  assert.equal(effect.blurRadius, 12);
  assert.equal(clampBlurRadius(Number.NaN), 10);
  assert.equal(clampBlurRadius(7.6), 8);
});
