import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../../i18n";
import type { TagSuggestion } from "../../../types";
import { areSameTags, CardTagsInput, type CardTagsInputHandle } from "../CardTagsInput";

type OverlayRect = Readonly<{
  top: number;
  left: number;
  width: number;
  height: number;
}>;

type EditableTextCellProps = Readonly<{
  value: string;
  displayValue: string;
  multiline: boolean;
  saving: boolean;
  onCommit: (nextValue: string) => Promise<void>;
  cellClassName: string;
}>;

type EditableTagsCellProps = Readonly<{
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<TagSuggestion>;
  saving: boolean;
  onCommit: (nextValue: ReadonlyArray<string>) => Promise<void>;
  cellClassName: string;
}>;

function getOverlayRect(element: HTMLTableCellElement): OverlayRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function getTextOverlayStyle(rect: OverlayRect, multiline: boolean): CSSProperties {
  const width = multiline ? Math.max(rect.width, 360) : rect.width;
  const height = multiline ? Math.max(rect.height * 3, 120) : rect.height;
  const maxLeft = Math.max(window.innerWidth - width - 12, 12);

  return {
    top: rect.top,
    left: Math.min(rect.left, maxLeft),
    width,
    height,
  };
}

function getTagsOverlayStyle(rect: OverlayRect): CSSProperties {
  const width = Math.max(rect.width, 320);
  const maxLeft = Math.max(window.innerWidth - width - 12, 12);
  const maxTop = Math.max(window.innerHeight - 320, 12);

  return {
    top: Math.min(rect.top, maxTop),
    left: Math.min(rect.left, maxLeft),
    width,
  };
}

function useOverlayTracking(
  isOpen: boolean,
  cellRef: RefObject<HTMLTableCellElement | null>,
  onUpdate: (rect: OverlayRect) => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleViewportChange(): void {
      if (cellRef.current === null) {
        return;
      }

      onUpdate(getOverlayRect(cellRef.current));
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [cellRef, isOpen, onUpdate]);
}

function useOutsidePointerClose(
  isOpen: boolean,
  overlayRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (overlayRef.current !== null && !overlayRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, onClose, overlayRef]);
}

export function EditableCardTextCell(props: EditableTextCellProps): ReactElement {
  const { value, displayValue, multiline, saving, onCommit, cellClassName } = props;
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draftValue, setDraftValue] = useState<string>(value);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useOverlayTracking(isEditing, cellRef, setOverlayRect);

  useEffect(() => {
    const activeElement = multiline ? textareaRef.current : inputRef.current;
    if (!isEditing || activeElement === null) {
      return;
    }

    activeElement.focus();
    activeElement.select();
  }, [isEditing, multiline]);

  function closeEditor(): void {
    setIsEditing(false);
    setOverlayRect(null);
  }

  function startEditing(): void {
    if (saving || cellRef.current === null) {
      return;
    }

    setDraftValue(value);
    setOverlayRect(getOverlayRect(cellRef.current));
    setIsEditing(true);
  }

  function commitEdit(): void {
    const trimmedValue = draftValue.trim();
    closeEditor();

    if (trimmedValue === value.trim()) {
      return;
    }

    void onCommit(trimmedValue);
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
  const overlayStyle = overlayRect === null ? null : getTextOverlayStyle(overlayRect, multiline);

  return (
    <td ref={cellRef} className={className} onClick={saving ? undefined : startEditing}>
      {displayContent}
      {isEditing && overlayStyle !== null && createPortal(
        multiline ? (
          <textarea
            ref={textareaRef}
            name="card-cell-textarea"
            className="cell-editor-overlay cell-editor-overlay-multiline"
            value={draftValue}
            style={overlayStyle}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraftValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <input
            ref={inputRef}
            name="card-cell-input"
            className="cell-editor-overlay"
            type="text"
            value={draftValue}
            style={overlayStyle}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
          />
        ),
        document.body,
      )}
    </td>
  );
}

export function EditableCardTagsCell(props: EditableTagsCellProps): ReactElement {
  const { value, suggestions, saving, onCommit, cellClassName } = props;
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [draftTags, setDraftTags] = useState<ReadonlyArray<string>>(value);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CardTagsInputHandle | null>(null);

  const handleClose = useCallback((): void => {
    setIsOpen(false);
    setOverlayRect(null);
    setDraftTags(value);
  }, [value]);

  useOverlayTracking(isOpen, cellRef, setOverlayRect);
  useOutsidePointerClose(isOpen, overlayRef, handleCommit);

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

  function handleOpen(): void {
    if (saving || cellRef.current === null) {
      return;
    }

    setDraftTags(value);
    setOverlayRect(getOverlayRect(cellRef.current));
    setIsOpen(true);
  }

  function handleCommit(): void {
    const nextTags = editorRef.current === null ? draftTags : editorRef.current.flushDraft();
    setIsOpen(false);
    setOverlayRect(null);

    if (areSameTags(nextTags, value)) {
      setDraftTags(value);
      return;
    }

    void onCommit(nextTags);
  }

  const className = `txn-cell ${cellClassName}${saving ? " cards-cell-disabled" : " drilldown-editable"}`;
  const overlayStyle = overlayRect === null ? null : getTagsOverlayStyle(overlayRect);

  return (
    <td ref={cellRef} className={className} onClick={saving ? undefined : handleOpen}>
      {value.length === 0 ? <span className="tag-value-empty">—</span> : (
        <span className="tag-value-list">
          {value.map((tag) => (
            <span key={tag} className="tag-chip tag-chip-readonly">
              <span className="tag-chip-label">{tag}</span>
            </span>
          ))}
        </span>
      )}
      {isOpen && overlayStyle !== null && createPortal(
        <div ref={overlayRef} className="cell-select-overlay cell-tags-overlay" style={overlayStyle}>
          <CardTagsInput
            ref={editorRef}
            value={draftTags}
            suggestions={suggestions}
            placeholder={t("cardTags.inputPlaceholder")}
            inputName="card-tags-editor"
            onChange={setDraftTags}
            onEscape={handleClose}
          />
        </div>,
        document.body,
      )}
    </td>
  );
}
