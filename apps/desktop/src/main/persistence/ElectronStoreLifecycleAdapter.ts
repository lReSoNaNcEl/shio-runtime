interface ElectronStoreWatcherCompatibility {
  _closeWatcher?: () => void
}

/**
 * Isolates the optional Conf/electron-store watcher cleanup hook behind one guarded seam.
 * Persistence does not enable watching today, so an absent or changed hook is safe to ignore.
 */
export function closeElectronStoreWatcher(store: unknown): boolean {
  if ((!store || typeof store !== 'object') && typeof store !== 'function') return false
  const compatible = store as ElectronStoreWatcherCompatibility
  if (typeof compatible._closeWatcher !== 'function') return false
  try {
    compatible._closeWatcher.call(store)
    return true
  } catch {
    return false
  }
}
