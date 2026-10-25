import AppKit

final class LibraryDashboard: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var root: URL?
    private var buttons: [NSButton] = []
    private let statusLabel = NSTextField(labelWithString: "Starting your library…")
    private let detailLabel = NSTextField(wrappingLabelWithString: "Keep this dashboard open while browsing.")
    private let operations = DispatchQueue(label: "local.retro-library.operations", qos: .userInitiated)
    private var busy = false
    private var checking = false
    private var quitting = false
    private var stopped = false
    private var timer: Timer?
    // A packaged app (see scripts/package.mjs) carries the project and Node.js inside it and
    // runs from its own folder in Application Support, on its own address so its browser
    // data never mixes with a copy run from the project folder.
    private var bundledNode: URL?
    private var port = 8765

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: .darkAqua)
        configureWindow()
        guard let selected = bundledProject() ?? locateProject() else { stopped = true; NSApp.terminate(nil); return }
        root = selected
        configureMenu()
        if bundledNode == nil { UserDefaults.standard.set(selected.path, forKey: "RetroLibraryProject") }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        openSection("library/backlog.html")
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refreshStatus() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshStatus()
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if stopped || root == nil { return .terminateNow }
        if quitting { return .terminateLater }
        quitting = true
        timer?.invalidate()
        setBusy(true, message: "Stopping your library…")
        run("stop") { [weak self] code, output in
            guard let self else { sender.reply(toApplicationShouldTerminate: true); return }
            if code != 0 && code != 4 {
                self.detailLabel.stringValue = output
                self.statusLabel.stringValue = "Could not stop the server"
                self.setBusy(false)
                self.quitting = false
                sender.reply(toApplicationShouldTerminate: false)
                return
            }
            self.stopped = true
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    private func configureMenu() {
        let menu = NSMenu()
        let item = NSMenuItem()
        let appMenu = NSMenu(title: "Level Select")
        for (title, action, key) in [
            ("Play", #selector(openPlay), "1"),
            ("Library", #selector(openOwned), "2"),
            ("Wishlist", #selector(openWishlist), "3"),
            ("Game Atlas", #selector(openRecommendations), "4"),
            ("Restart Library", #selector(restart), "r"),
            ("Stop & Quit", #selector(quit), "q")
        ] { appMenu.addItem(withTitle: title, action: action, keyEquivalent: key).target = self }
        // Only the installed app can remove itself; a project folder's app leaves that to you.
        if bundledNode != nil {
            appMenu.addItem(.separator())
            appMenu.addItem(withTitle: "Uninstall Level Select…", action: #selector(uninstall), keyEquivalent: "").target = self
        }
        item.submenu = appMenu
        menu.addItem(item)
        NSApp.mainMenu = menu
    }

    private func configureWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 570, height: 380),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Level Select"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        let content = NSView()
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(calibratedRed: 20/255, green: 22/255, blue: 25/255, alpha: 1).cgColor
        window.contentView = content

        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Level Select")
        title.font = .systemFont(ofSize: 30, weight: .semibold)
        let subtitle = NSTextField(labelWithString: "Your games. One place to browse.")
        subtitle.font = .systemFont(ofSize: 14)
        subtitle.textColor = .secondaryLabelColor
        let heading = NSStackView(views: [title, subtitle])
        heading.orientation = .vertical
        heading.alignment = .leading
        heading.spacing = 6
        heading.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.font = .systemFont(ofSize: 13)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.maximumNumberOfLines = 3
        detailLabel.translatesAutoresizingMaskIntoConstraints = false

        // Play is the home: the first, highlighted button (Return opens it).
        let play = button("Play", action: #selector(openPlay))
        play.keyEquivalent = "\r"
        play.bezelColor = NSColor(calibratedRed: 228/255, green: 183/255, blue: 112/255, alpha: 1)
        let sections = NSStackView(views: [play, button("Library", action: #selector(openOwned)), button("Wishlist", action: #selector(openWishlist)), button("Game Atlas", action: #selector(openRecommendations))])
        sections.orientation = .horizontal
        sections.distribution = .fillEqually
        sections.spacing = 10
        sections.translatesAutoresizingMaskIntoConstraints = false

        let controls = NSStackView(views: [button("Restart", action: #selector(restart)), button("Show Folder", action: #selector(showProject)), button("Stop & Quit", action: #selector(quit))])
        controls.orientation = .horizontal
        controls.spacing = 10
        controls.translatesAutoresizingMaskIntoConstraints = false
        let footer = NSTextField(labelWithString: "Local on this Mac · Opens in your default browser")
        footer.font = .systemFont(ofSize: 12)
        footer.textColor = .secondaryLabelColor
        footer.translatesAutoresizingMaskIntoConstraints = false
        [icon, heading, statusLabel, detailLabel, sections, controls, footer].forEach(content.addSubview)
        NSLayoutConstraint.activate([
            icon.topAnchor.constraint(equalTo: content.topAnchor, constant: 28),
            icon.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            icon.widthAnchor.constraint(equalToConstant: 72), icon.heightAnchor.constraint(equalToConstant: 72),
            heading.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 16),
            heading.centerYAnchor.constraint(equalTo: icon.centerYAnchor),
            heading.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -28),
            statusLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 32),
            statusLabel.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -32),
            detailLabel.leadingAnchor.constraint(equalTo: statusLabel.leadingAnchor),
            detailLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            detailLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -32),
            detailLabel.heightAnchor.constraint(equalToConstant: 48),
            sections.topAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: 14),
            sections.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            sections.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            controls.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            controls.topAnchor.constraint(equalTo: sections.bottomAnchor, constant: 18),
            footer.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 32),
            footer.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -22)
        ])
    }

    private func button(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.font = .systemFont(ofSize: 14, weight: .medium)
        buttons.append(button)
        return button
    }

    private func validProject(_ url: URL) -> Bool {
        ["retro-library.command", "scripts/serve.mjs", "library/index.html"].allSatisfy {
            FileManager.default.fileExists(atPath: url.appendingPathComponent($0).path)
        }
    }

    // The packaged app copies its project to ~/Library/Application Support/Level Select/app
    // (an app inside /Applications can't write next to itself), and again when a newer version
    // is installed. The copy goes over the old one, so imported games and settings stay.
    private func bundledProject() -> URL? {
        guard let payload = Bundle.main.url(forResource: "app", withExtension: nil),
              let node = Bundle.main.url(forResource: "node", withExtension: nil)?.appendingPathComponent("node"),
              FileManager.default.isExecutableFile(atPath: node.path) else { return nil }
        bundledNode = node
        port = 8790
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Level Select", isDirectory: true)
        let target = support.appendingPathComponent("app", isDirectory: true)
        let version = { (folder: URL) in try? String(contentsOf: folder.appendingPathComponent(".payload-version"), encoding: .utf8) }
        if let current = version(payload), current == version(target), validProject(target) { return target }
        if validProject(target) { _ = execute("stop", root: target) }
        do {
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            let copy = Process()
            copy.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            copy.arguments = [payload.path, target.path]
            try copy.run()
            copy.waitUntilExit()
            if copy.terminationStatus == 0 && validProject(target) { return target }
        } catch {}
        let alert = NSAlert()
        alert.messageText = "Level Select couldn’t set itself up."
        alert.informativeText = "It needs to copy its files to \(support.path). Check there’s free space, then open Level Select again."
        alert.runModal()
        return nil
    }

    private func locateProject() -> URL? {
        var candidates: [URL] = [Bundle.main.bundleURL.deletingLastPathComponent()]
        if let file = Bundle.main.url(forResource: "project-path", withExtension: "txt"),
           let text = try? String(contentsOf: file, encoding: .utf8) {
            candidates.append(URL(fileURLWithPath: text.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        if let saved = UserDefaults.standard.string(forKey: "RetroLibraryProject") { candidates.append(URL(fileURLWithPath: saved)) }
        if let found = candidates.first(where: validProject) { return found }
        let picker = NSOpenPanel()
        picker.title = "Locate Level Select"
        picker.message = "Choose your Level Select project folder (the one with retro-library.command)."
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.allowsMultipleSelection = false
        while picker.runModal() == .OK, let selected = picker.url {
            if validProject(selected) { return selected }
            let alert = NSAlert()
            alert.messageText = "This is not the Level Select folder."
            alert.informativeText = "Choose the folder containing retro-library.command and the library folder."
            alert.runModal()
        }
        return nil
    }

    private func run(_ action: String, completion: @escaping (Int32, String) -> Void) {
        guard let root else { completion(2, "The project folder is unavailable."); return }
        operations.async {
            let (code, text) = self.execute(action, root: root)
            DispatchQueue.main.async { completion(code, text) }
        }
    }

    private func execute(_ action: String, root: URL) -> (Int32, String) {
        let task = Process(), pipe = Pipe()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = [root.appendingPathComponent("retro-library.command").path, action]
        task.currentDirectoryURL = root
        task.standardOutput = pipe
        task.standardError = pipe
        // The app always uses the same address, preserving browser storage.
        var environment = ProcessInfo.processInfo.environment
        environment["RETRO_LIBRARY_PORT"] = String(port)
        if let bundledNode { environment["RETRO_LIBRARY_NODE"] = bundledNode.path }
        // Apps opened from the Dock don't get your shell's PATH; Homebrew's Python lives here.
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")
        task.environment = environment
        do {
            try task.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            return (task.terminationStatus, String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
        } catch { return (2, error.localizedDescription) }
    }

    private func setBusy(_ value: Bool, message: String? = nil) {
        busy = value
        buttons.forEach { $0.isEnabled = !value }
        if let message { statusLabel.stringValue = message; statusLabel.textColor = .secondaryLabelColor }
    }

    private func display(_ code: Int32, _ output: String) {
        statusLabel.stringValue = code == 0 ? "Ready to browse" : code == 3 ? "Library stopped" : code == 4 ? "Address unavailable" : "Could not start"
        statusLabel.textColor = code == 0 ? NSColor(calibratedRed: 228/255, green: 183/255, blue: 112/255, alpha: 1) : .secondaryLabelColor
        detailLabel.stringValue = output.replacingOccurrences(of: "RUNNING ", with: "").replacingOccurrences(of: "STOPPED ", with: "").replacingOccurrences(of: "BLOCKED ", with: "").replacingOccurrences(of: "ERROR ", with: "")
    }

    private func openSection(_ route: String) {
        guard !busy && !quitting else { return }
        setBusy(true, message: "Opening your library…")
        run("start") { [weak self] code, output in
            guard let self, !self.quitting else { return }
            self.setBusy(false)
            self.display(code, output)
            if code == 0, let url = URL(string: "http://127.0.0.1:\(self.port)/" + route) { NSWorkspace.shared.open(url) }
        }
    }

    private func refreshStatus() {
        guard !busy && !checking && !quitting else { return }
        checking = true
        run("status") { [weak self] code, output in
            guard let self else { return }
            self.checking = false
            if !self.busy && !self.quitting { self.display(code, output) }
        }
    }

    @objc private func openPlay() { openSection("library/backlog.html") }
    @objc private func openOwned() { openSection("library/index.html") }
    @objc private func openRecommendations() { openSection("index.html") }
    @objc private func openWishlist() { openSection("library/wishlist.html") }
    @objc private func showProject() { if let root { NSWorkspace.shared.open(root) } }
    @objc private func quit() { NSApp.terminate(nil) }
    // Dragging the app to the Trash would leave its copy in Application Support behind. This
    // removes that copy too, keeping imported games unless you ask (as on Windows).
    @objc private func uninstall() {
        guard !busy && !quitting, bundledNode != nil, let root else { return }
        let alert = NSAlert()
        alert.messageText = "Uninstall Level Select?"
        alert.informativeText = "Level Select stops and moves to the Trash, and its files in Application Support are removed.\n\nYour play tracking lives in your browser either way."
        alert.addButton(withTitle: "Uninstall")
        alert.addButton(withTitle: "Cancel")
        alert.showsSuppressionButton = true
        alert.suppressionButton?.title = "Also delete the games and settings it imported (library, connected accounts, Steam key)"
        alert.suppressionButton?.state = .off
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let everything = alert.suppressionButton?.state == .on
        timer?.invalidate()
        setBusy(true, message: "Uninstalling Level Select…")
        run("stop") { [weak self] code, output in
            guard let self else { return }
            if code != 0 && code != 3 && code != 4 {
                self.setBusy(false)
                self.display(code, output)
                return
            }
            let files = FileManager.default, support = root.deletingLastPathComponent()
            if everything { try? files.removeItem(at: support) }
            else {
                // What was installed (the app's own copy lists it) and what running it made go;
                // imported games, exports and artwork stay for a later install, as on Windows.
                if let payload = Bundle.main.url(forResource: "app", withExtension: nil),
                   let installed = files.enumerator(atPath: payload.path) {
                    for case let file as String in installed where !(installed.fileAttributes?[.type] as? FileAttributeType == .typeDirectory) {
                        try? files.removeItem(at: root.appendingPathComponent(file))
                    }
                }
                try? files.removeItem(at: root.appendingPathComponent(".runtime"))
                let folders = (files.enumerator(atPath: root.path)?.allObjects as? [String] ?? [])
                    .filter { var folder: ObjCBool = false; return files.fileExists(atPath: root.appendingPathComponent($0).path, isDirectory: &folder) && folder.boolValue }
                for folder in folders where folder.hasSuffix("__pycache__") { try? files.removeItem(at: root.appendingPathComponent(folder)) }
                // Then the folders left empty, deepest first.
                for folder in folders.sorted(by: { $0.count > $1.count }) + [""] {
                    let url = folder.isEmpty ? root : root.appendingPathComponent(folder)
                    if (try? files.contentsOfDirectory(atPath: url.path))?.allSatisfy({ $0 == ".DS_Store" }) == true { try? files.removeItem(at: url) }
                }
                if (try? files.contentsOfDirectory(atPath: support.path))?.allSatisfy({ $0 == ".DS_Store" }) == true { try? files.removeItem(at: support) }
            }
            if let identifier = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: identifier) }
            NSWorkspace.shared.recycle([Bundle.main.bundleURL]) { _, _ in
                self.stopped = true
                NSApp.terminate(nil)
            }
        }
    }
    @objc private func restart() {
        guard !busy && !quitting else { return }
        setBusy(true, message: "Restarting your library…")
        run("restart") { [weak self] code, output in
            guard let self, !self.quitting else { return }
            self.setBusy(false)
            self.display(code, output)
        }
    }
}

let application = NSApplication.shared
let dashboard = LibraryDashboard()
application.delegate = dashboard
application.run()
