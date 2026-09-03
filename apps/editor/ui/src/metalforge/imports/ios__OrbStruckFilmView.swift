import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbStruckFilmView()
            .ignoresSafeArea()
    }
}

struct OrbStruckFilmView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbStruckFilm(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.75),
                        .float(1.6),
                        .float(24.0),
                        .float(1.1),
                        .float(1.15),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#0D0D38")),
                        .color(Color(hex: "#02020B")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#1A66FF")),
                        .color(Color(hex: "#D940FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#1A66FF")),
                        .color(Color(hex: "#02020B")),
                        .color(Color(hex: "#050314")),
                        .color(Color(hex: "#08041D")),
                        .color(Color(hex: "#0C0626")),
                        .color(Color(hex: "#0F072F")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#120838")),
                        .color(Color(hex: "#120838"))
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
