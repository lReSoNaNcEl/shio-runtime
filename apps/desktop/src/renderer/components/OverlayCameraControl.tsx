import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import Animation from '@react-spectrum/s2/icons/Animation'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'

import type { OverlayViewMode } from '../three/avatarTuning'

const CAMERA_MODES: Array<{ id: OverlayViewMode; title: string; description: string }> = [
  { id: 'front', title: 'Front', description: 'Полный вид спереди' },
  { id: 'bust', title: 'Bust', description: 'Кадр по пояс' },
  { id: 'face', title: 'Face', description: 'Крупный план лица' },
  { id: 'portrait', title: 'Portrait', description: 'Портретный кадр' },
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
  return (
    <div className={`camera-split camera-${overlayState}`}>
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
          UNSAFE_className="camera-main"
        >
          <Animation />
          <Text>{cameraMode.charAt(0).toUpperCase() + cameraMode.slice(1)}</Text>
        </ActionButton>
        <Tooltip>{status}</Tooltip>
      </TooltipTrigger>
      <MenuTrigger>
        <ActionButton
          aria-label="Выбрать режим камеры"
          isDisabled={pending}
          UNSAFE_className="camera-caret"
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
          {CAMERA_MODES.map((item) => (
            <MenuItem key={item.id} id={item.id}>
              <Text slot="label">{item.title}</Text>
              <Text slot="description">{item.description}</Text>
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    </div>
  )
}
