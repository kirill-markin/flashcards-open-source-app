import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { deriveActiveCards } from "../appData/domain";
import type { Card, TagSuggestion } from "../types";

type ExistingTagOption = Readonly<{
  key: string;
  value: string;
  label: string;
  kind: "existing";
  suggestion: TagSuggestion;
}>;

type CreateTagOption = Readonly<{
  key: string;
  value: string;
  label: string;
  kind: "create";
}>;

type TagOption = ExistingTagOption | CreateTagOption;

type CardTagsInputProps = Readonly<{
  value: ReadonlyArray<string>;
  suggestions: ReadonlyArray<TagSuggestion>;
  placeholder: string;
  inputId?: string;
  inputName?: string;
  onChange: (nextValue: ReadonlyArray<string>) => void;
  onEscape?: () => void;
}>;

export type CardTagsInputHandle = Readonly<{
  focusInput: () => void;
  flushDraft: () => ReadonlyArray<string>;
}>;

type CardTagsValueProps = Readonly<{
  tags: ReadonlyArray<string>;
  emptyLabel: string;
}>;

function normalizeTag(tag: string): string {
  return tag.trim();
}

function hasTag(tags: ReadonlyArray<string>, nextTag: string): boolean {
  return tags.some((tag) => tag === nextTag);
}

function appendTag(tags: ReadonlyArray<string>, rawTag: string): ReadonlyArray<string> {
  const nextTag = normalizeTag(rawTag);
  if (nextTag === "" || hasTag(tags, nextTag)) {
    return tags;
  }

  return [...tags, nextTag];
}

function appendTags(tags: ReadonlyArray<string>, rawTags: ReadonlyArray<string>): ReadonlyArray<string> {
  let nextTags = tags;

  for (const rawTag of rawTags) {
    nextTags = appendTag(nextTags, rawTag);
  }

  return nextTags;
}

function removeTag(tags: ReadonlyArray<string>, nextTag: string): ReadonlyArray<string> {
  return tags.filter((tag) => tag !== nextTag);
}

function splitTagDraft(value: string): ReadonlyArray<string> {
  return value
    .split(/[\n,]+/)
    .map(normalizeTag)
    .filter((tag) => tag !== "");
}

function compareTagSuggestions(left: TagSuggestion, right: TagSuggestion): number {
  if (left.countState === "ready" && right.countState === "ready") {
    if (right.cardsCount !== left.cardsCount) {
      return right.cardsCount - left.cardsCount;
    }
  } else if (left.countState === "ready") {
    return -1;
  } else if (right.countState === "ready") {
    return 1;
  }

  return left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" });
}

function getSelectedTagSuggestions(
  selectedTags: ReadonlyArray<string>,
  suggestions: ReadonlyArray<TagSuggestion>,
): ReadonlyArray<TagSuggestion> {
  const suggestionsByTag = suggestions.reduce((result, suggestion) => {
    result.set(suggestion.tag, suggestion);
    return result;
  }, new Map<string, TagSuggestion>());

  return selectedTags
    .map((tag) => suggestionsByTag.get(tag) ?? ({
      tag,
      countState: "ready",
      cardsCount: 0,
    } satisfies TagSuggestion))
    .sort(compareTagSuggestions);
}

function getTagOptions(
  selectedTags: ReadonlyArray<string>,
  suggestions: ReadonlyArray<TagSuggestion>,
  draftValue: string,
): ReadonlyArray<TagOption> {
  const normalizedDraft = normalizeTag(draftValue).toLowerCase();
  const existingOptions = suggestions
    .filter((suggestion) => !hasTag(selectedTags, suggestion.tag))
    .filter((suggestion) => normalizedDraft === "" || suggestion.tag.toLowerCase().includes(normalizedDraft))
    .map((suggestion) => ({
      key: `existing:${suggestion.tag}`,
      value: suggestion.tag,
      label: suggestion.tag,
      kind: "existing" as const,
      suggestion,
    }));

  const draftTag = normalizeTag(draftValue);
  if (draftTag === "" || hasTag(selectedTags, draftTag) || existingOptions.some((option) => option.value === draftTag)) {
    return existingOptions;
  }

  return [
    {
      key: `create:${draftTag}`,
      value: draftTag,
      label: `Create "${draftTag}"`,
      kind: "create",
    },
    ...existingOptions,
  ];
}

export function getTagSuggestionsFromCards(cards: ReadonlyArray<Card>): ReadonlyArray<TagSuggestion> {
  const counts = new Map<string, number>();

  for (const card of deriveActiveCards(cards)) {
    for (const tag of new Set(card.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, cardsCount]) => ({
      tag,
      countState: "ready",
      cardsCount,
    } satisfies TagSuggestion))
    .sort(compareTagSuggestions);
}

export function areSameTags(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((tag, index) => tag === right[index]);
}

export function CardTagsValue(props: CardTagsValueProps): ReactElement {
  const { tags, emptyLabel } = props;

  if (tags.length === 0) {
    return <span className="tag-value-empty">{emptyLabel}</span>;
  }

  return (
    <span className="tag-value-list">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip tag-chip-readonly">
          <span className="tag-chip-label">{tag}</span>
        </span>
      ))}
    </span>
  );
}

function renderTagSuggestionMeta(option: TagOption): ReactElement {
  if (option.kind === "create") {
    return <span className="tag-suggestion-kind">new</span>;
  }

  if (option.suggestion.countState === "loading") {
    return (
      <span className="tag-suggestion-meta">
        <span className="tag-suggestion-spinner" aria-label="Loading tag count" />
      </span>
    );
  }

  return (
    <span className="tag-suggestion-meta tag-suggestion-count">
      {option.suggestion.cardsCount}
    </span>
  );
}

export const CardTagsInput = forwardRef<CardTagsInputHandle, CardTagsInputProps>(function CardTagsInput(props, ref) {
  const { value, suggestions, placeholder, inputId, inputName, onChange, onEscape } = props;
  const [selectedTags, setSelectedTags] = useState<ReadonlyArray<string>>(value);
  const [draftValue, setDraftValue] = useState<string>("");
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const options = useMemo(
    () => getTagOptions(selectedTags, suggestions, draftValue),
    [draftValue, selectedTags, suggestions],
  );
  const selectedTagSuggestions = useMemo(
    () => getSelectedTagSuggestions(selectedTags, suggestions),
    [selectedTags, suggestions],
  );

  useEffect(() => {
    if (highlightIndex >= options.length) {
      setHighlightIndex(options.length - 1);
    }
  }, [highlightIndex, options.length]);

  useEffect(() => {
    if (areSameTags(selectedTags, value)) {
      return;
    }

    setSelectedTags(value);
  }, [selectedTags, value]);

  function focusInput(): void {
    if (inputRef.current !== null) {
      inputRef.current.focus();
    }
  }

  function flushDraft(): ReadonlyArray<string> {
    const nextTags = appendTags(selectedTags, splitTagDraft(draftValue));
    setSelectedTags(nextTags);
    if (!areSameTags(nextTags, value)) {
      onChange(nextTags);
    }

    setDraftValue("");
    setHighlightIndex(-1);
    return nextTags;
  }

  useImperativeHandle(ref, () => ({
    focusInput,
    flushDraft,
  }), [draftValue, onChange, selectedTags, value]);

  function handleSelect(nextTag: string): void {
    const nextTags = appendTag(selectedTags, nextTag);
    setSelectedTags(nextTags);
    if (!areSameTags(nextTags, value)) {
      onChange(nextTags);
    }

    setDraftValue("");
    setHighlightIndex(-1);
    focusInput();
  }

  function handleRemove(nextTag: string): void {
    const nextTags = removeTag(selectedTags, nextTag);
    setSelectedTags(nextTags);
    if (!areSameTags(nextTags, value)) {
      onChange(nextTags);
    }

    focusInput();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setHighlightIndex(-1);
      setDraftValue("");
      if (onEscape !== undefined) {
        onEscape();
      }
      return;
    }

    if (event.key === "Backspace" && draftValue === "" && selectedTagSuggestions.length > 0) {
      event.preventDefault();
      handleRemove(selectedTagSuggestions[selectedTagSuggestions.length - 1].tag);
      return;
    }

    if (event.key === "ArrowDown") {
      if (options.length === 0) {
        return;
      }

      event.preventDefault();
      setHighlightIndex((currentIndex) => (
        currentIndex < options.length - 1 ? currentIndex + 1 : 0
      ));
      return;
    }

    if (event.key === "ArrowUp") {
      if (options.length === 0) {
        return;
      }

      event.preventDefault();
      setHighlightIndex((currentIndex) => (
        currentIndex > 0 ? currentIndex - 1 : options.length - 1
      ));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (highlightIndex >= 0 && highlightIndex < options.length) {
        handleSelect(options[highlightIndex].value);
        return;
      }

      flushDraft();
      return;
    }

    if (event.key === ",") {
      event.preventDefault();
      flushDraft();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>): void {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText.includes(",") && !pastedText.includes("\n")) {
      return;
    }

    event.preventDefault();
    const nextTags = appendTags(selectedTags, splitTagDraft(pastedText));
    setSelectedTags(nextTags);
    if (!areSameTags(nextTags, value)) {
      onChange(nextTags);
    }

    setDraftValue("");
    setHighlightIndex(-1);
  }

  return (
    <div
      className="tag-input"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        focusInput();
      }}
    >
      <div className="tag-input-surface">
        {selectedTagSuggestions.map((suggestion) => (
          <span key={suggestion.tag} className="tag-chip">
            <span className="tag-chip-label">{suggestion.tag}</span>
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`Remove ${suggestion.tag}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                handleRemove(suggestion.tag);
              }}
            >
              x
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          name={inputName}
          className="tag-input-field"
          type="text"
          value={draftValue}
          placeholder={placeholder}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            flushDraft();
            setIsFocused(false);
          }}
          onChange={(event) => {
            setDraftValue(event.target.value);
            setHighlightIndex(-1);
          }}
          onKeyDown={handleInputKeyDown}
          onPaste={handlePaste}
        />
      </div>

      {isFocused ? (
        <div className="tag-suggestions">
          <div className="tag-suggestions-head">Select or create tags</div>
          <div className="tag-suggestions-list">
            {options.length === 0 ? (
              <div className="tag-suggestions-empty">No matching tags</div>
            ) : (
              options.map((option, index) => {
                const isHighlighted = index === highlightIndex;
                const optionClassName = [
                  "tag-suggestion-button",
                  isHighlighted ? "tag-suggestion-button-highlight" : "",
                ]
                  .filter((item) => item !== "")
                  .join(" ");

                return (
                  <button
                    key={option.key}
                    type="button"
                    className={optionClassName}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => handleSelect(option.value)}
                  >
                    <span className="tag-suggestion-label">{option.label}</span>
                    {renderTagSuggestionMeta(option)}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
});
