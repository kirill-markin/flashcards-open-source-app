import Foundation

private let onboardingWhitespace = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")

func onboardingDemoTrim(_ text: String) -> String {
    text.trimmingCharacters(in: onboardingWhitespace)
}

// Server equality and ordering use UTF-16, without Swift canonical-equivalence folding.
private func onboardingDemoTags(_ tags: [String]) -> [[UInt16]] {
    Array(Set(tags.map { Array($0.utf16) })).sorted { $0.lexicographicallyPrecedes($1) }
}

struct OnboardingDemoMetadata: Codable, Hashable, Sendable {
    let version: Int
    let frontText: String
    let backText: String
    let tags: [String]
    let cardType: String
    let wasEdited: Bool

    enum CodingKeys: String, CodingKey {
        case version, frontText, backText, tags, cardType, wasEdited
    }

    init(frontText: String, backText: String, tags: [String], cardType: String, wasEdited: Bool) {
        self.version = 1
        self.frontText = onboardingDemoTrim(frontText)
        self.backText = onboardingDemoTrim(backText)
        self.tags = onboardingDemoTags(tags).map { String(decoding: $0, as: UTF16.self) }
        let trimmedType = onboardingDemoTrim(cardType)
        self.cardType = trimmedType.isEmpty ? basicCardType : trimmedType
        self.wasEdited = wasEdited
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        let frontText = try container.decode(String.self, forKey: .frontText)
        guard version == 1, onboardingDemoTrim(frontText).isEmpty == false else {
            throw DecodingError.dataCorruptedError(
                forKey: .version, in: container, debugDescription: "Invalid onboarding demo baseline"
            )
        }
        let wasEdited = container.contains(.wasEdited)
            ? try container.decode(Bool.self, forKey: .wasEdited) : false
        self.init(
            frontText: frontText,
            backText: try container.decode(String.self, forKey: .backText),
            tags: try container.decode([String].self, forKey: .tags),
            cardType: try container.decode(String.self, forKey: .cardType),
            wasEdited: wasEdited
        )
    }

    func matches(frontText: String, backText: String, tags: [String], cardType: String) -> Bool {
        let candidate = OnboardingDemoMetadata(
            frontText: frontText, backText: backText, tags: tags, cardType: cardType, wasEdited: false
        )
        return Array(self.frontText.utf16) == Array(candidate.frontText.utf16)
            && Array(self.backText.utf16) == Array(candidate.backText.utf16)
            && onboardingDemoTags(self.tags) == onboardingDemoTags(candidate.tags)
            && Array(self.cardType.utf16) == Array(candidate.cardType.utf16)
    }
}

func cardMetadataAfterAuthoredEdit(card: Card, input: CardEditorInput) -> CardMetadata {
    guard let demo = card.metadata.onboardingDemo else {
        return card.metadata
    }
    let previous = OnboardingDemoMetadata(
        frontText: card.frontText, backText: card.backText, tags: card.tags,
        cardType: card.cardType, wasEdited: false
    )
    let wasEdited = demo.wasEdited
        || !demo.matches(frontText: input.frontText, backText: input.backText, tags: input.tags, cardType: card.cardType)
        || !previous.matches(frontText: input.frontText, backText: input.backText, tags: input.tags, cardType: card.cardType)
    return CardMetadata(source: card.metadata.source, onboardingDemo: OnboardingDemoMetadata(
        frontText: demo.frontText, backText: demo.backText, tags: demo.tags,
        cardType: demo.cardType, wasEdited: wasEdited
    ))
}
