import SwiftUI

struct ContentView: View {
    var body: some View {
        ConcentricRingsView()
            .ignoresSafeArea()
    }
}

struct ConcentricRingsView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Image("image name")
                .resizable()
                .scaledToFill()
                .scaleEffect(1.1)
                .layerEffect(
                    ShaderLibrary.concentricRings(
                        .boundingRect,
                        .float(Float(t)),
                        .float(0.5),
                        .float(0.68),
                        .float(10.0),
                        .float(14.0),
                        .float(101.0),
                        .float(0.0029),
                        .float(0.1),
                        .float(1.4),
                        .float(0.0),
                        .color(Color(hex: "#FFFFFF"))
                    ),
                        maxSampleOffset: CGSize(width: 16, height: 16)
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
