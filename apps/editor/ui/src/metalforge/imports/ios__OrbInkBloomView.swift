import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbInkBloomView()
            .ignoresSafeArea()
    }
}

struct OrbInkBloomView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbInkBloom(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.72),
                        .float(8.0),
                        .float(3.2),
                        .float(8.5),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#0F0D33")),
                        .color(Color(hex: "#04030B")),
                        .color(Color(hex: "#291A8C")),
                        .color(Color(hex: "#8C1F99")),
                        .color(Color(hex: "#2466FF")),
                        .color(Color(hex: "#BF40FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#8C1F99")),
                        .color(Color(hex: "#000000")),
                        .color(Color(hex: "#253D5E")),
                        .color(Color(hex: "#7FB9ED")),
                        .color(Color(hex: "#DAFFDB")),
                        .color(Color(hex: "#FFCA42")),
                        .color(Color(hex: "#DA4F04")),
                        .color(Color(hex: "#80027B")),
                        .color(Color(hex: "#252DF9")),
                        .color(Color(hex: "#252DF9")),
                        .color(Color(hex: "#252DF9")),
                        .color(Color(hex: "#252DF9")),
                        .color(Color(hex: "#252DF9"))
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
