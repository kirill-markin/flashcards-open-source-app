import { assertAppleRevocationClearInExecutor } from "./appleCredential.js";
import type { DatabaseExecutor } from "../../db.js";
import type { IdentityProvider } from "./identityStore.js";
import type { CognitoEmailPrincipal } from "../cognito/cognitoAuth.js";

export type ProviderLoginMethod = Readonly<{
  provider: IdentityProvider;
  providerSubject: string;
  cognitoSubject: string;
  cognitoUsername: string;
  status: "active" | "disabled";
  recoveryEmail: string;
}>;

export async function registerProvedEmailPrincipalInExecutor(
  executor: DatabaseExecutor, principal: CognitoEmailPrincipal, verifiedAt: Date,
): Promise<void> {
  await executor.query("SELECT auth.enroll_proved_email_principal($1, $2, $3, $4)", [
    principal.cognitoSubject, principal.cognitoUsername, principal.email, verifiedAt,
  ]);
}

type ProviderMethodRow = Readonly<{
  provider_type: IdentityProvider;
  provider_subject: string;
  cognito_subject: string;
  cognito_username: string;
  status: "active" | "disabled";
  recovery_email: string;
}>;

function toProviderMethod(row: ProviderMethodRow): ProviderLoginMethod {
  return {
    provider: row.provider_type, providerSubject: row.provider_subject, cognitoSubject: row.cognito_subject,
    cognitoUsername: row.cognito_username, status: row.status, recoveryEmail: row.recovery_email,
  };
}

export async function loadProviderLoginMethodInExecutor(
  executor: DatabaseExecutor, provider: IdentityProvider, providerSubject: string,
): Promise<ProviderLoginMethod | null> {
  const result = await executor.query<ProviderMethodRow>(
    "SELECT * FROM auth.load_provider_login_method($1, $2)", [provider, providerSubject],
  );
  if (provider === "apple" && result.rows[0] !== undefined) await assertAppleRevocationClearInExecutor(executor, providerSubject);
  return result.rows[0] === undefined ? null : toProviderMethod(result.rows[0]);
}

/** Repeated provider proof never re-enables a disabled method or moves its recovery mailbox. */
export async function activateProvedProviderMethodInExecutor(
  executor: DatabaseExecutor, provider: IdentityProvider, providerSubject: string,
  principal: CognitoEmailPrincipal,
): Promise<ProviderLoginMethod> {
  await executor.query("SELECT auth.activate_proved_provider_method($1, $2, $3, $4)", [
    provider, providerSubject, principal.cognitoSubject, principal.email,
  ]);
  const method = await loadProviderLoginMethodInExecutor(executor, provider, providerSubject);
  if (method === null) throw new Error("Provider method activation returned no method");
  return method;
}
