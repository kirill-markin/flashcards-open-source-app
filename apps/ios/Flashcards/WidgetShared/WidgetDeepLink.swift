import Foundation

enum WidgetDeepLinkSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium
    case large
    case accessoryCircular = "accessory_circular"
    case accessoryRectangular = "accessory_rectangular"
    case accessoryInline = "accessory_inline"
}

/// Raw values are the analytics `widget_kind` values.
enum WidgetDeepLinkKind: String, Sendable, Equatable, CaseIterable {
    case review
    case activity
    case year
    case today
    case lockScreen = "lock_screen"
    case reviewsChart = "reviews_chart"
    case streaks
    case monthCalendar = "month_calendar"
    case comingUp = "coming_up"
    case dashboard
    case question
}

/// The tab a widget tap opens; the raw value is the URL host.
enum WidgetDeepLinkDestination: String, Sendable, Equatable, CaseIterable {
    case review
    case progress
}

/// Tap target of every widget:
/// `nibomo-widget://<review|progress>?[workspaceId=<id>&]size=<size>[&kind=<kind>][&cardId=<id>][&reveal=1]`.
/// `workspaceId` is absent only when the widget had no snapshot; `cardId` requires `workspaceId` and the
/// `review` host, and `reveal=1`, the Reveal answer button, requires `cardId`. A URL without `kind` comes from a
/// Review widget placed before kinds existed.
struct WidgetDeepLink: Sendable, Equatable {
    let destination: WidgetDeepLinkDestination
    let kind: WidgetDeepLinkKind
    let workspaceId: String?
    let size: WidgetDeepLinkSize
    let cardId: String?
    let revealAnswer: Bool
}

let widgetDeepLinkScheme: String = "nibomo-widget"

private let widgetDeepLinkWorkspaceIdQueryName: String = "workspaceId"
private let widgetDeepLinkSizeQueryName: String = "size"
private let widgetDeepLinkKindQueryName: String = "kind"
private let widgetDeepLinkCardIdQueryName: String = "cardId"
private let widgetDeepLinkRevealQueryName: String = "reveal"
private let widgetDeepLinkRevealQueryValue: String = "1"

func makeWidgetDeepLinkURL(deepLink: WidgetDeepLink) -> URL {
    var components = URLComponents()
    components.scheme = widgetDeepLinkScheme
    components.host = deepLink.destination.rawValue
    var queryItems: [URLQueryItem] = []
    if let workspaceId = deepLink.workspaceId {
        queryItems.append(URLQueryItem(name: widgetDeepLinkWorkspaceIdQueryName, value: workspaceId))
    }
    queryItems.append(URLQueryItem(name: widgetDeepLinkSizeQueryName, value: deepLink.size.rawValue))
    queryItems.append(URLQueryItem(name: widgetDeepLinkKindQueryName, value: deepLink.kind.rawValue))
    if let cardId = deepLink.cardId {
        queryItems.append(URLQueryItem(name: widgetDeepLinkCardIdQueryName, value: cardId))
    }
    if deepLink.revealAnswer {
        queryItems.append(URLQueryItem(name: widgetDeepLinkRevealQueryName, value: widgetDeepLinkRevealQueryValue))
    }
    components.queryItems = queryItems
    guard let url = components.url else {
        preconditionFailure("Widget deep link components must form a URL: \(components)")
    }
    return url
}

/// Returns nil for any URL that is not exactly a widget deep link.
func parseWidgetDeepLinkURL(url: URL) -> WidgetDeepLink? {
    guard
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        components.scheme == widgetDeepLinkScheme,
        let host = components.host,
        let destination = WidgetDeepLinkDestination(rawValue: host),
        components.user == nil,
        components.password == nil,
        components.port == nil,
        components.path.isEmpty,
        components.fragment == nil,
        let queryItems = components.queryItems
    else {
        return nil
    }

    let allowedNames: Set<String> = [
        widgetDeepLinkWorkspaceIdQueryName,
        widgetDeepLinkSizeQueryName,
        widgetDeepLinkKindQueryName,
        widgetDeepLinkCardIdQueryName,
        widgetDeepLinkRevealQueryName,
    ]
    var valuesByName: [String: String] = [:]
    for queryItem in queryItems {
        guard
            allowedNames.contains(queryItem.name),
            valuesByName[queryItem.name] == nil,
            let value = queryItem.value,
            value.isEmpty == false
        else {
            return nil
        }
        valuesByName[queryItem.name] = value
    }

    guard
        let sizeValue = valuesByName[widgetDeepLinkSizeQueryName],
        let size = WidgetDeepLinkSize(rawValue: sizeValue)
    else {
        return nil
    }
    let kind: WidgetDeepLinkKind
    if let kindValue = valuesByName[widgetDeepLinkKindQueryName] {
        guard let parsedKind = WidgetDeepLinkKind(rawValue: kindValue) else {
            return nil
        }
        kind = parsedKind
    } else {
        kind = .review
    }
    let workspaceId = valuesByName[widgetDeepLinkWorkspaceIdQueryName]
    let cardId = valuesByName[widgetDeepLinkCardIdQueryName]
    if cardId != nil && (workspaceId == nil || destination != .review) {
        return nil
    }
    let revealAnswer: Bool
    if let revealValue = valuesByName[widgetDeepLinkRevealQueryName] {
        guard revealValue == widgetDeepLinkRevealQueryValue, cardId != nil else {
            return nil
        }
        revealAnswer = true
    } else {
        revealAnswer = false
    }
    return WidgetDeepLink(
        destination: destination,
        kind: kind,
        workspaceId: workspaceId,
        size: size,
        cardId: cardId,
        revealAnswer: revealAnswer
    )
}
