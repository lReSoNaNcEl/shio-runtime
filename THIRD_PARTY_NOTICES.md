# Third-Party Notices

This inventory covers the direct third-party components added for Shio Desktop
Capabilities, Markdown presentation, and delegated browser automation. The locked
package manifests remain the source of exact dependency resolution. License files
distributed by each package remain alongside that package in the application
bundle.

| Component | Locked version | License | Source |
| --- | ---: | --- | --- |
| `ai` | 7.0.156 | Apache-2.0 | <https://github.com/vercel/ai> |
| `@ai-sdk/openai-compatible` | 3.0.80 | Apache-2.0 | <https://github.com/vercel/ai> |
| `streamdown` | 2.5.0 | Apache-2.0 | <https://github.com/vercel/streamdown> |
| `rehype-harden` | 1.1.8 | MIT | <https://github.com/vercel-labs/markdown-sanitizers> |
| `playwright-core` | 1.62.1 | Apache-2.0 | <https://github.com/microsoft/playwright> |
| `@deepseek-ai/cordis` | 4.0.6-alpha.1 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/cordis-plugin-include` | 1.0.11-alpha.1 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.7-alpha.1 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/cordis-plugin-timer` | 1.1.8-alpha.1 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-llm-pi-ai` | 0.2.2-alpha.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-pwsh-local` | 0.2.2-alpha.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-tool-pwsh` | 0.2.2-alpha.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-subprocess-local` | 0.2.2-alpha.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-shell` and `@deepseek-ai/dsh-shell-env` | 0.2.2-alpha.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-*` runtime family used by Shio | 0.2.2-alpha.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |

The DeepSeek Harness packages are Developer Preview software. Shio pins the
compatible DSH runtime family exactly and does not resolve or upgrade these packages
at application runtime.

The active experimental development stack uses MotionBricks and SOMA-X Hand;
source/model pins are in `apps/desktop/motionbricks/research-pins.json`. Source,
model and evaluation-sample licenses are distinct; see
`docs/EXPERIMENT-MOTIONBRICKS-SOMAX-LICENSING-2026-10-28.md`. The new standing pose
has exact repository provenance in its metadata, but the source VRMA's original
redistribution license is not established.

The following ARDY/LLM2Vec rows document the removed historical experiment. Its
copied notices remain accessible in Git at `7fd6a1490589e03d7b4790ec16667c955bb1c253`
under `apps/desktop/motion/licenses/`; they are no longer active dependencies.
Speech API rows remain applicable independently.

| Component | Pinned revision | Upstream license notice |
| --- | --- | --- |
| NVIDIA ARDY source | `e706e27acc88070918308a10922b8f7174d0825e` | Apache-2.0; copied in Motion `licenses/ARDY-SOURCE-LICENSE.txt` |
| ARDY SOMA RP 30FPS Horizon60 | `244215084b22fcd29ab743017330e87411fe168a` | NVIDIA Open Model License; Motion `licenses/ARDY-MODEL-LICENSE.txt` |
| Meta Llama 3 8B Instruct | `8afb486c1db24fe5011ec46dfbe5b5dccdb575c2` | Llama 3 Community License and use policy; copied in Motion `licenses/` |
| LLM2Vec mntp / supervised adapters | `31474e395ada192e8ed1586db6be79fb3b70c9c0` / `baa8ebf04a1c2500e61288e7dad65e8ae42601a7` | MIT model-card metadata; the base model has its own terms |
| Fish S2 source | `541566932abbaebcb0a40e562a1f846738383f38` | Fish Audio Community License; API `licenses/FISH-SOURCE-LICENSE.md` |
| Fish S2 Pro model | `1de9996b6be38b745688de084d87a5633f714e4e` | Fish Audio Research License; API `licenses/FISH-MODEL-LICENSE.md` |

Source and model notices are distinct. The pinned Fish model notice is the
March 7, 2026 research license; the source notice does not replace that notice.
