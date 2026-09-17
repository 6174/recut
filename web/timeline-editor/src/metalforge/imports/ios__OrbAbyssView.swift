import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbAbyssView()
            .ignoresSafeArea()
    }
}

struct OrbAbyssView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbAbyss(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.64),
                        .float(0.72),
                        .float(0.29),
                        .float(2.8),
                        .float(0.55),
                        .float(2.6),
                        .float(0.6),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#050F2E")),
                        .color(Color(hex: "#123C8C")),
                        .color(Color(hex: "#2FA8E8")),
                        .color(Color(hex: "#C4F2FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#2FA8E8")),
                        .color(Color(hex: "#050F2E")),
                        .color(Color(hex: "#081A44")),
                        .color(Color(hex: "#0E2E70")),
                        .color(Color(hex: "#144291")),
                        .color(Color(hex: "#237CC3")),
                        .color(Color(hex: "#34AAE9")),
                        .color(Color(hex: "#85D3F5")),
                        .color(Color(hex: "#C4F2FF")),
                        .color(Color(hex: "#C4F2FF")),
                        .color(Color(hex: "#C4F2FF")),
                        .color(Color(hex: "#C4F2FF")),
                        .color(Color(hex: "#C4F2FF"))
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
