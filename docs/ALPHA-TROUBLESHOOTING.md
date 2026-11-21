# Troubleshoot the Windows alpha

- **FlashMotion cannot find WSL2 or build tools.** Check that `wsl -l -v` lists `ShioFlashMotionV1` as WSL2. Install Python 3.12, Git and the CUDA 12.8 build tools inside that distribution. [Installation instructions](ALPHA-INSTALL.md)
- **Download or compilation stopped.** Run `Start Shio Runtime.cmd repair`. It reuses verified assets. If a file reports a SHA-256 mismatch, move that named file out of `Data\FlashMotion` and rerun repair.
- **FlashMotion reports unavailable or degraded.** Run `Start Shio Runtime.cmd doctor` for CUDA and asset checks. If it passes, check Runtime Health for warmup, deadlines and memory errors. A steady safe pose can be shown while the generator is warming up or unavailable.
- **Speech Pack is preparing after Stop.** Fish cancellation stops the inference worker. Wait for Speech API to return to Ready before trying another utterance.
- **Port 8000 is occupied.** The launcher reuses a compatible Speech API and reports an incompatible listener. Check the existing service before restarting it.
- **Windows SmartScreen warns.** This alpha is unsigned. Verify the archive checksum and obtain the package from the maintainer.

Open the launcher log folder with `Start Shio Runtime.cmd open-logs`. Share the error and bounded Runtime Health report for support.
