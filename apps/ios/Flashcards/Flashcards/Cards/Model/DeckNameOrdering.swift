import Foundation

func deckNamePrecedes(
    leftName: String,
    leftId: String,
    rightName: String,
    rightId: String,
    locale: Locale
) -> Bool {
    let comparison = leftName.compare(
        rightName,
        options: [.caseInsensitive, .numeric],
        range: nil,
        locale: locale
    )
    if comparison == .orderedSame {
        return leftId < rightId
    }
    return comparison == .orderedAscending
}
