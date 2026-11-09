import Foundation

func makeReviewContentRegularExpression(pattern: String) -> NSRegularExpression {
    do {
        return try NSRegularExpression(
            pattern: pattern,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid review content regex pattern: \(pattern)")
    }
}

extension NSRegularExpression {
    func matches(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return self.firstMatch(in: text, options: [], range: range) != nil
    }

    func replacingMatches(in text: String, with replacement: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return self.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
    }
}
