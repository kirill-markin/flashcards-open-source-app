import CryptoKit
import Foundation
import Security

struct CloudAuthAttemptBinding: Hashable {
    let client: CloudAuthClient
    let codeVerifier: String

    var codeChallenge: String {
        cloudAuthBase64URL(Data(SHA256.hash(data: Data(self.codeVerifier.utf8))))
    }

    private init(client: CloudAuthClient, codeVerifier: String) {
        self.client = client
        self.codeVerifier = codeVerifier
    }

    static func generate(client: CloudAuthClient) throws -> CloudAuthAttemptBinding {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else {
            throw LocalStoreError.validation("Could not create sign-in PKCE binding: Security status \(status)")
        }
        return CloudAuthAttemptBinding(client: client, codeVerifier: cloudAuthBase64URL(Data(bytes)))
    }
}

private func cloudAuthBase64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}
