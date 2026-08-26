import type { BundledPlugin } from '../../plugins'

export function buildBundledPlugins(
  ...plugins: readonly [BundledPlugin, BundledPlugin, BundledPlugin, BundledPlugin]
): readonly BundledPlugin[] {
  return Object.freeze([...plugins])
}
