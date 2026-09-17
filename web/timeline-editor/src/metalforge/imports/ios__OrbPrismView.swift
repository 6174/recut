import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbPrismView()
            .ignoresSafeArea()
    }
}

struct OrbPrismView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbPrism(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.5),
                        .float(0.72),
                        .float(1.35),
                        .float(3.1),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FF78B4")),
                        .color(Color(hex: "#5AA0FF")),
                        .color(Color(hex: "#FF78B4")),
                        .color(Color(hex: "#FF6060")),
                        .color(Color(hex: "#E02DB2")),
                        .color(Color(hex: "#9436F2")),
                        .color(Color(hex: "#4876FB")),
                        .color(Color(hex: "#29C7C7")),
                        .color(Color(hex: "#48FB76")),
                        .color(Color(hex: "#94F236")),
                        .color(Color(hex: "#E0B22D")),
                        .color(Color(hex: "#E0B22D")),
                        .color(Color(hex: "#E0B22D")),
                        .color(Color(hex: "#E0B22D")),
                        .color(Color(hex: "#E0B22D"))
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
