// Strip proof fragments before observability or application modules read the initial URL.
export type AccountMethodReturn = Readonly<{ status: string; connection: boolean; completion: string | null; code: string | null; linkOutcome: "linked" | "already_linked" | null }>;
function readReturn(): AccountMethodReturn | null {
  if (window.location.pathname !== "/settings/account-status" || window.location.hash === "") return null;
  const query = new URLSearchParams(window.location.search);
  const connection = query.get("account_connection") === "1";
  const fields = new URLSearchParams(window.location.hash.slice(1));
  const status = fields.get("status");
  if (status !== "reauthenticated" && status !== "account_method_completed"
    && status !== "account_method_failed" && status !== "account_method_cancelled" && !fields.has("completion") && !connection) return null;
  query.delete("account_connection");
  window.history.replaceState(window.history.state, "", window.location.pathname + (query.size === 0 ? "" : "?" + query.toString()));
  const completion = fields.get("completion");
  return { status: status ?? "account_method_failed", connection, completion: completion !== null && /^[A-Za-z0-9_-]{43}$/.test(completion) ? completion : null,
    linkOutcome: fields.get("link_outcome") === "linked" ? "linked" : fields.get("link_outcome") === "already_linked" ? "already_linked" : null,
    code: fields.get("code")?.match(/^[A-Z_]{1,64}$/)?.[0] ?? null };
}
let returned = readReturn();
export function readAccountMethodReturn(): AccountMethodReturn | null { return returned; }
export function clearAccountMethodReturn(): void { returned = null; }
