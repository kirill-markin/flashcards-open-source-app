import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient, object, request, resource, string, text } from "./app-store-connect-client.mts";
import type { Client, JsonObject, Resource, Write } from "./app-store-connect-client.mts";
import { loadLocalizations } from "./app-store-localization-inputs.mts";
import type { Screenshot, ScreenshotSet } from "./app-store-localization-inputs.mts";

const USAGE = `Upload repository App Store metadata and five screenshots per iPhone/iPad locale.

node scripts/ios/upload-app-store-localizations.mts \\
  --version <editable-version> \\
  --metadata docs/app-store-connect-metadata.md \\
  --screenshots apps/ios/docs/media/app-store-screenshots

Requires Node 24 and the main checkout's .env credentials documented in
docs/xcode-cloud-data-access.md. Only PREPARE_FOR_SUBMISSION and DEVELOPER_REJECTED
are accepted for both the explicit iOS version and app info.
Never creates, renames, withdraws, or submits a version.
All 42 locale texts and 420 PNGs must exist before this command contacts Apple.
New locales inherit only the existing en-US privacy-policy and support URLs.
Unknown locales, screenshot sizes, and screenshot filenames are preserved.
Within the two target sizes, replaces only <locale>-[1-5]_*.png screenshots,
after replacements complete. Requires enough free slots to stage missing files
within Apple's 10-image limit; stops without clearing slots when capacity is short.
A failed run can leave partial metadata/uploads. Inspect its reported resource,
then rerun with the same inputs; completed matching images are reused.
Do not edit the target draft in App Store Connect while this command runs.`;

type PreparedSet = { input: ScreenshotSet; remote: Resource | undefined; existing: Resource[] };

function byLocale(items: Resource[]): Map<string, Resource> {
  const pairs = items.map((item) => [text(item, "locale"), item] as const);
  const result = new Map(pairs);
  if (result.size !== pairs.length) throw new Error("Apple returned duplicate locale resources");
  return result;
}

function relationship(name: string, type: string, id: string): JsonObject {
  return { [name]: { data: { type, id } } };
}

function isEditableState(state: string): boolean {
  return state === "PREPARE_FOR_SUBMISSION" || state === "DEVELOPER_REJECTED";
}

function requireDraft(actual: Resource, stateField: string): void {
  const state = text(actual, stateField);
  if (!isEditableState(state)) throw new Error(`${actual.type}/${actual.id} is ${state}; only PREPARE_FOR_SUBMISSION or DEVELOPER_REJECTED drafts can be changed`);
}

function verifyFields(actual: Resource, expected: Record<string, string>): void {
  for (const [key, value] of Object.entries(expected)) {
    if (actual.attributes[key] !== value) throw new Error(`Readback mismatch: ${actual.type}/${actual.id}.${key}`);
  }
}

async function saveText(client: Client, write: Write, type: string, existing: Resource | undefined, attributes: Record<string, string>, relationships: JsonObject, createOnly: Record<string, string>): Promise<Resource> {
  if (existing === undefined) {
    const saved = resource((await write("POST", `/v1/${type}`, { type, attributes: { ...createOnly, ...attributes }, relationships })).data, type);
    const actual = await client.read(`/v1/${type}/${saved.id}`, type);
    verifyFields(actual, { ...createOnly, ...attributes });
    return actual;
  }
  const { locale, ...updates } = attributes;
  if (Object.entries(updates).some(([key, value]) => existing.attributes[key] !== value)) {
    await write("PATCH", `/v1/${type}/${existing.id}`, { type, id: existing.id, attributes: updates });
  }
  const actual = await client.read(`/v1/${type}/${existing.id}`, type);
  verifyFields(actual, attributes);
  return actual;
}

function deliveryState(image: Resource): string {
  return string(object(image.attributes.assetDeliveryState, `${image.id}.assetDeliveryState`).state, `${image.id}.assetDeliveryState.state`);
}

function matchingImage(existing: Resource[], file: Screenshot): Resource | undefined {
  return existing.find((image) => image.attributes.fileName === file.fileName
    && image.attributes.fileSize === file.fileSize && image.attributes.sourceFileChecksum === file.checksum
    && deliveryState(image) === "COMPLETE");
}

function processingImage(existing: Resource[], file: Screenshot): Resource | undefined {
  return existing.find((image) => image.attributes.fileName === file.fileName
    && image.attributes.fileSize === file.fileSize && image.attributes.sourceFileChecksum === file.checksum
    && deliveryState(image) === "UPLOAD_COMPLETE");
}

function pendingImage(existing: Resource[], file: Screenshot): Resource | undefined {
  const matches = existing.filter((image) => image.attributes.fileName === file.fileName
    && image.attributes.fileSize === file.fileSize && deliveryState(image) === "AWAITING_UPLOAD");
  if (matches.length > 1) throw new Error(`${file.fileName}: multiple unfinished reservations; inspect and remove duplicate reservations in App Store Connect`);
  return matches[0];
}

async function prepareSet(client: Client, input: ScreenshotSet, sets: Resource[]): Promise<PreparedSet> {
  const matches = sets.filter((set) => text(set, "screenshotDisplayType") === input.displayType);
  if (matches.length > 1) throw new Error(`Duplicate ${input.displayType} screenshot sets`);
  const remote = matches[0];
  const existing = remote === undefined ? [] : await client.list(`/v1/appScreenshotSets/${remote.id}/appScreenshots?limit=200`, "appScreenshots");
  const needed = input.files.filter((file) => matchingImage(existing, file) === undefined && processingImage(existing, file) === undefined && pendingImage(existing, file) === undefined).length;
  if (existing.length + needed > 10) throw new Error(`${input.screenshotLocale}/${input.displayType}: ${existing.length} existing + ${needed} new screenshots exceeds 10; inspect and free slots explicitly before rerunning`);
  return { input, remote, existing };
}

async function waitForImage(client: Client, id: string, file: Screenshot): Promise<Resource> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const image = await client.read(`/v1/appScreenshots/${id}`, "appScreenshots");
    const state = deliveryState(image);
    if (state === "COMPLETE") {
      verifyFields(image, { fileName: file.fileName, sourceFileChecksum: file.checksum });
      if (image.attributes.fileSize !== file.fileSize) throw new Error(`${id}: screenshot size readback mismatch`);
      return image;
    }
    if (state !== "UPLOAD_COMPLETE") throw new Error(`Screenshot ${id} (${file.fileName}): ${JSON.stringify(image.attributes.assetDeliveryState)}`);
    await sleep(5000);
  }
  throw new Error(`Screenshot ${id} (${file.fileName}): processing exceeded five minutes; inspect Apple processing status before rerunning`);
}

async function uploadImage(client: Client, write: Write, setId: string, file: Screenshot, existing: Resource[]): Promise<Resource> {
  const complete = matchingImage(existing, file);
  if (complete !== undefined) return complete;
  const processing = processingImage(existing, file);
  if (processing !== undefined) return waitForImage(client, processing.id, file);
  const bytes = readFileSync(file.path);
  if (bytes.length !== file.fileSize || createHash("md5").update(bytes).digest("hex") !== file.checksum) throw new Error(`Screenshot changed after preflight: ${file.path}`);
  const reservation = pendingImage(existing, file) ?? resource((await write("POST", "/v1/appScreenshots", {
    type: "appScreenshots", attributes: { fileName: file.fileName, fileSize: file.fileSize },
    relationships: relationship("appScreenshotSet", "appScreenshotSets", setId),
  })).data, "appScreenshots");
  const operations = reservation.attributes.uploadOperations;
  if (!Array.isArray(operations) || operations.length === 0) throw new Error(`Screenshot ${reservation.id}: missing upload operations`);
  const orderedOperations: Array<JsonObject & { offset: number }> = operations.map((item) => {
    const operation = object(item, `${reservation.id}.uploadOperations`);
    if (typeof operation.offset !== "number") throw new Error(`Screenshot ${reservation.id}: missing upload offset`);
    return { ...operation, offset: operation.offset };
  }).sort((left, right) => left.offset - right.offset);
  let uploadedBytes = 0;
  for (const operation of orderedOperations) {
    const { offset, length } = operation;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || typeof offset !== "number" || typeof length !== "number"
      || offset !== uploadedBytes || length <= 0 || offset + length > bytes.length) throw new Error(`Screenshot ${reservation.id}: invalid upload byte range`);
    const url = new URL(string(operation.url, "upload URL"));
    if (url.protocol !== "https:" || !url.hostname.endsWith(".apple.com")) throw new Error(`Screenshot ${reservation.id}: unexpected upload host`);
    if (operation.method !== "PUT" || !Array.isArray(operation.requestHeaders)) throw new Error(`Screenshot ${reservation.id}: invalid upload instructions`);
    const headers = Object.fromEntries(operation.requestHeaders.map((header) => {
      const pair = object(header, "upload header");
      return [string(pair.name, "upload header name"), string(pair.value, "upload header value")];
    }));
    await request(url.href, "PUT", headers, bytes.subarray(offset, offset + length), `Upload screenshot ${reservation.id} bytes ${offset}–${offset + length}`);
    uploadedBytes += length;
  }
  if (uploadedBytes !== bytes.length) throw new Error(`Screenshot ${reservation.id}: upload operations did not cover the full file`);
  await write("PATCH", `/v1/appScreenshots/${reservation.id}`, {
    type: "appScreenshots", id: reservation.id, attributes: { uploaded: true, sourceFileChecksum: file.checksum },
  });
  return waitForImage(client, reservation.id, file);
}

async function saveSet(client: Client, write: Write, localizationId: string, prepared: PreparedSet): Promise<void> {
  const { input, existing } = prepared;
  const remote = prepared.remote ?? resource((await write("POST", "/v1/appScreenshotSets", {
    type: "appScreenshotSets", attributes: { screenshotDisplayType: input.displayType },
    relationships: relationship("appStoreVersionLocalization", "appStoreVersionLocalizations", localizationId),
  })).data, "appScreenshotSets");
  const images: Resource[] = [];
  for (const file of input.files) images.push(await uploadImage(client, write, remote.id, file, existing));
  const selectedIds = new Set(images.map((image) => image.id));
  const ownedName = new RegExp(`^${input.screenshotLocale}-[1-5]_.+\\.png$`);
  const retained = existing.filter((image) => !selectedIds.has(image.id) && !ownedName.test(text(image, "fileName")));
  for (const image of existing) {
    if (!selectedIds.has(image.id) && ownedName.test(text(image, "fileName"))) {
      await write("DELETE", `/v1/appScreenshots/${image.id}`, {});
    }
  }
  const ordered = [...images, ...retained].map(({ id }) => ({ type: "appScreenshots", id }));
  await write("PATCH", `/v1/appScreenshotSets/${remote.id}/relationships/appScreenshots`, ordered);
  const saved = await client.list(`/v1/appScreenshotSets/${remote.id}/appScreenshots?limit=200`, "appScreenshots");
  if (saved.map((image) => image.id).join(",") !== ordered.map((image) => image.id).join(",")) throw new Error(`Screenshot order readback mismatch: ${remote.id}`);
  input.files.forEach((file, index) => {
    if (matchingImage([saved[index]], file) === undefined) throw new Error(`Screenshot readback mismatch: ${remote.id}/${file.fileName}`);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { version: { type: "string" }, metadata: { type: "string" }, screenshots: { type: "string" }, help: { type: "boolean" } }, strict: true });
  if (values.help) { console.log(USAGE); return; }
  if (values.version === undefined || values.metadata === undefined || values.screenshots === undefined) throw new Error(USAGE);
  if (!/^\d+(?:\.\d+){1,2}$/.test(values.version)) throw new Error("--version must name an explicit numeric App Store version");
  const localizations = loadLocalizations(resolve(values.metadata), resolve(values.screenshots));
  const client = createClient(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const versions = await client.list(`/v1/apps/${client.appId}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(values.version)}&limit=200`, "appStoreVersions");
  if (versions.length !== 1) throw new Error(`Expected one existing iOS version ${values.version}; found ${versions.length}. Create the intended draft in App Store Connect first.`);
  const version = versions[0];
  verifyFields(version, { versionString: values.version, platform: "IOS" });
  requireDraft(version, "appVersionState");
  const infos = await client.list(`/v1/apps/${client.appId}/appInfos?limit=200`, "appInfos");
  const drafts = infos.filter((info) => isEditableState(text(info, "state")));
  if (drafts.length !== 1) throw new Error(`Expected one PREPARE_FOR_SUBMISSION or DEVELOPER_REJECTED app info; found ${drafts.length}. Submitted or published app info must not be edited.`);
  const info = drafts[0];
  const guard = async (): Promise<void> => {
    const currentVersion = await client.read(`/v1/appStoreVersions/${version.id}`, "appStoreVersions");
    verifyFields(currentVersion, { versionString: values.version!, platform: "IOS" });
    requireDraft(currentVersion, "appVersionState");
    requireDraft(await client.read(`/v1/appInfos/${info.id}`, "appInfos"), "state");
  };
  const write: Write = async (method, path, data) => {
    await guard();
    return client.api(method, path, method === "DELETE" ? undefined : { data });
  };
  const infoPath = `/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`;
  const versionPath = `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`;
  const infoLocales = byLocale(await client.list(infoPath, "appInfoLocalizations"));
  const versionLocales = byLocale(await client.list(versionPath, "appStoreVersionLocalizations"));
  const finalInfo = new Set([...infoLocales.keys(), ...localizations.map(({ locale }) => locale)]);
  const finalVersion = new Set([...versionLocales.keys(), ...localizations.map(({ locale }) => locale)]);
  if ([...finalInfo].sort().join() !== [...finalVersion].sort().join()) throw new Error("Existing unrelated app-info/version locales differ; align them explicitly before uploading");
  const sourceInfo = infoLocales.get("en-US");
  const sourceVersion = versionLocales.get("en-US");
  if (sourceInfo === undefined || sourceVersion === undefined) throw new Error("The editable draft needs existing en-US app-info and version localizations for its technical URLs");
  const privacyPolicyUrl = text(sourceInfo, "privacyPolicyUrl");
  const supportUrl = text(sourceVersion, "supportUrl");
  for (const url of [privacyPolicyUrl, supportUrl]) {
    if (!["https:", "http:"].includes(new URL(url).protocol)) throw new Error("The source privacy-policy/support URLs must be HTTP(S) URLs");
  }
  const prepared = new Map<string, PreparedSet[]>();
  for (const localization of localizations) {
    const existing = versionLocales.get(localization.locale);
    const sets = existing === undefined ? [] : await client.list(`/v1/appStoreVersionLocalizations/${existing.id}/appScreenshotSets?limit=200`, "appScreenshotSets");
    const preparedSets: PreparedSet[] = [];
    for (const input of localization.screenshots) preparedSets.push(await prepareSet(client, input, sets));
    prepared.set(localization.locale, preparedSets);
  }
  console.log(JSON.stringify({ event: "app_store_preflight_complete", appId: client.appId, version: values.version, locales: localizations.length, screenshots: localizations.length * 10 }));
  for (const localization of localizations) {
    await saveText(client, write, "appInfoLocalizations", infoLocales.get(localization.locale), { locale: localization.locale, ...localization.info }, relationship("appInfo", "appInfos", info.id), { privacyPolicyUrl });
    const savedVersion = await saveText(client, write, "appStoreVersionLocalizations", versionLocales.get(localization.locale), { locale: localization.locale, ...localization.version }, relationship("appStoreVersion", "appStoreVersions", version.id), { supportUrl });
    for (const set of prepared.get(localization.locale)!) await saveSet(client, write, savedVersion.id, set);
    console.log(JSON.stringify({ event: "app_store_locale_verified", locale: localization.locale, version: values.version }));
  }
  const savedInfo = byLocale(await client.list(infoPath, "appInfoLocalizations"));
  const savedVersion = byLocale(await client.list(versionPath, "appStoreVersionLocalizations"));
  if ([...savedInfo.keys()].sort().join() !== [...finalInfo].sort().join() || [...savedVersion.keys()].sort().join() !== [...finalVersion].sort().join()) throw new Error("Final locale-set readback mismatch");
  for (const localization of localizations) {
    verifyFields(savedInfo.get(localization.locale)!, localization.info);
    verifyFields(savedVersion.get(localization.locale)!, localization.version);
  }
  await guard();
  console.log(JSON.stringify({ event: "app_store_upload_verified", version: values.version, locales: localizations.length }));
}

await main();
