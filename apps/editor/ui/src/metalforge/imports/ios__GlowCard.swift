import SwiftUI

struct ContentView: View {
    var body: some View {
        GlowCard()
            .ignoresSafeArea()
    }
}

struct GlowCard: View {
    var badge: String = "+312 bps"
    var value: String = "400%"
    var caption: String = "Conversion rate"
    var showsContent: Bool = true

    var body: some View {
        ZStack {
            GlowView()
            if showsContent {
                StatCardContent(badge: badge, value: value, caption: caption)
            }
        }
    }
}

struct GlowView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.glow(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.0),
                        .float(0.42),
                        .float(0.0),
                        .float(1.0),
                        .float(40.0),
                        .float(18.0),
                        .float(34.0),
                        .float(74.0),
                        .float(6.0),
                        .float(0.15),
                        .float(1.0),
                        .float(0.1),
                        .float2(0.86, 0.52),
                        .float2(0.5, 1.0),
                        .color(Color(hex: "#0A0909")),
                        .color(Color(hex: "#09101F")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#6994FF")),
                        .color(Color(hex: "#144CCD")),
                        .color(Color(hex: "#2365FF")),
                        .color(Color(hex: "#144CCD")),
                        .float(0.0),
                        .float(0.5),
                        .float(5.0),
                        .float(8.0),
                        .float(0.45),
                        .float(0.5),
                        .float(0.0),
                        .float(16.0),
                        .float(0.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.45),
                        .float(0.3),
                        .float(0.08)
                    )
                )
        }
    }
}

private struct StatCardContent: View {
    var badge: String
    var value: String
    var caption: String

    private let card = CGSize(width: 0.86, height: 0.52)

    var body: some View {
        GeometryReader { geo in
            let s = max(min(geo.size.width / 393, geo.size.height / 851), 0.0001)
            let w = min(max(card.width, 0.02), 1) * 393 * s
            let h = min(max(card.height, 0.02), 1) * 851 * s
            let gs = max(min(w / 320, h / 420), 0.0001)

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6.0 * gs) {
                    Text("↗").opacity(0.9)
                    Text(badge)
                }
                .font(.system(size: 13.0 * gs, weight: .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14.0 * gs)
                .frame(height: 30.0 * gs)
                .overlay(
                    Capsule().stroke(Color.white.opacity(0.28), lineWidth: max(1.0 * gs, 1))
                )
                .padding(.bottom, 16.0 * gs)

                Text(value)
                    .font(.system(size: 66.0 * gs, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.bottom, 6.0 * gs)

                Text(caption)
                    .font(.system(size: 15.0 * gs, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.85))
            }
            .padding(.horizontal, 36.0 * gs)
            .padding(.bottom, 24.0 * gs)
            .frame(width: w, height: h, alignment: .bottomLeading)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
        .allowsHitTesting(false)
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
