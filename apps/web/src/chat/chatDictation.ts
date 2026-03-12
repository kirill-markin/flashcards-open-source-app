export type ChatDictationState = "idle" | "requesting_permission" | "recording" | "transcribing";

export type ChatDraftSelection = Readonly<{
  start: number;
  end: number;
}>;

export type ChatDraftInsertionResult = Readonly<{
  text: string;
  selection: ChatDraftSelection;
}>;

function isWhitespaceCharacter(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

function normalizeSelection(draft: string, selection: ChatDraftSelection | null): ChatDraftSelection {
  const draftLength = draft.length;
  if (selection === null) {
    return {
      start: draftLength,
      end: draftLength,
    };
  }

  const start = Math.max(0, Math.min(selection.start, draftLength));
  const end = Math.max(0, Math.min(selection.end, draftLength));
  return start <= end
    ? { start, end }
    : { start: end, end: start };
}

export function insertDictationTranscriptIntoDraft(
  draft: string,
  transcript: string,
  selection: ChatDraftSelection | null,
): ChatDraftInsertionResult {
  const trimmedTranscript = transcript.trim();
  const normalizedSelection = normalizeSelection(draft, selection);
  if (trimmedTranscript === "") {
    return {
      text: draft,
      selection: normalizedSelection,
    };
  }

  const before = draft.slice(0, normalizedSelection.start);
  const after = draft.slice(normalizedSelection.end);
  const prefix = before === "" || isWhitespaceCharacter(before.at(-1)) ? "" : " ";
  const suffix = after === "" || isWhitespaceCharacter(after[0]) ? "" : " ";
  const insertedText = `${prefix}${trimmedTranscript}${suffix}`;
  const text = `${before}${insertedText}${after}`;
  const caret = before.length + insertedText.length;

  return {
    text,
    selection: {
      start: caret,
      end: caret,
    },
  };
}
