from enum import Enum

from pydantic import Field
from pydantic_settings import BaseSettings


class ASRProvider(str, Enum):
    CUDA = "cuda"
    CPU = "cpu"


class TTSEngine(str, Enum):
    F5 = "f5"


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
        default=TTSEngine.F5, description="Default TTS engine (f5)"
    )
    VOICE_MANIFEST_PATH: str = Field(
        default="./voice_manifest.json", description="Voice manifest for logical voice IDs"
    )
    EMOTION_MANIFEST_PATH: str = Field(
        default="./emotion_manifest.json", description="Shared emotion manifest"
    )
    VOICE_SYNC_MAX_VOICES: int = Field(
        default=10, ge=0, le=200, description="Default max voices to import per remote sync"
    )
    VOICE_REPOSITORY_STATUS_PATH: str = Field(
        default="./voice_repository_status.json", description="Voice repository sync/cache status"
    )
    VOICE_DATASET_REVISION: str = Field(
        default="",
        description="Optional dataset revision override; empty uses the pinned manifest revision",
    )
    HF_TOKEN: str = Field(
        default="", description="Optional Hugging Face token for remote voice repositories"
    )
    F5_MODEL_ID: str = Field(
        default="Misha24-10/F5-TTS_RUSSIAN", description="Hugging Face model id for F5-TTS"
    )
    F5_CKPT_SUBPATH: str = Field(
        default="F5TTS_v1_Base_v2/model_last_inference.safetensors",
        description="F5 checkpoint path in the model repo",
    )
    F5_VOCAB_SUBPATH: str = Field(
        default="F5TTS_v1_Base/vocab.txt", description="F5 vocab path in the model repo"
    )
    F5_USE_ACCENT: bool = Field(
        default=True, description="Use RUAccent for Russian text when available"
    )
    F5_NFE_STEP: int = Field(default=24, ge=1, le=64, description="F5 inference steps")
    F5_CFG_STRENGTH: float = Field(
        default=1.5, ge=0.0, le=5.0, description="F5 classifier-free guidance strength"
    )
    F5_TTS_FORCE_DURATION: bool = Field(
        default=False, description="Debug only: force F5 fix_duration from local duration estimator"
    )
    F5_CHUNK_MAX_CHARS: int = Field(
        default=180, ge=40, le=400, description="Maximum text characters per F5 chunk"
    )
    F5_CHUNK_MAX_SECONDS: float = Field(
        default=22.0,
        ge=5.0,
        le=28.0,
        description="Maximum estimated generated seconds per F5 chunk",
    )
    F5_CHUNK_CROSSFADE_MS: int = Field(
        default=80, ge=0, le=500, description="Crossfade between generated F5 chunks"
    )
    F5_TAIL_VALIDATION: bool = Field(
        default=True, description="Validate and conservatively trim suspicious F5 chunk tails"
    )
    F5_TARGET_RMS_DB: float = Field(
        default=-20.0,
        ge=-40.0,
        le=-8.0,
        description="Final F5 response RMS target after validation/chunking",
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

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


# Global settings instance
settings = Settings()
