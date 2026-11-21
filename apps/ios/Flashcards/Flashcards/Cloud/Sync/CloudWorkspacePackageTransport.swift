import Foundation

private let cloudSyncPackageExportContentTypeInvalidCode: String = "WORKSPACE_PACKAGE_EXPORT_CONTENT_TYPE_INVALID"
private let cloudSyncPackageExportContentDispositionInvalidCode: String =
    "WORKSPACE_PACKAGE_EXPORT_CONTENT_DISPOSITION_INVALID"
private let workspacePackageImportFileName: String = "flashcards.zip"
private let workspacePackagePathSegmentAllowedCharacters: CharacterSet = {
    var allowedCharacters = CharacterSet.alphanumerics
    allowedCharacters.insert(charactersIn: "-._~")
    return allowedCharacters
}()

struct CloudWorkspacePackageTransport {
    private let httpTransport: CloudSyncHTTPTransport

    init(session: URLSession) {
        self.httpTransport = CloudSyncHTTPTransport(session: session, decoder: makeFlashcardsRemoteJSONDecoder())
    }

    func previewWorkspacePackageExport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        requestBody: WorkspacePackageExportRequest
    ) async throws -> WorkspacePackageExportPreviewResponse {
        let path = try self.workspacePackagesPath(workspaceId: workspaceId) + "/export/preview"
        var request = try self.httpTransport.makeAuthorizedRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: path,
            method: "POST"
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(requestBody)

        return try await self.httpTransport.sendAndDecode(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: true
        )
    }

    func exportWorkspacePackage(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        format: WorkspacePackageExportFormat,
        requestBody: WorkspacePackageExportRequest
    ) async throws -> WorkspacePackageExportDownloadResponse {
        let path = try self.workspacePackageExportPath(workspaceId: workspaceId, format: format)
        var request = try self.httpTransport.makeAuthorizedRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: path,
            method: "POST"
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let acceptContentTypes = format == .anki ? "\(format.contentType), application/json" : format.contentType
        request.setValue(acceptContentTypes, forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(requestBody)

        return try await self.sendAndReadWorkspacePackageExport(
            request: request,
            format: format,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl
        )
    }

    func previewWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageBytes: Data
    ) async throws -> WorkspacePackageImportPreviewResponse {
        let path = try self.workspacePackagesPath(workspaceId: workspaceId) + "/import/preview"
        var request = try self.httpTransport.makeAuthorizedRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: path,
            method: "POST"
        )
        request.setValue("application/zip", forHTTPHeaderField: "Content-Type")
        request.httpBody = packageBytes

        return try await self.httpTransport.sendAndDecode(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: true
        )
    }

    func confirmWorkspacePackageImport(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        packageBytes: Data,
        options: WorkspacePackageImportConfirmOptions
    ) async throws -> WorkspacePackageImportConfirmResponse {
        let path = try self.workspacePackagesPath(workspaceId: workspaceId) + "/import"
        let boundary = "Boundary-\(UUID().uuidString.lowercased())"
        let optionsData = try JSONEncoder().encode(options)
        guard let optionsJson = String(data: optionsData, encoding: .utf8) else {
            throw LocalStoreError.validation("Workspace package import options could not be encoded as UTF-8 JSON")
        }

        var request = try self.httpTransport.makeAuthorizedRequest(
            apiBaseUrl: apiBaseUrl,
            authorizationHeader: authorizationHeader,
            path: path,
            method: "POST"
        )
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = makeWorkspacePackageImportMultipartBody(
            boundary: boundary,
            fileName: workspacePackageImportFileName,
            packageBytes: packageBytes,
            optionsJson: optionsJson
        )

        return try await self.httpTransport.sendAndDecode(
            request: request,
            phase: .cloudSyncRequest,
            apiBaseUrl: apiBaseUrl,
            allowsRetry: false
        )
    }

    private func workspacePackagesPath(workspaceId: String) throws -> String {
        let normalizedWorkspaceId = workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedWorkspaceId.isEmpty == false else {
            throw LocalStoreError.validation("Workspace package path requires a workspace id")
        }

        guard let encodedWorkspaceId = normalizedWorkspaceId.addingPercentEncoding(
            withAllowedCharacters: workspacePackagePathSegmentAllowedCharacters
        ) else {
            throw LocalStoreError.validation("Workspace package workspace id could not be encoded: \(workspaceId)")
        }

        return "/workspaces/\(encodedWorkspaceId)/packages"
    }

    private func workspacePackageExportPath(workspaceId: String, format: WorkspacePackageExportFormat) throws -> String {
        let basePath = try self.workspacePackagesPath(workspaceId: workspaceId) + "/export"
        switch format {
        case .nibomo: return basePath
        case .anki: return "\(basePath)/anki"
        }
    }

    private func sendAndReadWorkspacePackageExport(
        request: URLRequest,
        format: WorkspacePackageExportFormat,
        phase: CloudFlowPhase,
        apiBaseUrl: String
    ) async throws -> WorkspacePackageExportDownloadResponse {
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.httpTransport.sendDataWithRetry(
                request: request,
                phase: phase,
                apiBaseUrl: apiBaseUrl,
                allowsRetry: true
            )
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                errorMessage: Flashcards.errorMessage(error: error)
            )
            throw error
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                errorMessage: "Workspace package export did not receive an HTTP response"
            )
            throw LocalStoreError.database("Workspace package export did not receive an HTTP response")
        }

        let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudSyncError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        do {
            let downloadResponse: WorkspacePackageExportDownloadResponse
            if format == .anki, httpResponse.mimeType == "application/json" {
                downloadResponse = try await self.readWorkspaceAnkiExportSignedDownload(
                    data: data,
                    httpResponse: httpResponse,
                    requestId: requestId,
                    phase: phase
                )
            } else {
                try validateWorkspacePackageExportResponseContentType(
                    httpResponse: httpResponse,
                    expectedContentType: format.contentType,
                    requestId: requestId
                )
                let fileName = try workspacePackageExportResponseFileName(
                    httpResponse: httpResponse,
                    format: format,
                    requestId: requestId
                )
                downloadResponse = .inline(data, fileName: fileName)
            }
            logCloudFlowPhase(phase: phase, outcome: "success", requestId: requestId)
            return downloadResponse
        } catch {
            if isRequestCancellationError(error: error) {
                throw error
            }
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: requestId,
                statusCode: httpResponse.statusCode,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            throw error
        }
    }

    private func readWorkspaceAnkiExportSignedDownload(
        data: Data,
        httpResponse: HTTPURLResponse,
        requestId: String?,
        phase: CloudFlowPhase
    ) async throws -> WorkspacePackageExportDownloadResponse {
        let download: WorkspacePackageExportSignedDownload
        do {
            download = try self.httpTransport.decoder.decode(WorkspacePackageExportSignedDownload.self, from: data)
        } catch {
            throw CloudSyncError.invalidResponse(
                makeCloudSyncResponseDecodingErrorDetails(requestId: requestId),
                httpResponse.statusCode
            )
        }
        guard download.fileName == workspaceAnkiExportFileName,
              download.contentType == WorkspacePackageExportFormat.anki.contentType,
              download.downloadUrl.scheme == "https",
              download.downloadUrl.host?.isEmpty == false,
              download.downloadUrl.user == nil,
              download.downloadUrl.password == nil else {
            throw LocalStoreError.validation("Anki export returned invalid signed download metadata.")
        }

        var request = URLRequest(url: download.downloadUrl)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        let (temporaryFile, response) = try await sendCloudSyncRequestWithRetry(
            phase: phase,
            apiBaseUrl: nil,
            allowsRetry: true,
            httpMethod: request.httpMethod,
            endpointPath: nil
        ) {
            do {
                return try await self.httpTransport.session.download(for: request)
            } catch {
                throw sanitizedWorkspaceAnkiExportDownloadError(error: error)
            }
        }

        do {
            guard let signedResponse = response as? HTTPURLResponse else {
                throw LocalStoreError.database("Anki export download did not receive an HTTP response.")
            }
            guard signedResponse.statusCode == 200 else {
                throw LocalStoreError.database("Anki export download returned HTTP \(signedResponse.statusCode).")
            }
            try validateWorkspacePackageExportResponseContentType(
                httpResponse: signedResponse,
                expectedContentType: download.contentType,
                requestId: requestId
            )
            let fileURL = try await prepareWorkspacePackageExportFile(fileName: download.fileName) { fileURL in
                try FileManager.default.moveItem(at: temporaryFile, to: fileURL)
            }
            return .file(fileURL)
        } catch {
            if FileManager.default.fileExists(atPath: temporaryFile.path) {
                try FileManager.default.removeItem(at: temporaryFile)
            }
            throw error
        }
    }
}

private func sanitizedWorkspaceAnkiExportDownloadError(error: Error) -> Error {
    if isRequestCancellationError(error: error) {
        return CancellationError()
    }
    // Signed URLs are stored in URLSession error userInfo.
    if let code = flashcardsURLErrorCode(error: error, remainingDepth: 4) {
        return URLError(code)
    }
    let transportError = error as NSError
    return LocalStoreError.database("Anki export download failed (\(transportError.domain) \(transportError.code)).")
}

private func validateWorkspacePackageExportResponseContentType(
    httpResponse: HTTPURLResponse,
    expectedContentType: String,
    requestId: String?
) throws {
    let responseContentType = httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""
    let normalizedContentType = responseContentType
        .split(separator: ";", maxSplits: 1)
        .first?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""
    guard normalizedContentType == expectedContentType else {
        throw CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "Workspace package export returned Content-Type '\(responseContentType)' instead of \(expectedContentType).",
                requestId: requestId,
                code: cloudSyncPackageExportContentTypeInvalidCode,
                syncConflict: nil
            ),
            httpResponse.statusCode
        )
    }
}

private func workspacePackageExportResponseFileName(
    httpResponse: HTTPURLResponse,
    format: WorkspacePackageExportFormat,
    requestId: String?
) throws -> String {
    let contentDisposition = httpResponse.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    let fileName = workspacePackageExportContentDispositionFileName(contentDisposition: contentDisposition)
    guard let fileName, workspacePackageExportFileNameIsSafe(fileName: fileName),
          format == .nibomo || fileName == workspaceAnkiExportFileName else {
        throw CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "Workspace package export returned an invalid Content-Disposition header.",
                requestId: requestId,
                code: cloudSyncPackageExportContentDispositionInvalidCode,
                syncConflict: nil
            ),
            httpResponse.statusCode
        )
    }

    return fileName
}

private func workspacePackageExportContentDispositionFileName(contentDisposition: String) -> String? {
    for parameter in contentDisposition.components(separatedBy: ";").dropFirst() {
        let parts = parameter.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else {
            continue
        }
        let key = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard key == "filename" else {
            continue
        }

        let value = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
        return workspacePackageExportUnquotedContentDispositionValue(value: value)
    }

    return nil
}

private func workspacePackageExportUnquotedContentDispositionValue(value: String) -> String {
    guard value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 else {
        return value
    }

    let unquotedValue = value.dropFirst().dropLast()
    return unquotedValue
        .replacingOccurrences(of: "\\\"", with: "\"")
        .replacingOccurrences(of: "\\\\", with: "\\")
}

@concurrent
func prepareWorkspacePackageExportFile(
    fileName: String,
    write: @Sendable (URL) throws -> Void
) async throws -> URL {
    try Task.checkCancellation()
    let normalizedFileName = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard workspacePackageExportFileNameIsSafe(fileName: normalizedFileName) else {
        throw LocalStoreError.validation("Workspace package export filename is invalid: \(fileName)")
    }

    let fileManager = FileManager.default
    let exportDirectory = fileManager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try fileManager.createDirectory(at: exportDirectory, withIntermediateDirectories: false)
    let fileURL = exportDirectory.appendingPathComponent(normalizedFileName, isDirectory: false)
    do {
        try write(fileURL)
        return fileURL
    } catch {
        try fileManager.removeItem(at: exportDirectory)
        throw error
    }
}

private func workspacePackageExportFileNameIsSafe(fileName: String) -> Bool {
    let trimmedFileName = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedFileName.isEmpty == false
        && trimmedFileName.rangeOfCharacter(from: .controlCharacters) == nil
        && trimmedFileName.contains("/") == false
        && trimmedFileName.contains("\\") == false
}

private func makeWorkspacePackageImportMultipartBody(
    boundary: String,
    fileName: String,
    packageBytes: Data,
    optionsJson: String
) -> Data {
    var body = Data()
    body.append(Data("--\(boundary)\r\n".utf8))
    body.append(Data("Content-Disposition: form-data; name=\"options\"\r\n".utf8))
    body.append(Data("Content-Type: application/json\r\n\r\n".utf8))
    body.append(Data(optionsJson.utf8))
    body.append(Data("\r\n".utf8))
    body.append(Data("--\(boundary)\r\n".utf8))
    body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n".utf8))
    body.append(Data("Content-Type: application/zip\r\n\r\n".utf8))
    body.append(packageBytes)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    return body
}
