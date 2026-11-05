import type sharp from "sharp";
import { imageJpegCardMaximumDecodedPixels } from "../../mediaAssets/ingestion/imageNormalization";
import {
  MagickError,
  type MagickCropGeometry,
  type MagickGravity,
  type MagickOutputFormat,
  type MagickResizeGeometry,
} from "./arguments";

export type SharpModule = typeof sharp;
export type ImageSize = Readonly<{ width: number; height: number }>;

/** Decoded RGBA, 8 bits per channel, so every operation and canvas shares one pixel layout. */
export type RawImage = Readonly<{ data: Buffer; width: number; height: number }>;

export type MagickSettings = Readonly<{
  sharp: SharpModule;
  background: string;
  gravity: MagickGravity;
  /** sharp runs in-process, beyond just-bash's own time limit, so each pipeline gets what is left. */
  deadlineMs: number;
}>;

export type ImageInfo = Readonly<{ format: string; width: number; height: number }>;

/** Ingestion's decode limit, so any image magick holds or writes can still become a card image. */
export const maximumImagePixels = imageJpegCardMaximumDecodedPixels;
export const maximumMagickSeconds = 60;
const channels = 4;
const supportedInputFormats: ReadonlyArray<string> = ["jpeg", "png", "webp", "gif"];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loaded on first use, so a native binary that fails to load breaks only magick, not the whole sandbox. */
export async function loadSharp(): Promise<SharpModule> {
  try {
    return (await import("sharp")).default;
  } catch (error) {
    console.error({ action: "chat_sandbox_magick_sharp_load_failed", errorMessage: describeError(error) });
    throw new MagickError(`the image library sharp failed to load: ${describeError(error)}`);
  }
}

function remainingSeconds(deadlineMs: number): number {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    throw new MagickError(`out of time: magick stops after ${maximumMagickSeconds} seconds or when the bash command's time runs out`);
  }

  return Math.ceil(remainingMs / 1_000);
}

export function assertTimeLeft(settings: MagickSettings): void {
  remainingSeconds(settings.deadlineMs);
}

function toSharpColor(color: string): sharp.Color {
  return color.toLowerCase() === "none" ? { r: 0, g: 0, b: 0, alpha: 0 } : color;
}

/** Checked when set, because sharp parses a color only when an operation first uses it. */
export function assertBackgroundColor(color: string, settings: MagickSettings): void {
  try {
    settings.sharp({ create: { width: 1, height: 1, channels, background: toSharpColor(color) } });
  } catch (error) {
    throw new MagickError(`-background ${color}: ${describeError(error)}; use a color name, #RRGGBB, rgb(R,G,B) or none`);
  }
}

function gravityOffset(outer: number, inner: number, gravity: MagickGravity): number {
  return gravity === "center" ? Math.floor((outer - inner) / 2) : 0;
}

function openSource(bytes: Uint8Array, settings: MagickSettings): sharp.Sharp {
  return settings.sharp(bytes, { animated: false, failOn: "error", limitInputPixels: maximumImagePixels });
}

function openRaw(image: RawImage, settings: MagickSettings): sharp.Sharp {
  return settings.sharp(image.data, {
    raw: { width: image.width, height: image.height, channels },
    limitInputPixels: maximumImagePixels,
  }).timeout({ seconds: remainingSeconds(settings.deadlineMs) });
}

async function toRaw(pipeline: sharp.Sharp, operation: string): Promise<RawImage> {
  let output: Readonly<{ data: Buffer; info: sharp.OutputInfo }>;
  try {
    output = await pipeline
      .toColourspace("srgb")
      .ensureAlpha()
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new MagickError(`${operation} failed: ${describeError(error)}`);
  }

  if (output.info.channels !== channels) {
    throw new MagickError(`${operation} gave ${output.info.channels} color channels where RGBA has ${channels}`);
  }

  return { data: output.data, width: output.info.width, height: output.info.height };
}

/** Width x height after orientation, which is the image every operation sees. */
export async function identifyImage(bytes: Uint8Array, path: string, settings: MagickSettings): Promise<ImageInfo> {
  let metadata: sharp.Metadata;
  try {
    metadata = await openSource(bytes, settings).metadata();
  } catch (error) {
    throw new MagickError(`cannot decode ${path}: ${describeError(error)}`);
  }

  if (!supportedInputFormats.includes(metadata.format)) {
    throw new MagickError(`${path} is ${metadata.format}; magick reads ${supportedInputFormats.join(", ")}`);
  }

  return { format: metadata.format, width: metadata.autoOrient.width, height: metadata.autoOrient.height };
}

/**
 * Applies the EXIF orientation, as a viewer shows the image, so crop offsets match what the model saw.
 * Call it after identifyImage, which checks the format and gives the size to check against the limits.
 */
export async function decodeImage(bytes: Uint8Array, path: string, settings: MagickSettings): Promise<RawImage> {
  return toRaw(
    openSource(bytes, settings).timeout({ seconds: remainingSeconds(settings.deadlineMs) }).autoOrient(),
    `reading ${path}`,
  );
}

function resizeScale(image: ImageSize, geometry: MagickResizeGeometry): number {
  switch (geometry.kind) {
    case "fit":
      return Math.min(geometry.width / image.width, geometry.height / image.height);
    case "width":
      return geometry.width / image.width;
    case "height":
      return geometry.height / image.height;
    case "percent":
      return geometry.percent / 100;
  }
}

/** With `>`, ImageMagick leaves an image that already fits the geometry as it is. */
export function resizedSize(image: ImageSize, geometry: MagickResizeGeometry): ImageSize {
  const scale = resizeScale(image, geometry);
  if (geometry.kind !== "percent" && geometry.shrinkOnly && scale >= 1) {
    return { width: image.width, height: image.height };
  }

  const scaled = {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
  switch (geometry.kind) {
    case "width":
      return { ...scaled, width: geometry.width };
    case "height":
      return { ...scaled, height: geometry.height };
    default:
      return scaled;
  }
}

export async function resizeImage(
  image: RawImage,
  geometry: MagickResizeGeometry,
  settings: MagickSettings,
): Promise<RawImage> {
  const size = resizedSize(image, geometry);
  if (size.width === image.width && size.height === image.height) {
    return image;
  }

  return toRaw(openRaw(image, settings).resize({ ...size, fit: "fill" }), "-resize");
}

/** ImageMagick keeps the part of the crop that overlaps the image and fails when nothing does. */
export async function cropImage(
  image: RawImage,
  geometry: MagickCropGeometry,
  settings: MagickSettings,
): Promise<RawImage> {
  const left = gravityOffset(image.width, geometry.width, settings.gravity) + geometry.x;
  const top = gravityOffset(image.height, geometry.height, settings.gravity) + geometry.y;
  const region = {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.min(image.width, left + geometry.width) - Math.max(0, left),
    height: Math.min(image.height, top + geometry.height) - Math.max(0, top),
  };
  if (region.width <= 0 || region.height <= 0) {
    throw new MagickError(`-crop lies outside the ${image.width}x${image.height} image`);
  }

  return toRaw(openRaw(image, settings).extract(region), "-crop");
}

/** The bounding box of the turned image, rounded up, which the result never exceeds. */
export function rotatedSize(image: ImageSize, degrees: number): ImageSize {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  // Rounded first, so float noise at multiples of 90 degrees does not add a pixel.
  const box = (along: number, across: number) => Math.ceil(Number((along + across).toFixed(6)));
  return { width: box(image.width * cos, image.height * sin), height: box(image.width * sin, image.height * cos) };
}

/** Corners an angle that is not a multiple of 90 uncovers take the background color. */
export async function rotateImage(image: RawImage, degrees: number, settings: MagickSettings): Promise<RawImage> {
  return toRaw(
    openRaw(image, settings).rotate(degrees, { background: toSharpColor(settings.background) }),
    "-rotate",
  );
}

export async function flipImage(image: RawImage, settings: MagickSettings): Promise<RawImage> {
  return toRaw(openRaw(image, settings).flip(), "-flip");
}

export async function flopImage(image: RawImage, settings: MagickSettings): Promise<RawImage> {
  return toRaw(openRaw(image, settings).flop(), "-flop");
}

type Placement = Readonly<{ image: RawImage; left: number; top: number }>;

/** Every placement must lie inside the canvas, which sharp's composite requires. */
async function composeOnCanvas(
  width: number,
  height: number,
  placements: ReadonlyArray<Placement>,
  settings: MagickSettings,
  operation: string,
): Promise<RawImage> {
  const canvas = settings.sharp({
    create: { width, height, channels, background: toSharpColor(settings.background) },
  })
    .timeout({ seconds: remainingSeconds(settings.deadlineMs) })
    .composite(placements.map((placement) => ({
      input: placement.image.data,
      raw: { width: placement.image.width, height: placement.image.height, channels },
      left: placement.left,
      top: placement.top,
    })));
  return toRaw(canvas, operation);
}

/** Pads with the background, or cuts what does not fit, around the image placed by gravity. */
export async function extentImage(
  image: RawImage,
  width: number,
  height: number,
  settings: MagickSettings,
): Promise<RawImage> {
  const left = gravityOffset(width, image.width, settings.gravity);
  const top = gravityOffset(height, image.height, settings.gravity);
  const region = {
    left: Math.max(0, -left),
    top: Math.max(0, -top),
    width: Math.min(image.width - Math.max(0, -left), width - Math.max(0, left)),
    height: Math.min(image.height - Math.max(0, -top), height - Math.max(0, top)),
  };
  const visible = region.width === image.width && region.height === image.height
    ? image
    : await toRaw(openRaw(image, settings).extract(region), "-extent");
  return composeOnCanvas(width, height, [{ image: visible, left: Math.max(0, left), top: Math.max(0, top) }], settings, "-extent");
}

export function appendedSize(images: ReadonlyArray<ImageSize>, direction: "horizontal" | "vertical"): ImageSize {
  return direction === "horizontal"
    ? { width: images.reduce((sum, image) => sum + image.width, 0), height: Math.max(...images.map((image) => image.height)) }
    : { width: Math.max(...images.map((image) => image.width)), height: images.reduce((sum, image) => sum + image.height, 0) };
}

/** Joins the whole list into one image, aligned by gravity across the join, gaps in the background color. */
export async function appendImages(
  images: ReadonlyArray<RawImage>,
  direction: "horizontal" | "vertical",
  settings: MagickSettings,
): Promise<RawImage> {
  const horizontal = direction === "horizontal";
  const { width, height } = appendedSize(images, direction);
  const placements = images.map((image, index): Placement => {
    const offset = images.slice(0, index).reduce((sum, previous) => sum + (horizontal ? previous.width : previous.height), 0);
    return horizontal
      ? { image, left: offset, top: gravityOffset(height, image.height, settings.gravity) }
      : { image, left: gravityOffset(width, image.width, settings.gravity), top: offset };
  });
  return composeOnCanvas(width, height, placements, settings, horizontal ? "+append" : "-append");
}

/** JPEG has no alpha, so transparency is flattened onto the background color. */
export async function encodeImage(
  image: RawImage,
  format: MagickOutputFormat,
  quality: number | null,
  settings: MagickSettings,
): Promise<Buffer> {
  const pipeline = openRaw(image, settings);
  const qualityOptions = quality === null ? {} : { quality };
  const encoder = format === "jpeg"
    ? pipeline.flatten({ background: toSharpColor(settings.background) }).jpeg(qualityOptions)
    : format === "webp"
      ? pipeline.webp(qualityOptions)
      : pipeline.png();
  try {
    return await encoder.toBuffer();
  } catch (error) {
    throw new MagickError(`writing ${format} failed: ${describeError(error)}`);
  }
}
