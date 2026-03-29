# Langfuse Operations

Use this guide after enabling Langfuse in `flashcards-open-source-app` to confirm that telemetry is healthy for the modern backend-owned AI flows.

## Covered surfaces

- persisted `/chat` runs export one trace per user turn with trace name `chat_turn`
- `/chat/transcriptions` exports one trace per dictation request with trace name `chat_transcription`

## Required configuration

When Langfuse is enabled, the backend Lambda family needs all of these values together:

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`

If only part of the Langfuse config is present, backend startup validation fails.

## Expected chat trace shape

For each backend-owned `/chat` turn, expect:

- trace name `chat_turn`
- `sessionId` equal to the persisted chat session id
- `userId` equal to the authenticated app user id
- tags `surface:backend-chat`, `runtime:worker-loop`, and `vendor:openai`
- metadata including `requestId`, `workspaceId`, `model`, `turnIndex`, `hasAttachments`, `attachmentCount`, and `runState`

If the turn uses tools, expect nested tool observations under the same trace.

## Expected transcription trace shape

For each `/chat/transcriptions` request, expect:

- trace name `chat_transcription`
- tags `surface:chat-transcription`, `runtime:backend-route`, and `vendor:openai`
- metadata including `requestId`, `userId`, `source`, `fileName`, `mediaType`, and `fileSize`

Raw audio bytes and attachment `base64Data` must not appear in the exported custom observation input.

## First smoke check

1. Send one normal `/chat` message through the web or mobile app.
2. Confirm a `chat_turn` trace appears with the expected tags and metadata.
3. Send one dictation request through `/chat/transcriptions`.
4. Confirm a `chat_transcription` trace appears with the expected tags and metadata.

## Troubleshooting

If traces do not appear:

- confirm both Langfuse secrets exist in AWS Secrets Manager
- confirm `CDK_LANGFUSE_PUBLIC_KEY_SECRET_ARN` and `CDK_LANGFUSE_SECRET_KEY_SECRET_ARN` are present in GitHub variables when deploying through CI
- confirm the deployed backend Lambdas have all `LANGFUSE_*` environment values
- check Lambda logs for `langfuse_chat_turn_start_failed`, `langfuse_chat_turn_export_failed`, `langfuse_chat_transcription_start_failed`, or `langfuse_chat_transcription_export_failed`

If traces appear but are incomplete:

- confirm the trace tags match the expected surface and runtime values
- confirm `sessionId` is present for `chat_turn`
- confirm file uploads show redacted metadata instead of raw `base64Data`
