import SwiftUI

struct ContentView: View {
    var body: some View {
        RidgeGraphiteView()
            .ignoresSafeArea()
    }
}

struct RidgeGraphiteView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.ridgeGraphite(
                        .boundingRect,
                        .float(Float(t)),
                        .float(2.0),
                        .float(0.0),
                        .float(28.0),
                        .float(38.0),
                        .float(24.0),
                        .float(18.0),
                        .float(0.2),
                        .float(0.8),
                        .float(1.0),
                        .float(0.1),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(2.0),
                        .float(0.35),
                        .float(0.4),
                        .float(0.25),
                        .float2(0.88, 0.52),
                        .float2(0.5, 1.0),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#B9C2D2")),
                        .color(Color(hex: "#3B4453")),
                        .color(Color(hex: "#07090C")),
                        .color(Color(hex: "#3C465A")),
                        .float(0.0),
                        .float(0.5),
                        .float(5.0),
                        .float(8.0),
                        .float(0.45),
                        .float(0.5),
                        .float(0.0),
                        .float(16.0),
                        .float(0.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.45),
                        .float(0.3),
                        .float(0.08)
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
