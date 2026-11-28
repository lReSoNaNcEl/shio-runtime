const fs = require('node:fs/promises')
const path = require('node:path')

function writeWatchProfile(directory, { uiTheme, speechVolumePercent, micDeviceId }) {
  const role = { providerId: 'codex-cli', model: 'gpt-6-luna' }
  return fs.writeFile(
    path.join(directory, 'config.json'),
    JSON.stringify({
      setup: { completed: true },
      uiLocale: 'ru',
      uiTheme,
      micDeviceId,
      speechVolumePercent,
      llm: {
        activeProvider: role.providerId,
        providers: {
          [role.providerId]: {
            model: role.model,
            codexReasoningByModel: { [role.model]: 'low' },
          },
        },
        roles: { characterFallbacks: [], computerUseVision: role },
      },
    }),
  )
}

module.exports = { writeWatchProfile }
