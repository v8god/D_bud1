$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  throw "Voice engine is not installed. Run the Python environment setup first."
}
Write-Host "Manual diagnostic mode: starting the lightweight Piper/gTTS service."
Write-Host "XTTS and PyTorch remain unloaded until Start XTTS (heavy) is pressed in Desktop Buddy."
& $Python "$Root\xtts_server.py"
