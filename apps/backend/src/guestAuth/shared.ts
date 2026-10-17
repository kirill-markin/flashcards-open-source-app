import { createHash } from "node:crypto";

// Binding time belongs to the immutable original client owner, even after account union.
export const guestSessionBindingExpiredSql = `EXISTS (
  SELECT 1 FROM auth.user_identities
  WHERE user_identities.provider_type = 'cognito'
    AND user_identities.original_client_user_id = guest_sessions.user_id
    AND user_identities.created_at < now() - interval '7 days'
)`;

// $1 is the credential session; $2 is its trusted owner under the current survivor scope.
export const activeGuestSessionOwnerPredicateSql = `session_id = $1::uuid
  AND auth.canonical_account_id(guest_sessions.user_id) = $2
  AND $2 = security.current_user_id()
  AND revoked_at IS NULL
  AND NOT ${guestSessionBindingExpiredSql}
  AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = $2)
  AND NOT EXISTS (SELECT 1 FROM auth.deleted_accounts
    WHERE user_id_sha256 IN (
      encode(sha256(convert_to(guest_sessions.user_id, 'UTF8')), 'hex'),
      encode(sha256(convert_to($2, 'UTF8')), 'hex')
    ))`;

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function hashGuestToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}
