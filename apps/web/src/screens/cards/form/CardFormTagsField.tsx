import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss } from "../../../floating";
import { useI18n } from "../../../i18n";
import type { TagSuggestion } from "../../../types";
import { areSameTags, CardTagsInput, CardTagsValue, type CardTagsInputHandle } from "../CardTagsInput";

type CardFormTagsFieldProps = Readonly<{
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<TagSuggestion>;
  inputId?: string;
  inputName?: string;
  onChange: (nextValue: ReadonlyArray<string>) => void;
  disabled: boolean;
}>;

const tagsOverlayViewportPaddingPx = 12;
const tagsOverlayOffsetPx = 8;
const tagsOverlayMinimumWidthPx = 320;
const tagsOverlayMaximumWidthPx = 420;
const tagsOverlayMaximumHeightPx = 320;

export function CardFormTagsField(props: CardFormTagsFieldProps): ReactElement {
  const { value, suggestions, inputId, inputName, onChange, disabled } = props;
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [draftTags, setDraftTags] = useState<ReadonlyArray<string>>(value);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CardTagsInputHandle | null>(null);

  const handleCancel = useCallback((): void => {
    setIsOpen(false);
    setDraftTags(value);
  }, [value]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef,
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

  function handleTriggerClick(): void {
    if (disabled || triggerRef.current === null) {
      return;
    }

    if (isOpen) {
      handleCommit();
      return;
    }

    setDraftTags(value);
    setIsOpen(true);
  }

  function handleCommit(): void {
    const nextTags = editorRef.current === null ? draftTags : editorRef.current.flushDraft();
    setIsOpen(false);

    if (areSameTags(nextTags, value)) {
      setDraftTags(value);
      return;
    }

    onChange(nextTags);
  }

  const triggerClassName = `settings-input card-form-tags-trigger${disabled ? " cards-cell-disabled" : ""}`;

  return (
    <>
      <div
        ref={triggerRef}
        className={triggerClassName}
        onClick={disabled ? undefined : handleTriggerClick}
        data-testid="card-form-tags-trigger"
      >
        <CardTagsValue tags={value} emptyLabel={t("cardTags.triggerEmpty")} />
      </div>

      <AnchoredFloatingOverlay
        isOpen={isOpen}
        referenceRef={triggerRef}
        floatingRef={overlayRef}
        placement="bottom-start"
        viewportPaddingPx={tagsOverlayViewportPaddingPx}
        offsetPx={tagsOverlayOffsetPx}
        minimumWidth={{ kind: "reference-or-pixels", pixels: tagsOverlayMinimumWidthPx }}
        maxWidthPx={tagsOverlayMaximumWidthPx}
        maxHeightPx={tagsOverlayMaximumHeightPx}
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
          inputId={inputId}
          inputName={inputName}
          onChange={setDraftTags}
          onEscape={handleCancel}
        />
      </AnchoredFloatingOverlay>
    </>
  );
}
