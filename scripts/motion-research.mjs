// Explicit developer research commands. Never imported by Electron or renderer.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const motion = path.join(root, 'apps', 'desktop', 'motion')
const python = path.join(motion, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const action = process.argv[2]
const args = process.argv.slice(3)
const actions = new Set(['install', 'prefetch', 'doctor', 'probe', 'test'])
if (!actions.has(action)) throw new Error(`Unknown motion research action: ${action}`)

const environment = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']) {
  if (process.env[key]) environment[key] = process.env[key]
}
environment.UV_CACHE_DIR = path.join(motion, '.cache', 'uv')
environment.UV_PYTHON_INSTALL_DIR = path.join(motion, '.python')
environment.TEMP = path.join(motion, '.tmp')
environment.TMP = environment.TEMP
environment.PYTHONUTF8 = '1'
environment.RUFF_CACHE_DIR = path.join(motion, '.ruff_cache')
mkdirSync(environment.TEMP, { recursive: true })
if (['prefetch', 'doctor'].includes(action)) {
  for (const key of ['HF_TOKEN', 'HF_HOME', 'HF_TOKEN_PATH']) {
    if (process.env[key]) environment[key] = process.env[key]
  }
}

function run(executable, parameters) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, parameters, { cwd: root, env: environment, stdio: 'inherit', windowsHide: true })
    const stop = () => child.kill('SIGTERM')
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    child.once('error', reject)
    child.once('exit', (code) => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(executable)} failed (${code})`))
    })
  })
}

try {
  if (action === 'install') {
    if (args.length) throw new Error('Install takes no arguments')
    if (!existsSync(python)) await run('uv', ['venv', '--python', '3.12.13', '--managed-python', path.join(motion, '.venv')])
    await run('uv', ['pip', 'install', '--python', python, 'torch==2.11.0+cu128', '--index-url', 'https://download.pytorch.org/whl/cu128'])
    await run('uv', ['pip', 'install', '--python', python, '-r', path.join(motion, 'requirements-research.lock.txt')])
  } else {
    if (!existsSync(python)) throw new Error('Run npm run motion:research:install first')
    await run(python, action === 'test'
      ? ['-m', 'pytest', path.join(motion, 'tests'), ...args]
      : [path.join(motion, 'research.py'), action, ...args])
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
