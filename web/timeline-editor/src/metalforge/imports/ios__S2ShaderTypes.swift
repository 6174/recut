import simd

struct S2PV {
    var pos: SIMD2<Float>
    var vel: SIMD2<Float>
}

struct S2NodeStatic {
    var home: SIMD2<Float>
    var radius: Float
    var spawn: Float
    var formStart: Float
    var seed: Float
    var group: UInt32
    var pad: Float = 0
}

struct S2Edge {
    var a: UInt32
    var b: UInt32
    var rest: Float
    var activation: Float
}

struct S2Neighbor {
    var node: UInt32
    var edge: UInt32
}

struct S2Params {
    var viewport: SIMD2<Float> = .zero
    var camPan: SIMD2<Float> = .zero
    var time: Float = 0
    var dt: Float = 0
    var progress: Float = 0
    var repulsion: Float = 0
    var springK: Float = 0
    var centerK: Float = 0
    var damping: Float = 0
    var radialR: Float = 0
    var maxSpeed: Float = 0
    var rotation: Float = 0
    var scale: Float = 0
    var spaceBreath: Float = 0
    var zoom: Float = 0
    var pad0: Float = 0
    var nodeCount: UInt32 = 0
    var edgeCount: UInt32 = 0

    var nodeColor: SIMD3<Float> = SIMD3(1, 1, 1)
    var edgeColor: SIMD3<Float> = SIMD3(1, 1, 1)
    var edgeAlpha: Float = 0.45
    var nodeSize: Float = 1.3
    var lineScale: Float = 1.0
    var glow: Float = 1.0
}
