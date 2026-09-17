import SwiftUI

struct ContentView: View {
    var body: some View {
        HyperspaceView()
            .ignoresSafeArea()
    }
}

struct HyperspaceView: View {
    @State private var startedAt = Date(timeIntervalSinceNow: -5.0)

    var body: some View {
        ZStack(alignment: .bottom) {
            TimelineView(.animation) { ctx in
                let t = ctx.date.timeIntervalSince(startedAt)

                Color.black
                    .colorEffect(
                        ShaderLibrary.hyperspace(
                            .boundingRect,
                            .float(Float(t)),
                            .float(1.0),
                            .float(5.0),
                            .float(2.5),
                            .float(2.0),
                            .float(0.0),
                            .float(1.5),
                            .float(1.0),
                            .float(3.0),
                            .float(1.0),
                            .float(1.0),
                            .float(1.0),
                            .float(1.0),
                            .float(1.0),
                            .float(0.7),
                            .float(1.0),
                            .float(1.0),
                            .float(1.7),
                            .float(0.3),
                            .float(0.0),
                            .color(Color(hex: "#7FD2FF")),
                            .color(Color(hex: "#CCE0FF")),
                            .color(Color(hex: "#FFFFFF")),
                            .color(Color(hex: "#FFFFFF"))
                        )
                    )
            }

            Button {
                startedAt = Date()
            } label: {
                Text("Jump to lightspeed")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.black)
                    .lineLimit(1)
                    .padding(.horizontal, 26)
                    .padding(.vertical, 14)
                    .background(.white, in: Capsule())
            }
            .padding(.bottom, 44)
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
