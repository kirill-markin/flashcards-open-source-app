import Foundation
import SwiftUI

private let cardEditorManagedMediaReferenceExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(
            pattern: #"(!)?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid card editor managed media reference regex")
    }
}()
private let cardEditorManagedMediaFenceExpression: NSRegularExpression = {
    do {
        return try NSRegularExpression(
            pattern: #"^\s{0,3}(`{3,}|~{3,})"#,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid card editor managed media fence regex")
    }
}()

struct CardEditorManagedImageReference: Identifiable, Hashable {
    let occurrence: Int
    let mediaAssetId: String
    let reviewReference: ReviewManagedMediaReference

    var id: String {
        "\(self.occurrence)-\(self.mediaAssetId)"
    }
}

struct CardEditorMarkdownInsertion {
    let text: String
    let selection: TextSelection?
}

struct CardEditorMarkdownInsertionAnchor {
    fileprivate let text: String
    fileprivate let selectionUTF8Range: CardEditorTextUTF8Range?
}

private struct CardEditorManagedImageMatch {
    let occurrence: Int
    let mediaAssetId: String
    let state: ManagedMediaAssetReferenceState
    let destination: String
    let destinationRange: Range<String.Index>
    let label: String?
    let range: Range<String.Index>
}

private struct CardEditorManagedImageDestinationTransition {
    let mediaAssetIdUTF8: [UInt8]
    let observedDestinationUTF8: [UInt8]
    let refreshedDestination: String
}

private struct CardEditorTextReplacement {
    let range: Range<String.Index>
    let text: String
}

fileprivate struct CardEditorTextUTF8Range {
    let lowerBound: Int
    let upperBound: Int
}

private enum CardEditorTextSelectionUTF8Offsets {
    case selection(CardEditorTextUTF8Range)
    case multiSelection([CardEditorTextUTF8Range])
}

private struct CardEditorTextUTF8OffsetReplacement {
    let lowerBound: Int
    let upperBound: Int
    let textCount: Int
}

struct CardEditorTextReconciliation {
    let text: String
    let selection: TextSelection?
}

func cardEditorManagedImageReferences(text: String) -> [CardEditorManagedImageReference] {
    cardEditorManagedImageMatches(text: text).map { match in
        CardEditorManagedImageReference(
            occurrence: match.occurrence,
            mediaAssetId: match.mediaAssetId,
            reviewReference: ReviewManagedMediaReference(
                mediaAssetId: match.mediaAssetId,
                state: match.state,
                label: match.label,
                isImageSyntax: true
            )
        )
    }
}

func cardEditorMarkdownInsertionAnchor(
    text: String,
    selection: TextSelection?
) -> CardEditorMarkdownInsertionAnchor {
    let selectionUTF8Range: CardEditorTextUTF8Range?
    switch cardEditorTextSelectionUTF8Offsets(text: text, selection: selection) {
    case .some(.selection(let range)):
        selectionUTF8Range = range
    case .some(.multiSelection), .none:
        selectionUTF8Range = nil
    }

    return CardEditorMarkdownInsertionAnchor(
        text: text,
        selectionUTF8Range: selectionUTF8Range
    )
}

func cardEditorTextByInsertingMarkdown(
    text: String,
    markdown: String,
    insertionAnchor: CardEditorMarkdownInsertionAnchor
) -> CardEditorMarkdownInsertion {
    let replacementRange = cardEditorMarkdownInsertionRange(
        text: text,
        insertionAnchor: insertionAnchor
    )
    let insertionText = cardEditorMarkdownInsertionText(
        text: text,
        replacementRange: replacementRange,
        markdown: markdown
    )
    let insertionStartOffset = text.distance(from: text.startIndex, to: replacementRange.lowerBound)
    var nextText = text
    nextText.replaceSubrange(replacementRange, with: insertionText)
    let insertionEndIndex = nextText.index(nextText.startIndex, offsetBy: insertionStartOffset + insertionText.count)

    return CardEditorMarkdownInsertion(
        text: nextText,
        selection: TextSelection(insertionPoint: insertionEndIndex)
    )
}

private func cardEditorMarkdownInsertionRange(
    text: String,
    insertionAnchor: CardEditorMarkdownInsertionAnchor
) -> Range<String.Index> {
    guard text.utf8.elementsEqual(insertionAnchor.text.utf8),
          let selectionUTF8Range = insertionAnchor.selectionUTF8Range,
          let selectionRange = cardEditorTextRange(
              lowerUTF8Offset: selectionUTF8Range.lowerBound,
              upperUTF8Offset: selectionUTF8Range.upperBound,
              text: text
          ) else {
        return text.endIndex..<text.endIndex
    }

    return selectionRange
}

func cardEditorTextByRemovingManagedImageReference(
    text: String,
    selection: TextSelection?,
    mediaAssetId: String,
    occurrence: Int
) -> CardEditorTextReconciliation {
    let selectionUTF8Offsets = cardEditorTextSelectionUTF8Offsets(text: text, selection: selection)
    var nextText = text

    for match in cardEditorManagedImageMatches(text: text) {
        if match.occurrence == occurrence && match.mediaAssetId == mediaAssetId {
            nextText.removeSubrange(match.range)
            return CardEditorTextReconciliation(
                text: nextText,
                selection: cardEditorTextSelectionByApplyingReplacements(
                    selectionUTF8Offsets: selectionUTF8Offsets,
                    text: text,
                    nextText: nextText,
                    replacements: [CardEditorTextReplacement(range: match.range, text: "")]
                )
            )
        }
    }

    return CardEditorTextReconciliation(text: text, selection: selection)
}

func cardEditorTextByReconcilingMediaLifecycle(
    text: String,
    selection: TextSelection?,
    observedText: String,
    refreshedText: String
) -> CardEditorTextReconciliation {
    let transitions = cardEditorManagedImageDestinationTransitions(
        observedText: observedText,
        refreshedText: refreshedText
    )
    let draftMatchesByMediaAssetIdUTF8 = Dictionary(
        grouping: cardEditorManagedImageMatches(text: text),
        by: { Array($0.mediaAssetId.utf8) }
    )
    let replacements = transitions.compactMap { transition -> CardEditorTextReplacement? in
        guard let draftMatches = draftMatchesByMediaAssetIdUTF8[transition.mediaAssetIdUTF8],
              draftMatches.count == 1,
              let draftMatch = draftMatches.first,
              Array(draftMatch.destination.utf8) == transition.observedDestinationUTF8 else {
            return nil
        }

        return CardEditorTextReplacement(
            range: draftMatch.destinationRange,
            text: transition.refreshedDestination
        )
    }.sorted { first, second in
        first.range.lowerBound < second.range.lowerBound
    }

    guard replacements.isEmpty == false else {
        return CardEditorTextReconciliation(text: text, selection: selection)
    }

    let selectionUTF8Offsets = cardEditorTextSelectionUTF8Offsets(text: text, selection: selection)
    var nextText = text
    for replacement in replacements.reversed() {
        nextText.replaceSubrange(replacement.range, with: replacement.text)
    }

    return CardEditorTextReconciliation(
        text: nextText,
        selection: cardEditorTextSelectionByApplyingReplacements(
            selectionUTF8Offsets: selectionUTF8Offsets,
            text: text,
            nextText: nextText,
            replacements: replacements
        )
    )
}

private func cardEditorManagedImageDestinationTransitions(
    observedText: String,
    refreshedText: String
) -> [CardEditorManagedImageDestinationTransition] {
    let observedMatchesByMediaAssetIdUTF8 = Dictionary(
        grouping: cardEditorManagedImageMatches(text: observedText),
        by: { Array($0.mediaAssetId.utf8) }
    )
    let refreshedMatchesByMediaAssetIdUTF8 = Dictionary(
        grouping: cardEditorManagedImageMatches(text: refreshedText),
        by: { Array($0.mediaAssetId.utf8) }
    )
    var transitions: [CardEditorManagedImageDestinationTransition] = []

    for (mediaAssetIdUTF8, observedMatches) in observedMatchesByMediaAssetIdUTF8 {
        guard observedMatches.count == 1,
              let observedMatch = observedMatches.first,
              observedMatch.state != .ready,
              let refreshedMatches = refreshedMatchesByMediaAssetIdUTF8[mediaAssetIdUTF8],
              refreshedMatches.count == 1,
              let refreshedMatch = refreshedMatches.first else {
            continue
        }

        let observedDestinationUTF8 = Array(observedMatch.destination.utf8)
        let refreshedDestinationUTF8 = Array(refreshedMatch.destination.utf8)
        guard observedMatch.state != refreshedMatch.state,
              observedDestinationUTF8 != refreshedDestinationUTF8 else {
            continue
        }

        transitions.append(
            CardEditorManagedImageDestinationTransition(
                mediaAssetIdUTF8: mediaAssetIdUTF8,
                observedDestinationUTF8: observedDestinationUTF8,
                refreshedDestination: refreshedMatch.destination
            )
        )
    }

    return transitions
}

private func cardEditorTextSelectionUTF8Offsets(
    text: String,
    selection: TextSelection?
) -> CardEditorTextSelectionUTF8Offsets? {
    guard let selection else {
        return nil
    }

    switch selection.indices {
    case .selection(let range):
        guard let range = cardEditorTextRangeIfValid(range: range, text: text) else {
            return nil
        }
        return .selection(cardEditorTextUTF8Range(range: range, text: text))
    case .multiSelection(let ranges):
        var utf8Ranges: [CardEditorTextUTF8Range] = []
        for range in ranges.ranges {
            guard let range = cardEditorTextRangeIfValid(range: range, text: text) else {
                return nil
            }
            utf8Ranges.append(cardEditorTextUTF8Range(range: range, text: text))
        }
        return .multiSelection(utf8Ranges)
    @unknown default:
        return nil
    }
}

private func cardEditorTextUTF8Range(
    range: Range<String.Index>,
    text: String
) -> CardEditorTextUTF8Range {
    CardEditorTextUTF8Range(
        lowerBound: text.utf8.distance(from: text.utf8.startIndex, to: range.lowerBound),
        upperBound: text.utf8.distance(from: text.utf8.startIndex, to: range.upperBound)
    )
}

private func cardEditorTextSelectionByApplyingReplacements(
    selectionUTF8Offsets: CardEditorTextSelectionUTF8Offsets?,
    text: String,
    nextText: String,
    replacements: [CardEditorTextReplacement]
) -> TextSelection? {
    guard let selectionUTF8Offsets else {
        return nil
    }

    let utf8OffsetReplacements = replacements.map { replacement in
        CardEditorTextUTF8OffsetReplacement(
            lowerBound: text.utf8.distance(from: text.utf8.startIndex, to: replacement.range.lowerBound),
            upperBound: text.utf8.distance(from: text.utf8.startIndex, to: replacement.range.upperBound),
            textCount: replacement.text.utf8.count
        )
    }

    switch selectionUTF8Offsets {
    case .selection(let range):
        guard let nextRange = cardEditorTextRangeByApplyingReplacements(
            range: range,
            nextText: nextText,
            replacements: utf8OffsetReplacements
        ) else {
            return nil
        }

        return TextSelection(range: nextRange)
    case .multiSelection(let ranges):
        var nextRanges: [Range<String.Index>] = []
        for range in ranges {
            guard let nextRange = cardEditorTextRangeByApplyingReplacements(
                range: range,
                nextText: nextText,
                replacements: utf8OffsetReplacements
            ) else {
                return nil
            }
            nextRanges.append(nextRange)
        }
        return TextSelection(ranges: RangeSet(nextRanges))
    }
}

private func cardEditorTextRangeByApplyingReplacements(
    range: CardEditorTextUTF8Range,
    nextText: String,
    replacements: [CardEditorTextUTF8OffsetReplacement]
) -> Range<String.Index>? {
    let lowerUTF8Offset = cardEditorTextUTF8OffsetByApplyingReplacements(
        offset: range.lowerBound,
        replacements: replacements
    )
    let upperUTF8Offset = cardEditorTextUTF8OffsetByApplyingReplacements(
        offset: range.upperBound,
        replacements: replacements
    )
    return cardEditorTextRange(
        lowerUTF8Offset: lowerUTF8Offset,
        upperUTF8Offset: upperUTF8Offset,
        text: nextText
    )
}

private func cardEditorTextRange(
    lowerUTF8Offset: Int,
    upperUTF8Offset: Int,
    text: String
) -> Range<String.Index>? {
    guard lowerUTF8Offset >= 0,
          upperUTF8Offset >= lowerUTF8Offset,
          let lowerUTF8Index = text.utf8.index(
              text.utf8.startIndex,
              offsetBy: lowerUTF8Offset,
              limitedBy: text.utf8.endIndex
          ),
          let upperUTF8Index = text.utf8.index(
              text.utf8.startIndex,
              offsetBy: upperUTF8Offset,
              limitedBy: text.utf8.endIndex
          ),
          let lowerBound = String.Index(lowerUTF8Index, within: text),
          let upperBound = String.Index(upperUTF8Index, within: text),
          lowerBound <= upperBound else {
        return nil
    }

    return lowerBound..<upperBound
}

private func cardEditorTextUTF8OffsetByApplyingReplacements(
    offset: Int,
    replacements: [CardEditorTextUTF8OffsetReplacement]
) -> Int {
    var appliedOffset = 0

    for replacement in replacements {
        if offset < replacement.lowerBound {
            break
        }
        if offset == replacement.upperBound {
            return replacement.lowerBound + appliedOffset + replacement.textCount
        }
        if offset < replacement.upperBound {
            let relativeOffset = offset - replacement.lowerBound
            return replacement.lowerBound + appliedOffset + min(relativeOffset, replacement.textCount)
        }

        appliedOffset += replacement.textCount - (replacement.upperBound - replacement.lowerBound)
    }

    return offset + appliedOffset
}

private func cardEditorManagedImageMatches(text: String) -> [CardEditorManagedImageMatch] {
    var activeFenceMarker: String?
    var matches: [CardEditorManagedImageMatch] = []

    for lineRange in cardEditorLineRanges(text: text) {
        let line = String(text[lineRange])
        let fenceMarker = cardEditorManagedMediaFenceMarker(line: line)

        if let currentFenceMarker = activeFenceMarker {
            if fenceMarker == currentFenceMarker {
                activeFenceMarker = nil
            }
            continue
        }

        if let fenceMarker {
            activeFenceMarker = fenceMarker
            continue
        }

        matches.append(
            contentsOf: cardEditorManagedImageMatchesInLine(
                text: text,
                line: line,
                lineRange: lineRange,
                nextOccurrence: matches.count
            )
        )
    }

    return matches
}

private func cardEditorManagedImageMatchesInLine(
    text: String,
    line: String,
    lineRange: Range<String.Index>,
    nextOccurrence: Int
) -> [CardEditorManagedImageMatch] {
    let fullRange = NSRange(line.startIndex..<line.endIndex, in: line)
    let matches = cardEditorManagedMediaReferenceExpression.matches(in: line, options: [], range: fullRange)
    var imageMatches: [CardEditorManagedImageMatch] = []

    for match in matches {
        guard match.range(at: 1).location != NSNotFound,
              let urlRange = Range(match.range(at: 3), in: line) else {
            continue
        }
        let rawReference = String(line[urlRange])
        guard let mediaAssetId = parseManagedMediaAssetId(reference: rawReference),
              let state = managedMediaAssetReferenceState(reference: rawReference),
              let matchRange = Range(match.range, in: line) else {
            continue
        }

        imageMatches.append(
            CardEditorManagedImageMatch(
                occurrence: nextOccurrence + imageMatches.count,
                mediaAssetId: mediaAssetId,
                state: state,
                destination: rawReference,
                destinationRange: cardEditorOriginalLineRange(
                    text: text,
                    line: line,
                    lineRange: lineRange,
                    matchRange: urlRange
                ),
                label: cardEditorManagedMediaLabel(text: line, match: match),
                range: cardEditorOriginalLineRange(
                    text: text,
                    line: line,
                    lineRange: lineRange,
                    matchRange: matchRange
                )
            )
        )
    }

    return imageMatches
}

private func cardEditorLineRanges(text: String) -> [Range<String.Index>] {
    var ranges: [Range<String.Index>] = []
    var lineStart = text.startIndex
    var currentIndex = text.startIndex

    while currentIndex < text.endIndex {
        if text[currentIndex].isNewline {
            ranges.append(lineStart..<currentIndex)
            currentIndex = text.index(after: currentIndex)
            lineStart = currentIndex
        } else {
            currentIndex = text.index(after: currentIndex)
        }
    }

    ranges.append(lineStart..<text.endIndex)
    return ranges
}

private func cardEditorManagedMediaFenceMarker(line: String) -> String? {
    let range = NSRange(line.startIndex..<line.endIndex, in: line)
    guard let match = cardEditorManagedMediaFenceExpression.firstMatch(in: line, options: [], range: range),
          let markerRange = Range(match.range(at: 1), in: line) else {
        return nil
    }

    return String(line[markerRange])
}

private func cardEditorOriginalLineRange(
    text: String,
    line: String,
    lineRange: Range<String.Index>,
    matchRange: Range<String.Index>
) -> Range<String.Index> {
    let lowerOffset = line.distance(from: line.startIndex, to: matchRange.lowerBound)
    let upperOffset = line.distance(from: line.startIndex, to: matchRange.upperBound)
    let lowerBound = text.index(lineRange.lowerBound, offsetBy: lowerOffset)
    let upperBound = text.index(lineRange.lowerBound, offsetBy: upperOffset)
    return lowerBound..<upperBound
}

private func cardEditorTextRangeIfValid(
    range: Range<String.Index>,
    text: String
) -> Range<String.Index>? {
    guard let lowerBound = String.Index(range.lowerBound, within: text),
          let upperBound = String.Index(range.upperBound, within: text),
          lowerBound <= upperBound else {
        return nil
    }

    return lowerBound..<upperBound
}

private func cardEditorMarkdownInsertionText(
    text: String,
    replacementRange: Range<String.Index>,
    markdown: String
) -> String {
    let leadingSeparator = cardEditorNeedsLeadingMarkdownSeparator(
        text: text,
        replacementRange: replacementRange
    ) ? "\n" : ""
    let trailingSeparator = cardEditorNeedsTrailingMarkdownSeparator(
        text: text,
        replacementRange: replacementRange
    ) ? "\n" : ""

    return "\(leadingSeparator)\(markdown)\(trailingSeparator)"
}

private func cardEditorNeedsLeadingMarkdownSeparator(
    text: String,
    replacementRange: Range<String.Index>
) -> Bool {
    guard replacementRange.lowerBound > text.startIndex else {
        return false
    }

    return text[text.index(before: replacementRange.lowerBound)].isNewline == false
}

private func cardEditorNeedsTrailingMarkdownSeparator(
    text: String,
    replacementRange: Range<String.Index>
) -> Bool {
    guard replacementRange.upperBound < text.endIndex else {
        return false
    }

    return text[replacementRange.upperBound].isNewline == false
}

private func cardEditorManagedMediaLabel(text: String, match: NSTextCheckingResult) -> String? {
    guard let labelRange = Range(match.range(at: 2), in: text) else {
        return nil
    }

    let label = String(text[labelRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    return label.isEmpty ? nil : label
}
