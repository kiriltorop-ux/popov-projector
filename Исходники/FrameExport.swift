import AppKit
import SpriteKit

enum FrameExport {
    static func run(directory: URL) throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let json = try Data(contentsOf: directory.appendingPathComponent("take.json"))
        guard let data = try JSONSerialization.jsonObject(with: json) as? [String: Any],
              let duration = data["seconds"] as? Double else { throw CocoaError(.fileReadCorruptFile) }
        let track = try SpeechTrack(data)
        let resources = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("Ресурсы")
        let minin = data["guide"] as? String == "minin"
        let avatar = try Avatar(folder:minin ? resources.appendingPathComponent("Персонажи/minin") : resources, minin:minin)
        let rect = NSRect(x:0,y:0,width:320,height:720)
        let window = NSWindow(contentRect:rect,styleMask:.borderless,backing:.buffered,defer:false)
        let view = SKView(frame:rect)
        window.contentView = view
        view.presentScene(avatar)
        window.orderBack(nil)
        avatar.size = rect.size
        view.isPaused = true
        avatar.heightFraction = 1
        avatar.speech(nil,track)
        let count = Int(ceil((duration+0.70)*30))
        for index in 0..<count {
            try autoreleasepool {
                let time = Double(index)/30
                let audioTime = time-0.25
                avatar.renderPose(elapsed:time,speechTime:audioTime >= 0 && audioTime < duration ? audioTime : -1)
                guard let tex = view.texture(from:avatar,crop:rect),
                      let image = NSBitmapImageRep(cgImage:tex.cgImage()).representation(using:.png,properties:[:])
                else { throw CocoaError(.fileWriteUnknown) }
                try image.write(to:directory.appendingPathComponent(String(format:"%04d.png",index)))
            }
        }
        window.orderOut(nil)
    }
}
