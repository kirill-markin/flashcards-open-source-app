import { randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../../database";
import type { ChallengeFailureReason, GuestChallengeFlag, GuestChallengeRequestFacts } from "./challengeRisk";

export type GuestBrowserCheckRecord = Readonly<{
  outcome: "allowed" | "required" | "passed" | "failed" | "bypassed";
  flags: ReadonlyArray<GuestChallengeFlag>;
  facts: GuestChallengeRequestFacts;
  failureReason: ChallengeFailureReason | null;
  turnstileErrorCodes: ReadonlyArray<string> | null;
  guestUserId: string | null;
}>;

/** Stores one row of analytics.guest_browser_checks (db/migrations/0242_guest_browser_checks.sql). */
export async function insertGuestBrowserCheckInExecutor(
  executor: DatabaseExecutor,
  record: GuestBrowserCheckRecord,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO analytics.guest_browser_checks (",
      "check_id, outcome, flags, network_asn, user_agent_chrome_major, client_hint_chromium_major,",
      "current_chromium_major, failure_reason, turnstile_error_codes, guest_user_id",
      ") VALUES ($1::uuid, $2::text, $3::text[], $4::bigint, $5::smallint, $6::smallint,",
      "$7::smallint, $8::text, $9::text[], $10::uuid)",
    ].join(" "),
    [
      randomUUID(),
      record.outcome,
      record.flags,
      record.facts.networkAsn,
      record.facts.userAgentChromeMajor,
      record.facts.clientHintChromiumMajor,
      record.facts.currentChromiumMajor,
      record.failureReason,
      record.turnstileErrorCodes,
      record.guestUserId,
    ],
  );
}
