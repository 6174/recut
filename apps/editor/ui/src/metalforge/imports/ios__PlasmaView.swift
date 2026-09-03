import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            EffectDemoButtons()
        }
    }
}

struct EffectDemoButtons: View {
    var body: some View {
        HStack(spacing: 22) {
            CircleArrowButton()
            UpgradePillButton()
        }
    }
}

private let buttonInk = Color(red: 0.07, green: 0.07, blue: 0.08)
private let ringWidth: CGFloat = 2.5

private struct CircleArrowButton: View {
    private let size: CGFloat = 64

    var body: some View {
        ZStack {
            PlasmaShaderView()
                .clipShape(Circle())
            Circle()
                .fill(buttonInk)
                .padding(ringWidth)
            Image(systemName: "arrow.up")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

private struct UpgradePillButton: View {
    private let height: CGFloat = 56

    var body: some View {
        ZStack {
            PlasmaShaderView()
                .clipShape(Capsule())
            Capsule()
                .fill(buttonInk)
                .padding(ringWidth)
            Text("Upgrade to Pro")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 28)
        }
        .frame(height: height)
        .fixedSize(horizontal: true, vertical: false)
    }
}

private struct PlasmaShaderView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.plasmaSolar(
                        .boundingRect,
                        .float(Float(t)),
                        .color(Color(hex: "#1A0500")),
                        .color(Color(hex: "#5A1208")),
                        .color(Color(hex: "#C44A20")),
                        .color(Color(hex: "#F08A3A")),
                        .color(Color(hex: "#FFC57A")),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0)
                    )
                )
        }
    }
}

#Preview {
    ContentView()
}

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        let r = Double((v >> 16) & 0xFF) / 255
        let g = Double((v >>  8) & 0xFF) / 255
        let b = Double( v        & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}
