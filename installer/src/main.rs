// Fabro Installer & Updater — a single, dependency-free .exe with Fabro's own UI.
//
// It fetches `latest.yml` from the newest GitHub release (no API rate limit),
// downloads the NSIS package with live progress, verifies its SHA-512, runs it
// silently into the chosen folder and launches Fabro. If WebView2 is missing
// (very old Windows 10), it falls back to the classic NSIS wizard.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::{WebContext, WebViewBuilder};

const REPO: &str = "lulualdn/fabro-ai";
const HTML: &str = include_str!(concat!(env!("OUT_DIR"), "/index.html"));

#[derive(Debug)]
enum UserEvent {
    Js(Value),
    Drag,
    Minimize,
    Close,
    Browse(String),
    Launch,
    Open(String),
    Fetch,
    Install(Value),
}

#[derive(Clone, Debug, Serialize)]
struct Release {
    version: String,
    file: String,
    sha512: String,
    size: u64,
}

#[derive(Debug)]
struct Fail {
    code: &'static str,
    detail: String,
}
impl Fail {
    fn new(code: &'static str, detail: impl ToString) -> Self {
        Fail { code, detail: detail.to_string() }
    }
}

// ───────────────────────────── network ─────────────────────────────

fn agent() -> Result<ureq::Agent, Fail> {
    let tls = native_tls::TlsConnector::new().map_err(|e| Fail::new("NETWORK", e))?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .user_agent(concat!("FabroInstaller/", env!("CARGO_PKG_VERSION")))
        .build())
}

fn net_fail(e: ureq::Error) -> Fail {
    match e {
        ureq::Error::Status(code, r) => Fail::new("UNKNOWN", format!("HTTP {code} {}", r.get_url())),
        ureq::Error::Transport(t) => Fail::new("NETWORK", t),
    }
}

/// electron-builder writes latest.yml next to the installer on every release.
fn fetch_release() -> Result<Release, Fail> {
    let url = format!("https://github.com/{REPO}/releases/latest/download/latest.yml");
    let body = agent()?.get(&url).call().map_err(net_fail)?.into_string().map_err(|e| Fail::new("NETWORK", e))?;
    let mut r = Release { version: String::new(), file: String::new(), sha512: String::new(), size: 0 };
    for line in body.lines() {
        let top = !line.starts_with(' ');
        let l = line.trim().trim_start_matches("- ");
        let (k, v) = match l.split_once(':') { Some((k, v)) => (k.trim(), v.trim().trim_matches(|c| c == '\'' || c == '"')), None => continue };
        match k {
            "version" if top => r.version = v.into(),
            "path" if top => r.file = v.into(),
            "sha512" if top => r.sha512 = v.into(),
            "size" if r.size == 0 => r.size = v.parse().unwrap_or(0),
            "url" if r.file.is_empty() => r.file = v.into(),
            _ => {}
        }
    }
    if r.version.is_empty() || r.file.is_empty() {
        return Err(Fail::new("UNKNOWN", format!("unexpected latest.yml:\n{}", body.chars().take(300).collect::<String>())));
    }
    Ok(r)
}

fn sha512_b64(path: &Path) -> std::io::Result<String> {
    use base64::Engine;
    use sha2::{Digest, Sha512};
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha512::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(h.finalize()))
}

fn download(r: &Release, dest: &Path, js: &dyn Fn(Value)) -> Result<(), Fail> {
    if dest.exists() && sha512_b64(dest).map(|h| h == r.sha512).unwrap_or(false) {
        js(json!({ "type": "progress", "done": r.size, "total": r.size }));
        return Ok(()); // cached from a previous attempt
    }
    let url = format!("https://github.com/{REPO}/releases/latest/download/{}", r.file);
    let resp = agent()?.get(&url).call().map_err(net_fail)?;
    let total = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(r.size);
    let part = dest.with_extension("part");
    let mut out = std::fs::File::create(&part).map_err(|e| Fail::new("DISK", e))?;
    let mut rd = resp.into_reader();
    let mut buf = vec![0u8; 1 << 16];
    let (mut done, t0) = (0u64, Instant::now());
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        let n = rd.read(&mut buf).map_err(|e| Fail::new("NETWORK", e))?;
        if n == 0 { break; }
        out.write_all(&buf[..n]).map_err(|e| Fail::new("DISK", e))?;
        done += n as u64;
        if last.elapsed() > Duration::from_millis(120) {
            last = Instant::now();
            let speed = done as f64 / t0.elapsed().as_secs_f64().max(0.001);
            js(json!({ "type": "progress", "done": done, "total": total, "speed": speed as u64 }));
        }
    }
    drop(out);
    js(json!({ "type": "progress", "done": done, "total": total }));
    std::fs::rename(&part, dest).map_err(|e| Fail::new("DISK", e))?;
    Ok(())
}

// ───────────────────────────── system ─────────────────────────────

fn local_appdata() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}
fn default_dir() -> PathBuf { local_appdata().join("Programs").join("Fabro") }

fn ui_lang() -> String {
    let l = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    let code = l.split(['-', '_']).next().unwrap_or("en");
    if ["en", "fr", "es", "de"].contains(&code) { code.into() } else { "en".into() }
}

#[derive(Serialize, Clone)]
struct Installed { version: String, location: String }

#[cfg(windows)]
fn find_installed() -> Option<Installed> {
    use winreg::{enums::*, RegKey};
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let Ok(un) = RegKey::predef(hive).open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall") else { continue };
        for name in un.enum_keys().flatten() {
            let Ok(k) = un.open_subkey(&name) else { continue };
            let dn: String = k.get_value("DisplayName").unwrap_or_default();
            if dn == "Fabro" || dn.starts_with("Fabro ") {
                let location: String = k.get_value("InstallLocation").unwrap_or_default();
                if !location.is_empty() && Path::new(&location).join("Fabro.exe").exists() {
                    return Some(Installed { version: k.get_value("DisplayVersion").unwrap_or_default(), location });
                }
            }
        }
    }
    None
}
#[cfg(not(windows))]
fn find_installed() -> Option<Installed> { None }

#[cfg(windows)]
fn desktop_dir() -> Option<PathBuf> {
    use winreg::{enums::*, RegKey};
    let k = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders").ok()?;
    k.get_value::<String, _>("Desktop").ok().map(PathBuf::from)
}
#[cfg(not(windows))]
fn desktop_dir() -> Option<PathBuf> { None }

/// Seed first-run choices into the app's settings (merges, never overwrites existing values).
fn seed_settings(lang: &str, providers: bool) {
    let Some(appdata) = std::env::var_os("APPDATA") else { return };
    let dir = PathBuf::from(appdata).join("Fabro");
    let file = dir.join("settings.json");
    let mut s: Value = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}));
    let Some(obj) = s.as_object_mut() else { return };
    obj.entry("language").or_insert(json!(lang));
    if providers {
        let p = obj.entry("providers").or_insert(json!({ "list": [] }));
        if let Some(p) = p.as_object_mut() { p.insert("enabled".into(), json!(true)); }
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(file, serde_json::to_string_pretty(&s).unwrap());
}

fn run_setup(exe: &Path, dir: &str) -> Result<(), Fail> {
    let mut cmd = std::process::Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // NSIS wants /D= last and unquoted, so pass raw.
        cmd.raw_arg("/S").raw_arg("/currentuser").raw_arg(format!("/D={dir}"));
    }
    #[cfg(not(windows))]
    cmd.arg("/S").arg(format!("/D={dir}"));
    let st = cmd.status().map_err(|e| Fail::new("INSTALL", e))?;
    if !st.success() {
        return Err(Fail::new("INSTALL", format!("setup exited with {st}")));
    }
    Ok(())
}

fn install(r: &Release, opts: &Value, js: &dyn Fn(Value)) -> Result<PathBuf, Fail> {
    let dir = opts["dir"].as_str().filter(|s| !s.trim().is_empty()).map(String::from)
        .unwrap_or_else(|| default_dir().to_string_lossy().into_owned());
    let dir = dir.trim().trim_end_matches(['\\', '/']).to_string();
    std::fs::create_dir_all(&dir).map_err(|e| Fail::new("DISK", format!("{dir}: {e}")))?;

    let tmp = std::env::temp_dir().join("FabroInstaller");
    std::fs::create_dir_all(&tmp).map_err(|e| Fail::new("DISK", e))?;
    let pkg = tmp.join(&r.file);

    js(json!({ "type": "phase", "i": 0 }));
    download(r, &pkg, js)?;

    js(json!({ "type": "phase", "i": 1 }));
    let got = sha512_b64(&pkg).map_err(|e| Fail::new("DISK", e))?;
    if !r.sha512.is_empty() && got != r.sha512 {
        let _ = std::fs::remove_file(&pkg);
        return Err(Fail::new("INTEGRITY", format!("sha512 mismatch for {}", r.file)));
    }

    js(json!({ "type": "phase", "i": 2 }));
    seed_settings(opts["lang"].as_str().unwrap_or("en"), opts["providers"] == json!(true));
    run_setup(&pkg, &dir)?;

    js(json!({ "type": "phase", "i": 3 }));
    let exe = Path::new(&dir).join("Fabro.exe");
    if !exe.exists() {
        return Err(Fail::new("INSTALL", format!("Fabro.exe not found in {dir}")));
    }
    if opts["desktop"] == json!(false) {
        if let Some(d) = desktop_dir() { let _ = std::fs::remove_file(d.join("Fabro.lnk")); }
    }
    let _ = std::fs::remove_file(&pkg);
    std::thread::sleep(Duration::from_millis(700));
    Ok(exe)
}

fn launch(exe: &Path) {
    let _ = std::process::Command::new(exe).current_dir(exe.parent().unwrap_or(Path::new("."))).spawn();
}

fn open_url(url: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer").arg(url).spawn();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

// ───────────────────────────── fallback (no WebView2) ─────────────────────────────

fn classic_fallback(err: String) {
    let ok = rfd::MessageDialog::new()
        .set_title("Fabro")
        .set_description(format!(
            "Fabro's installer needs Microsoft Edge WebView2, which isn't available on this PC.\n\nContinue with the classic installer?\n\n({err})"))
        .set_buttons(rfd::MessageButtons::OkCancel)
        .show();
    if ok != rfd::MessageDialogResult::Ok { return; }
    let res = fetch_release().and_then(|r| {
        let pkg = std::env::temp_dir().join(&r.file);
        download(&r, &pkg, &|_| {})?;
        std::process::Command::new(&pkg).status().map_err(|e| Fail::new("INSTALL", e))?;
        Ok(())
    });
    if let Err(f) = res {
        rfd::MessageDialog::new().set_title("Fabro").set_level(rfd::MessageLevel::Error)
            .set_description(format!("Installation failed ({}): {}\n\nhttps://github.com/{REPO}/releases/latest", f.code, f.detail)).show();
    }
}

// ───────────────────────────── main ─────────────────────────────

fn main() {
    let autostart = std::env::args().any(|a| a == "--update" || a == "/update");
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let mut wb = WindowBuilder::new()
        .with_title("Fabro")
        .with_inner_size(LogicalSize::new(760.0, 500.0))
        .with_min_inner_size(LogicalSize::new(760.0, 500.0))
        .with_resizable(false)
        .with_decorations(false)
        .with_visible(false);
    #[cfg(windows)]
    {
        use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows};
        if let Ok(icon) = tao::window::Icon::from_resource(1, None) { wb = wb.with_window_icon(Some(icon)); }
        wb = wb.with_undecorated_shadow(true);
    }
    let window = wb.build(&event_loop).expect("window");

    // Keep WebView2's profile out of the user's Downloads folder.
    let mut ctx = WebContext::new(Some(std::env::temp_dir().join("FabroInstaller").join("webview")));
    let ipc_proxy = proxy.clone();
    let webview = WebViewBuilder::new_with_web_context(&mut ctx)
        .with_html(HTML)
        .with_background_color((18, 22, 29, 255))
        .with_devtools(cfg!(debug_assertions))
        .with_ipc_handler(move |req| {
            let Ok(m) = serde_json::from_str::<Value>(req.body()) else { return };
            let ev = match m["cmd"].as_str().unwrap_or("") {
                "ready" => UserEvent::Js(json!({ "type": "init" })),
                "drag" => UserEvent::Drag,
                "minimize" => UserEvent::Minimize,
                "close" => UserEvent::Close,
                "browse" => UserEvent::Browse(m["dir"].as_str().unwrap_or("").into()),
                "launch" => UserEvent::Launch,
                "open" => UserEvent::Open(m["url"].as_str().unwrap_or("").into()),
                "fetch" => UserEvent::Fetch,
                "install" => UserEvent::Install(m),
                _ => return,
            };
            let _ = ipc_proxy.send_event(ev);
        })
        .build(&window);
    let webview = match webview {
        Ok(w) => w,
        Err(e) => { drop(window); classic_fallback(e.to_string()); return; }
    };

    let installed = find_installed();
    let mut release: Option<Release> = None;
    let mut exe: Option<PathBuf> = installed.as_ref().map(|i| Path::new(&i.location).join("Fabro.exe"));
    let mut launch_after = true;
    let mut busy = false;
    let send = |p: &EventLoopProxy<UserEvent>, v: Value| { let _ = p.send_event(UserEvent::Js(v)); };

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if !busy { *flow = ControlFlow::Exit; }
            }
            Event::UserEvent(ev) => match ev {
                UserEvent::Js(v) if v["type"] == "init" => {
                    window.set_visible(true);
                    let init = json!({ "type": "init", "lang": ui_lang(), "installed": installed,
                        "defaultDir": default_dir().to_string_lossy() });
                    let _ = webview.evaluate_script(&format!("window.__fabro({init})"));
                }
                UserEvent::Js(v) => {
                    match v["type"].as_str() {
                        Some("release") => release = serde_json::from_value::<Value>(v.clone()).ok().and_then(|x| Some(Release {
                            version: x["version"].as_str()?.into(), file: x["file"].as_str()?.into(),
                            sha512: x["sha512"].as_str().unwrap_or("").into(), size: x["size"].as_u64().unwrap_or(0) })),
                        Some("done") => {
                            busy = false;
                            if let Some(p) = v["exe"].as_str() { exe = Some(PathBuf::from(p)); }
                            if launch_after { let p = proxy.clone(); std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(1900)); let _ = p.send_event(UserEvent::Launch); }); }
                        }
                        Some("error") => busy = false,
                        _ => {}
                    }
                    let _ = webview.evaluate_script(&format!("window.__fabro({v})"));
                }
                UserEvent::Drag => { let _ = window.drag_window(); }
                UserEvent::Minimize => window.set_minimized(true),
                UserEvent::Close => { if !busy { *flow = ControlFlow::Exit; } }
                UserEvent::Open(url) => { if url.starts_with("https://") { open_url(&url); } }
                UserEvent::Browse(cur) => {
                    let start = PathBuf::from(&cur);
                    let mut dlg = rfd::FileDialog::new().set_parent(&window);
                    if let Some(p) = start.parent().filter(|p| p.exists()) { dlg = dlg.set_directory(p); }
                    if let Some(p) = dlg.pick_folder() {
                        // Always install into a "Fabro" subfolder of what the user picked.
                        let p = if p.file_name().map(|n| n.eq_ignore_ascii_case("fabro")).unwrap_or(false) { p } else { p.join("Fabro") };
                        let _ = webview.evaluate_script(&format!("window.__fabro({})", json!({ "type": "dir", "dir": p.to_string_lossy() })));
                    }
                }
                UserEvent::Launch => {
                    if let Some(e) = &exe { launch(e); }
                    *flow = ControlFlow::Exit;
                }
                UserEvent::Fetch => {
                    let p = proxy.clone();
                    std::thread::spawn(move || match fetch_release() {
                        Ok(r) => send(&p, json!({ "type": "release", "version": r.version, "file": r.file, "sha512": r.sha512, "size": r.size, "autostart": autostart })),
                        Err(f) => send(&p, json!({ "type": "error", "code": f.code, "detail": f.detail })),
                    });
                }
                UserEvent::Install(opts) => {
                    let Some(r) = release.clone() else { return };
                    if busy { return; }
                    busy = true;
                    launch_after = opts["launch"] != json!(false);
                    let p = proxy.clone();
                    std::thread::spawn(move || {
                        let js = |v: Value| send(&p, v);
                        match install(&r, &opts, &js) {
                            Ok(exe) => js(json!({ "type": "done", "exe": exe.to_string_lossy() })),
                            Err(f) => js(json!({ "type": "error", "code": f.code, "detail": f.detail })),
                        }
                    });
                }
            },
            _ => {}
        }
    });
}
