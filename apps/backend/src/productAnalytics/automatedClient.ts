// What the verdict means, and why NULL is not FALSE, is in
// db/migrations/0145_anonymous_client_automated_marker.sql.

// The markers a bot, crawler, headless browser or HTTP library announces itself with: crawler and
// bot names, browser automation drivers, and the HTTP clients an unattended script reaches for. They
// are matched as substrings of the User-Agent, case-insensitively, so a vendor prefix or version
// suffix around one still matches - after the colliding vendor tokens below have been cut out of it.
// This is the whole of the classification: nothing here looks at an IP, a request rate or behaviour,
// and a client that sends an ordinary browser User-Agent is not caught at all.
//
// Every entry is plain text carrying no regular-expression metacharacter, which is what lets the
// list be joined into one alternation below without escaping; keep a new entry that way.
//
// A marker is matched with no token boundary, so a plain English word here marks every visitor whose
// User-Agent happens to contain it, permanently: the table is append-only and the User-Agent is not
// stored beside the row, so a wrong verdict can never be recomputed. Prefer a marker that names a
// vendor, a product or a library. A plain word that stays - "bot", "crawl", "spider" - needs every
// colliding token it is known to hit escaped below. "preview" was removed for that reason: it is an
// ordinary English word matched anywhere in a caller-controlled string. It was not replaced, and
// the effect is that link-preview fetchers announcing no other marker - "SkypeUriPreview
// Preview/0.5", whose only marker was that word, and "WhatsApp/2.x", which carries none - are
// stored FALSE when they reach this function. No narrow product-named marker was added for either.
// apps/backend/src/routes/anonymousAnalytics.ts refuses a request whose Origin, or Referer standing
// in for it, is not on the allowlist, and does so before any User-Agent is read, but that check is
// no guarantee against these two: it is a string comparison over two caller-controlled headers, and
// a renderer passes it honestly. A fetcher that only pulls the marketing page's HTML never calls
// this collector at all and so never reaches this function; a fetcher that renders the page runs
// the site's analytics JS, whose POST carries the allowlisted page origin and the renderer's own
// User-Agent, and is recorded FALSE unless that User-Agent carries a marker. If such a User-Agent
// does turn up in the API Gateway access log, the only place it is kept and only for that log
// group's one week, with no way to join it back to a stored row, add the product name itself -
// "skypeuripreview", "whatsapp/" - and never the bare word back.
const automatedUserAgentMarkers: ReadonlyArray<string> = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "headless",
  "playwright",
  "puppeteer",
  "selenium",
  "webdriver",
  "lighthouse",
  "phantomjs",
  "curl",
  "wget",
  "python-requests",
  "python-urllib",
  "aiohttp",
  "httpx",
  "node-fetch",
  "undici",
  "axios",
  "go-http-client",
  "okhttp",
  "java/",
  "libwww",
  "scrapy",
  "facebookexternalhit",
  "embedly",
];

// Tokens that carry a marker inside them but belong to ordinary human traffic. Each is cut out of
// the lowercased User-Agent before the markers are matched, so the marker buried in it cannot fire.
// Public crawler lists carry exclusion lists for exactly this reason. Every entry names why it is
// here, so a later edit does not read it as dead weight and remove it:
// - "cubot": a currently sold Android handset brand. Chrome puts the device model into every mobile
//   User-Agent it sends ("Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 30) ... Mobile Safari/537.36"),
//   so "bot" would match every page view from one of those phones. A trailing word boundary on the
//   marker would not help: "CUBOT NOTE 30" satisfies one just as "Googlebot/2.1" does.
// Entries are plain text and are joined into one alternation, like the markers above. There is one
// entry today, so ordering is moot; a second one makes it matter. Alternation is leftmost-first and
// the g flag resumes the next search after the previous match, so two entries that can overlap in
// one User-Agent would not both be cut and could leave a bare marker standing. Keep entries
// non-overlapping, and where one is a prefix of another put the longer one first.
const collidingVendorTokens: ReadonlyArray<string> = ["cubot"];

const automatedUserAgentPattern = new RegExp(automatedUserAgentMarkers.join("|"), "iu");
// Both patterns are module-level and shared by every request. collidingVendorTokenPattern carries g
// so that .replace() cuts every occurrence, which also makes it stateful: use it with .replace()
// only. .test() and .exec() on a g pattern advance its lastIndex and resume there next time, so a
// verdict would depend on where the previous request's User-Agent happened to match.
const collidingVendorTokenPattern = new RegExp(collidingVendorTokens.join("|"), "giu");

// A missing or empty User-Agent counts as automated: every browser sends one, so its absence is
// itself the signal that the caller is a script.
export function isAutomatedUserAgent(userAgent: string | null): boolean {
  if (userAgent === null || userAgent.trim() === "") {
    return true;
  }

  // Replaced with a space rather than removed, so cutting a token out cannot join its neighbours
  // into a marker that neither of them contained.
  const scannableUserAgent = userAgent.toLowerCase().replace(collidingVendorTokenPattern, " ");

  return automatedUserAgentPattern.test(scannableUserAgent);
}
