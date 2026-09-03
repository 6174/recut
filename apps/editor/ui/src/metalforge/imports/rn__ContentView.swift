import SwiftUI
import MetalKit
import simd

struct ParticleUniforms {
    var rotation: Float
    var spin: Float
    var radius: Float
    var strength: Float
    var decay: Float
    var turbulence: Float
    var pointSizeScale: Float
    var aspect: Float
    var pointScale: Float
    var time: Float
    var touchCount: Int32
    var backColor: SIMD4<Float>
    var glowColor: SIMD4<Float>
    var frontColor: SIMD4<Float>
}

final class ParticleRenderer: NSObject, MTKViewDelegate {
    static let particleCount = 150000
    static let maxTouches = 64
    static let touchMaxAge: Float = 2.0

    var rotation: Float = 0.0
    var spin: Float = 0.0
    var radius: Float = 0.32
    var strength: Float = 5.6
    var decay: Float = 2.5
    var turbulence: Float = 1.0
    var pointSizeScale: Float = 1.0
    var backColor: SIMD3<Float> = SIMD3(0.051, 0.302, 0.549)
    var glowColor: SIMD3<Float> = SIMD3(0.4353, 0.702, 0.851)
    var frontColor: SIMD3<Float> = SIMD3(0.949, 1, 0.9804)

    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private var aspect: Float = 1
    private let startTime = CACurrentMediaTime()
    private var lastDrawTime: CFTimeInterval = 0
    private var touches: [SIMD4<Float>] = []
    private var lastTouchSample: SIMD2<Float>?

    func recordTouch(ndcX: Float, ndcY: Float) {
        let newPos = SIMD2<Float>(ndcX, ndcY)
        if let last = lastTouchSample {
            let delta = newPos - last
            let dist = sqrt(delta.x * delta.x + delta.y * delta.y)
            let maxStep: Float = 0.02
            if dist > maxStep {
                let steps = min(24, Int(ceil(dist / maxStep)))
                for i in 1..<steps {
                    let f = Float(i) / Float(steps)
                    let pt = last + delta * f
                    touches.insert(SIMD4<Float>(pt.x, pt.y, 0, 0), at: 0)
                }
            }
        }
        touches.insert(SIMD4<Float>(ndcX, ndcY, 0, 0), at: 0)
        if touches.count > Self.maxTouches {
            touches.removeLast(touches.count - Self.maxTouches)
        }
        lastTouchSample = newPos
    }

    func endTouchStroke() { lastTouchSample = nil }

    init?(view: MTKView) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary(),
              let vfn = library.makeFunction(name: "particle_vertex"),
              let ffn = library.makeFunction(name: "particle_fragment")
        else { return nil }

        view.device = device
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        view.isPaused = false
        view.enableSetNeedsDisplay = false

        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = vfn
        desc.fragmentFunction = ffn
        let attach = desc.colorAttachments[0]!
        attach.pixelFormat = view.colorPixelFormat
        attach.isBlendingEnabled = true
        attach.rgbBlendOperation = .add
        attach.alphaBlendOperation = .add
        attach.sourceRGBBlendFactor = .one
        attach.sourceAlphaBlendFactor = .one
        attach.destinationRGBBlendFactor = .one
        attach.destinationAlphaBlendFactor = .one

        guard let pipe = try? device.makeRenderPipelineState(descriptor: desc)
        else { return nil }

        self.device = device
        self.queue = queue
        self.pipeline = pipe
        super.init()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        aspect = size.height > 0 ? Float(size.width / size.height) : 1
    }

    func draw(in view: MTKView) {
        guard let rpd = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let cmd = queue.makeCommandBuffer(),
              let enc = cmd.makeRenderCommandEncoder(descriptor: rpd)
        else { return }

        let now = CACurrentMediaTime()
        let dt = lastDrawTime > 0 ? Float(now - lastDrawTime) : 0
        lastDrawTime = now

        if !touches.isEmpty {
            for i in touches.indices { touches[i].z += dt }
            touches.removeAll { $0.z > Self.touchMaxAge }
        }

        let scale = Float(view.drawableSize.height) / 1200.0
        var u = ParticleUniforms(
            rotation: rotation,
            spin: spin,
            radius: radius,
            strength: strength,
            decay: decay,
            turbulence: turbulence,
            pointSizeScale: pointSizeScale,
            aspect: aspect,
            pointScale: max(1.0, 1.5 * scale),
            time: Float(now - startTime),
            touchCount: Int32(touches.count),
            backColor: SIMD4(backColor, 1),
            glowColor: SIMD4(glowColor, 1),
            frontColor: SIMD4(frontColor, 1)
        )

        enc.setRenderPipelineState(pipeline)
        enc.setVertexBytes(&u, length: MemoryLayout<ParticleUniforms>.stride, index: 0)
        enc.setFragmentBytes(&u, length: MemoryLayout<ParticleUniforms>.stride, index: 0)
        var touchBuf = touches.isEmpty ? [SIMD4<Float>(0, 0, 99, 0)] : touches
        enc.setVertexBytes(&touchBuf,
                           length: MemoryLayout<SIMD4<Float>>.stride * touchBuf.count,
                           index: 1)
        enc.drawPrimitives(type: .point, vertexStart: 0, vertexCount: Self.particleCount)
        enc.endEncoding()
        cmd.present(drawable)
        cmd.commit()
    }
}

#if canImport(UIKit)
import UIKit
typealias PlatformViewRepresentable = UIViewRepresentable
#else
import AppKit
typealias PlatformViewRepresentable = NSViewRepresentable
#endif

struct MetalView: PlatformViewRepresentable {
    var rotation: Float
    var spin: Float
    var radius: Float
    var strength: Float
    var decay: Float
    var turbulence: Float
    var pointSizeScale: Float
    var touchPoint: SIMD2<Float>?
    var touchID: UInt64
    var backColor: SIMD3<Float>
    var glowColor: SIMD3<Float>
    var frontColor: SIMD3<Float>

    final class Coordinator {
        var renderer: ParticleRenderer?
        var lastTouchID: UInt64 = 0
        var wasActive = false
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func makeMTKView(_ coordinator: Coordinator) -> MTKView {
        let view = MTKView()
        view.device = MTLCreateSystemDefaultDevice()
        view.framebufferOnly = true
        view.preferredFramesPerSecond = 60
        if let r = ParticleRenderer(view: view) {
            coordinator.renderer = r
            view.delegate = r
        }
        return view
    }

    private func apply(_ coordinator: Coordinator) {
        guard let r = coordinator.renderer else { return }
        r.rotation = rotation
        r.spin = spin
        r.radius = radius
        r.strength = strength
        r.decay = decay
        r.turbulence = turbulence
        r.pointSizeScale = pointSizeScale
        r.backColor = backColor
        r.glowColor = glowColor
        r.frontColor = frontColor
        if let t = touchPoint, touchID != coordinator.lastTouchID {
            r.recordTouch(ndcX: t.x, ndcY: t.y)
            coordinator.lastTouchID = touchID
            coordinator.wasActive = true
        } else if touchPoint == nil && coordinator.wasActive {
            r.endTouchStroke()
            coordinator.wasActive = false
        }
    }

    #if canImport(UIKit)
    func makeUIView(context: Context) -> MTKView { makeMTKView(context.coordinator) }
    func updateUIView(_ uiView: MTKView, context: Context) { apply(context.coordinator) }
    #else
    func makeNSView(context: Context) -> MTKView { makeMTKView(context.coordinator) }
    func updateNSView(_ nsView: MTKView, context: Context) { apply(context.coordinator) }
    #endif
}

struct ContentView: View {
    @State private var touchPoint: SIMD2<Float>? = nil
    @State private var touchID: UInt64 = 0

    var body: some View {
        GeometryReader { geo in
            MetalView(
                rotation: 0.0,
                spin: 0.0,
                radius: 0.32,
                strength: 5.6,
                decay: 2.5,
                turbulence: 1.0,
                pointSizeScale: 1.0,
                touchPoint: touchPoint,
                touchID: touchID,
                backColor: SIMD3(0.051, 0.302, 0.549),
                glowColor: SIMD3(0.4353, 0.702, 0.851),
                frontColor: SIMD3(0.949, 1, 0.9804)
            )
            .background(Color.black)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let w = max(geo.size.width, 1)
                        let h = max(geo.size.height, 1)
                        let nx = Float((value.location.x / w) * 2 - 1)
                        let ny = Float(1 - (value.location.y / h) * 2)
                        touchPoint = SIMD2<Float>(nx, ny)
                        touchID &+= 1
                    }
                    .onEnded { _ in touchPoint = nil }
            )
        }
        .ignoresSafeArea()
    }
}

#Preview {
    ContentView()
}
