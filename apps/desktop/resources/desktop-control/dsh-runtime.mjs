import { pathToFileURL } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = `${pathToFileURL(process.cwd()).href}/`

await ctx.plugin(Loader)

// Electron's embedded Node exposes the internal ESM loader, but importing the
// same Cordis graph through it and through normal ESM creates incompatible
// private scope identities. The public loader path keeps one module graph in
// both development and packaged runtimes.
ctx.loader.internal = undefined

await ctx.loader.create({
  name: '@deepseek-ai/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
