import Foundation

func logFlashcardsError(domain: String, action: String, metadata: [String: String]) {
    var logRecord = metadata
    logRecord["domain"] = domain
    logRecord["action"] = action

    guard JSONSerialization.isValidJSONObject(logRecord),
          let data = try? JSONSerialization.data(withJSONObject: logRecord, options: []),
          let line = String(data: data, encoding: .utf8) else {
        fputs("{\"domain\":\"ios\",\"action\":\"log_serialization_failed\"}\n", stderr)
        return
    }

    fputs(line + "\n", stderr)
}
