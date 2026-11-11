import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync, type Zippable } from "fflate";
import { HttpError } from "../../shared/errors";
import { createAnkiCollection, defaultAnkiExportDeckName } from "./ankiCollection";
import { createAnkiMarkdownRenderer, type AnkiMedia } from "./ankiMarkdown";
import {
  loadWorkspacePackageExport,
  type LoadedWorkspacePackageExport,
  type WorkspacePackageExportPackageInput,
} from "./exportPackage";

export const ankiExportFileName = "flashcards.apkg";
export const ankiExportContentType = "application/apkg";
export const ankiExportMaxInlineBytes = 4 * 1024 * 1024;

export type AnkiWorkspacePackage = Readonly<{
  fileName: typeof ankiExportFileName;
  contentType: typeof ankiExportContentType;
  bytes: Uint8Array<ArrayBuffer>;
}>;

const ankiPlaybackExtensions = new Set(["aac", "flac", "m4a", "mp3", "mp4", "ogg", "wav", "webm"]);
const ankiExtraMediaExtensions: ReadonlyMap<string, string> = new Map([
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/m4a", "m4a"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/webm", "webm"],
  ["video/webm", "webm"],
]);

function toAnkiMedia(path: string, mimeType: string): AnkiMedia {
  const portableFilename = basename(path);
  const extraExtension = ankiExtraMediaExtensions.get(mimeType);
  const filename = extraExtension === undefined
    ? portableFilename
    : portableFilename.replace(/\.bin$/u, "." + extraExtension);
  if (mimeType.startsWith("image/") && !filename.endsWith(".bin")) {
    return { filename: "nibomo-" + filename, kind: "image" };
  }
  if (ankiPlaybackExtensions.has(filename.split(".").at(-1) ?? "")) {
    return { filename: "nibomo-" + filename, kind: "playable" };
  }

  // Anki imports underscore-prefixed files even when referenced by an ordinary link.
  return { filename: "_nibomo-" + filename, kind: "attachment" };
}

export function buildAnkiWorkspacePackage(
  workspaceId: string,
  exported: LoadedWorkspacePackageExport,
  generatedAt: string,
): AnkiWorkspacePackage {
  if (exported.cards.length === 0) {
    throw new HttpError(400, "Select at least one card to export to Anki.", "WORKSPACE_PACKAGE_EXPORT_ANKI_EMPTY");
  }

  const mediaIndex: Record<string, string> = {};
  const mediaByPath = new Map<string, AnkiMedia>();
  const entries: Zippable = {};
  for (const [index, file] of exported.mediaFiles.entries()) {
    const entry = index.toString();
    const media = toAnkiMedia(file.path, file.mimeType);
    mediaIndex[entry] = media.filename;
    mediaByPath.set(file.path, media);
    entries[entry] = [file.bytes, { level: 0 }];
  }

  const renderMarkdown = createAnkiMarkdownRenderer(mediaByPath);
  const directory = mkdtempSync(join(tmpdir(), "nibomo-anki-export-"));
  try {
    const path = join(directory, "collection.anki2");
    const database = new DatabaseSync(path);
    try {
      createAnkiCollection(database, exported.metadata.label, generatedAt, exported.cards.map(({ cardId, card }) => ({
        guid: createHash("sha256").update(workspaceId + "/" + cardId).digest("base64url").slice(0, 22),
        front: renderMarkdown(card.frontText),
        back: renderMarkdown(card.backText),
        tags: card.tags,
      })));
    } finally {
      database.close();
    }

    return {
      fileName: ankiExportFileName,
      contentType: ankiExportContentType,
      bytes: zipSync({
        ...entries,
        "collection.anki2": readFileSync(path),
        media: strToU8(JSON.stringify(mediaIndex)),
      }),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function exportAnkiWorkspacePackage(
  userId: string,
  workspaceId: string,
  input: WorkspacePackageExportPackageInput,
): Promise<AnkiWorkspacePackage> {
  const exported = await loadWorkspacePackageExport(userId, workspaceId, {
    ...input,
    packageMetadata: { ...input.packageMetadata, label: input.packageMetadata.label ?? defaultAnkiExportDeckName },
  });
  return buildAnkiWorkspacePackage(workspaceId, exported, input.generatedAt);
}
