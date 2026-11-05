import Foundation

enum WidgetDeepLinkSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium
    case large
}

/// Tap target of the Review widget:
/// `nibomo-widget://review?workspaceId=<id>&size=<small|medium|large>[&cardId=<id>]`.
/// `workspaceId` is absent only when the widget had no snapshot; `cardId` requires `workspaceId`.
struct WidgetDeepLink: Sendable, Equatable {
    let workspaceId: String?
    let size: WidgetDeepLinkSize
    let cardId: String?
}

let widgetDeepLinkScheme: String = "nibomo-widget"
let widgetDeepLinkHost: String = "review"

private let widgetDeepLinkWorkspaceIdQueryName: String = "workspaceId"
private let widgetDeepLinkSizeQueryName: String = "size"
private let widgetDeepLinkCardIdQueryName: String = "cardId"

func makeWidgetDeepLinkURL(deepLink: WidgetDeepLink) -> URL {
    var components = URLComponents()
    components.scheme = widgetDeepLinkScheme
    components.host = widgetDeepLinkHost
    var queryItems: [URLQueryItem] = []
    if let workspaceId = deepLink.workspaceId {
        queryItems.append(URLQueryItem(name: widgetDeepLinkWorkspaceIdQueryName, value: workspaceId))
    }
    queryItems.append(URLQueryItem(name: widgetDeepLinkSizeQueryName, value: deepLink.size.rawValue))
    if let cardId = deepLink.cardId {
        queryItems.append(URLQueryItem(name: widgetDeepLinkCardIdQueryName, value: cardId))
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
        components.host == widgetDeepLinkHost,
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
        widgetDeepLinkCardIdQueryName,
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
    let workspaceId = valuesByName[widgetDeepLinkWorkspaceIdQueryName]
    let cardId = valuesByName[widgetDeepLinkCardIdQueryName]
    if cardId != nil && workspaceId == nil {
        return nil
    }
    return WidgetDeepLink(workspaceId: workspaceId, size: size, cardId: cardId)
}
