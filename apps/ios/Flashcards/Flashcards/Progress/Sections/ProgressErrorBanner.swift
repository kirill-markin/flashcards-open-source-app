import SwiftUI

struct ProgressErrorBanner: View {
    let message: String

    var body: some View {
        if self.message.isEmpty == false {
            Label {
                Text(self.message)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } icon: {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            .modifier(ProgressCardModifier())
        }
    }
}
