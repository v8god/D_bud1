from __future__ import annotations

import gc
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DESKTOP_BUDDY_VOICE_DATA", BASE_DIR / "data")).resolve()
PIPER_DIR = DATA_DIR / "piper-voices"
OUTPUT_DIR = DATA_DIR / "outputs"
COQUI_HOME = DATA_DIR / "coqui-cache"
os.environ.setdefault("TTS_HOME", str(COQUI_HOME))
for directory in (DATA_DIR, PIPER_DIR, OUTPUT_DIR, COQUI_HOME):
    directory.mkdir(parents=True, exist_ok=True)

HOST = "127.0.0.1"
PORT = 17843
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
DEVICE = "not-loaded"
XTTS_ENABLED = False
MODEL = None
MODEL_LOCK = threading.Lock()
PIPER_CACHE: dict[str, object] = {}

PIPER_VOICES = {
    "en-us-female-lessac": {
        "label": "English US — Lessac (Female)",
        "language": "en-US",
        "genderHint": "feminine",
        "modelName": "en_US-lessac-medium",
        "quality": "medium",
    },
    "en-us-male-hfc": {
        "label": "English US — HFC (Male)",
        "language": "en-US",
        "genderHint": "masculine",
        "modelName": "en_US-hfc_male-medium",
        "quality": "medium",
    },
    "hi-in-female-priyamvada": {
        "label": "Hindi India — Priyamvada (Female)",
        "language": "hi-IN",
        "genderHint": "feminine",
        "modelName": "hi_IN-priyamvada-medium",
        "quality": "medium",
    },
    "hi-in-male-pratham": {
        "label": "Hindi India — Pratham (Male)",
        "language": "hi-IN",
        "genderHint": "masculine",
        "modelName": "hi_IN-pratham-medium",
        "quality": "medium",
    },
}

app = FastAPI(title="Desktop Buddy Local Voice Engine", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost", "https://tauri.localhost"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ProfileRequest(BaseModel):
    profileId: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    referencePath: str
    language: str = "en"


class SynthesizeRequest(ProfileRequest):
    text: str = Field(min_length=1, max_length=4000)
    speed: float = Field(default=1.0, ge=0.5, le=1.8)


class PiperInstallRequest(BaseModel):
    voiceId: str


class PiperSynthesizeRequest(BaseModel):
    voiceId: str
    text: str = Field(min_length=1, max_length=4000)
    speed: float = Field(default=1.0, ge=0.5, le=1.8)


class GTtsSynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="en", min_length=2, max_length=16)
    tld: str = Field(default="com", min_length=2, max_length=32)
    slow: bool = False


def coqui_voice_cache_dir() -> Path:
    return COQUI_HOME / "tts_models--multilingual--multi-dataset--xtts_v2" / "voices"


def get_model():
    global MODEL, DEVICE
    if not XTTS_ENABLED:
        raise HTTPException(
            status_code=409,
            detail=(
                "XTTS is disabled for low-resource mode. Open Settings → Custom voice profiles "
                "and press Start XTTS (heavy) before preparing or using a cloned voice."
            ),
        )
    if MODEL is not None:
        return MODEL
    with MODEL_LOCK:
        if MODEL is not None:
            return MODEL
        try:
            # Both PyTorch and Coqui are imported only after the user explicitly
            # enables XTTS. Piper and gTTS therefore stay lightweight.
            import torch
            from TTS.api import TTS

            DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
            MODEL = TTS(MODEL_NAME).to(DEVICE)
            return MODEL
        except RuntimeError as error:
            message = str(error).lower()
            if "not enough memory" in message or "defaultcpuallocator" in message or "out of memory" in message:
                raise HTTPException(
                    status_code=507,
                    detail=(
                        "XTTS could not load because Windows could not reserve enough RAM/virtual memory. "
                        "Use a Piper male/female voice or a Windows system voice on this machine, or close "
                        "memory-heavy applications/increase the Windows page file before retrying XTTS."
                    ),
                ) from error
            raise
        except MemoryError as error:
            raise HTTPException(
                status_code=507,
                detail="XTTS could not load because the computer ran out of memory. Use Piper/system voice or increase available memory.",
            ) from error


def piper_paths(model_name: str) -> tuple[Path, Path]:
    return PIPER_DIR / f"{model_name}.onnx", PIPER_DIR / f"{model_name}.onnx.json"


def piper_installed(model_name: str) -> bool:
    model, config = piper_paths(model_name)
    return model.exists() and config.exists()


def piper_payload() -> list[dict[str, object]]:
    return [
        {
            "id": voice_id,
            **metadata,
            "installed": piper_installed(str(metadata["modelName"])),
        }
        for voice_id, metadata in PIPER_VOICES.items()
    ]


def require_piper_voice(voice_id: str) -> dict[str, str]:
    voice = PIPER_VOICES.get(voice_id)
    if voice is None:
        raise HTTPException(status_code=404, detail=f"Unknown Piper voice: {voice_id}")
    return voice  # type: ignore[return-value]


def load_piper_voice(voice_id: str):
    if voice_id in PIPER_CACHE:
        return PIPER_CACHE[voice_id]
    voice_meta = require_piper_voice(voice_id)
    model_name = voice_meta["modelName"]
    if not piper_installed(model_name):
        raise HTTPException(status_code=409, detail="Install this Piper voice before using it.")
    try:
        from piper import PiperVoice

        model_path, config_path = piper_paths(model_name)
        loaded = PiperVoice.load(str(model_path), config_path=str(config_path))
        PIPER_CACHE[voice_id] = loaded
        return loaded
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Unable to load Piper voice: {error}") from error


@app.get("/health")
def health():
    return {
        "available": True,
        "engineId": "desktop-buddy-local-voice-v3-low-resource",
        "label": "Desktop Buddy local voice service",
        "modelLoaded": MODEL is not None,
        "xttsEnabled": XTTS_ENABLED,
        "engineMode": "xtts-enabled" if XTTS_ENABLED else "lightweight",
        "piperLoadedVoices": len(PIPER_CACHE),
        "detail": (
            "Lightweight service online. Piper/gTTS are available on demand; XTTS is enabled explicitly."
            if XTTS_ENABLED
            else "Lightweight service online. XTTS is off and no PyTorch/Coqui model has been loaded."
        ),
        "dataDir": str(DATA_DIR),
        "voiceCacheDir": str(coqui_voice_cache_dir()),
        "device": DEVICE,
        "piperAvailable": True,
        "gttsAvailable": True,
    }


@app.post("/xtts/enable")
def enable_xtts():
    global XTTS_ENABLED
    XTTS_ENABLED = True
    return {"enabled": True, "modelLoaded": MODEL is not None}


@app.post("/xtts/disable")
def disable_xtts():
    global XTTS_ENABLED, MODEL, DEVICE
    XTTS_ENABLED = False
    had_model = MODEL is not None
    with MODEL_LOCK:
        MODEL = None
    DEVICE = "not-loaded"
    gc.collect()
    if had_model and "torch" in sys.modules:
        try:
            torch = sys.modules["torch"]
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
    return {"enabled": False, "modelLoaded": False}


@app.get("/piper/voices")
def list_piper_voices():
    return piper_payload()


@app.post("/piper/install")
def install_piper_voice(request: PiperInstallRequest):
    metadata = require_piper_voice(request.voiceId)
    model_name = metadata["modelName"]
    try:
        subprocess.run(
            [sys.executable, "-m", "piper.download_voices", "--data-dir", str(PIPER_DIR), model_name],
            check=True,
        )
    except subprocess.CalledProcessError as error:
        raise HTTPException(status_code=500, detail=f"Piper voice download failed with exit code {error.returncode}.") from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Unable to install Piper voice: {error}") from error
    return {"installed": True, "voiceId": request.voiceId}


@app.post("/piper/synthesize")
def synthesize_piper(request: PiperSynthesizeRequest):
    voice = load_piper_voice(request.voiceId)
    output = Path(tempfile.mkstemp(prefix="piper-", suffix=".wav", dir=OUTPUT_DIR)[1])
    try:
        import wave
        from piper.config import SynthesisConfig

        synthesis_config = SynthesisConfig(length_scale=max(0.55, min(1.8, 1.0 / request.speed)))
        with wave.open(str(output), "wb") as wav_file:
            voice.synthesize_wav(request.text, wav_file, syn_config=synthesis_config)
        return FileResponse(output, media_type="audio/wav", filename="piper-response.wav")
    except Exception as error:
        output.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Piper synthesis failed: {error}") from error


@app.post("/gtts/synthesize")
def synthesize_gtts(request: GTtsSynthesizeRequest):
    output = Path(tempfile.mkstemp(prefix="gtts-", suffix=".mp3", dir=OUTPUT_DIR)[1])
    try:
        from gtts import gTTS

        tts = gTTS(
            text=request.text,
            lang=request.language,
            tld=request.tld,
            slow=request.slow,
        )
        tts.save(str(output))
        return FileResponse(output, media_type="audio/mpeg", filename="gtts-response.mp3")
    except Exception as error:
        output.unlink(missing_ok=True)
        raise HTTPException(
            status_code=502,
            detail=(
                "gTTS could not generate speech. Check the internet connection; "
                "the unofficial Google Translate speech endpoint may also be temporarily unavailable. "
                f"Details: {error}"
            ),
        ) from error


@app.post("/profiles/process")
def process_profile(request: ProfileRequest):
    reference_path = Path(request.referencePath).resolve()
    if not reference_path.exists():
        raise HTTPException(status_code=404, detail="Custom voice reference file was not found.")
    model = get_model()
    preview_path = OUTPUT_DIR / f"{request.profileId}-preview.wav"
    try:
        # XTTS saves the speaker identity under speaker=<profileId>. The model's
        # voice cache is reused after process restart.
        model.tts_to_file(
            text="Your custom Desktop Buddy voice is prepared and ready.",
            speaker_wav=[str(reference_path)],
            speaker=request.profileId,
            language=request.language.split("-")[0].lower(),
            file_path=str(preview_path),
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Custom voice preparation failed: {error}") from error
    return {
        "ready": True,
        "profileId": request.profileId,
        "previewPath": str(preview_path),
        "voiceCacheDir": str(coqui_voice_cache_dir()),
    }


@app.post("/synthesize")
def synthesize_custom(request: SynthesizeRequest):
    model = get_model()
    output_path = Path(tempfile.mkstemp(prefix="xtts-", suffix=".wav", dir=OUTPUT_DIR)[1])
    try:
        # Use the cached speaker ID. The reference path is kept as a recovery
        # input for installations where the speaker cache was removed.
        model.tts_to_file(
            text=request.text,
            speaker=request.profileId,
            speaker_wav=[request.referencePath],
            language=request.language.split("-")[0].lower(),
            file_path=str(output_path),
            speed=request.speed,
        )
        return FileResponse(output_path, media_type="audio/wav", filename="custom-response.wav")
    except HTTPException:
        raise
    except Exception as error:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Custom voice synthesis failed: {error}") from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
