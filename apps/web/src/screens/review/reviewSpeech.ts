import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../i18n/types";
import { classifyReviewContentPresentation } from "./reviewContentPresentation";

export type ReviewSpeechSide = "front" | "back";

type UseReviewSpeechParams = Readonly<{
  locale: Locale;
  showMessage: (message: string) => void;
  speechUnavailableMessage: string;
}>;

type UseReviewSpeechResult = Readonly<{
  activeSide: ReviewSpeechSide | null;
  stopSpeech: () => void;
  toggleSpeech: (side: ReviewSpeechSide, sourceText: string) => void;
}>;

const REVIEW_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const REVIEW_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+/;
const REVIEW_BLOCKQUOTE_PATTERN = /^\s{0,3}>\s?/;
const REVIEW_UNORDERED_LIST_PATTERN = /^\s{0,3}[-*+]\s+/;
const REVIEW_ORDERED_LIST_PATTERN = /^\s{0,3}\d+\.\s+/;
const REVIEW_THEMATIC_BREAK_PATTERN = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const REVIEW_TABLE_SEPARATOR_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

type LanguageHeuristic = Readonly<{
  languageTag: string;
  markers: ReadonlyArray<string>;
}>;

const LATIN_LANGUAGE_HEURISTICS: ReadonlyArray<LanguageHeuristic> = [
  {
    languageTag: "es-ES",
    markers: [" el ", " la ", " que ", " de ", " y ", " por ", " para ", " hola ", " gracias ", " cómo ", " está "],
  },
  {
    languageTag: "fr-FR",
    markers: [" le ", " la ", " les ", " des ", " une ", " bonjour ", " merci ", " avec ", " pour ", " est "],
  },
  {
    languageTag: "de-DE",
    markers: [" der ", " die ", " das ", " und ", " nicht ", " danke ", " bitte ", " ist ", " wie ", " ich "],
  },
  {
    languageTag: "it-IT",
    markers: [" il ", " lo ", " gli ", " una ", " ciao ", " grazie ", " per ", " non ", " come ", " che "],
  },
  {
    languageTag: "pt-PT",
    markers: [" não ", " você ", " obrigado ", " olá ", " para ", " com ", " uma ", " que ", " está "],
  },
  {
    languageTag: "en-US",
    markers: [" the ", " and ", " you ", " are ", " with ", " this ", " that ", " hello ", " thanks ", " what "],
  },
];

function sanitizeLanguageTag(languageTag: string): string {
  const normalizedTag = languageTag.replaceAll("_", "-").trim();

  return normalizedTag === "" ? "en-US" : normalizedTag;
}

function primaryLanguageSubtag(languageTag: string): string {
  const normalizedTag = sanitizeLanguageTag(languageTag).toLocaleLowerCase();
  const [primaryLanguage] = normalizedTag.split("-");

  return primaryLanguage ?? normalizedTag;
}

function resolveDetectedLanguageTag(detectedLanguageTag: string, fallbackLanguageTag: string): string {
  const normalizedDetectedLanguageTag = sanitizeLanguageTag(detectedLanguageTag);
  const normalizedFallbackLanguageTag = sanitizeLanguageTag(fallbackLanguageTag);

  if (primaryLanguageSubtag(normalizedDetectedLanguageTag) === primaryLanguageSubtag(normalizedFallbackLanguageTag)) {
    return normalizedFallbackLanguageTag;
  }

  return normalizedDetectedLanguageTag;
}

function normalizeSpeakableInlineText(text: string): string {
  return text
    .replaceAll("`", "")
    .replaceAll("|", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpeakableParagraphs(lines: ReadonlyArray<string>): string {
  return lines
    .map(normalizeSpeakableInlineText)
    .filter((line) => line !== "")
    .join("\n");
}

function fenceMarkerForLine(line: string): string | null {
  const match = REVIEW_FENCE_PATTERN.exec(line);

  if (match === null) {
    return null;
  }

  return match[1] ?? null;
}

function normalizeMarkdownSpeakableLine(line: string): string {
  const trimmedLine = line.trim();

  if (trimmedLine === "") {
    return "";
  }

  if (REVIEW_THEMATIC_BREAK_PATTERN.test(trimmedLine) || REVIEW_TABLE_SEPARATOR_PATTERN.test(trimmedLine)) {
    return "";
  }

  const withoutHeading = trimmedLine.replace(REVIEW_HEADING_PATTERN, "");
  const withoutQuote = withoutHeading.replace(REVIEW_BLOCKQUOTE_PATTERN, "");
  const withoutUnorderedList = withoutQuote.replace(REVIEW_UNORDERED_LIST_PATTERN, "");
  const withoutOrderedList = withoutUnorderedList.replace(REVIEW_ORDERED_LIST_PATTERN, "");

  return normalizeSpeakableInlineText(withoutOrderedList);
}

export function makeReviewSpeakableText(text: string): string {
  if (classifyReviewContentPresentation(text) !== "markdown") {
    return normalizeSpeakableParagraphs(text.split(/\r?\n+/));
  }

  const speakableLines: Array<string> = [];
  const lines = text.split(/\r?\n/);
  let activeFenceMarker: string | null = null;

  for (const line of lines) {
    const marker = fenceMarkerForLine(line);

    if (activeFenceMarker !== null) {
      if (marker === activeFenceMarker) {
        activeFenceMarker = null;
      }

      continue;
    }

    if (marker !== null) {
      activeFenceMarker = marker;
      continue;
    }

    const normalizedLine = normalizeMarkdownSpeakableLine(line);
    if (normalizedLine !== "") {
      speakableLines.push(normalizedLine);
    }
  }

  return normalizeSpeakableParagraphs(speakableLines);
}

function scoreLanguageHeuristic(text: string, heuristic: LanguageHeuristic): number {
  const paddedText = ` ${text} `;

  return heuristic.markers.reduce((score, marker) => {
    return paddedText.includes(marker) ? score + 1 : score;
  }, 0);
}

export function detectReviewSpeechLanguage(text: string, fallbackLanguageTag: string): string {
  const normalizedText = ` ${text.toLocaleLowerCase()} `;

  if (/[\u3040-\u30ff]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("ja-JP", fallbackLanguageTag);
  }
  if (/[\uac00-\ud7af]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("ko-KR", fallbackLanguageTag);
  }
  if (/[\u4e00-\u9fff]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("zh-CN", fallbackLanguageTag);
  }
  if (/[\u0400-\u04ff]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("ru-RU", fallbackLanguageTag);
  }
  if (/[\u0370-\u03ff]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("el-GR", fallbackLanguageTag);
  }
  if (/[\u0590-\u05ff]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("he-IL", fallbackLanguageTag);
  }
  if (/[\u0600-\u06ff]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("ar-SA", fallbackLanguageTag);
  }
  if (/[\u0e00-\u0e7f]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("th-TH", fallbackLanguageTag);
  }
  if (/[\u0900-\u097f]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("hi-IN", fallbackLanguageTag);
  }
  if (/[¿¡ñ]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("es-ES", fallbackLanguageTag);
  }
  if (/[äöüß]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("de-DE", fallbackLanguageTag);
  }
  if (/[ãõ]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("pt-PT", fallbackLanguageTag);
  }
  if (/[àèìòù]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("it-IT", fallbackLanguageTag);
  }
  if (/[çœæ]/u.test(normalizedText)) {
    return resolveDetectedLanguageTag("fr-FR", fallbackLanguageTag);
  }

  let bestLanguageTag: string | null = null;
  let bestScore = 0;

  for (const heuristic of LATIN_LANGUAGE_HEURISTICS) {
    const score = scoreLanguageHeuristic(normalizedText, heuristic);
    if (score > bestScore) {
      bestLanguageTag = heuristic.languageTag;
      bestScore = score;
    }
  }

  if (bestLanguageTag !== null && bestScore > 0) {
    return resolveDetectedLanguageTag(bestLanguageTag, fallbackLanguageTag);
  }

  return sanitizeLanguageTag(fallbackLanguageTag);
}

function selectMatchingVoice(
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  languageTag: string,
): SpeechSynthesisVoice | null {
  const normalizedTag = sanitizeLanguageTag(languageTag).toLocaleLowerCase();
  const primaryLanguage = normalizedTag.split("-")[0] ?? normalizedTag;

  const exactVoice = voices.find((voice) => voice.lang.toLocaleLowerCase() === normalizedTag);
  if (exactVoice !== undefined) {
    return exactVoice;
  }

  const prefixVoice = voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith(`${primaryLanguage}-`));
  if (prefixVoice !== undefined) {
    return prefixVoice;
  }

  const primaryMatchVoice = voices.find((voice) => voice.lang.toLocaleLowerCase() === primaryLanguage);
  return primaryMatchVoice ?? null;
}

export function useReviewSpeech(params: UseReviewSpeechParams): UseReviewSpeechResult {
  const { locale, showMessage, speechUnavailableMessage } = params;
  const [activeSide, setActiveSide] = useState<ReviewSpeechSide | null>(null);
  const activeSideRef = useRef<ReviewSpeechSide | null>(null);
  const voicesRef = useRef<ReadonlyArray<SpeechSynthesisVoice>>([]);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const showMessageRef = useRef<(message: string) => void>(showMessage);

  useEffect(() => {
    activeSideRef.current = activeSide;
  }, [activeSide]);

  useEffect(() => {
    showMessageRef.current = showMessage;
  }, [showMessage]);

  const stopSpeech = useCallback(() => {
    if (typeof window.speechSynthesis === "undefined") {
      setActiveSide(null);
      activeUtteranceRef.current = null;
      return;
    }

    window.speechSynthesis.cancel();
    activeUtteranceRef.current = null;
    setActiveSide(null);
  }, []);

  const toggleSpeech = useCallback((side: ReviewSpeechSide, sourceText: string) => {
    const speakableText = makeReviewSpeakableText(sourceText);

    if (speakableText === "") {
      return;
    }

    if (typeof window.speechSynthesis === "undefined" || typeof window.SpeechSynthesisUtterance === "undefined") {
      showMessageRef.current(speechUnavailableMessage);
      return;
    }

    const synthesis = window.speechSynthesis;

    if (activeSideRef.current === side && (synthesis.speaking || synthesis.pending)) {
      stopSpeech();
      return;
    }

    synthesis.cancel();
    activeUtteranceRef.current = null;

    const utterance = new window.SpeechSynthesisUtterance(speakableText);
    const languageTag = detectReviewSpeechLanguage(speakableText, locale);
    const voices = synthesis.getVoices();
    const availableVoices = voices.length === 0 ? voicesRef.current : voices;
    const selectedVoice = selectMatchingVoice(availableVoices, languageTag);

    utterance.lang = languageTag;
    if (selectedVoice !== null) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
      activeUtteranceRef.current = utterance;
      setActiveSide(side);
    };

    utterance.onend = () => {
      if (activeUtteranceRef.current === utterance) {
        activeUtteranceRef.current = null;
      }
      setActiveSide((currentSide) => currentSide === side ? null : currentSide);
    };

    utterance.onerror = () => {
      if (activeUtteranceRef.current === utterance) {
        activeUtteranceRef.current = null;
      }
      setActiveSide((currentSide) => currentSide === side ? null : currentSide);
      showMessageRef.current(speechUnavailableMessage);
    };

    try {
      synthesis.speak(utterance);
    } catch {
      activeUtteranceRef.current = null;
      setActiveSide(null);
      showMessageRef.current(speechUnavailableMessage);
    }
  }, [locale, speechUnavailableMessage, stopSpeech]);

  useEffect(() => {
    if (typeof window.speechSynthesis === "undefined") {
      return;
    }

    const synthesis = window.speechSynthesis;

    function refreshVoices(): void {
      voicesRef.current = synthesis.getVoices();
    }

    const previousVoicesChangedHandler = synthesis.onvoiceschanged;

    refreshVoices();
    synthesis.onvoiceschanged = () => {
      refreshVoices();
      if (typeof previousVoicesChangedHandler === "function") {
        previousVoicesChangedHandler.call(synthesis, new Event("voiceschanged"));
      }
    };

    return () => {
      synthesis.onvoiceschanged = previousVoicesChangedHandler;
      synthesis.cancel();
      activeUtteranceRef.current = null;
      setActiveSide(null);
    };
  }, []);

  return {
    activeSide,
    stopSpeech,
    toggleSpeech,
  };
}
