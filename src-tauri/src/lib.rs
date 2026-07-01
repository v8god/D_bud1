mod memory;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use memory::{
    memory_clear, memory_delete_entry, memory_find_by_id, memory_initialize,
    memory_list_entries, memory_search_entries, memory_set_pinned, memory_stats,
    memory_upsert_entry,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    fs::OpenOptions,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

const OVERLAY_MARGIN_LOGICAL: f64 = 24.0;

#[cfg(target_os = "windows")]
mod system_idle {
    use std::mem::size_of;

    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(info: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }

    pub fn read_idle_ms() -> Result<u64, String> {
        let mut info = LastInputInfo {
            cb_size: size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };

        let succeeded = unsafe { GetLastInputInfo(&mut info) };
        if succeeded == 0 {
            return Err("Windows GetLastInputInfo failed".to_string());
        }

        let now = unsafe { GetTickCount() };
        Ok(now.wrapping_sub(info.dw_time) as u64)
    }
}

#[cfg(not(target_os = "windows"))]
mod system_idle {
    pub fn read_idle_ms() -> Result<u64, String> {
        Err("Native system-idle detection is currently implemented for Windows only".to_string())
    }
}


#[cfg(target_os = "windows")]
mod keyboard_activity {
    use std::{
        sync::{
            atomic::{AtomicU64, Ordering},
            OnceLock,
        },
        thread,
        time::Duration,
    };

    static STARTED: OnceLock<()> = OnceLock::new();
    static KEY_ACTIVITY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(virtual_key: i32) -> i16;
    }

    fn is_typing_key(virtual_key: u32) -> bool {
        matches!(
            virtual_key,
            0x08 | // Backspace
            0x09 | // Tab
            0x0D | // Enter
            0x20 | // Space
            0x21 | 0x22 | 0x23 | 0x24 | // Page/Home/End navigation
            0x25 | 0x26 | 0x27 | 0x28 | // Arrow keys
            0x2D | 0x2E // Insert/Delete
        ) || (0x30..=0x5A).contains(&virtual_key)
            || (0x60..=0x6F).contains(&virtual_key)
            || (0xBA..=0xE2).contains(&virtual_key)
    }

    pub fn start() {
        if STARTED.set(()).is_err() {
            return;
        }

        let _ = thread::Builder::new()
            .name("desktop-buddy-keyboard-edge-detector".to_string())
            .spawn(move || {
                let mut was_down = [false; 256];

                loop {
                    for virtual_key in 0u32..=255 {
                        if !is_typing_key(virtual_key) {
                            continue;
                        }

                        let state = unsafe { GetAsyncKeyState(virtual_key as i32) as u16 };
                        let down = (state & 0x8000) != 0;
                        let pressed_since_last_check = (state & 0x0001) != 0;
                        let index = virtual_key as usize;

                        // The high-bit edge catches ordinary held/down transitions.
                        // The low bit catches a very fast press/release that happens
                        // entirely between two polling passes. Count the press once.
                        if pressed_since_last_check || (down && !was_down[index]) {
                            KEY_ACTIVITY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                        }

                        was_down[index] = down;
                    }

                    thread::sleep(Duration::from_millis(5));
                }
            });
    }

    pub fn sequence() -> u64 {
        KEY_ACTIVITY_SEQUENCE.load(Ordering::Relaxed)
    }

    pub fn mode() -> &'static str {
        "windows-key-edge-poll-v3"
    }
}

#[cfg(not(target_os = "windows"))]
mod keyboard_activity {
    pub fn start() {}

    pub fn sequence() -> u64 {
        0
    }

    pub fn mode() -> &'static str {
        "unsupported-platform"
    }
}

#[cfg(target_os = "windows")]
mod push_to_talk {
    use std::{thread, time::{Duration, Instant}};
    use tauri::{AppHandle, Emitter};

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(virtual_key: i32) -> i16;
    }

    pub fn start(app: AppHandle) {
        let _ = thread::Builder::new()
            .name("desktop-buddy-push-to-talk".to_string())
            .spawn(move || {
                let mut was_down = false;
                let mut held_emitted = false;
                let mut pressed_at = Instant::now();

                loop {
                    let down = unsafe { ((GetAsyncKeyState(0x20) as u16) & 0x8000) != 0 };

                    if down && !was_down {
                        pressed_at = Instant::now();
                        held_emitted = false;
                        let _ = app.emit("desktop-buddy-push-to-talk-space", "pressed");
                    }

                    if down && !held_emitted && pressed_at.elapsed() >= Duration::from_millis(180) {
                        held_emitted = true;
                        let _ = app.emit("desktop-buddy-push-to-talk-space", "held");
                    }

                    if !down && was_down {
                        let _ = app.emit("desktop-buddy-push-to-talk-space", "released");
                        held_emitted = false;
                    }

                    was_down = down;
                    thread::sleep(Duration::from_millis(8));
                }
            });
    }
}

#[cfg(not(target_os = "windows"))]
mod push_to_talk {
    use tauri::AppHandle;
    pub fn start(_app: AppHandle) {}
}

#[cfg(target_os = "windows")]
mod native_overlay {
    use tauri::WebviewWindow;

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: isize = 0x0000_0008;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_APPWINDOW: isize = 0x0004_0000;

    const HWND_TOPMOST: isize = -1;
    const SW_HIDE: i32 = 0;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_SHOWWINDOW: u32 = 0x0040;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn SetWindowPos(
            hwnd: isize,
            insert_after: isize,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
        fn ShowWindow(hwnd: isize, command: i32) -> i32;
    }

    /**
     * Tauri's skip-taskbar flag remains the first line of defence. This native
     * style is a Windows-specific reinforcement: TOOLWINDOW keeps the overlay
     * out of the taskbar/Alt-Tab and TOPMOST keeps it above normal apps without
     * taking keyboard focus.
     */
    pub fn enforce(window: &WebviewWindow, refresh_shell: bool) -> Result<(), String> {
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("Unable to read Desktop Buddy HWND: {error}"))?
            .0 as isize;

        unsafe {
            if refresh_shell {
                ShowWindow(hwnd, SW_HIDE);
            }

            let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let desired_style =
                (current_style | WS_EX_TOOLWINDOW | WS_EX_TOPMOST) & !WS_EX_APPWINDOW;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired_style);

            let mut flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED;
            if refresh_shell {
                flags |= SWP_SHOWWINDOW;
            }

            if SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags) == 0 {
                return Err("Windows rejected the tray-only/topmost overlay style".to_string());
            }
        }

        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod native_overlay {
    use tauri::WebviewWindow;

    pub fn enforce(_window: &WebviewWindow, _refresh_shell: bool) -> Result<(), String> {
        Ok(())
    }
}


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveCustomVoiceProfileInput {
    id: String,
    name: String,
    language: String,
    gender_hint: String,
    duration_seconds: f64,
    wav_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCustomVoiceProcessingInput {
    id: String,
    processing_state: String,
    engine_id: Option<String>,
    processing_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomVoiceProfile {
    id: String,
    name: String,
    language: String,
    gender_hint: String,
    duration_seconds: f64,
    created_at: u64,
    updated_at: u64,
    reference_path: String,
    processing_state: String,
    processing_error: Option<String>,
    engine_id: Option<String>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate_profile_id(id: &str) -> Result<&str, String> {
    if id.len() < 3 || id.len() > 80 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
        return Err("Invalid custom voice profile ID".to_string());
    }
    Ok(id)
}

fn voice_profiles_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve Desktop Buddy data directory: {error}"))?
        .join("voice-profiles");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create voice profile directory: {error}"))?;
    Ok(root)
}

fn read_voice_profile(path: &Path) -> Result<CustomVoiceProfile, String> {
    let bytes = fs::read(path).map_err(|error| format!("Unable to read voice profile: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid voice profile metadata: {error}"))
}

fn write_voice_profile(path: &Path, profile: &CustomVoiceProfile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(profile)
        .map_err(|error| format!("Unable to serialize voice profile: {error}"))?;
    fs::write(path, bytes).map_err(|error| format!("Unable to save voice profile: {error}"))
}

#[tauri::command]
fn save_custom_voice_profile(
    app: tauri::AppHandle,
    input: SaveCustomVoiceProfileInput,
) -> Result<CustomVoiceProfile, String> {
    let id = validate_profile_id(&input.id)?.to_string();
    let name = input.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err("Custom voice name must contain 1 to 80 characters".to_string());
    }
    if !(8.0..=35.0).contains(&input.duration_seconds) {
        return Err("Custom voice reference must be between 8 and 35 seconds".to_string());
    }

    let wav = BASE64_STANDARD
        .decode(input.wav_base64.as_bytes())
        .map_err(|error| format!("Invalid voice sample encoding: {error}"))?;
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("The processed voice sample is not a valid WAV file".to_string());
    }

    let directory = voice_profiles_root(&app)?.join(&id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create custom voice folder: {error}"))?;
    let reference_path = directory.join("reference.wav");
    fs::write(&reference_path, wav)
        .map_err(|error| format!("Unable to save custom voice reference: {error}"))?;

    let metadata_path = directory.join("profile.json");
    let existing = if metadata_path.exists() {
        read_voice_profile(&metadata_path).ok()
    } else {
        None
    };
    let now = now_millis();
    let profile = CustomVoiceProfile {
        id,
        name: name.to_string(),
        language: input.language,
        gender_hint: input.gender_hint,
        duration_seconds: input.duration_seconds,
        created_at: existing.as_ref().map(|item| item.created_at).unwrap_or(now),
        updated_at: now,
        reference_path: reference_path.to_string_lossy().to_string(),
        processing_state: "reference-ready".to_string(),
        processing_error: None,
        engine_id: None,
    };
    write_voice_profile(&metadata_path, &profile)?;
    Ok(profile)
}

#[tauri::command]
fn list_custom_voice_profiles(app: tauri::AppHandle) -> Result<Vec<CustomVoiceProfile>, String> {
    let root = voice_profiles_root(&app)?;
    let mut profiles = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| format!("Unable to list custom voices: {error}"))? {
        let entry = entry.map_err(|error| format!("Unable to inspect custom voice: {error}"))?;
        let metadata_path = entry.path().join("profile.json");
        if metadata_path.exists() {
            if let Ok(profile) = read_voice_profile(&metadata_path) {
                profiles.push(profile);
            }
        }
    }
    profiles.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(profiles)
}

#[tauri::command]
fn update_custom_voice_profile_processing(
    app: tauri::AppHandle,
    input: UpdateCustomVoiceProcessingInput,
) -> Result<CustomVoiceProfile, String> {
    let id = validate_profile_id(&input.id)?;
    let metadata_path = voice_profiles_root(&app)?.join(id).join("profile.json");
    let mut profile = read_voice_profile(&metadata_path)?;
    profile.processing_state = input.processing_state;
    profile.engine_id = input.engine_id;
    profile.processing_error = input.processing_error;
    profile.updated_at = now_millis();
    write_voice_profile(&metadata_path, &profile)?;
    Ok(profile)
}

#[tauri::command]
fn delete_custom_voice_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let id = validate_profile_id(&id)?;
    let directory = voice_profiles_root(&app)?.join(id);
    if directory.exists() {
        fs::remove_dir_all(directory)
            .map_err(|error| format!("Unable to delete custom voice: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn get_system_idle_ms() -> Result<u64, String> {
    system_idle::read_idle_ms()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardActivitySnapshot {
    sequence: u64,
    backend_revision: &'static str,
    detector_mode: &'static str,
}

#[tauri::command]
fn get_keyboard_activity_snapshot_v2() -> KeyboardActivitySnapshot {
    KeyboardActivitySnapshot {
        sequence: keyboard_activity::sequence(),
        backend_revision: "phase-5.4-keyboard-v3",
        detector_mode: keyboard_activity::mode(),
    }
}

// Kept temporarily so an older cached frontend cannot spam a command-not-found
// error while the Vite cache is being replaced. Phase 5.2 does not use it.
#[tauri::command]
fn poll_global_keyboard_activity() -> bool {
    false
}

fn start_keyboard_activity_stream() {
    keyboard_activity::start();
}



#[derive(Default)]
struct LocalVoiceEngineProcess {
    child: Mutex<Option<Child>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalVoiceEngineProcessStatus {
    running: bool,
    owned_by_app: bool,
    pid: Option<u32>,
    log_path: Option<String>,
    detail: String,
}

fn voice_engine_port_open() -> bool {
    let address: SocketAddr = match "127.0.0.1:17843".parse() {
        Ok(value) => value,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok()
}

fn voice_engine_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voice-engine");
    if dev.join("xtts_server.py").exists() {
        return Ok(dev);
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve Desktop Buddy resources: {error}"))?
        .join("voice-engine");
    if resource.join("xtts_server.py").exists() {
        return Ok(resource);
    }
    Err("Desktop Buddy could not find voice-engine/xtts_server.py".to_string())
}

fn voice_engine_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Unable to resolve app log directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create app log directory: {error}"))?;
    Ok(directory.join("local-voice-engine.log"))
}

fn voice_engine_status(
    app: &tauri::AppHandle,
    state: &LocalVoiceEngineProcess,
) -> LocalVoiceEngineProcessStatus {
    let mut guard = state.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut pid = None;
    let mut owned = false;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                pid = Some(child.id());
                owned = true;
            }
            Ok(Some(_)) | Err(_) => {
                *guard = None;
            }
        }
    }
    let running = voice_engine_port_open();
    let log_path = voice_engine_log_path(app).ok().map(|path| path.to_string_lossy().to_string());
    LocalVoiceEngineProcessStatus {
        running,
        owned_by_app: owned,
        pid,
        log_path,
        detail: if running && owned {
            "Local voice engine is running as a hidden Desktop Buddy child process.".to_string()
        } else if running {
            "Local voice engine is already running externally.".to_string()
        } else {
            "Local voice engine is not running.".to_string()
        },
    }
}

#[tauri::command]
fn get_local_voice_engine_process_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalVoiceEngineProcess>,
) -> LocalVoiceEngineProcessStatus {
    voice_engine_status(&app, &state)
}

#[tauri::command]
fn start_local_voice_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalVoiceEngineProcess>,
) -> Result<LocalVoiceEngineProcessStatus, String> {
    let current = voice_engine_status(&app, &state);
    if current.running {
        return Ok(current);
    }

    let root = voice_engine_root(&app)?;
    let python = root.join(".venv").join("Scripts").join("python.exe");
    if !python.exists() {
        return Err(format!(
            "Custom/local voices are not installed yet. Expected Python at {}",
            python.display()
        ));
    }
    let server = root.join("xtts_server.py");
    let log_path = voice_engine_log_path(&app)?;
    let stdout = OpenOptions::new().create(true).append(true).open(&log_path)
        .map_err(|error| format!("Unable to open local voice log: {error}"))?;
    let stderr = stdout.try_clone()
        .map_err(|error| format!("Unable to clone local voice log handle: {error}"))?;

    let voice_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve voice data directory: {error}"))?
        .join("local-voice-engine");
    fs::create_dir_all(&voice_data_dir)
        .map_err(|error| format!("Unable to create voice data directory: {error}"))?;

    let mut command = Command::new(&python);
    command
        .current_dir(&root)
        .arg(&server)
        .env("DESKTOP_BUDDY_VOICE_DATA", &voice_data_dir)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = command.spawn().map_err(|error| format!("Unable to start local voice engine: {error}"))?;
    {
        let mut guard = state.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Some(child);
    }

    for _ in 0..80 {
        if voice_engine_port_open() {
            return Ok(voice_engine_status(&app, &state));
        }
        std::thread::sleep(Duration::from_millis(125));
    }
    Err(format!(
        "The local voice engine did not become ready. Check {}",
        log_path.display()
    ))
}

#[tauri::command]
fn stop_local_voice_engine(state: tauri::State<'_, LocalVoiceEngineProcess>) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_push_to_talk_space_down() -> bool {
    #[link(name = "user32")]
    extern "system" { fn GetAsyncKeyState(virtual_key: i32) -> i16; }
    unsafe { ((GetAsyncKeyState(0x20) as u16) & 0x8000) != 0 }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_push_to_talk_space_down() -> bool { false }

fn reinforce_overlay(window: &WebviewWindow, refresh_shell: bool) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    if refresh_shell {
        let _ = native_overlay::enforce(window, true);
    } else {
        let _ = window.show();
        let _ = native_overlay::enforce(window, false);
    }
}

fn set_interaction(window: &WebviewWindow, enabled: bool) {
    let _ = window.set_ignore_cursor_events(!enabled);
    if enabled {
        reinforce_overlay(window, false);
    }
    let _ = window.emit("desktop-overlay-interaction", enabled);
}

fn place_bottom_right(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window
        .current_monitor()?
        .or(window.primary_monitor()?);

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let window_size = window.outer_size()?;
    let margin = (OVERLAY_MARGIN_LOGICAL * monitor.scale_factor()).round() as i32;

    let x = work_area.position.x
        + work_area.size.width as i32
        - window_size.width as i32
        - margin;
    let y = work_area.position.y
        + work_area.size.height as i32
        - window_size.height as i32
        - margin;

    window.set_position(PhysicalPosition::new(x, y))?;
    let _ = window.emit("desktop-overlay-position-reset", ());
    Ok(())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let enable_interaction = MenuItem::with_id(
        app,
        "enable-interaction",
        "Enable Interaction",
        true,
        None::<&str>,
    )?;
    let pass_through = MenuItem::with_id(
        app,
        "desktop-pass-through",
        "Desktop Pass-through",
        true,
        None::<&str>,
    )?;
    let reset_position = MenuItem::with_id(
        app,
        "reset-position",
        "Reset Position",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Desktop Buddy", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &enable_interaction,
            &pass_through,
            &reset_position,
            &separator,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("desktop-buddy-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Desktop Buddy")
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };

            match event.id().as_ref() {
                "enable-interaction" => set_interaction(&window, true),
                "desktop-pass-through" => set_interaction(&window, false),
                "reset-position" => {
                    set_interaction(&window, true);
                    let _ = place_bottom_right(&window);
                }
                "quit" => {
                    let state = app.state::<LocalVoiceEngineProcess>();
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                    app.exit(0)
                },
                _ => {}
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_system_idle_ms,
            get_keyboard_activity_snapshot_v2,
            poll_global_keyboard_activity,
            save_custom_voice_profile,
            list_custom_voice_profiles,
            update_custom_voice_profile_processing,
            delete_custom_voice_profile,
            start_local_voice_engine,
            get_local_voice_engine_process_status,
            stop_local_voice_engine,
            get_push_to_talk_space_down,
            memory_initialize,
            memory_upsert_entry,
            memory_list_entries,
            memory_search_entries,
            memory_set_pinned,
            memory_delete_entry,
            memory_clear,
            memory_stats,
            memory_find_by_id,
        ])
        .manage(LocalVoiceEngineProcess::default())
        .setup(|app| {
            build_tray(app)?;
            start_keyboard_activity_stream();
            push_to_talk::start(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                reinforce_overlay(&window, true);
                let _ = window.set_ignore_cursor_events(false);
                let _ = place_bottom_right(&window);

                let overlay_window = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Focused(false)) {
                        // Re-assert without activating the window. Some Windows
                        // shell/app transitions can otherwise alter z-order or
                        // briefly recreate a taskbar button.
                        reinforce_overlay(&overlay_window, false);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Desktop Buddy");
}
