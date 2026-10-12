#if targetEnvironment(macCatalyst)
import UIKit
import XCTest

@MainActor
func resizeMarketingMacWindow(app: XCUIApplication, targetWidth: Int, targetHeight: Int) throws {
    let window = try XCTUnwrap(app.windows.allElementsBoundByIndex.first { $0.isHittable },
        "Expected a visible Catalyst marketing window.")
    let origin = window.coordinate(withNormalizedOffset: .zero)
    // Keep the entire window clear of the menu bar and Dock before resizing.
    let titleBar = origin.withOffset(CGVector(dx: window.frame.width / 2, dy: 12))
    let screenOrigin = origin.withOffset(CGVector(dx: 40 - window.frame.minX, dy: 60 - window.frame.minY))
    titleBar.click(forDuration: 0.2, thenDragTo: screenOrigin.withOffset(
        CGVector(dx: window.frame.width / 2, dy: 12)))

    for _ in 0..<4 {
        let image = window.screenshot().image
        let pixels = try XCTUnwrap(image.cgImage, "Could not inspect Catalyst window pixels.")
        if pixels.width == targetWidth && pixels.height == targetHeight { return }
        let scaleX = CGFloat(pixels.width) / window.frame.width
        let scaleY = CGFloat(pixels.height) / window.frame.height
        let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
            .withOffset(CGVector(dx: -1, dy: -1))
        let destination = corner.withOffset(CGVector(
            dx: CGFloat(targetWidth - pixels.width) / scaleX,
            dy: CGFloat(targetHeight - pixels.height) / scaleY))
        corner.click(forDuration: 0.2, thenDragTo: destination)
    }
    let pixels = try XCTUnwrap(window.screenshot().image.cgImage)
    XCTFail("Could not resize the complete native Mac window to \(targetWidth)x\(targetHeight); got \(pixels.width)x\(pixels.height), window=\(window.frame). Use a display that fits the requested size.")
}
#endif
