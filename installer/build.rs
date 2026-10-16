fn ui() {
    // Inline the real Fabro mark (single source of truth: the app's icons.js).
    let icons = std::fs::read_to_string("../src/renderer/icons.js").expect("icons.js");
    let start = icons.find("FABRO_MARK = '").expect("FABRO_MARK") + "FABRO_MARK = '".len();
    let mark = &icons[start..start + icons[start..].find('\'').unwrap()];
    let trail: String = [1.0, 0.4, 0.2, 0.09].iter().enumerate().rev()
        .map(|(i, o)| format!(r#"<path d="{mark}" fill-rule="evenodd" transform="rotate({} 50 50)" opacity="{o}"/>"#, -(i as i32) * 9))
        .collect();
    let html = std::fs::read_to_string("ui/index.src.html").expect("ui")
        .replace("{{MARK}}", mark).replace("{{TRAIL}}", &trail);
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("index.html");
    std::fs::write(out, html).unwrap();
    println!("cargo:rerun-if-changed=ui/index.src.html");
    println!("cargo:rerun-if-changed=../src/renderer/icons.js");
}

fn main() {
    ui();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon_with_id("../build/icon.ico", "1");
        res.set("ProductName", "Fabro");
        res.set("FileDescription", "Fabro Installer");
        res.set("CompanyName", "UF Studios");
        res.set("LegalCopyright", "© UF Studios");
        res.set_manifest(r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
<application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
<dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
</windowsSettings></application>
<dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>
</assembly>"#);
        if let Err(e) = res.compile() { println!("cargo:warning=resource compile failed: {e}"); }
    }
    println!("cargo:rerun-if-changed=../build/icon.ico");
}
