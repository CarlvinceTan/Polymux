import AppKit

guard CommandLine.arguments.count == 2 else { exit(2) }
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let configuration = NSWorkspace.OpenConfiguration()
configuration.activates = false
configuration.addsToRecentItems = false
configuration.createsNewApplicationInstance = true
NSWorkspace.shared.openApplication(at: destination, configuration: configuration) { application, error in
    guard let application, error == nil else {
        FileHandle.standardError.write(Data("Background application launch failed\n".utf8))
        exit(1)
    }
    print(application.processIdentifier)
    exit(0)
}
RunLoop.main.run()
