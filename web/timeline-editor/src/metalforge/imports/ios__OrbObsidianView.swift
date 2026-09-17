import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbObsidianView()
            .ignoresSafeArea()
    }
}

struct OrbObsidianView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbObsidian(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.6),
                        .float(0.42),
                        .float(0.14),
                        .float(0.045),
                        .float(7.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(0.0, 0.06),
                        .color(Color(hex: "#8C70FF")),
                        .color(Color(hex: "#9985FF")),
                        .color(Color(hex: "#99C2FF")),
                        .color(Color(hex: "#F29E6B")),
                        .color(Color(hex: "#B6C4FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#C6D0FF")),
                        .color(Color(hex: "#97AEFF")),
                        .color(Color(hex: "#FFFEFC")),
                        .color(Color(hex: "#F2F7FF")),
                        .color(Color(hex: "#D1E6FF")),
                        .color(Color(hex: "#D9EBFF")),
                        .color(Color(hex: "#FFFAF0")),
                        .color(Color(hex: "#E6F2FF")),
                        .color(Color(hex: "#B8D1FF")),
                        .color(Color(hex: "#1A42B3")),
                        .color(Color(hex: "#9E33CC")),
                        .color(Color(hex: "#B3A6FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#8C70FF")),
                        .color(Color(hex: "#B6C4FF")),
                        .color(Color(hex: "#B5C2FF")),
                        .color(Color(hex: "#B3C0FF")),
                        .color(Color(hex: "#B1BDFF")),
                        .color(Color(hex: "#AEB9FF")),
                        .color(Color(hex: "#AAB3FF")),
                        .color(Color(hex: "#A4A9FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#9797FF"))
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
