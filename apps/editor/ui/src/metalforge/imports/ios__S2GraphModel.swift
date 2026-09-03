import Foundation
import simd

struct S2GraphData {
    var pv: [S2PV]
    var statics: [S2NodeStatic]
    var edges: [S2Edge]
    var neighbors: [S2Neighbor]
    var offsets: [UInt32]
    var groupMembers: [[Int]]
    var clusterCount: Int
    var heroGroups: [Int]
    var labelOrder: [Int]

    var nodeCount: Int { pv.count }
    var edgeCount: Int { edges.count }
}

struct S2SplitMix64: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

enum S2GraphGenerator {

    static func make(nodeCount: Int = 260, clusters: Int = 12, seed: UInt64) -> S2GraphData {
        let nodeCount = max(clusters + 1, nodeCount)
        let clusters = max(2, clusters)

        var rng = S2SplitMix64(seed: seed)
        func f01() -> Float { Float(rng.next() >> 11) * (1.0 / 9_007_199_254_740_992.0) }
        func frange(_ a: Float, _ b: Float) -> Float { a + (b - a) * f01() }
        func pick(_ n: Int) -> Int { min(n - 1, Int(f01() * Float(n))) }

        var edgePairs: [(Int, Int)] = []
        var degree = [Int](repeating: 0, count: nodeCount)
        var nodeCluster = [Int](repeating: 0, count: nodeCount)
        var clusterMembers = [[Int]](repeating: [], count: clusters)

        for c in 0..<clusters {
            nodeCluster[c] = c
            clusterMembers[c].append(c)
        }

        for i in clusters..<nodeCount {
            let c = pick(clusters)
            nodeCluster[i] = c
            let members = clusterMembers[c]

            var total = 0
            for m in members { total += degree[m] + 1 }
            var roll = Int(f01() * Float(total))
            var target = members[0]
            for m in members {
                roll -= (degree[m] + 1)
                if roll < 0 { target = m; break }
            }

            edgePairs.append((i, target))
            degree[i] += 1; degree[target] += 1
            clusterMembers[c].append(i)
        }

        for _ in 0..<(nodeCount / 12) {
            let members = clusterMembers[pick(clusters)]
            if members.count < 3 { continue }
            let x = members[pick(members.count)]
            let y = members[pick(members.count)]
            if x != y { edgePairs.append((x, y)); degree[x] += 1; degree[y] += 1 }
        }

        var bridgeCount = 0
        func addBridge(_ a: Int, _ b: Int) {
            edgePairs.append((a, b)); degree[a] += 1; degree[b] += 1; bridgeCount += 1
        }
        for c in 0..<clusters {
            addBridge(clusterMembers[c][0], clusterMembers[(c + 1) % clusters][0])
        }
        for c in 0..<clusters {
            let other = (c + 2 + pick(max(clusters - 3, 1))) % clusters
            if other != c { addBridge(clusterMembers[c][0], clusterMembers[other][0]) }
        }

        var homes = [SIMD2<Float>](repeating: .zero, count: clusters)
        for c in 0..<clusters {
            var best = SIMD2<Float>(0, 0)
            var bestMinD: Float = -1
            for _ in 0..<8 {
                let aa = frange(0, 2 * .pi)
                let rr = sqrt(f01()) * 0.82
                let cand = SIMD2(cos(aa) * rr, sin(aa) * rr)
                var minD = Float.greatestFiniteMagnitude
                for k in 0..<c { minD = min(minD, simd_length(cand - homes[k])) }
                if c == 0 || minD > bestMinD { bestMinD = minD; best = cand }
            }
            homes[c] = best
        }

        let hero1 = Int(f01() * Float(clusters)) % clusters
        var hero2 = (hero1 + 1) % clusters
        var bestNear = Float.greatestFiniteMagnitude
        for c in 0..<clusters where c != hero1 {
            let d = simd_length(homes[c] - homes[hero1])
            if d < bestNear { bestNear = d; hero2 = c }
        }
        var hero3 = hero1
        var bestFar: Float = -1
        for c in 0..<clusters where c != hero1 && c != hero2 {
            let d = simd_length(homes[c] - homes[hero2])
            if d > bestFar { bestFar = d; hero3 = c }
        }
        let heroGroups = clusters >= 3 ? [hero1, hero2, hero3] : Array(0..<clusters)

        var labelOrder = Array(0..<clusters)
        labelOrder.shuffle(using: &rng)

        var heroOrder = heroGroups
        heroOrder.shuffle(using: &rng)
        var restOrder = (0..<clusters).filter { !heroGroups.contains($0) }
        restOrder.shuffle(using: &rng)
        let formOrder = heroOrder + restOrder
        var clusterForm = [Float](repeating: 0, count: clusters)
        for (slot, c) in formOrder.enumerated() {
            let frac = clusters > 1 ? Float(slot) / Float(clusters - 1) : 0
            clusterForm[c] = 0.12 + frac * 0.26
        }

        var pv = [S2PV](); pv.reserveCapacity(nodeCount)
        for i in 0..<nodeCount {
            let h = homes[nodeCluster[i]]
            let aa = frange(0, 2 * .pi)
            let rr = sqrt(f01()) * 0.50
            pv.append(S2PV(pos: SIMD2(h.x + cos(aa) * rr, h.y + sin(aa) * rr), vel: .zero))
        }

        var statics = [S2NodeStatic](); statics.reserveCapacity(nodeCount)
        for i in 0..<nodeCount {
            let radius = min(2.3 + sqrt(Float(degree[i])) * 1.7, 10.0)
            let spawn = frange(0.0, 0.04)
            statics.append(S2NodeStatic(home: homes[nodeCluster[i]],
                                        radius: radius,
                                        spawn: spawn,
                                        formStart: clusterForm[nodeCluster[i]],
                                        seed: f01(),
                                        group: UInt32(nodeCluster[i])))
        }

        var edges = [S2Edge](); edges.reserveCapacity(edgePairs.count)
        let ecount = edgePairs.count
        let bridgeStart = ecount - bridgeCount
        for (idx, p) in edgePairs.enumerated() {
            let activation: Float
            if idx >= bridgeStart {
                activation = frange(0.58, 0.85)
            } else {
                activation = clusterForm[nodeCluster[p.0]] + frange(0.0, 0.06)
            }
            edges.append(S2Edge(a: UInt32(p.0), b: UInt32(p.1),
                                rest: frange(0.07, 0.11),
                                activation: activation))
        }

        var counts = [Int](repeating: 0, count: nodeCount)
        for e in edges { counts[Int(e.a)] += 1; counts[Int(e.b)] += 1 }

        var offsets = [UInt32](repeating: 0, count: nodeCount + 1)
        for i in 0..<nodeCount { offsets[i + 1] = offsets[i] + UInt32(counts[i]) }

        var cursor = offsets.map { Int($0) }
        var neighbors = [S2Neighbor](repeating: S2Neighbor(node: 0, edge: 0), count: edges.count * 2)
        for (ei, e) in edges.enumerated() {
            let a = Int(e.a), b = Int(e.b)
            neighbors[cursor[a]] = S2Neighbor(node: UInt32(b), edge: UInt32(ei)); cursor[a] += 1
            neighbors[cursor[b]] = S2Neighbor(node: UInt32(a), edge: UInt32(ei)); cursor[b] += 1
        }

        return S2GraphData(pv: pv, statics: statics, edges: edges,
                           neighbors: neighbors, offsets: offsets,
                           groupMembers: clusterMembers, clusterCount: clusters,
                           heroGroups: heroGroups, labelOrder: labelOrder)
    }
}
