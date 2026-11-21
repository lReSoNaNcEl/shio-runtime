"""One in-process FlashMotion owner for the Windows experiment's WSL adapter."""

import base64
import contextlib
import json
import os
import queue
import re
import sys
import threading
import time
from itertools import groupby
from pathlib import Path
from zlib import crc32

import numpy as np
import torch
from catalog import DANCE_PROMPTS, PROMPTS
from retarget import resample_t2m, s2g_pose, t2m_pose
from scipy.spatial.transform import Rotation, Slerp
from torchaudio.functional import resample
from transformers import (
    HubertForCTC,
    MarianMTModel,
    MarianTokenizer,
    Wav2Vec2FeatureExtractor,
    Wav2Vec2ForCTC,
)

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
DESKTOP = Path(__file__).resolve().parents[1]
ASSETS = Path(
    os.environ.get("SHIO_FLASHMOTION_ASSETS") or DESKTOP.parents[1] / "tmp/flashmotion"
)
sys.path.insert(0, str(DESKTOP / "qualifications/flashmotion"))
sys.path.insert(0, str(DESKTOP / "motion"))

import t2m  # noqa: E402 - Reuse the verified experiment encoder after resolving its folder.
from assets import (  # noqa: E402 - Load the same pinned asset inventory as qualification.
    HUBERT_FILES,
    RU_ALIGN_FILES,
    S2G_STATS_SHA256,
    SOURCE_REVISION,
    TRANSLATOR_FILES,
    VOCAB_SHA256,
    WEIGHTS_REVISION,
    checkpoint,
    verify_file,
    verify_source,
)
from protocol import (  # noqa: E402 - Use the worktree's checked motion identity.
    load_catalog,
    validate_continuation,
    validate_request,
)

FPS = 30
FRAME_SAMPLES = 1470
DEVICE = torch.device("cuda")
WORDS = re.compile(r"[^\W\d_]+", re.UNICODE)
PROTOCOL_OUTPUT = sys.stdout


def emit(value):
    print(
        json.dumps(value, allow_nan=False, separators=(",", ":")),
        file=PROTOCOL_OUTPUT,
        flush=True,
    )


def read_owner(inbox):
    while True:
        line = sys.stdin.buffer.readline(560_001)
        if not line:
            os._exit(0)
        if len(line) > 560_000:
            emit({"type": "error", "code": "MOTION_PROTOCOL_ERROR"})
            os._exit(1)
        try:
            inbox.put_nowait(line)
        except queue.Full:
            os._exit(1)


def observed_words(labels, alphabet):
    inverse = {index: char for char, index in alphabet.items()}
    offset = 0
    start = 0
    stop = 0
    letters = []
    for index, items in groupby(labels):
        count = sum(1 for _ in items)
        char = inverse.get(index, "")
        if char == "|":
            if letters:
                yield "".join(letters).lower(), start, stop
            letters = []
        elif len(char) == 1 and char.isalpha():
            if not letters:
                start = offset
            letters.append(char)
            stop = offset + count
        offset += count
    if letters:
        yield "".join(letters).lower(), start, stop


class Adapter:
    def __init__(self):
        self.catalog = load_catalog()
        self.profiles = {profile["id"]: profile for profile in self.catalog["profiles"]}
        if self.profiles.keys() - {"dance_in_place"} != PROMPTS.keys():
            raise ValueError("FlashMotion catalog differs from Desktop")
        source = verify_source(ASSETS / "upstream")
        # T2M has a top-level model package. Load Full55 through its namespace.
        t2m.CATALOG = PROMPTS
        self.embeddings = t2m.catalog_features(
            ASSETS, DEVICE, ASSETS / "t2m-catalog-v2.npz", {}
        )
        t2m.CATALOG = DANCE_PROMPTS
        self.dance_embeddings = t2m.catalog_features(
            ASSETS, DEVICE, ASSETS / "t2m-dance-v1.npz", {}
        )
        # The playful feature alone consistently predicted nearly static feet
        # on this checkpoint. Mix in the learned stepping condition.
        self.dance_embeddings["playful"] = self.dance_embeddings["playful"].lerp(
            self.dance_embeddings["energetic"], 0.82
        )
        t2m.CATALOG = PROMPTS
        torch.cuda.empty_cache()
        self.t2m = t2m.load_motion(source, checkpoint(ASSETS, "t2m"))
        self.last_text_motion = None
        self.last_speech_motion = None
        self.load_speech(source)

    def load_speech(self, source):
        snapshot = source / "tasks/s2g/snapshots"
        sys.path[:0] = [str(snapshot), str(snapshot / "full55_r2/code")]
        from full55_r2.code import data, loss, model, prepare

        self.prepare = prepare
        self.loss = loss
        self.decode = data.decode_motion
        self.parents = model.SMPLX_PARENTS
        normalizer = data.Standardizer.load(
            verify_file(
                ASSETS / "reconstructed-stats-full55-reference-python.npz",
                S2G_STATS_SHA256,
            )
        )
        self.mean = torch.as_tensor(normalizer.mean, device=DEVICE)
        self.std = torch.as_tensor(normalizer.std, device=DEVICE)
        self.vocab, self.word_weights = prepare.read_vocabulary(
            verify_file(ASSETS / "vocab.pkl", VOCAB_SHA256)
        )
        cfg = json.loads((snapshot / "full55_r2/code/config.target.json").read_text())
        state = torch.load(
            checkpoint(ASSETS, "s2g"), mmap=True, weights_only=True, map_location="cpu"
        )
        self.s2g = model.GestureM2D(mode="full55", **cfg["architecture"])
        if (
            state["epoch"] != 3200
            or state["architecture"] != self.s2g.architecture_config()
            or state["metadata"]["normalizer_sha256"] != S2G_STATS_SHA256
        ):
            raise ValueError("Unexpected S2G checkpoint identity")
        self.s2g.load_state_dict(state["model"], strict=True)
        self.s2g.eval().requires_grad_(False).cuda()
        self.aligners = {}
        self.extractors = {}
        self.alphabet = {}
        for language, directory, cls, pins in (
            ("en", "hubert", HubertForCTC, HUBERT_FILES),
            ("ru", "ru-align", Wav2Vec2ForCTC, RU_ALIGN_FILES),
        ):
            root = ASSETS / directory
            for name, sha in pins.items():
                verify_file(root / name, sha)
            self.aligners[language] = (
                cls.from_pretrained(root, local_files_only=True, use_safetensors=False)
                .eval()
                .requires_grad_(False)
                .cuda()
            )
            self.extractors[language] = Wav2Vec2FeatureExtractor.from_pretrained(
                root, local_files_only=True
            )
            self.alphabet[language] = json.loads(
                (root / "vocab.json").read_text(encoding="utf-8")
            )
        root = ASSETS / "ru-en"
        for name, sha in TRANSLATOR_FILES.items():
            verify_file(root / name, sha)
        self.translator = (
            MarianMTModel.from_pretrained(
                root, local_files_only=True, use_safetensors=False
            )
            .eval()
            .requires_grad_(False)
            .cuda()
        )
        self.tokenizer = MarianTokenizer.from_pretrained(root, local_files_only=True)

    def project(self, value):
        physical = value * self.std + self.mean
        rotations = physical[..., :-3].reshape(*physical.shape[:-1], 55, 6)
        physical[..., :-3] = self.loss.matrix_to_rotation_6d(
            self.loss.rotation_6d_to_matrix(rotations)
        ).flatten(-2)
        return (physical - self.mean) / self.std

    @torch.inference_mode()
    def sample_s2g(self, acoustic, text, frames, seed):
        noise = torch.randn(
            (1, frames, 333),
            generator=torch.Generator(device=DEVICE).manual_seed(seed),
            device=DEVICE,
        )
        normalized = self.s2g.sample(
            noise,
            steps=1,
            project_func=self.project,
            audio=torch.from_numpy(acoustic).cuda().float().unsqueeze(0),
            text=torch.from_numpy(text).cuda().float().unsqueeze(0),
            person_id=torch.tensor([2], device=DEVICE),
            padding_mask=torch.ones((1, frames), dtype=torch.bool, device=DEVICE),
        )[0]
        raw, roots = self.decode(
            (normalized * self.std + self.mean).cpu().numpy(), "full55"
        )
        return s2g_pose(raw, roots, self.parents)

    @torch.inference_mode()
    def warm(self):
        t2m_pose(t2m.generate(self.t2m, self.embeddings["presence_poised"], 120))
        audio = np.zeros(32000, dtype=np.float32)
        for language, model in self.aligners.items():
            values = self.extractors[language](
                audio, sampling_rate=16000, return_tensors="pt"
            ).to(DEVICE)
            model(**values)
        self.prepare.hubert_features(
            self.aligners["en"].hubert, self.extractors["en"], audio, 60, DEVICE
        )
        self.translator.generate(
            **self.tokenizer(
                ["дорожка", "ветер"], return_tensors="pt", padding=True
            ).to(DEVICE),
            max_new_tokens=6,
            num_beams=1,
        )
        self.sample_s2g(
            np.zeros((24, 1024), dtype=np.float32),
            self.word_weights[np.zeros(24, dtype=int)],
            24,
            42,
        )
        torch.cuda.synchronize()

    @torch.inference_mode()
    def speech_pose(self, speech, seed):
        frames = speech["frames"]
        context_frames, remainder = divmod(speech["contextSamples"], FRAME_SAMPLES)
        following_frames, following_remainder = divmod(
            speech["followingSamples"], FRAME_SAMPLES
        )
        language = speech["language"]
        if (
            language not in self.aligners
            or not 8 <= frames <= 24
            or frames % 4
            or remainder
            or not 0 <= context_frames <= 24
            or following_remainder
            or not 0 <= following_frames <= 8
        ):
            raise ValueError("Invalid requested speech window")
        pcm = np.frombuffer(
            base64.b64decode(speech["pcm"], validate=True), dtype="<f4"
        ).copy()
        total = frames + context_frames + following_frames
        if len(pcm) != total * FRAME_SAMPLES or not np.isfinite(pcm).all():
            raise ValueError("Invalid Fish PCM frame count")
        audio = resample(torch.from_numpy(pcm), 44100, 16000).numpy()
        inputs = self.extractors[language](
            audio, sampling_rate=16000, return_tensors="pt"
        ).to(DEVICE)
        emissions = self.aligners[language](**inputs).logits[0]
        observed = list(
            observed_words(emissions.argmax(-1).tolist(), self.alphabet[language])
        )
        admitted = set(WORDS.findall(speech["text"].lower().replace("ё", "е")))
        observed = [
            (word.replace("ё", "е"), start, end) for word, start, end in observed
        ]
        accepted = list(
            dict.fromkeys(word for word, _, _ in observed if word in admitted)
        )[:32]
        if not accepted:
            return None
        if language == "ru":
            translations = self.translator.generate(
                **self.tokenizer(accepted, return_tensors="pt", padding=True).to(
                    DEVICE
                ),
                max_new_tokens=6,
                num_beams=1,
            )
            mapped = [
                WORDS.findall(value.lower())
                for value in self.tokenizer.batch_decode(
                    translations, skip_special_tokens=True
                )
            ]
            lookup = {
                word: next((self.vocab[key] for key in keys if key in self.vocab), 3)
                for word, keys in zip(accepted, mapped, strict=True)
            }
        else:
            lookup = {word: self.vocab.get(word, 3) for word in accepted}
        if all(index in (0, 3) for index in lookup.values()):
            return None
        indices = np.zeros(total, dtype=int)
        for word, start, end in observed:
            # HuBERT/XLSR use 320 input samples per CTC step with a 400-sample receptive field.
            left = min(total, (start * 320 + 40) * FPS // 16000)
            right = min(total, max(left + 1, ((end * 320 + 40) * FPS + 15999) // 16000))
            indices[left:right] = lookup.get(word, 3)
        acoustic = self.prepare.hubert_features(
            self.aligners["en"].hubert, self.extractors["en"], audio, total, DEVICE
        )
        return tuple(
            track[context_frames : context_frames + frames]
            for track in self.sample_s2g(
                acoustic, self.word_weights[indices], total, seed
            )
        )

    def generate(self, request):
        start = time.perf_counter()
        name, seed, from_frame = (
            request[key] for key in ("profileId", "seed", "fromFrame")
        )
        speech = request.get("speech")
        frames = request["frames"]
        # Keep overlapping windows on the same variation while letting the
        # next spoken reply take a different path on the same avatar lease.
        pose = (
            self.speech_pose(speech, seed ^ crc32(speech["playbackId"].encode()))
            if speech
            else None
        )
        source = {"weightsRevision": WEIGHTS_REVISION, "mode": "t2m"}
        contacts = [
            {key: 0 for key in ("leftHeel", "leftToe", "rightHeel", "rightToe")}
        ]
        if pose is None:
            self.last_speech_motion = None
            if (
                frames == 24
                and request["plan"]["clockDomain"] == "speech"
                and request.get("activity", {}).get("speaking")
            ):
                frames = 8
            dance_style = request["plan"].get("danceStyle")
            key = name, seed, dance_style
            if self.last_text_motion is None or self.last_text_motion[0] != key:
                embedding = (
                    self.dance_embeddings[dance_style]
                    if dance_style
                    else self.embeddings[name]
                )
                track = t2m.generate(self.t2m, embedding, 120, seed)
                self.last_text_motion = (
                    key,
                    t2m_pose(track),
                    track if dance_style else None,
                )
            source_frame = (
                0 if self.profiles[name].get("physicalAction") else from_frame
            )
            rotations, roots = resample_t2m(
                *self.last_text_motion[1], source_frame, frames
            )
            if dance_style:
                track = self.last_text_motion[2]
                cursor = np.arange(frames) * (20 / FPS)
                feet = track["joints"][:, [7, 8], :]
                source["danceFeet"] = (
                    np.stack(
                        [
                            np.interp(cursor, np.arange(len(feet)), foot)
                            for foot in feet.reshape(-1, 6).T
                        ],
                        axis=1,
                    )
                    .reshape(frames, 2, 3)
                    .tolist()
                )
                labels = np.clip(
                    track["humanml3d"][np.floor(cursor).astype(int), -4:], 0, 1
                )
                contacts = [
                    dict(
                        zip(
                            ("leftHeel", "leftToe", "rightHeel", "rightToe"),
                            row.tolist(),
                            strict=True,
                        )
                    )
                    for row in labels
                ]
        else:
            rotations, roots, fingers = pose
            identity = (
                *(
                    request[key]
                    for key in (
                        "sessionId",
                        "modelGeneration",
                        "avatarGeneration",
                        "epoch",
                    )
                ),
                request["plan"]["executionId"],
                speech["playbackId"],
            )
            previous = self.last_speech_motion
            if previous and previous[:2] == (identity, speech["startSample"]):
                blend_window(rotations, previous[2])
                blend_window(fingers, previous[3])
            self.last_speech_motion = (
                identity,
                speech["startSample"] + speech["frames"] * FRAME_SAMPLES,
                rotations[-1].copy(),
                fingers[-1].copy(),
            )
            source.update(
                mode="s2g",
                fingers=fingers.tolist(),
                speech={
                    key: speech[key] for key in ("playbackId", "startSample", "frames")
                },
            )
        roots[:, 1] += 0.9887084839474641 - roots[0, 1]
        return {
            **{
                key: request[key]
                for key in (
                    "sessionId",
                    "epoch",
                    "modelGeneration",
                    "avatarGeneration",
                    "id",
                    "reset",
                    "fromFrame",
                    "profileId",
                    "plan",
                    "seed",
                    "protocolVersion",
                )
            },
            "type": "motion",
            "startFrame": from_frame,
            "fps": FPS,
            "skeleton": self.catalog["flashMotionFormat"]["skeleton"],
            "sourceProvider": "flashmotion",
            "flashMotion": source,
            "rotations": rotations.tolist(),
            "rootPositions": roots.tolist(),
            "footContacts": contacts
            if len(contacts) > 1
            else contacts * len(rotations),
            "inferenceMs": (time.perf_counter() - start) * 1000,
        }


def blend_window(current, previous):
    for slot in range(current.shape[1]):
        transition = Rotation.from_quat([previous[slot], current[3, slot]])
        current[:3, slot] = Slerp([0, 1], transition)([0.15, 0.4, 0.75]).as_quat()


def main():
    inbox = queue.Queue(maxsize=1)
    threading.Thread(target=read_owner, args=(inbox,), daemon=True).start()
    torch.set_num_threads(2)
    emit({"type": "state", "status": "warming"})
    with contextlib.redirect_stdout(sys.stderr):
        adapter = Adapter()
        adapter.warm()
        emit(
            {
                "type": "ready",
                "protocolVersion": 1,
                "catalogRevision": adapter.catalog["catalogRevision"],
                "sourceRevision": SOURCE_REVISION,
                "weightsRevision": WEIGHTS_REVISION,
            }
        )
        previous = None
        while True:
            request = validate_request(json.loads(inbox.get()), adapter.profiles)
            validate_continuation(previous, request)
            emit(adapter.generate(request))
            previous = {key: request[key] for key in ("id", "profileId", "plan")}
            del request


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError:
        emit({"type": "error", "code": "MOTION_ASSETS_MISSING"})
        raise
    except torch.cuda.OutOfMemoryError:
        emit({"type": "error", "code": "MOTION_OUT_OF_MEMORY"})
        raise
    except ValueError as error:
        emit(
            {
                "type": "error",
                "code": "MOTION_ASSET_HASH_MISMATCH"
                if "SHA-256 mismatch" in str(error)
                else "MOTION_INFERENCE_FAILED",
            }
        )
        raise
    except Exception:
        emit({"type": "error", "code": "MOTION_INFERENCE_FAILED"})
        raise
