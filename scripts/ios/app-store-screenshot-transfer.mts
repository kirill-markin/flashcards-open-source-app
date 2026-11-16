import { object, request, string } from "./app-store-connect-client.mts";
import type { Json } from "./app-store-connect-client.mts";

export async function transferScreenshotBytes(reservationId: string, operations: Json | undefined, bytes: Buffer): Promise<void> {
  const screenshot = `Screenshot ${reservationId}`;
  if (!Array.isArray(operations) || operations.length === 0) throw new Error(`${screenshot}: missing upload operations`);
  const ordered = operations.map((item) => {
    const operation = object(item, `${screenshot} upload operation`);
    const { offset } = operation;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset)) throw new Error(`${screenshot}: invalid upload offset`);
    return { operation, offset };
  }).sort((left, right) => left.offset - right.offset);

  let uploadedBytes = 0;
  for (const { operation, offset } of ordered) {
    const { length } = operation;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length <= 0
      || offset !== uploadedBytes || offset + length > bytes.length) {
      throw new Error(`${screenshot}: invalid upload byte range (offset ${offset}, expected offset ${uploadedBytes} within ${bytes.length} bytes)`);
    }
    const end = offset + length;
    const chunk = `${screenshot} bytes ${offset}–${end}`;
    const url = URL.parse(string(operation.url, `${chunk} upload URL`));
    if (url === null) throw new Error(`${chunk}: invalid upload URL`);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".apple.com")) throw new Error(`${chunk}: unexpected upload host`);
    if (operation.method !== "PUT" || !Array.isArray(operation.requestHeaders)) throw new Error(`${chunk}: invalid upload instructions`);
    const headers = Object.fromEntries(operation.requestHeaders.map((item) => {
      const header = object(item, `${chunk} upload header`);
      return [string(header.name, `${chunk} upload header name`), string(header.value, `${chunk} upload header value`)];
    }));
    await request(url.href, "PUT", headers, bytes.subarray(offset, end), `Upload ${chunk}`);
    uploadedBytes = end;
  }
  if (uploadedBytes !== bytes.length) throw new Error(`${screenshot}: upload operations did not cover the full file (${uploadedBytes}/${bytes.length} bytes)`);
}
