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
