import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbTemperView()
            .ignoresSafeArea()
    }
}

struct OrbTemperView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbTemper(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.6),
                        .float(7.0),
                        .float(0.42),
                        .float(150.0),
                        .float(0.62),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#B899FF")),
                        .color(Color(hex: "#B8B3BD")),
                        .color(Color(hex: "#E6F2FF")),
                        .color(Color(hex: "#B8D1FF")),
                        .color(Color(hex: "#F29E6B")),
                        .color(Color(hex: "#B6C4FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#C6D0FF")),
                        .color(Color(hex: "#97AEFF")),
                        .color(Color(hex: "#FFFAF0")),
                        .color(Color(hex: "#1A42B3")),
                        .color(Color(hex: "#9E33CC")),
                        .color(Color(hex: "#EFDFFF")),
                        .color(Color(hex: "#383838")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#B899FF")),
                        .color(Color(hex: "#000000")),
                        .color(Color(hex: "#252E3F")),
                        .color(Color(hex: "#7F97BE")),
                        .color(Color(hex: "#DAEFFF")),
                        .color(Color(hex: "#FFF7C2")),
                        .color(Color(hex: "#DAA844")),
                        .color(Color(hex: "#803D00")),
                        .color(Color(hex: "#25013B")),
                        .color(Color(hex: "#25013B")),
                        .color(Color(hex: "#25013B")),
                        .color(Color(hex: "#25013B")),
                        .color(Color(hex: "#25013B"))
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
