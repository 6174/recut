import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbCycloneView()
            .ignoresSafeArea()
    }
}

struct OrbCycloneView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbCyclone(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.74),
                        .float(0.72),
                        .float(0.3),
                        .float(2.5),
                        .float(1.9),
                        .float(0.55),
                        .float(0.5),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#1A0A2E")),
                        .color(Color(hex: "#5C2E9C")),
                        .color(Color(hex: "#E85AA8")),
                        .color(Color(hex: "#FFE0B8")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#E85AA8")),
                        .color(Color(hex: "#1A0A2E")),
                        .color(Color(hex: "#2A1348")),
                        .color(Color(hex: "#48237B")),
                        .color(Color(hex: "#63309C")),
                        .color(Color(hex: "#AF48A3")),
                        .color(Color(hex: "#E95EA9")),
                        .color(Color(hex: "#F5A8B1")),
                        .color(Color(hex: "#FFE0B8")),
                        .color(Color(hex: "#FFE0B8")),
                        .color(Color(hex: "#FFE0B8")),
                        .color(Color(hex: "#FFE0B8")),
                        .color(Color(hex: "#FFE0B8"))
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
