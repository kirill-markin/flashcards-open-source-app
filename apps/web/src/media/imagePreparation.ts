export type ImageCompressionOptions = Readonly<{
  maxSidePixels: number;
  quality: number;
}>;

export type PreparedImageBlob = Readonly<{
  blob: Blob;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}>;

export type ImageCanvasOutputOptions = ImageCompressionOptions & Readonly<{
  mediaType: "image/jpeg";
  backgroundColor: string | null;
}>;

type HeicToInput = Readonly<{
  blob: Blob;
  type: string;
  quality: number;
}>;

type HeicToFunction = (input: HeicToInput) => Promise<Blob>;

const IMAGE_MEDIA_TYPE_PREFIX = "image/";
const HEIC_MEDIA_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const COMMON_IMAGE_FILE_EXTENSIONS = [".gif", ".jpeg", ".jpg", ".png", ".webp"] as const;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type CardImageSourceFormat = "jpeg" | "png" | "webp";

export const CARD_IMAGE_PREPARATION_OPTIONS: ImageCanvasOutputOptions = {
  maxSidePixels: 1_200,
  quality: 0.82,
  mediaType: "image/jpeg",
  backgroundColor: "#f1f3f4",
};

export class UnsupportedImagePreparationError extends Error {
  constructor(fileName: string, causeMessage: string) {
    super(`Unsupported image "${fileName}". ${causeMessage}`);
    this.name = "UnsupportedImagePreparationError";
  }
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith(IMAGE_MEDIA_TYPE_PREFIX);
}

export function isHeicMediaType(mediaType: string): boolean {
  return HEIC_MEDIA_TYPES.has(mediaType.toLowerCase());
}

export function hasHeicFileExtension(fileName: string): boolean {
  const normalizedFileName = fileName.toLowerCase();
  return normalizedFileName.endsWith(".heic") || normalizedFileName.endsWith(".heif");
}

function hasCommonImageFileExtension(fileName: string): boolean {
  const normalizedFileName = fileName.toLowerCase();
  return COMMON_IMAGE_FILE_EXTENSIONS.some((extension) => normalizedFileName.endsWith(extension));
}

export function isImageFileCandidate(file: File): boolean {
  return isImageMediaType(file.type)
    || hasCommonImageFileExtension(file.name)
    || hasHeicFileExtension(file.name);
}

export function isHeicFile(file: File): boolean {
  return isHeicMediaType(file.type) || hasHeicFileExtension(file.name);
}

function extractBase64Data(dataUrl: string, fileName: string): string {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex <= 0 || separatorIndex >= dataUrl.length - 1) {
    throw new Error(`Failed to read base64 data from file: ${fileName}`);
  }

  return dataUrl.slice(separatorIndex + 1);
}

function getScaledDimensions(
  originalWidth: number,
  originalHeight: number,
  maxSidePixels: number,
): Readonly<{ width: number; height: number }> {
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error("Invalid image dimensions");
  }

  const longestSide = Math.max(originalWidth, originalHeight);
  if (longestSide <= maxSidePixels) {
    return {
      width: originalWidth,
      height: originalHeight,
    };
  }

  const scale = maxSidePixels / longestSide;
  return {
    width: Math.max(1, Math.round(originalWidth * scale)),
    height: Math.max(1, Math.round(originalHeight * scale)),
  };
}

function loadImageFromBlob(blob: Blob, fileName: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${fileName}`));
    };

    image.src = objectUrl;
  });
}

function drawImageToCanvas(
  image: HTMLImageElement,
  fileName: string,
  options: ImageCanvasOutputOptions,
): Readonly<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const scaledDimensions = getScaledDimensions(image.naturalWidth, image.naturalHeight, options.maxSidePixels);
  const canvas = document.createElement("canvas");
  canvas.width = scaledDimensions.width;
  canvas.height = scaledDimensions.height;
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error(`Canvas 2D context unavailable - cannot compress image: ${fileName}`);
  }

  if (options.backgroundColor !== null) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, scaledDimensions.width, scaledDimensions.height);
  }

  context.drawImage(image, 0, 0, scaledDimensions.width, scaledDimensions.height);
  return {
    canvas,
    width: scaledDimensions.width,
    height: scaledDimensions.height,
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  fileName: string,
  options: ImageCanvasOutputOptions,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error(`Canvas JPEG output unavailable - cannot compress image: ${fileName}`));
        return;
      }

      resolve(blob);
    }, options.mediaType, options.quality);
  });
}

export function compressImageBlobToBase64(
  blob: Blob,
  fileName: string,
  options: ImageCompressionOptions,
): Promise<Readonly<{ base64Data: string; mediaType: "image/jpeg" }>> {
  return loadImageFromBlob(blob, fileName).then((image) => {
    const outputOptions: ImageCanvasOutputOptions = {
      ...options,
      mediaType: "image/jpeg",
      backgroundColor: null,
    };
    const { canvas } = drawImageToCanvas(image, fileName, outputOptions);
    const dataUrl = canvas.toDataURL(outputOptions.mediaType, outputOptions.quality);
    const base64Data = extractBase64Data(dataUrl, fileName);
    return { base64Data, mediaType: "image/jpeg" };
  });
}

export async function compressImageBlobToJpegBlob(
  blob: Blob,
  fileName: string,
  options: ImageCanvasOutputOptions,
): Promise<PreparedImageBlob> {
  const image = await loadImageFromBlob(blob, fileName);
  const { canvas, width, height } = drawImageToCanvas(image, fileName, options);
  return {
    blob: await canvasToBlob(canvas, fileName, options),
    mediaType: options.mediaType,
    width,
    height,
  };
}

export async function convertHeicToJpegBlob(file: File): Promise<Blob> {
  const heicToModule = await import("heic-to/csp");
  const candidate = "heicTo" in heicToModule ? heicToModule.heicTo : null;
  if (typeof candidate !== "function") {
    throw new Error("HEIC converter is unavailable");
  }

  const heicTo = candidate as HeicToFunction;
  const conversionResult = await heicTo({
    blob: file,
    type: "image/jpeg",
    quality: 0.92,
  });
  return conversionResult;
}

export function base64DataToBlob(base64Data: string, mediaType: string): Blob {
  if (typeof globalThis.atob !== "function") {
    throw new Error("Base64 decoder is unavailable in this environment");
  }

  const binary = globalThis.atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mediaType });
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
    | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24)
    | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8)
    | (bytes[offset + 3] ?? 0)) >>> 0;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function isAnimatedWebpBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LittleEndian(bytes, offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkType === "ANIM") {
      return true;
    }

    if (chunkType === "VP8X" && chunkDataStart < bytes.length && ((bytes[chunkDataStart] ?? 0) & 0x02) !== 0) {
      return true;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  return false;
}

function bytesStartWith(bytes: Uint8Array, expectedPrefix: Uint8Array): boolean {
  return bytes.length >= expectedPrefix.length && expectedPrefix.every((byte, index) => bytes[index] === byte);
}

function detectCardImageSourceFormat(bytes: Uint8Array): CardImageSourceFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (bytesStartWith(bytes, PNG_SIGNATURE)) {
    return "png";
  }

  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }

  return null;
}

function isAnimatedPngBytes(bytes: Uint8Array): boolean {
  if (bytesStartWith(bytes, PNG_SIGNATURE) === false) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32BigEndian(bytes, offset);
    const chunkType = readAscii(bytes, offset + 4, 4);
    if (chunkType === "acTL") {
      return true;
    }

    const nextOffset = offset + 8 + chunkLength + 4;
    if (nextOffset <= offset) {
      return false;
    }

    offset = nextOffset;
  }

  return false;
}

function assertCardImageBytesCanBePrepared(fileName: string, bytes: Uint8Array): void {
  const detectedFormat = detectCardImageSourceFormat(bytes);
  if (detectedFormat === null) {
    throw new UnsupportedImagePreparationError(
      fileName,
      "Expected selected bytes to be a JPEG, PNG, or WebP image source.",
    );
  }

  if (detectedFormat === "webp" && isAnimatedWebpBytes(bytes)) {
    throw new UnsupportedImagePreparationError(
      fileName,
      "Animated WebP images are not supported for card media.",
    );
  }

  if (detectedFormat === "png" && isAnimatedPngBytes(bytes)) {
    throw new UnsupportedImagePreparationError(
      fileName,
      "Animated PNG images are not supported for card media.",
    );
  }
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function prepareCardImageFile(file: File): Promise<PreparedImageBlob> {
  assertCardImageBytesCanBePrepared(file.name, await readFileBytes(file));
  return compressImageBlobToJpegBlob(file, file.name, CARD_IMAGE_PREPARATION_OPTIONS);
}
