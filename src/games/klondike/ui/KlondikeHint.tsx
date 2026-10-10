import { CloseIcon } from '../../../shared/ui/Icons'
import { Kbd } from '../../../shared/ui/Kbd'
import type { KlondikeAdvice } from '../types'

export interface KlondikeHintProps {
  advice: KlondikeAdvice
  onPlay: () => void
  onDismiss: () => void
}

export function KlondikeHint({ advice, onPlay, onDismiss }: KlondikeHintProps) {
  return (
    <div className="klhint" role="note" data-stuck={advice.stuck}>
      <div className="klhint__top">
        <span className="klhint__action">{advice.label}</span>
        <span className="klhint__situation">{advice.situation}</span>
        {advice.move && (
          <button type="button" className="btn btn--quiet klhint__play" onClick={onPlay}>
            Play it
            <Kbd>⏎</Kbd>
          </button>
        )}
        <button type="button" className="btn btn--icon klhint__close" onClick={onDismiss} aria-label="Hide hint">
          <CloseIcon size={16} />
        </button>
      </div>
      <p className="klhint__why">{advice.explanation}</p>
    </div>
  )
}
