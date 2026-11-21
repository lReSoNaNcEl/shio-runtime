import hashlib
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
from assets import verify_file
from rebuild_s2g_stats import audio_sample_count
from s2g import text_features, to_source_samples


class QualificationInputTests(unittest.TestCase):
    def test_pin_rejects_corrupt_asset(self):
        digest = hashlib.sha256(b"verified").hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weights.bin"
            path.write_bytes(b"verified")
            self.assertEqual(verify_file(path, digest), path)
            path.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                verify_file(path, digest)

    def test_wave_header_accepts_pcm_and_float_without_downloading_audio(self):
        for encoding, width in ((1, 16), (3, 32)):
            with self.subTest(encoding=encoding):
                block = width // 8
                header = (
                    b"RIFF"
                    + struct.pack("<I", 44 + 16000 * block)
                    + b"WAVE"
                    + struct.pack(
                        "<4sIHHIIHH",
                        b"fmt ",
                        16,
                        encoding,
                        1,
                        16000,
                        16000 * block,
                        block,
                        width,
                    )
                    + struct.pack("<4sI", b"JUNK", 1)
                    + b"x\0"
                    + struct.pack("<4sI", b"data", 16000 * block)
                )
                self.assertEqual(audio_sample_count(header), 16000)
                with self.assertRaisesRegex(ValueError, "Missing BEAT2"):
                    audio_sample_count(header[:-1])

    def test_pause_and_oov_use_different_release_embeddings(self):
        embeddings = np.array([[index] * 300 for index in range(5)], dtype=np.float32)
        spans = [("привет", 0, 2940, 0.9), ("фломберик", 4410, 5880, 0.8)]
        text, known = text_features(5, spans, "ru", {"hello": 4}, embeddings)
        np.testing.assert_array_equal(text[:, 0], [4, 4, 0, 3, 0])
        self.assertEqual(known, 1)
        self.assertEqual(text.dtype, np.float16)

    def test_unusable_alignment_gets_rejected(self):
        embeddings = np.zeros((5, 300), dtype=np.float32)
        with self.assertRaisesRegex(ValueError, "No aligned words"):
            text_features(4, [("unknown", 0, 1470, 0.8)], "en", {}, embeddings)
        with self.assertRaisesRegex(ValueError, "overlapping"):
            text_features(
                4,
                [("a", 0, 1470, 0.8), ("a", 1000, 2940, 0.8)],
                "en",
                {"a": 4},
                embeddings,
            )

    def test_word_boundaries_use_original_sample_units(self):
        self.assertEqual(to_source_samples(0, 44100), 110)
        self.assertEqual(to_source_samples(1, 44100), 992)
        self.assertEqual(to_source_samples(100, 44100), 44100)


if __name__ == "__main__":
    unittest.main()
