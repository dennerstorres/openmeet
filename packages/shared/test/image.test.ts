import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_MAX_BYTES, sniffImage } from "../src/image.js";

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number): number[] {
  return u32be(value).reverse();
}

function bytes(...parts: (number[] | string)[]): Uint8Array {
  return new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));
}

function png(width: number, height: number): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32be(13),
    "IHDR",
    u32be(width),
    u32be(height),
    [8, 6, 0, 0, 0],
    [0, 0, 0, 0],
    u32be(0),
    "IEND",
    [0xae, 0x42, 0x60, 0x82],
  );
}

function jpeg(width: number, height: number): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00],
    [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00],
    [0xff, 0xda, 0x00, 0x02],
    [0xff, 0xd9],
  );
}

function webpLossless(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  const chunk = bytes("VP8L", u32le(5), [0x2f], u32le(bits));
  return bytes("RIFF", u32le(4 + chunk.length + 1), "WEBP", [...chunk], [0]);
}

function webpExtended(flags: number): Uint8Array {
  const chunk = bytes("VP8X", u32le(10), [flags, 0, 0, 0], [63, 0, 0], [63, 0, 0]);
  return bytes("RIFF", u32le(4 + chunk.length), "WEBP", [...chunk]);
}

test("PNG, JPEG and WebP are read from their bytes", () => {
  assert.deepEqual(sniffImage(png(256, 128)), { type: "image/png", width: 256, height: 128 });
  assert.deepEqual(sniffImage(jpeg(200, 100)), { type: "image/jpeg", width: 200, height: 100 });
  assert.deepEqual(sniffImage(webpLossless(64, 32)), { type: "image/webp", width: 64, height: 32 });
  assert.deepEqual(sniffImage(webpExtended(0)), { type: "image/webp", width: 64, height: 64 });
});

test("SVG, HTML, GIF, truncated files and animation are refused", () => {
  assert.equal(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), undefined);
  assert.equal(sniffImage(bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0])), undefined);
  // A PNG header in front of a page, without IEND.
  assert.equal(sniffImage(bytes([...png(16, 16).subarray(0, 33)], "<html><script>alert(1)</script></html>")), undefined);
  assert.equal(sniffImage(png(16, 16).subarray(0, 40)), undefined);
  assert.equal(sniffImage(jpeg(16, 16).subarray(0, 12)), undefined);
  const lying = webpLossless(16, 16);
  assert.equal(sniffImage(bytes([...lying], [0, 0])), undefined);
  assert.equal(sniffImage(webpExtended(0x02)), undefined);
  assert.equal(sniffImage(new Uint8Array()), undefined);
});

test("the size and side limits hold", () => {
  assert.equal(sniffImage(png(513, 10)), undefined);
  assert.equal(sniffImage(png(0, 10)), undefined);
  assert.notEqual(sniffImage(png(512, 512)), undefined);
  const padded = new Uint8Array(IMAGE_MAX_BYTES + 1);
  padded.set(png(16, 16));
  assert.equal(sniffImage(padded), undefined);
});
