# Third-Party Notices

This inventory covers the direct third-party components added for Shio Desktop
Capabilities, Markdown presentation, and delegated browser automation. The locked
package manifests remain the source of exact dependency resolution. License files
distributed by each package remain alongside that package in the application
bundle.

| Component | Locked version | License | Source |
| --- | ---: | --- | --- |
| `streamdown` | 2.5.0 | Apache-2.0 | <https://github.com/vercel/streamdown> |
| `rehype-harden` | 1.1.8 | MIT | <https://github.com/vercel-labs/markdown-sanitizers> |
| `playwright-core` | 1.62.1 | Apache-2.0 | <https://github.com/microsoft/playwright> |
| `@deepseek-ai/cordis` | 4.0.1 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/cordis-plugin-include` | 1.0.6 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-llm-pi-ai` | 0.1.1-rc.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-pwsh-local` | 0.1.1-rc.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-tool-pwsh` | 0.1.1-rc.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-subprocess-local` | 0.1.1-rc.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-shell` and `@deepseek-ai/dsh-shell-env` | 0.1.1-rc.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/dsh-*` runtime family used by Shio | 0.1.1-rc.2 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |

The DeepSeek Harness packages are Developer Preview software. Shio pins the
compatible DSH runtime family exactly and does not resolve or upgrade these packages
at application runtime.
