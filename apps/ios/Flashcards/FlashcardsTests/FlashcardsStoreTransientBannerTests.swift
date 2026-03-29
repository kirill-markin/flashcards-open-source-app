import XCTest
@testable import Flashcards

final class FlashcardsStoreTransientBannerTests: XCTestCase {
    @MainActor
    func testEnqueueTransientBannerPublishesCurrentBannerWhenNoneIsVisible() throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self)
        let store = context.store
        let banner = makeWorkspaceChangesRequireAccountBanner()

        store.enqueueTransientBanner(banner: banner)

        XCTAssertEqual(store.currentTransientBanner, banner)
        XCTAssertTrue(store.queuedTransientBanners.isEmpty)
    }

    @MainActor
    func testEnqueueTransientBannerQueuesAdditionalBannersFIFO() throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self)
        let store = context.store
        let firstBanner = makeWorkspaceChangesRequireAccountBanner()
        let secondBanner = makeReviewUpdatedOnAnotherDeviceBanner()

        store.enqueueTransientBanner(banner: firstBanner)
        store.enqueueTransientBanner(banner: secondBanner)

        XCTAssertEqual(store.currentTransientBanner, firstBanner)
        XCTAssertEqual(store.queuedTransientBanners, [secondBanner])
    }

    @MainActor
    func testDismissCurrentTransientBannerPromotesQueuedBanner() throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self)
        let store = context.store
        let firstBanner = makeWorkspaceChangesRequireAccountBanner()
        let secondBanner = makeReviewUpdatedOnAnotherDeviceBanner()

        store.enqueueTransientBanner(banner: firstBanner)
        store.enqueueTransientBanner(banner: secondBanner)
        store.dismissCurrentTransientBanner()

        XCTAssertEqual(store.currentTransientBanner, secondBanner)
        XCTAssertTrue(store.queuedTransientBanners.isEmpty)
    }

    @MainActor
    func testDismissCurrentTransientBannerClearsCurrentBannerWhenQueueIsEmpty() throws {
        let context = try FlashcardsStoreTestSupport.makeStoreContext(testCase: self)
        let store = context.store

        store.enqueueTransientBanner(banner: makeWorkspaceChangesRequireAccountBanner())
        store.dismissCurrentTransientBanner()

        XCTAssertNil(store.currentTransientBanner)
        XCTAssertTrue(store.queuedTransientBanners.isEmpty)
    }
}
