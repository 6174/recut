import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbLiquidMetalView()
            .ignoresSafeArea()
    }
}

struct OrbLiquidMetalView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbLiquidMetal(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.6),
                        .float(0.2),
                        .float(1.0),
                        .float(0.03),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#85ADFF")),
                        .color(Color(hex: "#B3BED4")),
                        .color(Color(hex: "#E6F2FF")),
                        .color(Color(hex: "#B8D1FF")),
                        .color(Color(hex: "#F29E6B")),
                        .color(Color(hex: "#B6C4FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#C6D0FF")),
                        .color(Color(hex: "#97AEFF")),
                        .color(Color(hex: "#FFFEFC")),
                        .color(Color(hex: "#F2F7FF")),
                        .color(Color(hex: "#D1E6FF")),
                        .color(Color(hex: "#99C2FF")),
                        .color(Color(hex: "#D9EBFF")),
                        .color(Color(hex: "#FFFAF0")),
                        .color(Color(hex: "#1A42B3")),
                        .color(Color(hex: "#9E33CC")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#85ADFF")),
                        .color(Color(hex: "#B3BED4")),
                        .color(Color(hex: "#BEC7DA")),
                        .color(Color(hex: "#C9D1E0")),
                        .color(Color(hex: "#D4DAE6")),
                        .color(Color(hex: "#DEE3ED")),
                        .color(Color(hex: "#E9ECF3")),
                        .color(Color(hex: "#F4F6F9")),
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
