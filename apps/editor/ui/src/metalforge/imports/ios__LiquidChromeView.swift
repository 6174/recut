import SwiftUI

struct ContentView: View {
    var body: some View {
        LiquidChromeView()
            .ignoresSafeArea()
    }
}

struct LiquidChromeView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.liquidChrome(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.3),
                        .float(2.0),
                        .float(1.5),
                        .float(0.6),
                        .float(12.0),
                        .float(0.3),
                        .float(0.15),
                        .color(Color(hex: "#05030D")),
                        .color(Color(hex: "#333340")),
                        .color(Color(hex: "#808099")),
                        .color(Color(hex: "#263366"))
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
