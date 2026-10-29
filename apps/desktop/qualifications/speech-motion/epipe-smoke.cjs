const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
// biome-ignore lint/correctness/noUndeclaredDependencies: Electron Vite supplies the bundler used by the existing qualification build commands.
const { buildSync } = require('esbuild')

const desktop = path.resolve(__dirname, '../..')
const root = path.join(
  desktop,
  'motion/.artifacts',
  `epipe-${new Date().toISOString().replace(/[:.]/g, '-')}`,
)
fs.mkdirSync(root, { recursive: true })
const bundle = path.join(desktop, 'out/epipe-fixture.cjs')
buildSync({
  entryPoints: [path.join(__dirname, 'epipe-fixture.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
})
const bootstrap = path.join(root, 'bootstrap.cjs')
// Observe every unexpected failure in a file and terminate the owned helper.
// This is a qualification failure, not a blanket production error suppression.
fs.writeFileSync(
  bootstrap,
  `
const fs=require('node:fs');const path=require('node:path');
function fail(error){try{fs.writeFileSync(path.join(process.env.SHIO_EPIPE_ROOT,'unexpected.json'),JSON.stringify({name:error?.name,message:String(error?.message??error).slice(0,500)}))}finally{require('electron').app.exit(1)}}
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
require(${JSON.stringify(bundle)});
`,
)
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|programfiles|programfiles\(x86\)|programw6432|systemdrive|comspec|temp|tmp|localappdata|appdata)$/i.test(
      key,
    ),
  ),
)
const child = spawn(require('electron'), [bootstrap], {
  cwd: desktop,
  windowsHide: true,
  env: { ...environment, SHIO_EPIPE_ROOT: root },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const report = { root, pid: child.pid, passed: false }
const completion = new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => resolve({ code, signal }))
})
let ready = false
const interval = setInterval(() => {
  if (ready || !fs.existsSync(path.join(root, 'ready.json'))) return
  ready = true
  child.stdout.destroy()
  child.stderr.destroy()
  fs.writeFileSync(path.join(root, 'closed-pipes.signal'), 'closed by owned parent')
}, 25)
const timeout = setTimeout(() => {
  report.timeout = true
  child.kill()
}, 15000)
;(async () => {
  try {
    report.exit = await completion
    assert(ready, 'Fixture did not become ready')
    assert.equal(report.exit.code, 0)
    assert(!report.timeout, 'Owned fixture exceeded deadline')
    assert(!fs.existsSync(path.join(root, 'unexpected.json')), 'Unexpected exception was contained')
    report.result = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'))
    assert(report.result.completed)
    assert.equal(report.result.browserWindows, 0)
    assert(report.result.pipeErrors.length > 0, 'The closed pipe was not exercised')
    assert(
      report.result.pipeErrors.every((code) =>
        ['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(code),
      ),
    )
    assert(
      fs
        .readFileSync(path.join(root, 'logs/main.log'), 'utf8')
        .includes('EPIPE_FIXTURE_FILE_LOG_ALIVE'),
    )
    report.passed = true
  } catch (error) {
    report.failure = error.message
    process.exitCode = 1
  } finally {
    clearInterval(interval)
    clearTimeout(timeout)
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
})()
