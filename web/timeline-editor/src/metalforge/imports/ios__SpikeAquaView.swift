import SwiftUI

struct ContentView: View {
    var body: some View {
        SpikeAquaView()
            .ignoresSafeArea()
    }
}

struct SpikeAquaView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.spikeAqua(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.0),
                        .float(38.0),
                        .float(26.0),
                        .float(18.0),
                        .float(1.0),
                        .float(0.0),
                        .float(12.0),
                        .float(0.8),
                        .float(0.45),
                        .float(0.0),
                        .float(1.6),
                        .float(0.85),
                        .float(1.0),
                        .float(0.0),
                        .float(0.0),
                        .float(0.0),
                        .float(0.11),
                        .float(1.0),
                        .float(0.1),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(2.0),
                        .float(0.35),
                        .float(0.25),
                        .float2(0.87, 0.4),
                        .float2(0.5, 1.0),
                        .color(Color(hex: "#030506")),
                        .color(Color(hex: "#0E7BC8")),
                        .color(Color(hex: "#6ED8FF")),
                        .color(Color(hex: "#78DCFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#6ED8FF")),
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
