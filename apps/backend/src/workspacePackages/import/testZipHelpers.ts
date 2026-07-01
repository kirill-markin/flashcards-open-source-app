import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import type {
  WorkspacePackageCardsJsonV1,
} from "../types";

export type TestZipEntry = Readonly<{
  path: string;
  bytes: Buffer;
  compressionMethod?: number;
  uncompressedSize?: number;
}>;

type TestCentralDirectoryEntry = Readonly<{
  pathBytes: Buffer;
  entry: TestZipEntry;
  localHeaderOffset: number;
}>;

const zipLocalFileHeaderSignature = 0x04034b50;
const zipCentralDirectoryHeaderSignature = 0x02014b50;
const zipEndOfCentralDirectorySignature = 0x06054b50;
const zipVersionNeededToExtract = 20;
const zipStoredCompressionMethod = 0;
const zipDeflatedCompressionMethod = 8;
const zipDosTimeMidnight = 0;
const zipDosDateJanuaryFirst1980 = 33;

export function createCardsJsonBuffer(cardsJson: WorkspacePackageCardsJsonV1): Buffer {
  return Buffer.from(JSON.stringify(cardsJson), "utf8");
}

function getTestZipEntryCompressionMethod(entry: TestZipEntry): number {
  return entry.compressionMethod ?? zipStoredCompressionMethod;
}

function getTestZipEntryUncompressedSize(entry: TestZipEntry): number {
  return entry.uncompressedSize ?? entry.bytes.byteLength;
}

export function createDeflatedZipEntry(
  path: string,
  uncompressedBytes: Buffer,
  declaredUncompressedSize: number,
): TestZipEntry {
  return {
    path,
    bytes: deflateRawSync(uncompressedBytes),
    compressionMethod: zipDeflatedCompressionMethod,
    uncompressedSize: declaredUncompressedSize,
  };
}

function createLocalFileHeader(pathBytes: Buffer, entry: TestZipEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(zipLocalFileHeaderSignature, 0);
  header.writeUInt16LE(zipVersionNeededToExtract, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(getTestZipEntryCompressionMethod(entry), 8);
  header.writeUInt16LE(zipDosTimeMidnight, 10);
  header.writeUInt16LE(zipDosDateJanuaryFirst1980, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(entry.bytes.byteLength, 18);
  header.writeUInt32LE(getTestZipEntryUncompressedSize(entry), 22);
  header.writeUInt16LE(pathBytes.byteLength, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, pathBytes]);
}

function createCentralDirectoryHeader(entry: TestCentralDirectoryEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(zipCentralDirectoryHeaderSignature, 0);
  header.writeUInt16LE(zipVersionNeededToExtract, 4);
  header.writeUInt16LE(zipVersionNeededToExtract, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(getTestZipEntryCompressionMethod(entry.entry), 10);
  header.writeUInt16LE(zipDosTimeMidnight, 12);
  header.writeUInt16LE(zipDosDateJanuaryFirst1980, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(entry.entry.bytes.byteLength, 20);
  header.writeUInt32LE(getTestZipEntryUncompressedSize(entry.entry), 24);
  header.writeUInt16LE(entry.pathBytes.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);

  return Buffer.concat([header, entry.pathBytes]);
}

function createEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(zipEndOfCentralDirectorySignature, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);

  return header;
}

export function createStoredZip(entries: ReadonlyArray<TestZipEntry>): Buffer {
  const localFileParts: Array<Buffer> = [];
  const centralDirectoryEntries: Array<TestCentralDirectoryEntry> = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, "utf8");
    const localFileHeader = createLocalFileHeader(pathBytes, entry);
    localFileParts.push(localFileHeader, entry.bytes);
    centralDirectoryEntries.push({
      pathBytes,
      entry,
      localHeaderOffset,
    });
    localHeaderOffset += localFileHeader.byteLength + entry.bytes.byteLength;
  }

  const centralDirectoryOffset = localHeaderOffset;
  const centralDirectoryParts = centralDirectoryEntries.map(createCentralDirectoryHeader);
  const centralDirectorySize = centralDirectoryParts.reduce((totalSize, part) => totalSize + part.byteLength, 0);

  return Buffer.concat([
    ...localFileParts,
    ...centralDirectoryParts,
    createEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset),
  ]);
}

export function createPackageZip(
  cardsJson: WorkspacePackageCardsJsonV1,
  mediaEntries: ReadonlyArray<TestZipEntry>,
): Buffer {
  return createStoredZip([
    {
      path: "cards.json",
      bytes: createCardsJsonBuffer(cardsJson),
    },
    ...mediaEntries,
  ]);
}
