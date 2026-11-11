import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { AnchoredFloatingOverlay, useAnchoredFloatingOutsidePointerDismiss } from "../../../floating";
import { useI18n } from "../../../i18n";
import type { TagSuggestion, UpdateCardInput } from "../../../types";
import { areSameTags, buildTagEdit, rebaseTagDraft } from "../../../appData/domain/cardTags";
import { CardTagsInput, CardTagsValue, type CardTagsInputHandle } from "../CardTagsInput";

export type CardFormTagEdit = NonNullable<UpdateCardInput["tagEdit"]>;

type CardFormTagsFieldProps = Readonly<{
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<TagSuggestion>;
  inputId?: string;
  inputName?: string;
  triggerTestId?: string;
  onChange: (nextValue: ReadonlyArray<string>, edit: CardFormTagEdit) => void;
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

export const CardFormTagsField = forwardRef<CardFormTagsFieldHandle, CardFormTagsFieldProps>(function CardFormTagsField(
  props,
  ref,
): ReactElement {
  const {
    value,
    suggestions,
    inputId,
    inputName,
    triggerTestId = "card-form-tags-trigger",
    onChange,
    disabled,
  } = props;
  const { t } = useI18n();
  const [tagEdit, setTagEdit] = useState<CardFormTagEdit | null>(null);
  const isOpen = tagEdit !== null;
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CardTagsInputHandle | null>(null);
  const commitDraftRef = useRef<(() => void) | null>(null);

  if (tagEdit !== null && areSameTags(tagEdit.baseline, value) === false) {
    setTagEdit({ baseline: value, draft: rebaseTagDraft(tagEdit.baseline, value, tagEdit.draft) });
  }

  const closeDraft = useCallback((): void => {
    commitDraftRef.current = null;
    setTagEdit(null);
  }, []);

  useLayoutEffect(() => {
    // The document listener can run before React flushes passive effects.
    commitDraftRef.current = tagEdit === null ? null : (): void => {
      const draft = editorRef.current?.flushDraft() ?? tagEdit.draft;
      closeDraft();
      const edit = buildTagEdit(tagEdit.baseline, draft);
      if (edit !== undefined) {
        onChange(draft, edit);
      }
    };
    return () => {
      commitDraftRef.current = null;
    };
  }, [closeDraft, onChange, tagEdit]);

  const handleCommit = useCallback((): void => {
    commitDraftRef.current?.();
  }, []);

  useImperativeHandle(ref, () => ({ commitDraft: handleCommit }), [handleCommit]);

  useAnchoredFloatingOutsidePointerDismiss({
    triggerRef,
    overlayRef,
    enabled: isOpen,
    onClose: handleCommit,
  });

  useEffect(() => {
    if (isOpen) {
      editorRef.current?.focusInput();
    }
  }, [isOpen]);

  function handleTriggerClick(): void {
    if (disabled || triggerRef.current === null) {
      return;
    }

    if (isOpen) {
      handleCommit();
      return;
    }

    setTagEdit({ baseline: value, draft: value });
  }

  const triggerClassName = "settings-input card-form-tags-trigger";

  return (
    <>
      <div
        ref={triggerRef}
        className={triggerClassName}
        onClick={disabled ? undefined : handleTriggerClick}
        data-testid={triggerTestId}
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
          value={tagEdit?.draft ?? value}
          suggestions={suggestions}
          placeholder={t("cardTags.inputPlaceholder")}
          inputId={inputId}
          inputName={inputName}
          onChange={(draft) => {
            if (tagEdit !== null) {
              setTagEdit({ baseline: tagEdit.baseline, draft });
            }
          }}
          onEscape={closeDraft}
        />
      </AnchoredFloatingOverlay>
    </>
  );
});
