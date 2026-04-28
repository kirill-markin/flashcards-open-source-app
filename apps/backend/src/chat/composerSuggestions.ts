/**
 * Shared domain rules for AI chat composer suggestions.
 * Session rows expose only the active suggestion set, while history is stored
 * separately as append-only generations.
 */
import { z } from "zod";
import { CHAT_MODEL_ID } from "./config";
import { getOpenAIClient } from "./openai/client";
import { buildOpenAISafetyIdentifier } from "./openai/safetyIdentifier";
import type { ContentPart } from "./types";

export type ChatComposerSuggestionSource = "initial" | "assistant_follow_up";
export type ChatComposerSuggestionInvalidationReason =
  | "run_started"
  | "run_cancelled"
  | "run_failed"
  | "run_interrupted"
  | "new_chat_rollover";

export type ChatComposerSuggestion = Readonly<{
  id: string;
  text: string;
  source: ChatComposerSuggestionSource;
  assistantItemId: string | null;
}>;

export type ChatComposerSuggestionsDependencies = Readonly<{
  getOpenAIClient: typeof getOpenAIClient;
}>;

const DEFAULT_CHAT_COMPOSER_SUGGESTIONS_DEPENDENCIES: ChatComposerSuggestionsDependencies = {
  getOpenAIClient,
};

const MAX_CHAT_COMPOSER_SUGGESTIONS = 2;

const INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS_BY_LOCALE = {
  en: [
    "Help me create a card",
    "What should I study next?",
  ],
  ar: [
    "ساعدني في إنشاء بطاقة",
    "ماذا يجب أن أدرس بعد ذلك؟",
  ],
  bn: [
    "আমাকে একটি কার্ড তৈরি করতে সাহায্য করুন",
    "এরপর আমার কী পড়া উচিত?",
  ],
  bg: [
    "Помогни ми да създам карта",
    "Какво да уча следващо?",
  ],
  ca: [
    "Ajuda'm a crear una targeta",
    "Què hauria d'estudiar després?",
  ],
  cs: [
    "Pomoz mi vytvořit kartičku",
    "Co bych měl studovat dál?",
  ],
  da: [
    "Hjælp mig med at lave et kort",
    "Hvad skal jeg studere næste gang?",
  ],
  de: [
    "Hilf mir, eine Karte zu erstellen",
    "Was sollte ich als Nächstes lernen?",
  ],
  el: [
    "Βοήθησέ με να φτιάξω μια κάρτα",
    "Τι πρέπει να μελετήσω μετά;",
  ],
  es: [
    "Ayúdame a crear una tarjeta",
    "¿Qué debería estudiar ahora?",
  ],
  "es-ES": [
    "Ayúdame a crear una tarjeta",
    "¿Qué debería estudiar ahora?",
  ],
  "es-MX": [
    "Ayúdame a crear una tarjeta",
    "¿Qué debería estudiar ahora?",
  ],
  et: [
    "Aita mul kaart luua",
    "Mida ma peaksin järgmisena õppima?",
  ],
  fa: [
    "کمکم کن یک کارت بسازم",
    "بعدی چه چیزی را باید بخوانم؟",
  ],
  fi: [
    "Auta minua luomaan kortti",
    "Mitä minun pitäisi opiskella seuraavaksi?",
  ],
  fr: [
    "Aide-moi à créer une carte",
    "Que devrais-je étudier ensuite ?",
  ],
  gu: [
    "મને એક કાર્ડ બનાવવામાં મદદ કરો",
    "હવે મને આગળ શું અભ્યાસ કરવો જોઈએ?",
  ],
  he: [
    "עזור לי ליצור כרטיסייה",
    "מה כדאי לי ללמוד עכשיו?",
  ],
  hi: [
    "मुझे एक कार्ड बनाने में मदद करें",
    "मुझे आगे क्या पढ़ना चाहिए?",
  ],
  hr: [
    "Pomozi mi izraditi karticu",
    "Što bih trebao sljedeće učiti?",
  ],
  hu: [
    "Segíts kártyát létrehozni",
    "Mit tanuljak legközelebb?",
  ],
  id: [
    "Bantu saya membuat kartu",
    "Apa yang harus saya pelajari berikutnya?",
  ],
  is: [
    "Hjálpaðu mér að búa til spjald",
    "Hvað ætti ég að læra næst?",
  ],
  it: [
    "Aiutami a creare una scheda",
    "Cosa dovrei studiare dopo?",
  ],
  ja: [
    "カード作成を手伝って",
    "次は何を勉強すべき？",
  ],
  kn: [
    "ಒಂದು ಕಾರ್ಡ್ ರಚಿಸಲು ನನಗೆ ಸಹಾಯ ಮಾಡಿ",
    "ನಾನು ಮುಂದೇನು ಓದಬೇಕು?",
  ],
  ko: [
    "카드 만들기를 도와줘",
    "다음에는 무엇을 공부해야 할까?",
  ],
  lt: [
    "Padėk man sukurti kortelę",
    "Ką turėčiau mokytis toliau?",
  ],
  lv: [
    "Palīdzi man izveidot kartīti",
    "Ko man vajadzētu mācīties tālāk?",
  ],
  ml: [
    "ഒരു കാർഡ് തയ്യാറാക്കാൻ എന്നെ സഹായിക്കൂ",
    "ഇനി ഞാൻ എന്താണ് പഠിക്കേണ്ടത്?",
  ],
  mr: [
    "मला एक कार्ड तयार करण्यात मदत करा",
    "पुढे मला काय अभ्यासावे?",
  ],
  nl: [
    "Help me een kaart te maken",
    "Wat moet ik hierna bestuderen?",
  ],
  no: [
    "Hjelp meg å lage et kort",
    "Hva bør jeg studere videre?",
  ],
  pa: [
    "ਮੈਨੂੰ ਇੱਕ ਕਾਰਡ ਬਣਾਉਣ ਵਿੱਚ ਮਦਦ ਕਰੋ",
    "ਮੈਨੂੰ ਅੱਗੇ ਕੀ ਪੜ੍ਹਨਾ ਚਾਹੀਦਾ ਹੈ?",
  ],
  pl: [
    "Pomóż mi utworzyć fiszkę",
    "Czego powinienem się uczyć dalej?",
  ],
  pt: [
    "Ajude-me a criar um cartão",
    "O que devo estudar a seguir?",
  ],
  ro: [
    "Ajută-mă să creez un card",
    "Ce ar trebui să studiez în continuare?",
  ],
  ru: [
    "Помоги мне создать карточку",
    "Что мне изучать дальше?",
  ],
  sk: [
    "Pomôž mi vytvoriť kartičku",
    "Čo by som sa mal učiť ďalej?",
  ],
  sl: [
    "Pomagaj mi ustvariti kartico",
    "Kaj naj se učim naslednje?",
  ],
  sv: [
    "Hjälp mig att skapa ett kort",
    "Vad ska jag studera härnäst?",
  ],
  sw: [
    "Nisaidie kuunda kadi",
    "Nifunze nini baada ya hapo?",
  ],
  ta: [
    "ஒரு அட்டையை உருவாக்க எனக்கு உதவுங்கள்",
    "அடுத்து நான் என்ன படிக்க வேண்டும்?",
  ],
  te: [
    "ఒక కార్డ్ తయారు చేయడానికి నాకు సహాయం చేయండి",
    "నేను తరువాత ఏమి చదవాలి?",
  ],
  th: [
    "ช่วยฉันสร้างการ์ด",
    "ฉันควรเรียนอะไรต่อไป?",
  ],
  tr: [
    "Bir kart oluşturmama yardım et",
    "Sırada ne çalışmalıyım?",
  ],
  uk: [
    "Допоможи мені створити картку",
    "Що мені вивчати далі?",
  ],
  ur: [
    "ایک کارڈ بنانے میں میری مدد کریں",
    "مجھے اگلا کیا پڑھنا چاہیے؟",
  ],
  vi: [
    "Giúp tôi tạo một thẻ",
    "Tiếp theo tôi nên học gì?",
  ],
  "zh-CN": [
    "帮我创建一张卡片",
    "我下一步该学什么？",
  ],
  "zh-Hans": [
    "帮我创建一张卡片",
    "我下一步该学什么？",
  ],
  zu: [
    "Ngisize ngenze ikhadi",
    "Yini okufanele ngiyifunde ngokulandelayo?",
  ],
} as const;

export type ChatComposerSuggestionsLocale = keyof typeof INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS_BY_LOCALE;

const CHAT_COMPOSER_SUGGESTION_LANGUAGE_FALLBACKS: Readonly<Record<string, ChatComposerSuggestionsLocale>> = {
  ar: "ar",
  bg: "bg",
  bn: "bn",
  ca: "ca",
  cs: "cs",
  da: "da",
  de: "de",
  el: "el",
  en: "en",
  et: "et",
  fa: "fa",
  fi: "fi",
  fr: "fr",
  gu: "gu",
  he: "he",
  hi: "hi",
  hr: "hr",
  hu: "hu",
  id: "id",
  is: "is",
  it: "it",
  ja: "ja",
  kn: "kn",
  ko: "ko",
  lt: "lt",
  lv: "lv",
  ml: "ml",
  mr: "mr",
  nl: "nl",
  no: "no",
  pa: "pa",
  pl: "pl",
  pt: "pt",
  ro: "ro",
  ru: "ru",
  sk: "sk",
  sl: "sl",
  sv: "sv",
  sw: "sw",
  ta: "ta",
  te: "te",
  th: "th",
  tr: "tr",
  uk: "uk",
  ur: "ur",
  vi: "vi",
  zu: "zu",
} as const;

const followUpSuggestionsWireSchema = z.object({
  suggestions: z.array(z.string()),
});

const composerSuggestionWireSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(["initial", "assistant_follow_up"]),
  assistantItemId: z.string().min(1).nullable(),
});

const composerSuggestionsWireSchema = z.array(composerSuggestionWireSchema);

function hasOwnProperty<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): key is keyof typeof record {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeLocaleTag(value: string): string | null {
  const normalizedTag = value.replaceAll("_", "-").trim();
  if (normalizedTag === "") {
    return null;
  }

  try {
    const canonicalLocale = Intl.getCanonicalLocales(normalizedTag)[0];
    return canonicalLocale ?? null;
  } catch {
    return null;
  }
}

/**
 * `uiLocale` stays optional while older clients migrate to the explicit request
 * field. Missing locale therefore falls back to English on purpose, but an
 * invalid provided locale is rejected by the route parser instead of silently
 * changing languages. This path can be simplified after every supported client
 * sends `uiLocale` and the minimum supported client versions no longer depend
 * on the legacy English fallback.
 */
export function normalizeChatComposerSuggestionsUiLocale(
  uiLocale: string | null | undefined,
): ChatComposerSuggestionsLocale {
  if (uiLocale === null || uiLocale === undefined) {
    return "en";
  }

  const normalizedLocale = normalizeLocaleTag(uiLocale);
  if (normalizedLocale === null) {
    throw new Error(`Unsupported chat composer locale: ${uiLocale}`);
  }

  if (hasOwnProperty(INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS_BY_LOCALE, normalizedLocale)) {
    return normalizedLocale as ChatComposerSuggestionsLocale;
  }

  const locale = new Intl.Locale(normalizedLocale);

  if (locale.language === "es") {
    if (locale.region === "ES") {
      return "es-ES";
    }

    if (locale.region === "MX") {
      return "es-MX";
    }

    return "es";
  }

  if (locale.language === "zh") {
    if (locale.script === "Hans") {
      return "zh-Hans";
    }

    if (locale.region === "CN") {
      return "zh-CN";
    }

    if (locale.region === "SG") {
      return "zh-Hans";
    }
  }

  if (hasOwnProperty(CHAT_COMPOSER_SUGGESTION_LANGUAGE_FALLBACKS, locale.language)) {
    return CHAT_COMPOSER_SUGGESTION_LANGUAGE_FALLBACKS[locale.language];
  }

  throw new Error(`Unsupported chat composer locale: ${uiLocale}`);
}

function normalizeSuggestionText(text: string): string | null {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length === 0 || normalizedText.length > 80) {
    return null;
  }

  return normalizedText;
}

function buildSuggestionId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1)}`;
}

function deduplicateSuggestionTexts(
  texts: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const normalizedTexts: string[] = [];
  const seenTexts = new Set<string>();

  for (const text of texts) {
    const normalizedText = normalizeSuggestionText(text);
    if (normalizedText === null) {
      continue;
    }

    const dedupeKey = normalizedText.toLocaleLowerCase("en-US");
    if (seenTexts.has(dedupeKey)) {
      continue;
    }

    normalizedTexts.push(normalizedText);
    seenTexts.add(dedupeKey);
    if (normalizedTexts.length >= MAX_CHAT_COMPOSER_SUGGESTIONS) {
      break;
    }
  }

  return normalizedTexts;
}

function createComposerSuggestions(
  texts: ReadonlyArray<string>,
  source: ChatComposerSuggestionSource,
  assistantItemId: string | null,
  idPrefix: string,
): ReadonlyArray<ChatComposerSuggestion> {
  return deduplicateSuggestionTexts(texts).map((text, index) => ({
    id: buildSuggestionId(idPrefix, index),
    text,
    source,
    assistantItemId,
  }));
}

function extractPlainText(parts: ReadonlyArray<ContentPart>): string {
  return parts
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text];
      }

      if (part.type === "file") {
        return [part.fileName];
      }

      if (part.type === "tool_call") {
        return [
          part.output ?? "",
          part.input ?? "",
        ];
      }

      return [];
    })
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const directObject = parseJsonObject(text);
  if (directObject !== null) {
    return directObject;
  }

  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");
  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return parseJsonObject(text.slice(startIndex, endIndex + 1));
}

function buildFollowUpSuggestionPrompt(
  userMessage: string,
  assistantReply: string,
  uiLocale: ChatComposerSuggestionsLocale,
): string {
  return [
    "Generate exactly two short follow-up messages that the user may send next.",
    "Return strict JSON only in this shape: {\"suggestions\":[\"...\",\"...\"]}.",
    "Each suggestion must be plain text, concise, and suitable for a mobile composer.",
    "Each suggestion must be under 60 characters.",
    `Write both suggestions in this UI locale: ${uiLocale}.`,
    "Do not copy the assistant reply verbatim.",
    "Do not add markdown, numbering, or explanations.",
    "",
    "Latest user message:",
    userMessage,
    "",
    "Assistant reply:",
    assistantReply,
  ].join("\n");
}

export function buildInitialChatComposerSuggestions(
  uiLocale: string | null | undefined,
): ReadonlyArray<ChatComposerSuggestion> {
  const locale = normalizeChatComposerSuggestionsUiLocale(uiLocale);
  return createComposerSuggestions(
    INITIAL_CHAT_COMPOSER_SUGGESTION_TEXTS_BY_LOCALE[locale],
    "initial",
    null,
    "initial",
  );
}

export function localizeInitialChatComposerSuggestions(
  suggestions: ReadonlyArray<ChatComposerSuggestion>,
  uiLocale: string | null | undefined,
): ReadonlyArray<ChatComposerSuggestion> {
  if (
    suggestions.length === 0
    || !suggestions.every((suggestion) =>
      suggestion.source === "initial" && suggestion.assistantItemId === null)
  ) {
    return suggestions;
  }

  return buildInitialChatComposerSuggestions(uiLocale);
}

export function emptyChatComposerSuggestions(): ReadonlyArray<ChatComposerSuggestion> {
  return [];
}

/**
 * Normalizes persisted suggestion payloads so the runtime always sees the same
 * capped, de-duplicated structure regardless of how the JSON was stored.
 */
export function parsePersistedChatComposerSuggestions(
  value: unknown,
  context: string,
): ReadonlyArray<ChatComposerSuggestion> {
  const parsedSuggestions = composerSuggestionsWireSchema.safeParse(value);
  if (!parsedSuggestions.success) {
    throw new Error(`Invalid persisted composer suggestions for ${context}`);
  }

  return createComposerSuggestions(
    parsedSuggestions.data.map((suggestion) => suggestion.text),
    parsedSuggestions.data[0]?.source ?? "assistant_follow_up",
    parsedSuggestions.data[0]?.assistantItemId ?? null,
    parsedSuggestions.data[0]?.assistantItemId ?? parsedSuggestions.data[0]?.source ?? "persisted",
  ).map((suggestion, index) => {
    const persistedSuggestion = parsedSuggestions.data[index];
    if (persistedSuggestion === undefined) {
      return suggestion;
    }

    return {
      id: persistedSuggestion.id,
      text: suggestion.text,
      source: persistedSuggestion.source,
      assistantItemId: persistedSuggestion.assistantItemId,
    };
  });
}

/**
 * Generates follow-up suggestions from the latest completed assistant reply.
 */
export async function generateFollowUpChatComposerSuggestions(
  userId: string,
  userContent: ReadonlyArray<ContentPart>,
  assistantContent: ReadonlyArray<ContentPart>,
  assistantItemId: string,
  uiLocale: string | null | undefined,
): Promise<ReadonlyArray<ChatComposerSuggestion>> {
  return generateFollowUpChatComposerSuggestionsWithDependencies(
    userId,
    userContent,
    assistantContent,
    assistantItemId,
    uiLocale,
    DEFAULT_CHAT_COMPOSER_SUGGESTIONS_DEPENDENCIES,
  );
}

export async function generateFollowUpChatComposerSuggestionsWithDependencies(
  userId: string,
  userContent: ReadonlyArray<ContentPart>,
  assistantContent: ReadonlyArray<ContentPart>,
  assistantItemId: string,
  uiLocale: string | null | undefined,
  dependencies: ChatComposerSuggestionsDependencies,
): Promise<ReadonlyArray<ChatComposerSuggestion>> {
  const userMessage = extractPlainText(userContent);
  const assistantReply = extractPlainText(assistantContent);
  if (userMessage.length === 0 || assistantReply.length === 0) {
    return emptyChatComposerSuggestions();
  }

  const normalizedUiLocale = normalizeChatComposerSuggestionsUiLocale(uiLocale);

  const response = await dependencies.getOpenAIClient().responses.create({
    model: CHAT_MODEL_ID,
    store: false,
    safety_identifier: buildOpenAISafetyIdentifier(userId),
    input: [{
      type: "message",
      role: "system",
      content: [{
        type: "input_text",
        text: "You write short user follow-up suggestions for a mobile AI chat composer.",
      }],
    }, {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: buildFollowUpSuggestionPrompt(userMessage, assistantReply, normalizedUiLocale),
      }],
    }],
  });

  const responseText = response.output_text.trim();
  const parsedObject = extractJsonObject(responseText);
  if (parsedObject === null) {
    throw new Error("Composer suggestions response is not valid JSON");
  }

  const parsedSuggestions = followUpSuggestionsWireSchema.safeParse(parsedObject);
  if (!parsedSuggestions.success) {
    throw new Error("Composer suggestions response has an invalid shape");
  }

  return createComposerSuggestions(
    parsedSuggestions.data.suggestions,
    "assistant_follow_up",
    assistantItemId,
    assistantItemId,
  );
}
