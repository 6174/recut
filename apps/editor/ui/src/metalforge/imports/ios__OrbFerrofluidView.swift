import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbFerrofluidView()
            .ignoresSafeArea()
    }
}

struct OrbFerrofluidView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbFerrofluid(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.7),
                        .float(3.4),
                        .float(3.0),
                        .float(2.6),
                        .float(0.85),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#33363D")),
                        .color(Color(hex: "#33E6F2")),
                        .color(Color(hex: "#8C59FF")),
                        .color(Color(hex: "#FF4DBF")),
                        .color(Color(hex: "#F2BF40")),
                        .color(Color(hex: "#F2F5FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#33E6F2")),
                        .color(Color(hex: "#33363D")),
                        .color(Color(hex: "#4E5159")),
                        .color(Color(hex: "#6A6D74")),
                        .color(Color(hex: "#858890")),
                        .color(Color(hex: "#A0A3AC")),
                        .color(Color(hex: "#BBBEC8")),
                        .color(Color(hex: "#D7DAE3")),
                        .color(Color(hex: "#F2F5FF")),
                        .color(Color(hex: "#F2F5FF")),
                        .color(Color(hex: "#F2F5FF")),
                        .color(Color(hex: "#F2F5FF")),
                        .color(Color(hex: "#F2F5FF"))
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
