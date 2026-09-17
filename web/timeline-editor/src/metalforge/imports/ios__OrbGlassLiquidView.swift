import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbGlassLiquidView()
            .ignoresSafeArea()
    }
}

struct OrbGlassLiquidView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbGlassLiquid(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.54),
                        .float(0.72),
                        .float(0.3),
                        .float(3.0),
                        .float(0.45),
                        .float(2.2),
                        .float(0.3),
                        .float(1.0),
                        .float(1.0),
                        .float(0.28),
                        .float(0.22),
                        .float(1.0),
                        .float(0.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#F7FBFF")),
                        .color(Color(hex: "#D6E8F7")),
                        .color(Color(hex: "#A8C8F0")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#D6E8F7")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#F4F0E6")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#F7FBFF")),
                        .color(Color(hex: "#EFF6FD")),
                        .color(Color(hex: "#E0EEF9")),
                        .color(Color(hex: "#D4E6F7")),
                        .color(Color(hex: "#BBD5F3")),
                        .color(Color(hex: "#A6C7F0")),
                        .color(Color(hex: "#87B0EB")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#6F9EE8")),
                        .color(Color(hex: "#6F9EE8"))
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
