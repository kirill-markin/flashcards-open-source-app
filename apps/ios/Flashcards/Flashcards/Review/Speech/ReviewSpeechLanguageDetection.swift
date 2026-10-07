import AVFAudio
import Foundation

private struct ReviewSpeechLanguageHeuristic {
    let languageTag: String
    let markers: [String]
}

private let reviewSpeechLatinLanguageHeuristics: [ReviewSpeechLanguageHeuristic] = [
    ReviewSpeechLanguageHeuristic(
        languageTag: "es-ES",
        markers: [" el ", " la ", " que ", " de ", " y ", " por ", " para ", " hola ", " gracias ", " cómo "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "fr-FR",
        markers: [" le ", " la ", " les ", " des ", " une ", " bonjour ", " merci ", " avec ", " pour ", " est "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "de-DE",
        markers: [" der ", " die ", " das ", " und ", " nicht ", " danke ", " bitte ", " ist ", " wie ", " ich "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "it-IT",
        markers: [" il ", " lo ", " gli ", " una ", " ciao ", " grazie ", " per ", " non ", " come ", " che "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "pt-PT",
        markers: [" não ", " você ", " obrigado ", " olá ", " para ", " com ", " uma ", " que ", " está "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "en-US",
        markers: [" the ", " and ", " you ", " are ", " with ", " this ", " that ", " hello ", " thanks ", " what "]
    )
]

func selectReviewSpeechVoice(languageTag: String) -> AVSpeechSynthesisVoice? {
    let normalizedTag = sanitizeReviewSpeechLanguageTag(languageTag: languageTag).lowercased()
    let primaryLanguage = normalizedTag.split(separator: "-").first.map(String.init) ?? normalizedTag

    if let directVoice = AVSpeechSynthesisVoice(language: normalizedTag) {
        return directVoice
    }

    let availableVoices = AVSpeechSynthesisVoice.speechVoices()

    if let exactVoice = availableVoices.first(where: { voice in
        voice.language.lowercased() == normalizedTag
    }) {
        return exactVoice
    }

    if let prefixVoice = availableVoices.first(where: { voice in
        voice.language.lowercased().hasPrefix("\(primaryLanguage)-")
    }) {
        return prefixVoice
    }

    return availableVoices.first(where: { voice in
        voice.language.lowercased() == primaryLanguage
    })
}

/// Splits speakable text into ordered utterances: every non-empty line separately, and within a line
/// wherever the letter script changes, so each piece gets its own voice and line breaks become pauses.
func makeReviewSpeechSegments(text: String, fallbackLanguageTag: String) -> [ReviewSpeechSegment] {
    let cjkLanguageTag = detectReviewSpeechCJKLanguage(text: text)
    let latinFallbackLanguageTag = makeReviewSpeechLatinFallbackLanguageTag(fallbackLanguageTag: fallbackLanguageTag)
    let sanitizedFallbackLanguageTag = sanitizeReviewSpeechLanguageTag(languageTag: fallbackLanguageTag)
    var segments: [ReviewSpeechSegment] = []

    for line in text.components(separatedBy: .newlines) {
        let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedLine.isEmpty {
            continue
        }

        var lineSegments: [ReviewSpeechSegment] = []
        for run in makeReviewSpeechScriptRuns(line: trimmedLine) {
            let languageTag = makeReviewSpeechRunLanguageTag(
                run: run,
                cjkLanguageTag: cjkLanguageTag,
                latinFallbackLanguageTag: latinFallbackLanguageTag,
                fallbackLanguageTag: sanitizedFallbackLanguageTag
            )

            if let previousSegment = lineSegments.last, previousSegment.languageTag == languageTag {
                lineSegments[lineSegments.count - 1] = ReviewSpeechSegment(
                    text: previousSegment.text + run.text,
                    languageTag: languageTag
                )
            } else {
                lineSegments.append(ReviewSpeechSegment(text: run.text, languageTag: languageTag))
            }
        }
        segments.append(contentsOf: lineSegments)
    }

    return segments
}

private enum ReviewSpeechScriptGroup {
    case cjk
    case cyrillic
    case greek
    case hebrew
    case arabic
    case thai
    case devanagari
    case latin
    case other
}

private struct ReviewSpeechScriptRun {
    let text: String
    /// Nil when the run has no letters at all.
    let scriptGroup: ReviewSpeechScriptGroup?
}

private struct ReviewSpeechScriptGroupPattern {
    let scriptGroup: ReviewSpeechScriptGroup
    let expression: NSRegularExpression
}

// Explicit ranges come with each Unicode Script class because `ー`, `〆`, and half-width kana marks are Script=Common.
private let reviewSpeechKanaCharacterClass: String = #"\x{3040}-\x{30FF}\x{FF65}-\x{FF9F}\p{Script=Hiragana}\p{Script=Katakana}"#
private let reviewSpeechHangulCharacterClass: String = #"\x{AC00}-\x{D7AF}\p{Script=Hangul}"#
private let reviewSpeechHanCharacterClass: String = #"\x{3006}\x{4E00}-\x{9FFF}\p{Script=Han}"#

private let reviewSpeechKanaExpression: NSRegularExpression = makeReviewContentRegularExpression(
    pattern: "[\(reviewSpeechKanaCharacterClass)]"
)
private let reviewSpeechHangulExpression: NSRegularExpression = makeReviewContentRegularExpression(
    pattern: "[\(reviewSpeechHangulCharacterClass)]"
)
private let reviewSpeechNeutralLetterExpression: NSRegularExpression = makeReviewContentRegularExpression(
    pattern: #"[\p{Script=Common}\p{Script=Inherited}]"#
)

private let reviewSpeechScriptGroupPatterns: [ReviewSpeechScriptGroupPattern] = [
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .latin,
        expression: makeReviewContentRegularExpression(pattern: #"\p{Script=Latin}"#)
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .cyrillic,
        expression: makeReviewContentRegularExpression(pattern: #"[\x{0400}-\x{04FF}\p{Script=Cyrillic}]"#)
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .cjk,
        expression: makeReviewContentRegularExpression(
            pattern: "[\(reviewSpeechKanaCharacterClass)\(reviewSpeechHangulCharacterClass)\(reviewSpeechHanCharacterClass)]"
        )
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .greek,
        expression: makeReviewContentRegularExpression(pattern: #"[\x{0370}-\x{03FF}\p{Script=Greek}]"#)
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .hebrew,
        expression: makeReviewContentRegularExpression(pattern: #"[\x{0590}-\x{05FF}\p{Script=Hebrew}]"#)
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .arabic,
        expression: makeReviewContentRegularExpression(pattern: #"[\x{0600}-\x{06FF}\p{Script=Arabic}]"#)
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .thai,
        expression: makeReviewContentRegularExpression(pattern: #"[\x{0E00}-\x{0E7F}\p{Script=Thai}]"#)
    ),
    ReviewSpeechScriptGroupPattern(
        scriptGroup: .devanagari,
        expression: makeReviewContentRegularExpression(pattern: #"[\x{0900}-\x{097F}\p{Script=Devanagari}]"#)
    )
]

/// Leading non-letters join the first run and trailing ones the last run. Non-letters between two runs of different
/// scripts are split after their last whitespace, so an opening `¿` or `(` belongs to the run it opens.
private func makeReviewSpeechScriptRuns(line: String) -> [ReviewSpeechScriptRun] {
    var runs: [ReviewSpeechScriptRun] = []
    var runText: String = ""
    var runScriptGroup: ReviewSpeechScriptGroup? = nil
    // Non-letters after the current run's last letter, held until the next letter decides where they belong.
    var heldNeutrals: String = ""

    for character in line {
        guard let scriptGroup = reviewSpeechScriptGroup(character: character) else {
            if runScriptGroup == nil {
                runText.append(character)
            } else {
                heldNeutrals.append(character)
            }
            continue
        }

        if let currentScriptGroup = runScriptGroup, currentScriptGroup != scriptGroup {
            var previousRunNeutrals: String = heldNeutrals
            var nextRunNeutrals: String = ""
            if let lastWhitespaceIndex = heldNeutrals.lastIndex(where: { heldCharacter in heldCharacter.isWhitespace }) {
                previousRunNeutrals = String(heldNeutrals[...lastWhitespaceIndex])
                nextRunNeutrals = String(heldNeutrals[heldNeutrals.index(after: lastWhitespaceIndex)...])
            }
            runs.append(ReviewSpeechScriptRun(text: runText + previousRunNeutrals, scriptGroup: currentScriptGroup))
            runText = nextRunNeutrals
        } else {
            runText.append(heldNeutrals)
        }
        heldNeutrals = ""
        runScriptGroup = scriptGroup
        runText.append(character)
    }

    runText.append(heldNeutrals)
    if runText.isEmpty == false {
        runs.append(ReviewSpeechScriptRun(text: runText, scriptGroup: runScriptGroup))
    }

    return runs
}

/// Nil for neutral characters: non-letters (combining marks included) and Common or Inherited script letters such as `ˈ`.
private func reviewSpeechScriptGroup(character: Character) -> ReviewSpeechScriptGroup? {
    guard let scalar = character.unicodeScalars.first else {
        return nil
    }

    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter:
        break
    default:
        return nil
    }

    let scalarText = String(Character(scalar))
    if let matchingPattern = reviewSpeechScriptGroupPatterns.first(where: { pattern in
        pattern.expression.matches(scalarText)
    }) {
        return matchingPattern.scriptGroup
    }
    if reviewSpeechNeutralLetterExpression.matches(scalarText) {
        return nil
    }

    return .other
}

/// A run's language comes from its script group, so neutral characters attached to the run never change it.
private func makeReviewSpeechRunLanguageTag(
    run: ReviewSpeechScriptRun,
    cjkLanguageTag: String,
    latinFallbackLanguageTag: String,
    fallbackLanguageTag: String
) -> String {
    guard let scriptGroup = run.scriptGroup else {
        return fallbackLanguageTag
    }

    switch scriptGroup {
    case .cjk:
        return cjkLanguageTag
    case .cyrillic:
        return "ru-RU"
    case .greek:
        return "el-GR"
    case .hebrew:
        return "he-IL"
    case .arabic:
        return "ar-SA"
    case .thai:
        return "th-TH"
    case .devanagari:
        return "hi-IN"
    case .latin:
        return detectReviewSpeechLatinLanguage(text: run.text, fallbackLanguageTag: latinFallbackLanguageTag)
    case .other:
        return fallbackLanguageTag
    }
}

/// Scans every character of the whole text, kana-block punctuation such as `・` included, so all CJK runs share one language.
private func detectReviewSpeechCJKLanguage(text: String) -> String {
    if reviewSpeechKanaExpression.matches(text) {
        return "ja-JP"
    }
    if reviewSpeechHangulExpression.matches(text) {
        return "ko-KR"
    }

    return "zh-CN"
}

/// Latin text without a language hint keeps the UI language only when that language is normally written in Latin script.
private func makeReviewSpeechLatinFallbackLanguageTag(fallbackLanguageTag: String) -> String {
    let sanitizedTag = sanitizeReviewSpeechLanguageTag(languageTag: fallbackLanguageTag)
    let maximalLanguage = Locale.Language(identifier: Locale.Language(identifier: sanitizedTag).maximalIdentifier)

    // A language whose script cannot be resolved counts as Latin.
    guard let script = maximalLanguage.script, script.identifier != "Latn" else {
        return sanitizedTag
    }

    return "en-US"
}

private func detectReviewSpeechLatinLanguage(text: String, fallbackLanguageTag: String) -> String {
    let normalizedText = " \(text.lowercased()) "

    if reviewSpeechContains(pattern: #"[¿¡ñ]"#, text: normalizedText) {
        return "es-ES"
    }
    if reviewSpeechContains(pattern: #"[äöüß]"#, text: normalizedText) {
        return "de-DE"
    }
    if reviewSpeechContains(pattern: #"[ãõ]"#, text: normalizedText) {
        return "pt-PT"
    }
    if reviewSpeechContains(pattern: #"[àèìòù]"#, text: normalizedText) {
        return "it-IT"
    }
    if reviewSpeechContains(pattern: #"[çœæ]"#, text: normalizedText) {
        return "fr-FR"
    }

    var bestLanguageTag: String? = nil
    var bestScore = 0

    for heuristic in reviewSpeechLatinLanguageHeuristics {
        let score = heuristic.markers.reduce(into: 0) { currentScore, marker in
            if normalizedText.contains(marker) {
                currentScore += 1
            }
        }

        if score > bestScore {
            bestScore = score
            bestLanguageTag = heuristic.languageTag
        }
    }

    if let bestLanguageTag, bestScore > 0 {
        return bestLanguageTag
    }

    return sanitizeReviewSpeechLanguageTag(languageTag: fallbackLanguageTag)
}

private func sanitizeReviewSpeechLanguageTag(languageTag: String) -> String {
    let normalizedTag = languageTag.replacingOccurrences(of: "_", with: "-")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    return normalizedTag.isEmpty ? "en-US" : normalizedTag
}

private func reviewSpeechContains(pattern: String, text: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
}
