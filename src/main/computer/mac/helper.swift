// Fabro Computer Use — macOS helper (Swift, built as a universal binary and shipped in the app).
// Same JSON-lines protocol as the Windows and Linux helpers: one request per line on stdin, one reply
// per line on stdout, unsolicited {"event":"user","kind":"mouse|keyboard|esc"} when the user takes over.
// Coordinates are global points with the origin at the top-left of the main display (Quartz space).
// Needs Accessibility (input, UI elements, takeover watch) and Screen Recording (screenshots).
import Foundation
import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Vision
import ImageIO

let MAGIC: Int64 = 0x0FAB0FAB
let outLock = NSLock()
func emit(_ d: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: d, options: []) else { return }
    outLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    outLock.unlock()
}
struct Fail: Error { let msg: String }
func num(_ r: [String: Any], _ k: String, _ d: Double = 0) -> Double { (r[k] as? NSNumber)?.doubleValue ?? d }
func int(_ r: [String: Any], _ k: String, _ d: Int = 0) -> Int { Int((num(r, k, Double(d))).rounded()) }
func str(_ r: [String: Any], _ k: String) -> String? { r[k] as? String }
func bool(_ r: [String: Any], _ k: String) -> Bool { (r[k] as? Bool) ?? false }

// ───────────────────────────── screens ─────────────────────────────
func displays() -> [[String: Any]] {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    var out: [[String: Any]] = []
    for (i, id) in ids.enumerated() {
        let b = CGDisplayBounds(id)
        let px = Double(CGDisplayCopyDisplayMode(id)?.pixelWidth ?? Int(b.width))
        out.append(["x": Int(b.minX), "y": Int(b.minY), "w": Int(b.width), "h": Int(b.height), "primary": CGDisplayIsMain(id) != 0,
                    "scale": b.width > 0 ? px / Double(b.width) : 1.0, "name": "Display \(i + 1)", "id": Int(id)])
    }
    return out
}
func virtualRect() -> [Int] {
    var u = CGRect.null
    for d in displays() { u = u.union(CGRect(x: d["x"] as! Int, y: d["y"] as! Int, width: d["w"] as! Int, height: d["h"] as! Int)) }
    return [Int(u.minX), Int(u.minY), Int(u.width), Int(u.height)]
}
func cursor() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

func permissions(prompt: Bool) -> [String: Any] {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    let ax = AXIsProcessTrustedWithOptions(opts)
    var screen = CGPreflightScreenCaptureAccess()
    if prompt && !screen { screen = CGRequestScreenCaptureAccess() }
    return ["accessibility": ax, "screen": screen]
}

func capture(_ r: [String: Any]) throws -> [String: Any] {
    var x = int(r, "x"), y = int(r, "y"), w = int(r, "w"), h = int(r, "h")
    if w <= 0 || h <= 0 { let v = virtualRect(); x = v[0]; y = v[1]; w = v[2]; h = v[3] }
    guard let path = str(r, "path") else { throw Fail(msg: "path missing") }
    try? FileManager.default.removeItem(atPath: path)
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    p.arguments = ["-x", "-R\(x),\(y),\(w),\(h)", "-t", "png"] + (bool(r, "cursor") ? ["-C"] : []) + [path]
    try p.run(); p.waitUntilExit()
    if !FileManager.default.fileExists(atPath: path) { throw Fail(msg: "The screen could not be captured: allow Fabro in System Settings › Privacy & Security › Screen Recording.") }
    let c = cursor()
    return ["x": x, "y": y, "w": w, "h": h, "path": path, "cursor": [Int(c.x), Int(c.y)]]
}

// ───────────────────────────── input ─────────────────────────────
let src: CGEventSource? = { let s = CGEventSource(stateID: .hidSystemState); s?.userData = MAGIC; return s }()
var interrupt: String? = nil
let stateLock = NSLock()
func getInterrupt() -> String? { stateLock.lock(); defer { stateLock.unlock() }; return interrupt }
func setInterrupt(_ k: String?) { stateLock.lock(); interrupt = k; stateLock.unlock() }
var expected = CGPoint(x: -99999, y: -99999)
var buttonsDown = Set<String>()
var mods: CGEventFlags = []
var lastClick: (t: TimeInterval, p: CGPoint, b: String, n: Int) = (0, .zero, "", 0)

func post(_ e: CGEvent?) throws {
    guard let e = e else { throw Fail(msg: "Could not create the input event (is Fabro allowed in Privacy & Security › Accessibility?)") }
    e.setIntegerValueField(.eventSourceUserData, value: MAGIC)
    e.post(tap: .cghidEventTap)
}
func btn(_ b: String?) -> (CGMouseButton, CGEventType, CGEventType, CGEventType, Int64) {
    switch b ?? "left" {
    case "right": return (.right, .rightMouseDown, .rightMouseUp, .rightMouseDragged, 1)
    case "middle": return (.center, .otherMouseDown, .otherMouseUp, .otherMouseDragged, 2)
    case "x1": return (CGMouseButton(rawValue: 3)!, .otherMouseDown, .otherMouseUp, .otherMouseDragged, 3)
    case "x2": return (CGMouseButton(rawValue: 4)!, .otherMouseDown, .otherMouseUp, .otherMouseDragged, 4)
    default: return (.left, .leftMouseDown, .leftMouseUp, .leftMouseDragged, 0)
    }
}
func moveTo(_ p: CGPoint) throws {
    var type = CGEventType.mouseMoved, button = CGMouseButton.left
    if buttonsDown.contains("left") { type = .leftMouseDragged }
    else if buttonsDown.contains("right") { type = .rightMouseDragged; button = .right }
    else if let b = buttonsDown.first { let m = btn(b); type = m.3; button = m.0 }
    let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: button)
    e?.flags = mods
    expected = p
    try post(e)
}
func relMove(_ dx: Int, _ dy: Int) throws {
    let c = cursor(), p = CGPoint(x: c.x + CGFloat(dx), y: c.y + CGFloat(dy))
    let e = CGEvent(mouseEventSource: src, mouseType: buttonsDown.contains("left") ? .leftMouseDragged : .mouseMoved, mouseCursorPosition: p, mouseButton: .left)
    e?.setIntegerValueField(.mouseEventDeltaX, value: Int64(dx))
    e?.setIntegerValueField(.mouseEventDeltaY, value: Int64(dy))
    e?.flags = mods
    expected = p
    try post(e)
}
func button(_ b: String?, down: Bool) throws {
    let name = b ?? "left"
    let m = btn(name), p = cursor(), now = Date().timeIntervalSince1970
    if down {
        let near = abs(p.x - lastClick.p.x) < 5 && abs(p.y - lastClick.p.y) < 5
        let n = (lastClick.b == name && near && now - lastClick.t < NSEvent.doubleClickInterval) ? lastClick.n + 1 : 1
        lastClick = (now, p, name, n)
        buttonsDown.insert(name)
    } else { buttonsDown.remove(name) }
    let e = CGEvent(mouseEventSource: src, mouseType: down ? m.1 : m.2, mouseCursorPosition: p, mouseButton: m.0)
    e?.setIntegerValueField(.mouseEventClickState, value: Int64(lastClick.n))
    if m.4 >= 2 { e?.setIntegerValueField(.mouseEventButtonNumber, value: m.4) }
    e?.flags = mods
    try post(e)
}
func wheel(_ d: Int, horizontal: Bool) throws {
    let lines = Int32((Double(d) / 120.0 * 3.0).rounded())
    let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 2, wheel1: horizontal ? 0 : lines, wheel2: horizontal ? -lines : 0, wheel3: 0)
    e?.flags = mods
    try post(e)
}

// key names (X keysym names, shared with the Linux helper) → macOS virtual key codes
let NAMED: [String: Int] = [
    "Return": kVK_Return, "KP_Enter": kVK_ANSI_KeypadEnter, "Tab": kVK_Tab, "space": kVK_Space, "BackSpace": kVK_Delete, "Escape": kVK_Escape,
    "Delete": kVK_ForwardDelete, "Insert": kVK_Help, "Home": kVK_Home, "End": kVK_End, "Prior": kVK_PageUp, "Next": kVK_PageDown,
    "Left": kVK_LeftArrow, "Right": kVK_RightArrow, "Up": kVK_UpArrow, "Down": kVK_DownArrow,
    "Control_L": kVK_Control, "Shift_L": kVK_Shift, "Alt_L": kVK_Option, "Super_L": kVK_Command, "ISO_Level3_Shift": kVK_RightOption, "Caps_Lock": kVK_CapsLock,
    "F1": kVK_F1, "F2": kVK_F2, "F3": kVK_F3, "F4": kVK_F4, "F5": kVK_F5, "F6": kVK_F6, "F7": kVK_F7, "F8": kVK_F8, "F9": kVK_F9, "F10": kVK_F10,
    "F11": kVK_F11, "F12": kVK_F12, "F13": kVK_F13, "F14": kVK_F14, "F15": kVK_F15, "F16": kVK_F16, "F17": kVK_F17, "F18": kVK_F18, "F19": kVK_F19, "F20": kVK_F20,
    "KP_0": kVK_ANSI_Keypad0, "KP_1": kVK_ANSI_Keypad1, "KP_2": kVK_ANSI_Keypad2, "KP_3": kVK_ANSI_Keypad3, "KP_4": kVK_ANSI_Keypad4,
    "KP_5": kVK_ANSI_Keypad5, "KP_6": kVK_ANSI_Keypad6, "KP_7": kVK_ANSI_Keypad7, "KP_8": kVK_ANSI_Keypad8, "KP_9": kVK_ANSI_Keypad9,
    "KP_Decimal": kVK_ANSI_KeypadDecimal, "KP_Multiply": kVK_ANSI_KeypadMultiply, "KP_Add": kVK_ANSI_KeypadPlus, "KP_Subtract": kVK_ANSI_KeypadMinus, "KP_Divide": kVK_ANSI_KeypadDivide,
    "XF86AudioRaiseVolume": kVK_VolumeUp, "XF86AudioLowerVolume": kVK_VolumeDown, "XF86AudioMute": kVK_Mute,
]
let MODFLAG: [Int: CGEventFlags] = [kVK_Control: .maskControl, kVK_Shift: .maskShift, kVK_Option: .maskAlternate, kVK_RightOption: .maskAlternate, kVK_Command: .maskCommand]

// characters → the key that types them on the user's own layout (AZERTY, QWERTZ…)
var layout: [String: (code: Int, shift: Bool, option: Bool)] = [:]
func buildLayout() {
    layout = [:]
    guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
          let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return }
    let data = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data
    data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
        guard let ptr = buf.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }
        let states: [(UInt32, Bool, Bool)] = [(0, false, false), (UInt32(shiftKey >> 8) & 0xFF, true, false), (UInt32(optionKey >> 8) & 0xFF, false, true), (UInt32((shiftKey | optionKey) >> 8) & 0xFF, true, true)]
        for (m, sh, op) in states {
            for code in 0..<128 {
                var dead: UInt32 = 0, len = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let st = UCKeyTranslate(ptr, UInt16(code), UInt16(kUCKeyActionDown), m, UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysMask), &dead, 4, &len, &chars)
                if st == noErr && len > 0 {
                    let s = String(utf16CodeUnits: chars, count: len)
                    if layout[s] == nil { layout[s] = (code, sh, op) }
                }
            }
        }
    }
}
func keyFor(_ s: [String: Any]) throws -> (code: Int, extra: CGEventFlags) {
    if let ks = str(s, "ks"), let c = NAMED[ks] { return (c, []) }
    let ch = (str(s, "ch") ?? str(s, "ks") ?? "")
    if ch.isEmpty { throw Fail(msg: "No key given") }
    if layout.isEmpty { buildLayout() }
    for cand in [ch, ch.lowercased()] {
        // "A" in a shortcut means the A key; "+" may need shift on this layout
        if let k = layout[cand] {
            var f: CGEventFlags = []
            if cand == ch { if k.shift { f.insert(.maskShift) }; if k.option { f.insert(.maskAlternate) } }
            return (k.code, f)
        }
    }
    throw Fail(msg: "No key types \"\(ch)\" on this keyboard layout")
}
var heldKeys: [Int] = []
func key(_ code: Int, extra: CGEventFlags, down: Bool) throws {
    if let f = MODFLAG[code] { if down { mods.insert(f) } else { mods.remove(f) } }
    let e = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(code), keyDown: down)
    e?.flags = mods.union(extra)
    try post(e)
    if down { heldKeys.append(code) } else { heldKeys.removeAll { $0 == code } }
}
func typeText(_ s: String, msPerChar: Int) throws {
    for ch in s {
        if getInterrupt() != nil { return }
        if ch == "\r" { continue }
        if ch == "\n" { try key(kVK_Return, extra: [], down: true); try key(kVK_Return, extra: [], down: false) }
        else if ch == "\t" { try key(kVK_Tab, extra: [], down: true); try key(kVK_Tab, extra: [], down: false) }
        else {
            let u = Array(String(ch).utf16)
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)
                e?.flags = []
                u.withUnsafeBufferPointer { e?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: $0.baseAddress) }
                try post(e)
            }
        }
        if msPerChar > 0 { sleepMs(Double(msPerChar)) }
    }
}
func sleepMs(_ ms: Double) {
    if ms <= 0 { return }
    let end = Date().addingTimeInterval(ms / 1000)
    while true {
        let left = end.timeIntervalSinceNow
        if left <= 0 { return }
        if left > 0.003 { Thread.sleep(forTimeInterval: left - 0.0015) } else { usleep(200) }
    }
}

func play(_ r: [String: Any]) throws -> [String: Any] {
    var done = 0
    expected = cursor()
    for o in (r["steps"] as? [[String: Any]]) ?? [] {
        // without the event tap, a pointer that is not where Fabro left it means the user moved it
        if watching && !watchingTap { let c = cursor(); if abs(c.x - expected.x) > 6 || abs(c.y - expected.y) > 6 { flag("mouse") } }
        if getInterrupt() != nil { break }
        let t = str(o, "t") ?? ""
        switch t {
        case "move": try moveTo(CGPoint(x: num(o, "x"), y: num(o, "y")))
        case "rel": try relMove(int(o, "dx"), int(o, "dy"))
        case "down": try button(str(o, "b"), down: true)
        case "up": try button(str(o, "b"), down: false)
        case "wheel": try wheel(int(o, "d"), horizontal: bool(o, "h"))
        case "kd": let k = try keyFor(o); try key(k.code, extra: k.extra, down: true)
        case "ku": let k = try keyFor(o); try key(k.code, extra: k.extra, down: false)
        case "text": try typeText(str(o, "s") ?? "", msPerChar: int(o, "ms"))
        case "sleep": break
        default: throw Fail(msg: "unknown step \(t)")
        }
        if t != "text" { sleepMs(num(o, "ms")) }
        done += 1
    }
    // nothing stays pressed
    for b in Array(buttonsDown) { try? button(b, down: false) }
    for k in heldKeys.reversed() { try? key(k, extra: [], down: false) }
    mods = []
    let c = cursor()
    return ["done": done, "interrupted": getInterrupt() ?? NSNull(), "cursor": [Int(c.x), Int(c.y)]]
}

// ───────────────────────────── takeover watch (event tap) ─────────────────────────────
var watching = false, watchingTap = false
var tapLoop: CFRunLoop? = nil
var physDist: CGFloat = 0, lastPhys = CGPoint(x: -99999, y: 0), lastPhysT: TimeInterval = 0
func flag(_ kind: String) {
    if getInterrupt() != nil { return }
    setInterrupt(kind)
    emit(["event": "user", "kind": kind])
}
func startWatch() {
    setInterrupt(nil); physDist = 0; lastPhys = CGPoint(x: -99999, y: 0)
    if watching { return }
    watching = true
    let ready = DispatchSemaphore(value: 0)
    Thread {
        let types: [CGEventType] = [.mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged, .rightMouseDragged, .scrollWheel, .keyDown]
        var mask: CGEventMask = 0
        for t in types { mask |= CGEventMask(1) << CGEventMask(t.rawValue) }
        let tap = CGEvent.tapCreate(tap: .cghidEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, _ in
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { return Unmanaged.passUnretained(event) }
            if event.getIntegerValueField(.eventSourceUserData) == MAGIC { return Unmanaged.passUnretained(event) }
            switch type {
            case .mouseMoved, .leftMouseDragged, .rightMouseDragged:
                let p = event.location, now = Date().timeIntervalSince1970
                let nearExpected = abs(p.x - expected.x) <= 3 && abs(p.y - expected.y) <= 3
                if lastPhys.x > -99999 && now - lastPhysT < 0.4 && !nearExpected { physDist += hypot(p.x - lastPhys.x, p.y - lastPhys.y) }
                else if now - lastPhysT >= 0.4 { physDist = 0 }
                lastPhys = p; lastPhysT = now
                if physDist > 40 { flag("mouse") }
            case .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel: flag("mouse")
            case .keyDown: flag(event.getIntegerValueField(.keyboardEventKeycode) == Int64(kVK_Escape) ? "esc" : "keyboard")
            default: break
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: nil)
        if let tap = tap {
            watchingTap = true
            let rls = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            tapLoop = CFRunLoopGetCurrent()
            CFRunLoopAddSource(tapLoop, rls, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            ready.signal()
            CFRunLoopRun()
            CGEvent.tapEnable(tap: tap, enable: false)
        } else { watchingTap = false; ready.signal() }
    }.start()
    _ = ready.wait(timeout: .now() + 2)
}
func stopWatch() {
    if !watching { return }
    watching = false
    if let l = tapLoop { CFRunLoopStop(l); tapLoop = nil }
    watchingTap = false
}

// ───────────────────────────── windows ─────────────────────────────
func frontPid() -> pid_t {
    let sys = AXUIElementCreateSystemWide()
    var app: AnyObject?
    if AXUIElementCopyAttributeValue(sys, "AXFocusedApplication" as CFString, &app) == .success, let a = app {
        var pid: pid_t = 0; AXUIElementGetPid(a as! AXUIElement, &pid); if pid > 0 { return pid }
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
}
func appName(_ pid: pid_t) -> String { NSRunningApplication(processIdentifier: pid)?.localizedName ?? "" }
func cgWindows() -> [[String: Any]] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list
}
func boundsOf(_ w: [String: Any]) -> CGRect? {
    guard let bd = w[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: bd as CFDictionary)
}
func windows() -> [[String: Any]] {
    let fp = frontPid()
    var out: [[String: Any]] = []
    var seenFocus = false
    for (z, w) in cgWindows().enumerated() {
        guard (w[kCGWindowLayer as String] as? Int) == 0, let pid = w[kCGWindowOwnerPID as String] as? Int,
              let bd = w[kCGWindowBounds as String] as? NSDictionary, let rc = CGRect(dictionaryRepresentation: bd as CFDictionary), rc.width > 40, rc.height > 30 else { continue }
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        let title = (w[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? owner
        let focused = !seenFocus && pid_t(pid) == fp
        if focused { seenFocus = true }
        out.append(["hwnd": w[kCGWindowNumber as String] as? Int ?? 0, "title": title, "cls": "", "pid": pid, "app": owner,
                    "rect": [Int(rc.minX), Int(rc.minY), Int(rc.width), Int(rc.height)], "minimized": false, "maximized": false, "focused": focused, "z": z, "elevated": 0])
    }
    return out
}
func axWindowFor(_ hwnd: Int) -> (AXUIElement, pid_t)? {
    guard let w = cgWindows().first(where: { ($0[kCGWindowNumber as String] as? Int) == hwnd }), let pid = w[kCGWindowOwnerPID as String] as? Int,
          let bd = w[kCGWindowBounds as String] as? NSDictionary, let rc = CGRect(dictionaryRepresentation: bd as CFDictionary) else { return nil }
    let app = AXUIElementCreateApplication(pid_t(pid))
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(app, "AXWindows" as CFString, &v) == .success, let wins = v as? [AXUIElement] else { return nil }
    var best: AXUIElement? = nil, bestD = CGFloat.greatestFiniteMagnitude
    for aw in wins {
        guard let r = frameOf(aw) else { continue }
        let d = abs(r.minX - rc.minX) + abs(r.minY - rc.minY) + abs(r.width - rc.width) + abs(r.height - rc.height)
        if d < bestD { bestD = d; best = aw }
    }
    return best.map { ($0, pid_t(pid)) }
}
func frameOf(_ e: AXUIElement) -> CGRect? {
    var pv: AnyObject?, sv: AnyObject?
    guard AXUIElementCopyAttributeValue(e, "AXPosition" as CFString, &pv) == .success, AXUIElementCopyAttributeValue(e, "AXSize" as CFString, &sv) == .success else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    AXValueGetValue(pv as! AXValue, .cgPoint, &p); AXValueGetValue(sv as! AXValue, .cgSize, &s)
    return CGRect(origin: p, size: s)
}
func windowOp(_ r: [String: Any]) throws -> [String: Any] {
    let hwnd = int(r, "hwnd")
    guard let found = axWindowFor(hwnd) else { throw Fail(msg: "That window no longer exists") }
    let w = found.0, pid = found.1
    switch str(r, "action") ?? "" {
    case "focus", "restore":
        AXUIElementSetAttributeValue(w, "AXMinimized" as CFString, kCFBooleanFalse)
        NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps])
        AXUIElementPerformAction(w, "AXRaise" as CFString)
        AXUIElementSetAttributeValue(w, "AXMain" as CFString, kCFBooleanTrue)
    case "minimize": AXUIElementSetAttributeValue(w, "AXMinimized" as CFString, kCFBooleanTrue)
    case "maximize":
        // fill the visible part of its screen (the green button would switch to full screen)
        let f = frameOf(w) ?? .zero
        let screen = NSScreen.screens.first { s in
            let top = (NSScreen.screens.first?.frame.height ?? 0) - s.frame.maxY
            return CGRect(x: s.frame.minX, y: top, width: s.frame.width, height: s.frame.height).contains(CGPoint(x: f.midX, y: f.midY))
        } ?? NSScreen.main
        if let s = screen {
            let H = NSScreen.screens.first?.frame.height ?? s.frame.height
            let vf = s.visibleFrame
            var p = CGPoint(x: vf.minX, y: H - vf.maxY), sz = CGSize(width: vf.width, height: vf.height)
            if let pv = AXValueCreate(.cgPoint, &p) { AXUIElementSetAttributeValue(w, "AXPosition" as CFString, pv) }
            if let sv = AXValueCreate(.cgSize, &sz) { AXUIElementSetAttributeValue(w, "AXSize" as CFString, sv) }
        }
    case "close":
        var b: AnyObject?
        if AXUIElementCopyAttributeValue(w, "AXCloseButton" as CFString, &b) == .success, let bb = b { AXUIElementPerformAction(bb as! AXUIElement, "AXPress" as CFString) }
    default: throw Fail(msg: "unknown window action")
    }
    Thread.sleep(forTimeInterval: 0.15)
    let f = frameOf(w) ?? .zero
    return ["focused": frontPid() == pid, "rect": [Int(f.minX), Int(f.minY), Int(f.width), Int(f.height)]]
}

// ───────────────────────────── accessibility tree ─────────────────────────────
let ATTRS = ["AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXValue", "AXPosition", "AXSize", "AXEnabled", "AXFocused", "AXChildren", "AXIdentifier", "AXHelp", "AXPlaceholderValue", "AXSelected", "AXExpanded"] as CFArray
let ROLES: [String: String] = ["AXButton": "button", "AXMenuButton": "button", "AXPopUpButton": "combobox", "AXComboBox": "combobox", "AXTextField": "edit", "AXTextArea": "edit",
    "AXStaticText": "text", "AXLink": "hyperlink", "AXCheckBox": "checkbox", "AXRadioButton": "radiobutton", "AXMenuItem": "menuitem", "AXMenuBarItem": "menuitem",
    "AXRow": "listitem", "AXCell": "dataitem", "AXSlider": "slider", "AXIncrementor": "spinner", "AXImage": "image", "AXWebArea": "document", "AXDockItem": "button",
    "AXDisclosureTriangle": "button", "AXColorWell": "button", "AXTab": "tabitem", "AXHeading": "text", "AXProgressIndicator": "progressbar", "AXValueIndicator": "thumb",
    "AXScrollBar": "scrollbar", "AXWindow": "window", "AXSheet": "window", "AXDialog": "window", "AXGroup": "group", "AXToolbar": "toolbar", "AXList": "list", "AXOutline": "tree", "AXTable": "table",
    "AXTabGroup": "tab", "AXMenu": "menu", "AXMenuBar": "menubar", "AXScrollArea": "pane", "AXSplitGroup": "pane", "AXLayoutArea": "pane", "AXSplitter": "separator"]
func axVal(_ v: AnyObject?) -> AnyObject? {
    guard let v = v else { return nil }
    if CFGetTypeID(v) == AXValueGetTypeID() && AXValueGetType(v as! AXValue) == .axError { return nil }
    return v
}
func describe(_ e: AXUIElement, depth: Int, parent: Int, win: String) -> ([String: Any], [AXUIElement]) {
    var values: CFArray?
    var d: [String: Any] = ["depth": depth, "parent": parent, "win": win, "enabled": true]
    guard AXUIElementCopyMultipleAttributeValues(e, ATTRS, AXCopyMultipleAttributeOptions(rawValue: 0), &values) == .success, let arr = values as? [AnyObject] else { d["role"] = "element"; d["name"] = ""; return (d, []) }
    let a = arr.map { axVal($0) }
    let role = a[0] as? String ?? "", sub = a[1] as? String ?? ""
    var r = ROLES[role] ?? String(role.dropFirst(2)).lowercased()
    if role == "AXRadioButton" && sub == "AXTabButton" { r = "tabitem" }
    if role == "AXRow" && sub == "AXOutlineRow" { r = "treeitem" }
    if role == "AXCheckBox" && sub == "AXSwitch" { r = "checkbox" }
    d["role"] = r
    let title = a[2] as? String ?? "", desc = a[3] as? String ?? ""
    var name = !title.isEmpty ? title : desc
    let value = a[4]
    if name.isEmpty && (r == "text") { name = value as? String ?? "" }
    if name.isEmpty, let ph = a[12] as? String { name = ph }
    if name.isEmpty { name = ["AXCloseButton": "Close", "AXMinimizeButton": "Minimize", "AXZoomButton": "Zoom", "AXFullScreenButton": "Full screen"][sub] ?? "" }
    if name.count > 160 { name = String(name.prefix(157)) + "..." }
    d["name"] = name
    if let p = a[5], let s = a[6] {
        var pt = CGPoint.zero, sz = CGSize.zero
        AXValueGetValue(p as! AXValue, .cgPoint, &pt); AXValueGetValue(s as! AXValue, .cgSize, &sz)
        if sz.width > 0 && sz.height > 0 { d["rect"] = [Int(pt.x.rounded()), Int(pt.y.rounded()), Int(sz.width.rounded()), Int(sz.height.rounded())] }
    }
    if let en = a[7] as? Bool { d["enabled"] = en }
    if (a[8] as? Bool) == true { d["focused"] = true }
    if sub == "AXSecureTextField" { d["password"] = true }
    if let id = a[10] as? String, !id.isEmpty, id.count < 80 { d["aid"] = id }
    if let h = a[11] as? String, !h.isEmpty { d["help"] = h.count > 120 ? String(h.prefix(117)) + "..." : h }
    if (a[13] as? Bool) == true { d["selected"] = true }
    // Chromium reports "collapsed" on everything: only where it means something
    if let ex = a[14] as? Bool, ["AXComboBox", "AXPopUpButton", "AXDisclosureTriangle", "AXRow", "AXOutlineRow"].contains(role) { d["expanded"] = ex }
    var acts: [String] = []
    if r == "edit" || r == "combobox" && role == "AXComboBox" { acts.append("edit"); if d["password"] == nil, let v = value as? String, !v.isEmpty { d["value"] = v.count > 200 ? String(v.prefix(197)) + "..." : v } }
    if ["button", "hyperlink", "menuitem", "checkbox", "radiobutton", "tabitem", "combobox"].contains(r) { acts.append("invoke") }
    if r == "checkbox" || r == "radiobutton", let n = value as? NSNumber { d["checked"] = n.intValue == 1 ? "on" : n.intValue == 0 ? "off" : "mixed" }
    if r == "slider" || r == "progressbar" || r == "spinner", let n = value as? NSNumber { d["range"] = (n.doubleValue * 100).rounded() / 100 }
    if r == "combobox", let v = value as? String, !v.isEmpty { d["value"] = v }
    if !acts.isEmpty { d["acts"] = acts }
    return (d, (a[9] as? [AXUIElement]) ?? [])
}
func elements(_ r: [String: Any]) -> [String: Any] {
    let max = int(r, "max", 1500), budget = Double(int(r, "ms", 2200)) / 1000
    let t0 = Date()
    var out: [[String: Any]] = []
    var truncated = false
    let fp = frontPid()
    var roots: [(AXUIElement, String, Int, Int)] = [] // element, label, node cap, depth cap
    let wanted = (r["hwnds"] as? [NSNumber])?.map { $0.intValue } ?? []
    if fp > 0 {
        let app = AXUIElementCreateApplication(fp)
        AXUIElementSetMessagingTimeout(app, 1.0)
        // Chromium / Electron apps only build their accessibility tree when asked
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        var w: AnyObject?
        if let h = wanted.first, let found = axWindowFor(h) { roots.append((found.0, "w\(h)", max, 40)) }
        else if AXUIElementCopyAttributeValue(app, "AXFocusedWindow" as CFString, &w) == .success, let ww = w { roots.append((ww as! AXUIElement, "w", max, 40)) }
        // open menus and pop-ups belong to the app, not to the window
        var kids: AnyObject?
        if AXUIElementCopyAttributeValue(app, "AXChildren" as CFString, &kids) == .success, let ks = kids as? [AXUIElement] {
            for k in ks { var role: AnyObject?; AXUIElementCopyAttributeValue(k, "AXRole" as CFString, &role); if (role as? String) == "AXMenu" { roots.append((k, "w", 200, 6)) } }
        }
        if bool(r, "taskbar") {
            var mb: AnyObject?
            if AXUIElementCopyAttributeValue(app, "AXMenuBar" as CFString, &mb) == .success, let m = mb { roots.append((m as! AXUIElement, "taskbar", 40, 1)) }
        }
    }
    if bool(r, "taskbar"), let dock = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first {
        roots.append((AXUIElementCreateApplication(dock.processIdentifier), "taskbar", 80, 3))
    }
    for (root, label, cap, maxDepth) in roots {
        var q: [(AXUIElement, Int, Int)] = [(root, 0, -1)]
        var count = 0, head = 0
        while head < q.count {
            if Date().timeIntervalSince(t0) > budget || out.count >= max || count >= cap { truncated = true; break }
            let (e, depth, parent) = q[head]; head += 1
            let (d, kids) = describe(e, depth: depth, parent: parent, win: label)
            let idx = out.count; out.append(d); count += 1
            if d["rect"] == nil && depth > 0 && (d["role"] as? String) != "list" { continue }
            if depth >= maxDepth { continue }
            for k in kids { q.append((k, depth + 1, idx)) }
        }
    }
    return ["elements": out, "truncated": truncated, "ms": Int(Date().timeIntervalSince(t0) * 1000)]
}
func pointInfo(_ x: Double, _ y: Double) -> [String: Any] {
    var d: [String: Any] = ["hwnd": 0, "pid": 0, "app": "", "title": ""]
    let sys = AXUIElementCreateSystemWide()
    var el: AXUIElement?
    if AXUIElementCopyElementAtPosition(sys, Float(x), Float(y), &el) == .success, let e = el {
        var pid: pid_t = 0; AXUIElementGetPid(e, &pid)
        d["pid"] = Int(pid); d["app"] = appName(pid)
        d["element"] = describe(e, depth: 0, parent: -1, win: "").0
        if let w = cgWindows().first(where: { win in (win[kCGWindowOwnerPID as String] as? Int) == Int(pid) && (win[kCGWindowLayer as String] as? Int) == 0 && (boundsOf(win)?.contains(CGPoint(x: x, y: y)) ?? false) }) {
            d["hwnd"] = w[kCGWindowNumber as String] as? Int ?? 0; d["title"] = w[kCGWindowName as String] as? String ?? ""
        }
    }
    return d
}
func focused() -> [String: Any] {
    let sys = AXUIElementCreateSystemWide()
    var v: AnyObject?
    guard AXUIElementCopyAttributeValue(sys, "AXFocusedUIElement" as CFString, &v) == .success, let e = v else { return [:] }
    var d = describe(e as! AXUIElement, depth: 0, parent: -1, win: "").0
    var pid: pid_t = 0; AXUIElementGetPid(e as! AXUIElement, &pid)
    d["pid"] = Int(pid); d["app"] = appName(pid)
    return ["element": d]
}

// ───────────────────────────── text recognition (Vision) ─────────────────────────────
func ocr(_ r: [String: Any]) throws -> [String: Any] {
    guard let path = str(r, "path"), let isrc = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(isrc, 0, nil) else { throw Fail(msg: "picture not readable") }
    let scale = num(r, "scale", 1), W = Double(img.width), H = Double(img.height)
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    if #available(macOS 13.0, *) { req.automaticallyDetectsLanguage = true }
    try VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
    var lines: [[String: Any]] = []
    func add(_ t: String, _ rc: CGRect) {
        lines.append(["text": t, "rect": [Int(rc.minX / scale), Int(rc.minY / scale), Int(rc.width / scale), Int(rc.height / scale)]])
    }
    for obs in req.results ?? [] {
        guard let cand = obs.topCandidates(1).first else { continue }
        let s = cand.string
        // words with their boxes; a line is split where two words are far apart (a button and a label)
        var words: [(String, CGRect)] = []
        var i = s.startIndex
        while i < s.endIndex {
            while i < s.endIndex && s[i].isWhitespace { i = s.index(after: i) }
            var j = i
            while j < s.endIndex && !s[j].isWhitespace { j = s.index(after: j) }
            if i < j, let box = try? cand.boundingBox(for: i..<j)?.boundingBox {
                words.append((String(s[i..<j]), CGRect(x: box.minX * W, y: (1 - box.maxY) * H, width: box.width * W, height: box.height * H)))
            }
            i = j
        }
        if words.isEmpty { let b = obs.boundingBox; add(s, CGRect(x: b.minX * W, y: (1 - b.maxY) * H, width: b.width * W, height: b.height * H)); continue }
        var cur: (String, CGRect)? = nil
        for (t, rc) in words {
            if let c = cur, rc.minX - c.1.maxX > max(18, 1.3 * max(rc.height, c.1.height)) { add(c.0, c.1); cur = nil }
            cur = cur.map { ($0.0 + " " + t, $0.1.union(rc)) } ?? (t, rc)
        }
        if let c = cur { add(c.0, c.1) }
    }
    return ["lines": lines, "lang": "vision"]
}

// ───────────────────────────── main loop ─────────────────────────────
func dispatch(_ op: String, _ r: [String: Any]) throws -> [String: Any] {
    switch op {
    case "hello":
        return ["pid": Int(ProcessInfo.processInfo.processIdentifier), "monitors": displays(), "virtual": virtualRect(), "elevated": false,
                "os": ProcessInfo.processInfo.operatingSystemVersionString, "permissions": permissions(prompt: false)]
    case "permissions": return permissions(prompt: bool(r, "prompt"))
    case "capture": return try capture(r)
    case "cursor": let c = cursor(); return ["x": Int(c.x), "y": Int(c.y)]
    case "play": return try play(r)
    case "watch": if bool(r, "on") { startWatch() } else { stopWatch() }; return ["watching": watching, "tap": watchingTap]
    case "resume": setInterrupt(nil); return [:]
    case "windows": return ["windows": windows()]
    case "window": return try windowOp(r)
    case "elements": return elements(r)
    case "point": return pointInfo(num(r, "x"), num(r, "y"))
    case "focused": return focused()
    case "ocr": return try ocr(r)
    default: throw Fail(msg: "unknown op \(op)")
    }
}

Thread {
    emit(["event": "ready", "pid": Int(ProcessInfo.processInfo.processIdentifier)])
    while let line = readLine() {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        var id: Any = NSNull()
        do {
            guard let data = line.data(using: .utf8), let r = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Fail(msg: "bad request") }
            id = r["id"] ?? NSNull()
            var res = try dispatch(r["op"] as? String ?? "", r)
            res["id"] = id; res["ok"] = true
            emit(res)
        } catch let f as Fail {
            emit(["id": id, "ok": false, "error": f.msg])
        } catch {
            emit(["id": id, "ok": false, "error": "\(error)"])
        }
    }
    stopWatch()
    exit(0)
}.start()
RunLoop.main.run()
