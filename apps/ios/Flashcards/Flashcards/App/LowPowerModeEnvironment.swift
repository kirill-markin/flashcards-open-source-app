import SwiftUI

private struct LowPowerModeEnabledEnvironmentKey: EnvironmentKey {
    static let defaultValue: Bool = false
}

extension EnvironmentValues {
    var isLowPowerModeEnabled: Bool {
        get { self[LowPowerModeEnabledEnvironmentKey.self] }
        set { self[LowPowerModeEnabledEnvironmentKey.self] = newValue }
    }
}
