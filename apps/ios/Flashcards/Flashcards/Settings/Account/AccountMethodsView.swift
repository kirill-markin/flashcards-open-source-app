import SwiftUI

struct AccountMethodsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss
    @State private var coordinator: CloudAccountMethodCoordinator
    @State private var availability: CloudAuthMethods?
    @State private var operation: CloudAccountMethodOperation?
    @State private var presenter: UIViewController?
    @State private var task: Task<Void, Never>?
    @State private var epoch = UUID()
    @State private var busy = false
    @State private var message: String?
    @State private var email = ""
    @State private var code = ""
    @State private var proofMethod: AnalyticsAuthMethod = .email

    init(store: FlashcardsStore) {
        self._coordinator = State(initialValue: CloudAccountMethodCoordinator(
            service: CloudAccountMethodService(session: .shared),
            social: CloudSocialAuthService(session: .shared), store: store))
    }

    var body: some View {
        List {
            if self.isDemo {
                Text(accountMethodCopy(.demo))
            } else {
                if let methods = self.coordinator.methods {
                    Section(accountMethodCopy(.title)) {
                        ForEach(Array(methods.methods.enumerated()), id: \.element.target) { index, method in
                            VStack(alignment: .leading, spacing: 8) {
                                LabeledContent(method.provider.displayName,
                                    value: aiSettingsLocalized(method.status == .active ? "common.on" : "common.off",
                                        method.status == .active ? "On" : "Off"))
                                LabeledContent(accountMethodCopy(.generation), value: method.generation)
                                    .font(.caption).textSelection(.enabled)
                                if method.revocationPending { Text(accountMethodCopy(.cleanup)).foregroundStyle(.secondary) }
                                if self.operation == nil && !self.coordinator.isConnecting {
                                    if method.status == .active {
                                        Button(accountMethodCopy(.unlink), role: .destructive) { self.select(.unlink(method.target)) }
                                            .accessibilityIdentifier("accountMethods.unlink.\(index)")
                                    } else if !method.revocationPending && self.isAvailable(method.provider) {
                                        Button(accountMethodCopy(.reenable)) { self.select(.reenable(method.target)) }
                                            .accessibilityIdentifier("accountMethods.reenable.\(index)")
                                    }
                                }
                            }
                        }
                        if self.operation == nil && !self.coordinator.isConnecting {
                            ForEach([CloudAuthProvider.apple, .google], id: \.self) { provider in
                                if self.isAvailable(provider) {
                                    Button { self.select(.link(provider)) } label: {
                                        Text("\(accountMethodCopy(.link)): \(provider.displayName)")
                                    }
                                    .accessibilityIdentifier("accountMethods.link.\(provider.rawValue)")
                                }
                            }
                        }
                    }
                    .disabled(self.busy)
                    Section {
                        ForEach(methods.verifiedRecoveryEmails, id: \.self) { address in
                            Label(address, systemImage: "envelope").textSelection(.enabled)
                        }
                    } footer: { Text(accountMethodCopy(.readOnly)) }
                }
                if self.operation == nil && !self.coordinator.isConnecting && self.availability?.supportsAccountConnection == true {
                    Section {
                        Button(connectionCopy(.title)) {
                            self.run { try self.coordinator.selectConnection() }
                        }.accessibilityIdentifier("accountMethods.connect")
                        if self.store.cloudNativeSignIn.availableConnectionSuggestion(store: self.store) != nil {
                            Button(connectionCopy(.suggestion)) { self.run { try await self.coordinator.adoptConnectionSuggestion() } }
                                .accessibilityIdentifier("accountMethods.adoptSuggestion")
                        }
                    }.disabled(self.busy)
                }
                if self.coordinator.isConnecting {
                    Section(connectionCopy(.title)) { self.connectionControls }
                        .disabled(self.busy)
                }
                if let operation = self.operation {
                    Section {
                        Text("\(accountMethodOperationTitle(operation)): \(operation.provider.displayName)")
                            .font(.headline)
                        self.proofControls(operation)
                    }
                    .disabled(self.busy)
                }
                if let message = self.message { Text(message).foregroundStyle(.red).accessibilityIdentifier("accountMethods.error") }
                if self.coordinator.refreshError != nil { Text(accountMethodCopy(.refreshFailed)).foregroundStyle(.red) }
                if self.coordinator.activeReenableMethodAfterFailure != nil {
                    Text(aiSettingsLocalized("common.on", "On"))
                }
                if self.coordinator.confirmedOperation != nil { Text(aiSettingsLocalized("common.done", "Done")) }
                if self.busy { ProgressView().accessibilityIdentifier("accountMethods.progress") }
                Button(self.operation == nil && !self.coordinator.isConnecting ? aiSettingsLocalized("common.retry", "Retry")
                    : aiSettingsLocalized("settings.account.cloudSignIn.restart", "Start again")) { self.startOver() }
                    .disabled(self.busy)
                    .accessibilityIdentifier("accountMethods.refresh")
            }
        }
        .navigationTitle(accountMethodCopy(.title))
        .accessibilityIdentifier("accountMethods.screen")
        .background(AccountMethodPresenter(onReady: { if self.presenter !== $0 { self.presenter = $0 } }).frame(width: 0, height: 0))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(aiSettingsLocalized("common.close", "Close")) { self.stop(); self.dismiss() }
            }
        }
        .task(id: self.identity) { self.startOver() }
        .onDisappear { self.stop() }
    }

    @ViewBuilder
    private func proofControls(_ operation: CloudAccountMethodOperation?) -> some View {
        switch self.coordinator.stage {
        case .ready:
            Text(accountMethodCopy(.confirmCurrent))
            ForEach([CloudAuthProvider.apple, .google], id: \.self) { provider in
                if self.isAvailable(provider), self.coordinator.methods?.methods.contains(where: {
                    $0.provider == provider && $0.status == .active
                }) == true {
                    CloudBrandedProviderButton(provider: provider, onPress: { presenter in
                        guard !self.busy else { return }
                        self.proofMethod = provider.analyticsMethod
                        Analytics.track(.authMethodSelected(method: self.proofMethod, screen: .settings))
                        self.run {
                            try await self.coordinator.beginProviderReauthentication(provider: provider,
                                operation: operation, presentation: try CloudNativeAuthPresentation(viewController: presenter))
                        }
                    })
                    .accessibilityIdentifier("accountMethods.reauth.\(provider.rawValue)")
                }
            }
            if self.coordinator.canReauthenticateWithCurrentEmail {
                Button {
                    guard !self.busy else { return }
                    self.proofMethod = .email
                    Analytics.track(.authMethodSelected(method: .email, screen: .settings))
                    self.requestCode { try await self.coordinator.beginCurrentEmailReauthentication(operation: operation) }
                } label: { Label(aiSettingsLocalized("common.email", "Email"), systemImage: "envelope") }
                .accessibilityIdentifier("accountMethods.reauth.email")
            }
        case .proofReady:
            if operation == nil {
                Button(aiSettingsLocalized("common.continue", "Continue")) { self.run { try await self.coordinator.beginConnection() } }
                    .accessibilityIdentifier("accountMethods.beginConnection")
            } else if case .some(.unlink) = operation {
                Button(accountMethodCopy(.unlink), role: .destructive) { self.mutate() }
                    .accessibilityIdentifier("accountMethods.confirmUnlink")
            } else if let operation {
                Text(accountMethodCopy(.confirmNewProvider))
                CloudBrandedProviderButton(provider: operation.provider, onPress: { presenter in
                    self.presenter = presenter
                    self.mutate()
                }).accessibilityIdentifier("accountMethods.confirmProvider")
            }
        case .currentEmailCodeSent, .mailboxCodeSent:
            if case .currentEmailCodeSent = self.coordinator.stage,
               let email = self.store.cloudRuntime.activeCloudSession()?.email {
                Label(email, systemImage: "envelope").textSelection(.enabled)
            }
            Text(aiSettingsLocalized("settings.account.cloudSignIn.mailboxPrompt",
                "Verify access to your email. Enter the 6–8 digit code. Check spam if needed."))
            TextField(aiSettingsLocalized("settings.account.cloudSignIn.oneTimeCode", "One-time code"), text: self.$code)
                .keyboardType(.numberPad).textContentType(.oneTimeCode).accessibilityIdentifier("accountMethods.code")
            Button(aiSettingsLocalized("common.continue", "Continue")) { self.verifyCode() }
                .disabled(normalizedOtpCode(self.code).range(of: "^[0-9]{6,8}$", options: .regularExpression) == nil)
                .accessibilityIdentifier("accountMethods.verify")
        case .mailboxRequired:
            Text(aiSettingsLocalized("settings.account.cloudSignIn.mailboxPrompt",
                "Verify access to your email. Enter the 6–8 digit code. Check spam if needed."))
            TextField(aiSettingsLocalized("common.email", "Email"), text: self.$email)
                .keyboardType(.emailAddress).textContentType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("accountMethods.mailbox")
            Button(aiSettingsLocalized("settings.account.cloudSignIn.sendOneTimeCode", "Send one-time code")) {
                let email = normalizedCloudEmail(self.email)
                self.requestCode { try await self.coordinator.sendMailboxCode(email: email) }
            }.disabled(!cloudAccountMailboxIsValid(normalizedCloudEmail(self.email)))
                .accessibilityIdentifier("accountMethods.sendMailbox")
        case .failed:
            if self.coordinator.activeReenableMethodAfterFailure == nil && self.coordinator.confirmedOperation == nil {
                Text(accountMethodCopy(.fresh))
            }
        default: EmptyView()
        }
    }

    @ViewBuilder
    private var connectionControls: some View {
        if let outcome = self.coordinator.connectionOutcome {
            Text(outcome == .connected ? connectionCopy(.connected)
                : outcome == .alreadyConnected ? connectionCopy(.alreadyConnected) : connectionCopy(.cancelled))
                .accessibilityIdentifier("accountMethods.connectionOutcome")
        } else if let preview = self.coordinator.connectionPreview {
            Text(connectionCopy(.data))
            Text(connectionCopy(.settings))
            Text(connectionCopy(.billing))
            ForEach(preview.choices.preview.workspaces, id: \.workspace.workspace_id) { entry in
                let id = entry.workspace.workspace_id
                if preview.choices.preview.workspaceIds.contains(id) {
                    LabeledContent(entry.workspace.name,
                        value: id == preview.choices.preview.selectedWorkspaceId ? connectionCopy(.destination)
                            : preview.choices.preview.suppressedWorkspaceIds.contains(id) ? connectionCopy(.hidden) : "")
                    if preview.omissionCandidateWorkspaceIds.contains(id) {
                        Toggle(connectionCopy(.omit), isOn: Binding(
                            get: { preview.choices.omittedWorkspaceIds.contains(id) },
                            set: { omitted in
                                let ids = preview.choices.omittedWorkspaceIds.filter { $0 != id } + (omitted ? [id] : [])
                                self.run { try await self.coordinator.previewConnection(omittedWorkspaceIds: ids) }
                            }
                        ))
                        .accessibilityIdentifier("accountMethods.omitWorkspace.\(id)")
                    }
                }
            }
            Text(connectionCopy(.preserve))
            Button(connectionCopy(.confirm)) { self.run { try await self.coordinator.confirmConnection() } }
                .accessibilityIdentifier("accountMethods.confirmConnection")
        } else if self.coordinator.connectionConfirmation != nil {
            Text(connectionCopy(.uncertain))
            Button(connectionCopy(.replay)) { self.run { try await self.coordinator.confirmConnection() } }
                .accessibilityIdentifier("accountMethods.replayConnection")
        } else if let target = self.coordinator.connectionEmail {
            Label(target, systemImage: "envelope").textSelection(.enabled)
                .accessibilityIdentifier("accountMethods.connectionEmailTarget")
            Text(aiSettingsLocalized("settings.account.cloudSignIn.mailboxPrompt",
                "Verify access to your email. Enter the 6–8 digit code. Check spam if needed."))
            TextField(aiSettingsLocalized("settings.account.cloudSignIn.oneTimeCode", "One-time code"), text: self.$code)
                .keyboardType(.numberPad).textContentType(.oneTimeCode).accessibilityIdentifier("accountMethods.connectionCode")
            Button(aiSettingsLocalized("common.continue", "Continue")) {
                let code = normalizedOtpCode(self.code)
                self.run { try await self.coordinator.verifyConnectionEmail(code) }
            }.disabled(normalizedOtpCode(self.code).range(of: "^[0-9]{6,8}$", options: .regularExpression) == nil)
        } else if self.coordinator.connectionOperation != nil {
            if case .failed = self.coordinator.stage {
                Button(connectionCopy(.preview)) { self.run { try await self.coordinator.previewConnection(omittedWorkspaceIds: []) } }
                    .accessibilityIdentifier("accountMethods.refreshPreview")
            } else {
                Text(accountMethodCopy(.confirmNewProvider))
                ForEach([CloudAuthProvider.apple, .google], id: \.self) { provider in
                    if self.isAvailable(provider) {
                        CloudBrandedProviderButton(provider: provider, onPress: { presenter in
                            self.run { try await self.coordinator.proveConnectionProvider(provider,
                                presentation: try CloudNativeAuthPresentation(viewController: presenter)) }
                        }).accessibilityIdentifier("accountMethods.connectionProvider.\(provider.rawValue)")
                    }
                }
                TextField(aiSettingsLocalized("common.email", "Email"), text: self.$email)
                    .keyboardType(.emailAddress).textContentType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("accountMethods.connectionEmail")
                Button(aiSettingsLocalized("settings.account.cloudSignIn.sendOneTimeCode", "Send one-time code")) {
                    let email = normalizedCloudEmail(self.email)
                    self.run { try await self.coordinator.sendConnectionEmail(email) }
                }.disabled(!cloudAccountMailboxIsValid(normalizedCloudEmail(self.email)))
            }
        } else {
            self.proofControls(nil)
        }
        if self.coordinator.connectionOperation != nil && self.coordinator.connectionOutcome == nil {
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {
                self.run { try await self.coordinator.cancelConnection() }
            }.accessibilityIdentifier("accountMethods.cancelConnection")
        }
    }

    private var identity: AccountMethodViewIdentity {
        AccountMethodViewIdentity(configuration: try? self.store.currentCloudServiceConfiguration(),
            userId: self.store.cloudSettings?.linkedUserId, state: self.store.cloudSettings?.cloudState)
    }

    private var isDemo: Bool {
        self.store.cloudRuntime.activeCloudSession()?.email?.lowercased().hasSuffix("@example.com") == true
    }

    private func isAvailable(_ provider: CloudAuthProvider) -> Bool {
        guard let availability = self.availability else { return false }
        switch provider {
        case .apple: if case .native = availability.methods.apple { return true }
        case .google: if case .native = availability.methods.google { return true }
        }
        return false
    }

    private func select(_ operation: CloudAccountMethodOperation) {
        guard !self.busy else { return }
        self.operation = operation
        self.message = nil
        self.code = ""
        self.email = ""
    }

    private func stop() {
        self.epoch = UUID()
        self.task?.cancel()
        self.task = nil
        self.coordinator.onObservation = nil
        self.coordinator.cancel()
        self.availability = nil
        self.busy = false
    }

    private func startOver() {
        self.stop()
        self.operation = nil
        self.code = ""
        self.email = ""
        self.message = nil
        guard !self.isDemo else { return }
        let epoch = self.epoch
        let identity = self.identity
        self.coordinator.onObservation = { observation in
            guard self.epoch == epoch, self.identity == identity, !Task.isCancelled else { return }
            recordAccountMethodObservation(observation)
        }
        self.run {
            try await self.coordinator.load()
            let configuration = try self.store.currentCloudServiceConfiguration()
            let availability = try await CloudSocialAuthService(session: .shared).metadata(
                client: .currentNative, authBaseUrl: configuration.authBaseUrl)
            guard self.epoch == epoch, !Task.isCancelled,
                  try self.store.currentCloudServiceConfiguration() == configuration else { throw CancellationError() }
            self.availability = availability
        }
    }

    private func mutate() {
        guard !self.busy else { return }
        guard let presenter = self.presenter else { self.message = accountMethodCopy(.fresh); return }
        if let operation = self.operation {
            switch operation {
            case .unlink: break
            case .link, .reenable: self.proofMethod = operation.provider.analyticsMethod
            }
        }
        self.run {
            try await self.coordinator.performMutation(presentation: try CloudNativeAuthPresentation(viewController: presenter))
        }
    }

    private func requestCode(_ action: @escaping @MainActor () async throws -> Void) {
        guard !self.busy else { return }
        self.code = ""
        let method = self.proofMethod
        let epoch = self.epoch
        let identity = self.identity
        self.run {
            try await action()
            guard self.epoch == epoch, self.identity == identity else { throw CancellationError() }
            Analytics.track(.authCodeFormShown(method: method, screen: .settings))
        }
    }

    private func verifyCode() {
        guard !self.busy else { return }
        let code = normalizedOtpCode(self.code)
        let currentEmail: Bool
        if case .currentEmailCodeSent = self.coordinator.stage { currentEmail = true } else { currentEmail = false }
        Analytics.track(.authCodeSubmitted(method: self.proofMethod, screen: .settings))
        self.run {
            if currentEmail { try await self.coordinator.verifyCurrentEmailCode(code) }
            else { try await self.coordinator.verifyMailboxCode(code) }
        }
    }

    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        guard !self.busy else { return }
        self.busy = true
        self.message = nil
        let epoch = self.epoch
        let identity = self.identity
        self.task = Task { @MainActor in
            defer { if self.epoch == epoch { self.busy = false } }
            do {
                try Task.checkCancellation()
                try await action()
                guard self.epoch == epoch, self.identity == identity else { return }
                if case .mailboxRequired = self.coordinator.stage {
                    self.code = ""
                    self.email = self.coordinator.mailboxChallenge?.providerEmail ?? ""
                }
            } catch {
                guard self.epoch == epoch, self.identity == identity, !isRequestCancellationError(error: error) else { return }
                if self.coordinator.activeReenableMethodAfterFailure == nil && self.coordinator.confirmedOperation == nil {
                    if self.coordinator.isConnecting, case CloudNativeAuthError.cancelled = error {
                        self.message = connectionCopy(.cancelled)
                    } else {
                        self.message = self.coordinator.connectionOutcome == .connected
                            ? connectionCopy(.restorePaused) : accountMethodErrorMessage(error)
                    }
                }
            }
        }
    }
}

