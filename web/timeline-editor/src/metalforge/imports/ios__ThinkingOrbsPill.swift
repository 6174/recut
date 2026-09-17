import SwiftUI
import Foundation

struct ThinkingOrbsPill: View {
    @Environment(\.colorScheme) var systemScheme
    var label: String = "Thinking..."
    var showsPill: Bool = true
    var showsLabel: Bool = true
    var speed: Double = 1.0
    var reverse: Bool = false
    var startAt: Double = 0.0
    var dotScale: Double = 1.0
    var dots: Double = 1.0
    var spread: Double = 1.0
    var perspective: Double = 1.0
    var depthSize: Double = 1.0
    var depthFade: Double = 1.0
    var dotOpacity: Double = 1.0
    var spin: Double = 0.0
    var turn: Double = 0.0
    var tilt: Double = 0.0
    var ballSize: CGFloat = 46.0
    var scheme: ColorScheme? = nil
    var dotColor: Color = Color(.sRGB, red: 0.9569, green: 0.9451, blue: 0.9176)
    var accentColor: Color = Color(.sRGB, red: 0.9098, green: 0.5216, blue: 0.2353)
    var pillColor: Color = Color(.sRGB, red: 0.1059, green: 0.1059, blue: 0.1137)
    var labelColor: Color = Color(.sRGB, red: 0.9569, green: 0.9451, blue: 0.9176)
    var dotColorLight: Color = Color(.sRGB, red: 0.1451, green: 0.1412, blue: 0.1647)
    var pillColorLight: Color = Color(.sRGB, red: 0.9255, green: 0.9255, blue: 0.9373)
    var labelColorLight: Color = Color(.sRGB, red: 0.1451, green: 0.1412, blue: 0.1647)

    private var isDark: Bool { (scheme ?? systemScheme) == .dark }
    private var dotInk: Color { isDark ? dotColor : dotColorLight }
    private var chipInk: Color { isDark ? pillColor : pillColorLight }
    private var labelInk: Color { isDark ? labelColor : labelColorLight }

    var body: some View {
        HStack(spacing: 9.0) {
            ThinkingOrbsBall(
                style: 0,
                period: 3.6,
                speed: speed,
                reverse: reverse,
                startAt: startAt,
                animated: true,
                dotScale: dotScale,
                dots: dots,
                spread: spread,
                perspective: perspective,
                depthSize: depthSize,
                depthFade: depthFade,
                dotOpacity: dotOpacity,
                spin: spin,
                turn: turn,
                tilt: tilt,
                dot: dotInk,
                accent: accentColor)
                .frame(width: ballSize, height: ballSize)
            if showsPill && showsLabel {
                Text(label)
                    .font(.system(size: 14.0, design: .monospaced))
                    .foregroundStyle(labelInk.opacity(0.74))
                    .fixedSize()
            }
        }
        .padding(showsPill ? (showsLabel ? EdgeInsets(top: 7.0, leading: 8.0, bottom: 7.0, trailing: 22.0) : EdgeInsets(top: 7.0, leading: 7.0, bottom: 7.0, trailing: 7.0)) : EdgeInsets())
        .background(Capsule().fill(showsPill ? chipInk : .clear))
    }
}

private struct ThinkingOrbsBall: View {
    let style: Int
    let period: Double
    let speed: Double
    let reverse: Bool
    let startAt: Double
    let animated: Bool
    let dotScale: Double
    let dots: Double
    let spread: Double
    let perspective: Double
    let depthSize: Double
    let depthFade: Double
    let dotOpacity: Double
    let spin: Double
    let turn: Double
    let tilt: Double
    let dot: Color
    let accent: Color

    var body: some View {
        if animated {
            TimelineView(.animation) { timeline in
                canvas(at: timeline.date.timeIntervalSinceReferenceDate)
            }
        } else {
            canvas(at: 0)
        }
    }

    private func canvas(at seconds: Double) -> some View {
        Canvas { context, size in
            let box = min(size.width, size.height)
            let ox = (size.width - box) / 2
            let oy = (size.height - box) / 2
            let phase = orbPhase(period: period, speed: speed, reverse: reverse, startAt: startAt, seconds: seconds)
            let dots = orbSheetDots(
                style: style,
                phase: phase,
                size: box,
                dotScale: orbSizeDotScale(box) * dotScale,
                knobs: OrbKnobs(n: dots, sp: spread, pv: perspective, dz: depthSize, df: depthFade, yw: turn * orbDegree, pc: tilt * orbDegree, sn: spin, op: dotOpacity))
            for d in dots {
                let rect = CGRect(
                    x: ox + d.x - d.r,
                    y: oy + d.y - d.r,
                    width: d.r * 2,
                    height: d.r * 2)
                context.fill(Path(ellipseIn: rect), with: .color((d.accent ? accent : dot).opacity(d.a)))
            }
        }
    }
}

private let orbDegree: Double = Double.pi / 180

private func orbPhase(period: Double, speed: Double, reverse: Bool, startAt: Double, seconds: Double) -> Double {
    let p = period / orbMax(0.0001, speed)
    var u = orbMod(seconds, p) / p
    if u < 0 { u += 1 }
    if reverse { u = 1 - u }
    u = orbMod(u + startAt, 1)
    return u < 0 ? u + 1 : u
}

#Preview {
    ThinkingOrbsPill()
}

private struct OrbVec {
    let a: [Double]
    init(_ a: [Double]) { self.a = a }
    subscript(_ i: Double) -> Double {
        guard i >= 0, i < Double(a.count) else { return Double.nan }
        return a[Int(i)]
    }
    var jsLength: Double { Double(a.count) }
    func concat(_ other: OrbVec) -> OrbVec { OrbVec(a + other.a) }
}

extension Array where Element == OrbVec {
    fileprivate subscript(_ i: Double) -> OrbVec {
        guard i >= 0, i < Double(count) else { return OrbVec([]) }
        return self[Int(i)]
    }
    fileprivate var jsLength: Double { Double(count) }
}

private struct OrbKnobs {
    var n: Double = 1
    var sp: Double = 1
    var pv: Double = 1
    var dz: Double = 1
    var df: Double = 1
    var yw: Double = 0
    var pc: Double = 0
    var sn: Double = 0
    var op: Double = 1
    static let identity = OrbKnobs()
    var fitKey: String { "(n)/(sp)/(pv)/(dz)/(df)/(yw)/(pc)/(sn)" }
}

private final class OrbSink {
    let ds: Double
    let dot: Double
    let acc: Double
    let n: Double
    let sp: Double
    let pv: Double
    let dz: Double
    let df: Double
    let yw: Double
    let pc: Double
    let sn: Double
    var t: Double
    private let sink: (Double, Double, Double, Double, Double) -> Void
    init(ds: Double, dot: Double, acc: Double, knobs Q: OrbKnobs, t: Double, _ sink: @escaping (Double, Double, Double, Double, Double) -> Void) {
        self.ds = ds
        self.dot = dot
        self.acc = acc
        self.n = Q.n
        self.sp = Q.sp
        self.pv = Q.pv
        self.dz = Q.dz
        self.df = Q.df
        self.yw = Q.yw
        self.pc = Q.pc
        self.sn = Q.sn
        self.t = t
        self.sink = sink
    }
    func d(_ c: Double, _ x: Double, _ y: Double, _ r: Double, _ a: Double, _ col: Double) {
        sink(x, y, r, a, col)
    }
}

private func orbSin(_ x: Double) -> Double { sin(x) }
private func orbCos(_ x: Double) -> Double { cos(x) }
private func orbExp(_ x: Double) -> Double { exp(x) }
private func orbPow(_ x: Double, _ y: Double) -> Double { pow(x, y) }
private func orbAcos(_ x: Double) -> Double { acos(x) }
private func orbAtan2(_ y: Double, _ x: Double) -> Double { atan2(y, x) }
private func orbSqrt(_ x: Double) -> Double { x.squareRoot() }
private func orbAbs(_ x: Double) -> Double { abs(x) }
private func orbFloor(_ x: Double) -> Double { floor(x) }

private func orbRound(_ x: Double) -> Double {
    if x.isNaN || x.isInfinite || x == 0 { return x }
    if x > 0 && x < 0.5 { return 0 }
    if x < 0 && x >= -0.5 { return -0.0 }
    let f = floor(x)
    return x - f >= 0.5 ? f + 1 : f
}

private func orbMax(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    return a > b ? a : b
}

private func orbMax(_ a: Double, _ b: Double, _ c: Double) -> Double { orbMax(orbMax(a, b), c) }

private func orbMin(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    return a < b ? a : b
}

private func orbMod(_ a: Double, _ b: Double) -> Double { a.truncatingRemainder(dividingBy: b) }

private func orbTruthy(_ x: Double) -> Bool { x != 0 && !x.isNaN }

private func orbOr(_ a: Double, _ b: Double) -> Double { orbTruthy(a) ? a : b }

private func orbHypot(_ x: Double, _ y: Double, _ z: Double) -> Double {
    let v = [x, y, z]
    var oneArgIsNaN = false
    var m: Double = 0
    for value in v {
        if value.isNaN { oneArgIsNaN = true; continue }
        let a = abs(value)
        if a > m { m = a }
    }
    if m == Double.infinity { return .infinity }
    if oneArgIsNaN { return .nan }
    if m == 0 { return 0 }
    var sum: Double = 0
    var compensation: Double = 0
    for value in v {
        let n = abs(value) / m
        let summand = n * n - compensation
        let preliminary = sum + summand
        compensation = (preliminary - sum) - summand
        sum = preliminary
    }
    return sum.squareRoot() * m
}

private func orbSortByIndex(_ arr: [OrbVec], _ key: Double) -> [OrbVec] {
    return arr.enumerated()
        .sorted { l, r in
            let a = l.element[key]
            let b = r.element[key]
            if a < b { return true }
            if b < a { return false }
            return l.offset < r.offset
        }
        .map { $0.element }
}

private enum OrbSpecs13 {
    static let TAU: Double = Double.pi * 2

    static func NC(_ c: Double, _ n: Double) -> Double {
        let v: Double = orbRound(c * n)
        return v < 1 ? 1 : v
    }

    static func VIEW(_ p: OrbVec, _ K: OrbSink) -> OrbVec {
        let ay: Double = K.yw + (((Double.pi * 2) * K.sn) * K.t)
        let ca: Double = orbCos(ay)
        let sa: Double = orbSin(ay)
        let X: Double = (p[0] * ca) - (p[2] * sa)
        var Z: Double = (p[0] * sa) + (p[2] * ca)
        let cb: Double = orbCos(K.pc)
        let sb: Double = orbSin(K.pc)
        let Y: Double = (p[1] * cb) - (Z * sb)
        Z = (p[1] * sb) + (Z * cb)
        return OrbVec([X, Y, Z, p[3], p[4], p[5]])
    }

    static func cl(_ u: Double) -> Double {
        return u < 0 ? 0 : (u > 1 ? 1 : u)
    }

    static func rot(_ p: OrbVec, _ ay: Double, _ ax: Double) -> OrbVec {
        let ca: Double = orbCos(ay)
        let sa: Double = orbSin(ay)
        let X: Double = (p[0] * ca) - (p[2] * sa)
        var Z: Double = (p[0] * sa) + (p[2] * ca)
        let cb: Double = orbCos(ax)
        let sb: Double = orbSin(ax)
        let Y: Double = (p[1] * cb) - (Z * sb)
        Z = (p[1] * sb) + (Z * cb)
        return OrbVec([X, Y, Z, p[3], p[4], p[5]])
    }

    static func P3(_ pts: [OrbVec], _ c: Double, _ S2: Double, _ K: OrbSink, _ RF: Double) {
        let cx: Double = S2 / 2
        let cy: Double = S2 / 2
        let R: Double = (S2 * (orbOr(RF, 0.3))) * K.sp
        let f: Double = 3.5 * K.pv
        var out: [OrbVec] = []
        for p0 in pts {
            let p: OrbVec = VIEW(p0, K)
            let z: Double = p[2]
            let per: Double = f / (f - z)
            let d: Double = cl((z + 1.1) / 2.2)
            out.append(OrbVec([cx + ((p[0] * R) * per), cy + ((p[1] * R) * per), ((K.ds * (0.4 + ((1.6 * K.dz) * d))) * per) * (p[3].isNaN ? 1 : p[3]), (0.07 + (0.93 * orbPow(d, 1.55 * K.df))) * (p[4].isNaN ? 1 : p[4]), orbOr(p[5], K.dot), z]))
        }
        out = orbSortByIndex(out, 5)
        for o in out {
            K.d(c, o[0], o[1], o[2], o[3], o[4])
        }
    }

    static func fib(_ i: Double, _ N: Double) -> OrbVec {
        let y: Double = 1 - ((i / (N - 1)) * 2)
        let r: Double = orbSqrt(orbMax(0, 1 - (y * y)))
        let th: Double = i * 2.399963
        return OrbVec([orbCos(th) * r, y, orbSin(th) * r])
    }

    static func draw0(_ c: Double, _ t: Double, _ S2: Double, _ K: OrbSink) {
        var pts: [OrbVec] = []
        do {
            var i: Double = 0
            while i < NC(150, K.n) {
                defer { i += 1 }
                let p: OrbVec = fib(i, NC(150, K.n))
                let m: Double = 1 + (0.13 * orbSin(TAU * (t - (0.22 * (p[1] + 1)))))
                pts.append(rot(OrbVec([p[0] * m, p[1] * m, p[2] * m, 0.85, 0.9]), TAU * t, 0.36))
            }
        }
        P3(pts, c, S2, K, 0.3)
    }
}

private func orbDraw(_ style: Int, _ c: Double, _ t: Double, _ S: Double, _ K: OrbSink) {
    switch style {
    case 0: OrbSpecs13.draw0(c, t, S, K)
    default: break
    }
}

private struct OrbDot {
    let x: Double
    let y: Double
    let r: Double
    let a: Double
    let accent: Bool
}

private let orbDotInk: Double = 1
private let orbAccentInk: Double = 2
private let orbProbeInk: Double = 3

private final class OrbFitCache: @unchecked Sendable {
    static let shared = OrbFitCache()
    private var map: [String: Double] = [:]
    private let lock = NSLock()

    func fit(_ style: Int, _ size: Double, _ Q: OrbKnobs) -> Double {
        let key = "\(style)@\(size)@\(Q.fitKey)"
        lock.lock()
        if let hit = map[key] {
            lock.unlock()
            return hit
        }
        lock.unlock()
        let f = orbFit(style, size, Q)
        lock.lock()
        map[key] = f
        lock.unlock()
        return f
    }
}

private func orbFit(_ style: Int, _ S: Double, _ Q: OrbKnobs) -> Double {
    let h = S / 2
    var ext: Double = 0
    let probe = OrbSink(ds: 1, dot: orbProbeInk, acc: orbProbeInk, knobs: Q, t: 0) { x, y, r, a, _ in
        if a <= 0.05 || r <= 0.15 { return }
        ext = orbMax(ext, orbAbs(x - h) + r * 0.5, orbAbs(y - h) + r * 0.5)
    }
    for k in 0 ..< 20 {
        probe.t = Double(k) / 20
        orbDraw(style, 0, Double(k) / 20, S, probe)
    }
    return ext > 1 ? orbMax(0.55, orbMin(1.7, (S * 0.415) / ext)) : 1
}

private func orbSizeDotScale(_ S: Double) -> Double {
    if S <= 46 { return 0.4 }
    if S <= 190 { return 0.4 + ((S - 46) / 144) * 0.6 }
    if S <= 340 { return 1 + ((S - 190) / 150) * 0.55 }
    return 1.55
}

private func orbSheetDots(style: Int, phase: Double, size S: Double, dotScale: Double, knobs Q: OrbKnobs = .identity) -> [OrbDot] {
    var out: [OrbDot] = []
    let f = OrbFitCache.shared.fit(style, S, Q)
    let h = S / 2
    let K = OrbSink(ds: dotScale, dot: orbDotInk, acc: orbAccentInk, knobs: Q, t: phase) { x, y, r, a, col in
        let fx = h + (x - h) * f
        let fy = h + (y - h) * f
        let fr = r * (0.55 + 0.45 * f)
        let fa = a * Q.op
        if fr <= 0.05 || fa <= 0.004 { return }
        out.append(OrbDot(x: fx, y: fy, r: fr, a: orbMin(1, fa), accent: col == orbAccentInk))
    }
    orbDraw(style, 0, phase, S, K)
    return out
}
