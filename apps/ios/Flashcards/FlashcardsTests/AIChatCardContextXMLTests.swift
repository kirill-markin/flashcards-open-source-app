import XCTest
@testable import Flashcards

final class AIChatCardContextXMLTests: XCTestCase {
    func testBuildAIChatCardContextXMLMatchesBackendSerializer() {
        let card = AIChatCardReference(
            cardId: "card-1",
            frontText: "Q < 1 \"x\"",
            backText: "A & 2 'y' > 0",
            tags: ["alpha", "beta"],
            effortLevel: .long
        )

        XCTAssertEqual(
            buildAIChatCardContextXML(card: card),
            [
                "<attached_card>",
                "<card_id>card-1</card_id>",
                "<effort_level>long</effort_level>",
                "<front_text>",
                "Q &lt; 1 &quot;x&quot;",
                "</front_text>",
                "<back_text>",
                "A &amp; 2 &apos;y&apos; &gt; 0",
                "</back_text>",
                "<tags><tag>alpha</tag><tag>beta</tag></tags>",
                "</attached_card>",
            ].joined(separator: "\n")
        )
    }
}
