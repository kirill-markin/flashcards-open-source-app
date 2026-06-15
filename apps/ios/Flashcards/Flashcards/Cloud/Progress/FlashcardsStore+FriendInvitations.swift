import Foundation

private let friendInvitationDisplayNameMaxLength: Int = 30

enum FriendInvitationDisplayNameValidationError: LocalizedError {
    case invalidLength
    case invalidCharacters

    var errorDescription: String? {
        switch self {
        case .invalidLength:
            return String(
                localized: "progress.friend_invite.validation.length",
                defaultValue: "Enter 1-30 characters.",
                table: progressStringsTableName,
                comment: "Validation error for a friend invite display name with an invalid trimmed length"
            )
        case .invalidCharacters:
            return String(
                localized: "progress.friend_invite.validation.characters",
                defaultValue: "Newlines and control characters are not allowed.",
                table: progressStringsTableName,
                comment: "Validation error for a friend invite display name containing control characters or newlines"
            )
        }
    }
}

func normalizedFriendInvitationDisplayName(input: String) throws -> String {
    if containsFriendInvitationDisallowedScalars(input: input) {
        throw FriendInvitationDisplayNameValidationError.invalidCharacters
    }

    let normalizedDisplayName = input.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedDisplayNameLength = normalizedDisplayName.unicodeScalars.count
    guard normalizedDisplayNameLength >= 1,
          normalizedDisplayNameLength <= friendInvitationDisplayNameMaxLength else {
        throw FriendInvitationDisplayNameValidationError.invalidLength
    }

    return normalizedDisplayName
}

private func containsFriendInvitationDisallowedScalars(input: String) -> Bool {
    input.unicodeScalars.contains { scalar in
        CharacterSet.controlCharacters.contains(scalar) || CharacterSet.newlines.contains(scalar)
    }
}

@MainActor
extension FlashcardsStore {
    func createFriendInvitation(
        inviteeDisplayName: String
    ) async throws -> FriendInvitationCreateResponse {
        guard self.cloudSettings?.cloudState == .linked else {
            throw LocalStoreError.validation("Friend invitations are available only for linked cloud accounts")
        }

        let normalizedDisplayName = try normalizedFriendInvitationDisplayName(input: inviteeDisplayName)

        if self.cloudRuntime.activeCloudSession() == nil {
            try await self.restoreCloudLinkFromStoredCredentials(trigger: self.manualCloudSyncTrigger(now: Date()))
        }

        let invitation = try await self.withAuthenticatedCloudSession { session in
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            return try await cloudSyncService.createFriendInvitation(
                apiBaseUrl: session.apiBaseUrl,
                bearerToken: session.bearerToken,
                inviteeDisplayName: normalizedDisplayName
            )
        }

        self.globalErrorMessage = ""
        return invitation
    }
}
