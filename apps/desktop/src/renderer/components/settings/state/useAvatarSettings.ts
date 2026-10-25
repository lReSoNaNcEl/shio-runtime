import { useState } from 'react'

import type { OverlayViewMode } from '../../../avatar/tuning/cameraTuning'
import { overlayDefaults } from './settingsDefaults'

export function useAvatarSettings() {
  const [avatarName, setAvatarName] = useState('')
  const [overlayWidth, setOverlayWidth] = useState(overlayDefaults.width)
  const [overlayHeight, setOverlayHeight] = useState(overlayDefaults.height)
  const [overlayMargin, setOverlayMargin] = useState(overlayDefaults.margin)
  const [overlayOpacityPercent, setOverlayOpacityPercent] = useState(overlayDefaults.opacityPercent)
  const [overlayTransparentBackground, setOverlayTransparentBackground] = useState(true)
  const [overlayClickThrough, setOverlayClickThrough] = useState(true)
  const [overlayCorner, setOverlayCorner] = useState(overlayDefaults.corner)
  const [overlayScalePercent, setOverlayScalePercent] = useState(overlayDefaults.scalePercent)
  const [overlayViewMode, setOverlayViewMode] = useState<OverlayViewMode>('bust')

  return {
    overlayClickThrough,
    overlayCorner,
    overlayHeight,
    overlayMargin,
    overlayOpacityPercent,
    overlayScalePercent,
    overlayTransparentBackground,
    overlayViewMode,
    overlayWidth,
    setOverlayClickThrough,
    setOverlayCorner,
    setOverlayHeight,
    setOverlayMargin,
    setOverlayOpacityPercent,
    setOverlayScalePercent,
    setOverlayTransparentBackground,
    setOverlayViewMode,
    setOverlayWidth,
    setAvatarName,
    avatarName,
  }
}
