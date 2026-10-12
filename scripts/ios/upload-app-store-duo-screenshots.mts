import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient, object, request, resource, string, text } from "./app-store-connect-client.mts";
import type { Client, Json, JsonObject, Resource } from "./app-store-connect-client.mts";

const USAGE = [
  "Upload five or ten Duo store cards per selected locale to an existing editable iOS version.",
  "node scripts/ios/upload-app-store-duo-screenshots.mts --version <editable-version> --screenshots apps/ios/docs/media/app-store-cards/ready --locale en-US --family iphone-duo-inner",
  "Required --family: iphone-duo-inner, iphone-duo-outer, or all (outer 1–5, then inner 1–5).",
  "Use --all-locales instead of --locale for all 42 existing Store locales.",
  "Requires Node 24 and the main checkout's App Store Connect .env credentials.",
  "This is a live write command. It does not capture, render, create or submit a version.",
].join("\n");

const FAMILIES = ["iphone-duo-outer", "iphone-duo-inner"] as const;
type Family = (typeof FAMILIES)[number];
type ImageFile = { path: string; fileName: string; size: number; width: number; height: number; referenceName: string; specId: string; slot: string };
type Locale = { storeLocale: string; captureTag: string };
type Placement = { id: string; imageId: string; image: Resource };
type Plan = { locale: Locale; localizationId: string; files: ImageFile[] };

function entries(value: Json | undefined, context: string): Json[] {
  if (!Array.isArray(value)) throw new Error("Expected array: " + context);
  return value;
}

function integer(value: Json | undefined, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Expected integer: " + context);
  return value;
}

function relation(name: string, type: string, id: string): JsonObject {
  return { [name]: { data: { type, id } } };
}

function png(path: string): { bytes: Buffer; width: number; height: number } {
  const bytes = readFileSync(path);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(8) !== 13) throw new Error(path + ": invalid PNG header");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (bytes[24] !== 8 || bytes[25] !== 2 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) {
    throw new Error(path + ": expected opaque, noninterlaced 8-bit RGB PNG");
  }
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error(path + ": truncated PNG chunk " + type);
    if (type === "tRNS") throw new Error(path + ": PNG transparency is not allowed");
    offset += length + 12;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended || offset !== bytes.length) throw new Error(path + ": invalid PNG chunk boundary");
  return { bytes, width, height };
}

function catalog(value: JsonObject): { group: string; limit: number; specs: Map<string, JsonObject> } {
  const ref = resource(entries(value.data, "reference data")[0], "appAssetLibraryRefData");
  const attributes = ref.attributes;
  const groups = entries(attributes.placementProfileGroups, "placementProfileGroups").map((item) => object(item, "placement group"));
  const matches = groups.filter((item) => item.platform === "IPHONE_APP_STORE" && item.displayClassId === "IPHONE_DUO");
  if (matches.length !== 1) throw new Error("Expected one iPhone App Store Duo placement group; found " + matches.length);
  const group = string(matches[0].placementProfileGroupId, "Duo placement group");
  const features = entries(attributes.features, "features").map((item) => object(item, "feature"));
  const feature = features.find((item) => item.featureId === "APP_STORE_VERSIONS");
  if (feature === undefined) throw new Error("Catalog has no APP_STORE_VERSIONS feature");
  const policies = entries(feature.placementPolicies, "placement policies").map((item) => object(item, "placement policy"));
  const policy = policies.find((item) => item.placementType === "APP_SCREENSHOT");
  if (policy === undefined) throw new Error("Catalog has no App Store screenshot policy");
  const limits = entries(policy.groupLimits, "group limits").map((item) => object(item, "group limit"))
    .filter((item) => entries(item.groupIds, "group IDs").includes(group));
  if (limits.length !== 1) throw new Error("Expected one screenshot limit for " + group + "; found " + limits.length);
  const limit = integer(limits[0].maxCount, group + " maxCount");
  const types = entries(attributes.placementTypes, "placementTypes").map((item) => object(item, "placement type"));
  const screenshotType = types.find((item) => item.placementTypeId === "APP_SCREENSHOT");
  if (screenshotType === undefined || !entries(screenshotType.acceptsAssetCategories, "asset categories").includes("APP_SCREENSHOTS_AND_PREVIEWS")) {
    throw new Error("Catalog does not allow screenshot assets for APP_SCREENSHOT");
  }
  const mappings = entries(screenshotType.specMappings, "spec mappings").map((item) => object(item, "spec mapping"));
  const mapping = mappings.find((item) => item.placementGroupId === group);
  if (mapping === undefined) throw new Error("Catalog has no image specifications for " + group);
  const ids = new Set(entries(mapping.specs, "Duo specs").map((id) => string(id, "spec ID")));
  const specs = new Map(entries(attributes.imageSpecs, "imageSpecs").map((item) => {
    const spec = object(item, "image spec");
    return [string(spec.specId, "spec ID"), spec] as const;
  }).filter(([id]) => ids.has(id)));
  if (specs.size !== ids.size) throw new Error("Catalog has missing image specifications for " + group);
  return { group, limit, specs };
}

function matchingSpec(specs: Map<string, JsonObject>, width: number, height: number, size: number, path: string): string {
  const matches = [...specs].filter(([, spec]) => {
    const dimensions = object(spec.dimensions, "spec dimensions");
    return integer(dimensions.minWidth, "minWidth") <= width && width <= integer(dimensions.maxWidth, "maxWidth")
      && integer(dimensions.minHeight, "minHeight") <= height && height <= integer(dimensions.maxHeight, "maxHeight")
      && size <= integer(spec.maxFileSize, "maxFileSize") && spec.alphaAllowed === false
      && entries(spec.mimeTypes, "MIME types").includes("image/png")
      && entries(spec.fileExtensions, "extensions").includes(".png")
      && entries(spec.compatiblePlacementTypes, "compatible placement types").includes("APP_SCREENSHOT");
  });
  if (matches.length !== 1) throw new Error(path + ": expected one catalog-approved opaque PNG spec for " + width + "x" + height + ", " + size + " bytes; found " + matches.length);
  return matches[0][0];
}

function loadFiles(root: string, locale: Locale, specs: Map<string, JsonObject>, families: readonly Family[]): ImageFile[] {
  return families.flatMap((family) => {
    const directory = join(root, family);
    const names = readdirSync(directory);
    return [1, 2, 3, 4, 5].map((index) => {
      const prefix = locale.captureTag + "-" + index + "_";
      const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(".png"));
      if (matches.length !== 1) throw new Error(directory + ": expected one " + prefix + "*.png; found " + matches.length);
      const sourceName = matches[0];
      const fileName = family + "-" + sourceName;
      const path = join(directory, sourceName);
      const { bytes, width, height } = png(path);
      const expected = family === "iphone-duo-outer" ? "1398x2034" : "2853x2007";
      if (width + "x" + height !== expected) throw new Error(path + ": expected " + expected + ", got " + width + "x" + height);
      const specId = matchingSpec(specs, width, height, bytes.length, path);
      const slot = locale.storeLocale + ":" + family + ":" + index;
      const hash = createHash("sha256").update(bytes).digest("hex");
      return { path, fileName, size: bytes.length, width, height, specId, slot, referenceName: "nibomo-duo-v1:" + slot + ":sha256:" + hash };
    });
  });
}

async function listRaw(client: Client, path: string, type: string): Promise<{ rows: JsonObject[]; included: Map<string, Resource> }> {
  const rows: JsonObject[] = [];
  const included = new Map<string, Resource>();
  const seen = new Set<string>();
  let next: string | null = path;
  while (next !== null) {
    if (seen.has(next)) throw new Error("Repeated pagination link: " + next);
    seen.add(next);
    const page = await client.api("GET", next, undefined);
    for (const item of entries(page.data, path + ".data")) {
      const raw = object(item, type);
      resource(raw, type);
      rows.push(raw);
    }
    for (const item of entries(page.included ?? [], path + ".included")) {
      const image = resource(item, "appAssetLibraryImages");
      included.set(image.id, image);
    }
    const link = object(page.links, path + ".links").next;
    next = link === null || link === undefined ? null : string(link, path + ".links.next");
  }
  return { rows, included };
}

async function placements(client: Client, localizationId: string, group: string): Promise<Placement[]> {
  const path = "/v1/appStoreVersionLocalizations/" + localizationId
    + "/placements?filter[placementType]=APP_SCREENSHOT&filter[placementGroup]=" + encodeURIComponent(group)
    + "&sort=placementGroupPosition&include=image&limit=200";
  const { rows, included } = await listRaw(client, path, "appAssetLibraryPlacements");
  const result: Placement[] = [];
  for (const row of rows) {
    const placement = resource(row, "appAssetLibraryPlacements");
    if (placement.attributes.placementType !== "APP_SCREENSHOT" || placement.attributes.placementGroup !== group) {
      throw new Error("Unexpected placement in " + group + ": " + placement.id);
    }
    if (placement.attributes.state === "FAILED" || hasDetails(placement.attributes.stateDetails)) {
      throw new Error("Placement " + placement.id + " has state " + placement.attributes.state + ": " + JSON.stringify(placement.attributes.stateDetails));
    }
    const relationships = object(row.relationships, placement.id + ".relationships");
    const imageRelation = object(object(relationships.image, "image").data, "image data");
    if (imageRelation.type !== "appAssetLibraryImages") throw new Error("Placement " + placement.id + " has no image relationship");
    const imageId = string(imageRelation.id, "placement image ID");
    const image = included.get(imageId);
    if (image === undefined) throw new Error("Placement " + placement.id + ": missing included image " + imageId);
    result.push({ id: placement.id, imageId, image });
  }
  return result;
}

function managedSlot(image: Resource, locale: string): string | undefined {
  const value = image.attributes.referenceName;
  if (typeof value !== "string") return undefined;
  const match = /^nibomo-duo-v1:([^:]+):(iphone-duo-(?:outer|inner)):([1-5]):sha256:[0-9a-f]{64}$/.exec(value);
  return match !== null && match[1] === locale ? match[1] + ":" + match[2] + ":" + match[3] : undefined;
}

function hasDetails(value: Json | undefined): boolean {
  return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
}

function verifyImage(image: Resource, file: ImageFile): void {
  if (hasDetails(image.attributes.stateDetails)) throw new Error("Image " + image.id + " has state details: " + JSON.stringify(image.attributes.stateDetails));
  if (text(image, "referenceName") !== file.referenceName || text(image, "fileName") !== file.fileName
    || image.attributes.fileSize !== file.size || image.attributes.category !== "APP_SCREENSHOTS_AND_PREVIEWS") {
    throw new Error("Image " + image.id + ": identity readback mismatch for " + file.path);
  }
  if (image.attributes.specId !== file.specId) throw new Error("Image " + image.id + ": Apple specId " + image.attributes.specId + " differs from discovered " + file.specId);
  const asset = object(image.attributes.imageAsset, image.id + ".imageAsset");
  if (asset.width !== file.width || asset.height !== file.height) throw new Error("Image " + image.id + ": processed dimensions differ from " + file.width + "x" + file.height);
}

async function waitForImage(client: Client, id: string, file: ImageFile): Promise<Resource> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const image = await client.read("/v1/appAssetLibraryImages/" + id, "appAssetLibraryImages");
    const state = text(image, "state");
    if (state === "PREPARE_FOR_SUBMISSION" || state === "APPROVED") { verifyImage(image, file); return image; }
    if (state === "FAILED") throw new Error("Image " + id + " (" + file.path + ") failed processing: " + JSON.stringify(image.attributes.stateDetails));
    if (state !== "UPLOAD_COMPLETE") throw new Error("Image " + id + " (" + file.path + ") entered unexpected state " + state + ": " + JSON.stringify(image.attributes.stateDetails));
    await sleep(5000);
  }
  throw new Error("Image " + id + " (" + file.path + ") is still processing after five minutes; inspect it before rerunning");
}

async function transfer(client: Client, reservation: Resource, file: ImageFile): Promise<Resource> {
  const { bytes } = png(file.path);
  if (bytes.length !== file.size || "nibomo-duo-v1:" + file.slot + ":sha256:" + createHash("sha256").update(bytes).digest("hex") !== file.referenceName) {
    throw new Error(file.path + ": file changed after preflight");
  }
  const operations = entries(reservation.attributes.uploadOperations, reservation.id + ".uploadOperations")
    .map((item) => object(item, "upload operation")).sort((a, b) => integer(a.offset, "offset") - integer(b.offset, "offset"));
  if (operations.length === 0) throw new Error("Image " + reservation.id + ": missing upload operations");
  let offset = 0;
  for (const operation of operations) {
    const start = integer(operation.offset, "upload offset");
    const length = integer(operation.length, "upload length");
    if (start !== offset || length <= 0 || start + length > bytes.length || operation.method !== "PUT") {
      throw new Error("Image " + reservation.id + ": invalid upload byte range or method");
    }
    const url = new URL(string(operation.url, "upload URL"));
    if (url.protocol !== "https:" || !url.hostname.endsWith(".apple.com")) throw new Error("Image " + reservation.id + ": unexpected upload host");
    const headers = Object.fromEntries(entries(operation.requestHeaders, "upload headers").map((item) => {
      const header = object(item, "upload header");
      return [string(header.name, "upload header name"), string(header.value, "upload header value")];
    }));
    await request(url.href, "PUT", headers, bytes.subarray(start, start + length), "Upload Duo image " + reservation.id + " bytes " + start + "-" + (start + length));
    offset += length;
  }
  if (offset !== bytes.length) throw new Error("Image " + reservation.id + ": upload operations did not cover the full file");
  await client.api("PATCH", "/v1/appAssetLibraryImages/" + reservation.id, {
    data: { type: "appAssetLibraryImages", id: reservation.id, attributes: { uploaded: true } },
  });
  return waitForImage(client, reservation.id, file);
}

async function readyImage(client: Client, libraryId: string, file: ImageFile, images: Resource[]): Promise<Resource> {
  const matches = images.filter((image) => image.attributes.referenceName === file.referenceName);
  if (matches.length > 1) throw new Error(file.referenceName + ": duplicate library images; reconcile before rerunning");
  const existing = matches[0];
  if (existing !== undefined) {
    if (existing.attributes.fileName !== file.fileName || existing.attributes.fileSize !== file.size || existing.attributes.category !== "APP_SCREENSHOTS_AND_PREVIEWS") {
      throw new Error("Image " + existing.id + ": referenceName matches but file attributes differ; reconcile before rerunning");
    }
    const state = text(existing, "state");
    if (state === "PREPARE_FOR_SUBMISSION" || state === "APPROVED") { verifyImage(existing, file); return existing; }
    if (state === "UPLOAD_COMPLETE") return waitForImage(client, existing.id, file);
    if (state === "AWAITING_UPLOAD") {
      const fresh = await client.read("/v1/appAssetLibraryImages/" + existing.id, "appAssetLibraryImages");
      return transfer(client, fresh, file);
    }
    throw new Error("Image " + existing.id + " (" + file.path + ") is " + state + ": " + JSON.stringify(existing.attributes.stateDetails) + "; reconcile before rerunning");
  }
  const reservation = resource((await client.api("POST", "/v1/appAssetLibraryImages", {
    data: { type: "appAssetLibraryImages", attributes: {
      fileName: file.fileName, fileSize: file.size, category: "APP_SCREENSHOTS_AND_PREVIEWS", referenceName: file.referenceName,
    }, relationships: relation("assetLibrary", "appAssetLibraries", libraryId) },
  })).data, "appAssetLibraryImages");
  images.push(reservation);
  return transfer(client, reservation, file);
}

async function applyPlan(client: Client, libraryId: string, group: string, limit: number, plan: Plan, images: Resource[], guard: () => Promise<void>): Promise<void> {
  const desired = new Map<string, Resource>();
  for (const file of plan.files) {
    await guard();
    desired.set(file.slot, await readyImage(client, libraryId, file, images));
  }
  let current = await placements(client, plan.localizationId, group);
  const slots = current.map((placement) => managedSlot(placement.image, plan.locale.storeLocale)).filter((slot) => slot !== undefined);
  if (slots.length !== new Set(slots).size || current.length - slots.length + plan.files.length > limit) {
    throw new Error(plan.locale.storeLocale + ": Duo placements changed during image upload; reconcile before rerunning");
  }
  for (const placement of current) {
    const slot = managedSlot(placement.image, plan.locale.storeLocale);
    if (slot !== undefined && placement.imageId !== desired.get(slot)?.id) {
      await guard();
      await client.api("DELETE", "/v1/appAssetLibraryPlacements/" + placement.id, undefined);
    }
  }
  current = await placements(client, plan.localizationId, group);
  for (const file of plan.files) {
    const image = desired.get(file.slot)!;
    if (current.some((placement) => placement.imageId === image.id)) continue;
    await guard();
    await client.api("POST", "/v1/appAssetLibraryPlacements", { data: {
      type: "appAssetLibraryPlacements", attributes: { placementType: "APP_SCREENSHOT", placementGroup: group },
      relationships: { ...relation("image", "appAssetLibraryImages", image.id),
        ...relation("appStoreVersionLocalization", "appStoreVersionLocalizations", plan.localizationId) },
    } });
    current = await placements(client, plan.localizationId, group);
    if (!current.some((placement) => placement.imageId === image.id)) throw new Error(file.slot + ": placement POST did not appear on readback; reconcile before rerunning");
  }
  const final = await placements(client, plan.localizationId, group);
  const managed = new Map(final.map((placement) => [managedSlot(placement.image, plan.locale.storeLocale), placement]));
  const other = final.filter((placement) => managedSlot(placement.image, plan.locale.storeLocale) === undefined);
  const ordered = [...plan.files.map((file) => {
    const placement = managed.get(file.slot);
    if (placement === undefined || placement.imageId !== desired.get(file.slot)?.id) throw new Error(file.slot + ": missing or incorrect placement before ordering");
    return placement;
  }), ...other];
  if (ordered.length !== final.length || new Set(ordered.map(({ id }) => id)).size !== ordered.length) throw new Error(plan.locale.storeLocale + ": duplicate or unrecognized Duo placements");
  if (final.map(({ id }) => id).join() !== ordered.map(({ id }) => id).join()) {
    await guard();
    await client.api("POST", "/v1/appAssetLibraryPlacementOrderingRequests", { data: {
      type: "appAssetLibraryPlacementOrderingRequests", attributes: { placementGroup: group },
      relationships: { orderedPlacements: { data: ordered.map(({ id }) => ({ type: "appAssetLibraryPlacements", id })) },
        ...relation("appStoreVersionLocalization", "appStoreVersionLocalizations", plan.localizationId) },
    } });
  }
  const saved = await placements(client, plan.localizationId, group);
  if (saved.map(({ id }) => id).join() !== ordered.map(({ id }) => id).join()) throw new Error(plan.locale.storeLocale + ": placement order readback mismatch");
  for (let index = 0; index < plan.files.length; index += 1) verifyImage(saved[index].image, plan.files[index]);
  console.log(JSON.stringify({ event: "duo_locale_verified", locale: plan.locale.storeLocale, placements: saved.length, group }));
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { version: { type: "string" }, screenshots: { type: "string" }, locale: { type: "string" }, "all-locales": { type: "boolean" }, family: { type: "string" }, help: { type: "boolean" } }, strict: true });
  if (values.help) { console.log(USAGE); return; }
  if (values.version === undefined || values.screenshots === undefined || (values.locale === undefined) === (values["all-locales"] !== true)) throw new Error(USAGE);
  if (!/^\d+(?:\.\d+){1,2}$/.test(values.version)) throw new Error("--version must name an explicit numeric App Store version");
  if (values.family !== "iphone-duo-inner" && values.family !== "iphone-duo-outer" && values.family !== "all") {
    throw new Error("--family is required: iphone-duo-inner, iphone-duo-outer, or all");
  }
  const families: readonly Family[] = values.family === "all" ? FAMILIES : [values.family];
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const locales = JSON.parse(readFileSync(join(repoRoot, "scripts/store-screenshots/assets/app-store/store-locales.json"), "utf8")) as Locale[];
  if (!Array.isArray(locales) || locales.length !== 42 || locales.some((locale) => typeof locale.storeLocale !== "string" || typeof locale.captureTag !== "string")) {
    throw new Error("Expected the existing 42 Store locale mappings");
  }
  const selected = values["all-locales"] ? locales : locales.filter((locale) => locale.storeLocale === values.locale);
  if (selected.length !== (values["all-locales"] ? 42 : 1)) throw new Error("Unknown App Store locale " + values.locale);
  const client = createClient(repoRoot);
  const versions = await client.list("/v1/apps/" + client.appId + "/appStoreVersions?filter[platform]=IOS&filter[versionString]=" + encodeURIComponent(values.version) + "&limit=200", "appStoreVersions");
  if (versions.length !== 1) throw new Error("Expected one existing iOS version " + values.version + "; found " + versions.length);
  const version = versions[0];
  const guard = async (): Promise<void> => {
    const actual = await client.read("/v1/appStoreVersions/" + version.id, "appStoreVersions");
    const state = text(actual, "appVersionState");
    if (actual.attributes.versionString !== values.version || actual.attributes.platform !== "IOS"
      || (state !== "PREPARE_FOR_SUBMISSION" && state !== "DEVELOPER_REJECTED" && state !== "REJECTED")) {
      throw new Error("Version " + version.id + " is " + state + "; only the selected editable iOS draft can be changed");
    }
  };
  await guard();
  const reference = catalog(await client.api("GET", "/v1/appAssetLibraryRefData", undefined));
  const library = object((await client.api("GET", "/v1/apps/" + client.appId + "/assetLibrary", undefined)).data, "assetLibrary");
  if (library.type !== "appAssetLibraries") throw new Error("App did not return an asset library");
  const libraryId = string(library.id, "assetLibrary.id");
  const root = resolve(values.screenshots);
  const files = selected.map((locale) => loadFiles(root, locale, reference.specs, families));
  const localizations = await client.list("/v1/appStoreVersions/" + version.id + "/appStoreVersionLocalizations?limit=200", "appStoreVersionLocalizations");
  const images = await client.list("/v1/appAssetLibraries/" + libraryId + "/images?limit=200", "appAssetLibraryImages");
  const plans: Plan[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const locale = selected[index];
    const matches = localizations.filter((item) => item.attributes.locale === locale.storeLocale);
    if (matches.length !== 1) throw new Error(locale.storeLocale + ": expected one existing version localization; found " + matches.length);
    const current = await placements(client, matches[0].id, reference.group);
    const slots = current.map((placement) => managedSlot(placement.image, locale.storeLocale)).filter((slot) => slot !== undefined);
    if (slots.length !== new Set(slots).size) throw new Error(locale.storeLocale + ": duplicate managed Duo slots; reconcile before rerunning");
    const unrelated = current.length - slots.length;
    if (unrelated + files[index].length > reference.limit) {
      throw new Error(locale.storeLocale + "/" + reference.group + ": " + unrelated + " unrelated + " + files[index].length + " desired exceeds catalog limit " + reference.limit + "; remove unrelated placements explicitly");
    }
    plans.push({ locale, localizationId: matches[0].id, files: files[index] });
  }
  console.log(JSON.stringify({ event: "duo_preflight_complete", version: values.version, family: values.family, locales: plans.length, images: files.reduce((count, localeFiles) => count + localeFiles.length, 0), group: reference.group, limit: reference.limit }));
  for (const plan of plans) await applyPlan(client, libraryId, reference.group, reference.limit, plan, images, guard);
  await guard();
  console.log(JSON.stringify({ event: "duo_upload_verified", version: values.version, family: values.family, locales: plans.length, images: files.reduce((count, localeFiles) => count + localeFiles.length, 0) }));
}

await main();
