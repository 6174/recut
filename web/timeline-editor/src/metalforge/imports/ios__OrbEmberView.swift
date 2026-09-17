import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbEmberView()
            .ignoresSafeArea()
    }
}

struct OrbEmberView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbEmber(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.86),
                        .float(0.38),
                        .float(0.28),
                        .float(2.4),
                        .float(2.2),
                        .float(0.0),
                        .float(0.1),
                        .float(0.5),
                        .float(1.3),
                        .float(0.0),
                        .float(0.7),
                        .float(0.0),
                        .float(1.0),
                        .float(0.45),
                        .float(0.5),
                        .float(0.2),
                        .float(1.0),
                        .float(5.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .float2(0.62, -0.7),
                        .color(Color(hex: "#3D0E02")),
                        .color(Color(hex: "#FF3D00")),
                        .color(Color(hex: "#FFB199")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#512F7F")),
                        .color(Color(hex: "#FF3D00")),
                        .color(Color(hex: "#3D0E02")),
                        .color(Color(hex: "#621200")),
                        .color(Color(hex: "#B51800")),
                        .color(Color(hex: "#F53500")),
                        .color(Color(hex: "#FF420C")),
                        .color(Color(hex: "#FF6A43")),
                        .color(Color(hex: "#FF9B7D")),
                        .color(Color(hex: "#FFB199")),
                        .color(Color(hex: "#FFB199")),
                        .color(Color(hex: "#FFB199")),
                        .color(Color(hex: "#FFB199")),
                        .color(Color(hex: "#FFB199"))
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
