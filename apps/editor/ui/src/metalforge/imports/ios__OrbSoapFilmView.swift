import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbSoapFilmView()
            .ignoresSafeArea()
    }
}

struct OrbSoapFilmView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbSoapFilm(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.75),
                        .float(2.6),
                        .float(2.4),
                        .float(7.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#0F0A38")),
                        .color(Color(hex: "#02020B")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#070317")),
                        .color(Color(hex: "#1A66FF")),
                        .color(Color(hex: "#CC3DFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#1A66FF")),
                        .color(Color(hex: "#02020B")),
                        .color(Color(hex: "#060315")),
                        .color(Color(hex: "#0A041F")),
                        .color(Color(hex: "#0E0529")),
                        .color(Color(hex: "#120633")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#16073D")),
                        .color(Color(hex: "#16073D"))
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
