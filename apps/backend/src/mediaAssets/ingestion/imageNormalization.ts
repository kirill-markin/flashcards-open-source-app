import sharp, { type Metadata } from "sharp";
import { HttpError } from "../../shared/errors";
import { imageJpegCardMediaBlobMimeType } from "../types";

export const imageJpegCardMaxSidePixels = 1_200;
export const imageJpegCardJpegQuality = 82;
export const imageJpegCardMaximumDecodedPixels = 24_000_000;
export const imageJpegCardTransparentPixelLightCardGray = {
  r: 241,
  g: 243,
  b: 244,
} as const;

export type NormalizedImageBytes = Readonly<{
  bytes: Buffer;
  mimeType: typeof imageJpegCardMediaBlobMimeType;
  sizeBytes: number;
}>;

const supportedInputFormats = ["jpeg", "png", "webp"] as const;
const heifCompatibleBrands = ["heic", "heix", "hevc", "hevx", "heif", "mif1", "msf1"] as const;

type SupportedInputFormat = typeof supportedInputFormats[number];

function isSupportedInputFormat(value: string | undefined): value is SupportedInputFormat {
  return supportedInputFormats.some((format) => format === value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSharpPixelLimitError(error: unknown): boolean {
  return /pixel limit/i.test(toErrorMessage(error));
}

function createUnsupportedImageFormatError(detectedFormat: string): HttpError {
  return new HttpError(
    415,
    [
      "Image format is unsupported.",
      `supportedFormats=${supportedInputFormats.join(",")}`,
      `detectedFormat=${detectedFormat}`,
    ].join(" "),
    "MEDIA_ASSET_IMAGE_FORMAT_UNSUPPORTED",
  );
}

function createImageDecodeError(error: unknown): HttpError {
  if (isSharpPixelLimitError(error)) {
    return new HttpError(
      413,
      `Decoded image dimensions must be at most ${imageJpegCardMaximumDecodedPixels} pixels`,
      "MEDIA_ASSET_IMAGE_DIMENSIONS_TOO_LARGE",
    );
  }

  return new HttpError(
    400,
    `Image bytes could not be decoded as JPEG, PNG, or WebP. decoderMessage=${toErrorMessage(error)}`,
    "MEDIA_ASSET_IMAGE_DECODE_FAILED",
  );
}

function assertSupportedImageFormat(metadata: Metadata): void {
  if (isSupportedInputFormat(metadata.format)) {
    return;
  }

  throw createUnsupportedImageFormatError(metadata.format ?? "unknown");
}

function detectUnsupportedContainerFormat(inputBytes: Buffer): string | null {
  const header = inputBytes.subarray(0, 12).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return "gif";
  }

  if (inputBytes.byteLength < 12 || inputBytes.subarray(4, 8).toString("ascii") !== "ftyp") {
    return null;
  }

  const brandBytes = inputBytes.subarray(8, Math.min(inputBytes.byteLength, 64)).toString("ascii");
  if (heifCompatibleBrands.some((brand) => brandBytes.includes(brand))) {
    return "heif";
  }

  return null;
}

function assertSinglePageImage(metadata: Metadata): void {
  const pageCount = metadata.pages ?? 1;
  const frameDelays = metadata.delay ?? [];
  if (pageCount <= 1 && frameDelays.length <= 1) {
    return;
  }

  throw new HttpError(
    415,
    "Animated or multipage images are not supported for media asset image ingestion.",
    "MEDIA_ASSET_IMAGE_ANIMATED_UNSUPPORTED",
  );
}

function assertDecodedImageDimensions(metadata: Metadata): void {
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (
    width === undefined
    || height === undefined
    || Number.isSafeInteger(width) === false
    || Number.isSafeInteger(height) === false
    || width < 1
    || height < 1
  ) {
    throw new HttpError(
      400,
      "Image dimensions could not be read from the decoded metadata.",
      "MEDIA_ASSET_IMAGE_DIMENSIONS_INVALID",
    );
  }

  if (width * height <= imageJpegCardMaximumDecodedPixels) {
    return;
  }

  throw new HttpError(
    413,
    `Decoded image dimensions must be at most ${imageJpegCardMaximumDecodedPixels} pixels`,
    "MEDIA_ASSET_IMAGE_DIMENSIONS_TOO_LARGE",
  );
}

async function readImageMetadata(inputBytes: Buffer): Promise<Metadata> {
  try {
    return await sharp(inputBytes, {
      animated: true,
      failOn: "warning",
      limitInputPixels: imageJpegCardMaximumDecodedPixels,
    }).metadata();
  } catch (error) {
    throw createImageDecodeError(error);
  }
}

async function convertImageToJpeg(inputBytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(inputBytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: imageJpegCardMaximumDecodedPixels,
    })
      .rotate()
      .resize({
        width: imageJpegCardMaxSidePixels,
        height: imageJpegCardMaxSidePixels,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: imageJpegCardTransparentPixelLightCardGray })
      .toColorspace("srgb")
      .jpeg({
        quality: imageJpegCardJpegQuality,
        progressive: false,
        mozjpeg: false,
      })
      .toBuffer();
  } catch (error) {
    throw createImageDecodeError(error);
  }
}

export async function normalizeImageBytesForCard(inputBytes: Buffer): Promise<NormalizedImageBytes> {
  const unsupportedContainerFormat = detectUnsupportedContainerFormat(inputBytes);
  if (unsupportedContainerFormat !== null) {
    throw createUnsupportedImageFormatError(unsupportedContainerFormat);
  }

  const metadata = await readImageMetadata(inputBytes);
  assertSupportedImageFormat(metadata);
  assertSinglePageImage(metadata);
  assertDecodedImageDimensions(metadata);

  const bytes = await convertImageToJpeg(inputBytes);
  return {
    bytes,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: bytes.byteLength,
  };
}
