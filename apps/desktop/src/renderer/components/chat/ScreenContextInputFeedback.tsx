export function ScreenContextInputFeedback({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="screen-context-input-feedback" role="alert">
      {error}
    </div>
  )
}
