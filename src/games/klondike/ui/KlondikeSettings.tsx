import { useState, type ReactNode } from 'react'
import { Modal } from '../../../shared/ui/Modal'
import type { DrawMode, KlondikeConfig } from '../types'
import { drawLabel } from './format'

export interface KlondikeSettingsProps {
  config: KlondikeConfig
  /** draw mode of the deal on the table */
  currentDraw: DrawMode
  onApply: (config: KlondikeConfig, dealNow: boolean) => void
  onResetStats: () => void
  onClose: () => void
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="klset__row">
      <div className="klset__label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="klset__control">{children}</div>
    </div>
  )
}

const KEYS: [string, string][] = [
  ['Space / D', 'Draw from the stock'],
  ['U', 'Undo'],
  ['H or ?', 'Hint'],
  ['Enter', 'Play the hinted move'],
  ['N', 'New deal'],
]

export function KlondikeSettings({ config, currentDraw, onApply, onResetStats, onClose }: KlondikeSettingsProps) {
  const [draw, setDraw] = useState<DrawMode>(config.draw)
  const [confirmReset, setConfirmReset] = useState(false)
  const changed = draw !== currentDraw

  return (
    <Modal
      title="Solitaire settings"
      subtitle={`Klondike · ${drawLabel(currentDraw)}`}
      onClose={onClose}
      footer={
        <div className="klset__foot">
          {changed ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => onApply({ draw }, false)}>
                Next deal
              </button>
              <button type="button" className="btn btn--gold" onClick={() => onApply({ draw }, true)}>
                Deal now
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--gold" onClick={() => onApply({ draw }, false)}>
              Done
            </button>
          )}
        </div>
      }
    >
      <div className="klset">
        <Row label="Draw" hint="Draw 1 is the forgiving game; Draw 3 only lets you reach every third card.">
          <div className="klseg" role="group" aria-label="Cards per draw">
            {([1, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`klseg__btn${draw === n ? ' is-active' : ''}`}
                aria-pressed={draw === n}
                onClick={() => setDraw(n)}
              >
                {drawLabel(n)}
              </button>
            ))}
          </div>
        </Row>
        {changed && (
          <p className="klset__notice">
            The deal on the table stays {drawLabel(currentDraw)}. Deal now to switch (an unfinished deal counts as a
            loss for your streak).
          </p>
        )}
        <Row label="Stats" hint="Clears played, won, streaks and records.">
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              if (confirmReset) {
                onResetStats()
                setConfirmReset(false)
              } else {
                setConfirmReset(true)
              }
            }}
          >
            {confirmReset ? 'Tap again to reset' : 'Reset stats'}
          </button>
        </Row>
        <div className="klset__keys">
          <span className="smallcaps">Keyboard</span>
          <dl>
            {KEYS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <kbd className="kbd">{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <p>Tap a card to send it to its best spot, or drag it exactly where you want it.</p>
        </div>
      </div>
    </Modal>
  )
}
