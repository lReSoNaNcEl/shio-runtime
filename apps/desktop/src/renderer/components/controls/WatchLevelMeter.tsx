import { Meter } from '@react-spectrum/s2'
import { useEffect, useState } from 'react'

const meterFloorDb = -54

export function WatchLevelMeter({
  label,
  readLevel,
  variant,
}: {
  label: string
  readLevel: () => number
  variant: 'informative' | 'positive'
}) {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    const sample = () => {
      const value = readLevel()
      const decibels = value > 0 ? 20 * Math.log10(value) : meterFloorDb
      const percent = ((decibels - meterFloorDb) / -meterFloorDb) * 100
      setLevel(Math.round(Math.max(0, Math.min(100, percent))))
    }
    sample()
    const timer = setInterval(sample, 100)
    return () => clearInterval(timer)
  }, [readLevel])

  return <Meter size="S" aria-label={label} value={level} variant={variant} />
}
