import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { useI18n } from "../../../i18n";
import { CardFormTagsField } from "./CardFormTagsField";
import {
  loadMediaUploadTransfersForWorkspaceMediaAssets,
  type MediaUploadTransferForMediaAsset,
  type MediaTransferQueueRecord,
  type MediaTransferStatus,
} from "../../../localDb/mediaTransfers";
import {
  parseManagedImageMarkdownReferences,
  type ManagedMediaMarkdownReference,
} from "../../../media/managedMediaMarkdown";
import type { Card, TagSuggestion } from "../../../types";
import { formatNullableDateTime } from "../../shared/featureFormatting";
import { ManagedMediaReference } from "../../review/components/card/ReviewManagedMedia";

export type CardFormState = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}>;

export type CardFormManagedMediaField = "frontText" | "backText";

export type CardFormImageMediaRequest = Readonly<{
  field: CardFormManagedMediaField;
  file: File;
  altText: string;
}>;

export type CardFormMediaUploadRetryRequest = Readonly<{
  transferId: string;
  workspaceId: string;
  mediaAssetId: string;
}>;

export type CardFormManagedMediaFieldState = Readonly<{
  isProcessing: boolean;
  errorMessage: string;
}>;

export type CardFormManagedMediaState = Readonly<Record<CardFormManagedMediaField, CardFormManagedMediaFieldState>>;

type Props = Readonly<{
  tagSuggestions: ReadonlyArray<TagSuggestion>;
  currentCard: Card | null;
  formState: CardFormState;
  formIdPrefix: string;
  isSaving: boolean;
  localReadVersion: number;
  managedMediaState: CardFormManagedMediaState;
  workspaceId: string | null;
  onChange: (nextFormState: CardFormState) => void;
  onPrepareImageMedia: (request: CardFormImageMediaRequest) => Promise<string | null>;
  onRetryMediaUploadTransfer: (request: CardFormMediaUploadRetryRequest) => Promise<void>;
}>;

type ManagedMediaInsertion = Readonly<{
  text: string;
  caretOffset: number;
}>;

type TextareaSelection = Readonly<{
  start: number;
  end: number;
}>;

type CardFormMediaUploadDisplayState = Readonly<{
  transferStatus: Exclude<MediaTransferStatus, "completed">;
  visualStatus: "pending" | "uploading" | "failed";
  labelKey: "cardForm.media.uploadFailed" | "cardForm.media.uploadPending" | "cardForm.media.uploading";
  shouldShowRetry: boolean;
}>;

const cardImageFilePickerAccept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const mediaUploadStatusRefreshIntervalMs = 3000;

export function toCardFormState(card: Card | null): CardFormState {
  if (card === null) {
    return {
      frontText: "",
      backText: "",
      tags: [],
    };
  }

  return {
    frontText: card.frontText,
    backText: card.backText,
    tags: card.tags,
  };
}

export function isCardFormStateDirty(card: Card | null, formState: CardFormState): boolean {
  const currentState = toCardFormState(card);
  return currentState.frontText !== formState.frontText
    || currentState.backText !== formState.backText
    || currentState.tags.length !== formState.tags.length
    || currentState.tags.some((tag, index) => tag !== formState.tags[index]);
}

export function createCardFormManagedMediaState(): CardFormManagedMediaState {
  return {
    frontText: {
      isProcessing: false,
      errorMessage: "",
    },
    backText: {
      isProcessing: false,
      errorMessage: "",
    },
  };
}

export function isCardFormManagedMediaProcessing(managedMediaState: CardFormManagedMediaState): boolean {
  return managedMediaState.frontText.isProcessing || managedMediaState.backText.isProcessing;
}

function clampSelectionIndex(index: number, textLength: number): number {
  return Math.max(0, Math.min(index, textLength));
}

function buildManagedMediaInsertion(
  text: string,
  selection: TextareaSelection,
  markdown: string,
): ManagedMediaInsertion {
  const start = clampSelectionIndex(selection.start, text.length);
  const end = clampSelectionIndex(selection.end, text.length);
  const prefix = text.slice(0, Math.min(start, end));
  const suffix = text.slice(Math.max(start, end));
  const leadingBreak = prefix === "" || prefix.endsWith("\n") ? "" : "\n\n";
  const trailingBreak = suffix === "" || suffix.startsWith("\n") ? "" : "\n\n";
  const insertionText = `${leadingBreak}${markdown}${trailingBreak}`;

  return {
    text: insertionText,
    caretOffset: insertionText.length,
  };
}

function removeManagedMediaReference(text: string, reference: ManagedMediaMarkdownReference): string {
  return `${text.slice(0, reference.startIndex)}${text.slice(reference.endIndex)}`;
}

function resolveManagedMediaReferenceLabel(reference: ManagedMediaMarkdownReference, fallbackLabel: string): string {
  const trimmedAltText = reference.altText.trim();
  return trimmedAltText === "" ? fallbackLabel : trimmedAltText;
}

function collectReferencedMediaAssetIds(
  references: ReadonlyArray<ReadonlyArray<ManagedMediaMarkdownReference>>,
): ReadonlyArray<string> {
  const mediaAssetIds = new Set<string>();
  for (const fieldReferences of references) {
    for (const reference of fieldReferences) {
      mediaAssetIds.add(reference.mediaAssetId);
    }
  }

  return [...mediaAssetIds];
}

function createMediaTransferByAssetId(
  transfers: ReadonlyArray<MediaUploadTransferForMediaAsset>,
): ReadonlyMap<string, MediaTransferQueueRecord> {
  const transferByAssetId = new Map<string, MediaTransferQueueRecord>();
  for (const transfer of transfers) {
    transferByAssetId.set(transfer.mediaAssetId, transfer.transfer);
  }

  return transferByAssetId;
}

function isFailedUploadRetryDue(record: MediaTransferQueueRecord, nowTimestamp: number): boolean {
  const nextAttemptAtTimestamp = Date.parse(record.nextAttemptAt);
  return Number.isNaN(nextAttemptAtTimestamp) === false && nextAttemptAtTimestamp <= nowTimestamp;
}

function resolveMediaUploadDisplayState(
  record: MediaTransferQueueRecord | undefined,
  nowTimestamp: number,
): CardFormMediaUploadDisplayState | null {
  if (record === undefined || record.status === "completed") {
    return null;
  }

  if (record.status === "in_progress") {
    return {
      transferStatus: "in_progress",
      visualStatus: "uploading",
      labelKey: "cardForm.media.uploading",
      shouldShowRetry: false,
    };
  }

  if (record.status === "queued") {
    return {
      transferStatus: "queued",
      visualStatus: "pending",
      labelKey: "cardForm.media.uploadPending",
      shouldShowRetry: false,
    };
  }

  if (isFailedUploadRetryDue(record, nowTimestamp)) {
    return {
      transferStatus: "failed",
      visualStatus: "pending",
      labelKey: "cardForm.media.uploadPending",
      shouldShowRetry: false,
    };
  }

  return {
    transferStatus: "failed",
    visualStatus: "failed",
    labelKey: "cardForm.media.uploadFailed",
    shouldShowRetry: true,
  };
}

function hasRefreshableUploadTransfer(transfers: ReadonlyMap<string, MediaTransferQueueRecord>): boolean {
  for (const transfer of transfers.values()) {
    if (transfer.status !== "completed") {
      return true;
    }
  }

  return false;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return String(error);
}

function warnMediaUploadStatusLoadFailed(
  workspaceId: string,
  mediaAssetIds: ReadonlyArray<string>,
  error: unknown,
): void {
  console.warn("Card form media upload status lookup failed", {
    workspaceId,
    mediaAssetIds,
    errorMessage: readErrorMessage(error),
  });
}

function ImageIcon(): ReactElement {
  return (
    <svg className="card-form-media-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5C4 5.4 4.9 4.5 6 4.5H18C19.1 4.5 20 5.4 20 6.5V17.5C20 18.6 19.1 19.5 18 19.5H6C4.9 19.5 4 18.6 4 17.5V6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 15L10.7 12.3L13 14.6L15 12.6L19 16.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.25 8.75H8.26" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function RemoveIcon(): ReactElement {
  return (
    <svg className="card-form-media-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ManagedMediaReferenceStrip(props: Readonly<{
  localReadVersion: number;
  references: ReadonlyArray<ManagedMediaMarkdownReference>;
  uploadTransfersByMediaAssetId: ReadonlyMap<string, MediaTransferQueueRecord>;
  workspaceId: string | null;
  onRemove: (reference: ManagedMediaMarkdownReference) => void;
  onRetryMediaUploadTransfer: (request: CardFormMediaUploadRetryRequest) => void;
}>): ReactElement | null {
  const {
    localReadVersion,
    references,
    uploadTransfersByMediaAssetId,
    workspaceId,
    onRemove,
    onRetryMediaUploadTransfer,
  } = props;
  const { t } = useI18n();
  const nowTimestamp = Date.now();

  if (references.length === 0) {
    return null;
  }

  return (
    <div className="card-form-managed-media-strip" aria-label={t("cardForm.media.referencesLabel")}>
      {references.map((reference) => {
        const referenceLabel = resolveManagedMediaReferenceLabel(reference, t("reviewScreen.media.imageAlt"));
        const uploadTransfer = uploadTransfersByMediaAssetId.get(reference.mediaAssetId);
        const uploadDisplayState = resolveMediaUploadDisplayState(
          uploadTransfer,
          nowTimestamp,
        );
        return (
          <div
            className="card-form-managed-media-reference"
            key={`${reference.mediaAssetId}:${reference.startIndex}`}
            data-fcasset-id={reference.mediaAssetId}
          >
            <div className="card-form-managed-media-body">
              <div className="card-form-managed-media-preview">
                <ManagedMediaReference
                  altText={reference.altText}
                  localReadVersion={localReadVersion}
                  mediaAssetId={reference.mediaAssetId}
                  referencePresentation="image"
                  workspaceId={workspaceId}
                >
                  {referenceLabel}
                </ManagedMediaReference>
              </div>
              {uploadDisplayState !== null ? (
                <div
                  className="card-form-managed-media-upload-state"
                  data-status={uploadDisplayState.visualStatus}
                  data-transfer-status={uploadDisplayState.transferStatus}
                  data-testid="card-form-media-upload-status"
                  role="status"
                >
                  <span>{t(uploadDisplayState.labelKey)}</span>
                  {uploadDisplayState.shouldShowRetry && uploadTransfer !== undefined ? (
                    <button
                      type="button"
                      className="card-form-media-retry-btn"
                      onClick={() => onRetryMediaUploadTransfer({
                        transferId: uploadTransfer.transferId,
                        workspaceId: uploadTransfer.workspaceId,
                        mediaAssetId: uploadTransfer.mediaAssetId,
                      })}
                      data-testid="card-form-media-upload-retry"
                    >
                      {t("cardForm.media.retryUpload")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="card-form-media-icon-btn"
              aria-label={t("cardForm.media.removeReferenceLabel", { label: referenceLabel })}
              title={t("cardForm.media.removeReferenceLabel", { label: referenceLabel })}
              onClick={() => onRemove(reference)}
            >
              <RemoveIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CardFormFields(props: Props): ReactElement {
  const {
    tagSuggestions,
    currentCard,
    formState,
    formIdPrefix,
    isSaving,
    localReadVersion,
    managedMediaState,
    workspaceId,
    onChange,
    onPrepareImageMedia,
    onRetryMediaUploadTransfer,
  } = props;
  const { t, formatDateTime } = useI18n();
  const frontFieldId = `${formIdPrefix}-front-text`;
  const backFieldId = `${formIdPrefix}-back-text`;
  const tagsFieldId = `${formIdPrefix}-tags-input`;
  const frontTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const backTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const frontImageInputRef = useRef<HTMLInputElement | null>(null);
  const backImageInputRef = useRef<HTMLInputElement | null>(null);
  const formStateRef = useRef<CardFormState>(formState);
  const uploadTransferLoadSequenceRef = useRef<number>(0);
  const [uploadTransfersByMediaAssetId, setUploadTransfersByMediaAssetId] = useState<ReadonlyMap<string, MediaTransferQueueRecord>>(
    new Map<string, MediaTransferQueueRecord>(),
  );
  const frontManagedMediaReferences = useMemo(
    (): ReadonlyArray<ManagedMediaMarkdownReference> => parseManagedImageMarkdownReferences(formState.frontText),
    [formState.frontText],
  );
  const backManagedMediaReferences = useMemo(
    (): ReadonlyArray<ManagedMediaMarkdownReference> => parseManagedImageMarkdownReferences(formState.backText),
    [formState.backText],
  );
  const referencedMediaAssetIds = useMemo(
    (): ReadonlyArray<string> => collectReferencedMediaAssetIds([
      frontManagedMediaReferences,
      backManagedMediaReferences,
    ]),
    [backManagedMediaReferences, frontManagedMediaReferences],
  );
  formStateRef.current = formState;

  const loadUploadTransferStatuses = useCallback(async function loadUploadTransferStatuses(): Promise<void> {
    const requestSequence = uploadTransferLoadSequenceRef.current + 1;
    uploadTransferLoadSequenceRef.current = requestSequence;
    const isCurrentRequest = function isCurrentRequest(): boolean {
      return uploadTransferLoadSequenceRef.current === requestSequence;
    };

    if (workspaceId === null || referencedMediaAssetIds.length === 0) {
      setUploadTransfersByMediaAssetId(new Map<string, MediaTransferQueueRecord>());
      return;
    }

    try {
      const transfers = await loadMediaUploadTransfersForWorkspaceMediaAssets(workspaceId, referencedMediaAssetIds);
      if (isCurrentRequest()) {
        setUploadTransfersByMediaAssetId(createMediaTransferByAssetId(transfers));
      }
    } catch (error) {
      if (isCurrentRequest()) {
        warnMediaUploadStatusLoadFailed(workspaceId, referencedMediaAssetIds, error);
      }
    }
  }, [referencedMediaAssetIds, workspaceId]);

  useEffect(() => () => {
    uploadTransferLoadSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    void loadUploadTransferStatuses();
  }, [loadUploadTransferStatuses, localReadVersion]);

  useEffect(() => {
    if (hasRefreshableUploadTransfer(uploadTransfersByMediaAssetId) === false) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadUploadTransferStatuses();
    }, mediaUploadStatusRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadUploadTransferStatuses, uploadTransfersByMediaAssetId]);

  function updateField<Key extends keyof CardFormState>(key: Key, value: CardFormState[Key]): void {
    onChange({
      ...formStateRef.current,
      [key]: value,
    });
  }

  function readTextareaRef(field: CardFormManagedMediaField): RefObject<HTMLTextAreaElement | null> {
    return field === "frontText" ? frontTextareaRef : backTextareaRef;
  }

  function readImageInputRef(field: CardFormManagedMediaField): RefObject<HTMLInputElement | null> {
    return field === "frontText" ? frontImageInputRef : backImageInputRef;
  }

  function readTextareaSelection(field: CardFormManagedMediaField): TextareaSelection {
    const textarea = readTextareaRef(field).current;
    const fallbackIndex = formStateRef.current[field].length;
    if (textarea === null) {
      return {
        start: fallbackIndex,
        end: fallbackIndex,
      };
    }

    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function focusTextareaAt(field: CardFormManagedMediaField, caretIndex: number): void {
    window.requestAnimationFrame(() => {
      const textarea = readTextareaRef(field).current;
      if (textarea === null) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(caretIndex, caretIndex);
    });
  }

  function insertManagedMediaMarkdown(
    field: CardFormManagedMediaField,
    selection: TextareaSelection,
    markdown: string,
  ): void {
    const currentFormState = formStateRef.current;
    const currentText = currentFormState[field];
    const start = clampSelectionIndex(Math.min(selection.start, selection.end), currentText.length);
    const end = clampSelectionIndex(Math.max(selection.start, selection.end), currentText.length);
    const insertion = buildManagedMediaInsertion(currentText, { start, end }, markdown);
    const nextText = `${currentText.slice(0, start)}${insertion.text}${currentText.slice(end)}`;
    onChange({
      ...currentFormState,
      [field]: nextText,
    });
    focusTextareaAt(field, start + insertion.caretOffset);
  }

  function handleOpenImagePicker(field: CardFormManagedMediaField): void {
    readImageInputRef(field).current?.click();
  }

  async function handleImageInputChange(
    field: CardFormManagedMediaField,
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.item(0) ?? null;
    event.target.value = "";
    if (file === null) {
      return;
    }

    const selection = readTextareaSelection(field);
    const markdown = await onPrepareImageMedia({
      field,
      file,
      altText: file.name,
    });
    if (markdown === null) {
      return;
    }

    insertManagedMediaMarkdown(field, selection, markdown);
  }

  function handleRemoveReference(field: CardFormManagedMediaField, reference: ManagedMediaMarkdownReference): void {
    updateField(field, removeManagedMediaReference(formStateRef.current[field], reference));
    focusTextareaAt(field, reference.startIndex);
  }

  function renderTextField(
    field: CardFormManagedMediaField,
    fieldId: string,
    label: string,
    references: ReadonlyArray<ManagedMediaMarkdownReference>,
    rows: number,
    testId: string,
  ): ReactElement {
    const mediaState = managedMediaState[field];
    const insertImageLabel = t("cardForm.media.insertImageLabel", { field: label });

    return (
      <section className="form-label content-card content-card-section">
        <div className="card-form-field-header">
          <label className="card-form-field-label" htmlFor={fieldId}>
            <span>{label}</span>
          </label>
          <button
            type="button"
            className="card-form-media-icon-btn"
            aria-label={insertImageLabel}
            title={insertImageLabel}
            disabled={isSaving || mediaState.isProcessing}
            onClick={() => handleOpenImagePicker(field)}
          >
            <ImageIcon />
          </button>
          <input
            ref={readImageInputRef(field)}
            type="file"
            accept={cardImageFilePickerAccept}
            hidden
            onChange={(event: ChangeEvent<HTMLInputElement>) => void handleImageInputChange(field, event)}
          />
        </div>
        <textarea
          ref={readTextareaRef(field)}
          id={fieldId}
          name={field}
          className="settings-input form-textarea"
          rows={rows}
          value={formState[field]}
          data-testid={testId}
          disabled={mediaState.isProcessing}
          aria-busy={mediaState.isProcessing}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField(field, event.target.value)}
        />
        {mediaState.isProcessing ? (
          <p className="card-form-media-status" role="status">{t("cardForm.media.processing")}</p>
        ) : null}
        {mediaState.errorMessage !== "" ? (
          <p className="card-form-media-error">{mediaState.errorMessage}</p>
        ) : null}
        <ManagedMediaReferenceStrip
          localReadVersion={localReadVersion}
          references={references}
          uploadTransfersByMediaAssetId={uploadTransfersByMediaAssetId}
          workspaceId={workspaceId}
          onRemove={(reference) => handleRemoveReference(field, reference)}
          onRetryMediaUploadTransfer={(request) => {
            void onRetryMediaUploadTransfer(request).then(() => loadUploadTransferStatuses());
          }}
        />
      </section>
    );
  }

  return (
    <div className="card-form-layout">
      <section className="card-form-panel">
        {renderTextField("frontText", frontFieldId, t("cardForm.fields.front"), frontManagedMediaReferences, 7, "card-form-front-text")}
        {renderTextField("backText", backFieldId, t("cardForm.fields.back"), backManagedMediaReferences, 9, "card-form-back-text")}

        <div className="form-label content-card content-card-section">
          <label htmlFor={tagsFieldId}>
            <span>{t("cardForm.fields.tags")}</span>
          </label>
          <CardFormTagsField
            value={formState.tags}
            suggestions={tagSuggestions}
            inputId={tagsFieldId}
            inputName="tags"
            onChange={(nextValue) => updateField("tags", nextValue)}
            disabled={isSaving}
          />
        </div>

      </section>

      <aside className="card-meta-panel">
        <h2 className="panel-subtitle">{t("cardForm.meta.title")}</h2>
        <dl className="meta-list">
          <div className="meta-row">
            <dt>{t("cardForm.meta.cardId")}</dt>
            <dd className="meta-value-mono">{currentCard?.cardId ?? t("common.newItem")}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.due")}</dt>
            <dd className="meta-value-mono">{formatNullableDateTime(currentCard?.dueAt ?? null, formatDateTime, t)}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.reps")}</dt>
            <dd className="meta-value-mono">{currentCard?.reps ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.lapses")}</dt>
            <dd className="meta-value-mono">{currentCard?.lapses ?? 0}</dd>
          </div>
          <div className="meta-row">
            <dt>{t("cardForm.meta.updated")}</dt>
            <dd className="meta-value-mono">{formatNullableDateTime(currentCard?.updatedAt ?? null, formatDateTime, t)}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
