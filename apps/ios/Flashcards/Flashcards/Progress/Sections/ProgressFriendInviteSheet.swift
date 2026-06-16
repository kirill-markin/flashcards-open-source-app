import SwiftUI

struct ProgressFriendInviteSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    @State private var displayName: String = ""
    @State private var invitation: FriendInvitationCreateResponse?
    @State private var errorMessage: String = ""
    @State private var isCreating: Bool = false
    @FocusState private var isDisplayNameFocused: Bool

    private var canCreateInvite: Bool {
        guard self.isCreating == false,
              self.invitation == nil else {
            return false
        }

        do {
            _ = try normalizedFriendInvitationDisplayName(input: self.displayName)
            return true
        } catch {
            return false
        }
    }

    private var validationMessage: String? {
        guard self.displayName.isEmpty == false,
              self.invitation == nil else {
            return nil
        }

        do {
            _ = try normalizedFriendInvitationDisplayName(input: self.displayName)
            return nil
        } catch {
            return Flashcards.errorMessage(error: error)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if self.errorMessage.isEmpty == false {
                    Section {
                        CopyableErrorMessageView(message: self.errorMessage)
                            .accessibilityIdentifier(UITestIdentifier.progressFriendInviteErrorMessage)
                    }
                }

                if self.invitation == nil {
                    Section {
                        Text(
                            String(
                                localized: "progress.friend_invite.description",
                                defaultValue: "Create a private friend link for the leaderboard.",
                                table: progressStringsTableName,
                                comment: "Body text explaining friend invite creation before the display name field"
                            )
                        )
                        .foregroundStyle(.secondary)
                    }
                }

                Section {
                    TextField(
                        String(
                            localized: "progress.friend_invite.display_name.label",
                            defaultValue: "Friend name on your leaderboard",
                            table: progressStringsTableName,
                            comment: "Text field label for the private friend invite display name"
                        ),
                        text: self.$displayName,
                        prompt: Text(
                            String(
                                localized: "progress.friend_invite.display_name.prompt",
                                defaultValue: "Your friend's name",
                                table: progressStringsTableName,
                                comment: "Prompt for an empty friend invite display name field"
                            )
                        )
                    )
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .focused(self.$isDisplayNameFocused)
                    .disabled(self.invitation != nil || self.isCreating)
                    .accessibilityIdentifier(UITestIdentifier.progressFriendInviteDisplayNameField)

                    if let validationMessage {
                        Text(validationMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                } footer: {
                    Text(
                        String(
                            localized: "progress.friend_invite.display_name.footer",
                            defaultValue: "Only you see this name in your leaderboard. Your friend chooses what to call you when accepting. Invite links expire in 2 days.",
                            table: progressStringsTableName,
                            comment: "Footer explaining private friend invite display names and expiration"
                        )
                    )
                }

                if let invitation {
                    Section {
                        ShareLink(
                            item: invitation.inviteUrl,
                            subject: Text(
                                String(
                                    localized: "progress.friend_invite.share_subject",
                                    defaultValue: "Flashcards friend invite",
                                    table: progressStringsTableName,
                                    comment: "Subject for sharing a created friend invite link"
                                )
                            ),
                            message: Text(
                                String(
                                    localized: "progress.friend_invite.share_message",
                                    defaultValue: "Open this Flashcards invite, sign in or sign up, and we will see each other in the app.",
                                    table: progressStringsTableName,
                                    comment: "Message for sharing a created friend invite link"
                                )
                            )
                        ) {
                            Label(
                                String(
                                    localized: "progress.friend_invite.share_button",
                                    defaultValue: "Send Invite Link",
                                    table: progressStringsTableName,
                                    comment: "Button title for sharing a created friend invite link"
                                ),
                                systemImage: "square.and.arrow.up"
                            )
                        }
                        .accessibilityIdentifier(UITestIdentifier.progressFriendInviteShareLink)

                        Text(
                            String(
                                localized: "progress.friend_invite.created_message",
                                defaultValue: "They can open it, sign in or sign up, and then you will see each other in the app. Invite links expire in 2 days.",
                                table: progressStringsTableName,
                                comment: "Message shown after creating a friend invite link"
                            )
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    } header: {
                        Text(
                            String(
                                localized: "progress.friend_invite.created_title",
                                defaultValue: "Send this link to your friend",
                                table: progressStringsTableName,
                                comment: "Section header shown after a friend invite link is created"
                            )
                        )
                    }
                }

                if self.isCreating {
                    HStack {
                        Spacer(minLength: 0)
                        ProgressView()
                        Spacer(minLength: 0)
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.progressFriendInviteSheet)
            .navigationTitle(
                String(
                    localized: "progress.friend_invite.title",
                    defaultValue: "Invite Friend",
                    table: progressStringsTableName,
                    comment: "Navigation title for the friend invite creation sheet"
                )
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(
                        String(
                            localized: "progress.friend_invite.done_button",
                            defaultValue: "Done",
                            table: progressStringsTableName,
                            comment: "Toolbar button title for dismissing the friend invite sheet"
                        )
                    ) {
                        self.dismiss()
                    }
                    .disabled(self.isCreating)
                }

                if self.invitation == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(self.createButtonTitle) {
                            Task {
                                await self.createInvite()
                            }
                        }
                        .disabled(self.canCreateInvite == false)
                        .accessibilityIdentifier(UITestIdentifier.progressFriendInviteCreateButton)
                    }
                }
            }
            .onAppear {
                self.isDisplayNameFocused = true
            }
            .onSubmit {
                guard self.canCreateInvite else {
                    return
                }

                Task {
                    await self.createInvite()
                }
            }
        }
        .interactiveDismissDisabled(self.isCreating)
    }

    private var createButtonTitle: String {
        if self.isCreating {
            return String(
                localized: "progress.friend_invite.creating_button",
                defaultValue: "Creating...",
                table: progressStringsTableName,
                comment: "Toolbar button title while creating a friend invite link"
            )
        }

        return String(
            localized: "progress.friend_invite.create_button",
            defaultValue: "Create Link",
            table: progressStringsTableName,
            comment: "Toolbar button title for creating a friend invite link"
        )
    }

    @MainActor
    private func createInvite() async {
        guard self.isCreating == false else {
            return
        }

        self.isCreating = true
        self.errorMessage = ""
        defer {
            self.isCreating = false
        }

        do {
            self.invitation = try await self.store.createFriendInvitation(
                inviteeDisplayName: self.displayName
            )
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
        }
    }
}

#Preview {
    ProgressFriendInviteSheet()
        .environment(FlashcardsStore())
}
