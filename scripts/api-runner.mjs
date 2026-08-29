// Cross-platform launcher for the `api:*` root commands.
//
// Purpose (repository tooling only — no runtime / HTTP-contract changes):
// pick the correct Python interpreter for `apps/api` and run the requested
// action from a stable working directory, without requiring a manually activated
// virtualenv, a `python`/`python3` on PATH, or any shell-specific syntax.
//
// It never uses `shell: true`, inherits stdio, forwards the child exit code, and
// forwards Ctrl+C (SIGINT/SIGTERM) so uvicorn shuts down and port 8000 is freed.

import { spawnSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Repo root is the parent of this file's `scripts/` directory. Independent of cwd.
const repoRoot = path.resolve(__dirname, '..')
const apiRoot = path.join(repoRoot, 'apps', 'api')
const canonicalVenv = path.join(apiRoot, '.venv')
const staleVenvs = [
  path.join(repoRoot, 'services', 'api', '.venv'),
  path.join(repoRoot, 'services', 'api', 'venv'),
  path.join(apiRoot, 'venv'),
]
const ruffCacheDir = path.join(apiRoot, '.ruff_cache')

const isWindows = process.platform === 'win32'
const REQUIRED_PY = [3, 12]
const ALPHA_PIP_SPEC = 'pip>=25.3,<26'
const ALPHA_TORCH_VERSION = '2.11.0+cu128'
const BUILD_BOOTSTRAP = ['setuptools<82', 'wheel']

// --- Virtual environment discovery -----------------------------------------

function venvPython(venvDir) {
  return isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

// Resolve the Python interpreter to use for run-only actions.
// Priority: SHIO_API_PYTHON -> canonical .venv. Old environments are diagnostic
// signals only and are never executable fallbacks.
function findLocalPython() {
  const override = process.env.SHIO_API_PYTHON
  if (override) {
    if (!existsSync(override)) {
      fail(
        `SHIO_API_PYTHON points to a missing interpreter:\n  ${override}\n\n` +
          `Fix the path or unset SHIO_API_PYTHON.`,
      )
    }
    return { python: override, type: 'override' }
  }

  const py = venvPython(canonicalVenv)
  if (existsSync(py)) {
    return { python: py, type: '.venv' }
  }

  if (staleVenvs.some((dir) => existsSync(venvPython(dir)))) {
    console.error(
      'A virtual environment from the previous API layout was detected.\n\n' +
        'Recreate the canonical environment with:\n  npm run api:install:dev',
    )
  }

  return null
}

function staleEnvironmentStatus() {
  const detected = staleVenvs
    .filter((dir) => existsSync(venvPython(dir)))
    .map((dir) => path.relative(repoRoot, dir))
  return detected.length > 0 ? `detected (not used): ${detected.join(', ')}` : 'not found'
}

function processEnvironment() {
  return {
    ...process.env,
    RUFF_CACHE_DIR: ruffCacheDir,
  }
}

function targetVenvForInstall() {
  return {
    type: '.venv',
    dir: canonicalVenv,
    python: venvPython(canonicalVenv),
  }
}

// --- System Python discovery (bootstrap only) ------------------------------

// Each candidate is executable + prefix args (`py -3.12` is not a single path).
function systemPythonCandidates() {
  if (isWindows) {
    return [
      {
        executable: path.join(
          apiRoot,
          '.python',
          'cpython-3.12-windows-x86_64-none',
          'python.exe',
        ),
        prefixArgs: [],
      },
      { executable: 'py', prefixArgs: ['-3.12'] },
      { executable: 'python3.12', prefixArgs: [] },
      { executable: 'python', prefixArgs: [] },
      { executable: 'python3', prefixArgs: [] },
    ]
  }
  return [
    { executable: 'python3.12', prefixArgs: [] },
    { executable: 'python3', prefixArgs: [] },
    { executable: 'python', prefixArgs: [] },
  ]
}

function checkPythonVersion(cmd) {
  const res = spawnSync(
    cmd.executable,
    [...cmd.prefixArgs, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'],
    { encoding: 'utf8' },
  )
  if (res.error || res.status !== 0) return null
  const version = (res.stdout || '').trim()
  return version || null
}

// Find a Python 3.12 for creating the venv. Exits with a clear message otherwise.
function findSystemPython312() {
  let detected = null
  for (const cmd of systemPythonCandidates()) {
    const version = checkPythonVersion(cmd)
    if (!version) continue
    if (version === `${REQUIRED_PY[0]}.${REQUIRED_PY[1]}`) return cmd
    detected = detected ?? version
  }

  if (detected) {
    fail(
      `Python ${REQUIRED_PY[0]}.${REQUIRED_PY[1]} is required.\n` +
        `Detected: Python ${detected}`,
    )
  }
  fail(
    `Python ${REQUIRED_PY[0]}.${REQUIRED_PY[1]} was not found.\n` +
      `Install Python ${REQUIRED_PY[0]}.${REQUIRED_PY[1]} and rerun: npm run api:install`,
  )
}

// --- Process execution ------------------------------------------------------

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// Run a command to completion in apiRoot, forwarding stdio, exit code and signals.
function run(command, args) {
  const child = spawn(command, args, {
    cwd: apiRoot,
    stdio: 'inherit',
    shell: false,
    env: processEnvironment(),
  })

  const forward = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal)
      } catch {
        // child may already be gone
      }
    }
  }

  const onSigint = () => forward('SIGINT')
  const onSigterm = () => forward('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      if (signal) {
        // Mirror the child's terminating signal as a conventional exit code.
        resolve(128 + (signal === 'SIGTERM' ? 15 : 2))
      } else {
        resolve(code ?? 0)
      }
    })
    child.on('error', (err) => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      console.error(`Failed to start process: ${command}\n${err.message}`)
      resolve(1)
    })
  })
}

// Resolve the local Python for run-only actions, or exit with instructions.
function requireLocalPython() {
  const found = findLocalPython()
  if (!found) {
    fail(
      'API virtual environment was not found.\n\n' + 'Run:\n  npm run api:install:dev',
    )
  }
  return found.python
}

function apiServerConfig() {
  const host = process.env.SHIO_API_HOST ?? '127.0.0.1'
  const portText = process.env.SHIO_API_PORT ?? '8000'
  const port = Number(portText)

  if (!host.trim()) {
    fail('SHIO_API_HOST must not be empty.')
  }
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`SHIO_API_PORT must be an integer between 1 and 65535. Received: ${portText}`)
  }

  return { host, port: String(port) }
}

// Run `<python> <args...>` in apiRoot and forward the exit code.
async function runPython(python, args, extra) {
  const code = await run(python, [...args, ...extra])
  process.exit(code)
}

// --- Install actions --------------------------------------------------------

// Ensure the target venv exists, creating it with a system Python 3.12 if needed.
function ensureVenv() {
  const target = targetVenvForInstall()
  if (existsSync(target.python)) {
    const version = checkPythonVersion({ executable: target.python, prefixArgs: [] })
    if (version !== `${REQUIRED_PY[0]}.${REQUIRED_PY[1]}`) {
      fail(
        `The canonical environment must use Python ${REQUIRED_PY.join('.')}.\n` +
          `Detected Python ${version ?? 'unknown'} at:\n  ${target.python}\n\n` +
          'Remove apps/api/.venv and rerun the install command.',
      )
    }
    return target.python
  }

  const sysPy = findSystemPython312()
  console.error(`Creating virtual environment: ${path.relative(repoRoot, target.dir)}`)
  const res = spawnSync(
    sysPy.executable,
    [...sysPy.prefixArgs, '-m', 'venv', target.dir],
    { cwd: apiRoot, stdio: 'inherit', shell: false, env: processEnvironment() },
  )
  if (res.status !== 0) {
    fail('Failed to create the virtual environment.')
  }
  if (!existsSync(target.python)) {
    fail(`Virtual environment created but interpreter is missing:\n  ${target.python}`)
  }
  return target.python
}

// Run a pip step with the venv Python; exit on failure.
async function pip(python, args) {
  const code = await run(python, ['-m', 'pip', ...args])
  if (code !== 0) process.exit(code)
}

async function actionInstall(extra) {
  const python = ensureVenv()
  await pip(python, ['install', '--upgrade', ALPHA_PIP_SPEC])
  await pip(python, ['install', ...BUILD_BOOTSTRAP])
  await pip(python, [
    'install',
    '--no-build-isolation',
    '-r',
    'requirements.lock.txt',
    ...extra,
  ])
  process.exit(0)
}

async function actionInstallDev(extra) {
  const python = ensureVenv()
  await pip(python, ['install', '--upgrade', ALPHA_PIP_SPEC])
  await pip(python, ['install', ...BUILD_BOOTSTRAP])
  // requirements-dev.txt already includes `-r requirements.txt`, so this one
  // install covers both runtime and dev dependencies.
  await pip(python, [
    'install',
    '--no-build-isolation',
    '-r',
    'requirements-dev.lock.txt',
    ...extra,
  ])
  process.exit(0)
}

async function actionInstallAlpha(extra) {
  const python = ensureVenv()
  await pip(python, ['install', '--upgrade', ALPHA_PIP_SPEC])
  await pip(python, ['install', ...BUILD_BOOTSTRAP])
  await pip(python, ['install', '-r', 'requirements-torch-cu128.txt'])
  await pip(python, [
    'install',
    '--no-build-isolation',
    '-r',
    'requirements.lock.txt',
    ...extra,
  ])
  await pip(python, ['check'])
  const verify = [
    '-c',
    [
      'import torch, torchaudio',
      `assert torch.__version__ == "${ALPHA_TORCH_VERSION}", torch.__version__`,
      `assert torchaudio.__version__ == "${ALPHA_TORCH_VERSION}", torchaudio.__version__`,
      'print(f"Verified torch={torch.__version__} torchaudio={torchaudio.__version__}")',
    ].join(';'),
  ]
  const code = await run(python, verify)
  process.exit(code)
}

// --- Doctor -----------------------------------------------------------------

function printDoctor() {
  const found = findLocalPython()
  const py = found?.python ?? null
  let pyVersion = 'not resolved'
  if (py) {
    const res = spawnSync(py, ['--version'], { encoding: 'utf8' })
    pyVersion = ((res.stdout || '') + (res.stderr || '')).trim() || 'unknown'
  }

  const { host, port } = apiServerConfig()
  const report = [
    ['Platform', process.platform],
    ['Repository root', repoRoot],
    ['API root', apiRoot],
    ['Canonical environment', 'apps/api/.venv'],
    ['Stale environment', staleEnvironmentStatus()],
    ['Selected Python path', py ?? '(none — run: npm run api:install:dev)'],
    ['Python version', py ? pyVersion : 'n/a'],
    ['Virtual environment type', found?.type ?? 'none'],
    ['API bind address', `${host}:${port}`],
    ['Local URL', `http://localhost:${port}`],
    ['requirements.txt exists', existsSync(path.join(apiRoot, 'requirements.txt'))],
    [
      'requirements-dev.txt exists',
      existsSync(path.join(apiRoot, 'requirements-dev.txt')),
    ],
    ['.env exists', existsSync(path.join(apiRoot, '.env'))],
    ['voice_manifest.json exists', existsSync(path.join(apiRoot, 'voice_manifest.json'))],
    [
      'emotion_manifest.json exists',
      existsSync(path.join(apiRoot, 'emotion_manifest.json')),
    ],
  ]

  const width = Math.max(...report.map(([k]) => k.length))
  for (const [key, value] of report) {
    console.log(`${key.padEnd(width)} : ${value}`)
  }
}

function actionDoctor() {
  printDoctor()
  process.exit(0)
}

async function actionDoctorStrict() {
  const target = targetVenvForInstall()
  if (!existsSync(target.python)) {
    fail('Canonical API environment is missing: apps/api/.venv')
  }
  const version = checkPythonVersion({ executable: target.python, prefixArgs: [] })
  if (version !== `${REQUIRED_PY[0]}.${REQUIRED_PY[1]}`) {
    fail(`Strict doctor requires Python ${REQUIRED_PY.join('.')}. Detected: ${version}`)
  }
  apiServerConfig()
  let code = await run(target.python, ['-m', 'pip', 'check'])
  if (code !== 0) process.exit(code)
  code = await run(target.python, ['scripts/doctor_strict.py'])
  process.exit(code)
}

// --- Dispatch ---------------------------------------------------------------

const RUN_ACTIONS = {
  'voices-sync': ['scripts/sync_voices.py'],
  prefetch: ['scripts/prefetch_models.py'],
  start: ['-m', 'uvicorn', 'app.main:app'],
  dev: ['-m', 'uvicorn', 'app.main:app'],
  lint: ['-m', 'ruff', 'check', '.'],
  'lint-fix': ['-m', 'ruff', 'check', '.', '--fix'],
  format: ['-m', 'ruff', 'format', '.'],
  'format-check': ['-m', 'ruff', 'format', '--check', '.'],
  test: ['-m', 'pytest', 'tests'],
}

async function main() {
  const [, , action, ...extra] = process.argv

  if (!action) {
    fail('Usage: node scripts/api-runner.mjs <action> [-- args...]')
  }

  switch (action) {
    case 'install':
      return actionInstall(extra)
    case 'install-dev':
      return actionInstallDev(extra)
    case 'install-alpha':
      return actionInstallAlpha(extra)
    case 'doctor':
      return actionDoctor()
    case 'doctor-strict':
      return actionDoctorStrict()
    default: {
      const baseArgs = RUN_ACTIONS[action]
      if (!baseArgs) {
        fail(`Unknown action: ${action}`)
      }
      const python = requireLocalPython()
      if (action === 'dev' || action === 'start') {
        const { host, port } = apiServerConfig()
        console.log('Starting Shio Speech API')
        console.log(`Local URL: http://localhost:${port}`)
        console.log(`Bind address: ${host}:${port}`)
        if (host === '0.0.0.0') {
          console.log('Network access may be available depending on firewall settings.')
        }
        return runPython(python, [...baseArgs, '--host', host, '--port', port], extra)
      }
      return runPython(python, baseArgs, extra)
    }
  }
}

main()
