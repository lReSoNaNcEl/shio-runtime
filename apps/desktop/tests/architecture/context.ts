import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sourceFilesBelow } from '../support/architecture/sourceAst'

export const desktopRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const sourceRoot = join(desktopRoot, 'src')
export const sourceFiles = sourceFilesBelow(sourceRoot)
