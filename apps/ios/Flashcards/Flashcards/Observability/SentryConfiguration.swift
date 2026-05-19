import Foundation
import Sentry

extension SentryObservabilityAdapter {
    static func configure(bundle: Bundle, processInfo: ProcessInfo) {
        let configuration: SentryRuntimeConfiguration = loadSentryRuntimeConfiguration(
            bundle: bundle,
            processInfo: processInfo
        )
        if let invalidTracesSampleRate: String = configuration.invalidTracesSampleRate {
            self.writeLocalRecord(
                kind: "configuration",
                feature: .appStartup,
                action: "sentry_invalid_traces_sample_rate",
                fields: [
                    "environment": configuration.environment,
                    "configured_value": invalidTracesSampleRate,
                    "fallback": "0.0"
                ]
            )
        }
        guard configuration.dsn.isEmpty == false else {
            self.state.setIsStarted(false)
            self.writeLocalRecord(
                kind: "configuration",
                feature: .appStartup,
                action: "sentry_disabled",
                fields: [
                    "environment": configuration.environment,
                    "reason": "empty_dsn"
                ]
            )
            return
        }

        SentrySDK.start { options in
            options.dsn = configuration.dsn
            options.releaseName = "\(configuration.bundleIdentifier)@\(configuration.marketingVersion)"
            options.dist = configuration.buildNumber
            options.environment = configuration.environment
            options.sampleRate = NSNumber(value: 1.0)
            options.tracesSampleRate = NSNumber(value: configuration.tracesSampleRate)
            options.sendDefaultPii = false
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.enableAutoBreadcrumbTracking = false
            options.reportAccessibilityIdentifier = false
            options.enableLogs = false
            options.enableNetworkBreadcrumbs = true
            options.enableNetworkTracking = true
            options.enableCaptureFailedRequests = false
            options.tracePropagationTargets = configuration.tracePropagationTargets
            options.enablePropagateTraceparent = true
            options.beforeBreadcrumb = { breadcrumb in
                sanitizeSentryBreadcrumb(breadcrumb)
            }
            options.beforeSend = { event in
                sanitizeSentryEvent(event)
            }
            options.beforeSendSpan = { span in
                sanitizeSentrySpan(span)
            }
        }
        self.state.setIsStarted(true)
        self.writeLocalRecord(
            kind: "configuration",
            feature: .appStartup,
            action: "sentry_enabled",
            fields: [
                "environment": configuration.environment,
                "tracesSampleRate": String(configuration.tracesSampleRate)
            ]
        )
    }
}

private struct SentryRuntimeConfiguration {
    let dsn: String
    let environment: String
    let tracesSampleRate: Double
    let invalidTracesSampleRate: String?
    let bundleIdentifier: String
    let marketingVersion: String
    let buildNumber: String
    let tracePropagationTargets: [Any]
}

private struct ParsedSentrySampleRate {
    let value: Double
    let invalidRawValue: String?
}

private let sentryEnvironmentInfoPlistKey: String = "FLASHCARDS_SENTRY_ENVIRONMENT"
private let sentryEnvironmentOverrideKey: String = "FLASHCARDS_SENTRY_ENVIRONMENT_OVERRIDE"
private let sentryCiSimulatorEnvironment: String = "ci-simulator"

private func loadSentryRuntimeConfiguration(bundle: Bundle, processInfo: ProcessInfo) -> SentryRuntimeConfiguration {
    let dsn: String = loadOptionalInfoPlistString(
        bundle: bundle,
        key: "FLASHCARDS_SENTRY_DSN"
    )
    let environment: String = loadSentryEnvironment(bundle: bundle, processInfo: processInfo)
    let rawTracesSampleRate: String = nonEmptyString(
        loadOptionalInfoPlistString(
            bundle: bundle,
            key: "FLASHCARDS_SENTRY_TRACES_SAMPLE_RATE"
        ),
        fallback: "0.0"
    )
    let parsedTracesSampleRate: ParsedSentrySampleRate = parseSentrySampleRate(rawTracesSampleRate)
    let bundleIdentifier: String = nonEmptyString(
        bundle.bundleIdentifier ?? loadOptionalInfoPlistString(bundle: bundle, key: "CFBundleIdentifier"),
        fallback: appBundleIdentifier()
    )
    let marketingVersion: String = nonEmptyString(
        loadOptionalInfoPlistString(bundle: bundle, key: "CFBundleShortVersionString"),
        fallback: appMarketingVersion()
    )
    let buildNumber: String = nonEmptyString(
        loadOptionalInfoPlistString(bundle: bundle, key: "CFBundleVersion"),
        fallback: appBuildNumber()
    )

    return SentryRuntimeConfiguration(
        dsn: dsn,
        environment: environment,
        tracesSampleRate: parsedTracesSampleRate.value,
        invalidTracesSampleRate: parsedTracesSampleRate.invalidRawValue,
        bundleIdentifier: bundleIdentifier,
        marketingVersion: marketingVersion,
        buildNumber: buildNumber,
        tracePropagationTargets: makeTracePropagationTargets(bundle: bundle)
    )
}

private func loadSentryEnvironment(bundle: Bundle, processInfo: ProcessInfo) -> String {
    let overrideValue: String = nonEmptyString(
        processInfo.environment[sentryEnvironmentOverrideKey] ?? "",
        fallback: ""
    )
    if overrideValue.isEmpty == false {
        return overrideValue
    }

    // Xcode Cloud can run prebuilt test products with test-without-building. In that path,
    // hosted XCTest app processes may not receive the scheme TestAction environment, so
    // this Sentry-only simulator guard prevents test telemetry from inheriting production.
    if isRunningUnderXCTestOnSimulator(processInfo: processInfo) {
        return sentryCiSimulatorEnvironment
    }

    return nonEmptyString(
        loadOptionalInfoPlistString(
            bundle: bundle,
            key: sentryEnvironmentInfoPlistKey
        ),
        fallback: "local"
    )
}

private func isRunningUnderXCTestOnSimulator(processInfo: ProcessInfo) -> Bool {
#if targetEnvironment(simulator)
    // These markers are injected by XCTest into simulator test hosts and UI test runners.
    // Device archives do not compile this branch, so shipped builds keep the configured
    // Info.plist environment unless an explicit Sentry override is provided.
    let xctestEnvironmentKeys: [String] = [
        "XCTestConfigurationFilePath",
        "XCTestBundlePath",
        "XCInjectBundleInto"
    ]
    for key in xctestEnvironmentKeys {
        if hasNonEmptyEnvironmentValue(processInfo: processInfo, key: key) {
            return true
        }
    }

    if environmentValueContains(processInfo: processInfo, key: "DYLD_INSERT_LIBRARIES", needle: "XCTest") {
        return true
    }

    return NSClassFromString("XCTestCase") != nil
#else
    return false
#endif
}

private func hasNonEmptyEnvironmentValue(processInfo: ProcessInfo, key: String) -> Bool {
    nonEmptyString(processInfo.environment[key] ?? "", fallback: "").isEmpty == false
}

private func environmentValueContains(processInfo: ProcessInfo, key: String, needle: String) -> Bool {
    guard let value: String = processInfo.environment[key] else {
        return false
    }

    return value.range(of: needle, options: [.caseInsensitive]) != nil
}

private func loadOptionalInfoPlistString(bundle: Bundle, key: String) -> String {
    guard let rawValue: String = bundle.object(forInfoDictionaryKey: key) as? String else {
        return ""
    }

    return rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func nonEmptyString(_ value: String, fallback: String) -> String {
    let trimmedValue: String = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        return fallback
    }

    return trimmedValue
}

private func parseSentrySampleRate(_ value: String) -> ParsedSentrySampleRate {
    guard let sampleRate: Double = Double(value), sampleRate >= 0.0, sampleRate <= 1.0 else {
        return ParsedSentrySampleRate(value: 0.0, invalidRawValue: value)
    }

    return ParsedSentrySampleRate(value: sampleRate, invalidRawValue: nil)
}

private func makeTracePropagationTargets(bundle: Bundle) -> [Any] {
    var targets: [Any] = [
        "localhost",
        "127.0.0.1",
        "::1"
    ]
    let configuredUrls: [String] = [
        loadOptionalInfoPlistString(bundle: bundle, key: "FLASHCARDS_API_BASE_URL"),
        loadOptionalInfoPlistString(bundle: bundle, key: "FLASHCARDS_AUTH_BASE_URL")
    ]
    for configuredUrl in configuredUrls {
        guard let host: String = URLComponents(string: configuredUrl)?.host, host.isEmpty == false else {
            continue
        }
        targets.append(host)
    }
    if let lambdaFunctionUrlPattern: NSRegularExpression = try? NSRegularExpression(
        pattern: #"https://[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws"#,
        options: [.caseInsensitive]
    ) {
        targets.append(lambdaFunctionUrlPattern)
    }
    return targets
}
