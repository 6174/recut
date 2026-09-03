import SwiftUI

struct ContentView: View {
    var body: some View {
        FractalCloudsView()
            .ignoresSafeArea()
    }
}

struct FractalCloudsView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.fractalClouds(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(3.0),
                        .float(0.08),
                        .float(0.04),
                        .float(2.0),
                        .float(0.0),
                        .color(Color(hex: "#1A2659")),
                        .color(Color(hex: "#E6E6FF")),
                        .color(Color(hex: "#1A0D00")),
                        .float(0.5)
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
