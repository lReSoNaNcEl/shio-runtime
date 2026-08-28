// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-spectrum/s2/style', () => ({ style: () => '' }))

import { ModelComboBox } from '../../../src/renderer/components/settings/ModelComboBox'
import { LocalizationContext } from '../../../src/renderer/localization/LocalizationProvider'
import type { ModelInfo } from '../../../src/shared/llm'
import { translate } from '../../../src/shared/localization'

const models: ModelInfo[] = [
  {
    id: 'text-model',
    capabilities: {
      supportsImageGeneration: false,
      supportsVision: false,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsToolCalling: true,
    },
  },
  {
    id: 'image-model',
    capabilities: {
      supportsImageGeneration: true,
      supportsVision: false,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsToolCalling: true,
    },
  },
  {
    id: 'vision-model',
    capabilities: {
      supportsImageGeneration: false,
      supportsVision: true,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsToolCalling: true,
    },
  },
]

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationContext.Provider
      value={{
        locale: 'ru',
        intlLocale: 'ru-RU',
        t: (key, params) => translate('ru', key, params),
      }}
    >
      {children}
    </LocalizationContext.Provider>
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ModelComboBox capability filters', () => {
  it('keeps the image and vision filters beside each other when details are hidden', async () => {
    const view = render(
      <ModelComboBox
        label="Модель"
        models={models}
        selectedId="text-model"
        showCapabilities
        showImageFilter
        showVisionFilter
        showCapabilityDetails={false}
        onSelect={vi.fn()}
      />,
      { wrapper: Wrapper },
    )

    const imageFilter = screen.getByRole('switch', { name: 'Только модели с изображениями' })
    const visionFilter = screen.getByRole('switch', { name: 'Только модели со зрением' })

    expect(imageFilter.closest('.model-capability-filters')).toBe(
      visionFilter.closest('.model-capability-filters'),
    )
    fireEvent.click(imageFilter)

    expect(imageFilter).toBeChecked()
    expect(visionFilter).not.toBeChecked()
    expect(view.container.querySelector('.model-capability-status')).toBeNull()

    const comboBox = screen.getByRole('combobox', { name: 'Модель' })
    fireEvent.keyDown(comboBox, { key: 'ArrowDown' })

    await waitFor(() => expect(screen.getByText('image-model')).toBeInTheDocument())
    expect(screen.queryByText('text-model')).not.toBeInTheDocument()
    expect(screen.queryByText('vision-model')).not.toBeInTheDocument()

    fireEvent.click(imageFilter)
    fireEvent.click(visionFilter)
    expect(visionFilter).toBeChecked()

    fireEvent.keyDown(comboBox, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByText('vision-model')).toBeInTheDocument())
    expect(screen.queryByText('image-model')).not.toBeInTheDocument()

    fireEvent.click(imageFilter)
    expect(imageFilter).toBeChecked()
    expect(visionFilter).toBeChecked()

    fireEvent.keyDown(comboBox, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByText('image-model')).toBeInTheDocument())
    expect(screen.getByText('vision-model')).toBeInTheDocument()
    expect(screen.queryByText('text-model')).not.toBeInTheDocument()
  })
})
