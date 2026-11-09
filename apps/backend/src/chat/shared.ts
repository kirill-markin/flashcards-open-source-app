/**
 * Shared system-prompt builders for the backend-owned chat stack.
 * The prompt is the assistant core every AI surface states (`assistantContract.ts`) and the shared
 * card rules, plus only what differs in this in-app chat.
 */

import {
  ASSISTANT_BEHAVIOUR_RULE_LINES,
  ASSISTANT_PRODUCT_DESCRIPTION,
} from "../aiTools/toolContract/assistantContract";
import {
  CARD_AUTHORING_CONTRACT,
  CARD_AUTHORING_TOOL_CALL_EXAMPLE,
  CARD_BACK_SIDE_RULE_LINES,
  CARD_DUPLICATE_CHECK_RULE_LINES,
  CARD_MANAGED_IMAGE_RULE_LINES,
  CARD_STYLE_ALIGNMENT_RULE_LINES,
  CARD_TAGGING_RULE_LINES,
  CARD_WEB_URL_LINES,
  FRONT_BACK_CONTRACT,
  SQL_MUTATION_TAG_FILTER_DESCRIPTION,
} from "../aiTools/toolContract/sqlToolContract";
import { MAX_SQL_RECORD_LIMIT } from "../aiTools/toolContract/sqlToolLimits";
import {
  maximumBashCommandSeconds,
  maximumMediaPutsPerCommand,
  maximumSqlCallsPerCommand,
} from "../chatSandbox/contract";
import { maximumImageIngestionOriginalBytes } from "../mediaAssets/validators";
import type {
  ProductAnalyticsClientReportablePlatform,
  ProductAnalyticsDeviceType,
  ProductAnalyticsOsName,
} from "../productAnalytics/catalog";

/** The Nibomo app a chat run comes from, named the way the user knows it. */
export type ChatClientApp = "iPhone" | "iPad" | "Mac" | "Android" | "web";

/**
 * The Apple build reports platform `ios` on iPhone, iPad and Mac alike, so its osName, or without
 * one its deviceType, tells them apart. Null when the run's headers do not say.
 */
export function resolveChatClientApp(
  platform: ProductAnalyticsClientReportablePlatform | null,
  osName: ProductAnalyticsOsName | null,
  deviceType: ProductAnalyticsDeviceType | null,
): ChatClientApp | null {
  if (platform === "web") {
    return "web";
  }
  if (platform === "android") {
    return "Android";
  }
  if (platform !== "ios") {
    return null;
  }
  if (osName === "macos" || (osName === null && deviceType === "desktop")) {
    return "Mac";
  }
  if (osName === "ipados" || (osName === null && deviceType === "tablet")) {
    return "iPad";
  }
  if (osName === "ios" || (osName === null && deviceType === "phone")) {
    return "iPhone";
  }
  return null;
}

function joinLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}

function buildPromptFromSections(sections: ReadonlyArray<string>): string {
  return sections.filter((section) => section !== "").join("\n\n");
}

function toBulletLines(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return lines.map((line) => `- ${line}`);
}

/**
 * A native app's user leaves it by opening a web link, so there the chat points to the app's own
 * screens, overriding the after-save link the shared tool text asks for; the link is still given when
 * the user asks for one or, as `CARD_WEB_URL_LINES` says, where a card is.
 */
function buildClientAppLine(clientApp: ChatClientApp | null): string {
  if (clientApp === null) {
    return "You are the AI chat inside the Nibomo app; \"here\" means this chat.";
  }
  if (clientApp === "web") {
    return "You are the AI chat inside the Nibomo web app; \"here\" means this chat.";
  }
  return `You are the AI chat inside the Nibomo ${clientApp} app; "here" means this chat. Point to the app's Cards and Review screens instead of web links, even where tool text suggests a link, unless the user asks for a link or where a card is.`;
}

function buildAssistantSection(clientApp: ChatClientApp | null): string {
  return joinLines([
    buildClientAppLine(clientApp),
    ASSISTANT_PRODUCT_DESCRIPTION,
    ...toBulletLines(ASSISTANT_BEHAVIOUR_RULE_LINES),
  ]);
}

function buildWorkspaceSection(): string {
  return "Omitting workspaceId uses the workspace the user has open; list_workspaces lists the others. Decks have no description column.";
}

/**
 * The card rules the `card_authoring` guide serves, stated inline so the chat never spends a model
 * call fetching them; `buildSqlRoutingSection` says so. `CARD_WEB_URL_LINES` is empty unless the
 * deployment configured a usable app origin.
 */
function buildCardRulesSection(): string {
  return joinLines([
    FRONT_BACK_CONTRACT,
    ...CARD_BACK_SIDE_RULE_LINES,
    ...CARD_TAGGING_RULE_LINES,
    ...CARD_STYLE_ALIGNMENT_RULE_LINES,
    CARD_AUTHORING_CONTRACT,
    `Example: ${CARD_AUTHORING_TOOL_CALL_EXAMPLE}`,
    ...CARD_WEB_URL_LINES,
  ]);
}

/**
 * Stated unconditionally, unlike `buildGeneratedImagePolicySection` below: a card can already
 * carry a generated image from an earlier turn or another surface, so a chat that cannot itself
 * generate one can still delete one by rewriting the card around it.
 */
function buildCardManagedImageSection(): string {
  return joinLines([
    "Generated images in card text:",
    ...CARD_MANAGED_IMAGE_RULE_LINES,
  ]);
}

function buildChatReplySection(): string {
  return joinLines([
    "Chat replies:",
    "- Plain, concise text for a small screen: no Markdown headings, tables, blockquotes or code fences. Card fields keep their Markdown.",
    "- Write math in replies by the card LaTeX rules above, but leave a currency `$` unescaped; a display formula may also be a single `$$...$$` line in its own block. Keep each formula in a paragraph with no bold, italic, code or link, and out of lists; never `\\(...\\)` or `\\[...\\]`.",
    "- Before long work, send at most one short status line per turn; never name tools, SQL, pages or internal steps.",
  ]);
}

function buildWritePolicySection(): string {
  return joinLines([
    "Write policy:",
    ...CARD_DUPLICATE_CHECK_RULE_LINES,
    "- For a card creation job, meaning more than a few new cards, state the plan in one line with the count, tags, starting batch size and any duplicates skipped, such as \"I'll make about 2,000 cards tagged German-A1, saving about 25 at a time, skipping 40 that already exist.\", then start at once without listing the cards; ask first only when what to make is unclear, including how it overlaps existing cards, or the user asked to see the cards before saving.",
    "- Save such a job batch by batch as each batch is ready, never after writing every card's text first (parsing an attached file into /work up front is fine), and reply with a short summary; print every card's full text in chat only when asked.",
    "- To continue a stopped job, first read back what was saved, then do only the rest.",
    "- Never write hidden FSRS fields, sync metadata, or non-product tables.",
  ]);
}

/**
 * Dialect routing as in the always-loaded `SQL_QUERY_TOOL_DESCRIPTION` and
 * `SQL_EXECUTE_TOOL_DESCRIPTION`: they carry the caps, and `get_guide` topic `sql_dialect` serves the
 * grammar, the text-column rules, RETURNING, the batch arithmetic, and the examples.
 *
 * What stays inline is what a first call gets wrong with nothing to read afterwards: the tag forms
 * that miss return zero rows rather than an error, so a model that reaches for one reports "no cards
 * found" and never learns that it needed the guide.
 *
 * `get_guide` serves every surface, so the guides bullet is the single place that says which of its
 * topics this chat needs: `card_authoring` only repeats `buildCardRulesSection`.
 */
function buildSqlRoutingSection(): string {
  return joinLines([
    "SQL (not full PostgreSQL):",
    "- Read get_guide(sql_dialect) before a statement whose form you are unsure of and after a dialect error, and get_guide(bulk_authoring) before a large write job.",
    "- Your get_guide topics are study, sql_dialect, bulk_authoring and review_flow; card_authoring only repeats the card rules above.",
    "- Match tags with tags OVERLAP ('english', 'slang'), compared exactly and case-sensitively, so pass tags as stored.",
    `- ${SQL_MUTATION_TAG_FILTER_DESCRIPTION}`,
    "- tags = ('english', 'slang') is exact set equality, so a card with any extra tag does not match; tags IN (...), LOWER(tags) IN (...) and LOWER(tags) NOT IN (...) match no rows; LIKE-style forms are rejected on tags.",
  ]);
}

/**
 * The timezone is printed verbatim by `buildCurrentDatetimeLine`, and the reviewId is the
 * dedup key, so a model reusing one is refused rather than recording a second review.
 */
function buildReviewSection(): string {
  return "Reviews: pass the User local timezone from the Current datetime message as submit_review's reviewedTimeZone, spelled exactly; generate a fresh random UUID reviewId per learner review and reuse it only to retry that card's submission.";
}

/**
 * How to work in the bash tool's sandbox without flooding the turn: every tool result is re-sent on
 * each later model call. The 8 MB limit is just-bash's fixed Python file bridge, which mounts the shell's
 * files at /host and leaves them off sys.path.
 */
function buildChatFilesSection(): string {
  return joinLines([
    "Chat files:",
    "- Plain files derived from an attachment sit beside it in /files: a PDF's or DOCX's text in <file>.txt (PDF pages marked --- page N ---), an XLSX's sheets as <file>.d/<sheet>.csv, a ZIP's files under <file>.d/, and an Anki .apkg's collection as <file>.d/collection.sqlite. The attachment line names them or says why there are none.",
    "- Check a file's size first (wc -c, head), then read slices (sed -n '1,120p', rg -n PATTERN); never print a whole large file.",
    "- Save intermediate results to /work instead of printing them again.",
    "- python3 opens files of at most 8 MB: pipe a larger file in on stdin, or cut it into /work with split or head first.",
    "- Always write /work paths; python3 errors show /work/x as /host/work/x. python3 cannot import a module saved in /work: keep a program in one file or load shared code with exec(open('/work/lib.py').read()).",
    "- magick edits images with an ImageMagick subset, such as magick a.jpg b.jpg -resize x400 +append out.jpg: -resize WxH|W|xH|N%, -crop WxH+X+Y, -rotate DEG, -flip, -flop, +append, -append, -background COLOR, -gravity center, -extent WxH, -quality N; the output's .jpg, .png or .webp picks its format; magick identify FILE prints format and size.",
    "- zstd -d -o OUT FILE or zstd -dc FILE decompresses one zstd file. There is no unzip: open a ZIP with python3's zipfile, and one over 8 MB on stdin as zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).",
    `- A command runs for at most ${maximumBashCommandSeconds} seconds.`,
  ]);
}

/**
 * Anki's own package layout: the derived files carry the newest format's collection, but no media.
 * A Nibomo deck is a flat saved filter matching cards with any of its tags, so a parent deck lists its
 * subdecks' tags to keep the cards Anki shows under it. File names and deck ids copied by hand from
 * printed output go wrong on a large deck, so the mapping is done in code.
 */
function buildAnkiImportSection(): string {
  return joinLines([
    "Anki .apkg imports:",
    "- Keep the notes' own Anki tags, and recreate each Anki deck that holds cards directly or in its subdecks: add to its own cards one tag, its full name as a lowercase hyphenated slug with :: between levels (Spanish Basics::Home becomes spanish-basics::home), and create a deck named with its full Anki name whose tags are its own tag and every subdeck's, such as INSERT INTO decks (name, tags) VALUES ('Spanish Basics', ('spanish-basics', 'spanish-basics::home')).",
    "- Name the decks you created in your reply.",
    "- The collection is <file>.d/collection.sqlite; its decks table, where there is one, separates a deck name's levels with the 0x1F character, which Anki shows as ::. The media files are the package's numbered entries (0, 1, ...), named in entry order by its media list: <file>.d/media.json for older packages.",
    "- In the newest format the package's media entry (protobuf: each entry's field 1 is the file name) and every media file are zstd-compressed: zstd -d them.",
    "- Map in code, never by retyping printed names or ids: export notes, cards, decks and note types with sqlite3 -json into /work, parse the media list in python3 (json, or the protobuf's varint-keyed fields), and build each card's images and deck tag from those lookups, reading an export over 8 MB on stdin.",
    "- Build each card's front and back by rendering its note type's template for the card's ord with the note's fields by name, never by field position: the fields, templates (config protobuf: field 1 the front format, field 2 the back) and notetypes tables, or the models JSON in col in older collections; the back drops {{FrontSide}} and everything up to and including <hr id=answer>, keeping only what the answer adds; a reversed card is its reverse template.",
    "- A cloze note type has one template and makes one card per cloze number, the card's ord + 1; as in Anki, {{cloze:Field}} on its front shows each deletion of that number as [...], or as its hint ([city] for {{c1::Lima::city}}), and the other deletions as their text, and on its back the full text.",
    "- Compute each image's alt in code from its own note: the <img>'s alt, else the last level of the card's deck name (Home for Spanish Basics::Home). Never use text already on that side, which the app shows and reads beside the image, a file name or just Image, and never a keyword list or default written for one deck; on a front it never reveals the answer, so skip an <img> alt holding text of a field that appears only on the back.",
    "- Unpack, convert and upload media in one command, keeping the media bytes in /tmp; keep only those lookups and a small progress file in /work.",
    `- Upload each image with fc-media-put, at most ${maximumMediaPutsPerCommand} per command: loop across commands and keep progress in /work. Upload a JPEG, PNG or WebP of at most ${maximumImageIngestionOriginalBytes / 1_000_000} MB with its original bytes; convert with magick only other formats or larger files.`,
  ]);
}

/**
 * Code reaches agent SQL through the bridge in `apps/backend/src/chatSandbox/sqlBridge/`, and managed
 * images through `apps/backend/src/chatSandbox/mediaBridge/`, so a bulk job runs as one script and only
 * its summary returns to the turn. just-bash gives python3 neither a tool nor a command bridge, so it
 * cannot reach the functions.
 */
function buildSandboxSqlSection(): string {
  return joinLines([
    "SQL from code in the bash tool:",
    "- js-exec runs JavaScript with the SQL tools as functions: tools.sql.query({ sql, workspaceId }) and tools.sql.execute({ sql, workspaceId }) return the tool's JSON result and throw an Error on failure, whose message is the tool's error JSON when the statement failed; omit workspaceId for the open workspace.",
    "- In shell, fc-sql-query 'SQL' and fc-sql-execute 'SQL', or the statement on stdin, print the same JSON, or the failure on stderr with exit code 1.",
    "- python3 cannot call them: subprocess, os.system and any other shelling out from python3 do not work in this sandbox.",
    "- To import data parsed in python3, have it write the SQL or JSON to a /work file, then send it from the shell (fc-sql-execute < /work/batch.sql) or from js-exec.",
    `- Prefer a script for bulk imports, bulk edits, and analysis over many rows: loop in code, put up to ${MAX_SQL_RECORD_LIMIT} rows in each INSERT, UPDATE, or DELETE, and print only a short summary such as counts and the rows that failed.`,
    `- One bash command makes at most ${maximumSqlCallsPerCommand} SQL calls: split a larger job across commands and keep its progress in /work so it can resume.`,
    "- Writes from code follow the rules above, like sql_execute calls.",
    "- Imported cards start as new cards: review history and scheduling cannot be imported.",
    "- In shell, fc-media-get ID /work/PATH copies the open workspace's image with that fcasset: id into /work, and fc-media-put /work/PATH uploads a JPEG, PNG or WebP file as a new image of the open workspace and prints only its id and a newline, not JSON, which an SQL write that omits workspaceId then puts on a card as ![alt](fcasset:<id>).",
    "- A write whose error says it may have been applied must be read back with a SELECT before it is sent again.",
  ]);
}

function buildGeneratedImagePolicySection(): string {
  return joinLines([
    "Generated-image policy:",
    "- Use only for an explicit image request or delegated visual augmentation; inspect the target card with sql_query first, then announce the selected card and side.",
    "- add_generated_image_to_card works only on cards in the workspace the user has open, so never give it a card that was read with a different workspaceId.",
    "- Prefer the back unless specified otherwise; create teaching-relevant imagery with focused, private-data-free, moderation-compliant prompts, and never put an answer or answer-revealing image on the front.",
    "- Treat queued as accepted for durable attachment processing, not as proof that presentation is already visible; for already_queued, failure, ambiguity, or cancellation, never claim a new image or expose fcasset markdown, base64, or storage internals.",
    "- Never type an fcasset: destination other than one you just read on that card or an id fc-media-put just printed, and never repeat one to the user.",
  ]);
}

/**
 * Worded for both failure envelopes: the shared tools fail with `ok: false` and an `error` carrying
 * `code` and `message`, the generated-image tool with `ok: false` and a top-level `code`.
 */
function buildRepairSection(): string {
  return joinLines([
    "If a tool call was rejected for invalid arguments, send exactly one JSON object matching the tool's schema and continue without repeating earlier text.",
    "When a tool returns ok=false, read its error code and message, correct the next call, and never guess or invent a failure cause for the user.",
  ]);
}

/**
 * Kept out of `buildSystemInstructions`; `buildChatCompletionInputWithBudget` places it after the
 * replayed history and says why.
 */
export function buildCurrentDatetimeLine(timezone: string): string {
  const now = new Date();
  const utc = now.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const local = now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  return `Current datetime - UTC: ${utc} | User local (${timezone}): ${local}`;
}

/**
 * Builds the canonical system instructions for backend-owned chat turns. Both inputs are fixed for a
 * run and normally for a session, so the prompt stays a stable prompt-cache prefix.
 */
export function buildSystemInstructions(
  generatedImageEligible: boolean,
  clientApp: ChatClientApp | null,
): string {
  return buildPromptFromSections([
    buildAssistantSection(clientApp),
    buildWorkspaceSection(),
    buildCardRulesSection(),
    buildCardManagedImageSection(),
    buildChatReplySection(),
    buildWritePolicySection(),
    buildSqlRoutingSection(),
    buildReviewSection(),
    buildChatFilesSection(),
    buildAnkiImportSection(),
    buildSandboxSqlSection(),
    generatedImageEligible ? buildGeneratedImagePolicySection() : "",
    buildRepairSection(),
  ]);
}
