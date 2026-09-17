import SwiftUI

struct ContentView: View {
    var body: some View {
        MeshView()
            .ignoresSafeArea()
    }
}

struct MeshView: View {
    private let base: [SIMD2<Float>] = [
        SIMD2<Float>(0.0, 0.0), SIMD2<Float>(0.333, 0.0), SIMD2<Float>(0.667, 0.0), SIMD2<Float>(1.0, 0.0),
        SIMD2<Float>(0.0, 0.333), SIMD2<Float>(0.333, 0.333), SIMD2<Float>(0.667, 0.333), SIMD2<Float>(1.0, 0.333),
        SIMD2<Float>(0.0, 0.667), SIMD2<Float>(0.333, 0.667), SIMD2<Float>(0.667, 0.667), SIMD2<Float>(1.0, 0.667),
        SIMD2<Float>(0.0, 1.0), SIMD2<Float>(0.333, 1.0), SIMD2<Float>(0.667, 1.0), SIMD2<Float>(1.0, 1.0),
    ]

    private let colors: [Color] = [
        Color(hex: "#141415"), Color(hex: "#ABAEB5"), Color(hex: "#6C6E75"), Color(hex: "#2E3034"),
        Color(hex: "#696B74"), Color(hex: "#2B2C32"), Color(hex: "#C8C9CD"), Color(hex: "#828694"),
        Color(hex: "#C5C7CC"), Color(hex: "#83868E"), Color(hex: "#44464E"), Color(hex: "#E4E4E6"),
        Color(hex: "#42444C"), Color(hex: "#E1E2E4"), Color(hex: "#9C9FAA"), Color(hex: "#5E6069"),
    ]

    private let freedom: [SIMD2<Float>] = [
        SIMD2<Float>(0.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(0.0, 0.0),
        SIMD2<Float>(0.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(0.0, 1.0),
        SIMD2<Float>(0.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(1.0, 1.0), SIMD2<Float>(0.0, 1.0),
        SIMD2<Float>(0.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(1.0, 0.0), SIMD2<Float>(0.0, 0.0),
    ]

    private let speed: Float = 1.0
    private let drift: Float = 0.35

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
        }
    }

    private func gradient(at t: Float) -> some View {
        MeshGradient(
            width: 4, height: 4,
            points: pointsAt(t),
            colors: colors,
            background: Color(hex: "#000000"),
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
