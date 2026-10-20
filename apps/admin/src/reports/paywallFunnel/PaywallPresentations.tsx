import { useEffect, useState, type JSX } from "react";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { paywallFirstPaymentWindowDays } from "./attributionQuery";
import {
  loadPaywallPresentationReport,
  type PaywallPresentationGroup,
  type PaywallPresentationReport,
} from "./presentationQuery";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: PaywallPresentationReport }>;

const choiceColumns = [
  ["shownCount", "Impressions"],
  ["freeCount", "Free"],
  ["premiumCount", "Premium clicked"],
  ["dismissedCount", "Dismissed"],
  ["unknownChoiceCount", "No observed choice / unknown"],
  ["checkoutCount", "Checkout requested"],
  ["convertedCount", "Server converted"],
  ["trialCount", "Trial"],
  ["paidCount", "Paid"],
  ["maturingCount", "7-day window open"],
  ["firstPaymentPendingCount", `${paywallFirstPaymentWindowDays}-day payment window open`],
] as const;

const followUpColumns = [
  ["completedCount", "Client completed"],
  ["cancelledCount", "Client cancelled"],
  ["failedCount", "Client failed"],
  ["pendingCount", "Client pending"],
  ["reviewedCount", "Reviewed within 7 days"],
  ["returnedCount", "Opened app after 1–7 days"],
] as const;

type CountKey = (typeof choiceColumns)[number][0] | (typeof followUpColumns)[number][0];

function PresentationTable(props: Readonly<{
  caption: string;
  groups: ReadonlyArray<PaywallPresentationGroup>;
  columns: ReadonlyArray<readonly [CountKey, string]>;
}>): JSX.Element {
  return (
    <div className="funnel-group-table-shell">
      <table className="funnel-group-table">
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Platform / source / review stage / observed exposure / content / linkage</th>
            {props.columns.map(([key, label]) => <th key={key} scope="col">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {props.groups.map((group) => (
            <tr key={JSON.stringify([
              group.platform, group.entryPoint, group.reviewStage,
              group.exposure, group.contentVersion, group.linkage,
            ])}>
              <th scope="row" className="funnel-group-table-name">
                {group.platform} / {group.entryPoint}<br />
                {group.reviewStage} / {group.exposure} / {group.contentVersion} / {group.linkage}
              </th>
              {props.columns.map(([key]) => <td key={key}>{group[key].toLocaleString("en-US")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaywallPresentations(props: FunnelSectionProps): JSX.Element {
  const [revision, setRevision] = useState<number>(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    const abortController = new AbortController();
    void loadPaywallPresentationReport(props.config, props.filters, abortController.signal)
      .then((report) => {
        if (cancelled === false) setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unexpected paywall presentation error.",
        });
      });

    return () => { cancelled = true; abortController.abort(); };
  }, [props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError, revision]);

  const report = props.isRangeLoading === false && state.status === "ready" ? state.report : null;

  return (
    <section aria-label="Paywall presentations">
      <header className="dashboard-section-header">
        <p className="eyebrow">Presentation report</p>
        <h3>Repeated paywall presentations</h3>
      </header>
      <p>Counts presentations, including repeats by the same person, grouped by their own source and stage. Each row&rsquo;s Impressions count is its denominator. Uses the shared filters above; the person funnel&rsquo;s Group by control applies only to its chart.</p>
      {props.isRangeLoading || state.status === "loading" ? <div className="report-state" aria-live="polite">Loading paywall presentations…</div> : null}
      {props.isRangeLoading === false && state.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Presentation query failed.</strong><span>{state.message}</span>
          <button className="filter-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {report !== null ? (
        <>
          {report.groups.length === 0 ? <p className="report-state">No recorded paywall impressions match these filters.</p> : (
            <>
              <PresentationTable caption="Choices and server conversion — presentations" groups={report.groups} columns={choiceColumns} />
              <PresentationTable caption="Client results and subsequent activity — presentations" groups={report.groups} columns={followUpColumns} />
            </>
          )}
          <details className="funnel-explainer">
            <summary>Presentation attribution and observation windows</summary>
            <div className="funnel-detail-row funnel-explainer-figure">
              <span>Flow events in the selected dates without a matching impression</span>
              <strong>{report.unlinkedFlowCount.toLocaleString("en-US")}</strong>
            </div>
            <p>One impression is one trusted <code>paywall_shown</code>. Repeated rows with the same presentation UUID and canonical actor count once at their earliest time. A legacy row without a UUID counts as its own impression. First, second and third+ mean observed exposure across that person&rsquo;s retained paywall history, before filtering dates or platforms; they cannot recover unrecorded history. Missing review stage or content version stays unknown.</p>
            <p>Choices, checkout requests and client results require the same canonical actor, presentation UUID and platform, a matching entry point when reported, and a time from the impression through seven days later. A legacy flow event without a UUID instead matches the same actor&rsquo;s latest preceding legacy impression on its platform. Free and dismissed require their explicit choice event. No choice means unknown, including legacy rows; it does not imply dismissal or choosing free. Unmatched flow events above remain unattributed, including UUIDs without an impression and events outside that window.</p>
            <p>Server converted counts a presentation once when it is credited a server <code>trial_started</code> or <code>purchase_completed</code>. Each fact selects the same actor&rsquo;s latest preceding checkout request within fourteen days, which spans the seven-day free trial to its first payment, matching Apple to iOS, Google to Android and Stripe to web. It receives credit only if that checkout links to an impression; an unlinked checkout cannot fall back to an older linked one. A standard offer cannot receive a trial fact. Credit is decided across presentations before filters, so a fact cannot move to another presentation when dates or platforms change. This is temporal provider attribution, not a transaction-level link between client and server events.</p>
            <p>These columns are independent observations, unlike the sequenced person funnel: a recorded checkout or server conversion can appear here with a missing Premium choice. Checkout requested does not prove a provider sheet appeared or the request succeeded. Trial and Paid can overlap and must not be added; a payment does not require a trial. Client completed is a client result, never proof of a sale.</p>
            <p>These billing facts come from the production-only provider producers; sandbox sales do not enter them. Trusted canonical actors and the shared test, admin, automation and exclusion rules apply. Billing facts without a relevant linked checkout receive no presentation credit. Opted-out or missing client analytics cannot be reconstructed from billing facts.</p>
            <p>Reviewed means at least one server <code>review_answered</code> after the impression and within seven days. Returned means a trusted <code>app_opened</code> from 24 hours through seven days after it. These are observations on any device and any deck, not caused-by-paywall claims; overlapping presentation windows can share activity. Counts describe presentations with each fact, not event totals, and choices or client results can overlap after retries.</p>
            <p>Follow-ups can occur after the selected end date. An open seven-day window is right-censored, never a confirmed drop-off. Server converted, Trial and Paid can still gain credit until the {paywallFirstPaymentWindowDays}-day payment window closes: seven days to checkout, then fourteen for billing. Offline activity and delayed billing delivery can change past results after these windows close; billing attribution uses the fact&rsquo;s occurrence time rather than arrival time. Absence of a retained event is not proof that a person stopped using the app.</p>
          </details>
        </>
      ) : null}
    </section>
  );
}
