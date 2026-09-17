import SwiftUI

struct ContentView: View {
    var body: some View {
        StarfieldView()
            .ignoresSafeArea()
    }
}

struct StarfieldView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.starfield(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(3.0),
                        .float(50.0),
                        .float(80.0),
                        .float(0.05),
                        .float(0.1),
                        .float(3.0),
                        .float(0.3),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#020208"))
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
