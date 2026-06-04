import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func scrollBestEffort() {
        let collectionView = self.app.collectionViews.firstMatch
        if collectionView.exists {
            collectionView.swipeUp()
            return
        }

        let scrollView = self.app.scrollViews.firstMatch
        if scrollView.exists {
            scrollView.swipeUp()
            return
        }

        let table = self.app.tables.firstMatch
        if table.exists {
            table.swipeUp()
            return
        }

        self.app.swipeUp()
    }
}
