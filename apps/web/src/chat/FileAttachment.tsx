import { useRef, type ReactElement } from "react";

export type PendingAttachment = Readonly<{
  fileName: string;
  mediaType: string;
  base64Data: string;
}>;

type Props = Readonly<{
  onAttach: (attachment: PendingAttachment) => Promise<void> | void;
  disabled?: boolean;
}>;

export type ImageCompressionOptions = Readonly<{
  maxSidePixels: number;
  quality: number;
}>;

const ACCEPTED_TYPES = "image/*,.pdf,.txt,.csv,.json,.xml,.xlsx,.xls,.md,.html,.py,.js,.ts,.yaml,.yml,.sql,.log,.docx";
const IMAGE_MEDIA_TYPE_PREFIX = "image/";
const HEIC_MEDIA_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const MB = 1024 * 1024;

export const IMAGE_RAW_MAX_FILE_SIZE_BYTES = 40 * MB;
export const NON_IMAGE_RAW_MAX_FILE_SIZE_BYTES = 20 * MB;

export const AGGRESSIVE_IMAGE_COMPRESSION: ImageCompressionOptions = {
  maxSidePixels: 2_048,
  quality: 0.8,
};

export const EXTRA_AGGRESSIVE_IMAGE_COMPRESSION: ImageCompressionOptions = {
  maxSidePixels: 1_280,
  quality: 0.55,
};

function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith(IMAGE_MEDIA_TYPE_PREFIX);
}

function isHeicMediaType(mediaType: string): boolean {
  return HEIC_MEDIA_TYPES.has(mediaType.toLowerCase());
}

function hasHeicFileExtension(fileName: string): boolean {
  const normalizedFileName = fileName.toLowerCase();
  return normalizedFileName.endsWith(".heic") || normalizedFileName.endsWith(".heif");
}

function isImageFile(file: File): boolean {
  return isImageMediaType(file.type) || hasHeicFileExtension(file.name);
}

function isHeicFile(file: File): boolean {
  return isHeicMediaType(file.type) || hasHeicFileExtension(file.name);
}

function fileSizeLimitBytes(file: File): number {
  if (isImageFile(file)) {
    return IMAGE_RAW_MAX_FILE_SIZE_BYTES;
  }

  return NON_IMAGE_RAW_MAX_FILE_SIZE_BYTES;
}

function extractBase64Data(dataUrl: string, fileName: string): string {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex <= 0 || separatorIndex >= dataUrl.length - 1) {
    throw new Error(`Failed to read base64 data from file: ${fileName}`);
  }

  return dataUrl.slice(separatorIndex + 1);
}

export function checkFileSize(file: File): string | null {
  const sizeLimitBytes = fileSizeLimitBytes(file);
  if (file.size > sizeLimitBytes) {
    const sizeMb = (file.size / MB).toFixed(1);
    const limitMb = (sizeLimitBytes / MB).toFixed(0);
    if (isImageFile(file)) {
      return `Image "${file.name}" is too large (${sizeMb} MB). Maximum allowed image size before compression is ${limitMb} MB.`;
    }

    return `File "${file.name}" is too large (${sizeMb} MB). Maximum allowed size is ${limitMb} MB.`;
  }

  return null;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = extractBase64Data(result, file.name);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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

function compressImageBlob(
  blob: Blob,
  fileName: string,
  options: ImageCompressionOptions,
): Promise<Readonly<{ base64Data: string; mediaType: "image/jpeg" }>> {
  return loadImageFromBlob(blob, fileName).then((image) => {
    const scaledDimensions = getScaledDimensions(image.naturalWidth, image.naturalHeight, options.maxSidePixels);
    const canvas = document.createElement("canvas");
    canvas.width = scaledDimensions.width;
    canvas.height = scaledDimensions.height;
    const context = canvas.getContext("2d");

    if (context === null) {
      throw new Error(`Canvas 2D context unavailable — cannot compress image: ${fileName}`);
    }

    context.drawImage(image, 0, 0, scaledDimensions.width, scaledDimensions.height);
    const dataUrl = canvas.toDataURL("image/jpeg", options.quality);
    const base64Data = extractBase64Data(dataUrl, fileName);
    return { base64Data, mediaType: "image/jpeg" };
  });
}

type HeicToInput = Readonly<{
  blob: Blob;
  type: string;
  quality: number;
}>;

type HeicToFunction = (input: HeicToInput) => Promise<Blob>;

async function convertHeicToJpegBlob(file: File): Promise<Blob> {
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

function base64DataToBlob(base64Data: string, mediaType: string): Blob {
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

async function prepareImageAttachment(
  file: File,
  options: ImageCompressionOptions,
): Promise<PendingAttachment> {
  const imageBlob = isHeicFile(file)
    ? await convertHeicToJpegBlob(file)
    : file;
  const compressedImage = await compressImageBlob(imageBlob, file.name, options);

  return {
    fileName: file.name,
    mediaType: compressedImage.mediaType,
    base64Data: compressedImage.base64Data,
  };
}

export async function recompressImageAttachment(
  attachment: PendingAttachment,
  options: ImageCompressionOptions,
): Promise<PendingAttachment> {
  if (!isImageMediaType(attachment.mediaType)) {
    throw new Error(`Cannot recompress non-image attachment: ${attachment.fileName}`);
  }

  const sourceBlob = base64DataToBlob(attachment.base64Data, attachment.mediaType);
  const compressedImage = await compressImageBlob(sourceBlob, attachment.fileName, options);

  return {
    fileName: attachment.fileName,
    mediaType: compressedImage.mediaType,
    base64Data: compressedImage.base64Data,
  };
}

export async function prepareAttachment(file: File): Promise<PendingAttachment> {
  if (isImageFile(file)) {
    try {
      return await prepareImageAttachment(file, AGGRESSIVE_IMAGE_COMPRESSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to process image "${file.name}". Please try another image format or a smaller file. ${message}`,
      );
    }
  }

  return {
    fileName: file.name,
    mediaType: file.type || "application/octet-stream",
    base64Data: await readFileAsBase64(file),
  };
}

export function FileAttachment(props: Props): ReactElement {
  const { onAttach } = props;
  const disabled = props.disabled === true;
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(): Promise<void> {
    const files = inputRef.current?.files;
    if (files === undefined || files === null) {
      return;
    }

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const sizeError = checkFileSize(file);
      if (sizeError !== null) {
        window.alert(sizeError);
        continue;
      }

      try {
        await onAttach(await prepareAttachment(file));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
      }
    }

    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        name="chatAttachments"
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: "none" }}
        disabled={disabled}
        onChange={() => void handleChange()}
      />
      <button
        type="button"
        className="chat-attach-btn"
        disabled={disabled}
        aria-label="Add attachment"
        title="Add attachment"
        onClick={() => inputRef.current?.click()}
      >
        <svg
          className="chat-attach-btn-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.5 13.5 16 8a3.182 3.182 0 1 1 4.5 4.5l-8 8a5.303 5.303 0 0 1-7.5-7.5l8.5-8.5" />
        </svg>
      </button>
    </>
  );
}
