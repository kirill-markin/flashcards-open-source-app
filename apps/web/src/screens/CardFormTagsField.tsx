import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { areSameTags, CardTagsInput, CardTagsValue, type CardTagsInputHandle } from "./CardTagsInput";

type OverlayRect = Readonly<{
  top: number;
  left: number;
  width: number;
  height: number;
}>;

type CardFormTagsFieldProps = Readonly<{
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<string>;
  inputId?: string;
  inputName?: string;
  onChange: (nextValue: ReadonlyArray<string>) => void;
  disabled: boolean;
}>;

function getOverlayRect(element: HTMLElement): OverlayRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
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
  anchorRef: RefObject<HTMLElement | null>,
  onUpdate: (rect: OverlayRect) => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleViewportChange(): void {
      if (anchorRef.current === null) {
        return;
      }

      onUpdate(getOverlayRect(anchorRef.current));
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [anchorRef, isOpen, onUpdate]);
}

function useOutsidePointerClose(
  isOpen: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;

      if (overlayRef.current !== null && overlayRef.current.contains(target)) {
        return;
      }

      if (triggerRef.current !== null && triggerRef.current.contains(target)) {
        return;
      }

      onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, onClose, overlayRef, triggerRef]);
}

export function CardFormTagsField(props: CardFormTagsFieldProps): ReactElement {
  const { value, suggestions, inputId, inputName, onChange, disabled } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [draftTags, setDraftTags] = useState<ReadonlyArray<string>>(value);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CardTagsInputHandle | null>(null);

  const handleCancel = useCallback((): void => {
    setIsOpen(false);
    setOverlayRect(null);
    setDraftTags(value);
  }, [value]);

  useOverlayTracking(isOpen, triggerRef, setOverlayRect);
  useOutsidePointerClose(isOpen, triggerRef, overlayRef, handleCommit);

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
    if (disabled || triggerRef.current === null) {
      return;
    }

    setDraftTags(value);
    setOverlayRect(getOverlayRect(triggerRef.current));
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

    onChange(nextTags);
  }

  const overlayStyle = overlayRect === null ? null : getTagsOverlayStyle(overlayRect);
  const triggerClassName = `settings-input card-form-tags-trigger${disabled ? " cards-cell-disabled" : ""}`;

  return (
    <>
      <div
        ref={triggerRef}
        className={triggerClassName}
        onClick={disabled ? undefined : handleOpen}
      >
        <CardTagsValue tags={value} emptyLabel="Click to add tags" />
      </div>

      {isOpen && overlayStyle !== null && createPortal(
        <div ref={overlayRef} className="cell-select-overlay cell-tags-overlay card-form-tags-overlay" style={overlayStyle}>
          <CardTagsInput
            ref={editorRef}
            value={draftTags}
            suggestions={suggestions}
            placeholder="Type and press Enter"
            inputId={inputId}
            inputName={inputName}
            onChange={setDraftTags}
            onEscape={handleCancel}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
