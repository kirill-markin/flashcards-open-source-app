import { parseObject, parseRequiredField, parseString } from "./core";

/**
 * The web guest session, reduced to the two fields the browser uses: the token that authenticates an
 * analytics batch, and the guest user id the analytics queue records as its owner.
 *
 * Creating one is not free on the server: it writes a guest user, an auto-created workspace and its
 * membership, and nothing removes them. The workspace id the backend returns is deliberately ignored
 * here — the backend refuses the web guest platform on every authenticated surface but analytics
 * ingest, so the browser never reads or writes that workspace, it is never surfaced in the app, and
 * this identity can never become a cloud-sync account. It is an analytics credential that happens to
 * arrive with rows attached, which is why the browser mints one only on a real interaction and only
 * when it can remember it afterwards.
 */
export type WebGuestSessionEnvelope = Readonly<{
  guestToken: string;
  userId: string;
}>;

export function parseWebGuestSessionResponse(value: unknown, endpoint: string): WebGuestSessionEnvelope {
  const objectValue = parseObject(value, endpoint, "");

  return {
    guestToken: parseRequiredField(objectValue, "guestToken", endpoint, "", parseString),
    userId: parseRequiredField(objectValue, "userId", endpoint, "", parseString),
  };
}
