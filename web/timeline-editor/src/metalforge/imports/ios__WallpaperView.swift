import SwiftUI

struct ContentView: View {
    var body: some View {
        WallpaperView()
            .ignoresSafeArea()
    }
}

struct WallpaperView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.wallpaperGradient(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.0),
                        .float(1.15),
                        .float(2.6),
                        .float(1.35),
                        .float(1.0),
                        .float(20.0),
                        .float(0.04),
                        .float(0.5),
                        .float(0.5),
                        .float(0.85),
                        .float(27.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.05),
                        .float(6.0),
                        .color(Color(hex: "#04051A")),
                        .color(Color(hex: "#08195E")),
                        .color(Color(hex: "#1E5CFF")),
                        .color(Color(hex: "#3FD8FF")),
                        .color(Color(hex: "#EEF1F6"))
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
