export type MagickGravity = "northwest" | "center";
export type MagickOutputFormat = "jpeg" | "png" | "webp";

/** `shrinkOnly` is ImageMagick's `>` suffix: only images larger than the geometry change. */
export type MagickResizeGeometry =
  | Readonly<{ kind: "fit"; width: number; height: number; shrinkOnly: boolean }>
  | Readonly<{ kind: "width"; width: number; shrinkOnly: boolean }>
  | Readonly<{ kind: "height"; height: number; shrinkOnly: boolean }>
  | Readonly<{ kind: "percent"; percent: number }>;

export type MagickCropGeometry = Readonly<{ width: number; height: number; x: number; y: number }>;

/** Inputs, operators and settings in command-line order, which is the order ImageMagick applies them. */
export type MagickStep =
  | Readonly<{ kind: "read"; path: string }>
  | Readonly<{ kind: "resize"; geometry: MagickResizeGeometry }>
  | Readonly<{ kind: "crop"; geometry: MagickCropGeometry }>
  | Readonly<{ kind: "rotate"; degrees: number }>
  | Readonly<{ kind: "flip" }>
  | Readonly<{ kind: "flop" }>
  | Readonly<{ kind: "autoOrient" }>
  | Readonly<{ kind: "append"; direction: "horizontal" | "vertical" }>
  | Readonly<{ kind: "background"; color: string }>
  | Readonly<{ kind: "gravity"; gravity: MagickGravity }>
  | Readonly<{ kind: "extent"; width: number; height: number }>
  | Readonly<{ kind: "quality"; quality: number }>;

export type MagickInvocation =
  | Readonly<{ kind: "identify"; paths: ReadonlyArray<string> }>
  | Readonly<{
    kind: "convert";
    steps: ReadonlyArray<MagickStep>;
    outputPath: string;
    outputFormat: MagickOutputFormat;
  }>;

/** A usage, input or limit problem, reported on stderr as `magick: <message>`. */
export class MagickError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MagickError";
  }
}

export const magickUsage = "supported: magick INPUT... [-auto-orient] [-resize WxH|W|xH|N%, with > to only shrink] "
  + "[-crop WxH+X+Y] [-rotate DEG] [-flip] [-flop] "
  + "[-background COLOR] [-gravity center|northwest] [-extent WxH] [+append] [-append] [-quality 1-100] "
  + "OUTPUT.jpg|.jpeg|.png|.webp, or magick identify FILE...";

const outputFormatByExtension: ReadonlyMap<string, MagickOutputFormat> = new Map([
  ["jpg", "jpeg"],
  ["jpeg", "jpeg"],
  ["png", "png"],
  ["webp", "webp"],
]);

function isOption(arg: string): boolean {
  return arg.startsWith("-") || arg.startsWith("+");
}

function parsePositiveInteger(text: string, option: string, value: string): number {
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new MagickError(`${option} ${value}: sizes must be whole numbers of at least 1`);
  }

  return parsed;
}

function parseResizeGeometry(value: string): MagickResizeGeometry {
  const percent = /^(\d+(?:\.\d+)?)%$/u.exec(value);
  if (percent !== null) {
    const parsed = Number(percent[1]);
    if (parsed <= 0) {
      throw new MagickError(`-resize ${value}: the percentage must be above 0`);
    }

    return { kind: "percent", percent: parsed };
  }

  const size = /^(\d*)x?(\d*)(>?)$/u.exec(value);
  if (size === null || (size[1] === "" && size[2] === "")) {
    throw new MagickError(`-resize ${value}: use WxH, W, xH or N%, with > after a size to only shrink`);
  }

  const shrinkOnly = size[3] === ">";
  if (size[2] === "") {
    return { kind: "width", width: parsePositiveInteger(size[1], "-resize", value), shrinkOnly };
  }

  if (size[1] === "") {
    return { kind: "height", height: parsePositiveInteger(size[2], "-resize", value), shrinkOnly };
  }

  return {
    kind: "fit",
    width: parsePositiveInteger(size[1], "-resize", value),
    height: parsePositiveInteger(size[2], "-resize", value),
    shrinkOnly,
  };
}

function parseCropGeometry(value: string): MagickCropGeometry {
  const match = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/u.exec(value);
  if (match === null) {
    throw new MagickError(`-crop ${value}: use WxH+X+Y, such as 200x100+10+20`);
  }

  return {
    width: parsePositiveInteger(match[1], "-crop", value),
    height: parsePositiveInteger(match[2], "-crop", value),
    x: Number(match[3]),
    y: Number(match[4]),
  };
}

function parseSize(option: string, value: string): Readonly<{ width: number; height: number }> {
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (match === null) {
    throw new MagickError(`${option} ${value}: use WxH, such as 800x600`);
  }

  return { width: parsePositiveInteger(match[1], option, value), height: parsePositiveInteger(match[2], option, value) };
}

function parseDegrees(value: string): number {
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(value)) {
    throw new MagickError(`-rotate ${value}: use degrees clockwise, such as 90 or -45`);
  }

  return Number(value);
}

function parseGravity(value: string): MagickGravity {
  const gravity = value.toLowerCase();
  if (gravity !== "center" && gravity !== "northwest") {
    throw new MagickError(`-gravity ${value}: only center and northwest are supported`);
  }

  return gravity;
}

function parseQuality(value: string): number {
  const quality = Number(value);
  if (!/^\d+$/u.test(value) || quality < 1 || quality > 100) {
    throw new MagickError(`-quality ${value}: use a whole number from 1 to 100`);
  }

  return quality;
}

function parseOutputFormat(path: string): MagickOutputFormat {
  const extension = /\.([^./]+)$/u.exec(path)?.[1].toLowerCase();
  const format = extension === undefined ? undefined : outputFormatByExtension.get(extension);
  if (format === undefined) {
    throw new MagickError(`the output ${path} must end in .jpg, .jpeg, .png or .webp, which selects its format`);
  }

  return format;
}

const optionsWithValue: ReadonlySet<string> = new Set([
  "-resize",
  "-crop",
  "-rotate",
  "-background",
  "-gravity",
  "-extent",
  "-quality",
]);

function parseOptionWithValue(option: string, value: string): MagickStep {
  switch (option) {
    case "-resize":
      return { kind: "resize", geometry: parseResizeGeometry(value) };
    case "-crop":
      return { kind: "crop", geometry: parseCropGeometry(value) };
    case "-rotate":
      return { kind: "rotate", degrees: parseDegrees(value) };
    case "-background":
      return { kind: "background", color: value };
    case "-gravity":
      return { kind: "gravity", gravity: parseGravity(value) };
    case "-extent":
      return { kind: "extent", ...parseSize("-extent", value) };
    case "-quality":
      return { kind: "quality", quality: parseQuality(value) };
    default:
      throw new MagickError(`unsupported option ${option}; ${magickUsage}`);
  }
}

function parseFlag(option: string): MagickStep {
  switch (option) {
    case "-flip":
      return { kind: "flip" };
    case "-flop":
      return { kind: "flop" };
    case "-auto-orient":
      return { kind: "autoOrient" };
    case "+append":
      return { kind: "append", direction: "horizontal" };
    case "-append":
      return { kind: "append", direction: "vertical" };
    default:
      throw new MagickError(`unsupported option ${option}; ${magickUsage}`);
  }
}

function parseSteps(args: ReadonlyArray<string>): ReadonlyArray<MagickStep> {
  const steps: Array<MagickStep> = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!isOption(arg)) {
      steps.push({ kind: "read", path: arg });
      continue;
    }

    if (!optionsWithValue.has(arg)) {
      steps.push(parseFlag(arg));
      continue;
    }

    const value = args[index + 1];
    if (value === undefined) {
      throw new MagickError(`${arg} needs a value`);
    }

    steps.push(parseOptionWithValue(arg, value));
    index += 1;
  }

  return steps;
}

/** ImageMagick tools other than magick itself, which models often write as its first argument. */
const otherImageMagickTools: ReadonlySet<string> = new Set(["convert", "mogrify", "montage", "compare"]);

function parseIdentifyPaths(args: ReadonlyArray<string>): ReadonlyArray<string> {
  if (args.length === 0) {
    throw new MagickError("identify needs at least one file");
  }

  const option = args.find(isOption);
  if (option !== undefined) {
    throw new MagickError(`identify takes no options such as ${option}; it prints PATH FORMAT WxH per file; ${magickUsage}`);
  }

  return args;
}

export function parseMagickArguments(args: ReadonlyArray<string>): MagickInvocation {
  if (args[0] === "identify") {
    return { kind: "identify", paths: parseIdentifyPaths(args.slice(1)) };
  }

  if (otherImageMagickTools.has(args[0])) {
    throw new MagickError(`magick ${args[0]} is not supported; write magick INPUT... OUTPUT; ${magickUsage}`);
  }

  const outputPath = args.at(-1);
  if (args.length < 2 || outputPath === undefined || isOption(outputPath)) {
    throw new MagickError(`the last argument must be the output file; ${magickUsage}`);
  }

  return {
    kind: "convert",
    steps: parseSteps(args.slice(0, -1)),
    outputPath,
    outputFormat: parseOutputFormat(outputPath),
  };
}
