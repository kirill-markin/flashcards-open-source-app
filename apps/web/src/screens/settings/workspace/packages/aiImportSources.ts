import type { TranslationKey, TranslationValues } from "../../../../i18n";

export type AiImportSourceId =
  | "quizlet"
  | "anki"
  | "noji"
  | "knowt"
  | "remnote"
  | "brainscape"
  | "studysmarter"
  | "cram"
  | "mochi"
  | "supermemo"
  | "ankiapp"
  | "gizmo"
  | "other";

export type AiImportFileSource = Readonly<{
  id: AiImportSourceId;
  inputKind: "files";
  /** Never translated; null for the catch-all row, whose sentences say "another app". */
  brandName: string | null;
  /** Row subtitle and the `{{formats}}` placeholder; never translated. */
  formats: string;
  /** Lowercase, without the leading dot. */
  extensions: ReadonlyArray<string>;
}>;

/** Pasted text, sent as one `quizlet.txt` attachment. */
export type AiImportTextSource = Readonly<{
  id: AiImportSourceId;
  inputKind: "text";
  brandName: string;
}>;

export type AiImportSource = AiImportFileSource | AiImportTextSource;

function fileSource(id: AiImportSourceId, brandName: string | null, extensions: ReadonlyArray<string>): AiImportFileSource {
  return {
    id,
    inputKind: "files",
    brandName,
    formats: extensions.map((extension) => `.${extension}`).join(", "),
    extensions,
  };
}

/**
 * Keep a row per source brand even when file formats overlap. Every row hands off to the same AI import flow.
 */
export const aiImportSources: ReadonlyArray<AiImportSource> = [
  { id: "quizlet", inputKind: "text", brandName: "Quizlet" },
  fileSource("anki", "Anki", ["apkg", "colpkg"]),
  fileSource("noji", "Noji", ["csv", "ofc"]),
  fileSource("knowt", "Knowt", ["pdf"]),
  fileSource("remnote", "RemNote", ["apkg", "md", "txt"]),
  fileSource("brainscape", "Brainscape", ["csv"]),
  fileSource("studysmarter", "StudySmarter", ["csv"]),
  fileSource("cram", "Cram", ["csv"]),
  fileSource("mochi", "Mochi", ["mochi"]),
  fileSource("supermemo", "SuperMemo", ["xml"]),
  fileSource("ankiapp", "AlgoApp (formerly AnkiApp)", ["zip", "xml"]),
  fileSource("gizmo", "Gizmo", ["pdf"]),
  {
    ...fileSource("other", null, ["csv", "txt", "xlsx", "xls", "pdf", "json", "xml", "md", "docx", "zip"]),
    formats: "CSV, TXT, XLSX, PDF",
  },
];

/** ZIP-based formats get a local ZIP-signature check; the backend validates every format's content. */
export const zipBasedAiImportExtensions: ReadonlySet<string> = new Set(["apkg", "colpkg", "ofc", "mochi", "zip"]);

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export function aiImportSourceTitle(source: AiImportSource, t: Translate): string {
  return source.brandName === null
    ? t("workspaceImport.ai.otherTitle")
    : t("workspaceImport.ai.title", { source: source.brandName });
}

export function aiImportSourceSubtitle(source: AiImportSource, t: Translate): string {
  return source.inputKind === "text" ? t("workspaceImport.ai.quizletSubtitle") : source.formats;
}
