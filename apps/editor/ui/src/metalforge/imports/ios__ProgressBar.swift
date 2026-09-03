import SwiftUI

enum ProgressBarStyle: Int, CaseIterable, Identifiable {
    case hex
    case slosh
    case smoke
    case spring
    case drops
    case bands
    case threads
    case diamond
    case grain
    case liquid

    var id: Int { rawValue }

    var name: String {
        switch self {
        case .hex: return "Hex"
        case .slosh: return "Slosh"
        case .smoke: return "Smoke"
        case .spring: return "Spring"
        case .drops: return "Drops"
        case .bands: return "Bands"
        case .threads: return "Threads"
        case .diamond: return "Diamond"
        case .grain: return "Grain"
        case .liquid: return "Liquid"
        }
    }
}

struct ProgressBarPalette {
    var scale: Double
    var amount: Double
    var lag: Double
    var echo: Double
    var bloom: Double
    var jitter: Double
    var frontIn: Double
    var frontOut: Double
    var pulse: Double
    var pulseRate: Double
    var stagger: Double
    var background: Color
    var color1: Color
    var color2: Color
    var color3: Color
    var color4: Color
    var color5: Color
    var color6: Color
    var color7: Color
    var caption: Color
    var behaviour: String

    static let all: [ProgressBarPalette] = [
        ProgressBarPalette(
            scale: 9.5,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.15,
            frontOut: 0.25,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.0745, green: 0.0627, blue: 0.1255, opacity: 1),
            color1: Color(.sRGB, red: 0.102, green: 0.0588, blue: 0.2784, opacity: 1),
            color2: Color(.sRGB, red: 0.298, green: 0.2, blue: 0.6, opacity: 1),
            color3: Color(.sRGB, red: 0.6588, green: 0.549, blue: 1.0, opacity: 1),
            color4: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.5804, green: 0.502, blue: 0.549, opacity: 1),
            behaviour: "seismic"
        ),
        ProgressBarPalette(
            scale: 9.5,
            amount: 0.135,
            lag: 1.4,
            echo: 0.082,
            bloom: 0.95,
            jitter: 0.3,
            frontIn: -0.12,
            frontOut: 0.12,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.0627, green: 0.0745, blue: 0.1059, opacity: 1),
            color1: Color(.sRGB, red: 0.0157, green: 0.0314, blue: 0.098, opacity: 1),
            color2: Color(.sRGB, red: 0.0235, green: 0.0863, blue: 0.2706, opacity: 1),
            color3: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color4: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.4902, green: 0.5294, blue: 0.5922, opacity: 1),
            behaviour: "sweep"
        ),
        ProgressBarPalette(
            scale: 1.3,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.35,
            frontOut: 0.55,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.0745, green: 0.0627, blue: 0.098, opacity: 1),
            color1: Color(.sRGB, red: 0.102, green: 0.0706, blue: 0.1608, opacity: 1),
            color2: Color(.sRGB, red: 0.4196, green: 0.2196, blue: 0.7216, opacity: 1),
            color3: Color(.sRGB, red: 0.8784, green: 0.7804, blue: 1.0, opacity: 1),
            color4: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.5176, green: 0.5529, blue: 0.4863, opacity: 1),
            behaviour: "breath"
        ),
        ProgressBarPalette(
            scale: 9.5,
            amount: 0.105,
            lag: 0.42,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.12,
            frontOut: 0.12,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.0941, green: 0.0745, blue: 0.0667, opacity: 1),
            color1: Color(.sRGB, red: 0.098, green: 0.0235, blue: 0.0078, opacity: 1),
            color2: Color(.sRGB, red: 0.251, green: 0.0706, blue: 0.0157, opacity: 1),
            color3: Color(.sRGB, red: 0.6784, green: 0.2, blue: 0.0314, opacity: 1),
            color4: Color(.sRGB, red: 1.0, green: 0.4784, blue: 0.1412, opacity: 1),
            color5: Color(.sRGB, red: 1.0, green: 0.8392, blue: 0.6196, opacity: 1),
            color6: Color(.sRGB, red: 0.6784, green: 0.2, blue: 0.0314, opacity: 1),
            color7: Color(.sRGB, red: 1.0, green: 0.4784, blue: 0.1412, opacity: 1),
            caption: Color(.sRGB, red: 0.5608, green: 0.5059, blue: 0.4784, opacity: 1),
            behaviour: "spring"
        ),
        ProgressBarPalette(
            scale: 110.0,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.3,
            frontOut: 0.3,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.0706, green: 0.0863, blue: 0.0588, opacity: 1),
            color1: Color(.sRGB, red: 0.0549, green: 0.1412, blue: 0.0196, opacity: 1),
            color2: Color(.sRGB, red: 0.1804, green: 0.5216, blue: 0.0588, opacity: 1),
            color3: Color(.sRGB, red: 0.698, green: 1.0, blue: 0.349, opacity: 1),
            color4: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.5176, green: 0.498, blue: 0.5804, opacity: 1),
            behaviour: "jitter"
        ),
        ProgressBarPalette(
            scale: 9.0,
            amount: 0.072,
            lag: 0.5,
            echo: 0.048,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.12,
            frontOut: 0.12,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.1059, green: 0.1098, blue: 0.1176, opacity: 1),
            color1: Color(.sRGB, red: 0.0431, green: 0.0549, blue: 0.0863, opacity: 1),
            color2: Color(.sRGB, red: 0.1098, green: 0.149, blue: 0.2392, opacity: 1),
            color3: Color(.sRGB, red: 0.3216, green: 0.4196, blue: 0.6196, opacity: 1),
            color4: Color(.sRGB, red: 0.7216, green: 0.851, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.9608, green: 0.9882, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.3216, green: 0.4196, blue: 0.6196, opacity: 1),
            color7: Color(.sRGB, red: 0.7216, green: 0.851, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.5451, green: 0.5647, blue: 0.6, opacity: 1),
            behaviour: "metro"
        ),
        ProgressBarPalette(
            scale: 64.0,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.1,
            frontOut: 0.3,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.32,
            background: Color(.sRGB, red: 0.0902, green: 0.0588, blue: 0.0784, opacity: 1),
            color1: Color(.sRGB, red: 0.1608, green: 0.0314, blue: 0.0902, opacity: 1),
            color2: Color(.sRGB, red: 1.0, green: 0.3686, blue: 0.6902, opacity: 1),
            color3: Color(.sRGB, red: 1.0, green: 0.851, blue: 0.949, opacity: 1),
            color4: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.5608, green: 0.502, blue: 0.5137, opacity: 1),
            behaviour: "attract"
        ),
        ProgressBarPalette(
            scale: 7.5,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.18,
            frontOut: 0.3,
            pulse: 0.25,
            pulseRate: 2.8,
            stagger: 0.16,
            background: Color(.sRGB, red: 0.0941, green: 0.0627, blue: 0.0706, opacity: 1),
            color1: Color(.sRGB, red: 0.0745, green: 0.0431, blue: 0.0549, opacity: 1),
            color2: Color(.sRGB, red: 0.7216, green: 0.2, blue: 0.3294, opacity: 1),
            color3: Color(.sRGB, red: 1.0, green: 0.5608, blue: 0.4314, opacity: 1),
            color4: Color(.sRGB, red: 1.0, green: 0.8, blue: 0.7216, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.4863, green: 0.5529, blue: 0.5216, opacity: 1),
            behaviour: "hop"
        ),
        ProgressBarPalette(
            scale: 150.0,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.3,
            frontOut: 0.4,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.0784, green: 0.0667, blue: 0.0941, opacity: 1),
            color1: Color(.sRGB, red: 0.298, green: 0.1412, blue: 0.549, opacity: 1),
            color2: Color(.sRGB, red: 0.698, green: 0.502, blue: 1.0, opacity: 1),
            color3: Color(.sRGB, red: 0.9216, green: 0.851, blue: 1.0, opacity: 1),
            color4: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            color5: Color(.sRGB, red: 0.7804, green: 0.902, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0588, green: 0.2392, blue: 0.698, opacity: 1),
            color7: Color(.sRGB, red: 0.2784, green: 0.5804, blue: 1.0, opacity: 1),
            caption: Color(.sRGB, red: 0.5412, green: 0.549, blue: 0.5725, opacity: 1),
            behaviour: "steps"
        ),
        ProgressBarPalette(
            scale: 9.5,
            amount: 0.085,
            lag: 0.55,
            echo: 0.055,
            bloom: 1.0,
            jitter: 0.3,
            frontIn: -0.12,
            frontOut: 0.12,
            pulse: 0.28,
            pulseRate: 3.0,
            stagger: 0.18,
            background: Color(.sRGB, red: 0.1294, green: 0.1294, blue: 0.1412, opacity: 1),
            color1: Color(.sRGB, red: 0.0353, green: 0.0431, blue: 0.0863, opacity: 1),
            color2: Color(.sRGB, red: 0.0431, green: 0.098, blue: 0.2902, opacity: 1),
            color3: Color(.sRGB, red: 0.0549, green: 0.3098, blue: 0.7804, opacity: 1),
            color4: Color(.sRGB, red: 0.2588, green: 0.7216, blue: 0.9804, opacity: 1),
            color5: Color(.sRGB, red: 0.6392, green: 0.9294, blue: 1.0, opacity: 1),
            color6: Color(.sRGB, red: 0.0745, green: 0.3294, blue: 0.7608, opacity: 1),
            color7: Color(.sRGB, red: 0.2, green: 0.5608, blue: 0.8784, opacity: 1),
            caption: Color(.sRGB, red: 0.5176, green: 0.5255, blue: 0.549, opacity: 1),
            behaviour: "liquid"
        ),
    ]

    static func of(_ style: ProgressBarStyle) -> ProgressBarPalette {
        all[max(0, min(style.rawValue, all.count - 1))]
    }
}

struct ProgressBarColors {
    var track: Color? = nil
    var deep: Color? = nil
    var mid: Color? = nil
    var glow: Color? = nil
    var bright: Color? = nil
    var core: Color? = nil
    var trail: Color? = nil
    var trailHot: Color? = nil

    func applied(to pal: ProgressBarPalette) -> ProgressBarPalette {
        var p = pal
        if let v = track { p.background = v }
        if let v = deep { p.color1 = v }
        if let v = mid { p.color2 = v }
        if let v = glow { p.color3 = v }
        if let v = bright { p.color4 = v }
        if let v = core { p.color5 = v }
        if let v = trail { p.color6 = v }
        if let v = trailHot { p.color7 = v }
        return p
    }
}

private func jsSign(_ x: Double) -> Double {
    return x > 0 ? 1 : (x < 0 ? -1 : 0)
}

private func jsRound(_ x: Double) -> Double {
    return x.rounded(.toNearestOrAwayFromZero)
}

final class ProgressSim {
    var p: Double = 0
    var activity: Double = 0
    var wt: Double = 0
    var target: Double = 0
    var from: Double = 0
    var u: Double = 0
    var vel: Double = 0
    var rate: Double = 0.08
    var wait: Double = 0.5
    var burst: Double = 0
    var clock: Double = 0
    var shocks: Double = 0
    var mode: String = "pause"
    var frames: Int = 0
    var seed: UInt32 = 0
    let index: Int

    init(index: Int) {
        self.index = index
        reset()
    }

    func reset() {
        p = 0
        activity = 0
        wt = 0
        target = 0
        from = 0
        u = 0
        vel = 0
        rate = 0.08
        wait = 0.5
        burst = 0
        clock = 0
        shocks = 0
        mode = "pause"
        frames = 0
        wt = Double((index &* 2654435761) % 600) / 10
        seed = UInt32(truncatingIfNeeded: index &* 2246822519 &+ 374761393)
    }

    func rand() -> Double {
        seed = seed &* 1664525 &+ 1013904223
        return Double(seed) / 4294967296.0
    }

    func rnd(_ a: Double, _ b: Double) -> Double {
        return a + rand() * (b - a)
    }

    func b_seismic(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        wait -= dt * sp;
        if (wait <= 0) {
          if (p >= 0.999) { mode = "reset"; return true; }
          p = min(1, p + 0.075);
          shocks += 1;
          burst = 0.45;
          if (shocks >= 3) { shocks = 0; wait = 2.4; } else { wait = 0.20; }
        }
        burst = max(0, burst - dt);
        return burst > 0;
    }

    func b_sweep(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        if (mode != "move") {
          wait -= dt * sp;
          if (wait <= 0) {
            if (p >= 0.999) { mode = "reset"; return true; }
            from = p; target = min(1, p + 0.25); u = 0; mode = "move";
          }
          return false;
        }
        u = min(1, u + dt * sp / 2.6);
        let e = 0.5 - 0.5 * cos(Double.pi * u);
        p = from + (target - from) * e;
        if (u >= 1) { mode = "pause"; wait = 0.9; return false; }
        return true;
    }

    func b_breath(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        if (p >= 0.999) {
          wait -= dt * sp;
          if (wait <= 0) { mode = "reset"; }
          return false;
        }
        if (mode == "rest") {
          wait -= dt * sp;
          if (wait <= 0) { mode = "go"; }
          return false;
        }
        p = min(1, p + 0.030 * sp * dt);
        clock -= dt * sp;
        if (clock <= 0) { mode = "rest"; wait = rnd(0.8, 1.4); clock = rnd(2.5, 4.0); }
        if (p >= 0.999) { wait = 1.5; }
        return true;
    }

    func b_spring(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        if (mode != "move") {
          wait -= dt * sp;
          if (wait <= 0) {
            if (p >= 0.995) { mode = "reset"; return true; }
            target = min(1, p + 0.22); vel = 0; mode = "move";
          }
          return false;
        }
        vel += ((target - p) * 7.5 - vel * 3.4) * dt * sp;
        p += vel * dt * sp;
        if (abs(vel) < 0.010 && abs(target - p) < 0.004) {
          p = target; vel = 0; mode = "pause"; wait = 1.1;
          return false;
        }
        return true;
    }

    func b_jitter(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        wait -= dt * sp;
        if (wait <= 0) {
          if (p >= 0.999) { mode = "reset"; return true; }
          target = min(1, p + rnd(0.01, 0.035));
          wait = rnd(0.08, 0.22);
          burst = 0.3;
        }
        let gap = target - p;
        p += gap * min(1, 6.5 * sp * dt);
        burst = max(0, burst - dt);
        return burst > 0;
    }

    func b_metro(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        wait -= dt * sp;
        if (wait <= 0) {
          if (p >= 0.999) { mode = "reset"; return true; }
          target = min(1, jsRound(p * 10 + 1) / 10);
          wait = 1.35;
        }
        let gap = target - p;
        p += gap * min(1, 3.4 * sp * dt);
        return abs(gap) > 0.002;
    }

    func b_attract(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        if (mode != "move") {
          wait -= dt * sp;
          if (wait <= 0) {
            if (p >= 0.995) { mode = "reset"; return true; }
            target = min(1, p + 0.22); mode = "move";
          }
          return false;
        }
        let gap = target - p;
        p += gap * min(1, (0.55 + 5.5 * abs(gap)) * sp * dt);
        if (abs(gap) < 0.0025) { p = target; mode = "pause"; wait = 0.6; return false; }
        return true;
    }

    func b_hop(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "reset") { return bDrain(dt, sp); }
        wait -= dt * sp;
        if (wait <= 0) {
          if (p >= 0.999) { mode = "reset"; return true; }
          target = min(1, target + 0.08);
          wait = 0.42;
        }
        let gap = target - p;
        p += gap * min(1, 5.0 * sp * dt);
        return abs(gap) > 0.002;
    }

    func b_steps(_ dt: Double, _ sp: Double) -> Bool {
        if (mode == "pause") {
          wait -= dt * sp;
          if (wait <= 0) {
            if (p >= 0.999) { mode = "reset"; }
            else { target = min(1, p + rnd(0.17, 0.23)); mode = "move"; }
          }
          return false;
        }
        if (mode == "reset") {
          p -= 1.0 * sp * dt;
          if (p <= 0) { p = 0; target = 0; mode = "pause"; wait = 0.8; }
          return true;
        }
        let gap = target - p;
        p += gap * min(1, 1.7 * sp * dt);
        if (abs(gap) < 0.004) {
          p = target; mode = "pause";
          wait = p >= 0.999 ? 1.9 : rnd(0.9, 1.5);
          return false;
        }
        return true;
    }

    func bDrain(_ dt: Double, _ sp: Double) -> Bool {
        p -= 1.0 * sp * dt;
        if (p <= 0) { p = 0; target = 0; vel = 0; mode = "pause"; wait = 0.8; }
        return true;
    }

    func b_liquid(_ dt: Double, _ sp: Double) -> Bool {
        var moved = false;
        if (mode == "pause") {
          wait -= dt * sp;
          if (wait <= 0) {
            if (p >= 0.999) { target = 0; rate = 1.2; }
            else { target = min(1, p + rnd(0.06, 0.22)); rate = rnd(0.05, 0.16); }
            mode = "move";
          }
        }
        if (mode == "move") {
          let dir = jsSign(target - p);
          p += dir * rate * sp * dt;
          moved = true;
          if ((dir >= 0 && p >= target) || (dir < 0 && p <= target)) {
            p = target; mode = "pause";
            wait = p >= 0.999 ? 1.8 : (p <= 0.001 ? 0.6 : rnd(0.7, 2.0));
          }
        }
        return moved;
    }

    func stepBeh(_ dt: Double, _ sp: Double, _ beh: String) -> Bool {
        switch beh {
        case "seismic": return b_seismic(dt, sp)
        case "sweep": return b_sweep(dt, sp)
        case "breath": return b_breath(dt, sp)
        case "spring": return b_spring(dt, sp)
        case "jitter": return b_jitter(dt, sp)
        case "metro": return b_metro(dt, sp)
        case "attract": return b_attract(dt, sp)
        case "hop": return b_hop(dt, sp)
        case "steps": return b_steps(dt, sp)
        case "liquid": return b_liquid(dt, sp)
        default: return b_steps(dt, sp)
        }
    }

    func step(_ dt: Double, _ sp: Double, _ beh: String, _ manual: Double) {
        let up = beh == "liquid" ? 3.0 : 1.8
        let dn = beh == "liquid" ? 0.75 : 0.7
        let wB = beh == "liquid" ? 0.35 : 0.45
        let wG = beh == "liquid" ? 1.35 : 0.85
        var moving = false
        if manual >= 0 {
            let gap = min(max(manual, 0), 1) - p
            if abs(gap) > 0.002 { p += jsSign(gap) * min(abs(gap), 0.5 * sp * dt); moving = true }
        } else {
            moving = stepBeh(dt, sp, beh)
        }
        p = max(0, min(1, p))
        activity += ((moving ? 1 : 0) - activity) * (1 - exp(-(moving ? up : dn) * dt))
        wt += dt * (wB + activity * wG)
        frames += 1
    }

    func run(to t: Double, speed sp: Double, behaviour beh: String, manual: Double) {
        let want = max(0, Int((t / ProgressSim.step).rounded(.down)))
        if want < frames { reset() }
        var steps = want - frames
        if steps > 600 {
            frames = want - 600
            steps = 600
        }
        for _ in 0..<steps { step(ProgressSim.step, sp, beh, manual) }
    }

    var percent: Int { Int((min(max(p, 0), 1) * 100).rounded()) }

    static let step: Double = 1.0 / 60.0
}

private let progressSpeed: Double = 1.0

struct ProgressBar: View {
    var progress: Double = -1
    var style: ProgressBarStyle = .hex
    var title: String = "SYNCING LIBRARY"
    var subtitle: String = "PREPARING YOUR FILES"
    var showsContent: Bool = true
    var colors = ProgressBarColors()

    @State private var start: Date = .now
    @State private var sims: [ProgressSim] = (0..<10).map { ProgressSim(index: $0) }

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation) { ctx in
                let pal = colors.applied(to: ProgressBarPalette.of(style))
                let sim = sims[style.rawValue]
                let t = ctx.date.timeIntervalSince(start)
                let _ = sim.run(to: t, speed: progressSpeed, behaviour: pal.behaviour, manual: progress)
                ZStack {
                    ProgressBarView(
                        time: t,
                        fill: sim.p,
                        alive: sim.activity,
                        warp: sim.wt,
                        style: Double(style.rawValue),
                        colors: colors
                    )
                    if showsContent {
                        ProgressBarContent(
                            title: title,
                            subtitle: subtitle,
                            percent: sim.percent,
                            caption: pal.caption
                        )
                    }
                }
            }
            .clipShape(
                RoundedRectangle(cornerRadius: 0.144 * geo.size.height, style: .continuous)
            )
        }
        .aspectRatio(3.6, contentMode: .fit)
    }
}

struct ProgressBarView: View {
    var time: Double
    var fill: Double
    var alive: Double
    var warp: Double
    var style: Double
    var colors = ProgressBarColors()

    private var pal: ProgressBarPalette {
        colors.applied(
            to: ProgressBarPalette.all[max(0, min(Int(style), ProgressBarPalette.all.count - 1))]
        )
    }

    var body: some View {
        Color.black
            .colorEffect(
                ShaderLibrary.progressBar(
                    .boundingRect,
                    .float(Float(time)),
                    .float(Float(style)),
                    .float(Float(fill * 100)),
                    .float(Float(alive)),
                    .float(Float(warp)),
                    .float(Float(pal.scale)),
                    .float(Float(pal.amount)),
                    .float(Float(pal.lag)),
                    .float(Float(pal.echo)),
                    .float(Float(pal.bloom)),
                    .float(Float(pal.jitter)),
                    .float(0.01),
                    .float(Float(pal.frontIn)),
                    .float(Float(pal.frontOut)),
                    .float(1.0),
                    .float(1.0),
                    .float(1.0),
                    .float(1.0),
                    .float(3.0),
                    .float(1.0),
                    .float(1.0),
                    .float(1.0),
                    .float(Float(pal.pulse)),
                    .float(Float(pal.pulseRate)),
                    .float(Float(pal.stagger)),
                    .float(1.0),
                    .float(1.0),
                    .float(1.0),
                    .float(1.0),
                    .float(1.0),
                    .color(pal.background),
                    .color(pal.color1),
                    .color(pal.color2),
                    .color(pal.color3),
                    .color(pal.color4),
                    .color(pal.color5),
                    .color(pal.color6),
                    .color(pal.color7)
                )
            )
    }
}

private struct ProgressBarContent: View {
    var title: String
    var subtitle: String
    var percent: Int
    var caption: Color

    var body: some View {
        GeometryReader { geo in
            let gs = geo.size.width / 1040
            HStack(alignment: .center, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.system(size: 32.0 * gs, weight: .heavy))
                        .foregroundStyle(Color(.sRGB, red: 1.0, green: 1.0, blue: 1.0, opacity: 1))
                    Text(subtitle)
                        .font(.system(size: 16.0 * gs, weight: .bold))
                        .tracking(2.4 * gs)
                        .foregroundStyle(caption)
                        .padding(.top, 8.0 * gs)
                }
                Spacer(minLength: 0)
                Text("\(percent)%")
                    .font(.system(size: 60.0 * gs, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color(.sRGB, red: 1.0, green: 1.0, blue: 1.0, opacity: 1))
            }
            .padding(.horizontal, 87.36 * gs)
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .allowsHitTesting(false)
    }
}

#Preview {
    ProgressBar()
        .padding(20)
}
