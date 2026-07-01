$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw "Python launcher 'py' was not found. Install Python 3.12 first."
}

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  py -3.12 -m venv $Venv
}

$Python = Join-Path $Venv "Scripts\python.exe"
& $Python -m pip install --upgrade pip wheel setuptools

# PyTorch/torchaudio are machine-specific (CPU versus CUDA). Preserve an
# already-working installation; install the default wheels only when absent.
& $Python -c "import torch, torchaudio" 2>$null
if ($LASTEXITCODE -ne 0) {
  & $Python -m pip install torch torchaudio
}

& $Python -m pip install --upgrade -r (Join-Path $Root "requirements.txt")
Write-Host "Desktop Buddy local voice environment is ready."
Write-Host "The app can now start the engine automatically; run.ps1 is only for manual diagnostics."
