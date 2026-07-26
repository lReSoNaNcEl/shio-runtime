import { readFileSync } from 'node:fs'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Speech banner repro failed: ${message}`)
}

const css = readFileSync('src/renderer/styles.css', 'utf8')

check(
  /#controls\s*\{[\s\S]*?container-name:\s*composer-controls;[\s\S]*?container-type:\s*inline-size;/u.test(
    css,
  ),
  'controls must expose its own inline-size container',
)
check(
  /@container\s+composer-controls\s*\(max-width:\s*680px\)/u.test(css),
  'banner breakpoint must use the controls width, not viewport width',
)
check(
  /@container\s+composer-controls[\s\S]*?\.speech-banner-actions\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/u.test(
    css,
  ),
  'actions must move to their own grid row in a narrow chat column',
)
console.log('PASS: speech banner container-width adaptive layout')
