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

func detectReviewSpeechLanguage(text: String, fallbackLanguageTag: String) -> String {
    let normalizedText = " \(text.lowercased()) "

    if reviewSpeechContains(pattern: #"[぀-ヿ]"#, text: normalizedText) {
        return "ja-JP"
    }
    if reviewSpeechContains(pattern: #"[가-힯]"#, text: normalizedText) {
        return "ko-KR"
    }
    if reviewSpeechContains(pattern: #"[一-鿿]"#, text: normalizedText) {
        return "zh-CN"
    }
    if reviewSpeechContains(pattern: #"[Ѐ-ӿ]"#, text: normalizedText) {
        return "ru-RU"
    }
    if reviewSpeechContains(pattern: #"[Ͱ-Ͽ]"#, text: normalizedText) {
        return "el-GR"
    }
    if reviewSpeechContains(pattern: #"[֐-׿]"#, text: normalizedText) {
        return "he-IL"
    }
    if reviewSpeechContains(pattern: #"[؀-ۿ]"#, text: normalizedText) {
        return "ar-SA"
    }
    if reviewSpeechContains(pattern: #"[฀-๿]"#, text: normalizedText) {
        return "th-TH"
    }
    if reviewSpeechContains(pattern: #"[ऀ-ॿ]"#, text: normalizedText) {
        return "hi-IN"
    }
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
