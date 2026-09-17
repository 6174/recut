import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbNebulaView()
            .ignoresSafeArea()
    }
}

struct OrbNebulaView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbNebula(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.72),
                        .float(1.35),
                        .float(9.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(0.2, 0.14),
                        .color(Color(hex: "#290514")),
                        .color(Color(hex: "#B81F38")),
                        .color(Color(hex: "#FF731F")),
                        .color(Color(hex: "#FFD685")),
                        .color(Color(hex: "#FFB866")),
                        .color(Color(hex: "#BF4026")),
                        .color(Color(hex: "#D97333")),
                        .color(Color(hex: "#FF662E")),
                        .color(Color(hex: "#0D0308")),
                        .color(Color(hex: "#FF6638")),
                        .color(Color(hex: "#D93373")),
                        .color(Color(hex: "#FF731F")),
                        .color(Color(hex: "#290514")),
                        .color(Color(hex: "#450A1B")),
                        .color(Color(hex: "#9C1A31")),
                        .color(Color(hex: "#BA2137")),
                        .color(Color(hex: "#E75727")),
                        .color(Color(hex: "#FF7420")),
                        .color(Color(hex: "#FFBB69")),
                        .color(Color(hex: "#FFD685")),
                        .color(Color(hex: "#FFD685")),
                        .color(Color(hex: "#FFD685")),
                        .color(Color(hex: "#FFD685")),
                        .color(Color(hex: "#FFD685"))
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
