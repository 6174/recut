import SwiftUI

struct ContentView: View {
    var body: some View {
        AbyssView()
            .ignoresSafeArea()
    }
}

struct AbyssView: View {
    private let base: [SIMD2<Float>] = [
        SIMD2<Float>(0.0, 0.0), SIMD2<Float>(0.333, 0.0), SIMD2<Float>(0.667, 0.0), SIMD2<Float>(1.0, 0.0),
        SIMD2<Float>(0.0, 0.333), SIMD2<Float>(0.333, 0.333), SIMD2<Float>(0.667, 0.333), SIMD2<Float>(1.0, 0.333),
        SIMD2<Float>(0.0, 0.667), SIMD2<Float>(0.333, 0.667), SIMD2<Float>(0.667, 0.667), SIMD2<Float>(1.0, 0.667),
        SIMD2<Float>(0.0, 1.0), SIMD2<Float>(0.333, 1.0), SIMD2<Float>(0.667, 1.0), SIMD2<Float>(1.0, 1.0),
    ]

    private let colors: [Color] = [
        Color(hex: "#04051A"), Color(hex: "#081757"), Color(hex: "#1E5BFD"), Color(hex: "#050824"),
        Color(hex: "#143EB6"), Color(hex: "#D3EDF7"), Color(hex: "#071654"), Color(hex: "#1D59F8"),
        Color(hex: "#060E3A"), Color(hex: "#1237A7"), Color(hex: "#96E4FB"), Color(hex: "#071551"),
        Color(hex: "#2D95FF"), Color(hex: "#060D35"), Color(hex: "#103198"), Color(hex: "#5ADCFE"),
    ]

    private let freedom: [SIMD2<Float>] = [
        SIMD2<Float>(0.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(0.0, 0.0),
        SIMD2<Float>(0.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(0.0, 1.0),
        SIMD2<Float>(0.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(0.0, 1.0),
        SIMD2<Float>(0.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(0.0, 0.0),
    ]

    private let speed: Float = 1.0
    private let drift: Float = 0.45

    private let limits: [SIMD2<Float>] = [
        SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142),
        SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142),
        SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142),
        SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142), SIMD2<Float>(0.142, 0.142),
    ]

    @State private var start = Date()

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = Float(timeline.date.timeIntervalSince(start))
            gradient(at: t)
                .layerEffect(
                    ShaderLibrary.meshFilm(
                        .boundingRect,
                        .float(0.65),
                        .float(1.15),
                        .float(20.0),
                        .float(0.5),
                        .float(0.5),
                        .float(0.85)
                    ),
                    maxSampleOffset: .zero
                )
        }
    }

    private func gradient(at t: Float) -> some View {
        MeshGradient(
            width: 4, height: 4,
            points: pointsAt(t),
            colors: colors,
            background: Color(hex: "#04051A"),
            smoothsColors: true
        )
    }

    private func pointsAt(_ t: Float) -> [SIMD2<Float>] {
        let s = t * speed
        return base.indices.map { i in
            let ph = Float(i) * 2.39996323
            let dx = 0.6 * sin(0.9 * s + ph) + 0.4 * sin(1.37 * s + ph * 1.7)
            let dy = 0.6 * cos(1.13 * s + ph * 1.3) + 0.4 * cos(0.71 * s + ph * 2.1)
            let axes = freedom[i]
            let amp = drift * limits[i]
            return SIMD2<Float>(
                min(max(base[i].x + axes.x * amp.x * dx, 0), 1),
                min(max(base[i].y + axes.y * amp.y * dy, 0), 1)
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
