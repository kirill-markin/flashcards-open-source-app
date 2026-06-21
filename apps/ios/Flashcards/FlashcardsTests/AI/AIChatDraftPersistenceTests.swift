import Foundation
import XCTest
@testable import Flashcards

final class AIChatDraftPersistenceTests: XCTestCase {
    func testLegacyCardPayloadEffortDecodingAddsCompatibilityTags() throws {
        let attachment = try JSONDecoder().decode(
            AIChatAttachment.self,
            from: Data(
                """
                {
                  "id": "attachment-1",
                  "payload": {
                    "type": "card",
                    "cardId": "card-1",
                    "frontText": "Front",
                    "backText": "Back",
                    "tags": ["existing"],
                    "effortLevel": "medium"
                  }
                }
                """.utf8
            )
        )
        let contentPart = try JSONDecoder().decode(
            AIChatContentPart.self,
            from: Data(
                """
                {
                  "type": "card",
                  "cardId": "card-2",
                  "frontText": "Front",
                  "backText": "Back",
                  "tags": ["topic"],
                  "effortLevel": "long"
                }
                """.utf8
            )
        )

        guard case .card(let attachmentCard) = attachment.payload else {
            return XCTFail("Expected a card attachment.")
        }
        guard case .card(let contentCard) = contentPart else {
            return XCTFail("Expected a card content part.")
        }

        XCTAssertEqual(attachmentCard.tags, ["existing", "medium"])
        XCTAssertEqual(contentCard.tags, ["topic", "long"])
    }

    func testAIChatMakeAttachmentFromFileNormalizesCsvMediaType() throws {
        let directoryUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent("ai-chat-attachment-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directoryUrl,
            withIntermediateDirectories: true
        )
        defer {
            try? FileManager.default.removeItem(at: directoryUrl)
        }
        let fileUrl = directoryUrl.appendingPathComponent("deck.csv")
        try Data("front,back".utf8).write(to: fileUrl)

        let attachment = try aiChatMakeAttachmentFromFile(url: fileUrl)

        guard case .binary(let fileName, let mediaType, let base64Data) = attachment.payload else {
            return XCTFail("Expected a binary attachment.")
        }
        XCTAssertEqual(fileName, "deck.csv")
        XCTAssertEqual(mediaType, "text/csv")
        XCTAssertEqual(base64Data, "ZnJvbnQsYmFjaw==")
    }

    func testAIChatMakeAttachmentFromFileNormalizesXmlMediaType() throws {
        let directoryUrl = FileManager.default.temporaryDirectory
            .appendingPathComponent("ai-chat-attachment-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directoryUrl,
            withIntermediateDirectories: true
        )
        defer {
            try? FileManager.default.removeItem(at: directoryUrl)
        }
        let fileUrl = directoryUrl.appendingPathComponent("cards.xml")
        try Data("<cards />".utf8).write(to: fileUrl)

        let attachment = try aiChatMakeAttachmentFromFile(url: fileUrl)

        guard case .binary(let fileName, let mediaType, let base64Data) = attachment.payload else {
            return XCTFail("Expected a binary attachment.")
        }
        XCTAssertEqual(fileName, "cards.xml")
        XCTAssertEqual(mediaType, "text/xml")
        XCTAssertEqual(base64Data, "PGNhcmRzIC8+")
    }

    func testAIChatHistoryStorePersistsDraftsOnlyForExplicitSessionIdsAndPrunesEmptyDrafts() async {
        let suiteName = "ai-chat-draft-persistence-\(UUID().uuidString)"
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

        let card = AIChatCardReference(
            cardId: "card-1",
            frontText: "Front",
            backText: "Back",
            tags: ["tag-1"],
        )
        let pendingDraft = AIChatComposerDraft(
            inputText: "pending draft",
            pendingAttachments: [
                AIChatAttachment(
                    id: "attachment-1",
                    payload: .card(card)
                )
            ]
        )

        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: nil,
            draft: pendingDraft
        )
        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: nil),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: "session-1"),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )

        let sessionDraft = AIChatComposerDraft(
            inputText: "session draft",
            pendingAttachments: []
        )
        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: "session-1",
            draft: sessionDraft
        )
        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: "session-1"),
            sessionDraft
        )

        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: "session-1",
            draft: AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: "session-1"),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
    }

    func testAIChatHistoryStoreIgnoresNilSessionDraftStorage() async {
        let suiteName = "ai-chat-draft-persistence-\(UUID().uuidString)"
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

        let draft = AIChatComposerDraft(inputText: "draft", pendingAttachments: [])

        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: nil,
            draft: draft
        )

        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: nil),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertFalse(
            userDefaults.dictionaryRepresentation().keys.contains("ai-chat-draft::workspace-1")
        )
    }

    func testAIChatResolvedSessionIdKeepsMissingWorkspaceSessionIdEmpty() {
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: "workspace-1",
            sessionId: ""
        )

        XCTAssertEqual(resolvedSessionId, "")
    }

    func testAIChatResolvedSessionIdKeepsNoWorkspaceSessionIdEmpty() {
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: nil,
            sessionId: ""
        )

        XCTAssertEqual(resolvedSessionId, "")
    }

    func testAIChatShouldReuseCurrentSessionForHandoffRequiresEmptyMessagesDraftAndIdleComposer() {
        let emptyDraft = AIChatComposerDraft(inputText: "", pendingAttachments: [])
        let cardDraft = AIChatComposerDraft(
            inputText: "",
            pendingAttachments: [
                AIChatAttachment(
                    id: "attachment-1",
                    payload: .card(
                        AIChatCardReference(
                            cardId: "card-1",
                            frontText: "Front",
                            backText: "Back",
                            tags: [],
                        )
                    )
                )
            ]
        )

        XCTAssertTrue(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: emptyDraft,
                composerPhase: .idle,
                activeRunId: nil,
                currentSessionId: "session-1"
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: emptyDraft,
                composerPhase: .idle,
                activeRunId: nil,
                currentSessionId: ""
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [AIChatMessage(
                    id: "message-1",
                    role: .user,
                    content: [.text("hello")],
                    timestamp: "2026-04-06T00:00:00Z",
                    isError: false,
                    isStopped: false,
                    cursor: nil,
                    itemId: nil
                )],
                composerDraft: emptyDraft,
                composerPhase: .idle,
                activeRunId: nil,
                currentSessionId: "session-1"
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: cardDraft,
                composerPhase: .idle,
                activeRunId: nil,
                currentSessionId: "session-1"
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: emptyDraft,
                composerPhase: .running,
                activeRunId: nil,
                currentSessionId: "session-1"
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: emptyDraft,
                composerPhase: .idle,
                activeRunId: "run-1",
                currentSessionId: "session-1"
            )
        )
    }

    func testAIChatShouldOpenFreshLocalSessionWhenLastUserMessageIsOlderThanSixHours() {
        let staleNow = Date(timeIntervalSince1970: 6 * 60 * 60 + 1)
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .user,
                content: [.text("hello")],
                timestamp: "1970-01-01T00:00:00Z",
                isError: false,
                isStopped: false,
                cursor: nil,
                itemId: nil
            )
        ]

        XCTAssertTrue(aiChatShouldOpenFreshLocalSession(messages: messages, now: staleNow))
    }

    func testAIChatShouldNotOpenFreshLocalSessionWhenLatestUserMessageIsRecent() {
        let recentNow = Date(timeIntervalSince1970: (6 * 60 * 60) - 1)
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .user,
                content: [.text("hello")],
                timestamp: "1970-01-01T00:00:00Z",
                isError: false,
                isStopped: false,
                cursor: nil,
                itemId: nil
            )
        ]

        XCTAssertFalse(aiChatShouldOpenFreshLocalSession(messages: messages, now: recentNow))
    }

    func testAIChatShouldNotOpenFreshLocalSessionWithoutUserMessages() {
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [.text("hello")],
                timestamp: "1970-01-01T00:00:00Z",
                isError: false,
                isStopped: false,
                cursor: nil,
                itemId: nil
            )
        ]

        XCTAssertFalse(
            aiChatShouldOpenFreshLocalSession(
                messages: messages,
                now: Date(timeIntervalSince1970: 24 * 60 * 60)
            )
        )
    }
}
