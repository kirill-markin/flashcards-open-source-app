import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { HttpError } from "../../shared/errors";
import {
  imageJpegCardMaxSidePixels,
  imageJpegCardTransparentPixelLightCardGray,
  normalizeImageBytesForCard,
} from "./imageNormalization";
import { imageJpegCardMediaBlobMimeType } from "../types";

type RgbPixel = Readonly<{
  red: number;
  green: number;
  blue: number;
}>;

async function createTransparentPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 12,
      height: 12,
      channels: 4,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    },
  }).png().toBuffer();
}

async function createLargeJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1_600,
      height: 800,
      channels: 3,
      background: {
        r: 20,
        g: 30,
        b: 40,
      },
    },
  }).jpeg().toBuffer();
}

async function readFirstPixel(bytes: Buffer): Promise<RgbPixel> {
  const rawImage = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const red = rawImage.data[0];
  const green = rawImage.data[1];
  const blue = rawImage.data[2];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error("Normalized image did not contain a readable RGB pixel.");
  }

  return { red, green, blue };
}

function assertApproximatelyEqual(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) <= 4,
    `Expected ${actual} to be within 4 of ${expected}`,
  );
}

test("normalizeImageBytesForCard converts transparent PNG to deterministic metadata-free JPEG", async () => {
  const inputBytes = await createTransparentPng();

  const firstResult = await normalizeImageBytesForCard(inputBytes);
  const secondResult = await normalizeImageBytesForCard(inputBytes);
  const metadata = await sharp(firstResult.bytes).metadata();
  const firstPixel = await readFirstPixel(firstResult.bytes);

  assert.equal(firstResult.mimeType, imageJpegCardMediaBlobMimeType);
  assert.equal(firstResult.sizeBytes, firstResult.bytes.byteLength);
  assert.deepEqual(firstResult.bytes, secondResult.bytes);
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assertApproximatelyEqual(firstPixel.red, imageJpegCardTransparentPixelLightCardGray.r);
  assertApproximatelyEqual(firstPixel.green, imageJpegCardTransparentPixelLightCardGray.g);
  assertApproximatelyEqual(firstPixel.blue, imageJpegCardTransparentPixelLightCardGray.b);
});

test("normalizeImageBytesForCard constrains the longest side", async () => {
  const inputBytes = await createLargeJpeg();

  const result = await normalizeImageBytesForCard(inputBytes);
  const metadata = await sharp(result.bytes).metadata();

  assert.equal(metadata.width, imageJpegCardMaxSidePixels);
  assert.equal(metadata.height, 600);
});

test("normalizeImageBytesForCard rejects GIF input", async () => {
  const singlePixelGif = Buffer.from(
    "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64",
  );

  await assert.rejects(
    async () => normalizeImageBytesForCard(singlePixelGif),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 415);
      assert.equal(error.code, "MEDIA_ASSET_IMAGE_FORMAT_UNSUPPORTED");
      return true;
    },
  );
});
