import SwiftUI

struct ReviewOverlayBannerView: View {
    let banner: ReviewOverlayBanner
    let onDismiss: () -> Void

    @State private var dragOffsetY: CGFloat = 0

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                .imageScale(.large)
                .foregroundStyle(.primary)

            Text(self.banner.message)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: flashcardsReadableContentMaxWidth)
        .frame(maxWidth: .infinity, alignment: .center)
        .background(self.bannerBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 18, y: 8)
        .offset(y: self.dragOffsetY)
        .gesture(
            DragGesture(minimumDistance: 10)
                .onChanged { value in
                    self.dragOffsetY = min(0, value.translation.height)
                }
                .onEnded { value in
                    if value.translation.height < -18 {
                        self.onDismiss()
                    } else {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                            self.dragOffsetY = 0
                        }
                    }
                }
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    @ViewBuilder
    private var bannerBackground: some View {
        if #available(iOS 26.0, *) {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.clear)
                .glassEffect()
        } else {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.thinMaterial)
        }
    }
}
