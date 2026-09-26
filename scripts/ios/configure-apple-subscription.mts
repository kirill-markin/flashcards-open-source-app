import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient, object, resource, string, text } from "./app-store-connect-client.mts";
import type { Client, Json, JsonObject, Resource } from "./app-store-connect-client.mts";
import { loadSubscriptionLocalizations } from "./subscription-localization-inputs.mts";
import type { SubscriptionLocalization } from "./subscription-localization-inputs.mts";

type RelatedResource = Resource & { relationships: JsonObject };
const APP_ID = "6760538964";
const PRODUCT = { name: "Premium Monthly", productId: "premium_monthly", subscriptionPeriod: "ONE_MONTH", familySharable: false };
const GROUP = { referenceName: "Premium" };
const TRIAL = { duration: "ONE_WEEK", offerMode: "FREE_TRIAL", numberOfPeriods: 1 };

function endpoint(type: string, id: string, suffix: string): string {
  return `/v1/${type}/${encodeURIComponent(id)}${suffix}`;
}

function relationship(type: string, id: string): JsonObject {
  return { data: { type, id } };
}

function related(value: Json, type: string): RelatedResource {
  const raw = object(value, type);
  return { ...resource(value, type), relationships: raw.relationships === undefined ? {} : object(raw.relationships, type) };
}

function relation(item: RelatedResource, key: string): Json {
  return object(item.relationships[key], `${item.type}/${item.id}.${key}`).data;
}

function relatedId(item: RelatedResource, key: string, type: string): string {
  const data = object(relation(item, key), `${item.id}.${key}`);
  if (data.type !== type) throw new Error(`${item.id}.${key}: expected ${type}, got ${data.type}`);
  return string(data.id, `${item.id}.${key}.id`);
}

async function list(client: Client, path: string, type: string): Promise<RelatedResource[]> {
  const result: RelatedResource[] = [];
  const visited = new Set<string>();
  let next: string | null = path;
  while (next !== null) {
    if (visited.has(next)) throw new Error(`Repeated pagination link: ${path}`);
    visited.add(next);
    const page = await client.api("GET", next, undefined);
    if (!Array.isArray(page.data)) throw new Error(`Expected list at ${next}`);
    result.push(...page.data.map((item) => related(item, type)));
    const link = object(page.links, path).next;
    next = link === null || link === undefined ? null : string(link, path);
  }
  return result;
}

function verify(actual: Resource, expected: JsonObject): void {
  for (const [key, value] of Object.entries(expected)) {
    if (actual.attributes[key] !== value) {
      throw new Error(`Catalog drift: ${actual.type}/${actual.id}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual.attributes[key])}`);
    }
  }
}

function only(items: RelatedResource[], label: string): RelatedResource | undefined {
  if (items.length > 1) throw new Error(`${label}: expected at most one resource, got ${items.map((item) => item.id).join(", ")}`);
  return items[0];
}

function indexed(items: RelatedResource[], key: (item: RelatedResource) => string): Map<string, RelatedResource> {
  const pairs = items.map((item) => [key(item), item] as const);
  const result = new Map(pairs);
  if (result.size !== pairs.length) throw new Error(`Duplicate catalog identities: ${JSON.stringify(pairs.map(([identity, item]) => ({ identity, id: item.id })))}`);
  return result;
}

async function create(client: Client, type: string, attributes: JsonObject, relationships: JsonObject, readback: () => Promise<RelatedResource[]>): Promise<RelatedResource> {
  try {
    return related((await client.api("POST", `/v1/${type}`, { data: { type, attributes, relationships } })).data, type);
  } catch (error) {
    // The shared client never retries POST. Read remote state before permitting another run.
    const observed = await readback();
    throw new Error(`Creation stopped for ${type}; reconciled readback IDs: ${JSON.stringify(observed.map((item) => item.id))}. Inspect the original failure and these resources before rerunning.`, { cause: error });
  }
}

function requireDraft(product: Resource): void {
  const state = text(product, "state");
  if (state !== "MISSING_METADATA" && state !== "READY_TO_SUBMIT") {
    throw new Error(`Subscription ${product.id} is ${state}; only unsubmitted drafts can be configured`);
  }
  verify(product, PRODUCT);
}

async function identity(client: Client): Promise<{ group: RelatedResource | undefined; product: RelatedResource | undefined }> {
  const groups = await list(client, endpoint("apps", APP_ID, "/subscriptionGroups?limit=200"), "subscriptionGroups");
  for (const group of groups) verify(group, GROUP);
  const group = only(groups, "Premium group");
  const products = group === undefined ? [] : await list(client, endpoint("subscriptionGroups", group.id, "/subscriptions?limit=200"), "subscriptions");
  const product = only(products, "Premium monthly subscription");
  if (product !== undefined) requireDraft(product);
  return { group, product };
}

async function localizations(client: Client, type: string, ownerType: string, ownerId: string): Promise<RelatedResource[]> {
  return list(client, endpoint(ownerType, ownerId, `/${type}?limit=200`), type);
}

function checkLocales(items: RelatedResource[], inputs: SubscriptionLocalization[]): Map<string, RelatedResource> {
  const map = indexed(items, (item) => text(item, "locale"));
  for (const locale of map.keys()) {
    if (!inputs.some((input) => input.locale === locale)) throw new Error(`Unexpected remote locale: ${locale}`);
  }
  return map;
}

async function saveLocalization(client: Client, type: string, ownerType: string, ownerId: string, ownerKey: string, locale: string, attributes: JsonObject, existing: RelatedResource | undefined): Promise<void> {
  if (existing === undefined) {
    await create(client, type, { locale, ...attributes }, { [ownerKey]: relationship(ownerType, ownerId) },
      () => localizations(client, type, ownerType, ownerId));
  } else if (Object.entries(attributes).some(([key, value]) => existing.attributes[key] !== value)) {
    await client.api("PATCH", endpoint(type, existing.id, ""), { data: { type, id: existing.id, attributes } });
  }
}

async function pricePoints(client: Client, productId: string, territories: Resource[]): Promise<Map<string, RelatedResource>> {
  const candidates = await list(client, endpoint("subscriptions", productId, "/pricePoints?filter[territory]=USA&include=territory&limit=8000"), "subscriptionPricePoints");
  const base = only(candidates.filter((point) => /^6\.990*$/.test(text(point, "customerPrice"))), "USA USD 6.99 price point");
  if (base === undefined || relatedId(base, "territory", "territories") !== "USA") throw new Error("Apple has no unique USA USD 6.99 price point");
  const equalized = await list(client, endpoint("subscriptionPricePoints", base.id, "/equalizations?include=territory&limit=8000"), "subscriptionPricePoints");
  const points = indexed([base, ...equalized.filter((point) => relatedId(point, "territory", "territories") !== "USA")],
    (point) => relatedId(point, "territory", "territories"));
  for (const territory of territories) {
    if (!points.has(territory.id)) throw new Error(`Apple returned no equalized price for ${territory.id}`);
  }
  return points;
}

function checkPrices(prices: RelatedResource[], points: Map<string, RelatedResource>, today: string): Map<string, RelatedResource> {
  const map = indexed(prices, (price) => relatedId(price, "territory", "territories"));
  for (const [territory, price] of map) {
    const expected = points.get(territory);
    if (expected === undefined || relatedId(price, "subscriptionPricePoint", "subscriptionPricePoints") !== expected.id) {
      throw new Error(`Price drift for ${territory}: ${price.id}; expected Apple equalized point ${expected?.id}`);
    }
    const start = price.attributes.startDate;
    if (start !== null && (typeof start !== "string" || start > today)) throw new Error(`Unexpected price startDate for ${territory}: ${JSON.stringify(start)}`);
    verify(price, { preserved: false });
  }
  return map;
}

function checkTrials(offers: RelatedResource[], territories: Resource[], today: string): Map<string, RelatedResource> {
  const map = indexed(offers, (offer) => relatedId(offer, "territory", "territories"));
  for (const [territory, offer] of map) {
    if (!territories.some((item) => item.id === territory)) throw new Error(`Unexpected trial territory: ${territory}`);
    verify(offer, { ...TRIAL, endDate: null });
    const start = offer.attributes.startDate;
    if (start !== null && (typeof start !== "string" || start > today)) throw new Error(`Unexpected trial startDate for ${territory}: ${JSON.stringify(start)}`);
  }
  return map;
}

async function availability(client: Client, productId: string, territories: Resource[]): Promise<RelatedResource | undefined> {
  const subscription = related((await client.api("GET", endpoint("subscriptions", productId, "?include=subscriptionAvailability"), undefined)).data, "subscriptions");
  if (relation(subscription, "subscriptionAvailability") === null) return undefined;
  const id = relatedId(subscription, "subscriptionAvailability", "subscriptionAvailabilities");
  const actual = related((await client.api("GET", endpoint("subscriptionAvailabilities", id, ""), undefined)).data, "subscriptionAvailabilities");
  verify(actual, { availableInNewTerritories: false });
  const available = await client.list(endpoint("subscriptionAvailabilities", id, "/availableTerritories?limit=200"), "territories");
  if (available.map((item) => item.id).sort().join(",") !== territories.map((item) => item.id).sort().join(",")) {
    throw new Error(`Availability drift: ${JSON.stringify({ expected: territories.map((item) => item.id), actual: available.map((item) => item.id) })}`);
  }
  return actual;
}

async function configure(repoRoot: string): Promise<void> {
  const inputs = loadSubscriptionLocalizations(resolve(repoRoot, "docs/subscription-store-metadata.md"));
  const client = createClient(repoRoot);
  if (client.appId !== APP_ID) throw new Error(`Expected Apple app ${APP_ID}, got ${client.appId}`);
  verify(await client.read(endpoint("apps", APP_ID, ""), "apps"), { bundleId: "com.flashcards-open-source-app.app" });
  const collisions = (await client.list(endpoint("apps", APP_ID, "/inAppPurchasesV2?limit=200"), "inAppPurchases")).filter((item) => text(item, "productId") === PRODUCT.productId);
  if (collisions.length > 0) throw new Error(`Product ID belongs to an in-app purchase: ${collisions.map((item) => item.id).join(",")}`);
  let { group, product } = await identity(client);
  if (group === undefined) group = await create(client, "subscriptionGroups", GROUP, { app: relationship("apps", APP_ID) },
    () => list(client, endpoint("apps", APP_ID, "/subscriptionGroups?limit=200"), "subscriptionGroups"));
  verify(group, GROUP);
  const groupId = group.id;
  if (product === undefined) product = await create(client, "subscriptions", PRODUCT, { group: relationship("subscriptionGroups", groupId) },
    () => list(client, endpoint("subscriptionGroups", groupId, "/subscriptions?limit=200"), "subscriptions"));
  requireDraft(product);
  const productId = product.id;
  const territories = await client.list("/v1/territories?limit=200", "territories");
  const usa = territories.find((territory) => territory.id === "USA");
  if (usa === undefined) throw new Error("Apple territories omit USA");
  verify(usa, { currency: "USD" });
  const points = await pricePoints(client, productId, territories);
  const readPrices = (): Promise<RelatedResource[]> => list(client, endpoint("subscriptions", productId, "/prices?include=territory,subscriptionPricePoint&limit=200"), "subscriptionPrices");
  const readTrials = (): Promise<RelatedResource[]> => list(client, endpoint("subscriptions", productId, "/introductoryOffers?include=territory&limit=200"), "subscriptionIntroductoryOffers");
  const today = new Date().toISOString().slice(0, 10);
  const prices = checkPrices(await readPrices(), points, today);
  const trials = checkTrials(await readTrials(), territories, today);
  const available = await availability(client, productId, territories);
  const productLocales = checkLocales(await localizations(client, "subscriptionLocalizations", "subscriptions", productId), inputs);
  const groupLocales = checkLocales(await localizations(client, "subscriptionGroupLocalizations", "subscriptionGroups", groupId), inputs);
  for (const territory of territories) {
    const relationships = { subscription: relationship("subscriptions", productId), territory: relationship("territories", territory.id) };
    if (!prices.has(territory.id)) await create(client, "subscriptionPrices", { preserveCurrentPrice: false }, {
      ...relationships, subscriptionPricePoint: relationship("subscriptionPricePoints", points.get(territory.id)!.id),
    }, readPrices);
    if (!trials.has(territory.id)) await create(client, "subscriptionIntroductoryOffers", TRIAL, relationships, readTrials);
  }
  for (const input of inputs) {
    await saveLocalization(client, "subscriptionLocalizations", "subscriptions", productId, "subscription", input.locale,
      { name: input.name, description: input.description }, productLocales.get(input.locale));
    await saveLocalization(client, "subscriptionGroupLocalizations", "subscriptionGroups", groupId, "subscriptionGroup", input.locale,
      { name: input.groupName }, groupLocales.get(input.locale));
  }
  if (available === undefined) await create(client, "subscriptionAvailabilities", { availableInNewTerritories: false }, {
    subscription: relationship("subscriptions", productId),
    availableTerritories: { data: territories.map((territory) => ({ type: "territories", id: territory.id })) },
  }, async () => {
    const read = await availability(client, productId, territories);
    return read === undefined ? [] : [read];
  });
  const finalIdentity = await identity(client);
  if (finalIdentity.group?.id !== groupId || finalIdentity.product?.id !== productId) throw new Error("Catalog identity changed during configuration");
  const finalPrices = checkPrices(await readPrices(), points, today);
  const finalTrials = checkTrials(await readTrials(), territories, today);
  if (finalPrices.size !== territories.length || finalTrials.size !== territories.length) throw new Error("Incomplete price or trial readback");
  if (await availability(client, productId, territories) === undefined) throw new Error("Missing availability after creation");
  const finalProductLocales = checkLocales(await localizations(client, "subscriptionLocalizations", "subscriptions", productId), inputs);
  const finalGroupLocales = checkLocales(await localizations(client, "subscriptionGroupLocalizations", "subscriptionGroups", groupId), inputs);
  for (const input of inputs) {
    const localizedProduct = finalProductLocales.get(input.locale);
    const localizedGroup = finalGroupLocales.get(input.locale);
    if (localizedProduct === undefined || localizedGroup === undefined) throw new Error(`Missing readback locale ${input.locale}`);
    verify(localizedProduct, { name: input.name, description: input.description });
    verify(localizedGroup, { name: input.groupName });
  }
  console.log(JSON.stringify({
    event: "apple_subscription_catalog_readback", appId: APP_ID, groupId, subscriptionId: productId,
    product: finalIdentity.product, basePrice: { territory: "USA", currency: "USD", price: "6.99" },
    trial: TRIAL, territories: territories.map((item) => item.id), localizations: inputs,
    state: text(finalIdentity.product!, "state"), submittedForReview: false,
  }, null, 2));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--apply") {
    throw new Error("Post-merge operation only: node scripts/ios/configure-apple-subscription.mts --apply. See docs/apple-subscriptions.md.");
  }
  await configure(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
}
