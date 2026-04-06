import Foundation
import XCTest
@testable import Flashcards

final class AIChatDraftPersistenceTests: XCTestCase {
    func testAIChatHistoryStorePersistsDraftsByWorkspaceAndSessionAndPrunesEmptyDrafts() async {
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
            effortLevel: .medium
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
            pendingDraft
        )
        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: "session-1"),
            pendingDraft
        )
        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: nil),
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

    func testAIChatHistoryStoreClearsPendingDraftWhenResolvedSessionDraftIsSavedAndRemoved() async {
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

        let pendingDraft = AIChatComposerDraft(
            inputText: "pending draft",
            pendingAttachments: []
        )
        let resolvedDraft = AIChatComposerDraft(
            inputText: "resolved draft",
            pendingAttachments: []
        )

        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: nil,
            draft: pendingDraft
        )
        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: "session-1",
            draft: resolvedDraft
        )

        let pendingKey = "ai-chat-draft::workspace-1::pending"
        XCTAssertFalse(userDefaults.dictionaryRepresentation().keys.contains(pendingKey))

        await store.saveDraft(
            workspaceId: "workspace-1",
            sessionId: "session-1",
            draft: AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )

        XCTAssertEqual(
            store.loadDraft(workspaceId: "workspace-1", sessionId: "session-1"),
            AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        XCTAssertFalse(userDefaults.dictionaryRepresentation().keys.contains(pendingKey))
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
                            effortLevel: .fast
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
                activeRunId: nil
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
                activeRunId: nil
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: cardDraft,
                composerPhase: .idle,
                activeRunId: nil
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: emptyDraft,
                composerPhase: .running,
                activeRunId: nil
            )
        )
        XCTAssertFalse(
            aiChatShouldReuseCurrentSessionForHandoff(
                messages: [],
                composerDraft: emptyDraft,
                composerPhase: .idle,
                activeRunId: "run-1"
            )
        )
    }
}
