import type { BundledPlugin } from '../../plugins'

export function buildBundledPlugins(
  ...plugins: readonly BundledPlugin[]
): readonly BundledPlugin[] {
  return Object.freeze([...plugins])
}
