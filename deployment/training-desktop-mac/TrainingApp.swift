import AppKit
import Darwin
import Foundation
import Security
import SwiftUI

private let trainingURL = URL(string: "http://127.0.0.1:3401/login")!

final class TrainingRuntime {
    private let lock = NSLock()
    private var backend: Process?
    private var frontend: Process?
    private var cancelled = false

    let state = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/HiddenOasis/OperationsTraining", isDirectory: true)

    var resourceRoot: URL {
        guard let url = Bundle.main.resourceURL else {
            fatalError("Signed application bundle resources unavailable")
        }
        return url
    }

    private func makeDirectory(_ path: URL) throws {
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path.path)
    }

    private func generateSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 48)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw NSError(domain: "HiddenOasisTraining", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Could not create private training session keys"])
        }
        return Data(bytes).base64EncodedString()
    }

    struct Settings: Codable {
        let sessionSecret: String
        let integrationKey: String
    }

    private func settings() throws -> Settings {
        let file = state.appendingPathComponent("private/desktop-settings.json")
        if FileManager.default.fileExists(atPath: file.path) {
            let result = try JSONDecoder().decode(Settings.self, from: Data(contentsOf: file))
            guard result.sessionSecret.count >= 48, result.integrationKey.count >= 48 else {
                throw NSError(domain: "HiddenOasisTraining", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Stored demo session settings are invalid"])
            }
            return result
        }
        let new = try Settings(sessionSecret: generateSecret(), integrationKey: generateSecret())
        try JSONEncoder().encode(new).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return new
    }

    private func environment() throws -> [String: String] {
        let settings = try settings()
        let db = state.appendingPathComponent("data/operations_training_demo_macdesktop.sqlite").path
        let systemEnv = ProcessInfo.processInfo.environment
        return [
            "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TMPDIR": systemEnv["TMPDIR"] ?? "/tmp",
            "LANG": "en_US.UTF-8",
            "ENVIRONMENT": "local",
            "ALLOW_DEMO_SEED": "false",
            "ALLOW_DEFAULT_ADMIN_BOOTSTRAP": "false",
            "TRAINING_STATE_DIR": state.path,
            "DATABASE_URL": "sqlite:///" + db,
            "UPLOAD_DIR": state.appendingPathComponent("uploads").path,
            "SESSION_SECRET": settings.sessionSecret,
            "INTEGRATION_API_KEY": settings.integrationKey,
            "ALLOWED_HOSTS": "127.0.0.1,localhost",
            "ALLOWED_ORIGINS": "http://127.0.0.1:3401,http://localhost:3401",
            "FORCE_HTTPS": "false",
            "EXPOSE_API_DOCS": "false",
            "TRUST_PROXY_HEADERS": "false",
            "NEXT_TELEMETRY_DISABLED": "1",
            "NEXT_PUBLIC_TRAINING_MODE": "true",
            "RELEASE_SHA": "mac-desktop-training"
        ]
    }

    private func portTaken(_ port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return true }
        defer { close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port.bigEndian)
        _ = "127.0.0.1".withCString { inet_pton(AF_INET, $0, &address.sin_addr) }
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    private func launch(_ executable: URL, args: [String], workdir: URL,
                        env: [String: String], logfile: String) throws -> Process {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw NSError(domain: "HiddenOasisTraining", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Packaged training runtime missing: \(executable.lastPathComponent)"])
        }
        let log = state.appendingPathComponent("logs/" + logfile)
        FileManager.default.createFile(atPath: log.path, contents: Data())
        let output = try FileHandle(forWritingTo: log)
        let process = Process()
        process.executableURL = executable
        process.arguments = args
        process.currentDirectoryURL = workdir
        process.environment = env
        process.standardOutput = output
        process.standardError = output
        try process.run()
        return process
    }

    private func setProcess(_ process: Process, api: Bool) throws {
        lock.lock()
        defer { lock.unlock() }
        if cancelled {
            if process.isRunning { process.terminate() }
            throw NSError(domain: "HiddenOasisTraining", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Training startup cancelled"])
        }
        if api { backend = process } else { frontend = process }
    }

    private func isCancelled() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    private func healthy() -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var result = false
        var request = URLRequest(url: URL(string: "http://127.0.0.1:3401/api/readyz")!)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let data = data,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            result = payload["ready"] as? Bool == true
        }.resume()
        return semaphore.wait(timeout: .now() + 5) == .success && result
    }

    func start(progress: @escaping (String) -> Void) throws {
        lock.lock()
        cancelled = false
        lock.unlock()
        guard !portTaken(3401) && !portTaken(8401) else {
            throw NSError(domain: "HiddenOasisTraining", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "Training ports 3401 or 8401 are already in use. Close any other training instance first."])
        }
        for name in ["data", "private", "uploads", "logs"] {
            try makeDirectory(state.appendingPathComponent(name))
        }
        let env = try environment()
        let api = resourceRoot.appendingPathComponent("backend/training-api/training-api")
        let node = resourceRoot.appendingPathComponent("runtime/node")
        let frontendPath = resourceRoot.appendingPathComponent("frontend/standalone", isDirectory: true)

        progress("Preparing private, fictional training accounts...")
        let initializer = try launch(api, args: ["init"], workdir: api.deletingLastPathComponent(),
                                     env: env, logfile: "initialize.log")
        initializer.waitUntilExit()
        guard initializer.terminationStatus == 0 else {
            throw NSError(domain: "HiddenOasisTraining", code: 6,
                          userInfo: [NSLocalizedDescriptionKey: "Training data could not initialize. Check the local logs; existing practice data was not erased."])
        }
        guard !isCancelled() else { return }

        progress("Starting isolated Operations training...")
        let apiProcess = try launch(api, args: ["serve"], workdir: api.deletingLastPathComponent(),
                                    env: env, logfile: "backend.log")
        try setProcess(apiProcess, api: true)
        var uiEnv = env
        uiEnv["HOSTNAME"] = "127.0.0.1"
        uiEnv["PORT"] = "3401"
        uiEnv["NODE_ENV"] = "production"
        let uiProcess = try launch(node, args: ["server.js"], workdir: frontendPath,
                                   env: uiEnv, logfile: "frontend.log")
        try setProcess(uiProcess, api: false)

        progress("Checking training website and database...")
        for _ in 0..<90 {
            if isCancelled() { return }
            guard apiProcess.isRunning, uiProcess.isRunning else { break }
            if healthy() { return }
            Thread.sleep(forTimeInterval: 1)
        }
        throw NSError(domain: "HiddenOasisTraining", code: 7,
                      userInfo: [NSLocalizedDescriptionKey: "Training did not become ready. View the logs in Application Support."])
    }

    func stop() {
        lock.lock()
        cancelled = true
        let processes = [frontend, backend].compactMap { $0 }
        frontend = nil
        backend = nil
        lock.unlock()
        for process in processes {
            if process.isRunning { process.terminate() }
        }
    }

    func trainerRosterURL() -> URL {
        state.appendingPathComponent("private/accounts/PRIVATE_training_accounts.json")
    }

    func logsURL() -> URL {
        state.appendingPathComponent("logs", isDirectory: true)
    }
}

final class TrainingController: ObservableObject {
    @Published var status: String = "Not running"
    @Published var isStarting = false
    @Published var isRunning = false
    private let runtime = TrainingRuntime()
    private var started = false

    func startIfNeeded() {
        if !started { started = true; start() }
    }

    func start() {
        guard !isStarting && !isRunning else { return }
        isStarting = true
        status = "Preparing training..."
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                try self.runtime.start(progress: { message in
                    DispatchQueue.main.async { self.status = message }
                })
                DispatchQueue.main.async {
                    self.isStarting = false
                    self.isRunning = true
                    self.status = "Running locally • Practice data is saved"
                    NSWorkspace.shared.open(trainingURL)
                }
            } catch {
                self.runtime.stop()
                DispatchQueue.main.async {
                    self.isStarting = false
                    self.isRunning = false
                    self.status = "Startup failed • No production data affected"
                    let alert = NSAlert()
                    alert.messageText = "Could not start staff training"
                    alert.informativeText = error.localizedDescription +
                        "\n\nUse “Training logs” for details. Practice data is preserved."
                    alert.runModal()
                }
            }
        }
    }

    func stop() {
        runtime.stop()
        isRunning = false
        isStarting = false
        status = "Stopped • Practice data preserved"
    }

    func openBrowser() {
        NSWorkspace.shared.open(trainingURL)
    }

    func openAccounts() {
        let path = runtime.trainerRosterURL()
        guard FileManager.default.fileExists(atPath: path.path) else { return }
        let alert = NSAlert()
        alert.messageText = "Trainer-only fictional account roster"
        alert.informativeText = "Share only one employee's assigned practice credentials, not the complete roster."
        alert.runModal()
        NSWorkspace.shared.open(path)
    }

    func openLogs() {
        NSWorkspace.shared.open(runtime.logsURL())
    }
}

struct TrainingView: View {
    @StateObject private var controller = TrainingController()
    private let teal = Color(red: 0.12, green: 0.36, blue: 0.27)

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Hidden Oasis")
                .font(.system(size: 32, weight: .semibold, design: .rounded))
                .foregroundColor(teal)
            Text("OPERATIONS  /  ROLE-BASED STAFF TRAINING")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.secondary)
            Text("TRAINING ONLY  •  Fictional hotel and café records")
                .font(.system(size: 13))
            Divider()
            HStack(spacing: 10) {
                if controller.isStarting { ProgressView().controlSize(.small) }
                Text(controller.status).font(.system(size: 13)).lineLimit(2)
            }.frame(height: 42, alignment: .leading)

            HStack(spacing: 12) {
                Button("Start training") { controller.start() }
                    .buttonStyle(.borderedProminent)
                    .tint(teal)
                    .disabled(controller.isStarting || controller.isRunning)
                Button("Stop") { controller.stop() }
                    .disabled(!controller.isRunning)
                Button("Open training") { controller.openBrowser() }
                    .disabled(!controller.isRunning)
            }
            HStack(spacing: 12) {
                Button("Trainer accounts") { controller.openAccounts() }
                    .disabled(!controller.isRunning)
                Button("Training logs") { controller.openLogs() }
            }
            Text("No connection to your live Operations, POS, Accounting, Staff or Inventory systems.")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
        }
        .padding(28)
        .frame(width: 585, height: 320)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear { controller.startIfNeeded() }
        .onDisappear { controller.stop() }
    }
}

final class MacAppLifecycle: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct HiddenOasisMacTrainingApp: App {
    @NSApplicationDelegateAdaptor(MacAppLifecycle.self) var lifecycle

    var body: some Scene {
        WindowGroup("Hidden Oasis Training") {
            TrainingView()
        }
        .windowResizability(.contentSize)
    }
}
