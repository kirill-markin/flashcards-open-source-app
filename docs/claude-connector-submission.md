# Claude connector submission

Submit Nibomo as a remote MCP connector through the
[developer portal](https://claude.ai/directory/manage). Follow Anthropic's current
[submission procedure](https://claude.com/docs/connectors/building/submission)
and [review checklist](https://claude.com/docs/connectors/building/review-criteria).
Community is the default directory label; Anthropic automatically considers
listings for Verified review. A company uses the same submission route.

## Prepare the draft

1. Use [claude-connector-submission.json](claude-connector-submission.json) for
   the English listing, use cases, approved company/contact, authentication,
   data-handling facts and public reviewer walkthrough. It is a secret-free
   source for **manual portal entry**, not an Anthropic upload schema.
   [server.json](../server.json) owns the current version, remote endpoint and
   public URLs; reconcile those before entry instead of adding another version.
2. Confirm the deployed tools after any metadata change and wait for the
   automatically triggered AWS release and MCP live smoke to succeed. Both
   `title` and `annotations.title` must appear. The [shared registry](agent-tool-surfaces.md)
   owns tool definitions; sync them from the server in the portal instead of
   maintaining an Anthropic inventory or changing the OpenAI submission.
3. Sign in with the intended submitting personal paid Claude account. That
   account is separate from the approved company, SAMO DANNI EOOD, and review
   contact, Kirill Markin / kirill@kirill-markin.com. Connect
   `https://mcp.nibomo.com/mcp` with OAuth dynamic client registration and refresh
   the connected tools. Confirm eight tools: six read-only and two destructive
   writes.
4. Enter the listing within the current limits: name 100 characters, one-liner
   200, description 2000, and one to five categories. Select Education and
   Productivity if available; use the supplied author name/URL if an override
   is needed. Confirm `nibomo` before submission because the slug becomes
   permanent. This connector has no MCP App UI, so the MCP App carousel
   requirement does not apply and no video is required.
5. Fill the remaining portal steps from the JSON copy. Review data-handling
   explanations in full, including operational telemetry and error reporting;
   do not turn a narrow implementation fact into a blanket compliance claim.

## Verify reviewer access and client testing

Use [connector submission operations](connector-submission-operations.md) for
reviewer provisioning, deployed allowlist verification, private access delivery
and cleanup. Keep all active reviewer identifiers and credentials out of this
repository. The demo email itself grants browser access; public copy uses only
`<reviewer-email>`. Supply it privately only after owner approval.

All eight tools have been exercised independently in MCP Inspector and a Claude
custom connector on disposable cards in the owner's test workspace. **The
Anthropic reviewer demo account has not yet been verified.** Those client tests
and the cloud smoke are separate evidence; neither proves reviewer access.

Run the JSON's `test_and_launch.walkthrough` against the populated synthetic
reviewer account independently in both clients before claiming it is ready.
Use separate disposable cards and unique tags for each client. In Inspector,
send tool calls directly; in Claude, ask the assistant to perform the same flow.
The walkthrough covers every tool, authoring readback in the first-party app,
and a question-first review with a manually chosen rating.

For retries, preserve the complete review payload and use the **same
authenticated connection**. An already-recorded review returns
`REVIEW_EVENT_CONFLICT` and the current schedule. Never replay a Claude review
through Inspector: another OAuth connection can record a separate review with
the same `reviewId`. See the [review procedure](conversational-reviews.md#voice-session-example).

## Finish with the owner

1. Fill Test & launch only with verified reviewer access and the actual test
   evidence. Replace placeholders privately; do not paste unverified readiness
   claims or owner-workspace identifiers into reviewer instructions.
2. Read the final portal summary, warnings and all seven compliance
   acknowledgments with the owner. The JSON contains factual drafts, not
   accepted terms. **Do not accept acknowledgments, share reviewer access or
   submit without the owner's explicit approval after joint review.**
3. After authorized submission, monitor status and feedback in the portal.
   Retire or rotate reviewer access using the canonical operations procedure.
