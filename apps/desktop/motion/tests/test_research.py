"""Research preparation tests; these do not qualify the future motion worker."""

import io
import json
import zipfile

import pytest

from research import load_pins, unpack_source


def archive_bytes(files):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        for name, contents in files:
            archive.writestr(name, contents)
    return data.getvalue()


def test_source_archive_preserves_file_contents(tmp_path):
    unpack_source(archive_bytes([("ardy-commit/ardy/model.py", b"# model\n")]), tmp_path)
    assert (tmp_path / "ardy" / "model.py").read_bytes() == b"# model\n"


@pytest.mark.parametrize(
    "path",
    [
        "ardy-commit/../../escape.py",
        "ardy-commit/ardy/../../../escape.py",
        "ardy-commit/..\\escape.py",
        "other-prefix/escape.py",
    ],
)
def test_rejects_entire_unsafe_archive_before_writing(tmp_path, path):
    data = archive_bytes([("ardy-commit/safe.py", b"safe"), (path, b"unsafe")])
    with pytest.raises(ValueError, match="Unsafe"):
        unpack_source(data, tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_rejects_symbolic_link(tmp_path):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        info = zipfile.ZipInfo("ardy-commit/link")
        info.create_system = 3
        info.external_attr = 0o120777 << 16
        archive.writestr(info, "../../outside")
    with pytest.raises(ValueError, match="Unsafe"):
        unpack_source(data.getvalue(), tmp_path)
    assert not (tmp_path / "link").exists()


def test_rejects_empty_archive(tmp_path):
    with pytest.raises(ValueError, match="limits"):
        unpack_source(archive_bytes([]), tmp_path)


@pytest.mark.parametrize("revision", ["main", "latest", "123", "A" * 40])
def test_rejects_floating_or_invalid_revision(tmp_path, revision):
    pins = load_pins()
    pins["textEncoder"][0]["revision"] = revision
    manifest = tmp_path / "pins.json"
    manifest.write_text(json.dumps(pins), encoding="utf-8")
    with pytest.raises(ValueError, match="exact commit"):
        load_pins(manifest)


def test_pins_exact_source_and_all_three_encoder_components():
    pins = load_pins()
    assert len(pins["textEncoder"]) == 3
    assert pins["textEncoder"][0]["repository"] == "meta-llama/Meta-Llama-3-8B-Instruct"
    assert pins["motion"]["historyFrames"] + pins["motion"]["horizonFrames"] <= 200
