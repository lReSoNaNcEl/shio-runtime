import { expect, it, vi } from 'vitest'

const { getSources } = vi.hoisted(() => ({ getSources: vi.fn() }))
vi.mock('electron', () => ({ desktopCapturer: { getSources } }))

import { ScreenCaptureAdapter } from '../../src/main/screen-context/ScreenCaptureAdapter'

it('lists an icon-only window and verifies its availability without requesting an image', async () => {
  const window = {
    id: 'window:1:0',
    name: 'Editor',
    thumbnail: { isEmpty: () => true },
    appIcon: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA' },
  }
  const overlay = { ...window, id: 'window:2:0' }
  getSources.mockResolvedValueOnce([window, overlay]).mockResolvedValueOnce([window, overlay])
  getSources.mockResolvedValue([overlay])
  const adapter = new ScreenCaptureAdapter((id) => id !== overlay.id)
  expect(await adapter.listSources()).toEqual([
    { id: window.id, name: 'Editor', kind: 'window', appIconDataUrl: window.appIcon.toDataURL() },
  ])
  await expect(adapter.checkSource(window.id)).resolves.toBeUndefined()
  expect(getSources).toHaveBeenLastCalledWith({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  })
  await expect(adapter.checkSource(window.id)).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
  await expect(adapter.checkSource(overlay.id)).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
})
