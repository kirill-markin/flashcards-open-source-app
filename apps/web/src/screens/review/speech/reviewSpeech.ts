import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../i18n/types";
import { classifyReviewContentPresentation } from "../components/card/reviewContentPresentation";
import {
  normalizeReviewPlainTextEscapedDollars,
  splitEligibleReviewMathForSpeech,
  type ReviewMathSpeechSegment,
} from "../components/card/reviewMathBlocks";

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

const REVIEW_SPEECH_LETTER_PATTERN = /\p{L}/u;
const REVIEW_SPEECH_LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const REVIEW_SPEECH_NEUTRAL_LETTER_PATTERN = /\p{Script=Common}|\p{Script=Inherited}/u;
// Each script matches its legacy range OR its Unicode Script property: the property covers letters outside
// the range (`\u3005`, half-width katakana, polytonic Greek), and the range keeps Script=Common letters such as `\u30fc`,
// `\u3006`, and the half-width `\uff70`, `\uff9e`, `\uff9f`.
const REVIEW_SPEECH_KANA_PATTERN = /[\u3040-\u30ff\uff65-\uff9f]|\p{Script=Hiragana}|\p{Script=Katakana}/u;
const REVIEW_SPEECH_HANGUL_PATTERN = /[\uac00-\ud7af]|\p{Script=Hangul}/u;
const REVIEW_SPEECH_HAN_PATTERN = /[\u3006\u4e00-\u9fff]|\p{Script=Han}/u;

type ReviewSpeechAlphabetScript = Readonly<{
  languageTag: string;
  pattern: RegExp;
}>;

const REVIEW_SPEECH_ALPHABET_SCRIPTS: ReadonlyArray<ReviewSpeechAlphabetScript> = [
  { languageTag: "ru-RU", pattern: /[\u0400-\u04ff]|\p{Script=Cyrillic}/u },
  { languageTag: "el-GR", pattern: /[\u0370-\u03ff]|\p{Script=Greek}/u },
  { languageTag: "he-IL", pattern: /[\u0590-\u05ff]|\p{Script=Hebrew}/u },
  { languageTag: "ar-SA", pattern: /[\u0600-\u06ff]|\p{Script=Arabic}/u },
  { languageTag: "th-TH", pattern: /[\u0e00-\u0e7f]|\p{Script=Thai}/u },
  { languageTag: "hi-IN", pattern: /[\u0900-\u097f]|\p{Script=Devanagari}/u },
];

type ReviewSpeechScript = "cjk" | "latin" | "other" | ReviewSpeechAlphabetScript;

type ReviewSpeechScriptRun = Readonly<{
  script: ReviewSpeechScript;
  text: string;
}>;

export type ReviewSpeechSegment = Readonly<{
  languageTag: string;
  text: string;
}>;

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

function normalizeMarkdownSpeakableLine(line: string, startsAtLineBoundary: boolean): string {
  const trimmedLine = line.trim();

  if (trimmedLine === "") {
    return "";
  }

  if (startsAtLineBoundary === false) {
    return normalizeSpeakableInlineText(line);
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
    const plainText = normalizeReviewPlainTextEscapedDollars(text);
    return normalizeSpeakableParagraphs(plainText.split(/\r?\n+/));
  }

  const segments: ReadonlyArray<ReviewMathSpeechSegment> = text.includes("$")
    ? splitEligibleReviewMathForSpeech(text)
    : [{ kind: "prose", startsAtLineBoundary: true, value: text }];
  const speakableLines: Array<string> = [];
  let activeFenceMarker: string | null = null;

  for (const segment of segments) {
    if (segment.kind === "formula") {
      if (segment.value !== "") {
        speakableLines.push(segment.value);
      }
      continue;
    }

    const lines = segment.value.split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      const startsAtLineBoundary = segment.startsAtLineBoundary || lineIndex > 0;
      const marker = startsAtLineBoundary ? fenceMarkerForLine(line) : null;

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

      const normalizedLine = normalizeMarkdownSpeakableLine(line, startsAtLineBoundary);
      if (normalizedLine !== "") {
        speakableLines.push(normalizedLine);
      }
    }
  }

  return speakableLines.join("\n");
}

function scoreLanguageHeuristic(text: string, heuristic: LanguageHeuristic): number {
  const paddedText = ` ${text} `;

  return heuristic.markers.reduce((score, marker) => {
    return paddedText.includes(marker) ? score + 1 : score;
  }, 0);
}

function isLatinScriptLanguageTag(languageTag: string): boolean {
  try {
    const script = new Intl.Locale(sanitizeLanguageTag(languageTag)).maximize().script;
    return script === undefined || script === "Latn";
  } catch (error) {
    // A tag Intl.Locale rejects has no known script, so it keeps the Latin fallback the contract requires.
    if (error instanceof RangeError) {
      return true;
    }
    throw error;
  }
}

function detectCjkLanguageTag(text: string): string {
  if (REVIEW_SPEECH_KANA_PATTERN.test(text)) {
    return "ja-JP";
  }
  if (REVIEW_SPEECH_HANGUL_PATTERN.test(text)) {
    return "ko-KR";
  }
  return "zh-CN";
}

function detectLatinLanguageTag(text: string, fallbackLanguageTag: string): string {
  const normalizedText = ` ${text.toLocaleLowerCase()} `;

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

function classifyReviewSpeechLetter(character: string): ReviewSpeechScript | null {
  // The letter gate runs before the script checks so combining marks (Russian stress marks, niqqud) stay neutral.
  if (REVIEW_SPEECH_LETTER_PATTERN.test(character) === false) {
    return null;
  }
  if (
    REVIEW_SPEECH_KANA_PATTERN.test(character)
    || REVIEW_SPEECH_HANGUL_PATTERN.test(character)
    || REVIEW_SPEECH_HAN_PATTERN.test(character)
  ) {
    return "cjk";
  }

  const alphabetScript = REVIEW_SPEECH_ALPHABET_SCRIPTS.find((script) => script.pattern.test(character));
  if (alphabetScript !== undefined) {
    return alphabetScript;
  }

  // Runs after the range checks above, which claim the Script=Common letters `\u30fc`, `\u3006`, `\uff70`, and `\u0640`;
  // the remaining Common letters (IPA `\u02c8`, `\u02d0`, ʻokina, `\u00b5`) must not split a word into another run.
  if (REVIEW_SPEECH_NEUTRAL_LETTER_PATTERN.test(character)) {
    return null;
  }

  // Letters of scripts without a detection rule keep the fallback voice instead of the Latin rule.
  return REVIEW_SPEECH_LATIN_LETTER_PATTERN.test(character) ? "latin" : "other";
}

function splitReviewSpeechLineIntoScriptRuns(line: string): ReadonlyArray<ReviewSpeechScriptRun> {
  const runs: Array<ReviewSpeechScriptRun> = [];
  // Neutrals seen since the last letter; their owner is decided by the next letter's script.
  let pendingNeutralText = "";

  for (const character of line) {
    const script = classifyReviewSpeechLetter(character);
    const lastRun = runs[runs.length - 1];

    if (script === null) {
      pendingNeutralText += character;
      continue;
    }

    if (lastRun === undefined) {
      runs.push({ script, text: pendingNeutralText + character });
    } else if (script === lastRun.script) {
      runs[runs.length - 1] = { script, text: lastRun.text + pendingNeutralText + character };
    } else {
      // Neutrals after the last whitespace open the next run, so `¿` in `Где это? — ¿Dónde está?` keeps its
      // Spanish hint; a stretch without whitespace stays with the previous run.
      const lastWhitespaceIndex = pendingNeutralText.search(/\s(?=\S*$)/u);
      const splitIndex = lastWhitespaceIndex === -1 ? pendingNeutralText.length : lastWhitespaceIndex + 1;
      runs[runs.length - 1] = { script: lastRun.script, text: lastRun.text + pendingNeutralText.slice(0, splitIndex) };
      runs.push({ script, text: pendingNeutralText.slice(splitIndex) + character });
    }
    pendingNeutralText = "";
  }

  const lastRun = runs[runs.length - 1];
  if (lastRun === undefined) {
    return [{ script: "other", text: pendingNeutralText }];
  }
  runs[runs.length - 1] = { script: lastRun.script, text: lastRun.text + pendingNeutralText };
  return runs;
}

function detectScriptRunLanguageTag(
  run: ReviewSpeechScriptRun,
  fallbackLanguageTag: string,
  latinFallbackLanguageTag: string,
  cjkLanguageTag: string,
): string {
  if (run.script === "cjk") {
    return cjkLanguageTag;
  }
  if (run.script === "latin") {
    return detectLatinLanguageTag(run.text, latinFallbackLanguageTag);
  }
  if (run.script === "other") {
    return sanitizeLanguageTag(fallbackLanguageTag);
  }
  return resolveDetectedLanguageTag(run.script.languageTag, fallbackLanguageTag);
}

/**
 * Lines are never merged, so every line break becomes an utterance boundary and a spoken pause.
 * Latin text without a language hint uses en-US when the fallback language is not written in Latin script.
 * Every CJK run shares one language decided from the whole text, kana-block punctuation included, so a
 * kanji-only line of a Japanese card stays Japanese.
 */
export function splitReviewSpeechSegments(
  speakableText: string,
  fallbackLanguageTag: string,
): ReadonlyArray<ReviewSpeechSegment> {
  const latinFallbackLanguageTag = isLatinScriptLanguageTag(fallbackLanguageTag) ? fallbackLanguageTag : "en-US";
  const cjkLanguageTag = resolveDetectedLanguageTag(detectCjkLanguageTag(speakableText), fallbackLanguageTag);

  return speakableText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap((line) => {
      const lineSegments: Array<ReviewSpeechSegment> = [];

      for (const run of splitReviewSpeechLineIntoScriptRuns(line)) {
        const languageTag = detectScriptRunLanguageTag(
          run,
          fallbackLanguageTag,
          latinFallbackLanguageTag,
          cjkLanguageTag,
        );
        const lastSegment = lineSegments[lineSegments.length - 1];

        if (lastSegment !== undefined && lastSegment.languageTag === languageTag) {
          lineSegments[lineSegments.length - 1] = { text: lastSegment.text + run.text, languageTag };
        } else {
          lineSegments.push({ text: run.text, languageTag });
        }
      }

      return lineSegments;
    });
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
  // Bumped on every cancel we issue, so callbacks of a stopped or replaced playback stay silent.
  const playbackIdRef = useRef<number>(0);
  // Chrome can garbage-collect queued utterances nothing references, and then their onend never fires.
  const activeUtterancesRef = useRef<ReadonlyArray<SpeechSynthesisUtterance>>([]);
  const showMessageRef = useRef<(message: string) => void>(showMessage);

  useEffect(() => {
    activeSideRef.current = activeSide;
  }, [activeSide]);

  useEffect(() => {
    showMessageRef.current = showMessage;
  }, [showMessage]);

  const stopSpeech = useCallback(() => {
    playbackIdRef.current += 1;
    activeUtterancesRef.current = [];

    if (typeof window.speechSynthesis === "undefined") {
      setActiveSide(null);
      return;
    }

    window.speechSynthesis.cancel();
    setActiveSide(null);
  }, []);

  const toggleSpeech = useCallback((side: ReviewSpeechSide, sourceText: string) => {
    const segments = splitReviewSpeechSegments(makeReviewSpeakableText(sourceText), locale);

    if (segments.length === 0) {
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

    playbackIdRef.current += 1;
    const playbackId = playbackIdRef.current;
    synthesis.cancel();

    const voices = synthesis.getVoices();
    const availableVoices = voices.length === 0 ? voicesRef.current : voices;
    const utterances = segments.map((segment, segmentIndex) => {
      const utterance = new window.SpeechSynthesisUtterance(segment.text);
      const selectedVoice = selectMatchingVoice(availableVoices, segment.languageTag);

      utterance.lang = segment.languageTag;
      if (selectedVoice !== null) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => {
        if (playbackIdRef.current === playbackId) {
          setActiveSide(side);
        }
      };

      utterance.onend = () => {
        if (playbackIdRef.current === playbackId && segmentIndex === segments.length - 1) {
          activeUtterancesRef.current = [];
          setActiveSide(null);
        }
      };

      utterance.onerror = () => {
        if (playbackIdRef.current !== playbackId) {
          return;
        }
        stopSpeech();
        showMessageRef.current(speechUnavailableMessage);
      };

      return utterance;
    });
    activeUtterancesRef.current = utterances;

    try {
      for (const utterance of utterances) {
        synthesis.speak(utterance);
      }
    } catch {
      stopSpeech();
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
      playbackIdRef.current += 1;
      activeUtterancesRef.current = [];
      synthesis.cancel();
      setActiveSide(null);
    };
  }, []);

  return {
    activeSide,
    stopSpeech,
    toggleSpeech,
  };
}
