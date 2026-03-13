import Foundation

private let localAISqlCardColumnDescriptors: [LocalAISqlColumnDescriptor] = [
    LocalAISqlColumnDescriptor(columnName: "card_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Card identifier."),
    LocalAISqlColumnDescriptor(columnName: "front_text", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card front prompt text."),
    LocalAISqlColumnDescriptor(columnName: "back_text", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card back answer text."),
    LocalAISqlColumnDescriptor(columnName: "tags", type: .stringArray, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card tags."),
    LocalAISqlColumnDescriptor(columnName: "effort_level", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Card effort level."),
    LocalAISqlColumnDescriptor(columnName: "due_at", type: .datetime, nullable: true, readOnly: true, filterable: true, sortable: true, description: "Next due timestamp."),
    LocalAISqlColumnDescriptor(columnName: "reps", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Total reps count."),
    LocalAISqlColumnDescriptor(columnName: "lapses", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Total lapses count."),
    LocalAISqlColumnDescriptor(columnName: "updated_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Last update timestamp."),
    LocalAISqlColumnDescriptor(columnName: "deleted_at", type: .datetime, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Deletion timestamp for tombstones."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_card_state", type: .string, nullable: false, readOnly: true, filterable: true, sortable: false, description: "Persisted FSRS state."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_step_index", type: .integer, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted FSRS step index."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_stability", type: .number, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted FSRS stability."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_difficulty", type: .number, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted FSRS difficulty."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_last_reviewed_at", type: .datetime, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted last reviewed timestamp."),
    LocalAISqlColumnDescriptor(columnName: "fsrs_scheduled_days", type: .integer, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Persisted scheduled interval in days."),
]

private let localAISqlResourceDescriptorsByName: [LocalAISqlResourceName: LocalAISqlResourceDescriptor] = [
    .workspace: LocalAISqlResourceDescriptor(
        resourceName: .workspace,
        description: "Selected workspace identity and scheduler settings.",
        columns: [
            LocalAISqlColumnDescriptor(columnName: "workspace_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Selected workspace identifier."),
            LocalAISqlColumnDescriptor(columnName: "name", type: .string, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Selected workspace display name."),
            LocalAISqlColumnDescriptor(columnName: "created_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Workspace creation timestamp."),
            LocalAISqlColumnDescriptor(columnName: "algorithm", type: .string, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Scheduler algorithm identifier."),
            LocalAISqlColumnDescriptor(columnName: "desired_retention", type: .number, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Workspace desired retention target."),
            LocalAISqlColumnDescriptor(columnName: "learning_steps_minutes", type: .integerArray, nullable: false, readOnly: true, filterable: false, sortable: false, description: "Configured learning steps."),
            LocalAISqlColumnDescriptor(columnName: "relearning_steps_minutes", type: .integerArray, nullable: false, readOnly: true, filterable: false, sortable: false, description: "Configured relearning steps."),
            LocalAISqlColumnDescriptor(columnName: "maximum_interval_days", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Maximum review interval in days."),
            LocalAISqlColumnDescriptor(columnName: "enable_fuzz", type: .boolean, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Whether interval fuzz is enabled."),
        ],
        writable: false
    ),
    .cards: LocalAISqlResourceDescriptor(
        resourceName: .cards,
        description: "Cards in the selected workspace.",
        columns: localAISqlCardColumnDescriptors,
        writable: true
    ),
    .decks: LocalAISqlResourceDescriptor(
        resourceName: .decks,
        description: "Decks in the selected workspace.",
        columns: [
            LocalAISqlColumnDescriptor(columnName: "deck_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Deck identifier."),
            LocalAISqlColumnDescriptor(columnName: "name", type: .string, nullable: false, readOnly: false, filterable: true, sortable: true, description: "Deck name."),
            LocalAISqlColumnDescriptor(columnName: "tags", type: .stringArray, nullable: false, readOnly: false, filterable: true, sortable: false, description: "Deck filter tags."),
            LocalAISqlColumnDescriptor(columnName: "effort_levels", type: .stringArray, nullable: false, readOnly: false, filterable: true, sortable: false, description: "Deck filter effort levels."),
            LocalAISqlColumnDescriptor(columnName: "created_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Deck creation timestamp."),
            LocalAISqlColumnDescriptor(columnName: "updated_at", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Deck last update timestamp."),
            LocalAISqlColumnDescriptor(columnName: "deleted_at", type: .datetime, nullable: true, readOnly: true, filterable: false, sortable: false, description: "Deck deletion timestamp."),
        ],
        writable: true
    ),
    .reviewEvents: LocalAISqlResourceDescriptor(
        resourceName: .reviewEvents,
        description: "Immutable review event rows.",
        columns: [
            LocalAISqlColumnDescriptor(columnName: "review_event_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Review event identifier."),
            LocalAISqlColumnDescriptor(columnName: "card_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Reviewed card identifier."),
            LocalAISqlColumnDescriptor(columnName: "device_id", type: .uuid, nullable: false, readOnly: true, filterable: true, sortable: false, description: "Device that submitted the review."),
            LocalAISqlColumnDescriptor(columnName: "client_event_id", type: .string, nullable: false, readOnly: true, filterable: true, sortable: false, description: "Client event identifier."),
            LocalAISqlColumnDescriptor(columnName: "rating", type: .integer, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Submitted review rating."),
            LocalAISqlColumnDescriptor(columnName: "reviewed_at_client", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Client review timestamp."),
            LocalAISqlColumnDescriptor(columnName: "reviewed_at_server", type: .datetime, nullable: false, readOnly: true, filterable: true, sortable: true, description: "Server review timestamp."),
        ],
        writable: false
    ),
]

func localAISqlResourceDescriptors() -> [LocalAISqlResourceDescriptor] {
    LocalAISqlResourceName.allCases.compactMap { resourceName in
        localAISqlResourceDescriptorsByName[resourceName]
    }
}

func localAISqlResourceDescriptor(resourceName: LocalAISqlResourceName) throws -> LocalAISqlResourceDescriptor {
    guard let descriptor = localAISqlResourceDescriptorsByName[resourceName] else {
        throw LocalStoreError.validation("Unknown resource: \(resourceName.rawValue)")
    }
    return descriptor
}

func localAISqlColumnDescriptor(
    resourceName: LocalAISqlResourceName,
    columnName: String
) throws -> LocalAISqlColumnDescriptor {
    let descriptor = try localAISqlResourceDescriptor(resourceName: resourceName)
    guard let columnDescriptor = descriptor.columns.first(where: { candidate in
        candidate.columnName == columnName
    }) else {
        throw LocalStoreError.validation("Unknown column for \(resourceName.rawValue): \(columnName)")
    }
    return columnDescriptor
}

func localAISqlSourceColumnDescriptors(
    source: LocalAISqlFromSource
) throws -> [String: LocalAISqlColumnDescriptor] {
    var descriptors = Dictionary(uniqueKeysWithValues: try localAISqlResourceDescriptor(resourceName: source.resourceName).columns.map { descriptor in
        (descriptor.columnName, descriptor)
    })

    if let unnestAlias = source.unnestAlias,
       let unnestColumnName = source.unnestColumnName {
        descriptors[unnestAlias] = LocalAISqlColumnDescriptor(
            columnName: unnestAlias,
            type: .string,
            nullable: false,
            readOnly: true,
            filterable: true,
            sortable: true,
            description: "Expanded \(unnestColumnName) element."
        )
    }

    return descriptors
}

func localAISqlEnsureSourceColumnExists(
    source: LocalAISqlFromSource,
    columnName: String
) throws {
    let descriptors = try localAISqlSourceColumnDescriptors(source: source)
    guard descriptors[columnName] != nil else {
        throw LocalStoreError.validation("Unknown column for \(source.resourceName.rawValue): \(columnName)")
    }
}
