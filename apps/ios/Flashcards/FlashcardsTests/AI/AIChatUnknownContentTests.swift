import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import Flashcards

final class AIChatUnknownContentTests: XCTestCase {
    func testDecodeSnapshotWithUnknownContentFallsBackToUnknown() throws {
        let payload = """
        {
          "sessionId": "session-1",
          "conversationScopeId": "session-1",
          "conversation": {
            "updatedAt": 100,
            "mainContentInvalidationVersion": 200,
            "messages": [
              {
                "role": "assistant",
                "content": [
                  {
                    "type": "audio",
                    "url": "https://example.com/audio.mp3",
                    "durationMs": 1234
                  }
                ],
                "timestamp": 1000,
                "isError": false,
                "isStopped": false,
                "cursor": "cursor-1",
                "itemId": "item-1"
              }
            ],
            "hasOlder": false,
            "oldestCursor": null
          },
          "composerSuggestions": [],
          "chatConfig": {
            "provider": { "id": "openai", "label": "OpenAI" },
            "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
            "reasoning": { "effort": "medium", "label": "Medium" },
            "features": {
              "modelPickerEnabled": false,
              "dictationEnabled": true,
              "attachmentsEnabled": true
            },
            "liveUrl": null
          },
          "activeRun": null
        }
        """

        let wire = try makeFlashcardsRemoteJSONDecoder().decode(
            AIChatSessionSnapshotWire.self,
            from: Data(payload.utf8)
        )
        let snapshot = mapConversationEnvelope(wire)
        let message = try XCTUnwrap(snapshot.conversation.messages.first)
        let part = try XCTUnwrap(message.content.first)

        guard case .unknown(let unknownPart) = part else {
            return XCTFail("Expected unknown content part.")
        }

        XCTAssertEqual(unknownPart.originalType, "audio")
        XCTAssertEqual(unknownPart.summaryText, "Unsupported content (type: audio)")
        XCTAssertTrue(unknownPart.rawPayloadJSON?.contains("\"type\":\"audio\"") == true)
    }

    func testDecodeLiveAssistantMessageDoneWithUnknownContentFallsBackToUnknown() throws {
        let event = try XCTUnwrap(decodeAIChatLiveEvent(
            eventType: "assistant_message_done",
            payload: """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "15",
              "sequenceNumber": 7,
              "streamEpoch": "epoch-1",
              "itemId": "item-1",
              "content": [
                {
                  "type": "checklist",
                  "items": ["a", "b"]
                }
              ],
              "isError": false,
              "isStopped": true
            }
            """
        ))

        guard case .assistantMessageDone(
            metadata: _,
            itemId: _,
            content: let content,
            isError: _,
            isStopped: _
        ) = event else {
            return XCTFail("Expected assistant_message_done event.")
        }

        let part = try XCTUnwrap(content.first)
        guard case .unknown(let unknownPart) = part else {
            return XCTFail("Expected unknown content part.")
        }

        XCTAssertEqual(unknownPart.originalType, "checklist")
        XCTAssertEqual(unknownPart.summaryText, "Unsupported content (type: checklist)")
        XCTAssertTrue(unknownPart.rawPayloadJSON?.contains("\"type\":\"checklist\"") == true)
    }

    func testHistoryStoreRoundTripsUnknownContentAndDraftAttachment() async {
        let suiteName = "ai-chat-unknown-content-\(UUID().uuidString)"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let store = AIChatHistoryStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        store.activateWorkspace(workspaceId: "workspace-1")

        let unknownContent = AIChatUnknownContentPart(
            originalType: "timeline",
            summaryText: "Unsupported content (type: timeline)",
            rawPayloadJSON: #"{"type":"timeline","events":[1,2]}"#
        )
        let unknownAttachment = AIChatUnknownAttachmentPayload(
            originalType: "voice_note",
            summaryText: "Unsupported attachment (type: voice_note)",
            rawPayloadJSON: #"{"type":"voice_note","durationMs":1200}"#
        )

        let state = AIChatPersistedState(
            messages: [
                AIChatMessage(
                    id: "message-1",
                    role: .assistant,
                    content: [.unknown(unknownContent)],
                    timestamp: "2026-04-07T10:00:00Z",
                    isError: false,
                    isStopped: true,
                    cursor: "cursor-1",
                    itemId: "item-1"
                )
            ],
            chatSessionId: "session-1",
            lastKnownChatConfig: nil,
            pendingToolRunPostSync: false
        )

        await store.saveState(state: state)
        let loadedState = store.loadState()
        XCTAssertEqual(loadedState, state)

        let draft = AIChatComposerDraft(
            inputText: "draft",
            pendingAttachments: [
                AIChatAttachment(
                    id: "attachment-1",
                    payload: .unknown(unknownAttachment)
                )
            ]
        )

        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: "session-1",
            draft: draft
        )
        let loadedDraft = store.loadDraft(workspaceId: "workspace-1", sessionId: "session-1")
        XCTAssertEqual(loadedDraft, draft)
    }

    func testUnknownContentPlaceholderUsesExpectedText() {
        let content = AIChatUnknownContentPart(
            originalType: "audio",
            summaryText: "Unsupported content (type: audio)",
            rawPayloadJSON: nil
        )

        XCTAssertEqual(aiChatUnknownContentPlaceholderTitle(), "Unsupported content")
        XCTAssertEqual(aiChatUnknownContentPlaceholderSubtitle(content: content), "Type: audio")
    }
}
