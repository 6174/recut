import SwiftUI

struct ContentView: View {
    var body: some View {
        GrainView()
            .ignoresSafeArea()
    }
}

struct GrainView: View {
    @State private var start: Date = .now

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)

            Color.black
                .colorEffect(
                    ShaderLibrary.grainGradient(
                        .boundingRect,
                        .float(Float(t)),
                        .float(1.0),
                        .float(2.0),
                        .float(16.0),
                        .float(1.0),
                        .color(Color(hex: "#9A502B")),
                        .color(Color(hex: "#83809B")),
                        .color(Color(hex: "#002142")),
                        .color(Color(hex: "#3A3F5E")),
                        .color(Color(hex: "#04172E")),
                        .color(Color(hex: "#BE5704")),
                        .color(Color(hex: "#04172E")),
                        .color(Color(hex: "#AD4F03")),
                        .color(Color(hex: "#9B7683"))
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
