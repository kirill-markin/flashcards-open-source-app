import Foundation

private let savedAppLanguageUserDefaultsKey: String = "saved-app-language"

/// The app language this install last saved, and the user it was saved for.
private struct SavedAppLanguage: Codable, Hashable {
    let userId: String
    let locale: String
}

@MainActor
extension FlashcardsStore {
    /**
     * Saves the interface language this app displays onto the current cloud identity, so leaderboard
     * names and billing follow it, when it differs from what this install last saved for that user.
     *
     * Keyed by user rather than by install: the server does not carry a guest's language into the
     * account it merges into. One attempt per user per process is enough, because iOS relaunches the
     * app when its language changes, and the next launch retries a failed save.
     */
    func triggerAppLanguageSaveIfNeeded() {
        guard self.canPersistAccountPreferences,
              let userId = self.cloudSettings?.linkedUserId,
              userId.isEmpty == false,
              let locale = currentAppUILocaleIdentifier() else {
            return
        }
        let appLanguage = SavedAppLanguage(userId: userId, locale: locale)
        guard self.loadSavedAppLanguage() != appLanguage,
              self.attemptedAppLanguageSaveUserIds.insert(userId).inserted else {
            return
        }

        Task { @MainActor in
            do {
                _ = try await self.updateCloudAccountPreferences(
                    patch: AccountPreferencesPatchRequest(locale: locale),
                    validateResolvedSession: { session in
                        guard session.userId == userId else {
                            throw LocalStoreError.validation("The account changed before the app language could be saved")
                        }
                    }
                )
                let data = try self.encoder.encode(appLanguage)
                self.userDefaults.set(data, forKey: savedAppLanguageUserDefaultsKey)
            } catch {
                if isRequestCancellationError(error: error) || isSilentlyIgnorableNetworkTransportFailure(error: error) {
                    return
                }
                self.captureAccountPreferencesSilentFailure(
                    error: error,
                    action: "app_language_save",
                    stage: "patch"
                )
            }
        }
    }

    private func loadSavedAppLanguage() -> SavedAppLanguage? {
        guard let data = self.userDefaults.data(forKey: savedAppLanguageUserDefaultsKey) else {
            return nil
        }

        do {
            return try self.decoder.decode(SavedAppLanguage.self, from: data)
        } catch {
            self.captureAccountPreferencesSilentFailure(
                error: error,
                action: "app_language_record_load",
                stage: "decode"
            )
            self.userDefaults.removeObject(forKey: savedAppLanguageUserDefaultsKey)
            return nil
        }
    }
}
