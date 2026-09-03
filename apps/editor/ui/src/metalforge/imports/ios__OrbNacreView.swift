import SwiftUI

struct ContentView: View {
    var body: some View {
        OrbNacreView()
            .ignoresSafeArea()
    }
}

struct OrbNacreView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.orbNacre(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(0.72),
                        .float(2.2),
                        .float(0.72),
                        .float(3.0),
                        .float(90.0),
                        .float(1.0),
                        .float(1.0),
                        .float(1.0),
                        .float(0.005),
                        .float(0.0),
                        .float(0.0),
                        .color(Color(hex: "#1A1C29")),
                        .color(Color(hex: "#EBEBEB")),
                        .color(Color(hex: "#16171D")),
                        .color(Color(hex: "#FFFFFF")),
                        .color(Color(hex: "#EBEBEB")),
                        .color(Color(hex: "#000000")),
                        .color(Color(hex: "#253A58")),
                        .color(Color(hex: "#7FB4E7")),
                        .color(Color(hex: "#DAFEE7")),
                        .color(Color(hex: "#FFD458")),
                        .color(Color(hex: "#DA5D00")),
                        .color(Color(hex: "#800658")),
                        .color(Color(hex: "#251EE7")),
                        .color(Color(hex: "#251EE7")),
                        .color(Color(hex: "#251EE7")),
                        .color(Color(hex: "#251EE7")),
                        .color(Color(hex: "#251EE7"))
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
