import Foundation

struct TechnicalErrorPresentation: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let message: String
    let technicalDetails: String
}

func makeTechnicalErrorPresentation(id: String, technicalDetails: String) -> TechnicalErrorPresentation {
    TechnicalErrorPresentation(
        id: id,
        title: localizedTechnicalErrorTitle(),
        message: localizedTechnicalErrorMessage(),
        technicalDetails: technicalDetails
    )
}

func makeTechnicalErrorPreviewPresentation() -> TechnicalErrorPresentation {
    makeTechnicalErrorPresentation(
        id: "technical-error-preview",
        technicalDetails: """
        Preview technical details
        Request ID: preview-request-id
        Status: 599
        Reason: deterministic preview error
        """
    )
}

private func localizedTechnicalErrorTitle() -> String {
    String(
        localized: "technical_error.generic.title",
        defaultValue: "Something went wrong",
        table: "Foundation",
        comment: "Generic technical error sheet title"
    )
}

private func localizedTechnicalErrorMessage() -> String {
    String(
        localized: "technical_error.generic.message",
        defaultValue: "Try again. If it keeps happening, share the technical details with support.",
        table: "Foundation",
        comment: "Generic technical error sheet user-safe message"
    )
}
