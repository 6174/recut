import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbLavaLampView()
            .ignoresSafeArea()
    }
}

struct OrbLavaLampView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbLavaLamp(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.86),
                        .float(6.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.0),
                        .float(0.12),
                        .float(0.65),
                        .float(1.0),
                        .float(0.0),
                        .float(0.4),
                        .float(0.0),
                        .float(0.75),
                        .float(0.6),
                        .float(0.6),
                        .float(0.25),
                        .float(1.0),
                        .float(18.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(-0.5, -0.86),
                        .color(Color(hex: "#2E1065")),
                        .color(Color(hex: "#FB7185")),
                        .color(Color(hex: "#FDBA74")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#512F7F")),
                        .color(Color(hex: "#FB7185")),
                        .color(Color(hex: "#2E1065")),
                        .color(Color(hex: "#522772")),
                        .color(Color(hex: "#A84B7F")),
                        .color(Color(hex: "#F06B84")),
                        .color(Color(hex: "#FD7483")),
                        .color(Color(hex: "#FF8A79")),
                        .color(Color(hex: "#FFAA72")),
                        .color(Color(hex: "#FDBA74")),
                        .color(Color(hex: "#FDBA74")),
                        .color(Color(hex: "#FDBA74")),
                        .color(Color(hex: "#FDBA74")),
                        .color(Color(hex: "#FDBA74"))
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
