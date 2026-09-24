export type TextImportCard = Readonly<{
  id: string;
  frontText: string;
  backText: string;
  isValid: boolean;
}>;

export type TextImportSeparators = Readonly<{
  fieldSeparator: string;
  cardSeparator: string;
}>;

export function parseTextImport(
  source: string,
  separators: TextImportSeparators,
): ReadonlyArray<TextImportCard> {
  if (separators.fieldSeparator === "") {
    throw new TypeError("fieldSeparator must not be empty");
  }
  if (separators.cardSeparator === "") {
    throw new TypeError("cardSeparator must not be empty");
  }

  return source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(separators.cardSeparator)
    .map((record, index): TextImportCard | null => {
      if (record.trim() === "") {
        return null;
      }

      const separatorIndex = record.indexOf(separators.fieldSeparator);
      const frontText = (separatorIndex === -1 ? record : record.slice(0, separatorIndex)).trim();
      const backText = (separatorIndex === -1
        ? ""
        : record.slice(separatorIndex + separators.fieldSeparator.length)).trim();

      return {
        id: `source-row-${index + 1}`,
        frontText,
        backText,
        isValid: frontText !== "" && backText !== "",
      };
    })
    .filter((card): card is TextImportCard => card !== null);
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let tableIndex = 0; tableIndex < table.length; tableIndex += 1) {
    let value = tableIndex;
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[tableIndex] = value >>> 0;
  }
  return table;
}

const crc32Table = buildCrc32Table();

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenateBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function createSingleFileZip(fileName: string, content: Uint8Array): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(fileName);
  const crc32 = calculateCrc32(content);
  const utf8Flag = 0x0800;
  const localHeader = new Uint8Array(30);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, utf8Flag, true);
  localView.setUint16(8, 0, true);
  localView.setUint32(14, crc32, true);
  localView.setUint32(18, content.byteLength, true);
  localView.setUint32(22, content.byteLength, true);
  localView.setUint16(26, fileNameBytes.byteLength, true);

  const centralHeader = new Uint8Array(46);
  const centralView = new DataView(centralHeader.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, utf8Flag, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint32(16, crc32, true);
  centralView.setUint32(20, content.byteLength, true);
  centralView.setUint32(24, content.byteLength, true);
  centralView.setUint16(28, fileNameBytes.byteLength, true);

  const centralDirectoryOffset = localHeader.byteLength + fileNameBytes.byteLength + content.byteLength;
  const centralDirectorySize = centralHeader.byteLength + fileNameBytes.byteLength;
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, centralDirectoryOffset, true);

  return concatenateBytes([
    localHeader,
    fileNameBytes,
    content,
    centralHeader,
    fileNameBytes,
    endOfCentralDirectory,
  ]);
}

export function createTextImportPackageFile(
  cards: ReadonlyArray<TextImportCard>,
  tags: ReadonlyArray<string> = [],
): File {
  if (cards.length === 0 || cards.some((card) => card.isValid === false)) {
    throw new TypeError("cards must contain at least one valid card");
  }

  const cardsJson = JSON.stringify({
    formatVersion: 1,
    cards: cards.map((card) => ({
      frontText: card.frontText.trim(),
      backText: card.backText.trim(),
      tags: [...tags],
      cardType: "basic",
      metadata: {
        version: 1,
        source: null,
      },
    })),
  });
  const zipBytes = createSingleFileZip("cards.json", new TextEncoder().encode(cardsJson));
  const zipBuffer = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength,
  ) as ArrayBuffer;

  return new File([zipBuffer], "pasted-cards.zip", { type: "application/zip" });
}
