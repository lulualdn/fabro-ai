// Fabro Computer Use — Windows helper (compiled on first use with the .NET Framework csc, C# 5).
// One JSON request per line on stdin, one JSON reply per line on stdout. Unsolicited lines
// {"event":"user","kind":"mouse|keyboard|esc"} report that the user physically took over.
// Everything is in physical pixels (per-monitor DPI aware), over the whole virtual desktop.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace FabroCU
{
    public static class Host
    {
        // ───────────────────────────── Win32 ─────────────────────────────
        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
        [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
        [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
        [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
        [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }

        delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rc, IntPtr data);

        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
        [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern short VkKeyScan(char ch);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
        [DllImport("user32.dll")] static extern IntPtr CopyIcon(IntPtr h);
        [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
        [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
        [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int w, int h, int step, IntPtr brush, int flags);
        [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint thread);
        [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
        [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern IntPtr GetMessageExtraInfo();
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr hMon, int type, out uint dx, out uint dy);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
        [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr tok);
        [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr tok, int cls, out int info, int len, out int ret);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
        [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint p);

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint MOVE = 0x0001, LDOWN = 0x0002, LUP = 0x0004, RDOWN = 0x0008, RUP = 0x0010, MDOWN = 0x0020, MUP = 0x0040, XDOWN = 0x0080, XUP = 0x0100, WHEEL = 0x0800, HWHEEL = 0x1000, VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;
        const uint KEY_EXT = 0x0001, KEY_UP = 0x0002, KEY_UNICODE = 0x0004, KEY_SCAN = 0x0008;
        static readonly IntPtr MAGIC = new IntPtr(0x0FAB0FAB); // marks Fabro's own injected input
        static readonly object outLock = new object();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer();

        // ───────────────────────────── entry ─────────────────────────────
        public static int Main(string[] argv)
        {
            try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { try { SetProcessDPIAware(); } catch { } }
            try { timeBeginPeriod(1); } catch { }
            json.MaxJsonLength = int.MaxValue;
            Console.InputEncoding = new UTF8Encoding(false);
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;
            Console.SetOut(stdout);
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            Write(new Dictionary<string, object> { { "event", "ready" }, { "pid", Process.GetCurrentProcess().Id } });
            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                object id = null;
                try
                {
                    var req = (Dictionary<string, object>)json.DeserializeObject(line);
                    id = req.ContainsKey("id") ? req["id"] : null;
                    var res = Dispatch(Str(req, "op"), req);
                    res["id"] = id; res["ok"] = true;
                    Write(res);
                }
                catch (Exception e)
                {
                    Write(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", e.GetType().Name + ": " + e.Message } });
                }
            }
            StopWatch();
            return 0;
        }

        static void Write(Dictionary<string, object> d)
        {
            string s = json.Serialize(d);
            lock (outLock) { Console.Out.WriteLine(s); }
        }

        static Dictionary<string, object> Dispatch(string op, Dictionary<string, object> r)
        {
            switch (op)
            {
                case "hello": return Hello();
                case "capture": return Capture(r);
                case "cursor": { POINT p; GetCursorPos(out p); return D("x", p.X, "y", p.Y); }
                case "play": return Play(r);
                case "watch": if (Bool(r, "on")) StartWatch(); else StopWatch(); return D("watching", watching);
                case "resume": interrupt = null; return D();
                case "windows": return D("windows", Windows());
                case "window": return WindowOp(r);
                case "elements": return Elements(r);
                case "point": return PointInfo(Int(r, "x"), Int(r, "y"));
                case "focused": return Focused();
                case "toplevel": return D("windows", TopLevel());
                default: throw new Exception("unknown op " + op);
            }
        }

        // ───────────────────────────── helpers ─────────────────────────────
        static Dictionary<string, object> D(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            return d;
        }
        static string Str(Dictionary<string, object> r, string k) { object v; return r.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; }
        static int Int(Dictionary<string, object> r, string k) { object v; return r.TryGetValue(k, out v) && v != null ? (int)Math.Round(Convert.ToDouble(v)) : 0; }
        static int IntOr(Dictionary<string, object> r, string k, int def) { object v; return r.TryGetValue(k, out v) && v != null ? (int)Math.Round(Convert.ToDouble(v)) : def; }
        static bool Bool(Dictionary<string, object> r, string k) { object v; return r.TryGetValue(k, out v) && v is bool && (bool)v; }
        static long HwndOf(Dictionary<string, object> r) { object v; return r.TryGetValue("hwnd", out v) && v != null ? Convert.ToInt64(v) : 0; }
        static int[] Rect(RECT r) { return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top }; }

        // ───────────────────────────── screens ─────────────────────────────
        static Dictionary<string, object> Hello()
        {
            var mons = new List<object>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr h, IntPtr dc, ref RECT rc, IntPtr data)
            {
                var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
                GetMonitorInfo(h, ref mi);
                uint dx = 96, dy = 96; try { GetDpiForMonitor(h, 0, out dx, out dy); } catch { }
                mons.Add(D("x", mi.rcMonitor.Left, "y", mi.rcMonitor.Top, "w", mi.rcMonitor.Right - mi.rcMonitor.Left, "h", mi.rcMonitor.Bottom - mi.rcMonitor.Top,
                    "work", Rect(mi.rcWork), "primary", (mi.dwFlags & 1) != 0, "scale", dx / 96.0, "name", mi.szDevice));
                return true;
            }, IntPtr.Zero);
            return D("pid", Process.GetCurrentProcess().Id, "monitors", mons,
                "virtual", new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) },
                "elevated", Elevated((uint)Process.GetCurrentProcess().Id) == 1, "os", Environment.OSVersion.VersionString);
        }

        static Dictionary<string, object> Capture(Dictionary<string, object> r)
        {
            int x = Int(r, "x"), y = Int(r, "y"), w = Int(r, "w"), h = Int(r, "h");
            if (w <= 0 || h <= 0) { x = GetSystemMetrics(76); y = GetSystemMetrics(77); w = GetSystemMetrics(78); h = GetSystemMetrics(79); }
            string path = Str(r, "path");
            using (var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
                    if (!r.ContainsKey("cursor") || Bool(r, "cursor")) DrawCursor(g, x, y);
                }
                bmp.Save(path, ImageFormat.Png);
            }
            POINT p; GetCursorPos(out p);
            return D("x", x, "y", y, "w", w, "h", h, "path", path, "cursor", new int[] { p.X, p.Y });
        }

        static void DrawCursor(Graphics g, int ox, int oy)
        {
            var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
            if (!GetCursorInfo(ref ci) || ci.flags != 1) return;
            IntPtr ic = CopyIcon(ci.hCursor); if (ic == IntPtr.Zero) return;
            ICONINFO ii;
            if (GetIconInfo(ic, out ii))
            {
                IntPtr dc = g.GetHdc();
                try { DrawIconEx(dc, ci.ptScreenPos.X - ii.xHotspot - ox, ci.ptScreenPos.Y - ii.yHotspot - oy, ic, 0, 0, 0, IntPtr.Zero, 3); }
                finally { g.ReleaseHdc(dc); }
                if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
                if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
            }
            DestroyIcon(ic);
        }

        // ───────────────────────────── input ─────────────────────────────
        static volatile string interrupt = null;     // set by the hooks when the user takes over
        static int expX = int.MinValue, expY = int.MinValue; // where Fabro last put the cursor

        static void Send(INPUT i)
        {
            var arr = new INPUT[] { i };
            if (SendInput(1, arr, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("SendInput was blocked (error " + Marshal.GetLastWin32Error() + "). The target may run as administrator.");
        }
        static INPUT Mouse(uint flags, int dx, int dy, uint data)
        {
            var i = new INPUT(); i.type = INPUT_MOUSE;
            i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags; i.u.mi.dwExtraInfo = MAGIC;
            return i;
        }
        static void MoveTo(int x, int y)
        {
            int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = Math.Max(1, GetSystemMetrics(78)), vh = Math.Max(1, GetSystemMetrics(79));
            // centre of the target pixel, normalised to 0..65535 over the virtual desktop
            int nx = (int)Math.Round(((x - vx) + 0.5) * 65536.0 / vw);
            int ny = (int)Math.Round(((y - vy) + 0.5) * 65536.0 / vh);
            expX = x; expY = y;
            Send(Mouse(MOVE | ABSOLUTE | VIRTUALDESK, Math.Max(0, Math.Min(65535, nx)), Math.Max(0, Math.Min(65535, ny)), 0));
        }
        static void Button(string b, bool down)
        {
            uint f; uint data = 0;
            switch (b ?? "left")
            {
                case "right": f = down ? RDOWN : RUP; break;
                case "middle": f = down ? MDOWN : MUP; break;
                case "x1": f = down ? XDOWN : XUP; data = 1; break;
                case "x2": f = down ? XDOWN : XUP; data = 2; break;
                default: f = down ? LDOWN : LUP; break;
            }
            Send(Mouse(f, 0, 0, data));
        }
        static void Key(int vk, bool ext, bool up)
        {
            var i = new INPUT(); i.type = INPUT_KEYBOARD;
            uint scan = MapVirtualKey((uint)vk, 4); // MAPVK_VK_TO_VSC_EX (0xE0 prefix for extended keys)
            if (scan == 0) scan = MapVirtualKey((uint)vk, 0);
            if ((scan & 0xFF00) == 0xE000 || (scan & 0xFF00) == 0xE100) ext = true;
            // Scan codes reach games and raw-input apps; the virtual key keeps every other app happy.
            i.u.ki.wVk = (ushort)vk; i.u.ki.wScan = (ushort)(scan & 0xFF);
            i.u.ki.dwFlags = (up ? KEY_UP : 0) | (ext ? KEY_EXT : 0);
            i.u.ki.dwExtraInfo = MAGIC;
            Send(i);
        }
        // A key given as a character ("+", "é", ";") is the key that types it on the user's own layout.
        static int VkOf(Dictionary<string, object> s)
        {
            string ch = Str(s, "ch");
            if (!string.IsNullOrEmpty(ch)) { short r = VkKeyScan(ch[0]); if (r != -1) return r & 0xFF; throw new Exception("No key types \"" + ch + "\" on this keyboard layout"); }
            return Int(s, "vk");
        }
        static void Unicode(char c, bool up)
        {
            var i = new INPUT(); i.type = INPUT_KEYBOARD;
            i.u.ki.wVk = 0; i.u.ki.wScan = c; i.u.ki.dwFlags = KEY_UNICODE | (up ? KEY_UP : 0); i.u.ki.dwExtraInfo = MAGIC;
            Send(i);
        }
        static void TypeText(string s, int msPerChar)
        {
            for (int k = 0; k < s.Length; k++)
            {
                if (interrupt != null) return;
                char c = s[k];
                if (c == '\r') continue;
                if (c == '\n') { Key(0x0D, false, false); Key(0x0D, false, true); }
                else if (c == '\t') { Key(0x09, false, false); Key(0x09, false, true); }
                else if (char.IsHighSurrogate(c) && k + 1 < s.Length) { Unicode(c, false); Unicode(s[k + 1], false); Unicode(c, true); Unicode(s[k + 1], true); k++; }
                else { Unicode(c, false); Unicode(c, true); }
                if (msPerChar > 0) Wait(msPerChar);
            }
        }

        static readonly Stopwatch clock = Stopwatch.StartNew();
        static void Wait(double ms)
        {
            if (ms <= 0) return;
            double end = clock.Elapsed.TotalMilliseconds + ms;
            while (true)
            {
                double left = end - clock.Elapsed.TotalMilliseconds;
                if (left <= 0) return;
                if (left > 2.5) Thread.Sleep((int)(left - 1.5)); else Thread.SpinWait(200);
            }
        }

        // Play a list of steps with precise timing. Stops at once if the user takes over.
        static Dictionary<string, object> Play(Dictionary<string, object> r)
        {
            var steps = r["steps"] as IEnumerable;
            int done = 0;
            var held = new List<object[]>(); // buttons / keys still down (released if interrupted)
            if (steps != null) foreach (object o in steps)
            {
                if (interrupt != null) break;
                var s = (Dictionary<string, object>)o;
                string t = Str(s, "t");
                switch (t)
                {
                    case "move": MoveTo(Int(s, "x"), Int(s, "y")); break;
                    case "rel": Send(Mouse(MOVE, Int(s, "dx"), Int(s, "dy"), 0)); { POINT p; GetCursorPos(out p); expX = p.X; expY = p.Y; } break;
                    case "down": Button(Str(s, "b"), true); held.Add(new object[] { "b", Str(s, "b") }); break;
                    case "up": Button(Str(s, "b"), false); held.RemoveAll(delegate (object[] h) { return (string)h[0] == "b" && (string)h[1] == Str(s, "b"); }); break;
                    case "wheel": Send(Mouse(Bool(s, "h") ? HWHEEL : WHEEL, 0, 0, unchecked((uint)Int(s, "d")))); break;
                    case "kd": { int vk = VkOf(s); Key(vk, Bool(s, "ext"), false); held.Add(new object[] { "k", vk, Bool(s, "ext") }); } break;
                    case "ku": { int vk = VkOf(s); Key(vk, Bool(s, "ext"), true); held.RemoveAll(delegate (object[] h) { return (string)h[0] == "k" && (int)h[1] == vk; }); } break;
                    case "text": TypeText(Str(s, "s") ?? "", IntOr(s, "ms", 0)); break;
                    case "sleep": break;
                    default: throw new Exception("unknown step " + t);
                }
                Wait(Convert.ToDouble(s.ContainsKey("ms") && t != "text" ? s["ms"] : 0));
                done++;
            }
            // whatever happened, nothing stays pressed
            for (int k = held.Count - 1; k >= 0; k--)
            {
                try { if ((string)held[k][0] == "b") Button((string)held[k][1], false); else Key((int)held[k][1], (bool)held[k][2], true); } catch { }
            }
            POINT c; GetCursorPos(out c);
            // absolute moves can land one pixel off on odd DPI layouts: snap to the exact target
            if (interrupt == null && expX != int.MinValue && (Math.Abs(c.X - expX) > 0 || Math.Abs(c.Y - expY) > 0) && Math.Abs(c.X - expX) <= 3 && Math.Abs(c.Y - expY) <= 3) { SetCursorPos(expX, expY); c.X = expX; c.Y = expY; }
            return D("done", done, "interrupted", interrupt, "cursor", new int[] { c.X, c.Y });
        }

        // ───────────────────────────── takeover watch (low-level hooks) ─────────────────────────────
        static volatile bool watching = false;
        static uint hookThread = 0;
        static HookProc mouseProc, keyProc; // kept alive: the hooks call into them
        static double physDist = 0; static int lastPX = int.MinValue, lastPY = int.MinValue; static long lastPT = 0;

        static void Flag(string kind)
        {
            if (interrupt != null) return;
            interrupt = kind;
            Write(D("event", "user", "kind", kind));
        }
        static IntPtr OnMouse(int code, IntPtr w, IntPtr l)
        {
            if (code >= 0)
            {
                var m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
                bool injected = (m.flags & 1) != 0 || m.dwExtraInfo == MAGIC;
                if (!injected)
                {
                    int msg = w.ToInt32();
                    if (msg == 0x0200) // move: only a real, deliberate movement counts (not a bumped desk)
                    {
                        bool nearExpected = expX != int.MinValue && Math.Abs(m.pt.X - expX) <= 3 && Math.Abs(m.pt.Y - expY) <= 3;
                        long now = clock.ElapsedMilliseconds;
                        if (lastPX != int.MinValue && now - lastPT < 400 && !nearExpected) physDist += Math.Sqrt(Math.Pow(m.pt.X - lastPX, 2) + Math.Pow(m.pt.Y - lastPY, 2));
                        else if (now - lastPT >= 400) physDist = 0;
                        lastPX = m.pt.X; lastPY = m.pt.Y; lastPT = now;
                        if (physDist > 40) Flag("mouse");
                    }
                    else if (msg == 0x0201 || msg == 0x0204 || msg == 0x0207 || msg == 0x020A || msg == 0x020E || msg == 0x020B) Flag("mouse");
                }
            }
            return CallNextHookEx(IntPtr.Zero, code, w, l);
        }
        static IntPtr OnKey(int code, IntPtr w, IntPtr l)
        {
            if (code >= 0)
            {
                var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(KBDLLHOOKSTRUCT));
                bool injected = (k.flags & 0x10) != 0 || k.dwExtraInfo == MAGIC;
                int msg = w.ToInt32();
                if (!injected && (msg == 0x0100 || msg == 0x0104)) Flag(k.vkCode == 0x1B ? "esc" : "keyboard");
            }
            return CallNextHookEx(IntPtr.Zero, code, w, l);
        }
        static void StartWatch()
        {
            interrupt = null; physDist = 0; lastPX = int.MinValue;
            if (watching) return;
            watching = true;
            var ready = new ManualResetEvent(false);
            var th = new Thread(delegate ()
            {
                hookThread = GetCurrentThreadId();
                mouseProc = OnMouse; keyProc = OnKey;
                IntPtr mod = GetModuleHandle(null);
                IntPtr hm = SetWindowsHookEx(14, mouseProc, mod, 0);
                IntPtr hk = SetWindowsHookEx(13, keyProc, mod, 0);
                ready.Set();
                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
                if (hm != IntPtr.Zero) UnhookWindowsHookEx(hm);
                if (hk != IntPtr.Zero) UnhookWindowsHookEx(hk);
            });
            th.IsBackground = true; th.Start();
            ready.WaitOne(2000);
        }
        static void StopWatch()
        {
            if (!watching) return;
            watching = false;
            if (hookThread != 0) PostThreadMessage(hookThread, 0x0012, IntPtr.Zero, IntPtr.Zero); // WM_QUIT
            hookThread = 0;
        }

        // ───────────────────────────── windows ─────────────────────────────
        static readonly Dictionary<uint, string> procNames = new Dictionary<uint, string>();
        static string ProcName(uint pid)
        {
            string n;
            if (procNames.TryGetValue(pid, out n)) return n;
            try { n = Process.GetProcessById((int)pid).ProcessName; } catch { n = ""; }
            procNames[pid] = n; return n;
        }
        // 1 elevated, 0 not, -1 unknown (access denied usually means elevated)
        static int Elevated(uint pid)
        {
            IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return -1;
            try
            {
                IntPtr tok; if (!OpenProcessToken(p, 0x0008, out tok)) return -1;
                try { int v, ret; return GetTokenInformation(tok, 20, out v, 4, out ret) ? (v != 0 ? 1 : 0) : -1; } finally { CloseHandle(tok); }
            }
            finally { CloseHandle(p); }
        }
        static int[] Bounds(IntPtr h)
        {
            RECT r;
            if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0) return Rect(r);
            GetWindowRect(h, out r); return Rect(r);
        }
        static List<object> Windows()
        {
            var list = new List<object>();
            IntPtr fg = GetForegroundWindow();
            IntPtr fgRoot = fg == IntPtr.Zero ? IntPtr.Zero : GetAncestor(fg, 3);
            int z = 0;
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                if (!IsWindowVisible(h)) return true;
                int len = GetWindowTextLength(h); if (len == 0) return true;
                int ex = GetWindowLong(h, -20);
                if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true; // tool windows
                int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
                var sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
                var cls = new StringBuilder(256); GetClassName(h, cls, 256);
                uint pid; GetWindowThreadProcessId(h, out pid);
                int[] b = Bounds(h);
                if (b[2] <= 1 || b[3] <= 1) return true;
                list.Add(D("hwnd", h.ToInt64(), "title", sb.ToString(), "cls", cls.ToString(), "pid", (long)pid, "app", ProcName(pid), "rect", b,
                    "minimized", IsIconic(h), "maximized", IsZoomed(h), "focused", h == fg || h == fgRoot, "z", z++, "elevated", Elevated(pid)));
                return true;
            }, IntPtr.Zero);
            // an open menu or pop-up is the foreground window: its app's window is still the active one
            bool any = false; foreach (Dictionary<string, object> w in list) if ((bool)w["focused"]) any = true;
            if (!any && fg != IntPtr.Zero)
            {
                uint fpid; GetWindowThreadProcessId(fg, out fpid);
                foreach (Dictionary<string, object> w in list) if ((long)w["pid"] == fpid && !(bool)w["minimized"]) { w["focused"] = true; break; }
            }
            return list;
        }
        // every visible top-level window, for diagnosis
        static List<object> TopLevel()
        {
            var list = new List<object>();
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                if (!IsWindowVisible(h)) return true;
                var cls = new StringBuilder(128); GetClassName(h, cls, 128);
                var t = new StringBuilder(128); GetWindowText(h, t, 128);
                uint pid; GetWindowThreadProcessId(h, out pid);
                list.Add(D("hwnd", h.ToInt64(), "cls", cls.ToString(), "title", t.ToString(), "pid", (long)pid, "app", ProcName(pid), "rect", Bounds(h), "style", GetWindowLong(h, -16), "ex", GetWindowLong(h, -20)));
                return true;
            }, IntPtr.Zero);
            return list;
        }
        static Dictionary<string, object> WindowOp(Dictionary<string, object> r)
        {
            IntPtr h = new IntPtr(HwndOf(r));
            if (!IsWindow(h)) throw new Exception("That window no longer exists");
            switch (Str(r, "action"))
            {
                case "focus":
                    if (IsIconic(h)) ShowWindow(h, 9);
                    if (GetAncestor(GetForegroundWindow(), 3) == GetAncestor(h, 3)) break;
                    // Windows only lets the foreground app give the focus away: borrow its input queue.
                    {
                        uint pidDummy; IntPtr fgw = GetForegroundWindow();
                        uint fgThread = fgw == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fgw, out pidDummy), me = GetCurrentThreadId();
                        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
                        BringWindowToTop(h); SetForegroundWindow(h);
                        if (attached) AttachThreadInput(me, fgThread, false);
                    }
                    Thread.Sleep(80);
                    if (GetAncestor(GetForegroundWindow(), 3) != GetAncestor(h, 3))
                    {
                        // Alt held with an unused key in between: unlocks the focus without opening the app's menu bar
                        // (a bare Alt tap would, and the next letters typed would become menu commands)
                        Key(0x12, false, false); Key(0x07, false, false); Key(0x07, false, true); Key(0x12, false, true);
                        SetForegroundWindow(h); Thread.Sleep(80);
                    }
                    if (GetAncestor(GetForegroundWindow(), 3) != GetAncestor(h, 3)) { ShowWindow(h, 6); ShowWindow(h, 9); SetForegroundWindow(h); Thread.Sleep(80); }
                    break;
                case "minimize": ShowWindow(h, 6); break;
                case "maximize": ShowWindow(h, 3); break;
                case "restore": ShowWindow(h, 9); break;
                case "close": PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); break;
                default: throw new Exception("unknown window action");
            }
            return D("focused", GetAncestor(GetForegroundWindow(), 3) == GetAncestor(h, 3), "rect", Bounds(h));
        }

        // ───────────────────────────── UI Automation ─────────────────────────────
        static CacheRequest req;
        static AutomationProperty[] valueProps;
        static CacheRequest Req()
        {
            if (req != null) return req;
            req = new CacheRequest();
            req.TreeScope = TreeScope.Element | TreeScope.Children;
            req.TreeFilter = Automation.ControlViewCondition;
            req.AutomationElementMode = AutomationElementMode.Full;
            valueProps = new AutomationProperty[] { ValuePattern.ValueProperty, TogglePattern.ToggleStateProperty, ExpandCollapsePattern.ExpandCollapseStateProperty, SelectionItemPattern.IsSelectedProperty, RangeValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty };
            var props = new AutomationProperty[] { AutomationElement.NameProperty, AutomationElement.ControlTypeProperty, AutomationElement.BoundingRectangleProperty, AutomationElement.IsEnabledProperty,
                AutomationElement.IsOffscreenProperty, AutomationElement.HasKeyboardFocusProperty, AutomationElement.IsKeyboardFocusableProperty, AutomationElement.AutomationIdProperty,
                AutomationElement.ClassNameProperty, AutomationElement.IsPasswordProperty, AutomationElement.HelpTextProperty, AutomationElement.ProcessIdProperty,
                AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsValuePatternAvailableProperty, AutomationElement.IsTogglePatternAvailableProperty,
                AutomationElement.IsSelectionItemPatternAvailableProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty, AutomationElement.IsTextPatternAvailableProperty };
            foreach (var p in props) req.Add(p);
            foreach (var p in valueProps) req.Add(p);
            return req;
        }
        static object Cached(AutomationElement e, AutomationProperty p)
        {
            try { object v = e.GetCachedPropertyValue(p, true); return v == AutomationElement.NotSupported ? null : v; } catch { return null; }
        }
        static string Role(ControlType ct)
        {
            if (ct == null) return "element";
            string n = ct.ProgrammaticName; int dot = n.LastIndexOf('.');
            return (dot >= 0 ? n.Substring(dot + 1) : n).ToLowerInvariant();
        }
        static Dictionary<string, object> Describe(AutomationElement e, int depth, int parent, string win)
        {
            var d = new Dictionary<string, object>();
            var ct = Cached(e, AutomationElement.ControlTypeProperty) as ControlType;
            d["role"] = Role(ct);
            string name = Cached(e, AutomationElement.NameProperty) as string ?? "";
            if (name.Length > 160) name = name.Substring(0, 157) + "...";
            d["name"] = name;
            object br = Cached(e, AutomationElement.BoundingRectangleProperty);
            if (br is System.Windows.Rect)
            {
                var rc = (System.Windows.Rect)br;
                if (!rc.IsEmpty && !double.IsInfinity(rc.Width)) d["rect"] = new int[] { (int)Math.Round(rc.X), (int)Math.Round(rc.Y), (int)Math.Round(rc.Width), (int)Math.Round(rc.Height) };
            }
            d["enabled"] = !(Cached(e, AutomationElement.IsEnabledProperty) is bool) || (bool)Cached(e, AutomationElement.IsEnabledProperty);
            if (Cached(e, AutomationElement.HasKeyboardFocusProperty) is bool && (bool)Cached(e, AutomationElement.HasKeyboardFocusProperty)) d["focused"] = true;
            if (Cached(e, AutomationElement.IsKeyboardFocusableProperty) is bool && (bool)Cached(e, AutomationElement.IsKeyboardFocusableProperty)) d["focusable"] = true;
            if (Cached(e, AutomationElement.IsPasswordProperty) is bool && (bool)Cached(e, AutomationElement.IsPasswordProperty)) d["password"] = true;
            if (Cached(e, AutomationElement.IsOffscreenProperty) is bool && (bool)Cached(e, AutomationElement.IsOffscreenProperty)) d["offscreen"] = true;
            string aid = Cached(e, AutomationElement.AutomationIdProperty) as string; if (!string.IsNullOrEmpty(aid) && aid.Length < 80) d["aid"] = aid;
            string cls = Cached(e, AutomationElement.ClassNameProperty) as string; if (!string.IsNullOrEmpty(cls) && cls.Length < 80) d["cls"] = cls;
            string help = Cached(e, AutomationElement.HelpTextProperty) as string; if (!string.IsNullOrEmpty(help)) d["help"] = help.Length > 120 ? help.Substring(0, 117) + "..." : help;
            var acts = new List<string>();
            if (Cached(e, AutomationElement.IsInvokePatternAvailableProperty) is bool && (bool)Cached(e, AutomationElement.IsInvokePatternAvailableProperty)) acts.Add("invoke");
            if (Cached(e, AutomationElement.IsValuePatternAvailableProperty) is bool && (bool)Cached(e, AutomationElement.IsValuePatternAvailableProperty))
            {
                acts.Add(Cached(e, ValuePattern.IsReadOnlyProperty) is bool && (bool)Cached(e, ValuePattern.IsReadOnlyProperty) ? "readonly" : "edit");
                string v = Cached(e, ValuePattern.ValueProperty) as string;
                if (!string.IsNullOrEmpty(v) && !d.ContainsKey("password")) d["value"] = v.Length > 200 ? v.Substring(0, 197) + "..." : v;
            }
            if (Cached(e, AutomationElement.IsTogglePatternAvailableProperty) is bool && (bool)Cached(e, AutomationElement.IsTogglePatternAvailableProperty))
            {
                object ts = Cached(e, TogglePattern.ToggleStateProperty);
                if (ts is ToggleState) d["checked"] = (ToggleState)ts == ToggleState.On ? "on" : (ToggleState)ts == ToggleState.Off ? "off" : "mixed";
            }
            if (Cached(e, AutomationElement.IsExpandCollapsePatternAvailableProperty) is bool && (bool)Cached(e, AutomationElement.IsExpandCollapsePatternAvailableProperty))
            {
                object es = Cached(e, ExpandCollapsePattern.ExpandCollapseStateProperty);
                if (es is ExpandCollapseState && (ExpandCollapseState)es != ExpandCollapseState.LeafNode) d["expanded"] = (ExpandCollapseState)es == ExpandCollapseState.Expanded || (ExpandCollapseState)es == ExpandCollapseState.PartiallyExpanded;
            }
            if (Cached(e, AutomationElement.IsSelectionItemPatternAvailableProperty) is bool && (bool)Cached(e, AutomationElement.IsSelectionItemPatternAvailableProperty))
            {
                object sel = Cached(e, SelectionItemPattern.IsSelectedProperty); if (sel is bool && (bool)sel) d["selected"] = true;
            }
            object rv = Cached(e, RangeValuePattern.ValueProperty); if (rv is double) d["range"] = Math.Round((double)rv, 2);
            // editors without a value (RichEdit, Word, code editors): read the start of their text
            if (!d.ContainsKey("value") && !d.ContainsKey("password") && (d["role"] as string == "document" || d["role"] as string == "edit")
                && Cached(e, AutomationElement.IsTextPatternAvailableProperty) is bool && (bool)Cached(e, AutomationElement.IsTextPatternAvailableProperty))
            {
                try
                {
                    var tp = e.GetCurrentPattern(TextPattern.Pattern) as TextPattern;
                    if (tp != null) { string tx = tp.DocumentRange.GetText(300); if (!string.IsNullOrEmpty(tx)) d["value"] = tx.Length >= 300 ? tx.Substring(0, 297) + "..." : tx; }
                    if (!acts.Contains("edit")) acts.Add("edit");
                }
                catch { }
            }
            if (acts.Count > 0) d["acts"] = acts;
            d["depth"] = depth; d["parent"] = parent; d["win"] = win;
            return d;
        }

        // Walk the visible UI of a few windows, breadth first, within a node and time budget.
        static Dictionary<string, object> Elements(Dictionary<string, object> r)
        {
            int max = IntOr(r, "max", 1500), budget = IntOr(r, "ms", 2200);
            var roots = new List<KeyValuePair<IntPtr, string>>();
            object hs; if (r.TryGetValue("hwnds", out hs) && hs is IEnumerable)
                foreach (object o in (IEnumerable)hs) roots.Add(new KeyValuePair<IntPtr, string>(new IntPtr(Convert.ToInt64(o)), "w" + Convert.ToInt64(o)));
            if (roots.Count == 0) { IntPtr fg = GetAncestor(GetForegroundWindow(), 3); if (fg != IntPtr.Zero) roots.Add(new KeyValuePair<IntPtr, string>(fg, "w" + fg.ToInt64())); }
            // open menus, drop-down lists and pop-ups are separate windows of the same app
            if (roots.Count > 0)
            {
                IntPtr main = roots[0].Key; uint mpid; GetWindowThreadProcessId(main, out mpid);
                var pops = new List<IntPtr>();
                EnumWindows(delegate (IntPtr h, IntPtr l)
                {
                    if (h == main || !IsWindowVisible(h) || pops.Count >= 3) return true;
                    uint pid; GetWindowThreadProcessId(h, out pid);
                    var cls = new StringBuilder(64); GetClassName(h, cls, 64);
                    int style = GetWindowLong(h, -16), ex = GetWindowLong(h, -20);
                    bool menu = cls.ToString() == "#32768";
                    // a menu anywhere, or any pop-up / tool window of the same app (XAML and Chromium menus are those)
                    if (!menu && (pid != mpid || ((style & unchecked((int)0x80000000)) == 0 && (ex & 0x80) == 0))) return true;
                    int[] b = Bounds(h);
                    if (b[2] < 8 || b[3] < 8 || (long)b[2] * b[3] > (long)GetSystemMetrics(78) * GetSystemMetrics(79) * 7 / 10) return true;
                    pops.Add(h); return true;
                }, IntPtr.Zero);
                foreach (var h in pops) roots.Insert(0, new KeyValuePair<IntPtr, string>(h, "w" + h.ToInt64()));
            }
            if (Bool(r, "taskbar")) { IntPtr tb = FindWindow("Shell_TrayWnd", null); if (tb != IntPtr.Zero) roots.Add(new KeyValuePair<IntPtr, string>(tb, "taskbar")); }
            var outList = new List<object>();
            var sw = Stopwatch.StartNew();
            bool truncated = false;
            var cr = Req();
            foreach (var root in roots)
            {
                AutomationElement re;
                try { using (cr.Activate()) { re = AutomationElement.FromHandle(root.Key); } } catch { continue; }
                var q = new Queue<object[]>(); // element, depth, parent index
                q.Enqueue(new object[] { re, 0, -1 });
                int rootMax = root.Value == "taskbar" ? Math.Min(120, max) : max;
                int count = 0;
                while (q.Count > 0)
                {
                    if (sw.ElapsedMilliseconds > budget || outList.Count >= max || count >= rootMax) { truncated = true; break; }
                    var it = q.Dequeue();
                    var e = (AutomationElement)it[0]; int depth = (int)it[1]; int parent = (int)it[2];
                    Dictionary<string, object> d;
                    try { d = Describe(e, depth, parent, root.Value); } catch { continue; }
                    int idx = outList.Count; outList.Add(d); count++;
                    if (d.ContainsKey("offscreen") && depth > 0) continue;
                    if (!d.ContainsKey("rect") && depth > 0) continue;
                    if (depth >= 40) continue;
                    AutomationElementCollection kids;
                    try { kids = depth == 0 ? e.CachedChildren : e.GetUpdatedCache(cr).CachedChildren; } catch { continue; }
                    if (kids == null) continue;
                    foreach (AutomationElement k in kids) q.Enqueue(new object[] { k, depth + 1, idx });
                }
            }
            return D("elements", outList, "truncated", truncated, "ms", sw.ElapsedMilliseconds);
        }

        static Dictionary<string, object> PointInfo(int x, int y)
        {
            var p = new POINT(); p.X = x; p.Y = y;
            IntPtr h = GetAncestor(WindowFromPoint(p), 3);
            uint pid = 0; if (h != IntPtr.Zero) GetWindowThreadProcessId(h, out pid);
            var sb = new StringBuilder(512); if (h != IntPtr.Zero) GetWindowText(h, sb, 512);
            var d = D("hwnd", h.ToInt64(), "pid", (long)pid, "app", ProcName(pid), "title", sb.ToString());
            try
            {
                AutomationElement e; using (Req().Activate()) { e = AutomationElement.FromPoint(new System.Windows.Point(x, y)); }
                if (e != null) d["element"] = Describe(e, 0, -1, "");
            }
            catch { }
            return d;
        }
        static Dictionary<string, object> Focused()
        {
            try
            {
                AutomationElement e; using (Req().Activate()) { e = AutomationElement.FocusedElement; }
                if (e == null) return D();
                var d = Describe(e, 0, -1, "");
                object pid = Cached(e, AutomationElement.ProcessIdProperty);
                if (pid is int) { d["pid"] = (long)(int)pid; d["app"] = ProcName((uint)(int)pid); }
                return D("element", d);
            }
            catch (Exception ex) { return D("error", ex.Message); }
        }
    }
}
