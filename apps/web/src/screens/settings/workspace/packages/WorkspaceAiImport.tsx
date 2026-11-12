import { useState, type ReactElement } from "react";
import { useAppData } from "../../../../appData";
import { useAppErrorDialog } from "../../../../appError/AppErrorContext";
import { normalizeChatAttachmentFileMediaType } from "../../../../chat/attachments/attachmentMediaTypes";
import type { BinaryPendingAttachment } from "../../../../chat/attachments/FileAttachment";
import { useOpenAiImportChat } from "../../../../chat/handoff/useOpenAiImportChat";
import {
  AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES,
  AI_CHAT_MAXIMUM_UPLOADS_PER_TURN,
  formatChatAttachmentLimitMessages,
} from "../../../../chat/shared/chatSizePolicy";
import { useI18n } from "../../../../i18n";
import {
  aiImportSourceTitle,
  zipBasedAiImportExtensions,
  type AiImportFileSource,
  type AiImportSource,
} from "./aiImportSources";
import { WorkspaceImportFileField } from "./WorkspaceImportFileField";
import { WorkspaceImportShell } from "./WorkspaceImportShell";

type WorkspaceAiImportProps = Readonly<{
  source: AiImportSource;
}>;

const QUIZLET_ATTACHMENT_FILE_NAME = "quizlet.txt";

async function hasZipSignature(file: File): Promise<boolean> {
  const header = await file.slice(0, 4).arrayBuffer();
  return header.byteLength === 4 && new DataView(header).getUint32(0, true) === 0x04034b50;
}

function fileExtension(fileName: string): string {
  const extensionStartIndex = fileName.lastIndexOf(".");
  return extensionStartIndex < 0 ? "" : fileName.slice(extensionStartIndex + 1).toLowerCase();
}

export function WorkspaceAiImport({ source }: WorkspaceAiImportProps): ReactElement {
  const { isSessionVerified } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { t, formatNumber } = useI18n();
  const { isOpening, errorMessage, start } = useOpenAiImportChat();
  const [attachments, setAttachments] = useState<ReadonlyArray<BinaryPendingAttachment>>([]);
  const [pastedText, setPastedText] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const isDisabled = !isSessionVerified || isOpening || isValidating || indexedDbOpenRecoveryState.hasFailed();
  const canStart = source.inputKind === "text" ? pastedText.trim() !== "" : attachments.length > 0;

  function fileTooLargeMessage(fileName: string): string {
    return t("workspaceImport.ai.fileTooLarge", {
      file: fileName,
      limit: formatNumber(AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES / (1024 * 1024)),
    });
  }

  function invalidFileMessage(fileSource: AiImportFileSource, fileName: string): string {
    return fileSource.brandName === null
      ? t("workspaceImport.ai.otherInvalidFile", { file: fileName, formats: fileSource.formats })
      : t("workspaceImport.ai.invalidFile", { file: fileName, source: fileSource.brandName, formats: fileSource.formats });
  }

  async function handleSelection(fileSource: AiImportFileSource, files: ReadonlyArray<File>): Promise<void> {
    if (isDisabled) {
      return;
    }

    if (attachments.length + files.length > AI_CHAT_MAXIMUM_UPLOADS_PER_TURN) {
      setSelectionError(formatChatAttachmentLimitMessages({ t, formatNumber }).too_many_attachments);
      return;
    }

    for (const file of files) {
      if (!fileSource.extensions.includes(fileExtension(file.name)) || file.size === 0) {
        setSelectionError(invalidFileMessage(fileSource, file.name));
        return;
      }
      if (file.size > AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES) {
        setSelectionError(fileTooLargeMessage(file.name));
        return;
      }
    }

    setSelectionError("");
    setIsValidating(true);
    try {
      for (const file of files) {
        if (zipBasedAiImportExtensions.has(fileExtension(file.name)) && !await hasZipSignature(file).catch(() => false)) {
          setSelectionError(invalidFileMessage(fileSource, file.name));
          return;
        }
      }
      setAttachments([
        ...attachments,
        ...files.map((file): BinaryPendingAttachment => ({
          type: "binary",
          fileName: file.name,
          mediaType: normalizeChatAttachmentFileMediaType(file.name, file.type),
          blob: file,
        })),
      ]);
    } finally {
      setIsValidating(false);
    }
  }

  function handleStart(): void {
    setSelectionError("");
    const inputText = source.brandName === null
      ? t("workspaceImport.ai.otherRequest")
      : t("workspaceImport.ai.request", { source: source.brandName });
    if (source.inputKind === "files") {
      start({ inputText, pendingAttachments: attachments });
      return;
    }

    const blob = new Blob([pastedText], { type: "text/plain" });
    if (blob.size > AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES) {
      setSelectionError(fileTooLargeMessage(QUIZLET_ATTACHMENT_FILE_NAME));
      return;
    }
    start({
      inputText,
      pendingAttachments: [{ type: "binary", fileName: QUIZLET_ATTACHMENT_FILE_NAME, mediaType: "text/plain", blob }],
    });
  }

  return (
    <WorkspaceImportShell title={aiImportSourceTitle(source, t)}>
      <article className="content-card workspace-export-format-card" data-testid="workspace-ai-import-card">
        <p className="subtitle">
          {source.inputKind === "text"
            ? t("workspaceImport.ai.quizletDescription")
            : source.brandName === null
              ? t("workspaceImport.ai.otherDescription")
              : t("workspaceImport.ai.description", { formats: source.formats, source: source.brandName })}
        </p>
        {!isSessionVerified ? <p className="subtitle" role="status">{t("loading.restoringSession")}</p> : null}
        {source.inputKind === "text" ? (
          <label className="workspace-text-import-source">
            <span>{t("workspaceImport.ai.quizletTextLabel")}</span>
            <textarea
              className="settings-input workspace-text-import-textarea"
              value={pastedText}
              disabled={isDisabled}
              data-testid="workspace-ai-import-text-input"
              onChange={(event) => {
                setPastedText(event.currentTarget.value);
                setSelectionError("");
              }}
            />
          </label>
        ) : (
          <WorkspaceImportFileField
            accept={source.extensions.map((extension) => `.${extension}`).join(",")}
            multiple
            label={t("workspaceImport.ai.chooseFiles")}
            isDisabled={isDisabled}
            isBusy={isValidating}
            inputTestId="workspace-ai-import-file-input"
            pickerTestId="workspace-ai-import-select"
            onSelect={(files) => void handleSelection(source, files)}
          >
            {attachments.length === 0 ? null : (
              <div className="chat-attachment-preview">
                {attachments.map((attachment, index) => (
                  <span className="chat-attachment-chip chat-attachment-chip-card" key={`${attachment.fileName}-${index}`}>
                    <bdi className="chat-attachment-card-label" title={attachment.fileName}>{attachment.fileName}</bdi>
                    <button
                      className="chat-attachment-remove"
                      type="button"
                      disabled={isDisabled}
                      aria-label={`${t("chatPanel.actions.removeAttachment")}: ${attachment.fileName}`}
                      data-testid="workspace-ai-import-remove-file"
                      onClick={() => {
                        setAttachments(attachments.filter((_, fileIndex) => fileIndex !== index));
                        setSelectionError("");
                      }}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </WorkspaceImportFileField>
        )}
        <div className="workspace-export-actions">
          <button
            className="primary-btn"
            type="button"
            disabled={isDisabled || !canStart}
            aria-busy={isOpening}
            data-testid="workspace-ai-import-start"
            onClick={handleStart}
          >
            {isOpening ? t("loading.aiChat") : t("workspaceImport.ai.start")}
          </button>
        </div>
        {selectionError || errorMessage ? <p className="error-banner" role="alert">{selectionError || errorMessage}</p> : null}
      </article>
    </WorkspaceImportShell>
  );
}
