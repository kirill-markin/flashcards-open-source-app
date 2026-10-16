import type { DatabaseExecutor } from "../../db.js";
import type { CognitoEmailPrincipal } from "../cognito/cognitoAuth.js";
import { authHandleHash, type ClaimedAuthAttempt } from "./attemptStore.js";
import { PrincipalEnrollmentError } from "./mailboxProof.js";
import type { ProviderEnrollmentProof } from "./principalEnrollment.js";

export type ProviderEmailEnrollmentOutcome = "linked" | "already_same_account" | "foreign_account";

/** Only the claimed Apple login may advance its own first-account snapshot. */
export async function reconcileAppleLoginEmailInExecutor(
  executor: DatabaseExecutor, attempt: Pick<ClaimedAuthAttempt, "handle" | "claimId" | "provider">,
  proof: ProviderEnrollmentProof, boundSubject: string, principal: CognitoEmailPrincipal,
): Promise<ProviderEmailEnrollmentOutcome> {
  const email = proof.identity.email;
  if (attempt.provider !== "apple" || proof.provider !== "apple"
    || email?.authority !== "provider" || email.privateRelay || email.address !== principal.email
    || /@(privaterelay\.appleid\.com|private\.icloud\.com)$/.test(email.address)) {
    throw new PrincipalEnrollmentError("PROVIDER_ENROLLMENT_CONFLICT");
  }
  const result = await executor.query<Readonly<{ outcome: ProviderEmailEnrollmentOutcome }>>(
    "SELECT auth.enroll_apple_login_email($1,$2,$3,$4,$5,$6,$7) AS outcome",
    [authHandleHash(attempt.handle), attempt.claimId, proof.identity.subject, boundSubject,
      principal.cognitoSubject, principal.cognitoUsername, principal.email],
  );
  const outcome = result.rows[0]?.outcome;
  if (outcome !== "linked" && outcome !== "already_same_account" && outcome !== "foreign_account") {
    throw new Error("Apple Email enrollment returned no recognized outcome");
  }
  return outcome;
}
