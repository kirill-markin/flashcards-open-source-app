import { loadAllActiveCardsForSql } from "./localDb/cards";
import type { Card } from "./types";

type WorkspaceExportUrlApi = Readonly<{
  createObjectURL: (object: Blob) => string;
  revokeObjectURL: (url: string) => void;
}>;

type TriggerCsvDownloadParams = Readonly<{
  content: string;
  filename: string;
  document: Document;
  urlApi: WorkspaceExportUrlApi;
}>;

type ExportWorkspaceCardsCsvParams = Readonly<{
  workspaceId: string;
  workspaceName: string;
  now: Date;
  document: Document;
  urlApi: WorkspaceExportUrlApi;
}>;

function escapeCsvCell(value: string): string {
  const escapedValue = value.replaceAll("\"", "\"\"");
  if (
    escapedValue.includes(",")
    || escapedValue.includes("\"")
    || escapedValue.includes("\n")
    || escapedValue.includes("\r")
  ) {
    return `"${escapedValue}"`;
  }

  return escapedValue;
}

function slugifyWorkspaceName(workspaceName: string): string {
  const slug = workspaceName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return slug === "" ? "workspace" : slug;
}

function formatExportDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function serializeWorkspaceCardsCsv(cards: ReadonlyArray<Pick<Card, "frontText" | "backText" | "tags">>): string {
  const lines = [
    "frontText,backText,tags",
    ...cards.map((card) => [
      escapeCsvCell(card.frontText),
      escapeCsvCell(card.backText),
      escapeCsvCell(card.tags.join(", ")),
    ].join(",")),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

export function makeWorkspaceExportFilename(workspaceName: string, now: Date): string {
  return `${slugifyWorkspaceName(workspaceName)}-cards-export-${formatExportDate(now)}.csv`;
}

export function triggerCsvDownload(params: TriggerCsvDownloadParams): void {
  const { content, filename, document, urlApi } = params;
  if (document.body === null) {
    throw new Error("Document body is unavailable for CSV download");
  }

  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const objectUrl = urlApi.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  urlApi.revokeObjectURL(objectUrl);
}

export async function exportWorkspaceCardsCsv(params: ExportWorkspaceCardsCsvParams): Promise<void> {
  const { workspaceId, workspaceName, now, document, urlApi } = params;
  const cards = await loadAllActiveCardsForSql(workspaceId);
  const content = serializeWorkspaceCardsCsv(cards);
  const filename = makeWorkspaceExportFilename(workspaceName, now);
  triggerCsvDownload({
    content,
    filename,
    document,
    urlApi,
  });
}
