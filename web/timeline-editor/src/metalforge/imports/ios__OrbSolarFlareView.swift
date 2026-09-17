import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbSolarFlareView()
            .ignoresSafeArea()
    }
}

struct OrbSolarFlareView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbSolarFlare(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.86),
                        .float(0.28),
                        .float(0.14),
                        .float(1.5),
                        .float(1.5),
                        .float(0.0),
                        .float(0.12),
                        .float(0.5),
                        .float(1.05),
                        .float(0.05),
                        .float(0.4),
                        .float(0.0),
                        .float(0.7),
                        .float(0.4),
                        .float(0.85),
                        .float(0.6),
                        .float(1.0),
                        .float(13.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(-0.45, -0.89),
                        .color(Color(hex: "#FF6D00")),
                        .color(Color(hex: "#FFC400")),
                        .color(Color(hex: "#FFFDE7")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#512F7F")),
                        .color(Color(hex: "#FFC400")),
                        .color(Color(hex: "#FF6D00")),
                        .color(Color(hex: "#FF7B00")),
                        .color(Color(hex: "#FF9F00")),
                        .color(Color(hex: "#FFBF00")),
                        .color(Color(hex: "#FFC71F")),
                        .color(Color(hex: "#FFDB73")),
                        .color(Color(hex: "#FFF2C4")),
                        .color(Color(hex: "#FFFDE7")),
                        .color(Color(hex: "#FFFDE7")),
                        .color(Color(hex: "#FFFDE7")),
                        .color(Color(hex: "#FFFDE7")),
                        .color(Color(hex: "#FFFDE7"))
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
