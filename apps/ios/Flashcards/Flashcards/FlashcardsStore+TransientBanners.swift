import Foundation

@MainActor
extension FlashcardsStore {
    func enqueueTransientBanner(banner: TransientBanner) {
        if self.currentTransientBanner == nil {
            self.currentTransientBanner = banner
            return
        }

        self.queuedTransientBanners.append(banner)
    }

    func dismissCurrentTransientBanner() {
        if self.queuedTransientBanners.isEmpty {
            self.currentTransientBanner = nil
            return
        }

        self.currentTransientBanner = self.queuedTransientBanners.removeFirst()
    }

    func clearTransientBanners() {
        self.currentTransientBanner = nil
        self.queuedTransientBanners = []
    }
}
