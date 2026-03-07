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

import type { EffortLevel } from "../types";
import { areSameTags, CardTagsInput, type CardTagsInputHandle } from "./CardTagsInput";

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

type EditableEffortCellProps = Readonly<{
  value: EffortLevel;
  saving: boolean;
  onCommit: (nextValue: EffortLevel) => Promise<void>;
  cellClassName: string;
}>;

type EditableTagsCellProps = Readonly<{
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<string>;
  saving: boolean;
  onCommit: (nextValue: ReadonlyArray<string>) => Promise<void>;
  cellClassName: string;
}>;

type EffortOption = Readonly<{
  value: EffortLevel;
  label: string;
}>;

const EFFORT_OPTIONS: ReadonlyArray<EffortOption> = [
  { value: "fast", label: "fast" },
  { value: "medium", label: "medium" },
  { value: "long", label: "long" },
];

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

function getSelectOverlayStyle(rect: OverlayRect): CSSProperties {
  const minWidth = Math.max(rect.width, 160);
  const maxLeft = Math.max(window.innerWidth - minWidth - 12, 12);
  const maxTop = Math.max(window.innerHeight - 220, 12);

  return {
    top: Math.min(rect.top, maxTop),
    left: Math.min(rect.left, maxLeft),
    minWidth,
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
  const overlayStyle = overlayRect === null ? null : getTextOverlayStyle(overlayRect, multiline);

  return (
    <td ref={cellRef} className={className} onClick={saving ? undefined : startEditing}>
      {displayText}
      {isEditing && overlayStyle !== null && createPortal(
        multiline ? (
          <textarea
            ref={textareaRef}
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

export function EditableCardEffortCell(props: EditableEffortCellProps): ReactElement {
  const { value, saving, onCommit, cellClassName } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [searchValue, setSearchValue] = useState<string>("");
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useOverlayTracking(isOpen, cellRef, setOverlayRect);
  useOutsidePointerClose(isOpen, overlayRef, handleClose);

  useEffect(() => {
    if (!isOpen || searchRef.current === null) {
      return;
    }

    searchRef.current.focus();
  }, [isOpen]);

  function handleClose(): void {
    setIsOpen(false);
    setOverlayRect(null);
    setSearchValue("");
    setHighlightIndex(-1);
  }

  function handleOpen(): void {
    if (saving || cellRef.current === null) {
      return;
    }

    setOverlayRect(getOverlayRect(cellRef.current));
    setIsOpen(true);
  }

  function handleSelect(nextValue: EffortLevel): void {
    handleClose();
    if (nextValue === value) {
      return;
    }

    void onCommit(nextValue);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handleClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((currentIndex) => (
        currentIndex < filteredOptions.length - 1 ? currentIndex + 1 : 0
      ));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((currentIndex) => (
        currentIndex > 0 ? currentIndex - 1 : filteredOptions.length - 1
      ));
      return;
    }

    if (event.key === "Enter" && highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
      event.preventDefault();
      handleSelect(filteredOptions[highlightIndex].value);
    }
  }

  const filteredOptions = EFFORT_OPTIONS.filter((option) => option.label.toLowerCase().includes(searchValue));
  const className = `txn-cell ${cellClassName}${saving ? " cards-cell-disabled" : " drilldown-editable drilldown-editable-select"}`;
  const overlayStyle = overlayRect === null ? null : getSelectOverlayStyle(overlayRect);

  return (
    <td ref={cellRef} className={className} onClick={saving ? undefined : handleOpen}>
      {value}
      {isOpen && overlayStyle !== null && createPortal(
        <div ref={overlayRef} className="cell-select-overlay" style={overlayStyle}>
          <input
            ref={searchRef}
            className="cell-select-search"
            type="text"
            value={searchValue}
            placeholder="Search..."
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSearchValue(event.target.value);
              setHighlightIndex(-1);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="cell-select-options">
            {filteredOptions.map((option, index) => {
              const isActive = option.value === value;
              const isHighlighted = index === highlightIndex;
              const optionClassName = [
                "cell-select-option",
                isActive ? "cell-select-option-active" : "",
                isHighlighted ? "cell-select-option-highlight" : "",
              ]
                .filter((item) => item.length > 0)
                .join(" ");

              return (
                <button
                  key={option.value}
                  type="button"
                  className={optionClassName}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </td>
  );
}

export function EditableCardTagsCell(props: EditableTagsCellProps): ReactElement {
  const { value, suggestions, saving, onCommit, cellClassName } = props;
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
            placeholder="Type and press Enter"
            onChange={setDraftTags}
            onEscape={handleClose}
          />
        </div>,
        document.body,
      )}
    </td>
  );
}
