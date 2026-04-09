import SwiftUI
import UIKit

struct CopyableErrorMessageView: View {
    let message: String

    var body: some View {
        Text(message)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .contextMenu {
                Button(aiSettingsLocalized("common.copyError", "Copy error")) {
                    UIPasteboard.general.string = self.message
                }
            }
    }
}
