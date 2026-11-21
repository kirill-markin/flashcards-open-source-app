import SwiftUI
import UIKit

#if targetEnvironment(macCatalyst)
func fitsMacAICompanionColumns(_ size: CGSize) -> Bool {
    size.width >= 1000 && size.height >= 600
}
#endif

/// Mac observes the sidebar's detail column; mobile uses the full owning window.
struct AICompanionAvailabilityObserver: UIViewRepresentable {
    let onChange: (Bool) -> Void

    func makeUIView(context: Context) -> AvailabilityView {
        let view = AvailabilityView()
        view.isUserInteractionEnabled = false
        view.onChange = self.onChange
        return view
    }

    func updateUIView(_ uiView: AvailabilityView, context: Context) {
        uiView.onChange = self.onChange
        uiView.reportAvailability()
    }

    final class AvailabilityView: UIView {
        var onChange: ((Bool) -> Void)?
        private var lastAvailability: Bool?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            self.lastAvailability = nil
            self.reportAvailability()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            self.reportAvailability()
        }

        func reportAvailability() {
            guard let window = self.window else { return }
            // Two study columns need a large landscape window. Ordinary phones
            // and Duo's outer display have a short side below 600 points.
            #if targetEnvironment(macCatalyst)
            // The observer fills the detail column, so the sidebar is already excluded.
            let size = self.bounds.size
            let isAvailable = fitsMacAICompanionColumns(size)
                && self.traitCollection.horizontalSizeClass == .regular
            #else
            let size = window.bounds.size
            let isAvailable = size.width >= 900 && size.height >= 600
                && size.width > size.height && self.traitCollection.horizontalSizeClass == .regular
            #endif
            guard isAvailable != self.lastAvailability else { return }
            self.lastAvailability = isAvailable
            // UIKit may lay out during a SwiftUI update. Ignore stale callbacks
            // and callbacks from a view that has left its window.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.window != nil, self.lastAvailability == isAvailable else { return }
                self.onChange?(isAvailable)
            }
        }
    }
}
