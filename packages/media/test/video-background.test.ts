import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundProcessorWrapper, SwitchBackgroundProcessorOptions } from "@livekit/track-processors";
import type { LocalVideoTrack } from "livekit-client";
import { VideoBackground } from "../src/video-background.js";

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
