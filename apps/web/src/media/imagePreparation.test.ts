// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  isImageFileCandidate,
  prepareCardImageFile,
  UnsupportedImagePreparationError,
} from "./imagePreparation";

function makeFile(fileName: string, mediaType: string, bytes: Uint8Array): File {
  return new File([bytes], fileName, { type: mediaType });
}

function makePngWithChunk(chunkType: string): Uint8Array {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunkTypeBytes = Array.from(chunkType, (character) => character.charCodeAt(0));
  return new Uint8Array([
    ...pngSignature,
    0x00,
    0x00,
    0x00,
    0x00,
    ...chunkTypeBytes,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function makeGifBytes(): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
}

function makeAnimatedWebpBytes(): Uint8Array {
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    0x0e,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x58,
    0x01,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

describe("prepareCardImageFile", () => {
  it("rejects card image source formats outside JPEG, PNG, and WebP before canvas normalization", async () => {
    const unsupportedFiles = [
      makeFile("vector.svg", "image/svg+xml", new Uint8Array([1, 2, 3])),
      makeFile("photo.avif", "image/avif", new Uint8Array([1, 2, 3])),
      makeFile("bitmap.bmp", "image/bmp", new Uint8Array([1, 2, 3])),
      makeFile("animated.gif", "image/gif", makeGifBytes()),
      makeFile("mislabeled.jpg", "", makeGifBytes()),
      makeFile("camera.heic", "image/heic", new Uint8Array([1, 2, 3])),
      makeFile("unknown.tiff", "image/tiff", new Uint8Array([1, 2, 3])),
    ];

    for (const file of unsupportedFiles) {
      await expect(prepareCardImageFile(file)).rejects.toThrow(UnsupportedImagePreparationError);
      await expect(prepareCardImageFile(file)).rejects.toThrow("Expected selected bytes to be a JPEG, PNG, or WebP image source.");
    }
  });

  it("rejects APNG sources before canvas normalization", async () => {
    const files = [
      makeFile("animated.png", "image/png", makePngWithChunk("acTL")),
      makeFile("mislabeled.jpg", "", makePngWithChunk("acTL")),
    ];

    for (const file of files) {
      await expect(prepareCardImageFile(file)).rejects.toThrow(UnsupportedImagePreparationError);
      await expect(prepareCardImageFile(file)).rejects.toThrow("Animated PNG images are not supported for card media.");
    }
  });

  it("rejects animated WebP sources before canvas normalization", async () => {
    const file = makeFile("mislabeled.jpg", "", makeAnimatedWebpBytes());

    await expect(prepareCardImageFile(file)).rejects.toThrow(UnsupportedImagePreparationError);
    await expect(prepareCardImageFile(file)).rejects.toThrow("Animated WebP images are not supported for card media.");
  });

  it("keeps chat image candidate detection broad", () => {
    expect(isImageFileCandidate(makeFile("vector.svg", "image/svg+xml", new Uint8Array([1])))).toBe(true);
    expect(isImageFileCandidate(makeFile("camera.heic", "", new Uint8Array([1])))).toBe(true);
    expect(isImageFileCandidate(makeFile("sequence.heics", "", new Uint8Array([1])))).toBe(false);
    expect(isImageFileCandidate(makeFile("sequence.heifs", "", new Uint8Array([1])))).toBe(false);
  });
});
