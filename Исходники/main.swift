import AppKit
import SpriteKit
import CoreImage
import AVFoundation

typealias Message = [String: Any]

final class OutputWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

final class Station: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let bench = CommandLine.arguments.contains("--test-player")
    let offline = CommandLine.arguments.contains("--offline")
    var activity: NSObjectProtocol?
    let root = Bundle.main.bundleURL.deletingLastPathComponent()
    let panel = NSWindow(contentRect: NSRect(x:0,y:0,width:610,height:515), styleMask:[.titled,.closable,.miniaturizable], backing:.buffered, defer:false)
    let text = NSTextField(string:"Здравствуйте. Меня зовут Александр Степанович Попов.")
    let status = NSTextField(labelWithString:"Запускается показ…")
    let timing = NSTextField(labelWithString:"")
    let displays = NSPopUpButton()
    let scale = NSSlider(value:0.9,minValue:0.30,maxValue:1.05,target:nil,action:nil)
    let horizontal = NSSlider(value:0,minValue:-0.45,maxValue:0.45,target:nil,action:nil)
    let vertical = NSSlider(value:0,minValue:-0.35,maxValue:0.35,target:nil,action:nil)
    let editGrid = NSButton(checkboxWithTitle:"Показать сетку",target:nil,action:nil)
    let diagnostic = NSButton(checkboxWithTitle:"Метка задержки",target:nil,action:nil)
    let reference = NSView()
    let questionMode = NSButton(checkboxWithTitle:"Вопрос посетителя",target:nil,action:nil)
    let sendButton = NSButton()
    let worker = Process()
    let commands = Pipe(), responses = Pipe()
    var window: OutputWindow?
    var avatar: Avatar!
    let stream = StreamAudio()
    var activeID: String?
    var visitorURL: URL?
    var visitorCard: NSView?
    var visitorExpires = 0.0
    var qrTimer: Timer?
    var serverMode: Bool {
        guard !offline else { return false }
        return ProcessInfo.processInfo.environment["POPOV_SERVER_URL"] != nil ||
        FileManager.default.fileExists(atPath: root.appendingPathComponent("station.env").path)
    }
    let visitorLink = NSTextField(labelWithString: "")
    var targetScreen: NSNumber?
    var ready = false, stopped = false, closing = false
    var monitor: Any?
    let defaults = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        setMenus()
        buildPanel()
        do {
            avatar = try Avatar(folder:root.appendingPathComponent("Ресурсы"))
            try stream.warm()
            avatar.liveFace = { [weak self] in self?.stream.face() }
            stream.completed = { [weak self] index,last in
                guard let self=self, let key=self.activeID else { return }
                self.send(["command":"played","id":key,"index":index,"underruns":self.stream.underruns])
                if last {
                    self.clearAudio()
                    self.send(["command":"finished","id":key])
                    self.status.stringValue="Готов к реплике"
                }
            }
            calibrate()
            refreshScreens()
            openOutput()
            if bench { window?.orderOut(nil); panel.orderOut(nil) }
            else if serverMode && !CommandLine.arguments.contains("--test-panel") { panel.orderOut(nil) }
            else { panel.makeKeyAndOrderFront(nil) }
            launchWorker()
        } catch { status.stringValue = error.localizedDescription }
        if !bench { NSApp.activate(ignoringOtherApps:true) }
        qrTimer = Timer.scheduledTimer(withTimeInterval:1,repeats:true) { [weak self] _ in
            guard let self=self else { return }
            if self.visitorExpires > 0 && Date().timeIntervalSince1970 >= self.visitorExpires {
                self.visitorCard?.removeFromSuperview(); self.visitorURL=nil
            }
        }
        NotificationCenter.default.addObserver(self,selector:#selector(screensChanged),name:NSApplication.didChangeScreenParametersNotification,object:nil)
        NSWorkspace.shared.notificationCenter.addObserver(self,selector:#selector(stop),name:NSWorkspace.willSleepNotification,object:nil)
        NSWorkspace.shared.notificationCenter.addObserver(self,selector:#selector(stop),name:NSWorkspace.sessionDidResignActiveNotification,object:nil)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.stop(); return nil }
            return event
        }
        ProcessInfo.processInfo.disableAutomaticTermination("Локальный проигрыватель")
    }

    func setMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let application = NSMenu(); appItem.submenu = application
        application.addItem(withTitle:"Завершить работу пульта",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let edit = NSMenu(title:"Правка"); editItem.submenu=edit
        for (title, selector, key) in [("Отменить","undo:","z"),("Вырезать","cut:","x"),("Скопировать","copy:","c"),("Вставить","paste:","v"),("Выделить всё","selectAll:","a")] {
            edit.addItem(withTitle:title,action:NSSelectorFromString(selector),keyEquivalent:key)
        }
        NSApp.mainMenu=menu
    }

    func buildPanel() {
        panel.title = "Город говорит · Тестовый пульт"
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let container = panel.contentView!
        container.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:container.leadingAnchor,constant:22),
          stack.trailingAnchor.constraint(equalTo:container.trailingAnchor,constant:-22),
          stack.topAnchor.constraint(equalTo:container.topAnchor,constant:22)])
        func row(_ views: [NSView]) -> NSStackView {
            let s = NSStackView(views:views); s.spacing=8; s.alignment = .centerY
            return s
        }
        func button(_ title: String,_ action: Selector) -> NSButton {
            return NSButton(title:title,target:self,action:action)
        }
        func label(_ title: String) -> NSTextField { NSTextField(labelWithString:title) }
        let title = label("Проекция Попова"); title.font = .systemFont(ofSize:23,weight:.semibold)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(row([displays,button("Вывести",#selector(openOutput))]))
        for (name,slider,key,initial) in [("Высота",scale,"size",0.9),("Сдвиг по горизонтали",horizontal,"x",0.0),("Сдвиг по вертикали",vertical,"y",0.0)] {
            if defaults.object(forKey:"map."+key) != nil { slider.doubleValue = defaults.double(forKey:"map."+key) } else { slider.doubleValue = initial }
            slider.target = self; slider.action = #selector(calibrate); slider.isContinuous = true
            slider.widthAnchor.constraint(equalToConstant:260).isActive = true
            let l = label(name); l.widthAnchor.constraint(equalToConstant:155).isActive = true
            stack.addArrangedSubview(row([l,slider]))
        }
        editGrid.target = self; editGrid.action = #selector(calibrate)
        reference.wantsLayer=true; reference.layer?.backgroundColor=NSColor.black.cgColor
        reference.widthAnchor.constraint(equalToConstant:22).isActive=true
        reference.heightAnchor.constraint(equalToConstant:22).isActive=true
        stack.addArrangedSubview(row([editGrid,button("По центру",#selector(resetMap)),diagnostic,reference]))
        stack.addArrangedSubview(row([label("Текст"),questionMode,button("Начать экскурсию",#selector(tour))]))
        text.placeholderString = "Введите реплику"; text.target = self; text.action = #selector(say)
        stack.addArrangedSubview(text); text.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true
        sendButton.title = "Произнести"; sendButton.bezelStyle = .rounded; sendButton.target = self
        sendButton.action = #selector(say); sendButton.isEnabled = false
        let halt = button("СТОП  ⎋",#selector(stop)); halt.contentTintColor = .systemRed
        stack.addArrangedSubview(row([sendButton,button("Перебить",#selector(interrupt)),halt,button("Возобновить",#selector(resume))]))
        stack.addArrangedSubview(row([button("Приложение посетителя",#selector(openVisitor)),visitorLink]))
        visitorLink.isSelectable=true; visitorLink.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail; stack.addArrangedSubview(status)
        timing.textColor = .secondaryLabelColor; stack.addArrangedSubview(timing)
        panel.center(); panel.makeKeyAndOrderFront(nil)
    }

    func screenID(_ screen: NSScreen) -> NSNumber? { screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber }
    func refreshScreens() {
        let old = displays.selectedItem?.representedObject as? NSNumber
        displays.removeAllItems()
        displays.addItem(withTitle:"Пробное окно на ноутбуке")
        for screen in NSScreen.screens {
            displays.addItem(withTitle:"Полный экран · " + screen.localizedName)
            displays.lastItem?.representedObject = screenID(screen)
        }
        if let old = old, let item = displays.itemArray.first(where:{ ($0.representedObject as? NSNumber) == old }) { displays.select(item) }
        else if serverMode && NSScreen.screens.count > 1 { displays.selectItem(at:2) }
    }

    @objc func screensChanged() {
        if let id = targetScreen, !NSScreen.screens.contains(where:{screenID($0)==id}) {
            stop(); window?.orderOut(nil); targetScreen=nil
        }
        refreshScreens()
        if let id = targetScreen, let screen = NSScreen.screens.first(where:{screenID($0)==id}) {
            window?.setFrame(screen.frame,display:true)
        }
    }

    @objc func openOutput() {
        guard avatar != nil else { return }
        if let id = displays.selectedItem?.representedObject as? NSNumber, panel.screen.map(screenID) == id, NSScreen.screens.count > 1 {
            status.stringValue = "Пульт открыт на этом дисплее. Выберите другой экран или перенесите пульт."; return
        }
        if activeID != nil { stop() }
        if let view = window?.contentView as? SKView { view.presentScene(nil) }
        window?.orderOut(nil); window?.delegate=nil
        let selected = displays.selectedItem?.representedObject as? NSNumber
        let screen = NSScreen.screens.first { selected != nil && screenID($0) == selected }
        if let screen = screen, NSScreen.screens.count == 1 {
            status.stringValue = screen.localizedName + " — единственный экран. Используйте пробное окно."; displays.selectItem(at:0)
        }
        let full = screen != nil && NSScreen.screens.count > 1
        let initial = full ? screen!.frame : NSRect(x:0,y:0,width:800,height:450)
        let out = OutputWindow(contentRect:initial, styleMask:full ? [.borderless] : [.titled,.resizable,.closable,.miniaturizable], backing:.buffered,defer:false)
        out.title = "Попов · Проверка проекции"; out.backgroundColor = .black; out.isReleasedWhenClosed = false
        out.delegate=self; out.hasShadow = !full; targetScreen = full ? selected : nil
        if full {
            out.level = NSWindow.Level(rawValue:Int(CGShieldingWindowLevel())+1)
            out.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary,.stationary,.ignoresCycle]
            out.setFrame(initial,display:false)
        } else {
            out.center(); out.setFrameOrigin(NSPoint(x:out.frame.minX+135,y:out.frame.minY-75))
        }
        let surface=SKView(frame:NSRect(origin:.zero,size:initial.size))
        surface.ignoresSiblingOrder=false; surface.preferredFramesPerSecond=60
        surface.autoresizingMask=[.width,.height]; out.contentView=surface; surface.presentScene(avatar)
        window=out; showVisitorCode(); out.orderFront(nil)
        if !serverMode || CommandLine.arguments.contains("--test-panel") { panel.makeKeyAndOrderFront(nil) }
    }

    @objc func openVisitor() {
        if serverMode {
            if let url = visitorURL, Date().timeIntervalSince1970 < visitorExpires {
                NSWorkspace.shared.open(url)
            } else {
                status.stringValue = "Ожидаем свежий QR"
            }
            return
        }
        send(["command":"visitors"])
    }

    func showVisitorCode() {
        visitorCard?.removeFromSuperview()
        guard let url=visitorURL, let surface=window?.contentView, !stopped,
              visitorExpires == 0 || Date().timeIntervalSince1970 < visitorExpires,
              let filter=CIFilter(name:"CIQRCodeGenerator") else { return }
        filter.setValue(Data(url.absoluteString.utf8),forKey:"inputMessage")
        filter.setValue("M",forKey:"inputCorrectionLevel")
        guard let code=filter.outputImage?.transformed(by:CGAffineTransform(scaleX:6,y:6)),
              let image=CIContext().createCGImage(code,from:code.extent) else {return}
        let card=NSView(frame:NSRect(x:max(16,surface.bounds.width-180),y:20,width:160,height:160))
        card.autoresizingMask = [.minXMargin,.maxYMargin]
        card.wantsLayer=true; card.layer?.backgroundColor=NSColor.white.cgColor
        let qr=NSImageView(frame:NSRect(x:10,y:10,width:140,height:140))
        qr.image=NSImage(cgImage:image,size:code.extent.size); qr.imageScaling = .scaleProportionallyUpOrDown
        let caption=NSTextField(labelWithString:"Спросить Попова")
        caption.alignment = .center; caption.textColor = .black
        caption.frame=NSRect(x:3,y:23,width:182,height:18)
        let shortAddress = (url.host ?? "") + (url.port.map { ":" + String($0) } ?? "")
        let address=NSTextField(labelWithString:shortAddress)
        address.alignment = .center; address.textColor = .darkGray
        address.font = .systemFont(ofSize:10); address.frame=NSRect(x:2,y:4,width:184,height:16)
        card.addSubview(qr)
        surface.addSubview(card);visitorCard=card
    }

    @objc func calibrate() {
        guard avatar != nil else { return }
        avatar.heightFraction=CGFloat(scale.doubleValue); avatar.shiftX=CGFloat(horizontal.doubleValue); avatar.shiftY=CGFloat(vertical.doubleValue)
        avatar.calibrating=editGrid.state == .on
        defaults.set(scale.doubleValue,forKey:"map.size"); defaults.set(horizontal.doubleValue,forKey:"map.x"); defaults.set(vertical.doubleValue,forKey:"map.y")
    }
    @objc func resetMap() { scale.doubleValue=0.9; horizontal.doubleValue=0; vertical.doubleValue=0; calibrate() }

    func launchWorker() {
        worker.currentDirectoryURL=root
        if offline {
            var environment = ProcessInfo.processInfo.environment
            environment["POPOV_LOCAL_SERVER"] = "0"
            environment["POPOV_SERVER_URL"] = ""
            worker.environment = environment
        }
        worker.executableURL=root.appendingPathComponent(".venv/bin/python")
        worker.arguments=["-u",root.appendingPathComponent("Исходники/service.py").path]
        worker.standardInput=commands; worker.standardOutput=responses
        worker.terminationHandler = { [weak self] _ in DispatchQueue.main.async {
            guard let self=self,!self.closing else { return }; self.ready=false; self.clearAudio()
            self.avatar.blank=true; self.sendButton.isEnabled=false; self.status.stringValue="Голосовой процесс завершился. Перезапустите пульт."
        }}
        do { try worker.run() } catch { status.stringValue="Ошибка запуска голоса: "+error.localizedDescription; return }
        DispatchQueue.global(qos:.userInitiated).async { [weak self] in
            guard let self=self else { return }
            let handle = self.responses.fileHandleForReading
            func read(_ count:Int) -> Data? {
                var result = Data()
                while result.count < count {
                    guard let piece = try? handle.read(upToCount:count-result.count), !piece.isEmpty else { return nil }
                    result.append(piece)
                }
                return result
            }
            while let prefix = read(8) {
                let lengths = prefix.withUnsafeBytes { bytes in
                    (Int(bytes.loadUnaligned(as:UInt32.self).bigEndian),
                     Int(bytes.loadUnaligned(fromByteOffset:4,as:UInt32.self).bigEndian))
                }
                guard lengths.0 <= 2_000_000, lengths.1 <= 6_000_000,
                      let header = read(lengths.0), let pcm = read(lengths.1),
                      let message = (try? JSONSerialization.jsonObject(with:header)) as? Message else { break }
                DispatchQueue.main.async { self.handle(message,pcm:pcm) }
            }
        }
    }

    func send(_ message:Message) {
        guard worker.isRunning, var data=try? JSONSerialization.data(withJSONObject:message) else { return }
        data.append(10); try? commands.fileHandleForWriting.write(contentsOf:data)
    }
    @objc func say() {
        guard ready, !stopped, window?.isVisible == true else {return}
        send(["command":questionMode.state == .on ? "ask" : "say","text":text.stringValue]); status.stringValue="Реплика отправлена"
    }
    @objc func tour() {
        guard ready, !stopped, window?.isVisible == true else { return }
        do {
            let file = root.appendingPathComponent("Примеры/У радиоприёмника.txt")
            let narration = try String(contentsOf:file, encoding:.utf8)
            send(["command":"say","text":narration])
            status.stringValue = "Экскурсия отправлена"
        } catch { status.stringValue = error.localizedDescription }
    }
    @objc func interrupt() {
        guard ready, !stopped, window?.isVisible == true else { return }
        send(["command":questionMode.state == .on ? "ask":"say","text":text.stringValue,"interrupt":true])
    }
    func clearAudio() {
        stream.clear(); avatar?.speech(nil); activeID=nil
        if let token=activity { ProcessInfo.processInfo.endActivity(token); activity=nil }
    }
    func blackout() {
        stopped=true; visitorCard?.removeFromSuperview(); avatar?.flashUntil=0; reference.layer?.backgroundColor=NSColor.black.cgColor; clearAudio(); avatar?.blank=true; editGrid.state = .off; avatar?.calibrating=false
        sendButton.isEnabled=false; status.stringValue="СТОП · звук выключен, поле чёрное"
    }
    @objc func stop() { blackout(); send(["command":"stop"]) }
    @objc func resume() {
        if !bench && window?.isVisible != true { openOutput() }
        send(["command":"resume"])
    }
    func handle(_ msg:Message, pcm:Data) {
        guard !closing, let type=msg["type"] as? String else {return}
        switch type {
        case "ready": ready=true; sendButton.isEnabled = !stopped; if !stopped { status.stringValue="Готов к реплике" }
        case "visitors":
            guard let link=msg["url"] as? String, let url=URL(string:link) else {return}
            visitorURL=url; visitorLink.stringValue=(url.host ?? "")
            visitorExpires=msg["expires_at"] as? Double ?? 0; showVisitorCode()
            if let warning=msg["warning"] as? String, !warning.isEmpty { status.stringValue=warning }
            if msg["open"] as? Bool == true, let address=msg["preview"] as? String, let preview=URL(string:address) {
                NSWorkspace.shared.open(preview)
            }
        case "stop": blackout()
        case "interrupt": clearAudio()
        case "abort":
            if activeID == msg["id"] as? String { clearAudio() }
            status.stringValue=msg["message"] as? String ?? "Ошибка синтеза"
        case "resume":
            guard bench || window?.isVisible == true else { stop(); return }
            stopped=false; showVisitorCode(); avatar.blank=false; sendButton.isEnabled=ready; status.stringValue=ready ? "Готов к реплике" : "Загружается голос…"
        case "timing": if let ms=msg["ms"] as? Int { timing.stringValue="От приёма текста до запуска звука: "+String(ms)+" мс" }
        case "error": status.stringValue=msg["message"] as? String ?? "Ошибка"
        case "play":
            guard let key=msg["id"] as? String, let index=msg["index"] as? Int else {return}
            if index > 0 && activeID != key { return }
            guard !stopped, (bench || window?.isVisible == true), (index > 0 || (msg["expiry"] as? Double ?? 0)>Date().timeIntervalSince1970) else { send(["command":"failed","id":key]);return }
            do {
                let track = try SpeechTrack(msg)
                try stream.append(pcm,track:track,index:index,last:msg["last"] as? Bool ?? false)
                if index > 0 { return }
                activeID=key
                activity=ProcessInfo.processInfo.beginActivity(options:[.userInitiated,.idleDisplaySleepDisabled],reason:"Воспроизведение музейного рассказа")
                editGrid.state = .off; avatar.calibrating=false
                if diagnostic.state == .on {
                    avatar.flashUntil=ProcessInfo.processInfo.systemUptime+0.20
                    reference.layer?.backgroundColor=NSColor.white.cgColor
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.20) { self.reference.layer?.backgroundColor=NSColor.black.cgColor }
                }
                send(["command":"started","id":key]); status.stringValue="Попов говорит"
            } catch {
                clearAudio(); send(["command":"failed","id":key]); status.stringValue=error.localizedDescription
            }
        default:break
        }
    }
    func windowWillClose(_ notification:Notification) {
        if notification.object as? NSWindow === panel {NSApp.terminate(nil)}
        else if notification.object as? NSWindow === window {stop()}
    }
    func windowDidMiniaturize(_ notification:Notification) { if notification.object as? NSWindow === window {stop()} }
    func applicationWillTerminate(_ notification: Notification) {
        closing=true;clearAudio()
        if let m=monitor {NSEvent.removeMonitor(m)}
        if worker.isRunning {try? commands.fileHandleForWriting.close()}
    }
}
let app=NSApplication.shared
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--frames" {
    do { try FrameExport.run(directory:URL(fileURLWithPath:CommandLine.arguments[2])) }
    catch { FileHandle.standardError.write(Data((error.localizedDescription+"\n").utf8)); exit(1) }
    exit(0)
}
let controller=Station()
app.setActivationPolicy(controller.bench ? .accessory : .regular)
app.delegate=controller
app.run()
