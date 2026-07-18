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

import type { OverlayViewMode } from '../three/avatarTuning'

const CAMERA_MODES: Array<{
  id: OverlayViewMode
  title: string
  description: string
  Icon: typeof FullScreen
}> = [
  { id: 'front', title: 'Front', description: 'Полный вид спереди', Icon: FullScreen },
  { id: 'bust', title: 'Bust', description: 'Кадр по пояс', Icon: User },
  { id: 'face', title: 'Face', description: 'Крупный план лица', Icon: UserAvatar },
  {
    id: 'portrait',
    title: 'Portrait',
    description: 'Портретный кадр',
    Icon: OrientationPortrait,
  },
]

type OverlayState = 'off' | 'opening' | 'on' | 'closing' | 'error'

function statusCopy(state: OverlayState, mode: OverlayViewMode): string {
  switch (state) {
    case 'on':
      return `Камера включена. Режим: ${mode}. Нажмите, чтобы выключить.`
    case 'opening':
      return 'Открытие камеры…'
    case 'closing':
      return 'Закрытие камеры…'
    case 'error':
      return `Не удалось выполнить операцию с камерой. Режим: ${mode}. Нажмите, чтобы повторить.`
    default:
      return `Камера выключена. Режим: ${mode}. Нажмите, чтобы включить.`
  }
}

export function OverlayCameraControl({
  overlayState,
  cameraMode,
  onToggle,
  onCameraModeChange,
}: {
  overlayState: OverlayState
  cameraMode: OverlayViewMode
  onToggle: () => Promise<void>
  onCameraModeChange: (mode: OverlayViewMode) => Promise<void>
}): React.JSX.Element {
  const pending = overlayState === 'opening' || overlayState === 'closing'
  const status = statusCopy(overlayState, cameraMode)
  const selectedMode = CAMERA_MODES.find((item) => item.id === cameraMode) ?? CAMERA_MODES[0]
  const SelectedModeIcon = selectedMode.Icon
  return (
    <div className={`camera-control camera-${overlayState}`}>
      <TooltipTrigger delay={200}>
        <ActionButton
          aria-label={
            overlayState === 'on'
              ? `Выключить камеру, текущий режим ${cameraMode}`
              : `Включить камеру, текущий режим ${cameraMode}`
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
          aria-label={`Кадрирование аватара: ${cameraMode.charAt(0).toUpperCase() + cameraMode.slice(1)}. Открыть меню.`}
          isDisabled={pending}
          UNSAFE_className="camera-selector"
        >
          <ChevronDown />
        </ActionButton>
        <Menu
          aria-label="Камера"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[cameraMode]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return
            const [key] = keys
            if (key) void onCameraModeChange(String(key) as OverlayViewMode)
          }}
        >
          {CAMERA_MODES.map(({ Icon, ...item }) => (
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
