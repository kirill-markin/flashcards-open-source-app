import { zstdDecompressSync } from "node:zlib";
import { unzipSync, type UnzipFileInfo } from "fflate";
import { z } from "zod";
import { cutHeadAtCodePoint } from "../shared/codePointCuts";
import { maximumDerivedFileCount } from "./contract";
import { DerivativeRefusal } from "./derivativeRefusal";
import type { SlotFile } from "./slotUploads";

const mebibyte = 1024 * 1024;
const maximumArchiveEntryBytes = 50 * mebibyte;
const maximumArchiveTotalBytes = 200 * mebibyte;
const maximumQuotedEntryNameChars = 120;

/** Anki's own package versions: the collection file each one keeps its notes in. */
const ankiCollectionNameByVersion: Readonly<Record<number, string>> = {
  1: "collection.anki2",
  2: "collection.anki21",
  3: "collection.anki21b",
};
const latestAnkiPackageVersion = 3;
const legacyAnkiMediaSchema = z.record(z.string(), z.string());

function formatMebibytes(bytes: number): string {
  return `${(bytes / mebibyte).toFixed(1)} MB`;
}

/** Sizes come from the central directory, which fflate also sizes each output buffer by. */
function listArchiveEntries(bytes: Uint8Array): ReadonlyArray<UnzipFileInfo> {
  const entries: Array<UnzipFileInfo> = [];
  unzipSync(bytes, {
    filter: (entry) => {
      entries.push(entry);
      return false;
    },
  });
  return entries;
}

/** A relative path of plain names: no absolute path, backslash, control character, or `.`/`..`/empty segment. */
function isSafeEntryName(name: string): boolean {
  return !name.startsWith("/")
    && !/[\\\p{Cc}]/u.test(name)
    && name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function findArchiveRefusal(files: ReadonlyArray<UnzipFileInfo>): string | null {
  if (files.length > maximumDerivedFileCount) {
    return `the archive holds ${files.length} files, and at most ${maximumDerivedFileCount} are extracted`;
  }

  const unsafeEntry = files.find((entry) => !isSafeEntryName(entry.name));
  if (unsafeEntry !== undefined) {
    return `the archive has an unsafe entry name: ${cutHeadAtCodePoint(unsafeEntry.name, maximumQuotedEntryNameChars)}`;
  }

  const largeEntry = files.find((entry) => entry.originalSize > maximumArchiveEntryBytes);
  if (largeEntry !== undefined) {
    return `${cutHeadAtCodePoint(largeEntry.name, maximumQuotedEntryNameChars)} unpacks to `
      + `${formatMebibytes(largeEntry.originalSize)}, and one entry may unpack to at most ${formatMebibytes(maximumArchiveEntryBytes)}`;
  }

  const totalBytes = files.reduce((total, entry) => total + entry.originalSize, 0);
  return totalBytes > maximumArchiveTotalBytes
    ? `the archive unpacks to ${formatMebibytes(totalBytes)}, and at most ${formatMebibytes(maximumArchiveTotalBytes)} are extracted`
    : null;
}

/** Every file entry under `<path>.d/`, or nothing when one entry or the archive is over a limit. */
export function deriveZipEntries(path: string, bytes: Uint8Array): ReadonlyArray<SlotFile> {
  const files = listArchiveEntries(bytes).filter((entry) => !entry.name.endsWith("/"));
  const refusal = findArchiveRefusal(files);
  if (refusal !== null) {
    throw new DerivativeRefusal(refusal);
  }

  const unzipped = unzipSync(bytes, { filter: (entry) => !entry.name.endsWith("/") });
  return files.map((entry) => ({ path: `${path}.d/${entry.name}`, bytes: unzipped[entry.name] }));
}

function readVarint(bytes: Uint8Array, offset: number): Readonly<{ value: number; next: number }> {
  let value = 0;
  for (let index = offset, shift = 0; index < bytes.length && shift < 35; index += 1, shift += 7) {
    value += (bytes[index] & 0x7f) * 2 ** shift;
    if ((bytes[index] & 0x80) === 0) {
      return { value, next: index + 1 };
    }
  }

  throw new DerivativeRefusal("the Anki package has an unreadable meta file");
}

/** Field 1 of Anki's `PackageMetadata` protobuf; proto3 leaves an unset version 0, which Anki calls unknown. */
function readAnkiPackageVersion(meta: Uint8Array): number {
  let version = 0;
  for (let offset = 0; offset < meta.length;) {
    const tag = readVarint(meta, offset);
    const wireType = tag.value % 8;
    if (wireType === 0) {
      const field = readVarint(meta, tag.next);
      version = Math.floor(tag.value / 8) === 1 ? field.value : version;
      offset = field.next;
    } else if (wireType === 2) {
      const length = readVarint(meta, tag.next);
      offset = length.next + length.value;
    } else if (wireType === 1 || wireType === 5) {
      offset = tag.next + (wireType === 1 ? 8 : 4);
    } else {
      throw new DerivativeRefusal("the Anki package has an unreadable meta file");
    }
  }

  return version;
}

/**
 * Without a `meta` file, as before Anki 2.1.50, a `collection.anki21` is the real collection and the
 * `collection.anki2` beside it a stub for older clients; that is also how Anki itself reads such a package.
 */
function resolveAnkiPackageVersion(bytes: Uint8Array, entryNames: ReadonlySet<string>): number {
  if (!entryNames.has("meta")) {
    return entryNames.has("collection.anki21") ? 2 : 1;
  }

  const version = readAnkiPackageVersion(unzipSync(bytes, { filter: (entry) => entry.name === "meta" }).meta);
  if (version < 1 || version > latestAnkiPackageVersion) {
    throw new DerivativeRefusal(`the Anki package has format version ${version}, which this reader does not know`);
  }

  return version;
}

function readLegacyAnkiMediaNames(media: Uint8Array): ReadonlyArray<string> {
  const parsed = legacyAnkiMediaSchema.safeParse(JSON.parse(Buffer.from(media).toString("utf8")));
  if (!parsed.success) {
    throw new DerivativeRefusal("the Anki package's media list is not a JSON object of file names");
  }

  return Object.entries(parsed.data)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, name]) => name);
}

/**
 * The collection as `<path>.d/collection.sqlite`, chosen by the package version because a current export
 * also carries a stub `collection.anki2`, plus `<path>.d/media.json`, the media file names, when the
 * package lists them as JSON. A version 3 package lists them as protobuf, which is not read.
 */
export function deriveAnkiPackageFiles(path: string, bytes: Uint8Array): ReadonlyArray<SlotFile> {
  const entries = listArchiveEntries(bytes);
  const entryNames = new Set(entries.map((entry) => entry.name));
  const version = resolveAnkiPackageVersion(bytes, entryNames);
  const collectionName = ankiCollectionNameByVersion[version];
  const collectionEntry = entries.find((entry) => entry.name === collectionName);
  if (collectionEntry === undefined) {
    throw new DerivativeRefusal(`the Anki package has no ${collectionName}`);
  }

  const mediaEntry = version === latestAnkiPackageVersion ? undefined : entries.find((entry) => entry.name === "media");
  if (collectionEntry.originalSize > maximumArchiveTotalBytes || (mediaEntry?.originalSize ?? 0) > maximumArchiveEntryBytes) {
    throw new DerivativeRefusal(
      `the Anki package unpacks to more than ${formatMebibytes(maximumArchiveTotalBytes)}, which is not extracted`,
    );
  }

  const unzipped = unzipSync(bytes, {
    filter: (entry) => entry.name === collectionName || (mediaEntry !== undefined && entry.name === "media"),
  });
  const collection = version === latestAnkiPackageVersion
    ? zstdDecompressSync(unzipped[collectionName], { maxOutputLength: maximumArchiveTotalBytes })
    : unzipped[collectionName];
  const collectionFile: SlotFile = { path: `${path}.d/collection.sqlite`, bytes: collection };
  if (mediaEntry === undefined) {
    return [collectionFile];
  }

  return [
    collectionFile,
    { path: `${path}.d/media.json`, bytes: Buffer.from(JSON.stringify(readLegacyAnkiMediaNames(unzipped.media))) },
  ];
}
