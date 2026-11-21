"""Build the two native providers for the RTX 5090 in an isolated Linux venv."""

import argparse
import os
import runpy
import subprocess
import sys
import sysconfig
import tarfile
from concurrent.futures import ThreadPoolExecutor
from importlib.metadata import distribution
from pathlib import Path

from assets import fetch_file, verify_source

PACKAGES = (
    (
        "mamba_ssm-2.2.6.post3",
        "b6/0c/9373a469ff7a33bdd0644e55fa45165ba3900274dcf7fe9f10ccc232aef9",
        "826a3cdb651959f191dac64502f8a29627d9116fe6bb7c57e4f562da1aea7bf3",
        "MAMBA_FORCE_BUILD",
    ),
    (
        "causal_conv1d-1.5.3.post1",
        "64/cb/104778c728dc3d5ea3bf65a484e3a4cdbe894bdaa2586320e2f61d007b8c",
        "aba1b717484472d0b2f2e40520a1c03f35fe5155555bd753d1c324afc56ba468",
        "CAUSAL_CONV1D_FORCE_BUILD",
    ),
)
CUDA_HOME = Path("/usr/local/cuda-12.8")
BUILD_FLAG = '"arch=compute_120,code=sm_120"'


def build_package(package, assets, stage, wheel_dir):
    slug, remote, expected, force = package
    name = f"{slug}.tar.gz"
    archive = fetch_file(
        assets / name,
        f"https://files.pythonhosted.org/packages/{remote}/{name}",
        expected,
    )
    with tarfile.open(archive) as tar:
        tar.extractall(stage, filter="data")
    project = stage / slug
    setup = project / "setup.py"
    source = setup.read_text()
    marker = "    # HACK: The compiler flag"
    if source.count(marker) != 1 or BUILD_FLAG not in source:
        raise ValueError(f"Unexpected CUDA build flags in {slug}")
    setup.write_text(
        source.replace(marker, f'    cc_flag = ["-gencode", {BUILD_FLAG}]\n\n{marker}')
    )
    nvidia = Path(sysconfig.get_path("platlib")) / "nvidia"
    env = {
        **os.environ,
        force: "TRUE",
        "CUDA_HOME": str(CUDA_HOME),
        "MAX_JOBS": "5",
        "NVCC_THREADS": "1",
        "CPLUS_INCLUDE_PATH": ":".join(str(path) for path in nvidia.glob("*/include")),
    }
    log = stage / f"{slug}.log"
    command = [
        sys.executable,
        "-m",
        "pip",
        "wheel",
        "--no-build-isolation",
        "--no-deps",
        "--verbose",
        "--wheel-dir",
        str(wheel_dir),
        ".",
    ]
    with log.open("x") as handle:
        result = subprocess.run(
            command, cwd=project, env=env, stdout=handle, stderr=subprocess.STDOUT
        )
    result.check_returncode()
    print(f"Built {slug}; {log}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("new_build_dir", type=Path)
    args = parser.parse_args()
    if not sys.platform.startswith("linux") or sys.prefix == sys.base_prefix:
        raise ValueError("Use a dedicated Linux venv")
    if not (CUDA_HOME / "bin/nvcc").is_file():
        raise ValueError("Install the CUDA 12.8 toolkit first")
    import torch

    if torch.__version__ != "2.7.1+cu128" or torch.cuda.get_device_capability() != (
        12,
        0,
    ):
        raise ValueError(
            "Expected PyTorch 2.7.1+cu128 on a compute capability 12.0 GPU"
        )
    assets = args.assets.resolve()
    src = verify_source(assets / "upstream")
    stage = args.new_build_dir.resolve()
    stage.mkdir(parents=True, exist_ok=False)
    wheel_dir = stage / "wheels"
    wheel_dir.mkdir()
    with ThreadPoolExecutor(max_workers=len(PACKAGES)) as pool:
        for future in [
            pool.submit(build_package, pkg, assets, stage, wheel_dir)
            for pkg in PACKAGES
        ]:
            future.result()
    wheels = sorted(wheel_dir.glob("*.whl"))
    if len(wheels) != len(PACKAGES):
        raise ValueError("Expected one wheel per native provider")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-deps", *map(str, wheels)],
        check=True,
    )
    patch = runpy.run_path(str(src / "tools/patch_mamba_interface.py"))
    target = Path(
        distribution("mamba-ssm").locate_file(
            "mamba_ssm/ops/selective_scan_interface.py"
        )
    )
    print(patch["patch_file"](target, Path(sys.prefix), apply=True), flush=True)


if __name__ == "__main__":
    main()
