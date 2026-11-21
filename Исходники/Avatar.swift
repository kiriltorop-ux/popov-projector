import AppKit
import SpriteKit
import AVFoundation

struct Cue {
    let from: Double
    let to: Double
    let pose: String
}

struct SpeechTrack {
    let cues: [Cue]
    let fps: Double
    let energy: [Double]
    let accent: [Double]

    init(_ data: [String: Any]) throws {
        cues = (data["cues"] as? [[Any]] ?? []).compactMap { item in
            guard item.count == 3, let a = item[0] as? Double, let b = item[1] as? Double,
                  let pose = item[2] as? String, a >= 0, b > a else { return nil }
            return Cue(from:a,to:b,pose:pose)
        }
        fps = data["fps"] as? Double ?? 0
        energy = data["energy"] as? [Double] ?? []
        accent = data["accent"] as? [Double] ?? []
        guard !cues.isEmpty, fps > 0, !energy.isEmpty, energy.count == accent.count
        else { throw CocoaError(.fileReadCorruptFile) }
    }

    func sample(_ curve: [Double], at time: Double) -> Double {
        guard time >= 0, time*fps < Double(curve.count) else { return 0 }
        let frame = time*fps
        let left = Int(frame), right = min(left+1,curve.count-1)
        return curve[left] + (curve[right]-curve[left])*(frame-Double(left))
    }
}

final class Avatar: SKScene {
    let poses = ["rest", "open", "round", "wide", "teeth", "soft", "hush", "reduced", "blink", "brow"]
    var images = [String: SKTexture]()
    let actor = SKNode()
    let base = SKSpriteNode()
    let blend = SKSpriteNode()
    let quietMouth = SKSpriteNode()
    let brows = SKSpriteNode()
    let eyelids = SKSpriteNode()
    let grid = SKShapeNode()
    let marker = SKSpriteNode(color:.white,size:CGSize(width:40,height:40))
    var flashUntil = 0.0
    var liveFace: (() -> (Int,SpeechTrack,Double)?)?
    private var liveIndex: Int?
    var audio: AVAudioPlayer?
    var performance: SpeechTrack?
    var cues: [Cue] { performance?.cues ?? [] }
    var blank = false
    var calibrating = false
    var heightFraction: CGFloat = 0.9
    var shiftX: CGFloat = 0
    var shiftY: CGFloat = 0
    private let columns = 3, rows = 24
    private var lattice = [SIMD2<Float>]()
    private let began = ProcessInfo.processInfo.systemUptime
    private var basePose = "rest", nextPose = "rest"
    private var lastSize = CGSize.zero
    private var cueIndex = 0
    private var lastSpeechTime = -1.0

    init(folder: URL) throws {
        super.init(size: CGSize(width: 960, height: 540))
        scaleMode = .resizeFill
        backgroundColor = .black
        for pose in poses {
            guard let image = NSImage(contentsOf: folder.appendingPathComponent(pose + ".png")) else {
                throw NSError(domain: "Popov", code: 1, userInfo: [NSLocalizedDescriptionKey: "Отсутствует изображение " + pose])
            }
            var layerImage = image
            if pose == "blink" || pose == "brow" {
                let mask = NSImage(size: image.size)
                mask.lockFocus()
                let band = CGRect(x: 0, y: image.size.height*0.87, width: image.size.width, height: image.size.height*0.065)
                image.draw(in: band, from: band, operation: .copy, fraction: 1)
                mask.unlockFocus()
                layerImage = mask
            }
            let texture = SKTexture(image: layerImage)
            texture.filteringMode = .linear
            images[pose] = texture
        }
        for y in 0...rows {
            for x in 0...columns { lattice.append(SIMD2(Float(x)/Float(columns), Float(y)/Float(rows))) }
        }
        addChild(actor)
        for layer in [base, blend, quietMouth, brows, eyelids] {
            layer.anchorPoint = .zero
            actor.addChild(layer)
        }
        base.zPosition = 0; blend.zPosition = 1; quietMouth.zPosition = 2; brows.zPosition = 3; eyelids.zPosition = 4
        quietMouth.texture = images["rest"]; brows.texture = images["brow"]
        brows.alpha = 0
        base.texture = images["rest"]; blend.texture = images["rest"]
        eyelids.texture = images["blink"]
        grid.strokeColor = .init(white: 0.8, alpha: 1); grid.lineWidth = 1
        grid.zPosition = 10; addChild(grid)
        marker.zPosition=11; marker.isHidden=true; addChild(marker)
    }
    required init?(coder: NSCoder) { fatalError() }

    func speech(_ player: AVAudioPlayer?, _ track: SpeechTrack? = nil) {
        audio = player; performance = track; cueIndex = 0; lastSpeechTime = -1
    }

    // Blend on both sides of a phoneme boundary using audio time. Even a short
    // bilabial stop gets a fully closed midpoint if the screen samples it.
    private func articulation(at time: Double) -> (String, String, Double) {
        guard cues.indices.contains(cueIndex) else { return ("rest","rest",0) }
        let cue = cues[cueIndex]
        guard time >= cue.from && time < cue.to else { return ("rest","rest",0) }
        for other in [cueIndex-1,cueIndex+1] where cues.indices.contains(other) {
            let neighbor = cues[other]
            guard neighbor.pose != cue.pose else { continue }
            let before = other < cueIndex
            let join = before ? cue.from : cue.to
            let gap = before ? cue.from-neighbor.to : neighbor.from-cue.to
            guard abs(gap) < 0.001 else { continue }
            let radius = min(0.032, 0.42*(cue.to-cue.from), 0.42*(neighbor.to-neighbor.from))
            let d = time - join
            if radius > 0 && abs(d) < radius {
                let w = (d/radius+1)*0.5
                return (before ? neighbor.pose : cue.pose, before ? cue.pose : neighbor.pose, w*w*(3-2*w))
            }
        }
        return (cue.pose,cue.pose,0)
    }

    private func makeGrid() {
        let p = CGMutablePath()
        let w = size.width, h = size.height
        p.addRect(CGRect(x: 2, y: 2, width: max(0,w-4), height: max(0,h-4)))
        for i in 1..<8 {
            let x = w * CGFloat(i)/8
            p.move(to: CGPoint(x:x,y:0)); p.addLine(to:CGPoint(x:x,y:h))
        }
        for i in 1..<6 {
            let y = h * CGFloat(i)/6
            p.move(to:CGPoint(x:0,y:y)); p.addLine(to:CGPoint(x:w,y:y))
        }
        p.addEllipse(in: CGRect(x:(w-h/3)/2,y:h/3,width:h/3,height:h/3))
        grid.path = p
    }

    override func update(_ currentTime: TimeInterval) {
        let elapsed = ProcessInfo.processInfo.systemUptime - began
        if let live = liveFace {
            if let (index,track,time) = live() {
                if liveIndex != index || performance == nil { speech(nil,track); liveIndex = index }
                renderPose(elapsed:elapsed,speechTime:time)
            } else {
                if liveIndex != nil { speech(nil); liveIndex = nil }
                renderPose(elapsed:elapsed,speechTime:-1)
            }
        } else { renderPose(elapsed:elapsed,speechTime:audio?.currentTime ?? -1) }
    }

    func renderPose(elapsed t: Double, speechTime secs: Double) {
        marker.position = CGPoint(x:42,y:size.height-42)
        marker.isHidden = blank || ProcessInfo.processInfo.systemUptime >= flashUntil
        actor.isHidden = blank
        grid.isHidden = blank || !calibrating
        guard !blank else { return }
        if size != lastSize { makeGrid(); lastSize = size }
        let h = size.height * heightFraction, w = h * 640/1440
        actor.position = CGPoint(x:(size.width-w)/2 + shiftX*size.width, y:(size.height-h)/2 + shiftY*size.height)
        if secs < lastSpeechTime { cueIndex = 0 }
        lastSpeechTime = secs
        while cueIndex < cues.count && cues[cueIndex].to <= secs { cueIndex += 1 }
        let mouth = articulation(at: secs)
        if mouth.0 != basePose { basePose = mouth.0; base.texture = images[basePose] }
        if mouth.1 != nextPose { nextPose = mouth.1; blend.texture = images[nextPose] }
        blend.alpha = CGFloat(mouth.2)
        let energy = performance.map { $0.sample($0.energy, at:secs) } ?? 0
        let accent = performance.map { $0.sample($0.accent, at:secs) } ?? 0
        let aperture = min(1, energy * (0.88 + 0.18*accent))
        quietMouth.alpha = CGFloat(1-aperture)
        brows.alpha = CGFloat(accent * min(1,2*energy))
        let body = (1.1*sin(t*0.91) + 0.6*sin(t*0.53+0.4))*Double.pi/180
        let head = (1.35*sin(t*1.37+0.5) + (secs >= 0 ? 0.8*sin(secs*2.6) + 0.45*accent : 0))*Double.pi/180
        var dest = lattice
        for i in lattice.indices {
            let x = Double(lattice[i].x), y = Double(lattice[i].y)
            let upper = max(0,(y-0.24)/0.76)
            let neck = max(0,min(1,(y-0.78)/0.13))
            let dx = sin(body)*upper*upper*2.25 + sin(head)*max(0,y-0.80)*2.25
            let dy = -(x-0.5)*(sin(body)*upper + sin(head)*neck)/2.25
            dest[i] = SIMD2(Float(x+dx), Float(y+dy))
        }
        let warp = SKWarpGeometryGrid(columns:columns, rows:rows, sourcePositions:lattice,destinationPositions:dest)
        let layerSize = CGSize(width:w,height:h)
        for layer in [base,blend,quietMouth,brows,eyelids] { layer.size = layerSize; layer.warpGeometry = warp }
        let cycle = t.truncatingRemainder(dividingBy: 8.9)
        let distance = min(abs(cycle-2.53), abs(cycle-7.61))
        eyelids.alpha = CGFloat(max(0,1-distance/0.095))
    }
}
