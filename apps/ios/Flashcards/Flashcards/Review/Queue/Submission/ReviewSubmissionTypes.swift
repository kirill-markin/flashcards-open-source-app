import Foundation

struct ReviewSubmissionContext: Hashable, Sendable {
    let selectedReviewFilter: ReviewFilter
    let reviewQueryDefinition: ReviewQueryDefinition
}

struct ReviewSubmissionRequest: Hashable, Sendable {
    let id: String
    let workspaceId: String
    let cardId: String
    let reviewContext: ReviewSubmissionContext
    let reviewSessionSignature: ReviewSessionSignature
    let cardSnapshot: Card
    let rating: ReviewRating
    let reviewedAtClient: String
    let reviewedTimeZone: String
}

struct ReviewSubmissionFailure: Identifiable, Hashable, Sendable {
    let id: String
    let message: String
}
