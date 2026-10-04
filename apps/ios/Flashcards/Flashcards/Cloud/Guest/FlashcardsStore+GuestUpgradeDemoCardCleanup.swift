import Foundation

struct GuestUpgradeDemoCardCleanup {
    let guestCardIds: Set<String>
    let untouchedDemoCardIds: [String]
}

@MainActor
extension FlashcardsStore {
    /**
     Captures what a `merge_required` guest upgrade needs to drop the guest's
     untouched onboarding demo card, or `nil` when the guest workspace holds
     none. Must run before guest-upgrade completion replaces the local guest
     workspace with the destination one.
     */
    func captureGuestUpgradeDemoCardCleanupReportingFailure(
        guestWorkspaceId: String
    ) -> GuestUpgradeDemoCardCleanup? {
        do {
            let database = try requireLocalDatabase(database: self.database)
            let guestCards = try database.cardStore.loadCardsIncludingDeleted(workspaceId: guestWorkspaceId)
            let untouchedDemoCardIds = guestCards
                .filter { card in
                    isUntouchedOnboardingDemoCard(card: card)
                }
                .map(\.cardId)
            guard untouchedDemoCardIds.isEmpty == false else {
                return nil
            }

            return GuestUpgradeDemoCardCleanup(
                guestCardIds: Set(guestCards.map(\.cardId)),
                untouchedDemoCardIds: untouchedDemoCardIds
            )
        } catch {
            self.captureGuestUpgradeDemoCardCleanupFailure(error: error, stage: "capture")
            return nil
        }
    }

    /**
     Deletes the captured demo cards through the ordinary card delete once the
     merged destination is hydrated and local mutations are unblocked, but only
     when the destination already held cards of its own. Guest upgrade keeps
     card ids, so any destination card row, tombstones included, whose id is
     not one of the guest's belongs to the account that existed before.

     A failure leaves the card as an ordinary card and never fails the upgrade.
     */
    func deleteGuestUpgradeDemoCardsReportingFailure(cleanup: GuestUpgradeDemoCardCleanup) {
        do {
            let context = try requireLocalMutationContext(database: self.database, workspace: self.workspace)
            let destinationCards = try context.database.cardStore.loadCardsIncludingDeleted(
                workspaceId: context.workspaceId
            )
            let destinationHasAccountCards = destinationCards.contains { card in
                cleanup.guestCardIds.contains(card.cardId) == false
            }
            guard destinationHasAccountCards else {
                return
            }

            let activeDestinationCardIds = Set(
                destinationCards
                    .filter { card in
                        card.deletedAt == nil
                    }
                    .map(\.cardId)
            )
            let demoCardIds = cleanup.untouchedDemoCardIds.filter { cardId in
                activeDestinationCardIds.contains(cardId)
            }
            guard demoCardIds.isEmpty == false else {
                return
            }

            _ = try self.deleteCards(cardIds: demoCardIds)
        } catch {
            self.captureGuestUpgradeDemoCardCleanupFailure(error: error, stage: "delete")
        }
    }

    private func captureGuestUpgradeDemoCardCleanupFailure(error: Error, stage: String) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .localData,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: "guest_upgrade_demo_card_cleanup",
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}
