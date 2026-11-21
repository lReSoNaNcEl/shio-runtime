"""Measure WSL process cleanup when its Windows stdio owner closes."""

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

WORKER = """\
import os, sys, threading
import torch

def watch_owner():
    if sys.stdin.buffer.read(1) == b"":
        os._exit(0)

threading.Thread(target=watch_owner, daemon=True).start()
sample = torch.ones((512, 512), device="cuda")
sample.mm(sample)
torch.cuda.synchronize()
print(os.getpid(), flush=True)
while True:
    sample.mm(sample)
    torch.cuda.synchronize()
"""

PROBE = """\
import os, signal, sys
from pathlib import Path
pid, token, kill = sys.argv[1:]
try:
    identity = Path("/proc", pid, "cmdline").read_bytes().split(bytes([0]))
except FileNotFoundError:
    identity = []
owned = token.encode() in identity
if owned and kill == "yes":
    os.kill(int(pid), signal.SIGKILL)
print("alive" if owned else "gone")
"""


def measure(wsl, abrupt):
    token = str(uuid4())
    owner = subprocess.Popen(
        [*wsl, "-u", "-c", WORKER, token],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    pid = None
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            line = executor.submit(owner.stdout.readline)
            try:
                pid = int(line.result(timeout=30).strip())
            except Exception:
                owner.stdin.close()
                owner.kill()
                raise
        started = time.monotonic()
        if abrupt:
            owner.kill()
        else:
            owner.stdin.close()
        owner.wait(timeout=8)
        for _ in range(12):
            reply = subprocess.check_output(
                [*wsl, "-c", PROBE, str(pid), token, "no"],
                text=True,
                timeout=8,
            )
            if reply.strip() == "gone":
                return {
                    "condition": "relay-killed" if abrupt else "stdin-closed",
                    "linuxWorkerGone": True,
                    "observedWithinMs": round((time.monotonic() - started) * 1000),
                }
            time.sleep(0.2)
        raise RuntimeError("Linux CUDA worker survived the Windows relay")
    finally:
        owner.stdin.close()
        if owner.poll() is None:
            owner.kill()
            owner.wait(timeout=8)
        owner.stdout.close()
        if pid is not None:
            subprocess.run(
                [*wsl, "-c", PROBE, str(pid), token, "yes"],
                check=True,
                capture_output=True,
                timeout=8,
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("distro")
    parser.add_argument("python", help="Absolute Linux venv interpreter")
    args = parser.parse_args()
    if sys.platform != "win32" or not args.python.startswith("/"):
        raise ValueError("Run on Windows with an isolated Linux venv")
    wsl = ["wsl.exe", "--distribution", args.distro, "--cd", "/", "--exec", args.python]
    for abrupt in (False, True):
        print(json.dumps(measure(wsl, abrupt)), flush=True)


if __name__ == "__main__":
    main()
