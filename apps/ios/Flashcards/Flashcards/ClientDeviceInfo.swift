import Foundation
import UIKit

/*
 The backend validates `osName` and `deviceType` against strict enums, so these return only its
 literal values and never a system string. Mac Catalyst is decided at compile time, before the
 idiom: with "Scale Interface to Match iPad" its idiom is `.pad`, and `UIDevice.systemName` reports
 iPadOS there. `UIDevice` is main-actor isolated, so nonisolated callers reach these with `await`.
 */

@MainActor
func currentClientOsName() -> String {
    #if targetEnvironment(macCatalyst)
    return "macos"
    #else
    return UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
    #endif
}

@MainActor
func currentClientDeviceType() -> String {
    #if targetEnvironment(macCatalyst)
    return "desktop"
    #else
    return UIDevice.current.userInterfaceIdiom == .pad ? "tablet" : "phone"
    #endif
}

#if targetEnvironment(macCatalyst)
/// The Mac model identifier, such as `Mac15,11`; `uname` reports only the CPU architecture on a Mac.
func currentMacModelIdentifier() -> String? {
    var size = 0
    guard sysctlbyname("hw.model", nil, &size, nil, 0) == 0, size > 0 else {
        return nil
    }

    var characters = [CChar](repeating: 0, count: size)
    guard sysctlbyname("hw.model", &characters, &size, nil, 0) == 0 else {
        return nil
    }

    let bytes = characters.prefix(while: { character in
        character != 0
    }).map { character in
        UInt8(bitPattern: character)
    }
    let identifier = String(decoding: bytes, as: UTF8.self)
    return identifier.isEmpty ? nil : identifier
}
#endif
