import Foundation

@MainActor
extension FlashcardsStore {
    func toggleTestMode() {
        let nextValue: Bool = self.isTestModeEnabled == false
        self.isTestModeEnabled = nextValue
        self.userDefaults.set(nextValue, forKey: testModeEnabledUserDefaultsKey)
        if nextValue {
            self.enqueueTransientBanner(banner: makeTestModeEnabledBanner())
        } else {
            self.enqueueTransientBanner(banner: makeTestModeDisabledBanner())
        }
    }
}
