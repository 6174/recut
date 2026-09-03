import SwiftUI

struct ContentView: View {
    var body: some View {
        InkSmokeView()
            .ignoresSafeArea()
    }
}

struct InkSmokeView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.inkSmoke(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(1.8),
                        .float(4.0),
                        .float(1.0),
                        .color(Color(hex: "#0D001A")),
                        .color(Color(hex: "#1A3380")),
                        .color(Color(hex: "#661A4D")),
                        .color(Color(hex: "#004D66")),
                        .color(Color(hex: "#4D3366"))
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
