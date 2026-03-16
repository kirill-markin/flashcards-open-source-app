import Foundation
import XCTest
@testable import Flashcards

final class WorkspaceExportSupportTests: XCTestCase {
    func testMakeWorkspaceCardsCsvSerializesPlainFieldsWithHeader() {
        let csv = makeWorkspaceCardsCsv(cards: [
            self.makeCard(frontText: "Front", backText: "Back", tags: ["grammar"])
        ])

        XCTAssertEqual(csv, "frontText,backText,tags\r\nFront,Back,grammar\r\n")
    }

    func testMakeWorkspaceCardsCsvEscapesCommasQuotesAndMultilineValues() {
        let csv = makeWorkspaceCardsCsv(cards: [
            self.makeCard(
                frontText: "Hello, world",
                backText: "Line 1\n\"Line 2\"",
                tags: ["grammar", "verbs"]
            )
        ])

        XCTAssertEqual(
            csv,
            "frontText,backText,tags\r\n\"Hello, world\",\"Line 1\n\"\"Line 2\"\"\",\"grammar, verbs\"\r\n"
        )
    }

    func testMakeWorkspaceCardsCsvLeavesTagsCellEmptyWhenCardHasNoTags() {
        let csv = makeWorkspaceCardsCsv(cards: [
            self.makeCard(frontText: "Front", backText: "Back", tags: [])
        ])

        XCTAssertEqual(csv, "frontText,backText,tags\r\nFront,Back,\r\n")
    }

    func testMakeWorkspaceExportFilenameBuildsSluggedCsvFilename() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!

        XCTAssertEqual(
            makeWorkspaceExportFilename(
                workspaceName: "Spanish Basics",
                now: Date(timeIntervalSince1970: 1_773_657_600),
                calendar: calendar
            ),
            "spanish-basics-cards-export-2026-03-16.csv"
        )
    }

    func testPrepareWorkspaceCardsCsvExportWritesOnlyActiveCardsToCsvFile() throws {
        let database = try LocalDatabaseTestSupport.makeDatabase(testCase: self)
        let bootstrapSnapshot = try testBootstrapSnapshot(database: database)
        let workspaceId = bootstrapSnapshot.workspace.workspaceId
        let firstCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question 1",
                backText: "Answer 1",
                tags: ["grammar", "verbs"],
                effortLevel: .medium
            ),
            cardId: nil
        )
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Question 2",
                backText: "Answer 2",
                tags: [],
                effortLevel: .fast
            ),
            cardId: nil
        )
        let deletedCard = try database.saveCard(
            workspaceId: workspaceId,
            input: CardEditorInput(
                frontText: "Deleted question",
                backText: "Deleted answer",
                tags: ["deleted"],
                effortLevel: .long
            ),
            cardId: nil
        )
        _ = try database.deleteCard(workspaceId: workspaceId, cardId: deletedCard.cardId)

        let exportDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: exportDirectory)
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let exportURL = try prepareWorkspaceCardsCsvExport(
            database: database,
            workspace: bootstrapSnapshot.workspace,
            now: Date(timeIntervalSince1970: 1_773_657_600),
            calendar: calendar,
            fileManager: FileManager.default,
            temporaryDirectory: exportDirectory
        )
        let exportedCsv = try String(contentsOf: exportURL, encoding: .utf8)

        XCTAssertEqual(exportURL.lastPathComponent, "personal-cards-export-2026-03-16.csv")
        XCTAssertTrue(exportedCsv.contains("frontText,backText,tags\r\n"))
        XCTAssertTrue(exportedCsv.contains("Question 1,Answer 1,\"grammar, verbs\"\r\n"))
        XCTAssertTrue(exportedCsv.contains("Question 2,Answer 2,\r\n"))
        XCTAssertFalse(exportedCsv.contains(firstCard.cardId))
        XCTAssertFalse(exportedCsv.contains("Deleted question"))
    }

    private func makeCard(frontText: String, backText: String, tags: [String]) -> Card {
        Card(
            cardId: UUID().uuidString.lowercased(),
            workspaceId: "workspace-1",
            frontText: frontText,
            backText: backText,
            tags: tags,
            effortLevel: .medium,
            dueAt: nil,
            createdAt: "2026-03-10T10:00:00.000Z",
            reps: 0,
            lapses: 0,
            fsrsCardState: .new,
            fsrsStepIndex: nil,
            fsrsStability: nil,
            fsrsDifficulty: nil,
            fsrsLastReviewedAt: nil,
            fsrsScheduledDays: nil,
            clientUpdatedAt: "2026-03-10T10:00:00.000Z",
            lastModifiedByDeviceId: "device-1",
            lastOperationId: "operation-1",
            updatedAt: "2026-03-10T10:00:00.000Z",
            deletedAt: nil
        )
    }
}
