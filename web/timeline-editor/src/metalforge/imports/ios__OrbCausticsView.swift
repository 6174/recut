import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbCausticsView()
            .ignoresSafeArea()
    }
}

struct OrbCausticsView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbCaustics(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.74),
                        .float(1.3),
                        .float(0.1),
                        .float(0.28),
                        .float(2.1),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#0D0A33")),
                        .color(Color(hex: "#0F082E")),
                        .color(Color(hex: "#120633")),
                        .color(Color(hex: "#02030D")),
                        .color(Color(hex: "#1F6BFF")),
                        .color(Color(hex: "#C742FF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#1F6BFF")),
                        .color(Color(hex: "#000000")),
                        .color(Color(hex: "#253F62")),
                        .color(Color(hex: "#7FBDF1")),
                        .color(Color(hex: "#DAFFD2")),
                        .color(Color(hex: "#FFC435")),
                        .color(Color(hex: "#DA460A")),
                        .color(Color(hex: "#800093")),
                        .color(Color(hex: "#2538FF")),
                        .color(Color(hex: "#2538FF")),
                        .color(Color(hex: "#2538FF")),
                        .color(Color(hex: "#2538FF")),
                        .color(Color(hex: "#2538FF"))
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
