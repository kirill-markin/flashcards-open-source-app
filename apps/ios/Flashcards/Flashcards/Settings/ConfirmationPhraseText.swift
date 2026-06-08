import Foundation
import SwiftUI

private let confirmationPhraseLongTokenBreakThreshold: Int = 24
private let confirmationPhraseBreakOpportunity: String = "\u{200B}"

struct ConfirmationPhraseText: View {
    let text: String

    var body: some View {
        Text(confirmationPhraseDisplayText(text: self.text))
            .font(.body.monospaced())
            .lineLimit(nil)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(self.text)
    }
}

private func confirmationPhraseDisplayText(text: String) -> String {
    var result: String = ""
    var token: String = ""

    for character in text {
        if confirmationPhraseIsWhitespace(character: character) {
            result += confirmationPhraseDisplayToken(token: token)
            token = ""
            result.append(character)
        } else {
            token.append(character)
        }
    }

    result += confirmationPhraseDisplayToken(token: token)
    return result
}

private func confirmationPhraseDisplayToken(token: String) -> String {
    if token.count <= confirmationPhraseLongTokenBreakThreshold {
        return token
    }
    if confirmationPhraseIsAsciiToken(token: token) == false {
        return token
    }

    return token.map { String($0) }.joined(separator: confirmationPhraseBreakOpportunity)
}

private func confirmationPhraseIsAsciiToken(token: String) -> Bool {
    token.unicodeScalars.allSatisfy { scalar in
        scalar.isASCII
    }
}

private func confirmationPhraseIsWhitespace(character: Character) -> Bool {
    character.unicodeScalars.allSatisfy { scalar in
        CharacterSet.whitespacesAndNewlines.contains(scalar)
    }
}
