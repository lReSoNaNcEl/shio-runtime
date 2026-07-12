import logging
import os
import re
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import soundfile as sf

from .base import LocalTTSEngine, SynthesisResult
from .voices import default_voice_id, resolve_reference

logger = logging.getLogger(__name__)

F5_SAMPLE_RATE = 24000
F5_REFERENCE_DURATION_CAP_SEC = 6.0


@dataclass
class F5TailMetrics:
    duration_sec: float
    rms: float
    peak: float
    dc_offset: float
    clipping_ratio: float
    tail_rms: float
    tail_to_body_ratio: float
    tail_high_freq_ratio: float
    trimmed_sec: float
    suspicious: bool


def _patch_torchaudio_load_with_soundfile() -> None:
    try:
        import soundfile as sf
        import torch
        import torchaudio
    except Exception:
        return

    if getattr(torchaudio, "_sf_load_patched", False):
        return

    def _sf_load(filepath, *args, **kwargs):
        data, sr = sf.read(str(filepath), dtype="float32", always_2d=True)
        return torch.from_numpy(data.T).contiguous(), sr

    torchaudio.load = _sf_load
    torchaudio._sf_load_patched = True


class F5LocalEngine(LocalTTSEngine):
    """F5-TTS voice-reference engine."""

    def __init__(
        self,
        device: str = "cuda",
        model_id: str = "Misha24-10/F5-TTS_RUSSIAN",
        ckpt_subpath: str = "F5TTS_v1_Base_v2/model_last_inference.safetensors",
        vocab_subpath: str = "F5TTS_v1_Base/vocab.txt",
        use_accent: bool = True,
        nfe_step: int = 24,
        cfg_strength: float = 1.5,
        force_duration: bool = False,
        max_chunk_chars: int = 180,
        max_chunk_seconds: float = 22.0,
        chunk_crossfade_ms: int = 80,
        tail_validation: bool = True,
        target_rms_db: float = -20.0,
    ):
        super().__init__("f5", device=device)
        self.model = None
        self.sample_rate = F5_SAMPLE_RATE
        self.model_id = model_id
        self._accentizer = None
        self._use_accent = use_accent
        self._nfe_step = int(nfe_step)
        self._cfg_strength = float(cfg_strength)
        self._force_duration = bool(force_duration)
        self._max_chunk_chars = int(max_chunk_chars)
        self._max_chunk_seconds = float(max_chunk_seconds)
        self._chunk_crossfade_ms = int(chunk_crossfade_ms)
        self._tail_validation = bool(tail_validation)
        self._target_rms = float(10 ** (target_rms_db / 20))
        self.last_debug_chunks: list[dict] = []

        logger.info("Loading F5-TTS model '%s' on %s...", model_id, device)
        try:
            from f5_tts.api import F5TTS
            from huggingface_hub import hf_hub_download

            _patch_torchaudio_load_with_soundfile()
            ckpt = hf_hub_download(model_id, ckpt_subpath)
            vocab = hf_hub_download(model_id, vocab_subpath)
            self.model = F5TTS(
                model="F5TTS_v1_Base",
                ckpt_file=ckpt,
                vocab_file=vocab,
                device=device,
            )
            self.is_ready = True
            logger.info("F5-TTS model loaded")
        except ImportError:
            logger.warning("f5-tts not installed - F5 runs in MOCK mode")
            self.model = None
            self.is_ready = True
        except Exception as e:
            logger.error("Failed to load F5-TTS model (%s) - MOCK mode", e)
            self.model = None
            self.is_ready = True

    def _find_reference(self, voice_id: str) -> Optional[Tuple[str, str]]:
        resolved = resolve_reference(voice_id)
        if resolved is None:
            return None
        wav, transcript, _entry = resolved
        return wav, transcript

    @staticmethod
    def _read_ref_text(wav_path: str) -> Optional[str]:
        for candidate in (wav_path + ".txt", os.path.splitext(wav_path)[0] + ".txt"):
            if os.path.exists(candidate):
                with open(candidate, "r", encoding="utf-8") as fh:
                    return fh.read().strip()
        return None

    def _accent(self, text: str, language: str) -> str:
        if not self._use_accent or language != "ru" or not text.strip():
            return text
        try:
            if self._accentizer is None:
                from ruaccent import RUAccent

                acc = RUAccent()
                acc.load(omograph_model_size="tiny", use_dictionary=True)
                self._accentizer = acc
            return self._accentizer.process_all(text)
        except Exception as e:
            logger.debug("RUAccent unavailable (%s); using plain text", e)
            return text

    @staticmethod
    def _normalize_text(text: str, language: str) -> str:
        if language != "ru" or not text:
            return text
        return re.sub(r"\bshio\b", "Shio", text, flags=re.IGNORECASE)

    @staticmethod
    def _estimate_generated_duration(text: str, speed: float) -> float:
        words = re.findall(r"[\w]+", text, flags=re.UNICODE)
        chars = len(re.sub(r"\s+", "", text))
        base = max(1.25, len(words) * 0.38, chars * 0.075)
        pause_bonus = (
            text.count(",") * 0.12
            + text.count(".") * 0.18
            + text.count("!") * 0.18
            + text.count("?") * 0.18
            + text.count("...") * 0.25
            + text.count("…") * 0.25
        )
        return (base + pause_bonus) / max(float(speed), 0.5)

    @staticmethod
    def _audio_duration_sec(wav_path: str) -> float:
        info = sf.info(wav_path)
        return float(info.frames) / float(info.samplerate)

    def _should_chunk(self, text: str, speed: float) -> bool:
        if len(text) > self._max_chunk_chars:
            return True
        return self._estimate_generated_duration(text, speed) > self._max_chunk_seconds

    def _split_text_chunks(self, text: str, speed: float) -> list[str]:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return []
        if not self._should_chunk(text, speed):
            return [text]

        sentences = [part.strip() for part in re.split(r"(?<=[.!?…])\s+", text) if part.strip()]
        if not sentences:
            sentences = [text]

        chunks: list[str] = []
        current = ""

        def fits(candidate: str) -> bool:
            return len(candidate) <= self._max_chunk_chars and self._estimate_generated_duration(candidate, speed) <= self._max_chunk_seconds

        def split_long(part: str) -> list[str]:
            if fits(part):
                return [part]
            pieces = [piece.strip() for piece in re.split(r"(?<=[,;:])\s+", part) if piece.strip()]
            if len(pieces) == 1:
                pieces = [part[i : i + self._max_chunk_chars].strip() for i in range(0, len(part), self._max_chunk_chars)]
            result: list[str] = []
            buf = ""
            for piece in pieces:
                candidate = f"{buf} {piece}".strip()
                if buf and not fits(candidate):
                    result.append(buf)
                    buf = piece
                else:
                    buf = candidate
            if buf:
                result.append(buf)
            final: list[str] = []
            for item in result:
                if len(item) <= self._max_chunk_chars:
                    final.append(item)
                else:
                    final.extend(item[i : i + self._max_chunk_chars].strip() for i in range(0, len(item), self._max_chunk_chars))
            return [item for item in final if item]

        for sentence in sentences:
            for part in split_long(sentence):
                candidate = f"{current} {part}".strip()
                if current and not fits(candidate):
                    chunks.append(current)
                    current = part
                else:
                    current = candidate
        if current:
            chunks.append(current)
        return chunks

    @staticmethod
    def _tail_high_freq_ratio(audio: np.ndarray, sr: int) -> float:
        if len(audio) < sr // 2:
            return 0.0
        window = np.hanning(len(audio))
        spectrum = np.abs(np.fft.rfft(audio * window)) ** 2
        freqs = np.fft.rfftfreq(len(audio), d=1.0 / sr)
        total = float(np.sum(spectrum))
        if total <= 1e-12:
            return 0.0
        return float(np.sum(spectrum[freqs > 4000]) / total)

    def _validate_and_trim_tail(self, audio: np.ndarray, sr: int, label: str) -> tuple[np.ndarray, F5TailMetrics]:
        audio = np.asarray(audio, dtype=np.float32)
        if not len(audio):
            metrics = F5TailMetrics(0, 0, 0, 0, 0, 0, 0, 0, 0, False)
            return audio, metrics

        duration = len(audio) / sr
        rms = float(np.sqrt(np.mean(audio * audio)))
        peak = float(np.max(np.abs(audio)))
        dc = float(np.mean(audio))
        clipping = float(np.mean(np.abs(audio) >= 0.999))
        tail_samples = min(len(audio), max(int(sr * 2.0), int(len(audio) * 0.15)))
        tail = audio[-tail_samples:]
        body = audio[:-tail_samples] if len(audio) > tail_samples else audio
        tail_rms = float(np.sqrt(np.mean(tail * tail))) if len(tail) else 0.0
        body_rms = float(np.sqrt(np.mean(body * body))) if len(body) else rms
        ratio = tail_rms / max(body_rms, 1e-6)
        high_freq = self._tail_high_freq_ratio(tail, sr)
        suspicious = duration > 8.0 and tail_rms > 0.008 and ratio < 0.45 and high_freq > 0.12

        trimmed_sec = 0.0
        trimmed = audio
        if self._tail_validation and duration > 2.0:
            frame = max(512, int(sr * 0.05))
            hop = max(128, int(sr * 0.02))
            values = []
            for start in range(0, len(audio) - frame + 1, hop):
                segment = audio[start : start + frame]
                values.append(float(np.sqrt(np.mean(segment * segment))))
            if values:
                frames = np.asarray(values, dtype=np.float32)
                threshold = max(float(np.percentile(frames, 15)) * 3.0, rms * 0.035, 0.0015)
                voiced = np.where(frames > threshold)[0]
                if len(voiced):
                    end = min(len(audio), int(voiced[-1] * hop + frame + sr * 0.12))
                    trimmed_sec = max(0.0, (len(audio) - end) / sr)
                    if 0.15 <= trimmed_sec <= 4.0:
                        trimmed = audio[:end]
                    else:
                        trimmed_sec = 0.0

        metrics = F5TailMetrics(
            duration_sec=duration,
            rms=rms,
            peak=peak,
            dc_offset=dc,
            clipping_ratio=clipping,
            tail_rms=tail_rms,
            tail_to_body_ratio=ratio,
            tail_high_freq_ratio=high_freq,
            trimmed_sec=trimmed_sec,
            suspicious=suspicious,
        )
        if suspicious or trimmed_sec > 0:
            logger.info(
                "F5 tail validation %s: suspicious=%s trimmed=%.2fs dur=%.2fs tail_rms=%.5f ratio=%.3f hf=%.3f peak=%.3f dc=%.5f clip=%.5f",
                label,
                suspicious,
                trimmed_sec,
                duration,
                tail_rms,
                ratio,
                high_freq,
                peak,
                dc,
                clipping,
            )
        return np.asarray(trimmed, dtype=np.float32), metrics

    def _safe_loudness_normalize(self, audio: np.ndarray) -> np.ndarray:
        audio = np.asarray(audio, dtype=np.float32)
        if not len(audio):
            return audio
        rms = float(np.sqrt(np.mean(audio * audio)))
        if rms > 1e-7 and self._target_rms > 0:
            audio = audio * min(self._target_rms / rms, 4.0)
        peak = float(np.max(np.abs(audio)))
        if peak > 0.95:
            audio = audio * (0.95 / peak)
        return np.clip(audio, -1.0, 1.0).astype(np.float32)

    @staticmethod
    def _crossfade_concat(chunks: list[np.ndarray], sr: int, crossfade_ms: int) -> np.ndarray:
        chunks = [np.asarray(chunk, dtype=np.float32) for chunk in chunks if len(chunk)]
        if not chunks:
            return np.array([], dtype=np.float32)
        crossfade = int(sr * max(crossfade_ms, 0) / 1000)
        output = chunks[0]
        for chunk in chunks[1:]:
            fade = min(crossfade, len(output), len(chunk))
            if fade <= 0:
                output = np.concatenate([output, chunk])
                continue
            out_fade = np.linspace(1.0, 0.0, fade, dtype=np.float32)
            in_fade = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            mixed = output[-fade:] * out_fade + chunk[:fade] * in_fade
            output = np.concatenate([output[:-fade], mixed, chunk[fade:]])
        return output.astype(np.float32)

    def _infer_chunk(self, ref_wav: str, ref_text: str, text: str, speed: float, ref_duration: float, label: str) -> tuple[np.ndarray, int, dict]:
        estimate = self._estimate_generated_duration(text, speed)
        fix_duration = None
        if self._force_duration:
            fix_duration = min(ref_duration, F5_REFERENCE_DURATION_CAP_SEC) + estimate

        wav, sr, _ = self.model.infer(
            ref_file=ref_wav,
            ref_text=ref_text,
            gen_text=text,
            nfe_step=self._nfe_step,
            cfg_strength=self._cfg_strength,
            speed=speed,
            fix_duration=fix_duration,
            remove_silence=False,
            show_info=lambda *a, **k: None,
        )
        raw = np.asarray(wav, dtype=np.float32)
        validated, metrics = self._validate_and_trim_tail(raw, int(sr), label)

        if self._force_duration and metrics.suspicious:
            logger.warning("F5 chunk %s looked suspicious with forced duration; retrying with natural duration.", label)
            wav, sr, _ = self.model.infer(
                ref_file=ref_wav,
                ref_text=ref_text,
                gen_text=text,
                nfe_step=self._nfe_step,
                cfg_strength=self._cfg_strength,
                speed=speed,
                fix_duration=None,
                remove_silence=False,
                show_info=lambda *a, **k: None,
            )
            raw = np.asarray(wav, dtype=np.float32)
            validated, metrics = self._validate_and_trim_tail(raw, int(sr), f"{label}:retry")
            fix_duration = None

        debug = {
            "label": label,
            "text_chars": len(text),
            "estimated_duration": estimate,
            "fix_duration": fix_duration,
            **metrics.__dict__,
        }
        return validated, int(sr), debug

    def synthesize(self, text, language="en", emotion="neutral", voice=None, speed=1.0, **kwargs):
        if not self.is_ready:
            raise RuntimeError("F5 engine not ready")
        if not text.strip():
            raise ValueError("Text cannot be empty")

        audio, latency_ms = self._measure_synthesis(
            self._synthesize_internal,
            text=text,
            language=language,
            emotion=emotion,
            voice=voice or default_voice_id(),
            speed=speed,
        )
        duration_sec = len(audio) / self.sample_rate
        rtf = self.measure_rtf(audio, self.sample_rate, latency_ms)
        return SynthesisResult(
            audio=audio,
            sample_rate=self.sample_rate,
            duration_sec=duration_sec,
            language=language,
            emotion=emotion,
            engine="f5",
            latency_ms=latency_ms,
            rtf=rtf,
            text=text,
        )

    def _synthesize_internal(self, text, language, emotion, voice, speed):
        ref = self._find_reference(voice) if self.model is not None else None
        if self.model is None or ref is None:
            if self.model is not None and ref is None:
                logger.warning("F5: no reference clip for voiceId '%s'; using mock audio.", voice)
            duration = max(len(text) * 0.06, 0.5)
            return np.random.randn(int(self.sample_rate * duration)).astype(np.float32) * 0.05

        ref_wav, ref_text = ref
        gen_text = self._accent(self._normalize_text(text, language), language)
        ref_text = self._accent(self._normalize_text(ref_text, language), language)
        ref_duration = self._audio_duration_sec(ref_wav)
        chunks = self._split_text_chunks(gen_text, speed)
        logger.info(
            "F5 synthesis plan: chunks=%d force_duration=%s ref_duration=%.2fs text_chars=%d",
            len(chunks),
            self._force_duration,
            ref_duration,
            len(gen_text),
        )

        generated_chunks: list[np.ndarray] = []
        debug_chunks: list[dict] = []
        sample_rate = self.sample_rate
        for index, chunk in enumerate(chunks, start=1):
            label = f"{index}/{len(chunks)}"
            audio, sr, debug = self._infer_chunk(ref_wav, ref_text, chunk, speed, ref_duration, label)
            sample_rate = sr
            generated_chunks.append(audio)
            debug_chunks.append(debug)

        self.sample_rate = int(sample_rate)
        self.last_debug_chunks = debug_chunks
        audio = self._crossfade_concat(generated_chunks, self.sample_rate, self._chunk_crossfade_ms)
        audio = self._safe_loudness_normalize(audio)
        if debug_chunks:
            logger.info(
                "F5 synthesis complete: chunks=%d duration=%.2fs trims=%.2fs suspicious=%d",
                len(debug_chunks),
                len(audio) / self.sample_rate if self.sample_rate else 0.0,
                sum(float(item.get("trimmed_sec", 0.0)) for item in debug_chunks),
                sum(1 for item in debug_chunks if item.get("suspicious")),
            )
        return audio

    def warmup(self):
        if not self.is_ready or self.model is None:
            return
        try:
            logger.info("Warming up F5-TTS...")
            self.synthesize(text="Short F5 warmup.", language="en")
            logger.info("F5-TTS warmup completed")
        except Exception as e:
            logger.warning("F5-TTS warmup failed: %s", e)
