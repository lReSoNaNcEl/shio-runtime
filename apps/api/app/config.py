from enum import Enum
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[1]


class ASRProvider(str, Enum):
    CUDA = "cuda"
    CPU = "cpu"


class TTSEngine(str, Enum):
    FISH_S2_PRO = "fish-s2-pro"


class WhisperModel(str, Enum):
    TINY = "tiny"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


class Language(str, Enum):
    AUTO = "auto"
    RU = "ru"
    EN = "en"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        case_sensitive=True,
        extra="ignore",
    )

    # FastAPI
    HOST: str = Field(default="0.0.0.0", description="Server host")
    PORT: int = Field(default=8000, description="Server port")
    DEBUG: bool = Field(default=False, description="Debug mode")
    RELOAD: bool = Field(default=False, description="Auto-reload on code changes")

    # ASR
    ASR_PROVIDER: ASRProvider = Field(
        default=ASRProvider.CUDA, description="ASR provider (cuda/cpu)"
    )
    WHISPER_MODEL: WhisperModel = Field(
        default=WhisperModel.MEDIUM, description="Whisper model size"
    )
    WHISPER_MODEL_REVISION: str = Field(
        default="08e178d48790749d25932bbc082711ddcfdfbc4f",
        description="Pinned Hugging Face revision for the configured faster-whisper model",
    )
    SHIO_MODEL_ROOT: str = Field(
        default=str(API_ROOT / "models"),
        description="Persistent root prepared by the release model-prefetch command",
    )
    ASR_LANGUAGE: Language = Field(default=Language.AUTO, description="ASR language (auto/ru/en)")
    WHISPER_COMPUTE_TYPE: str = Field(default="auto", description="Whisper compute type")
    VAD_THRESHOLD: float = Field(default=0.5, ge=0.0, le=1.0)
    VAD_NEGATIVE_THRESHOLD: float = Field(default=0.35, ge=0.0, le=1.0)
    VAD_MIN_SPEECH_MS: int = Field(default=180, ge=32, le=5000)
    VAD_MIN_SILENCE_MS: int = Field(default=650, ge=32, le=5000)
    VAD_PRE_ROLL_MS: int = Field(default=250, ge=0, le=2000)
    VAD_POST_ROLL_MS: int = Field(default=200, ge=0, le=2000)
    VAD_MAX_SEGMENT_MS: int = Field(default=20_000, ge=1000, le=120_000)
    ASR_PARTIAL_INTERVAL_MS: int = Field(default=800, ge=400, le=5000)
    ASR_AUDIO_QUEUE_FRAMES: int = Field(default=64, ge=8, le=512)

    # TTS
    TTS_DEFAULT_ENGINE: TTSEngine = Field(
        default=TTSEngine.FISH_S2_PRO, description="Default TTS engine (fish-s2-pro)"
    )
    VOICE_MANIFEST_PATH: str = Field(
        default=str(API_ROOT / "voice_manifest.json"),
        description="Voice manifest for logical voice IDs",
    )
    EMOTION_MANIFEST_PATH: str = Field(
        default=str(API_ROOT / "emotion_manifest.json"),
        description="Shared emotion manifest",
    )
    VOICE_SYNC_MAX_VOICES: int = Field(
        default=10, ge=0, le=200, description="Default max voices to import per remote sync"
    )
    VOICE_REPOSITORY_STATUS_PATH: str = Field(
        default=str(API_ROOT / "voice_repository_status.json"),
        description="Voice repository sync/cache status",
    )
    VOICE_CACHE_ROOT: str = Field(
        default=str(API_ROOT / "cache"),
        description="App-owned derived voice-conditioning cache root",
    )
    VOICE_DATASET_REVISION: str = Field(
        default="",
        description="Optional dataset revision override; empty uses the pinned manifest revision",
    )
    HF_TOKEN: str = Field(
        default="", description="Optional Hugging Face token for remote voice repositories"
    )
    FISH_MODEL_ID: str = Field(
        default="fishaudio/s2-pro",
        description="Pinned Hugging Face Fish Audio S2 Pro model id",
    )
    FISH_MODEL_REVISION: str = Field(
        default="1de9996b6be38b745688de084d87a5633f714e4e",
        description="Pinned Hugging Face Fish Audio S2 Pro model revision",
    )
    FISH_SOURCE_REVISION: str = Field(
        default="541566932abbaebcb0a40e562a1f846738383f38",
        description="Pinned upstream FishS2Pro source revision",
    )
    FISH_SOURCE_PATH: str = Field(
        default="", description="Optional explicit path to pinned FishS2Pro source"
    )
    FISH_MODEL_PATH: str = Field(
        default="", description="Optional explicit path to the pinned FishS2Pro model snapshot"
    )
    FISH_SAMPLE_RATE: int = Field(default=44100, ge=8000, le=48000)
    FISH_COMPILE: bool = Field(
        default=True, description="Compile the pinned Fish sampler during startup warmup"
    )
    FISH_MAX_SESSIONS: int = Field(default=1, ge=1, le=4)
    FISH_TEXT_QUEUE_ITEMS: int = Field(default=64, ge=2, le=64)
    FISH_AUDIO_QUEUE_ITEMS: int = Field(default=8, ge=2, le=32)
    FISH_MAX_SESSION_SECONDS: int = Field(default=120, ge=10, le=600)

    # Stable launcher/service identity
    SERVICE_ID: str = Field(default="shio.speech-api", description="Stable Speech API identity")
    CONTRACT_VERSION: str = Field(default="2.1", description="Speech HTTP contract version")
    SPEECH_PACK_VERSION: str = Field(
        default="development", description="Version of the packaged Speech API runtime"
    )

    # Device
    DEVICE: str = Field(default="cuda", description="PyTorch device")
    NUM_THREADS: int = Field(default=4, ge=1, le=32, description="Number of threads")

    # Startup
    WARMUP_ON_STARTUP: bool = Field(default=True, description="Warm up models on startup")

    # CORS
    CORS_ORIGINS: list[str] = Field(
        default=["http://localhost:8000", "http://127.0.0.1:8000"],
        description="CORS allowed origins",
    )

    @field_validator(
        "SHIO_MODEL_ROOT",
        "VOICE_MANIFEST_PATH",
        "EMOTION_MANIFEST_PATH",
        "VOICE_REPOSITORY_STATUS_PATH",
        "VOICE_CACHE_ROOT",
        "FISH_SOURCE_PATH",
        "FISH_MODEL_PATH",
        mode="after",
    )
    @classmethod
    def resolve_service_path(cls, value: str) -> str:
        if not value:
            return value
        path = Path(value)
        return str(path if path.is_absolute() else API_ROOT / path)


# Global settings instance
settings = Settings()
