"""Fetch and verify FlashMotion inference assets in an ignored local directory."""

import argparse
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from urllib.request import urlopen

SOURCE_URL = "https://github.com/Sun-Happy-YKX/FlashMotion-release.git"
SOURCE_REVISION = "bed5510b8770762f6df780bf152725d4c49c0f49"
WEIGHTS_URL = "https://huggingface.co/yangkaixing/FlashMotion-models"
WEIGHTS_REVISION = "fcf613fa1742b1655c7299e10de8c8dfc332a8c6"
UMT5_URL = "https://huggingface.co/google/umt5-xxl"
UMT5_REVISION = "66cb9e7e85526fe440a945569e42c72fb6cbc0ad"
HUBERT_URL = "https://huggingface.co/facebook/hubert-large-ls960-ft"
HUBERT_REVISION = "ece5fabbf034c1073acae96d5401b25be96709d8"
RU_ALIGN_URL = "https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-russian"
RU_ALIGN_REVISION = "2329100508896c6d9b157019803ab5601e6f3406"
TRANSLATOR_URL = "https://huggingface.co/Helsinki-NLP/opus-mt-ru-en"
TRANSLATOR_REVISION = "fbd6dc73284f95536648512cc21d57f19191961a"
TRANSLATOR_FILES = {
    "config.json": "5ea76c78596bce8fe005ef89e00de0924bf83e5f532ce08784ff1fcefb699f5f",
    "generation_config.json": "31cff5e74efc263ff53efac09e3e350cd462d5c8198b1136b455d63a02d8cad5",
    "pytorch_model.bin": "535450eb5613f3cc912f9ca3e54cfef6c14d201b319c24a88faf776a65538b5d",
    "source.spm": "745998e51ba5b058e38b7ac7765c25c43ed5c1c39cc92b27163b9b2e323c9d7c",
    "target.spm": "16bebef1389a0b8ab452772c4e35b9e605e5713f8ac7baa71ca701394eaa086d",
    "tokenizer_config.json": "8d826099b8c67179c83ab4ff94aff7ca7bf24ca14319cb0287b9a0b4c40b2a96",
    "vocab.json": "33e95da3be3fa3b50169c4c46693ba2f29fbf4cb29d99044bd07d72d181fa1e9",
}
VOCAB_URL = (
    "https://huggingface.co/datasets/haiyangliu0/BEAT2_Tools/resolve/"
    "94f0ecb26dc66219b6a8216b9999d6b2eda505b5/emage_weights/vocab.pkl"
)
VOCAB_SHA256 = "54fbcea7b19e0ee9b5c5836c85087a682d3a9513041091ce3e95d83eed0b2acd"
HUBERT_FILES = {
    "config.json": "f87fc63802e37115034d1018c663b61ccd26000e78461a50fbca8fddddc4f429",
    "preprocessor_config.json": "a2254a5b58f72cd4de3632f8eee64f3f098b7c1402128d2f419e7d00ae13e335",
    "pytorch_model.bin": "9cf43abec3f0410ad6854afa4d376c69ccb364b48ddddfd25c4c5aa16398eab0",
    "vocab.json": "19727f8944fe6459fc3f240ae2c198395b740f6a029bd23e06656266b83bcf64",
}
RU_ALIGN_FILES = {
    "config.json": "9f02bcac826a79be1bc20cff20fb2ed830f3538ec282c65050f9195d61499deb",
    "preprocessor_config.json": "ca5999a45e98bb76ea87a461ba28a23ad32a5bb9f733b8e0f6546ff38b6c612d",
    "pytorch_model.bin": "d1cdb1a7921de7d363f967a9b0101a713602e109dba62b6f3f9ae2e0b2df0c1c",
    "vocab.json": "3def5e6b6c6fcbe9a674e58b8f7f9e608742414db0188ec50bb3ac565612f0d7",
}

CHECKPOINTS = {
    "s2g": (
        "s2g/full55_r2/epoch_03200.pt",
        "a6f5dcfab53dace000485ef475b1e714c21c5441209ef3343326d43befda2c2b",
    ),
    "t2m": (
        "t2m/t2m_adain_selection_8000ep_20260923/adain_selection/checkpoints/step-0100100.pt",
        "d1f5848ca560c7812566abef413d1f532e3652f44030af4388ef3447a5932846",
    ),
}
S2G_STATS_SHA256 = "cc65a7737f6ef09a727987ca73cde8cb320c66b16645d5bc0579ffd57fbe2e28"
UMT5_FILES = {
    "config.json": "17a62e1c5e1cdfa62dd15794081a523d1310c77135ad99158a9bd5cfbdef83f6",
    "tokenizer.json": "af904105ce1071b1202bba0059a841f4a7b85b48b6ec179c4948e3483476e0dd",
    "tokenizer_config.json": "616015e2b6c26f9a98ae3171634518d440a46260ebc1115c2596792d33827bdc",
    "special_tokens_map.json": "14ef492a69e59396e918521a5f8394af1acf9f8dddd47273693b2b42570dfd12",
    "pytorch_model.bin.index.json": "18581b6ecc69c76df6b1fd19d932ac1bbf5709e310f361f3cbaa96718bb59deb",
    "pytorch_model-00001-of-00006.bin": "382094214dfe74d782769f61ad95cfe32fdd297ae51f16f9208afa180b355e61",
    "pytorch_model-00002-of-00006.bin": "b49efce006c907ea93eb38658577d5c8d4e85b4bab398a0c6ba25141927529d4",
    "pytorch_model-00003-of-00006.bin": "da3d39fffe6464247531c20696715860ccaabdaaad3d5a2979dc2e2fbb7789fc",
}


def verify_file(path, expected):
    if not path.is_file():
        raise FileNotFoundError(f"Missing inference asset: {path.name}")
    digest = sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    actual = digest.hexdigest()
    if actual != expected:
        raise ValueError(f"SHA-256 mismatch for {path.name}: {actual}")
    return path


def fetch_file(path, url, expected):
    if path.exists():
        return verify_file(path, expected)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = None
    try:
        with NamedTemporaryFile(
            dir=path.parent, prefix=f"{path.name}.", suffix=".partial", delete=False
        ) as output:
            partial = Path(output.name)
            with urlopen(url, timeout=120) as response:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        verify_file(partial, expected)
        partial.replace(path)
    finally:
        if partial is not None:
            partial.unlink(missing_ok=True)
    return path


def verify_source(source):
    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(source), *args], text=True
        ).strip()

    if git("rev-parse", "HEAD") != SOURCE_REVISION or git(
        "status", "--porcelain", "--untracked-files=all"
    ):
        raise ValueError(
            "FlashMotion source must be the clean pinned upstream revision"
        )
    return source


def checkpoint(assets, mode):
    remote, expected = CHECKPOINTS[mode]
    return verify_file(assets / Path(remote).name, expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("--include-umt5", action="store_true")
    parser.add_argument("--include-s2g-inputs", action="store_true")
    parser.add_argument(
        "--check", action="store_true", help="Verify existing assets offline"
    )
    args = parser.parse_args()
    assets = args.assets.resolve()
    source = assets / "upstream"
    if not args.check and not source.exists():
        assets.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix="source-", dir=assets) as staging:
            clone = Path(staging) / "upstream"
            subprocess.run(["git", "init", "--quiet", str(clone)], check=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(clone),
                    "fetch",
                    "--depth",
                    "1",
                    SOURCE_URL,
                    SOURCE_REVISION,
                ],
                check=True,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(clone),
                    "checkout",
                    "--quiet",
                    "--detach",
                    SOURCE_REVISION,
                ],
                check=True,
            )
            verify_source(clone).rename(source)
    print(verify_source(source), flush=True)

    def prepare(path, url, expected):
        verified = (
            verify_file(path, expected)
            if args.check
            else fetch_file(path, url, expected)
        )
        print(verified, flush=True)

    for remote, expected in CHECKPOINTS.values():
        prepare(
            assets / Path(remote).name,
            f"{WEIGHTS_URL}/resolve/{WEIGHTS_REVISION}/{remote}",
            expected,
        )
    if args.include_umt5:
        for name, expected in UMT5_FILES.items():
            prepare(
                assets / "umt5" / name,
                f"{UMT5_URL}/resolve/{UMT5_REVISION}/{name}",
                expected,
            )
    if args.include_s2g_inputs:
        for directory, url, revision, files in (
            ("hubert", HUBERT_URL, HUBERT_REVISION, HUBERT_FILES),
            ("ru-align", RU_ALIGN_URL, RU_ALIGN_REVISION, RU_ALIGN_FILES),
            ("ru-en", TRANSLATOR_URL, TRANSLATOR_REVISION, TRANSLATOR_FILES),
        ):
            for name, expected in files.items():
                prepare(
                    assets / directory / name,
                    f"{url}/resolve/{revision}/{name}",
                    expected,
                )
        prepare(assets / "vocab.pkl", VOCAB_URL, VOCAB_SHA256)


if __name__ == "__main__":
    main()
