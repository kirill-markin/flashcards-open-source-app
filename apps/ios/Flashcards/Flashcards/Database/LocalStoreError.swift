import Foundation

enum LocalStoreError: LocalizedError {
    case database(String)
    case validation(String)
    case notFound(String)
    case uninitialized(String)

    var errorDescription: String? {
        switch self {
        case .database(let message):
            return message
        case .validation(let message):
            return message
        case .notFound(let message):
            return message
        case .uninitialized(let message):
            return message
        }
    }
}
