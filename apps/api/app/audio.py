import io

import numpy as np
import scipy.io.wavfile as wavfile
import scipy.signal as signal


def load_wav(file_path: str, sr: int = 16000) -> tuple[np.ndarray, int]:
    """Load WAV file and resample to target sample rate."""
    import soundfile as sf

    data, original_sr = sf.read(file_path, dtype="float32")

    if len(data.shape) > 1:
        # Convert stereo to mono
        data = np.mean(data, axis=1)

    if original_sr != sr:
        data = resample(data, original_sr, sr)

    return data, sr


def resample(data: np.ndarray, sr_orig: int, sr_target: int) -> np.ndarray:
    """Resample audio using scipy."""
    if sr_orig == sr_target:
        return data

    num_samples = int(len(data) * sr_target / sr_orig)
    return signal.resample(data, num_samples)


def save_wav(data: np.ndarray, sr: int = 16000) -> bytes:
    """Save numpy array as WAV bytes."""
    # Ensure data is in valid range
    data = np.clip(data, -1.0, 1.0)

    # Convert to int16
    data_int16 = (data * 32767).astype(np.int16)

    # Write to bytes buffer
    buffer = io.BytesIO()
    wavfile.write(buffer, sr, data_int16)
    buffer.seek(0)
    return buffer.read()


def normalize_audio(data: np.ndarray, target_db: float = -20.0) -> np.ndarray:
    """Normalize audio to target loudness."""
    # Calculate RMS
    rms = np.sqrt(np.mean(data**2))

    if rms < 1e-10:
        return data

    # Calculate current loudness in dB
    current_db = 20 * np.log10(rms)

    # Calculate gain needed
    gain_db = target_db - current_db
    gain_linear = 10 ** (gain_db / 20)

    return data * gain_linear


def pad_audio(data: np.ndarray, sr: int, duration_sec: float) -> np.ndarray:
    """Pad audio to specified duration."""
    target_samples = int(duration_sec * sr)
    if len(data) >= target_samples:
        return data[:target_samples]

    padding = target_samples - len(data)
    return np.pad(data, (0, padding), mode="constant", constant_values=0)


def trim_silence(data: np.ndarray, sr: int, threshold_db: float = -40) -> np.ndarray:
    """Trim silence from audio edges."""
    # Calculate threshold
    threshold = 10 ** (threshold_db / 20)

    # Find non-silent parts
    rms_window = 512
    hop_length = 256

    # Calculate RMS for each frame
    frames = []
    for i in range(0, len(data) - rms_window, hop_length):
        frame_rms = np.sqrt(np.mean(data[i : i + rms_window] ** 2))
        frames.append(frame_rms)

    if not frames:
        return data

    frames = np.array(frames)
    non_silent = np.where(frames > threshold)[0]

    if len(non_silent) == 0:
        return data

    start_frame = non_silent[0]
    end_frame = non_silent[-1]

    start_sample = max(0, start_frame * hop_length)
    end_sample = min(len(data), (end_frame + 1) * hop_length + rms_window)

    return data[start_sample:end_sample]


def apply_pitch_shift(data: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    """Shift pitch by N semitones while preserving duration (phase vocoder).

    Uses librosa's pitch_shift, which also moves the formants together with the
    pitch — so a moderate positive shift (+2..+4) makes a voice sound younger,
    not just higher. Negative values lower the pitch.
    """
    if not semitones:
        return data

    import librosa

    data = np.asarray(data, dtype=np.float32)
    shifted = librosa.effects.pitch_shift(y=data, sr=sr, n_steps=float(semitones))
    return np.asarray(shifted, dtype=np.float32)


def apply_speed(data: np.ndarray, speed: float = 1.0) -> np.ndarray:
    """Apply speed change (without changing pitch)."""
    if speed == 1.0:
        return data

    # Simple speed change by resampling
    num_samples = int(len(data) / speed)
    return signal.resample(data, num_samples)
