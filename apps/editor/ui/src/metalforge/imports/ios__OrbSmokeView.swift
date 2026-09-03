import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbSmokeView()
            .ignoresSafeArea()
    }
}

struct OrbSmokeView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbSmoke(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.6),
                        .float(1.7),
                        .float(1.2),
                        .float(1.7),
                        .float(0.42),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#FF994D")),
                        .color(Color(hex: "#FFD6A1")),
                        .color(Color(hex: "#293885")),
                        .color(Color(hex: "#99C2FF")),
                        .color(Color(hex: "#B6C4FF")),
                        .color(Color(hex: "#9797FF")),
                        .color(Color(hex: "#C6D0FF")),
                        .color(Color(hex: "#97AEFF")),
                        .color(Color(hex: "#FFFEFC")),
                        .color(Color(hex: "#F2F7FF")),
                        .color(Color(hex: "#D1E6FF")),
                        .color(Color(hex: "#D9EBFF")),
                        .color(Color(hex: "#75708C")),
                        .color(Color(hex: "#E0D6EB")),
                        .color(Color(hex: "#FF994D")),
                        .color(Color(hex: "#75708C")),
                        .color(Color(hex: "#847F9A")),
                        .color(Color(hex: "#948DA7")),
                        .color(Color(hex: "#A39CB5")),
                        .color(Color(hex: "#B2AAC2")),
                        .color(Color(hex: "#C1B9D0")),
                        .color(Color(hex: "#D1C7DD")),
                        .color(Color(hex: "#E0D6EB")),
                        .color(Color(hex: "#E0D6EB")),
                        .color(Color(hex: "#E0D6EB")),
                        .color(Color(hex: "#E0D6EB")),
                        .color(Color(hex: "#E0D6EB"))
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
