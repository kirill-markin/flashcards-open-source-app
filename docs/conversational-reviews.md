# Conversational reviews over MCP, the in-app chat, and the Agent API

An MCP-capable voice client, the in-app chat, or an Agent API caller reviews
one question at a time: it asks the front, assesses the learner's attempt
against the back, explains any gaps, and submits a rating without asking the
learner to rate every card. The calling agent performs the assessment; the
backend only accepts its rating and advances the card's FSRS schedule. SQL can
write neither review history nor scheduler state.

**External limitation:** ChatGPT Voice currently does not invoke apps/MCP. These
tools serve clients that can call tools during a voice conversation; this
repository implements no microphone, speech recognition, speech synthesis, or
ChatGPT Voice integration.

## Contract

- Tools and routes: the `next_review_card`, `reveal_answer` and `submit_review`
  registry specs ([agent tool surfaces](agent-tool-surfaces.md)) and
  `POST /v1/agent/reviews/next`, `/reveal` and `/submit` in
  [`routes/agent.ts`](../apps/backend/src/routes/agent.ts).
- Arguments, ratings and tool descriptions:
  [`reviewContract.ts`](../apps/backend/src/agent/reviewContract.ts). What the
  agent must do, including grading, retries, both `409` codes and when to stop,
  is `REVIEW_FLOW_INSTRUCTIONS` there, served as `get_guide` topic `review_flow`
  and returned with every REST review result; on MCP and the chat,
  `SUBMIT_REVIEW_DESCRIPTION` points the model at that topic.
- Queue order: the apps' order, in
  [review queue presentation](fsrs-scheduling-logic.md#review-queue-presentation).
- Queue reads, the write, deduplication and conflicts:
  [`agent/reviews.ts`](../apps/backend/src/agent/reviews.ts). Which sync replica
  a `reviewId` is scoped to differs by surface, as
  [agent tool surfaces](agent-tool-surfaces.md#the-registry-is-the-inventory)
  states.

## Verification

- Backend: `npm test`, `npm run lint`, `npm run test:mcp`, and
  `npm run test:postgres-integration` with an isolated PostgreSQL 18
  administrative URL in `POSTGRES_INTEGRATION_ADMIN_URL`.
- Deployed: [`check-mcp-smoke.sh`](../scripts/checks/check-mcp-smoke.sh) checks
  the tool inventory, then runs one real review over MCP with no model in the
  loop, its repeated submission included.

### Manual voice smoke

After deployment, with a voice-capable client and one disposable card for each
rating:

1. Call `list_workspaces`, choose the workspace, and call `next_review_card`.
2. Speak only `data.card.frontText` and wait for the learner's attempt.
3. Let the agent call `reveal_answer`, explain what was right and missing, and
   announce its rating with a short reason, for example: "You got the main idea,
   but missed the essential condition. I'll mark Again so we revisit it soon."
4. Verify it submits without asking for a rating and waits for success before
   requesting the next question, and that a null `card` ends the session.

Across the cards, include equivalent wording, a missing essential fact, an
ambiguous transcript, a skip, and a request for manual ratings. Retry each exact
submission by asking the agent to resend the identical call over the same client
and connection ([dedup scope](agent-tool-surfaces.md#the-registry-is-the-inventory)),
and verify that `reps` increases once, that the conflict response
reports the same schedule as the original success, that the answer is not
spoken early, and that the first-party app shows the updated card after sync.
This smoke evaluates the calling agent's judgment; the backend tests cover the
published contract.
