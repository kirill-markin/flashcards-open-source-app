import type { Command, ExecResult, ResolvedCommandContext } from "just-bash";
import { MagickError, parseMagickArguments, type MagickStep } from "./arguments";
import {
  appendedSize,
  appendImages,
  assertBackgroundColor,
  assertTimeLeft,
  cropImage,
  decodeImage,
  encodeImage,
  extentImage,
  flipImage,
  flopImage,
  identifyImage,
  loadSharp,
  maximumImagePixels,
  maximumMagickSeconds,
  resizedSize,
  resizeImage,
  rotatedSize,
  rotateImage,
  type ImageSize,
  type MagickSettings,
  type RawImage,
} from "./images";

/**
 * Four full-size images of RGBA, about 400 MB; an operator holds the old and the new list at once,
 * which stays well inside the sandbox Lambda's memory.
 */
const maximumListPixels = 4 * maximumImagePixels;

type MagickState = Readonly<{
  images: ReadonlyArray<RawImage>;
  settings: MagickSettings;
  quality: number | null;
}>;

/** A file system error such as `ENOENT: ...` or `EROFS: ...`, which the command's code should see. */
function isFileSystemError(error: unknown): error is Error {
  return error instanceof Error && /^E[A-Z]+: /u.test(error.message);
}

async function readInput(context: ResolvedCommandContext, path: string): Promise<Uint8Array> {
  try {
    return await context.fs.readFileBuffer(context.fs.resolvePath(context.cwd, path));
  } catch (error) {
    if (isFileSystemError(error)) {
      throw new MagickError(`cannot read ${path}: ${error.message}`);
    }

    throw error;
  }
}

async function writeOutput(context: ResolvedCommandContext, path: string, bytes: Uint8Array): Promise<void> {
  try {
    await context.fs.writeFile(context.fs.resolvePath(context.cwd, path), bytes);
  } catch (error) {
    if (isFileSystemError(error)) {
      throw new MagickError(`cannot write ${path}: ${error.message}`);
    }

    throw error;
  }
}

/**
 * Checked with the sizes a step will produce, before it runs, so no image list magick holds can
 * outgrow the sandbox Lambda's memory.
 */
function assertWithinPixelLimits(sizes: ReadonlyArray<ImageSize>, operation: string): void {
  for (const size of sizes) {
    if (size.width * size.height > maximumImagePixels) {
      throw new MagickError(
        `${operation} would make a ${size.width}x${size.height} image, over the ${maximumImagePixels} pixel limit: resize first`,
      );
    }
  }

  const listPixels = sizes.reduce((sum, size) => sum + size.width * size.height, 0);
  if (listPixels > maximumListPixels) {
    throw new MagickError(
      `${operation} would hold ${listPixels} pixels across the image list, over the ${maximumListPixels} pixel limit: `
        + "use fewer or smaller images",
    );
  }
}

/** Stops between steps once the bash command is aborted or magick's time is up. */
function assertCanContinue(context: ResolvedCommandContext, settings: MagickSettings): void {
  context.executionScope?.throwIfAborted("magick");
  context.signal?.throwIfAborted();
  assertTimeLeft(settings);
}

/** Applies an operator to every image in the list, one at a time so one decode is in flight. */
async function mapImages(
  context: ResolvedCommandContext,
  state: MagickState,
  operator: string,
  outputSize: (image: RawImage) => ImageSize,
  apply: (image: RawImage) => Promise<RawImage>,
): Promise<MagickState> {
  if (state.images.length === 0) {
    throw new MagickError(`${operator} needs an input image before it`);
  }

  assertWithinPixelLimits(state.images.map(outputSize), operator);
  const images: Array<RawImage> = [];
  for (const image of state.images) {
    assertCanContinue(context, state.settings);
    images.push(await apply(image));
  }

  return { ...state, images };
}

async function readImage(context: ResolvedCommandContext, state: MagickState, path: string): Promise<MagickState> {
  const bytes = await readInput(context, path);
  const info = await identifyImage(bytes, path, state.settings);
  assertWithinPixelLimits([...state.images, info], `reading ${path}`);
  const image = await decodeImage(bytes, path, state.settings);
  return { ...state, images: [...state.images, image] };
}

/** Crop, flip and flop never enlarge an image, so the list keeps within the limits it already met. */
const sameSize = (image: RawImage): ImageSize => image;

async function applyStep(context: ResolvedCommandContext, state: MagickState, step: MagickStep): Promise<MagickState> {
  const settings = state.settings;
  switch (step.kind) {
    case "read":
      return readImage(context, state, step.path);
    case "resize":
      return mapImages(
        context,
        state,
        "-resize",
        (image) => resizedSize(image, step.geometry),
        (image) => resizeImage(image, step.geometry, settings),
      );
    case "crop":
      return mapImages(context, state, "-crop", sameSize, (image) => cropImage(image, step.geometry, settings));
    case "rotate":
      return mapImages(
        context,
        state,
        "-rotate",
        (image) => rotatedSize(image, step.degrees),
        (image) => rotateImage(image, step.degrees, settings),
      );
    case "flip":
      return mapImages(context, state, "-flip", sameSize, (image) => flipImage(image, settings));
    case "flop":
      return mapImages(context, state, "-flop", sameSize, (image) => flopImage(image, settings));
    case "extent":
      return mapImages(
        context,
        state,
        "-extent",
        () => ({ width: step.width, height: step.height }),
        (image) => extentImage(image, step.width, step.height, settings),
      );
    case "append": {
      const operator = step.direction === "horizontal" ? "+append" : "-append";
      if (state.images.length === 0) {
        throw new MagickError(`${operator} needs input images before it`);
      }

      assertWithinPixelLimits([appendedSize(state.images, step.direction)], operator);
      return { ...state, images: [await appendImages(state.images, step.direction, settings)] };
    }
    case "autoOrient":
      // Reading an image already applies its EXIF orientation.
      return state;
    case "background":
      assertBackgroundColor(step.color, settings);
      return { ...state, settings: { ...settings, background: step.color } };
    case "gravity":
      return { ...state, settings: { ...settings, gravity: step.gravity } };
    case "quality":
      return { ...state, quality: step.quality };
  }
}

/** At most maximumMagickSeconds, and never past the bash command's own time limit. */
function computeDeadlineMs(context: ResolvedCommandContext): number {
  if (context.executionScope === undefined) {
    throw new Error("magick runs only as a command of a bash execution, which supplies its time budget.");
  }

  return Date.now() + Math.min(maximumMagickSeconds * 1_000, context.executionScope.remainingTimeMs());
}

async function runMagick(args: ReadonlyArray<string>, context: ResolvedCommandContext): Promise<ExecResult> {
  const invocation = parseMagickArguments(args);
  // ImageMagick's defaults: a white background and images placed at the top left.
  const settings: MagickSettings = {
    sharp: await loadSharp(),
    background: "white",
    gravity: "northwest",
    deadlineMs: computeDeadlineMs(context),
  };
  if (invocation.kind === "identify") {
    const lines: Array<string> = [];
    for (const path of invocation.paths) {
      assertCanContinue(context, settings);
      const info = await identifyImage(await readInput(context, path), path, settings);
      lines.push(`${path} ${info.format.toUpperCase()} ${info.width}x${info.height}\n`);
    }

    return { stdout: lines.join(""), stderr: "", exitCode: 0 };
  }

  let state: MagickState = { images: [], settings, quality: null };
  for (const step of invocation.steps) {
    assertCanContinue(context, state.settings);
    state = await applyStep(context, state, step);
  }

  if (state.images.length !== 1) {
    throw new MagickError(
      `${state.images.length} images reach the output, which takes one: join them with +append or -append, or run one magick per image`,
    );
  }

  assertCanContinue(context, state.settings);
  await writeOutput(context, invocation.outputPath, await encodeImage(state.images[0], invocation.outputFormat, state.quality, state.settings));
  return { stdout: "", stderr: "", exitCode: 0 };
}

/** An ImageMagick-style command over the sandbox file system, built on sharp. */
export function createMagickCommand(): Command {
  return {
    name: "magick",
    execute: async (args, context): Promise<ExecResult> => {
      try {
        return await runMagick(args, context);
      } catch (error) {
        if (error instanceof MagickError) {
          return { stdout: "", stderr: `magick: ${error.message}\n`, exitCode: 1 };
        }

        throw error;
      }
    },
  };
}
