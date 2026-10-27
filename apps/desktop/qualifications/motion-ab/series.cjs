const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = fs.readFileSync(path.join(__dirname, '.latest-root'), 'utf8').trim()
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|userprofile|localappdata|appdata|temp|tmp|programfiles|programfiles\(x86\)|programw6432|systemdrive|comspec|pathext|cuda_path)$/i.test(
      key,
    ),
  ),
)
const cases = 'greeting,fox-paw,peace'
const runs = [
  ['core8', 503, `--cases=${cases}`, '--no-video'],
  ['soma60', 503, `--cases=${cases}`, '--no-video'],
  ['soma60', 10009, `--cases=${cases}`, '--no-video'],
  ['core8', 10009, `--cases=${cases}`, '--no-video'],
  ['core8', 17, `--cases=${cases}`, '--preview', '--overlay'],
  ['soma60', 17, `--cases=${cases}`, '--preview', '--overlay'],
  ['core8', 17, '--cases=greeting', '--cancel-after-pcm=1200', '--no-video', '--overlay'],
  ['soma60', 17, '--cases=greeting', '--cancel-after-pcm=1200', '--no-video', '--overlay'],
]
const results = []
for (let index = 0; index < runs.length; index++) {
  const [variant, seed, ...options] = runs[index]
  const log = path.join(root, `series-${index}-${variant}-${seed}.log`)
  const descriptor = fs.openSync(log, 'w')
  console.log(JSON.stringify({ stage: 'start', index, variant, seed, options, log }))
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'run.cjs'), `--variant=${variant}`, `--seed=${seed}`, ...options],
    {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', descriptor, descriptor],
      timeout: 900000,
    },
  )
  fs.closeSync(descriptor)
  results.push({
    index,
    variant,
    seed,
    options,
    exitCode: result.status,
    error: result.error?.name ?? null,
    log,
  })
  fs.writeFileSync(path.join(root, 'series.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ stage: 'finished', ...results.at(-1) }))
  if (result.error) break
}
