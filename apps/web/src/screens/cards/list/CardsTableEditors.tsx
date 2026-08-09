import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss } from "../../../floating";
import { useI18n } from "../../../i18n";
import type { TagSuggestion } from "../../../types";
import { areSameTags, CardTagsInput, type CardTagsInputHandle } from "../CardTagsInput";

type EditableTextCellProps = Readonly<{
  editorToken: CardInlineEditorToken;
  value: string;
  displayValue: string;
  multiline: boolean;
  saving: boolean;
  onCommit: (nextValue: string) => Promise<void>;
  onEditorOpen: (editorToken: CardInlineEditorToken) => number;
  onEditorClose: (editorToken: CardInlineEditorToken, lifecycle: number) => void;
  cellClassName: string;
}>;

type EditableTagsCellProps = Readonly<{
  editorToken: CardInlineEditorToken;
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<TagSuggestion>;
  saving: boolean;
  onCommit: (nextValue: ReadonlyArray<string>) => Promise<void>;
  onEditorOpen: (editorToken: CardInlineEditorToken) => number;
  onEditorClose: (editorToken: CardInlineEditorToken, lifecycle: number) => void;
  cellClassName: string;
}>;

export type CardInlineEditorToken = Readonly<{
  cardId: string;
  field: "frontText" | "backText" | "tags";
}>;

const floatingEditorViewportPaddingPx = 12;
const multilineTextEditorMinimumWidthPx = 360;
const multilineTextEditorMaximumWidthPx = 720;
const multilineTextEditorMaximumHeightPx = 520;
const tagsEditorMinimumWidthPx = 320;
const tagsEditorMaximumWidthPx = 420;
const tagsEditorMaximumHeightPx = 320;

export function EditableCardTextCell(props: EditableTextCellProps): ReactElement {
  const {
    editorToken,
    value,
    displayValue,
    multiline,
    saving,
    onCommit,
    onEditorOpen,
    onEditorClose,
    cellClassName,
  } = props;
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draftValue, setDraftValue] = useState<string>(value);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stableEditorTokenRef = useRef<CardInlineEditorToken>(editorToken);
  const openingValueRef = useRef<string>(value);
  const editorLifecycleRef = useRef<number | null>(null);

  useEffect(() => {
    const activeElement = multiline ? textareaRef.current : inputRef.current;
    if (!isEditing || activeElement === null) {
      return;
    }

    activeElement.focus();
    activeElement.select();
  }, [isEditing, multiline]);

  function closeEditor(): void {
    const editorLifecycle = editorLifecycleRef.current;
    if (editorLifecycle === null) {
      return;
    }

    editorLifecycleRef.current = null;
    setIsEditing(false);
    onEditorClose(stableEditorTokenRef.current, editorLifecycle);
  }

  function startEditing(): void {
    if (saving || isEditing || cellRef.current === null) {
      return;
    }

    openingValueRef.current = value;
    setDraftValue(value);
    editorLifecycleRef.current = onEditorOpen(stableEditorTokenRef.current);
    setIsEditing(true);
  }

  function handleCellPointerDown(event: PointerEvent<HTMLTableCellElement>): void {
    if (event.button !== 0) {
      return;
    }

    if (isEditing) {
      event.preventDefault();
      return;
    }

    startEditing();
  }

  function commitEdit(): void {
    if (editorLifecycleRef.current === null) {
      return;
    }

    const trimmedValue = draftValue.trim();
    if (trimmedValue !== openingValueRef.current.trim()) {
      void onCommit(trimmedValue);
    }

    closeEditor();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
      return;
    }

    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      commitEdit();
      return;
    }

    if (multiline && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commitEdit();
    }
  }

  const multilineClassName = multiline ? " cards-cell-multiline" : "";
  const className = `txn-cell ${cellClassName}${multilineClassName}${saving ? " cards-cell-disabled" : " drilldown-editable"}`;
  const displayText = displayValue.length > 0 ? displayValue : "\u2014";
  const displayContent = multiline
    ? <span className="cards-cell-multiline-display">{displayText}</span>
    : displayText;
  const overlayClassName = multiline
    ? "cell-editor-overlay cell-editor-overlay-multiline"
    : "cell-editor-overlay";

  return (
    <td ref={cellRef} className={className} onPointerDown={saving ? undefined : handleCellPointerDown}>
      {displayContent}
      <AnchoredFloatingOverlay
        isOpen={isEditing}
        referenceRef={cellRef}
        floatingRef={overlayRef}
        placement="bottom-start"
        viewportPaddingPx={floatingEditorViewportPaddingPx}
        offsetPx={0}
        minimumWidth={multiline ? { kind: "reference-or-pixels", pixels: multilineTextEditorMinimumWidthPx } : { kind: "reference" }}
        maxWidthPx={multiline ? multilineTextEditorMaximumWidthPx : null}
        maxHeightPx={multiline ? multilineTextEditorMaximumHeightPx : null}
        className={overlayClassName}
        id={null}
        role={null}
        ariaLabel={null}
        ariaLabelledBy={null}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        {multiline ? (
          <textarea
            ref={textareaRef}
            name="card-cell-textarea"
            className="cell-editor-field cell-editor-field-multiline"
            value={draftValue}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraftValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <input
            ref={inputRef}
            name="card-cell-input"
            className="cell-editor-field"
            type="text"
            value={draftValue}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
          />
        )}
      </AnchoredFloatingOverlay>
    </td>
  );
}

export function EditableCardTagsCell(props: EditableTagsCellProps): ReactElement {
  const {
    editorToken,
    value,
    suggestions,
    saving,
    onCommit,
    onEditorOpen,
    onEditorClose,
    cellClassName,
  } = props;
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [draftTags, setDraftTags] = useState<ReadonlyArray<string>>(value);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CardTagsInputHandle | null>(null);
  const stableEditorTokenRef = useRef<CardInlineEditorToken>(editorToken);
  const openingTagsRef = useRef<ReadonlyArray<string>>(value);
  const editorLifecycleRef = useRef<number | null>(null);

  const handleClose = useCallback((): void => {
    const editorLifecycle = editorLifecycleRef.current;
    if (editorLifecycle === null) {
      return;
    }

    editorLifecycleRef.current = null;
    setIsOpen(false);
    setDraftTags(openingTagsRef.current);
    onEditorClose(stableEditorTokenRef.current, editorLifecycle);
  }, [onEditorClose]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef: cellRef,
    overlayRef,
    enabled: isOpen,
    onClose: handleCommit,
  });

  useEffect(() => {
    if (!isOpen || editorRef.current === null) {
      return;
    }

    editorRef.current.focusInput();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setDraftTags(value);
  }, [isOpen, value]);

  function handleCellPointerDown(event: PointerEvent<HTMLTableCellElement>): void {
    if (event.button !== 0) {
      return;
    }

    if (
      saving
      || cellRef.current === null
      || !(event.target instanceof Node)
      || !cellRef.current.contains(event.target)
    ) {
      return;
    }

    if (isOpen) {
      event.preventDefault();
      handleCommit();
      return;
    }

    openingTagsRef.current = value;
    setDraftTags(value);
    editorLifecycleRef.current = onEditorOpen(stableEditorTokenRef.current);
    setIsOpen(true);
  }

  function handleCommit(): void {
    if (editorLifecycleRef.current === null) {
      return;
    }

    const nextTags = editorRef.current === null ? draftTags : editorRef.current.flushDraft();
    if (!areSameTags(nextTags, openingTagsRef.current)) {
      void onCommit(nextTags);
    }

    handleClose();
  }

  const className = `txn-cell ${cellClassName}${saving ? " cards-cell-disabled" : " drilldown-editable"}`;

  return (
    <td ref={cellRef} className={className} onPointerDown={saving ? undefined : handleCellPointerDown}>
      {value.length === 0 ? <span className="tag-value-empty">—</span> : (
        <span className="tag-value-list">
          {value.map((tag) => (
            <span key={tag} className="tag-chip tag-chip-readonly">
              <span className="tag-chip-label">{tag}</span>
            </span>
          ))}
        </span>
      )}
      <AnchoredFloatingOverlay
        isOpen={isOpen}
        referenceRef={cellRef}
        floatingRef={overlayRef}
        placement="bottom-start"
        viewportPaddingPx={floatingEditorViewportPaddingPx}
        offsetPx={6}
        minimumWidth={{ kind: "reference-or-pixels", pixels: tagsEditorMinimumWidthPx }}
        maxWidthPx={tagsEditorMaximumWidthPx}
        maxHeightPx={tagsEditorMaximumHeightPx}
        className="cell-select-overlay cell-tags-overlay"
        id={null}
        role={null}
        ariaLabel={null}
        ariaLabelledBy={null}
        ariaDescribedBy={null}
        ariaModal={null}
      >
        <CardTagsInput
          ref={editorRef}
          value={draftTags}
          suggestions={suggestions}
          placeholder={t("cardTags.inputPlaceholder")}
          inputName="card-tags-editor"
          onChange={setDraftTags}
          onEscape={handleClose}
        />
      </AnchoredFloatingOverlay>
    </td>
  );
}
