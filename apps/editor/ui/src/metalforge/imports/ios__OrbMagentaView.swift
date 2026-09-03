import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbMagentaView()
            .ignoresSafeArea()
    }
}

struct OrbMagentaView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbMagenta(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.86),
                        .float(0.3),
                        .float(0.15),
                        .float(1.35),
                        .float(1.7),
                        .float(0.0),
                        .float(0.1),
                        .float(0.55),
                        .float(1.25),
                        .float(-0.04),
                        .float(0.8),
                        .float(0.0),
                        .float(0.9),
                        .float(0.5),
                        .float(0.55),
                        .float(0.0),
                        .float(1.0),
                        .float(0.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(-0.62, -0.78),
                        .color(Color(hex: "#F25AED")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#512F7F")),
                        .color(Color(hex: "#F25AED")),
                        .color(Color(hex: "#F25AED")),
                        .color(Color(hex: "#F563F0")),
                        .color(Color(hex: "#FC7BF7")),
                        .color(Color(hex: "#FF9DFC")),
                        .color(Color(hex: "#FFC1FE")),
                        .color(Color(hex: "#FFE1FE")),
                        .color(Color(hex: "#FFF7FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF"))
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
