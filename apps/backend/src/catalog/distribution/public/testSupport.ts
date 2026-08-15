import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "../../../shared/errors";
import type { AppEnv } from "../../../server/app";
import {
  testAuthorId,
  testPackageId,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceMediaAssetId,
} from "../../testSupport";

const legacyPrivateWorkspacePackageMediaKey = `w-${testWorkspaceMediaAssetId}`;
const unsafeShaPackageMediaKey = "a".repeat(64);
const unsafeStorageKeyLikePackageMediaKey = `media.blobs.sha256.aa.aa.${unsafeShaPackageMediaKey}`;

export const unsafeStorageKeyPathDestination = `media/blobs/sha256/aa/aa/${unsafeShaPackageMediaKey}`;

const unsafeDoubleEncodedStorageKeyPathDestination = encodeURIComponent(encodeURIComponent(
  unsafeStorageKeyPathDestination,
));

export function createPublicCatalogRouteTestApp(route: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }

    context.status(500);
    return context.json({ error: "internal" });
  });
  app.route("/", route);
  return app;
}

export const unsafePublicPackageMediaKeyFixtures = [
  ["legacy workspace-derived", legacyPrivateWorkspacePackageMediaKey],
  ["uuid-shaped", testWorkspaceMediaAssetId],
  ["sha-shaped", unsafeShaPackageMediaKey],
  ["storage-key-shaped", unsafeStorageKeyLikePackageMediaKey],
] as const;

export const unsafeMarkdownDestinationFixtures = [
  ["malformed fcasset storage path", `fcasset:${unsafeStorageKeyPathDestination}`],
  ["storage path", unsafeStorageKeyPathDestination],
  ["rooted storage path", `/${unsafeStorageKeyPathDestination}`],
  ["absolute storage URL", `https://bucket.s3.amazonaws.com/${unsafeStorageKeyPathDestination}`],
  ["storage path with query", `${unsafeStorageKeyPathDestination}?download=1`],
  ["storage path with fragment", `${unsafeStorageKeyPathDestination}#preview`],
  ["percent-encoded storage path", `media%2Fblobs%2Fsha256%2Faa%2Faa%2F${unsafeShaPackageMediaKey}`],
  ["double-encoded storage path", unsafeDoubleEncodedStorageKeyPathDestination],
  ["double-encoded absolute storage URL", `https://bucket.s3.amazonaws.com/${unsafeDoubleEncodedStorageKeyPathDestination}`],
  ["sha handle path", `sha256-${unsafeShaPackageMediaKey}`],
] as const;

export const unsafeMarkdownVisibleTextFixtures = [
  ["raw storage path", `Prompt ${unsafeStorageKeyPathDestination}`],
  ["raw sha handle", `Prompt sha256-${unsafeShaPackageMediaKey}`],
  ["raw unsafe fcasset reference", `Prompt fcasset:${legacyPrivateWorkspacePackageMediaKey}`],
  ["storage autolink", `Prompt <https://bucket.s3.amazonaws.com/${unsafeStorageKeyPathDestination}>`],
  ["malformed storage link tail", `Prompt ![unsafe](${unsafeStorageKeyPathDestination}`],
  ["malformed fcasset link tail", `Prompt [unsafe](fcasset:${legacyPrivateWorkspacePackageMediaKey}`],
  ["raw percent-encoded storage path", `Prompt media%2Fblobs%2Fsha256%2Faa%2Faa%2F${unsafeShaPackageMediaKey}`],
] as const;

export const unsafePublicMetadataFixtures = [
  ["summary storage path", { summary: `Summary ${unsafeStorageKeyPathDestination}` }],
  ["description raw hash", { description: `Description ${unsafeShaPackageMediaKey}` }],
  ["language tag private fcasset", { language_tags: ["en", `fcasset:${legacyPrivateWorkspacePackageMediaKey}`] }],
  ["content warning storage path", { content_warning: `Warning ${unsafeStorageKeyPathDestination}` }],
  ["license raw hash", { license: `License ${unsafeShaPackageMediaKey}` }],
  ["author bio private fcasset", { author_bio: `Bio fcasset:${legacyPrivateWorkspacePackageMediaKey}` }],
  ["author website storage path", { author_website_url: `https://example.com/${unsafeStorageKeyPathDestination}` }],
] as const;

export const unsafePublicMediaMetadataFixtures = [
  ["media alt text storage path", { alt_text: `Alt ${unsafeStorageKeyPathDestination}` }],
  ["media credit raw hash", { credit: `Credit ${unsafeShaPackageMediaKey}` }],
  ["media license private fcasset", { license: `fcasset:${legacyPrivateWorkspacePackageMediaKey}` }],
] as const;

export function createPublicPackageRow(): Readonly<Record<string, unknown>> {
  return {
    package_id: testPackageId,
    author_id: testAuthorId,
    author_slug: "open-authors",
    author_display_name: "Open Authors",
    author_bio: null,
    author_website_url: "https://[2001:db8::1]/authors",
    package_version_id: testPackageVersionId,
    version_number: 1,
    status: "published",
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: "cover",
    card_count: 1,
    updated_at: testTimestamp,
    published_at: testTimestamp,
  };
}

export function createPublicMediaAssetRow(): Readonly<Record<string, unknown>> {
  return {
    package_version_id: testPackageVersionId,
    package_media_key: "cover",
    alt_text: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mime_type: "image/jpeg",
    size_bytes: 1234,
    sha256: unsafeShaPackageMediaKey,
  };
}
