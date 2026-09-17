import MetalKit
import QuartzCore
import simd
import Foundation

struct S2RenderConfig {
    var speed: Float
    var nodeColor: SIMD3<Float>
    var edgeColor: SIMD3<Float>
    var edgeAlpha: Float
    var background: SIMD3<Float>
    var nodeCount: Int
    var clusterCount: Int
    var loops: Bool
    var nodeSize: Float
    var lineScale: Float
    var glow: Float
    var spin: Float
}

private func s2MakeBuffer<T>(_ device: MTLDevice, _ array: [T]) -> MTLBuffer {
    array.withUnsafeBytes { raw in
        device.makeBuffer(bytes: raw.baseAddress!, length: raw.count, options: .storageModeShared)!
    }
}

@inline(__always) private func s2Smoothstep(_ a: Float, _ b: Float, _ x: Float) -> Float {
    let t = max(0, min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

@MainActor
final class S2Renderer: NSObject, MTKViewDelegate {

    private let device: MTLDevice
    private let queue: MTLCommandQueue

    private var computePSO: MTLComputePipelineState!
    private var nodePSO: MTLRenderPipelineState!
    private var edgePSO: MTLRenderPipelineState!

    private var pvA: MTLBuffer
    private var pvB: MTLBuffer
    private var staticsBuf: MTLBuffer
    private var edgesBuf: MTLBuffer
    private var neighborsBuf: MTLBuffer
    private var offsetsBuf: MTLBuffer
    private var readingA = true

    private var data: S2GraphData
    private var params = S2Params()
    private let cfg: S2RenderConfig

    private weak var controller: S2GraphController?
    private var startTime = CACurrentMediaTime()
    private let duration: Float = 15.0

    private var camPan = SIMD2<Float>(repeating: 0)
    private var camZoom: Float = 1.10

    private struct Stop { var group: Int; var zoom: Float; var moveStart: Float; var arrive: Float }
    private var stops: [Stop] = []
    private var labelStartT: [Float] = []
    private var labelEndT: [Float] = []

    init?(mtkView: MTKView, controller: S2GraphController, config: S2RenderConfig) {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.queue = queue
        self.controller = controller
        self.cfg = config

        let d = S2GraphGenerator.make(nodeCount: config.nodeCount,
                                      clusters: config.clusterCount, seed: 1)
        self.data = d
        self.pvA = s2MakeBuffer(device, d.pv)
        self.pvB = s2MakeBuffer(device, d.pv)
        self.staticsBuf = s2MakeBuffer(device, d.statics)
        self.edgesBuf = s2MakeBuffer(device, d.edges)
        self.neighborsBuf = s2MakeBuffer(device, d.neighbors)
        self.offsetsBuf = s2MakeBuffer(device, d.offsets)

        super.init()
        buildPipelines(view: mtkView)
        buildSchedule()
    }

    private func buildSchedule() {
        let settle: Float = 0.4
        let establishTravel: Float = 2.5
        let zMid: Float = 1.25
        let firstTravel: Float = 2.0
        let travel: Float = 1.4
        let hold: Float   = 0.9
        let lastBeat: Float = 0.4
        let wideTravel: Float = 3.0
        let zStart: Float = 0.90
        let zClose: Float = 1.70
        let zFinal: Float = 0.82

        var s: [Stop] = [Stop(group: -1, zoom: zStart, moveStart: 0, arrive: 0)]
        var t = settle
        let establishArrive = t + establishTravel
        s.append(Stop(group: -1, zoom: zMid, moveStart: t, arrive: establishArrive))
        t = establishArrive
        let last = data.heroGroups.count - 1
        var lastHeroArrive: Float = t
        for (k, g) in data.heroGroups.enumerated() {
            let arrive = t + (k == 0 ? firstTravel : travel)
            s.append(Stop(group: g, zoom: zClose, moveStart: t, arrive: arrive))
            lastHeroArrive = arrive
            t = arrive + (k == last ? lastBeat : hold)
        }
        let wideArrive = t + wideTravel
        s.append(Stop(group: -1, zoom: zFinal, moveStart: t, arrive: wideArrive))
        stops = s

        let n = data.clusterCount
        labelStartT = [Float](repeating: 1e9, count: n)
        labelEndT = [Float](repeating: 1e9 + 1, count: n)
        for st in s where st.group >= 0 {
            labelStartT[st.group] = st.arrive - 1.0
            labelEndT[st.group] = st.arrive
        }
        let heroSet = Set(data.heroGroups)
        let others = data.labelOrder.filter { !heroSet.contains($0) }
        let extra = Array(others.prefix(max(0, 6 - heroSet.count)))
        for (i, g) in extra.enumerated() {
            let start = lastHeroArrive + Float(i) * 0.35
            labelStartT[g] = start
            labelEndT[g] = start + 0.7
        }
    }

    private func buildPipelines(view: MTKView) {
        guard let lib = device.makeDefaultLibrary() else {
            fatalError("Could not load default Metal library")
        }
        computePSO = try! device.makeComputePipelineState(function: lib.makeFunction(name: "s2_integrate")!)

        func renderPSO(_ vertex: String, _ fragment: String) -> MTLRenderPipelineState {
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = lib.makeFunction(name: vertex)
            desc.fragmentFunction = lib.makeFunction(name: fragment)
            let att = desc.colorAttachments[0]!
            att.pixelFormat = view.colorPixelFormat
            att.isBlendingEnabled = true
            att.rgbBlendOperation = .add
            att.alphaBlendOperation = .add
            att.sourceRGBBlendFactor = .one
            att.sourceAlphaBlendFactor = .one
            att.destinationRGBBlendFactor = .oneMinusSourceAlpha
            att.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            return try! device.makeRenderPipelineState(descriptor: desc)
        }
        edgePSO = renderPSO("s2_edge_vertex", "s2_edge_fragment")
        nodePSO = renderPSO("s2_node_vertex", "s2_node_fragment")
    }

    private func regenerate(seed: UInt64) {
        let d = S2GraphGenerator.make(nodeCount: cfg.nodeCount, clusters: cfg.clusterCount, seed: seed)
        data = d
        pvA = s2MakeBuffer(device, d.pv)
        pvB = s2MakeBuffer(device, d.pv)
        staticsBuf = s2MakeBuffer(device, d.statics)
        edgesBuf = s2MakeBuffer(device, d.edges)
        neighborsBuf = s2MakeBuffer(device, d.neighbors)
        offsetsBuf = s2MakeBuffer(device, d.offsets)
        readingA = true
        startTime = CACurrentMediaTime()
        camPan = .zero
        camZoom = 1.10
        buildSchedule()
    }

    private func computeCentroids(from buffer: MTLBuffer) -> [SIMD2<Float>] {
        let ptr = buffer.contents().bindMemory(to: S2PV.self, capacity: data.nodeCount)
        var centroids = [SIMD2<Float>](repeating: .zero, count: data.groupMembers.count)
        for (gi, members) in data.groupMembers.enumerated() where !members.isEmpty {
            var sum = SIMD2<Float>(repeating: 0)
            for idx in members { sum += ptr[idx].pos }
            centroids[gi] = sum * (1.0 / Float(members.count))
        }
        return centroids
    }

    private func updateCamera(time: Float, centroids: [SIMD2<Float>], rotation: Float) {
        func stopPos(_ st: Stop) -> SIMD2<Float> {
            guard st.group >= 0, st.group < centroids.count else { return .zero }
            let c = centroids[st.group]
            let cs = cos(rotation), sn = sin(rotation)
            return SIMD2(cs * c.x - sn * c.y, sn * c.x + cs * c.y)
        }
        guard stops.count >= 2 else { return }

        var pan = stopPos(stops[stops.count - 1])
        var zoom = stops[stops.count - 1].zoom
        for i in 0..<(stops.count - 1) {
            let a = stops[i], b = stops[i + 1]
            if time < b.moveStart {
                pan = stopPos(a); zoom = a.zoom; break
            } else if time < b.arrive {
                let u = (time - b.moveStart) / max(b.arrive - b.moveStart, 1e-4)
                let e = u * u * (3 - 2 * u)
                let pa = stopPos(a), pb = stopPos(b)
                pan = pa + (pb - pa) * e
                var z = a.zoom + (b.zoom - a.zoom) * e
                if a.group >= 0 && b.group >= 0 {
                    let dist = simd_length(pb - pa)
                    let dip = min(dist * 0.8, 0.55)
                    z *= (1 - dip * sin(Float.pi * u))
                }
                zoom = z; break
            } else {
                pan = stopPos(b); zoom = b.zoom
            }
        }

        camPan += (pan - camPan) * 0.25
        camZoom += (zoom - camZoom) * 0.25
    }

    private func updateParams(view: MTKView, progress: Float, time: Float, rotation: Float) {
        let ds = view.drawableSize
        let viewport = SIMD2<Float>(Float(max(ds.width, 1)), Float(max(ds.height, 1)))
        let minDim = min(viewport.x, viewport.y)

        params.viewport = viewport
        params.camPan = camPan
        params.zoom = camZoom
        params.scale = 0.552 * minDim * camZoom
        params.time = time
        params.dt = 0.2
        params.progress = progress
        params.repulsion = 0.0009
        params.springK = 3.0
        params.centerK = 0.9
        params.damping = 0.90
        params.radialR = 0.95
        params.maxSpeed = 0.08
        params.rotation = rotation
        params.spaceBreath = 1.0 + 0.012 * sin(time * 0.8)
        params.nodeCount = UInt32(data.nodeCount)
        params.edgeCount = UInt32(data.edgeCount)
        params.nodeColor = cfg.nodeColor
        params.edgeColor = cfg.edgeColor
        params.edgeAlpha = cfg.edgeAlpha
        params.nodeSize = cfg.nodeSize
        params.lineScale = cfg.lineScale
        params.glow = cfg.glow
    }

    private func publishLabels(centroids: [SIMD2<Float>], time: Float) {
        guard let c = controller, !centroids.isEmpty else { return }
        var ops = [Float](repeating: 0, count: centroids.count)
        let fade = 1 - s2Smoothstep(12.8, 14.5, time)
        for i in 0..<centroids.count where i < labelStartT.count {
            ops[i] = s2Smoothstep(labelStartT[i], labelEndT[i], time) * fade
        }
        c.labels = S2LabelState(centroids: centroids,
                                opacities: ops,
                                camPan: camPan,
                                rotation: params.rotation,
                                zoomBreath: params.zoom * params.spaceBreath)
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let drawable = view.currentDrawable,
              let rpd = view.currentRenderPassDescriptor,
              let cmd = queue.makeCommandBuffer() else { return }

        if let c = controller, c.consumeRestart() {
            regenerate(seed: c.nextSeed())
        }

        let raw = Float(CACurrentMediaTime() - startTime)
        let elapsed = raw * max(cfg.speed, 0.01)
        let linear = min(elapsed / duration, 1.0)

        if cfg.loops && linear >= 1.0 && (elapsed - duration) > 2.0 {
            regenerate(seed: controller?.nextSeed() ?? 1)
        }

        let src = readingA ? pvA : pvB
        let dst = readingA ? pvB : pvA

        let centroids = computeCentroids(from: src)
        let rotation = elapsed * 0.05 * cfg.spin * s2Smoothstep(0.78, 1.0, linear)
        updateCamera(time: elapsed, centroids: centroids, rotation: rotation)
        updateParams(view: view, progress: linear, time: elapsed, rotation: rotation)
        publishLabels(centroids: centroids, time: elapsed)

        if let c = controller {
            let p = Double(linear)
            if abs(c.progress - p) > 0.005 || (p >= 1.0 && c.progress < 1.0) {
                c.progress = p
            }
        }

        if let ce = cmd.makeComputeCommandEncoder() {
            ce.setComputePipelineState(computePSO)
            ce.setBuffer(src, offset: 0, index: 0)
            ce.setBuffer(dst, offset: 0, index: 1)
            ce.setBuffer(staticsBuf, offset: 0, index: 2)
            ce.setBuffer(edgesBuf, offset: 0, index: 3)
            ce.setBuffer(neighborsBuf, offset: 0, index: 4)
            ce.setBuffer(offsetsBuf, offset: 0, index: 5)
            ce.setBytes(&params, length: MemoryLayout<S2Params>.stride, index: 6)
            let width = min(computePSO.maxTotalThreadsPerThreadgroup, 64)
            ce.dispatchThreads(MTLSize(width: data.nodeCount, height: 1, depth: 1),
                               threadsPerThreadgroup: MTLSize(width: width, height: 1, depth: 1))
            ce.endEncoding()
        }
        readingA.toggle()
        let current = dst

        rpd.colorAttachments[0].clearColor = MTLClearColorMake(
            Double(cfg.background.x), Double(cfg.background.y), Double(cfg.background.z), 1.0)
        rpd.colorAttachments[0].loadAction = .clear

        if let re = cmd.makeRenderCommandEncoder(descriptor: rpd) {
            re.setRenderPipelineState(edgePSO)
            re.setVertexBuffer(current, offset: 0, index: 0)
            re.setVertexBuffer(edgesBuf, offset: 0, index: 1)
            re.setVertexBytes(&params, length: MemoryLayout<S2Params>.stride, index: 2)
            re.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6,
                              instanceCount: data.edgeCount)

            re.setRenderPipelineState(nodePSO)
            re.setVertexBuffer(current, offset: 0, index: 0)
            re.setVertexBuffer(staticsBuf, offset: 0, index: 1)
            re.setVertexBytes(&params, length: MemoryLayout<S2Params>.stride, index: 2)
            re.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6,
                              instanceCount: data.nodeCount)
            re.endEncoding()
        }

        cmd.present(drawable)
        cmd.commit()
    }
}
