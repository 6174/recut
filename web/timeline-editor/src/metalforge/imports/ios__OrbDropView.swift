import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbDropView()
            .ignoresSafeArea()
    }
}

struct OrbDropView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbDrop(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.86),
                        .float(0.26),
                        .float(0.12),
                        .float(1.6),
                        .float(1.9),
                        .float(1.0),
                        .float(0.12),
                        .float(0.85),
                        .float(1.1),
                        .float(0.0),
                        .float(0.45),
                        .float(0.0),
                        .float(0.7),
                        .float(0.85),
                        .float(0.6),
                        .float(0.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(-0.62, -0.78),
                        .color(Color(hex: "#0E9AA7")),
                        .color(Color(hex: "#A8F0E8")),
                        .color(Color(hex: "#F2FFFD")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#512F7F")),
                        .color(Color(hex: "#0E9AA7")),
                        .color(Color(hex: "#0E9AA7")),
                        .color(Color(hex: "#2DACB6")),
                        .color(Color(hex: "#6BCFD0")),
                        .color(Color(hex: "#9FECE5")),
                        .color(Color(hex: "#ABF1E9")),
                        .color(Color(hex: "#C2F7F1")),
                        .color(Color(hex: "#E3FDF9")),
                        .color(Color(hex: "#F2FFFD")),
                        .color(Color(hex: "#F2FFFD")),
                        .color(Color(hex: "#F2FFFD")),
                        .color(Color(hex: "#F2FFFD")),
                        .color(Color(hex: "#F2FFFD"))
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
