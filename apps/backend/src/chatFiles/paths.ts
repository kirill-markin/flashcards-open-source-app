const chatFilesDirectoryPath = "/files/";
const fallbackChatFileName = "file";
// Keeps a name inside common file system limits (255 bytes) and far below the btree row limit of the
// unique (session_id, path) index.
const maximumChatFileNameBytes = 200;
const maximumPreservedExtensionBytes = 16;

const imageExtensionByMediaType: Readonly<Record<string, string>> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ChatFilePathRequest =
  | Readonly<{ type: "image"; mediaType: string }>
  | Readonly<{ type: "file"; fileName: string }>;

type SplitFileName = Readonly<{
  stem: string;
  extension: string;
}>;

function splitFileExtension(fileName: string): SplitFileName {
  const extensionStart = fileName.lastIndexOf(".");
  if (extensionStart <= 0) {
    return { stem: fileName, extension: "" };
  }

  return {
    stem: fileName.slice(0, extensionStart),
    extension: fileName.slice(extensionStart),
  };
}

function truncateToUtf8Bytes(value: string, maximumBytes: number): string {
  let truncated = "";
  let truncatedBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (truncatedBytes + characterBytes > maximumBytes) {
      return truncated;
    }

    truncated += character;
    truncatedBytes += characterBytes;
  }

  return truncated;
}

/**
 * Keeps the last path segment and every Unicode character except control characters and leading dots;
 * an over-long name keeps its extension and loses the end of its stem.
 */
export function sanitizeChatFileName(fileName: string): string {
  const lastSegment = fileName.split(/[\\/]/u).at(-1) ?? "";
  const sanitizedName = lastSegment.replace(/\p{Cc}/gu, "").trim().replace(/^\.+/u, "").trim();
  if (sanitizedName === "") {
    return fallbackChatFileName;
  }

  if (Buffer.byteLength(sanitizedName) <= maximumChatFileNameBytes) {
    return sanitizedName;
  }

  const { stem, extension } = splitFileExtension(sanitizedName);
  const extensionBytes = Buffer.byteLength(extension);
  if (extensionBytes > maximumPreservedExtensionBytes) {
    return truncateToUtf8Bytes(sanitizedName, maximumChatFileNameBytes);
  }

  return `${truncateToUtf8Bytes(stem, maximumChatFileNameBytes - extensionBytes)}${extension}`;
}

function buildNumberedFileName(fileName: string, copyNumber: number): string {
  if (copyNumber === 1) {
    return fileName;
  }

  const { stem, extension } = splitFileExtension(fileName);
  return `${stem} (${copyNumber})${extension}`;
}

/**
 * `/files/<sanitized name>`, or `/files/image-<n>.<ext>` for an image, which arrives without a name. A
 * name already taken in the session gets ` (2)`, ` (3)`, ... before its extension.
 */
export function allocateChatFilePath(
  request: ChatFilePathRequest,
  takenPaths: ReadonlySet<string>,
): string {
  if (request.type === "image") {
    const extension = imageExtensionByMediaType[request.mediaType];
    if (extension === undefined) {
      throw new Error(`Chat image media type has no file extension: ${request.mediaType}`);
    }

    for (let imageNumber = 1; ; imageNumber += 1) {
      const path = `${chatFilesDirectoryPath}image-${imageNumber}.${extension}`;
      if (!takenPaths.has(path)) {
        return path;
      }
    }
  }

  const fileName = sanitizeChatFileName(request.fileName);
  for (let copyNumber = 1; ; copyNumber += 1) {
    const path = `${chatFilesDirectoryPath}${buildNumberedFileName(fileName, copyNumber)}`;
    if (!takenPaths.has(path)) {
      return path;
    }
  }
}
