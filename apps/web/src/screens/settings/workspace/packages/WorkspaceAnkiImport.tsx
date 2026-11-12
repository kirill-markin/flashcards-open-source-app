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
import { WorkspaceImportFileField } from "./WorkspaceImportFileField";
import { WorkspaceImportShell } from "./WorkspaceImportShell";

async function hasAnkiArchiveSignature(file: File): Promise<boolean> {
  const header = await file.slice(0, 4).arrayBuffer();
  return header.byteLength === 4 && new DataView(header).getUint32(0, true) === 0x04034b50;
}

export function WorkspaceAnkiImport(): ReactElement {
  const { isSessionVerified } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const { t, formatNumber } = useI18n();
  const { isOpening, errorMessage, start } = useOpenAiImportChat();
  const [attachments, setAttachments] = useState<ReadonlyArray<BinaryPendingAttachment>>([]);
  const [selectionError, setSelectionError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const isDisabled = !isSessionVerified || isOpening || isValidating || indexedDbOpenRecoveryState.hasFailed();

  async function handleSelection(files: ReadonlyArray<File>): Promise<void> {
    if (isDisabled) {
      return;
    }

    if (attachments.length + files.length > AI_CHAT_MAXIMUM_UPLOADS_PER_TURN) {
      setSelectionError(formatChatAttachmentLimitMessages({ t, formatNumber }).too_many_attachments);
      return;
    }

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".apkg") || file.size < 4) {
        setSelectionError(t("workspaceImport.anki.invalidFile", { file: file.name }));
        return;
      }
      if (file.size > AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES) {
        setSelectionError(t("workspaceImport.anki.fileTooLarge", {
          file: file.name,
          limit: formatNumber(AI_CHAT_MAXIMUM_FILE_UPLOAD_BYTES / (1024 * 1024)),
        }));
        return;
      }
    }

    setSelectionError("");
    setIsValidating(true);
    try {
      for (const file of files) {
        if (!await hasAnkiArchiveSignature(file).catch(() => false)) {
          setSelectionError(t("workspaceImport.anki.invalidFile", { file: file.name }));
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

  return (
    <WorkspaceImportShell title={t("workspaceImport.anki.title")}>
      <article className="content-card workspace-export-format-card" data-testid="workspace-anki-import-card">
        <p className="subtitle">{t("workspaceImport.anki.description")}</p>
        {!isSessionVerified ? <p className="subtitle" role="status">{t("loading.restoringSession")}</p> : null}
        <WorkspaceImportFileField
          accept=".apkg"
          multiple
          label={t("workspaceImport.anki.chooseFiles")}
          isDisabled={isDisabled}
          isBusy={isValidating}
          inputTestId="workspace-anki-import-file-input"
          pickerTestId="workspace-anki-import-select"
          onSelect={(files) => void handleSelection(files)}
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
                    data-testid="workspace-anki-import-remove-file"
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
        <div className="workspace-export-actions">
          <button
            className="primary-btn"
            type="button"
            disabled={isDisabled || attachments.length === 0}
            aria-busy={isOpening}
            data-testid="workspace-anki-import-start"
            onClick={() => {
              setSelectionError("");
              start({ inputText: t("workspaceImport.anki.request"), pendingAttachments: attachments });
            }}
          >
            {isOpening ? t("loading.aiChat") : t("workspaceImport.anki.start")}
          </button>
        </div>
        {selectionError || errorMessage ? <p className="error-banner" role="alert">{selectionError || errorMessage}</p> : null}
      </article>
    </WorkspaceImportShell>
  );
}
