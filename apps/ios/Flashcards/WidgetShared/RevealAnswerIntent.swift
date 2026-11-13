import AppIntents
import Foundation
import Observation

/// Widget taps that reach the app through an App Intent instead of `onOpenURL`; the app moves each one into the
/// same pending widget deep link a URL tap fills, so both share one consumer.
@MainActor
@Observable
final class WidgetDeepLinkInbox {
    static let shared: WidgetDeepLinkInbox = WidgetDeepLinkInbox()

    var deepLink: WidgetDeepLink? = nil

    private init() {}
}

/// The Reveal answer button of a widget that shows a question. The small family supports no `Link`, so every size
/// uses this intent. It is compiled into the app too, so `perform()` runs in the app, which it opens; the
/// `nibomo-widget` scheme is deliberately unregistered, so an `OpenURLIntent` could not open it.
struct RevealAnswerIntent: AppIntent {
    static let title: LocalizedStringResource = LocalizedStringResource("widget.reveal_answer", table: "Widget")
    static let isDiscoverable: Bool = false
    static let openAppWhenRun: Bool = true

    @available(iOS 26.0, macCatalyst 26.0, *)
    static var supportedModes: IntentModes {
        .foreground(.immediate)
    }

    /// A `nibomo-widget` URL with `reveal=1`, checked again by the same parser as a URL tap.
    @Parameter(title: "Widget URL")
    var widgetURL: String

    init() {}

    init(deepLink: WidgetDeepLink) {
        self.widgetURL = makeWidgetDeepLinkURL(deepLink: deepLink).absoluteString
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard
            let url = URL(string: self.widgetURL),
            let deepLink = parseWidgetDeepLinkURL(url: url),
            deepLink.revealAnswer
        else {
            throw RevealAnswerIntentError.invalidWidgetURL(self.widgetURL)
        }
        WidgetDeepLinkInbox.shared.deepLink = deepLink
        return .result()
    }
}

enum RevealAnswerIntentError: Error, CustomStringConvertible {
    case invalidWidgetURL(String)

    var description: String {
        switch self {
        case .invalidWidgetURL(let widgetURL):
            return "Reveal answer intent received a URL that is not a reveal widget deep link: \(widgetURL)"
        }
    }
}
