import CoreGraphics
import Foundation
import UIKit

/// Where the side chat's transcript was left.
enum AIChatTranscriptPosition: Equatable {
    /// Following the newest message.
    case bottom
    /// A message whose top edge sits `topOffset` above the transcript viewport's top edge.
    case message(id: String, topOffset: CGFloat)
}

/// One chat's composer: the side chat in a section, or the AI tab's own chat.
struct AIChatComposerHost: Equatable {
    let tab: AppTab
    let isCompanion: Bool
}

/// The window scene a chat view's composer shows in, reported by the field itself.
@MainActor
final class AIChatComposerWindowScene {
    weak var scene: UIWindowScene?

    var identifier: String? {
        self.scene?.session.persistentIdentifier
    }
}

/// Side chat view state that outlives one view. Each section hosts its own companion `AIChatView`, so the one that
/// comes on screen restores the reader's place and the composer's shape from here. Only the companion on screen
/// writes it.
@MainActor
final class AIChatCompanionPresentation {
    var transcriptPosition: AIChatTranscriptPosition = .bottom
    #if !targetEnvironment(macCatalyst)
    let composerShellWidth: AIChatComposerShellWidth = AIChatComposerShellWidth()
    #endif
}

/// A chat view refreshes consent and the monthly usage as it appears. Each section hosts its own side chat, so a
/// section switch shows another view right after the last one refreshed; one refresh covers this interval.
private let aiChatViewAppearRefreshIntervalSeconds: TimeInterval = 30

extension AIChatStore {
    /// Nil returns the block to its automatic state.
    func setTranscriptDisclosure(messageId: String, key: String, isExpanded: Bool?) {
        var disclosures = self.transcriptDisclosures[messageId] ?? [:]
        guard disclosures[key] != isExpanded else { return }
        disclosures[key] = isExpanded
        self.transcriptDisclosures[messageId] = disclosures.isEmpty ? nil : disclosures
    }

    /// Returns whether the appearing view should refresh, and starts a new interval if so.
    func claimViewAppearRefresh(now: Date) -> Bool {
        if let lastRefreshAt = self.lastViewAppearRefreshAt,
           now.timeIntervalSince(lastRefreshAt) < aiChatViewAppearRefreshIntervalSeconds {
            return false
        }
        self.lastViewAppearRefreshAt = now
        return true
    }

    /// Every mounted chat view asks after a run; one request runs at a time, and a request made during it runs once
    /// more afterwards so the balance includes the run that just ended.
    func refreshAIUsage() {
        guard self.activeAIUsageRefreshTask == nil else {
            self.refreshesAIUsageAgain = true
            return
        }
        self.activeAIUsageRefreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            repeat {
                self.refreshesAIUsageAgain = false
                await self.flashcardsStore.refreshAIUsage()
            } while self.refreshesAIUsageAgain
            self.activeAIUsageRefreshTask = nil
        }
    }
}
