import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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

export type CardFormTagsFieldHandle = Readonly<{
  commitDraft: () => void;
}>;

const tagsOverlayViewportPaddingPx = 12;
const tagsOverlayOffsetPx = 8;
const tagsOverlayMinimumWidthPx = 320;
const tagsOverlayMaximumWidthPx = 420;
const tagsOverlayMaximumHeightPx = 320;

function rebaseOpenTagsDraft(
  previousValue: ReadonlyArray<string>,
  nextValue: ReadonlyArray<string>,
  draftTags: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (areSameTags(draftTags, previousValue)) {
    return nextValue;
  }

  const previousTags = new Set(previousValue);
  const nextTags = new Set(nextValue);
  const draftTagSet = new Set(draftTags);
  const removedTags = new Set(
    previousValue.filter((tag) => draftTagSet.has(tag) === false),
  );
  const localAdditions = draftTags.filter((tag) => previousTags.has(tag) === false);
  const previousSurvivingOrder = previousValue.filter((tag) => draftTagSet.has(tag));
  const draftPreviousOrder = draftTags.filter((tag) => previousTags.has(tag));

  if (areSameTags(previousSurvivingOrder, draftPreviousOrder)) {
    const rebasedTags = nextValue.filter((tag) => removedTags.has(tag) === false);
    const rebasedTagSet = new Set(rebasedTags);
    return [
      ...rebasedTags,
      ...localAdditions.filter((tag) => rebasedTagSet.has(tag) === false),
    ];
  }

  const rebasedLocalTags = draftTags.filter((tag) => (
    nextTags.has(tag) || previousTags.has(tag) === false
  ));
  const rebasedLocalTagSet = new Set(rebasedLocalTags);
  return [
    ...rebasedLocalTags,
    ...nextValue.filter((tag) => (
      rebasedLocalTagSet.has(tag) === false
      && removedTags.has(tag) === false
    )),
  ];
}

export const CardFormTagsField = forwardRef<CardFormTagsFieldHandle, CardFormTagsFieldProps>(function CardFormTagsField(
  props,
  ref,
): ReactElement {
  const { value, suggestions, inputId, inputName, onChange, disabled } = props;
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [draftTags, setDraftTags] = useState<ReadonlyArray<string>>(value);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CardTagsInputHandle | null>(null);
  const previousValueRef = useRef<ReadonlyArray<string>>(value);

  const handleCommit = useCallback((): void => {
    const nextTags = editorRef.current === null ? draftTags : editorRef.current.flushDraft();
    setIsOpen(false);

    if (areSameTags(nextTags, value)) {
      setDraftTags(value);
      return;
    }

    onChange(nextTags);
  }, [draftTags, onChange, value]);

  const handleCancel = useCallback((): void => {
    setIsOpen(false);
    setDraftTags(value);
  }, [value]);

  useImperativeHandle(ref, () => ({
    commitDraft: (): void => {
      if (isOpen) {
        handleCommit();
      }
    },
  }), [handleCommit, isOpen]);

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
    const previousValue = previousValueRef.current;
    previousValueRef.current = value;
    if (isOpen) {
      if (areSameTags(previousValue, value) === false) {
        setDraftTags((currentDraftTags) => (
          rebaseOpenTagsDraft(previousValue, value, currentDraftTags)
        ));
      }
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
});
