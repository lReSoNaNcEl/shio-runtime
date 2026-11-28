// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { AvatarSettingsSection } from '../../../src/renderer/components/settings/sections/AvatarSettingsSection'
import type {
  AvatarSettingsActions,
  AvatarSettingsState,
} from '../../../src/renderer/components/settings/state/settingsContracts'
import { translate } from '../../../src/shared/localization'
import { localizedWrapper } from '../../support/rendering'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))
vi.mock('../../../src/renderer/Controller', () => ({ controller: {} }))

afterEach(cleanup)

it.each([
  ['ru', 'dark'],
  ['en', 'light'],
] as const)('lets users configure the hidden overlay in %s / %s', async (locale, theme) => {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  const state: AvatarSettingsState = {
    flashMotionEnabled: true,
    vrmName: '',
    overlayVisible: false,
    overlayViewMode: 'bust',
    overlayWidth: 430,
    overlayHeight: 670,
    overlayMargin: 0,
    overlayOpacityPercent: 100,
    overlayTransparentBackground: true,
    overlayClickThrough: true,
    overlayCorner: 'bottom-right',
    overlayScalePercent: 100,
  }
  const actions = {
    setFlashMotionEnabled: vi.fn(async () => {}),
    pickVrm: vi.fn(async () => {}),
    toggleOverlay: vi.fn(async () => {}),
    setOverlayViewMode: vi.fn(),
    setOverlayWidth: vi.fn(),
    setOverlayHeight: vi.fn(),
    setOverlayMargin: vi.fn(),
    setOverlayOpacityPercent: vi.fn(),
    setOverlayTransparentBackground: vi.fn(),
    setOverlayClickThrough: vi.fn(),
    setOverlayCorner: vi.fn(),
    setOverlayScalePercent: vi.fn(),
    resetOverlaySettings: vi.fn(),
  } satisfies AvatarSettingsActions
  const view = (value: AvatarSettingsState) => (
    <AvatarSettingsSection state={value} actions={actions} />
  )
  const { rerender } = render(view(state), { wrapper: localizedWrapper(locale, theme) })

  expect(screen.getByText(t('settings.avatar.notSelected'))).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: t('settings.avatar.chooseFile') }))
  expect(actions.pickVrm).toHaveBeenCalledOnce()
  rerender(view({ ...state, vrmName: 'selected-avatar.vrm' }))
  expect(screen.getByText('selected-avatar.vrm')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('settings.avatar.changeModel') })).toBeEnabled(),
  )

  const visibility = screen.getByRole('switch', { name: t('settings.avatar.overlayEnabled') })
  expect(visibility).not.toBeChecked()
  expect(screen.getByRole('slider', { name: t('settings.avatar.scale') })).toBeEnabled()
  expect(screen.getByRole('slider', { name: t('settings.avatar.opacity') })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: new RegExp(t('settings.avatar.position')) }),
  ).toBeEnabled()
  fireEvent.click(screen.getByRole('radio', { name: t('settings.avatar.cameraMode.face') }))
  expect(actions.setOverlayViewMode).toHaveBeenCalledWith('face')
  fireEvent.click(screen.getByRole('switch', { name: t('settings.avatar.clickThrough') }))
  expect(actions.setOverlayClickThrough).toHaveBeenCalledWith(false)
  fireEvent.click(screen.getByRole('switch', { name: t('settings.avatar.transparent') }))
  expect(actions.setOverlayTransparentBackground).toHaveBeenCalledWith(false)

  const details = screen.getByRole('button', { name: t('settings.avatar.advancedWindow') })
  expect(details).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(details)
  expect(screen.getByLabelText(t('settings.avatar.width'))).toBeEnabled()
  expect(screen.getByLabelText(t('settings.avatar.height'))).toBeEnabled()
  expect(screen.getByLabelText(t('settings.avatar.margin'))).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: t('settings.avatar.reset') }))
  expect(actions.resetOverlaySettings).toHaveBeenCalledOnce()
  expect(actions.toggleOverlay).not.toHaveBeenCalled()
  fireEvent.click(visibility)
  expect(actions.toggleOverlay).toHaveBeenCalledWith(true)

  const flashMotion = screen.getByRole('switch', { name: t('settings.avatar.flashMotion') })
  expect(flashMotion).toBeChecked()
  fireEvent.click(flashMotion)
  expect(actions.setFlashMotionEnabled).toHaveBeenCalledWith(false)
  rerender(view({ ...state, flashMotionEnabled: false }))
  await waitFor(() => expect(flashMotion).toBeEnabled())
  expect(flashMotion).not.toBeChecked()
  fireEvent.click(flashMotion)
  expect(actions.setFlashMotionEnabled).toHaveBeenLastCalledWith(true)
})
