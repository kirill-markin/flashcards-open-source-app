# Claude connector submission

Submit Nibomo as a remote MCP connector through the
[developer portal](https://claude.ai/directory/manage). Follow Anthropic's current
[submission procedure](https://claude.com/docs/connectors/building/submission)
and [review checklist](https://claude.com/docs/connectors/building/review-criteria).
Community is the default directory label; Anthropic automatically considers
listings for Verified review. A company uses the same submission route.

## Prepare the draft

1. Use [server.json](../server.json) for the name, version, remote endpoint,
   documentation, API documentation, privacy, support and icon URLs. Reuse the
   reviewed English listing copy from
   [chatgpt-app-submission.json](chatgpt-app-submission.json), adapting it to the
   portal's field limits. These files are sources for manual entry, not an
   Anthropic upload format.
2. Wait for the automatically triggered AWS release and its MCP live smoke to
   succeed after merging metadata changes. The smoke exercises the deployed
   tools and verifies both `title` and `annotations.title`. Tool definitions are
   served from the [shared registry](agent-tool-surfaces.md); do not maintain a
   separate Anthropic inventory or change the OpenAI submission to test Claude.
3. Sign in with the intended submitting Claude account and open the portal.
   Connect the endpoint from `server.json` with OAuth dynamic client
   registration. Refresh the connected tools after deployment; confirm all eight
   have titles, with six read-only tools and two destructive write tools.
4. Enter the company and review contact, select the first-party API and both
   read and write use cases, and complete the public listing fields. The slug
   becomes permanent after publication. This server has no MCP App UI; the
   MCP App carousel screenshot requirement does not apply.

## Test the review account

Use only the synthetic account documented in
[review/demo accounts](../infra/aws/README.md#reviewdemo-accounts), with populated
study data. Verify its deployed allowlist and login before promising reviewer
access. Keep the shared sign-in credential and private reviewer instructions
outside repository files; obtain the owner's approval before sharing credentials
with Anthropic.

Exercise the following flow independently in both
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) and a Claude
custom connector. A cloud smoke result does not establish those client checks.
Use separate disposable cards and a unique test tag for each client. In Inspector,
send the tool calls directly; in Claude, ask the assistant to perform the steps.

1. Complete OAuth with the demo account. Call `list_workspaces`, choose its
   populated review workspace and keep that `workspaceId` for the scenario.
2. Call `get_guide` with `sql_dialect`, then `sql_query` with `SHOW TABLES` and a
   separate query reading existing cards. Confirm the seeded study data appears.
3. Call `get_guide` with `card_authoring`. Create two question/answer
   cards with a unique test tag, checking for duplicates first. Approve
   `sql_execute` and verify the saved cards with `sql_query`. Confirm them in the
   first-party app as well.
4. Review one of the new cards through `next_review_card` filtered by the test
   tag. Attempt the question before `reveal_answer`. Use the
   [review procedure](conversational-reviews.md#voice-session-example) for rating
   and `submit_review`, approving the write when Claude asks. Verify the returned
   schedule. In Inspector, submit and then retry the identical review request
   through that same authenticated connection, confirming it reports the existing
   review rather than applying another one. Never retry a Claude submission in
   Inspector: review deduplication is scoped to the authenticated connection, so
   another client's OAuth connection can record a separate review even with the
   same `reviewId`.
5. Call `get_usage_limits` and compare the reported plan and allowance with its
   response. Make no subscription changes.

## Finish with the owner

1. Fill Test & launch with verified demo access and the tested scenario. Include
   every login step and credential privately. Mark client testing complete only
   after actually exercising all eight tools in the clients above.
2. Review every compliance acknowledgment against the live server. Read the
   final summary, warnings and terms with the owner; **do not submit without the
   owner's explicit approval**.
3. After submission, monitor status and feedback in the portal. Rotate reviewer
   access after review according to the review/demo account procedure.
