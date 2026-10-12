import Foundation
import Observation

@MainActor
@Observable
final class AIConsentStore {
    private(set) var ledger: AIConsentLedger?
    var isSaving: Bool = false
    var failureMessage: String?
    private var isLocallyBlocked: Bool = false
    @ObservationIgnored private let userDefaults: UserDefaults
    @ObservationIgnored private var syncTask: Task<Void, Error>?
    @ObservationIgnored private var syncActor: AIConsentActor?

    init(userDefaults: UserDefaults) {
        self.userDefaults = userDefaults
        do {
            if let data = userDefaults.data(forKey: aiConsentStateUserDefaultsKey) {
                self.ledger = try JSONDecoder().decode(AIConsentLedger.self, from: data)
            } else {
                self.ledger = AIConsentLedger(installationId: UUID(), identityId: UUID(), decisionSequence: 0, decisions: [])
            }
        } catch {
            self.ledger = nil
            self.failureMessage = aiSettingsLocalized("ai.consent.saveFailed", "Your choice could not be saved. Try again before using AI.")
        }
        userDefaults.removeObject(forKey: aiChatExternalProviderConsentUserDefaultsKey)
    }

    var currentDecision: AIConsentDecision? {
        guard let ledger else { return nil }
        return ledger.decisions.last { $0.identityId == ledger.identityId }
    }

    var hasAcknowledgedGrant: Bool {
        guard let decision = self.currentDecision else { return false }
        return !self.isLocallyBlocked && decision.evidence.action == .grant
            && decision.evidence.disclosureVersion == aiConsentDisclosureVersion
            && decision.receipt?.matches(decision.evidence) == true && decision.owner != nil
    }

    var hasPendingDecisions: Bool {
        guard let ledger else { return false }
        return ledger.decisions.contains { $0.identityId == ledger.identityId && $0.receipt == nil }
    }

    func blockSharing() {
        self.isLocallyBlocked = true
    }

    func record(action: AIConsentAction, disclosure: AIConsentDisclosure, actor: AIConsentActor?) throws {
        if action == .withdraw { self.blockSharing() }
        guard var ledger, ledger.decisionSequence < 9_007_199_254_740_991 else {
            throw AIConsentError.invalidState
        }
        guard let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
              let appBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String else {
            throw AIConsentError.invalidState
        }
        ledger.decisionSequence += 1
        #if targetEnvironment(macCatalyst)
        let platform = "macos"
        #else
        let platform = "ios"
        #endif
        let evidence = AIConsentEvidence(
            eventId: UUID(), installationId: ledger.installationId, action: action,
            decisionSequence: ledger.decisionSequence, occurredAt: aiConsentActionTime(),
            disclosureVersion: aiConsentDisclosureVersion, locale: disclosure.locale,
            disclosureText: disclosure.text,
            appVersion: appVersion,
            appBuild: appBuild,
            platform: platform
        )
        ledger.decisions.append(AIConsentDecision(
            identityId: ledger.identityId, evidence: evidence, actor: actor, owner: actor, receipt: nil
        ))
        try self.persist(ledger)
        self.failureMessage = nil
    }

    func requireReceipt(session: CloudLinkedSession) throws -> String {
        guard self.hasAcknowledgedGrant, let decision = self.currentDecision, let receipt = decision.receipt else {
            throw AIConsentError.required
        }
        guard decision.owner == AIConsentActor(session: session) else {
            throw AIConsentError.identityChanged
        }
        return receipt.eventId.uuidString.lowercased()
    }

    func flush(session: CloudLinkedSession) async throws {
        let actor = AIConsentActor(session: session)
        if let syncTask {
            guard self.syncActor == actor else { throw AIConsentError.identityChanged }
            try await syncTask.value
            return
        }
        guard let identityId = self.ledger?.identityId else { throw AIConsentError.invalidState }
        self.isSaving = true
        self.syncActor = actor
        let task = Task { @MainActor in
            while let index = self.ledger?.decisions.firstIndex(where: { $0.identityId == identityId && $0.receipt == nil }) {
                try Task.checkCancellation()
                guard var ledger = self.ledger, ledger.identityId == identityId else {
                    throw AIConsentError.identityChanged
                }
                let decision = ledger.decisions[index]
                guard decision.actor == nil || decision.actor == actor else { throw AIConsentError.identityChanged }
                ledger.decisions[index].actor = actor
                ledger.decisions[index].owner = actor
                try self.persist(ledger)
                let receipt = try await registerAIConsent(evidence: decision.evidence, session: session, urlSession: .shared)
                try Task.checkCancellation()
                guard var acknowledgedLedger = self.ledger, acknowledgedLedger.identityId == identityId else {
                    throw AIConsentError.identityChanged
                }
                acknowledgedLedger.decisions[index].receipt = receipt
                try self.persist(acknowledgedLedger)
                if self.currentDecision?.evidence.eventId == receipt.eventId && receipt.action == .grant {
                    self.isLocallyBlocked = false
                }
            }
        }
        self.syncTask = task
        defer {
            if self.ledger?.identityId == identityId {
                self.syncTask = nil
                self.syncActor = nil
                self.isSaving = false
            }
        }
        do {
            try await task.value
            self.failureMessage = nil
        } catch {
            if self.ledger?.identityId == identityId {
                self.failureMessage = self.currentDecision?.evidence.action == .withdraw
                    ? aiSettingsLocalized("ai.consent.withdrawalFailed", "AI data sharing is off on this device. Your choice has not synced yet; try again when connected.")
                    : aiSettingsLocalized("ai.consent.saveFailed", "Your choice could not be saved. Try again before using AI.")
            }
            throw error
        }
    }

    func transferAcknowledgedGuest(guest: AIConsentActor, account: AIConsentActor) throws {
        guard var ledger else { throw AIConsentError.invalidState }
        guard guest != account else { return }
        guard !ledger.decisions.contains(where: { $0.identityId == ledger.identityId && $0.actor == guest && $0.receipt == nil }) else {
            throw AIConsentError.required
        }
        for index in ledger.decisions.indices where ledger.decisions[index].identityId == ledger.identityId
            && ledger.decisions[index].owner == guest {
            ledger.decisions[index].owner = account
        }
        try self.persist(ledger)
    }

    func resetIdentity() throws {
        self.syncTask?.cancel()
        self.syncTask = nil
        self.syncActor = nil
        self.isSaving = false
        self.failureMessage = nil
        self.isLocallyBlocked = true
        var ledger = self.ledger ?? AIConsentLedger(installationId: UUID(), identityId: UUID(), decisionSequence: 0, decisions: [])
        ledger.identityId = UUID()
        try self.persist(ledger)
    }

    func eraseDeletedAccountReceipts(userId: String?) throws {
        self.syncTask?.cancel()
        guard var ledger else { return }
        let identityId = ledger.identityId
        ledger.decisions.removeAll { $0.identityId == identityId || (userId != nil && $0.owner?.userId == userId) }
        try self.persist(ledger)
    }

    func eraseDeletedGuestReceipts(guest: AIConsentActor) throws {
        self.syncTask?.cancel()
        guard var ledger else { return }
        let identityId = ledger.identityId
        ledger.decisions.removeAll {
            $0.owner == guest || ($0.identityId == identityId && $0.actor == nil)
        }
        try self.persist(ledger)
    }

    private func persist(_ ledger: AIConsentLedger) throws {
        let data = try JSONEncoder().encode(ledger)
        self.userDefaults.set(data, forKey: aiConsentStateUserDefaultsKey)
        self.ledger = ledger
    }
}
