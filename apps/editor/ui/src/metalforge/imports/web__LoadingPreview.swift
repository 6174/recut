import SwiftUI
import MetalKit
import Combine
import simd

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

struct LoadingConfig {

    var speed: Double = 1.0

    var loops: Bool = false

    var background: Color = Color(red: 0.1059, green: 0.1059, blue: 0.1333)

    var nodeColor: Color = Color(red: 1, green: 1, blue: 1)

    var edgeColor: Color = Color(red: 1, green: 1, blue: 1)

    var edgeOpacity: Double = 0.45

    var labelColor: Color = Color(red: 1, green: 1, blue: 1)

    var statusTextColor: Color = Color(red: 1, green: 1, blue: 1)

    var accent: Color = Color(red: 0.9412, green: 0.2706, blue: 0.3804)

    var nodeSize: Double = 1.0

    var glow: Double = 1.0

    var lineThickness: Double = 1.0

    var spin: Double = 1.0

    var floatingLabels: [String] = ["IDENTITY", "LOCATION", "INTERESTS", "CONTACTS", "BEHAVIOR", "PREFERENCES", "DEVICES", "SOCIAL GRAPH", "PURCHASES", "ACTIVITY", "SEARCH HISTORY", "BIOMETRICS"]

    var showLabels: Bool = true

    var labelSize: Double = 10.5

    var statusPhases: [String] = ["COLLECTING DATA", "INDEXING MEMORIES", "LINKING CONCEPTS", "MAPPING CONNECTIONS", "ORGANIZING THOUGHTS"]

    var readyText: String = "SECOND BRAIN READY"

    var showPercentage: Bool = true

    var ctaText: String = "Get Started"
    var showCTA: Bool = true

    var showRestartButton: Bool = true

    var nodeCount: Int = 260

    var clusterCount: Int = 12

    static let `default` = LoadingConfig()
}

struct LoadingPreviewView: View {
    let config: LoadingConfig
    @StateObject private var controller = S2GraphController()

    init(config: LoadingConfig = .default) { self.config = config }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                config.background.ignoresSafeArea()

                S2MetalGraphView(controller: controller, config: config)
                    .ignoresSafeArea()

                labels(in: geo.size)

                overlay
            }
        }
        .preferredColorScheme(.dark)
    }

    private func labels(in size: CGSize) -> some View {
        let state = controller.labels
        let names = config.floatingLabels.isEmpty ? [""] : config.floatingLabels
        return Group {
            if config.showLabels {
                ForEach(state.centroids.indices, id: \.self) { i in
                    let p = S2Project.project(state.centroids[i], size: size, camPan: state.camPan,
                                              rotation: state.rotation, zoomBreath: state.zoomBreath)
                    let op = i < state.opacities.count ? Double(state.opacities[i]) : 0
                    Text(names[i % names.count])
                        .font(.system(size: CGFloat(config.labelSize), weight: .semibold, design: .monospaced))
                        .tracking(1.4)
                        .foregroundStyle(config.labelColor.opacity(0.92))
                        .shadow(color: .black.opacity(0.65), radius: 4)
                        .opacity(op)
                        .blur(radius: CGFloat(1 - op) * 3)
                        .position(x: p.x, y: p.y - 16 - CGFloat(1 - op) * 8)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    private var overlay: some View {
        let done = controller.progress >= 0.999

        return VStack(spacing: 0) {
            HStack {
                Spacer()
                if config.showRestartButton {
                    Button(action: controller.restart) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                            .padding(9)
                            .background(.white.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer()

            VStack(spacing: 22) {
                S2StatusReadout(progress: controller.progress, config: config)

                if done && config.showCTA {
                    Button(action: controller.restart) {
                        Text(config.ctaText)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Color.white, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.55, dampingFraction: 0.82), value: done)
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct S2StatusReadout: View {
    let progress: Double
    let config: LoadingConfig

    private var message: String {
        let phases = config.statusPhases
        if progress >= 0.999 { return config.readyText }
        guard !phases.isEmpty else { return "" }
        let i = min(phases.count - 1, max(0, Int(progress * Double(phases.count))))
        return phases[i]
    }

    var body: some View {
        VStack(spacing: 12) {
            Text(message)
                .font(.system(size: 23, weight: .semibold, design: .monospaced))
                .tracking(2.5)
                .foregroundStyle(config.statusTextColor.opacity(0.92))
                .contentTransition(.numericText())
                .animation(.easeInOut(duration: 0.5), value: message)

            if config.showPercentage {
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 23, weight: .medium, design: .monospaced))
                    .foregroundStyle(config.statusTextColor.opacity(0.95))
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.3), value: progress)
            }
        }
        .shadow(color: .black.opacity(0.5), radius: 6)
    }
}

struct S2LabelState {
    var centroids: [SIMD2<Float>] = []
    var opacities: [Float] = []
    var camPan: SIMD2<Float> = .zero
    var rotation: Float = 0
    var zoomBreath: Float = 1
}

@MainActor
final class S2GraphController: ObservableObject {
    @Published var progress: Double = 0
    @Published var labels = S2LabelState()

    private var restartRequested = false
    private var seedCounter: UInt64 = 1

    func restart() { restartRequested = true }

    func consumeRestart() -> Bool {
        defer { restartRequested = false }
        return restartRequested
    }

    func nextSeed() -> UInt64 {
        seedCounter &+= 1
        return seedCounter
    }
}

enum S2Project {
    static func project(_ p: SIMD2<Float>, size: CGSize, camPan: SIMD2<Float>,
                        rotation: Float, zoomBreath: Float) -> CGPoint {
        let s = 0.46 * Float(min(size.width, size.height)) * zoomBreath
        let c = cos(rotation), sn = sin(rotation)
        let rx = (c * p.x - sn * p.y) - camPan.x
        let ry = (sn * p.x + c * p.y) - camPan.y
        return CGPoint(x: CGFloat(Float(size.width) / 2 + rx * s),
                       y: CGFloat(Float(size.height) / 2 - ry * s))
    }
}

#if os(macOS)
typealias S2ViewRepresentable = NSViewRepresentable
#else
typealias S2ViewRepresentable = UIViewRepresentable
#endif

struct S2MetalGraphView: S2ViewRepresentable {
    @ObservedObject var controller: S2GraphController
    let config: LoadingConfig

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func renderConfig() -> S2RenderConfig {
        S2RenderConfig(speed: Float(config.speed),
                       nodeColor: config.nodeColor.s2rgb,
                       edgeColor: config.edgeColor.s2rgb,
                       edgeAlpha: Float(config.edgeOpacity),
                       background: config.background.s2rgb,
                       nodeCount: config.nodeCount,
                       clusterCount: config.clusterCount,
                       loops: config.loops,
                       nodeSize: Float(config.nodeSize),
                       lineScale: Float(config.lineThickness),
                       glow: Float(config.glow),
                       spin: Float(config.spin))
    }

    private func makeMTKView(_ coordinator: Coordinator) -> MTKView {
        let view = MTKView()
        view.device = MTLCreateSystemDefaultDevice()
        view.colorPixelFormat = .bgra8Unorm
        let bg = config.background.s2rgb
        view.clearColor = MTLClearColorMake(Double(bg.x), Double(bg.y), Double(bg.z), 1.0)
        view.preferredFramesPerSecond = 60
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        view.framebufferOnly = true
        #if os(macOS)
        view.layer?.isOpaque = true
        #else
        view.isOpaque = true
        #endif

        if let renderer = S2Renderer(mtkView: view, controller: controller, config: renderConfig()) {
            coordinator.renderer = renderer
            view.delegate = renderer
        }
        return view
    }

    #if os(macOS)
    func makeNSView(context: Context) -> MTKView { makeMTKView(context.coordinator) }
    func updateNSView(_ nsView: MTKView, context: Context) {}
    #else
    func makeUIView(context: Context) -> MTKView { makeMTKView(context.coordinator) }
    func updateUIView(_ uiView: MTKView, context: Context) {}
    #endif

    final class Coordinator {
        var renderer: S2Renderer?
    }
}

extension Color {
    var s2rgb: SIMD3<Float> {
        #if canImport(UIKit)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return SIMD3(Float(r), Float(g), Float(b))
        #elseif canImport(AppKit)
        let c = NSColor(self).usingColorSpace(.sRGB) ?? .white
        return SIMD3(Float(c.redComponent), Float(c.greenComponent), Float(c.blueComponent))
        #else
        return SIMD3(1, 1, 1)
        #endif
    }
}

#Preview("Second Brain — customise via LoadingConfig") {
    LoadingPreviewView(config: .default)
}
