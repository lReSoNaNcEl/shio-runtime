import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'
import FullScreen from '@react-spectrum/s2/icons/FullScreen'
import OrientationPortrait from '@react-spectrum/s2/icons/OrientationPortrait'
import User from '@react-spectrum/s2/icons/User'
import UserAvatar from '@react-spectrum/s2/icons/UserAvatar'

import { type OverlayViewMode } from '../../avatar/tuning/cameraTuning'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'

const CAMERA_MODE_ICONS: Array<{
  id: OverlayViewMode
  Icon: typeof FullScreen
}> = [
  { id: 'front', Icon: FullScreen },
  { id: 'bust', Icon: User },
  { id: 'face', Icon: UserAvatar },
  { id: 'portrait', Icon: OrientationPortrait },
]

type OverlayState = 'off' | 'opening' | 'on' | 'closing' | 'error'

function statusCopy(
  state: OverlayState,
  mode: OverlayViewMode,
  t: LocalizationContextValue['t'],
): string {
  switch (state) {
    case 'on':
      return t('camera.state.on', { mode })
    case 'opening':
      return t('camera.state.opening')
    case 'closing':
      return t('camera.state.closing')
    case 'error':
      return t('camera.state.error', { mode })
    default:
      return t('camera.state.off', { mode })
  }
}

export function OverlayCameraControl({
  overlayState,
  cameraMode,
  vrmLoaded,
  onToggle,
  onCameraModeChange,
}: {
  overlayState: OverlayState
  cameraMode: OverlayViewMode
  vrmLoaded: boolean
  onToggle: () => Promise<void>
  onCameraModeChange: (mode: OverlayViewMode) => Promise<void>
}) {
  const { t } = useTranslation()
  const pending = overlayState === 'opening' || overlayState === 'closing'
  const cameraModes = CAMERA_MODE_ICONS.map((item) => ({
    ...item,
    title: t(`camera.mode.${item.id}.title`),
    description: t(`camera.mode.${item.id}.description`),
  }))
  const status =
    !vrmLoaded && overlayState !== 'on'
      ? t('camera.missingVrm.triggerDescription')
      : statusCopy(overlayState, cameraMode, t)
  const selectedMode = cameraModes.find((item) => item.id === cameraMode) ?? cameraModes[0]
  const SelectedModeIcon = selectedMode.Icon
  return (
    <div className={`camera-control camera-${overlayState}`}>
      <TooltipTrigger delay={200}>
        <ActionButton
          aria-label={
            !vrmLoaded && overlayState !== 'on'
              ? t('camera.missingVrm.triggerDescription')
              : overlayState === 'on'
                ? t('camera.toggle.disable', { mode: cameraMode })
                : t('camera.toggle.enable', { mode: cameraMode })
          }
          aria-pressed={overlayState === 'on'}
          isDisabled={pending}
          onPress={() => {
            void onToggle()
          }}
          UNSAFE_className="camera-toggle"
        >
          <SelectedModeIcon />
        </ActionButton>
        <Tooltip>{status}</Tooltip>
      </TooltipTrigger>
      <MenuTrigger>
        <ActionButton
          aria-label={t('camera.framing.open', {
            mode: selectedMode.title,
          })}
          isDisabled={pending}
          UNSAFE_className="camera-selector"
        >
          <ChevronDown />
        </ActionButton>
        <Menu
          aria-label={t('camera.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[cameraMode]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return
            const [key] = keys
            if (key) void onCameraModeChange(String(key) as OverlayViewMode)
          }}
        >
          {cameraModes.map(({ Icon, ...item }) => (
            <MenuItem key={item.id} id={item.id} textValue={item.title}>
              <Icon />
              <Text slot="label">{item.title}</Text>
              <Text slot="description">{item.description}</Text>
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    </div>
  )
}
