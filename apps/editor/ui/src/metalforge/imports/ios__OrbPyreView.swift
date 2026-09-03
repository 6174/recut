import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbPyreView()
            .ignoresSafeArea()
    }
}

struct OrbPyreView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbPyre(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.88),
                        .float(0.72),
                        .float(1.0),
                        .float(0.4),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#0C0604")),
                        .color(Color(hex: "#A82208")),
                        .color(Color(hex: "#FF7A1E")),
                        .color(Color(hex: "#FFE86B")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FF7A1E")),
                        .color(Color(hex: "#0C0604")),
                        .color(Color(hex: "#0C0604")),
                        .color(Color(hex: "#5E1506")),
                        .color(Color(hex: "#AA2409")),
                        .color(Color(hex: "#DB5615")),
                        .color(Color(hex: "#FF7E21")),
                        .color(Color(hex: "#FFBA4B")),
                        .color(Color(hex: "#FFE86B")),
                        .color(Color(hex: "#FFE86B")),
                        .color(Color(hex: "#FFE86B")),
                        .color(Color(hex: "#FFE86B")),
                        .color(Color(hex: "#FFE86B"))
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
