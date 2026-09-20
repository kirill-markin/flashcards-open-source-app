/**
 * The web guest session earlier builds of this app obtained and stored, reduced to the two fields
 * the browser uses: the token the sign-in link presents, and the guest user id it was issued for.
 *
 * This app no longer asks for one. A signed-out browser is measured under the shared visitor
 * identity through the credential-free collector (docs/anonymous-client-analytics.md), so nothing
 * here needs a server-side guest user, workspace and membership to exist. An envelope still in a
 * browser's storage is bound to the account at its next sign-in and dropped there.
 */
export type WebGuestSessionEnvelope = Readonly<{
  guestToken: string;
  userId: string;
}>;
