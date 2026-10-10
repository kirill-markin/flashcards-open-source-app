import { PDFDocument } from "pdf-lib";
import { cutHeadAtCodePoint } from "../shared/codePointCuts";
import {
  maximumDerivativeErrorChars,
  maximumPdfPageBytes,
  maximumWholeEncryptedPdfPages,
  type ChatSandboxPdfPageRequest,
  type ChatSandboxPdfPageResponse,
} from "./contract";
import { downloadPresignedObject } from "./presignedTransfer";

const mebibyte = 1024 * 1024;

function failPdfPage(message: string): ChatSandboxPdfPageResponse {
  return { outcome: "failed", error: cutHeadAtCodePoint(message, maximumDerivativeErrorChars) };
}

function failMissingPage(pageCount: number, page: number): ChatSandboxPdfPageResponse {
  return failPdfPage(`the PDF has ${pageCount} pages, so there is no page ${page}`);
}

function refuseWholeEncryptedPdf(path: string, page: number, reason: string): ChatSandboxPdfPageResponse {
  return failPdfPage(
    `the PDF is encrypted, so view_file cannot cut page ${page} out of it, and ${reason}; `
      + `read its text with bash in ${path}.txt, if its attachment line lists that file`,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Copies one page, with the fonts and images it uses, into a PDF of its own. */
async function cutPdfPage(source: PDFDocument, page: number): Promise<ChatSandboxPdfPageResponse> {
  const pageCount = source.getPageCount();
  if (page > pageCount) {
    return failMissingPage(pageCount, page);
  }

  const pageDocument = await PDFDocument.create({ updateMetadata: false });
  const [copiedPage] = await pageDocument.copyPages(source, [page - 1]);
  pageDocument.addPage(copiedPage);
  const pageBytes = await pageDocument.save();
  if (pageBytes.byteLength > maximumPdfPageBytes) {
    return failPdfPage(
      `page ${page} alone is ${(pageBytes.byteLength / mebibyte).toFixed(1)} MB, `
        + `and view_file shows pages of at most ${maximumPdfPageBytes / mebibyte} MB`,
    );
  }

  return { outcome: "extracted", pageCount, pdfBase64: Buffer.from(pageBytes).toString("base64") };
}

/**
 * pdf-lib cannot decrypt, so it cuts no page out of an encrypted PDF, such as a statement or a form that
 * only an owner password protects. pdf.js opens those and counts their pages, and one short and small
 * enough travels whole.
 */
async function showEncryptedPdf(path: string, bytes: Uint8Array, page: number): Promise<ChatSandboxPdfPageResponse> {
  // An ES module only: esbuild keeps this import() in the CommonJS bundle, which ships the package unbundled.
  const { getDocument, PasswordException } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js may detach the bytes it gets, and the original may still travel whole.
  const loadingTask = getDocument({ data: bytes.slice(), verbosity: 0 });
  let pageCount: number;
  try {
    pageCount = (await loadingTask.promise).numPages;
  } catch (error) {
    return failPdfPage(
      error instanceof PasswordException
        ? "the PDF needs a password to open, so view_file cannot show it"
        : `could not read the PDF: ${describeError(error)}`,
    );
  } finally {
    await loadingTask.destroy();
  }

  if (page > pageCount) {
    return failMissingPage(pageCount, page);
  }

  if (pageCount > maximumWholeEncryptedPdfPages) {
    return refuseWholeEncryptedPdf(
      path,
      page,
      `with ${pageCount} pages it is too long to show whole (at most ${maximumWholeEncryptedPdfPages} pages)`,
    );
  }

  if (bytes.byteLength > maximumPdfPageBytes) {
    return refuseWholeEncryptedPdf(
      path,
      page,
      `at ${(bytes.byteLength / mebibyte).toFixed(1)} MB it is too large to show whole (at most `
        + `${maximumPdfPageBytes / mebibyte} MB)`,
    );
  }

  return { outcome: "whole_pdf", pageCount, pdfBase64: Buffer.from(bytes).toString("base64") };
}

/**
 * A failed download fails the call; a PDF that cannot be read, or a page over the size limit, is an
 * answer.
 */
export async function runChatSandboxPdfPage(request: ChatSandboxPdfPageRequest): Promise<ChatSandboxPdfPageResponse> {
  const bytes = await downloadPresignedObject(request.file.getUrl, request.file.path, request.file.sizeBytes);
  try {
    // pdf-lib's EncryptedPDFError is compiled to ES5 and arrives as a plain Error, so isEncrypted identifies an
    // encrypted PDF. Loaded this way, pdf-lib would copy still-encrypted streams into an unreadable page, so an
    // encrypted PDF never reaches cutPdfPage.
    const source = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    return source.isEncrypted
      ? await showEncryptedPdf(request.file.path, bytes, request.page)
      : await cutPdfPage(source, request.page);
  } catch (error) {
    return failPdfPage(`could not read the PDF: ${describeError(error)}`);
  }
}
