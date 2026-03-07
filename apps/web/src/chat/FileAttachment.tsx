import { useRef, type ReactElement } from "react";

export type PendingAttachment = Readonly<{
  fileName: string;
  mediaType: string;
  base64Data: string;
}>;

type Props = Readonly<{
  onAttach: (attachment: PendingAttachment) => void;
}>;

const ACCEPTED_TYPES = "image/*,.pdf,.txt,.csv,.json,.xml,.xlsx,.xls,.md,.html,.py,.js,.ts,.yaml,.yml,.sql,.log,.docx";
const IMAGE_COMPRESS_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function checkFileSize(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    return `File "${file.name}" is too large (${sizeMb} MB). Maximum allowed size is ${limitMb} MB.`;
  }

  return null;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function compressImage(file: File): Promise<Readonly<{ base64Data: string; mediaType: string }>> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");

      if (context === null) {
        reject(new Error(`Canvas 2D context unavailable — cannot compress image: ${file.name}`));
        return;
      }

      context.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64Data = dataUrl.split(",")[1];
      resolve({ base64Data, mediaType: "image/jpeg" });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    image.src = objectUrl;
  });
}

export async function prepareAttachment(file: File): Promise<PendingAttachment> {
  if (IMAGE_COMPRESS_TYPES.has(file.type)) {
    const compressedImage = await compressImage(file);
    return {
      fileName: file.name,
      mediaType: compressedImage.mediaType,
      base64Data: compressedImage.base64Data,
    };
  }

  return {
    fileName: file.name,
    mediaType: file.type || "application/octet-stream",
    base64Data: await readFileAsBase64(file),
  };
}

export function FileAttachment(props: Props): ReactElement {
  const { onAttach } = props;
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

      onAttach(await prepareAttachment(file));
    }

    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: "none" }}
        onChange={() => void handleChange()}
      />
      <button
        type="button"
        className="chat-attach-btn"
        onClick={() => inputRef.current?.click()}
      >
        Attach
      </button>
    </>
  );
}
