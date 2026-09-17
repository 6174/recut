import SwiftUI

struct ContentView: View {
    var body: some View {
        SpinningEarthView()
            .ignoresSafeArea()
    }
}

struct SpinningEarthView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.spinningEarthDots(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.3),
                        .float(0.41),
                        .float(0.41),
                        .float(74.0),
                        .float(0.12),
                        .float(0.0),
                        .color(Color(hex: "#D1DBF0")),
                        .color(Color(hex: "#576685")),
                        .color(Color(hex: "#739EFF"))
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
