# Claude connector submission

Submit Nibomo as a remote MCP connector through the
[developer portal](https://claude.ai/directory/manage). Follow Anthropic's current
[submission procedure](https://claude.com/docs/connectors/building/submission)
and [review checklist](https://claude.com/docs/connectors/building/review-criteria).
Community is the default directory label; Anthropic automatically considers
listings for Verified review. A company uses the same submission route. Updates
to the existing listing follow the
[Anthropic release gate](release/mcp-and-plugins.md#anthropic-connector-and-plugin).

## Prepare the draft

1. Use [claude-connector-submission.json](claude-connector-submission.json) for
   the English listing, use cases, approved company/contact, authentication,
   data-handling facts and public reviewer walkthrough. It is a secret-free
   source for **manual portal entry**, not an Anthropic upload schema.
   [Companion server.json](https://github.com/kirill-markin/nibomo-plugins/blob/main/server.json)
   owns the current version, remote endpoint and public URLs; reconcile those
   before entry instead of adding another version.
2. Confirm the deployed tools after any metadata change and wait for the
   automatically triggered AWS release and MCP live smoke to succeed. Both
   `title` and `annotations.title` must appear. The [shared registry](agent-tool-surfaces.md)
   owns tool definitions; sync them from the server in the portal instead of
   maintaining an Anthropic inventory or changing the OpenAI submission.
3. Sign in with the submitting personal paid Claude account, which the JSON's
   `company.submitter_note` keeps separate from the approved company and review
   contact. Connect `https://mcp.nibomo.com/mcp` with OAuth dynamic client
   registration, refresh the connected tools, and confirm they and their
   annotations match `MCP_TOOL_PRESENTATION` in
   [`mcp/server.ts`](../apps/backend/src/mcp/server.ts).
4. Enter the listing within the limits in the JSON's `listing_entry_notes`,
   confirming the permanent `nibomo` slug before submission.
5. Fill the remaining portal steps from the JSON copy. Review data-handling
   explanations in full, including operational telemetry and error reporting;
   do not turn a narrow implementation fact into a blanket compliance claim.

## Verify reviewer access and client testing

Use [connector submission operations](connector-submission-operations.md) for
reviewer provisioning, deployed allowlist verification, private access delivery
and cleanup. The demo email itself grants browser access, so public copy uses
only `<reviewer-email>`; supply it privately only after owner approval.

The JSON's `test_and_launch.client_testing` and
`test_and_launch.reviewer_demo_status` record what has been verified; client
tests and the cloud smoke are separate evidence, and neither proves reviewer
access. Run its `test_and_launch.walkthrough` against the populated synthetic
reviewer account independently in MCP Inspector and a Claude custom connector
before claiming it is ready, with separate disposable cards and unique tags for
each client. In Inspector, send tool calls directly; in Claude, ask the
assistant to perform the same flow.

Retry an uncertain review only with the complete payload on the **same
authenticated connection**. A review dedupes within its connection's sync
replica ([agent tool surfaces](agent-tool-surfaces.md#the-registry-is-the-inventory)),
so replaying a Claude review through Inspector can record a second review with
the same `reviewId`.

## Finish with the owner

1. Fill Test & launch only with verified reviewer access and the actual test
   evidence. Replace placeholders privately; do not paste unverified readiness
   claims or owner-workspace identifiers into reviewer instructions.
2. Read the final portal summary, warnings and all compliance acknowledgments
   with the owner. The JSON contains factual drafts, not accepted terms. **Do
   not accept acknowledgments, share reviewer access or submit without the
   owner's explicit approval after joint review.**
3. After authorized submission, monitor status and feedback in the portal.
   Retire or rotate reviewer access using the canonical operations procedure.
