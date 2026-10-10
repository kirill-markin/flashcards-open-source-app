import { dirname, join } from "node:path";
import mammoth from "mammoth";
import { unparse } from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { maximumDerivedFileCount } from "./contract";
import { DerivativeRefusal } from "./derivativeRefusal";
import type { SlotFile } from "./slotUploads";

/** pdf.js reads font metrics and character maps from its own package directory. */
function resolvePdfjsDataUrl(directoryName: "cmaps" | "standard_fonts"): string {
  return `${join(dirname(require.resolve("pdfjs-dist/package.json")), directoryName)}/`;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Every page's text under a `--- page N ---` marker, so a page found in the text can be looked at with
 * view_file. pdf.js may detach `bytes`.
 */
export async function derivePdfText(path: string, bytes: Uint8Array): Promise<ReadonlyArray<SlotFile>> {
  // An ES module only: esbuild keeps this import() in the CommonJS bundle, which ships the package unbundled.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: bytes,
    cMapUrl: resolvePdfjsDataUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: resolvePdfjsDataUrl("standard_fonts"),
    verbosity: 0,
  });
  try {
    const pdfDocument = await loadingTask.promise;
    const pageTexts: Array<string> = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "").join(""));
      page.cleanup();
    }

    if (pageTexts.every((text) => text.trim() === "")) {
      throw new DerivativeRefusal(
        `the PDF has no text layer in its ${pageTexts.length} pages, so it is probably scanned; look at its pages with view_file`,
      );
    }

    const text = pageTexts.map((pageText, index) => `--- page ${index + 1} ---\n${pageText}`).join("\n");
    return [{ path: `${path}.txt`, bytes: Buffer.from(text) }];
  } finally {
    await loadingTask.destroy();
  }
}

export async function deriveDocxText(path: string, bytes: Uint8Array): Promise<ReadonlyArray<SlotFile>> {
  const { value } = await mammoth.extractRawText({ buffer: toBuffer(bytes) });
  if (value.trim() === "") {
    throw new DerivativeRefusal("the document has no text");
  }

  return [{ path: `${path}.txt`, bytes: Buffer.from(value) }];
}

/**
 * Excel forbids slashes in a sheet name, but a crafted file may still carry them; a name repeated after
 * that gets ` (2)`, ` (3)`, ...
 */
function toSheetFileNames(sheetNames: ReadonlyArray<string>): ReadonlyArray<string> {
  const takenNames = new Set<string>();
  return sheetNames.map((sheetName, index) => {
    const sanitizedName = sheetName.replace(/[/\\\p{Cc}]/gu, "_").trim();
    const baseName = sanitizedName === "" ? `sheet-${index + 1}` : sanitizedName;
    let name = baseName;
    for (let copyNumber = 2; takenNames.has(name); copyNumber += 1) {
      name = `${baseName} (${copyNumber})`;
    }

    takenNames.add(name);
    return name;
  });
}

/** One CSV per sheet, named after the sheet. `.xls` is not read. */
export async function deriveXlsxSheets(path: string, bytes: Uint8Array): Promise<ReadonlyArray<SlotFile>> {
  const sheets = await readXlsxFile(toBuffer(bytes));
  if (sheets.length > maximumDerivedFileCount) {
    throw new DerivativeRefusal(
      `the workbook has ${sheets.length} sheets, and at most ${maximumDerivedFileCount} are exported`,
    );
  }

  const fileNames = toSheetFileNames(sheets.map((sheet) => sheet.sheet));
  return sheets.map((sheet, index) => ({
    path: `${path}.d/${fileNames[index]}.csv`,
    bytes: Buffer.from(unparse(sheet.data, { newline: "\n" })),
  }));
}
