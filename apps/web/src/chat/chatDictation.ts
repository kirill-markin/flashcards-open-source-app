export type ChatDictationState = "idle" | "requesting_permission" | "recording" | "transcribing";

function endsWithWhitespace(value: string): boolean {
  return /\s$/.test(value);
}

export function mergeDictationTranscriptIntoDraft(draft: string, transcript: string): string {
  const trimmedTranscript = transcript.trim();
  if (trimmedTranscript === "") {
    return draft;
  }

  const prefix = draft === "" || endsWithWhitespace(draft) ? "" : " ";
  const suffix = endsWithWhitespace(trimmedTranscript) ? "" : " ";
  return `${draft}${prefix}${trimmedTranscript}${suffix}`;
}
