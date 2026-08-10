import type { TranslationKey } from "../../../i18n/catalog";
import {
  readStoredLocalePreference,
  resolveLocaleState,
  translateMessage,
} from "../../../i18n/runtime";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { nowIso } from "../../domain";
import {
  createCardLocally,
  type LocalCardMutationResult,
} from "./syncLocalMutations";

const demoCardTag = "demo";

// The product name is a brand and is never translated. The markdown emphasis lives here
// so the catalogs stay free of markup.
const demoCardAppName = "**Flashcards Open Source App**";

function asInlineCode(label: string): string {
  return `\`${label}\``;
}

const demoCardBackKeys: ReadonlyArray<TranslationKey> = [
  "demoCard.back1",
  "demoCard.back2",
  "demoCard.back3",
];

type DemoCardText = Readonly<{
  frontText: string;
  backText: string;
}>;

export type SeedDemoCardInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  isOnlyWorkspaceForUser: boolean;
  remoteIsEmpty: boolean | null;
  localCardCount: number;
}>;

function buildDemoCardText(): DemoCardText {
  const locale = resolveLocaleState(readStoredLocalePreference()).locale;
  // The rating label comes from the catalog the review screen already uses, so the card
  // always names the button exactly as it is rendered. Like the bold product name, the
  // inline-code backticks are added here so the catalogs stay free of markup.
  //
  // The backticks are load-bearing. classifyReviewContentPresentation in
  // ../../../screens/review/components/card/reviewContentPresentation.ts (mirrored on iOS and
  // Android) switches a card side to markdown only on a backtick or a block-level cue, and
  // docs/review-markdown-rendering.md states that inline emphasis alone never switches the
  // mode. This text carries no block-level cue, so without the backticks the card would
  // classify as paragraphPlain and every new user would see a literal ** around the product
  // name. Whoever removes the backticks must also remove the bold.
  const values = {
    appName: demoCardAppName,
    againLabel: asInlineCode(translateMessage(locale, "reviewScreen.ratings.again", undefined)),
  };

  return {
    frontText: translateMessage(locale, "demoCard.front", values),
    // Blank lines separate the three paragraphs. The bold product name and the inline-code
    // rating label are the only markdown the answer contains.
    backText: demoCardBackKeys.map((key) => translateMessage(locale, key, values)).join("\n\n"),
  };
}

// Seeds the onboarding demo card for a brand-new user. The card is an ordinary card:
// it goes through createCardLocally, so it lands in IndexedDB and in the outbox and is
// pushed by the normal sync path. Nothing else in the app special-cases it.
//
// This is a new-user card, not a new-workspace card. An empty workspace is not by itself
// a new account: an existing user who deliberately creates a second workspace is handed an
// empty one too, and would otherwise be onboarded again. isOnlyWorkspaceForUser carries
// that user-scoped signal, decided by the caller from the account's workspace list.
//
// The backend never seeds this card, because a server-side seed would make a new
// workspace non-empty and push mobile cloud linking into the replace_local_shell branch,
// discarding a new user's offline work. Deduplication is therefore purely local: each
// client seeds only at its own new-user moment, and only into a workspace that holds no
// cards at all.
//
// Every condition is decided by the caller and passed in, so this stays a pure guard over
// its input and never re-reads workspace state.
//
// Failing to seed must never fail a sync run, so a seed failure is reported and swallowed.
export async function seedDemoCardForNewWorkspace(
  input: SeedDemoCardInput,
): Promise<LocalCardMutationResult | null> {
  if (
    input.isOnlyWorkspaceForUser !== true
    || input.remoteIsEmpty !== true
    || input.localCardCount !== 0
  ) {
    return null;
  }

  try {
    const demoCardText = buildDemoCardText();
    return await createCardLocally({
      workspaceId: input.workspaceId,
      input: {
        frontText: demoCardText.frontText,
        backText: demoCardText.backText,
        tags: [demoCardTag],
      },
      clientUpdatedAt: nowIso(),
    });
  } catch (error) {
    captureAppOperationError(error, {
      feature: "sync",
      operation: "demo_card_seed",
      userId: input.userId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      entityId: null,
    });
    return null;
  }
}
