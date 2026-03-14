import Foundation
import XCTest
@testable import Flashcards

func testBootstrapSnapshot(database: LocalDatabase) throws -> AppBootstrapSnapshot {
    try database.loadBootstrapSnapshot()
}

func testWorkspaceId(database: LocalDatabase) throws -> String {
    try testBootstrapSnapshot(database: database).workspace.workspaceId
}

func testUserSettings(database: LocalDatabase) throws -> UserSettings {
    try testBootstrapSnapshot(database: database).userSettings
}

func testSchedulerSettings(database: LocalDatabase) throws -> WorkspaceSchedulerSettings {
    try testBootstrapSnapshot(database: database).schedulerSettings
}

func testCloudSettings(database: LocalDatabase) throws -> CloudSettings {
    try testBootstrapSnapshot(database: database).cloudSettings
}

func testActiveCards(database: LocalDatabase) throws -> [Card] {
    try database.loadActiveCards(workspaceId: testWorkspaceId(database: database))
}

func testFirstActiveCard(database: LocalDatabase) throws -> Card {
    try XCTUnwrap(try testActiveCards(database: database).first)
}

func testActiveDecks(database: LocalDatabase) throws -> [Deck] {
    try database.loadActiveDecks(workspaceId: testWorkspaceId(database: database))
}

func testFirstActiveDeck(database: LocalDatabase) throws -> Deck {
    try XCTUnwrap(try testActiveDecks(database: database).first)
}
