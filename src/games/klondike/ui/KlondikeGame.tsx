import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BulbIcon, GearIcon } from '../../../shared/ui/Icons'
import { Kbd } from '../../../shared/ui/Kbd'
import { useHotkeys } from '../../../shared/ui/useHotkeys'
import type { HotkeyMap } from '../../../shared/ui/useHotkeys'
import {
  applyConfig,
  applyMove,
  autoFinishMove,
  canAutoFinish,
  canUndo,
  foundationCount,
  isLegal,
  newDeal,
  newKlondike,
  noteHint,
  recordWinTime,
  resetStats,
  undo,
} from '../engine/game'
import { klondikeAdvice, smartMove } from '../strategy/advice'
import type { KlondikeConfig, KlondikeState, Loc, Move } from '../types'
import { DEFAULT_KLONDIKE } from '../types'
import { KlondikeHint } from './KlondikeHint'
import { KlondikeSettings } from './KlondikeSettings'
import { KlondikeStats } from './KlondikeStats'
import { KlondikeTable, type Highlight } from './KlondikeTable'
import { drawLabel, formatClock } from './format'
import { loadKlondike, saveKlondike, type PersistedKlondike } from './persistence'
import './klondike.css'

// ---------------------------------------------------------------------------
// Reducer over the pure engine
// ---------------------------------------------------------------------------

type KlondikeAction =
  | { type: 'move'; move: Move }
  | { type: 'undo' }
  | { type: 'deal' }
  | { type: 'hint' }
  | { type: 'config'; config: KlondikeConfig }
  | { type: 'resetStats' }
  | { type: 'winTime'; ms: number }

function reducer(state: KlondikeState, action: KlondikeAction): KlondikeState {
  switch (action.type) {
    case 'move':
      return applyMove(state, action.move)
    case 'undo':
      return undo(state)
    case 'deal':
      return newDeal(state)
    case 'hint':
      return noteHint(state)
    case 'config':
      return applyConfig(state, action.config)
    case 'resetStats':
      return resetStats(state)
    case 'winTime':
      return recordWinTime(state, action.ms)
  }
}

function entropy(): number {
  // Entropy lives in the UI layer so the engine stays pure and deterministic.
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

function initState(saved: PersistedKlondike | null): KlondikeState {
  if (saved?.game) return saved.game
  return newKlondike(saved?.config ?? DEFAULT_KLONDIKE, entropy(), saved?.stats)
}

const AUTO_STEP_MS = 95

/** Where a move's cards come from and go to, for table highlighting. */
function highlightFor(move: Move | null): Highlight | null {
  if (!move) return null
  if (move.kind === 'draw' || move.kind === 'recycle') return { from: 'stock' }
  return { from: move.from, count: move.count, to: move.to }
}

// ---------------------------------------------------------------------------

export function KlondikeGame() {
  // Read storage on every mount: switching games and back must resume the
  // latest save, not whatever was on disk when this chunk first loaded.
  const [saved] = useState(loadKlondike)
  const [state, dispatch] = useReducer(reducer, saved, initState)
  const stateRef = useRef(state)
  stateRef.current = state

  // --- clock (UI-only: the engine never reads wall time) --------------------
  // Runs once the first move is made, pauses while the tab is hidden, stops on
  // a win. `base` is time banked before the current running stretch.
  const clock = useRef({ deal: state.dealNumber, base: saved?.game ? saved.elapsedMs : 0, since: 0 })
  const [, forceTick] = useState(0)
  const running = state.status === 'playing' && state.counted
  if (clock.current.deal !== state.dealNumber) clock.current = { deal: state.dealNumber, base: 0, since: 0 }
  const elapsed = () => clock.current.base + (clock.current.since ? Date.now() - clock.current.since : 0)

  useEffect(() => {
    const c = clock.current
    const pause = () => {
      if (c.since) {
        c.base += Date.now() - c.since
        c.since = 0
      }
    }
    const resume = () => {
      if (running && !c.since && document.visibilityState === 'visible') c.since = Date.now()
    }
    if (running) resume()
    else pause()
    const onVis = () => (document.visibilityState === 'visible' ? resume() : pause())
    document.addEventListener('visibilitychange', onVis)
    const tick = running ? setInterval(() => forceTick((n) => n + 1), 1000) : undefined
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (tick) clearInterval(tick)
      pause()
    }
  }, [running, state.dealNumber])

  // Stamp the win time once per deal.
  const stampedDeal = useRef<number | null>(null)
  useEffect(() => {
    if (state.status !== 'won' || stampedDeal.current === state.dealNumber) return
    stampedDeal.current = state.dealNumber
    dispatch({ type: 'winTime', ms: Math.round(elapsed()) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.dealNumber])

  // --- persistence ---------------------------------------------------------
  useEffect(() => {
    saveKlondike(state, Math.round(elapsed()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  useEffect(() => {
    const flush = () => saveKlondike(stateRef.current, Math.round(elapsed()))
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- auto-finish: once everything is face up, play it home ----------------
  const autoFinishing = canAutoFinish(state)
  useEffect(() => {
    if (!autoFinishing) return
    const move = autoFinishMove(state)
    if (!move) return
    const t = setTimeout(() => dispatch({ type: 'move', move }), AUTO_STEP_MS)
    return () => clearTimeout(t)
  }, [state, autoFinishing])

  // --- trainer reads -------------------------------------------------------
  const advice = useMemo(() => klondikeAdvice(state), [state])
  const decisionId = `${state.dealNumber}:${state.moves}:${state.undos}:${state.history.length}`
  const [hintFor, setHintFor] = useState<string | null>(null)
  const hintShown = hintFor === decisionId && state.status === 'playing'

  // --- UI state ------------------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [shake, setShake] = useState<{ loc: Loc; key: number } | null>(null)
  const [confirmDeal, setConfirmDeal] = useState(false)
  const [freshDeal, setFreshDeal] = useState(!saved?.game)

  useEffect(() => {
    if (!confirmDeal) return
    const t = setTimeout(() => setConfirmDeal(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDeal])

  // The deal-in flight only plays on the first frames of a fresh deal.
  useEffect(() => {
    if (!freshDeal) return
    const t = setTimeout(() => setFreshDeal(false), 1500)
    return () => clearTimeout(t)
  }, [freshDeal, state.dealNumber])
  const dealing = freshDeal && state.moves === 0

  // --- handlers ------------------------------------------------------------
  const play = (move: Move) => {
    setHintFor(null)
    dispatch({ type: 'move', move })
  }

  const wiggle = (loc: Loc) => setShake((s) => ({ loc, key: (s?.key ?? 0) + 1 }))

  const onTap = (loc: Loc, index: number) => {
    if (state.status !== 'playing' || autoFinishing) return
    const cards =
      loc === 'stock' ? state.stock : loc === 'waste' ? state.waste : loc[0] === 'f'
        ? state.foundations[Number(loc.slice(1))]
        : state.tableau[Number(loc.slice(1))].cards
    const move = smartMove(state, loc, loc === 'stock' ? 1 : cards.length - index)
    if (move) play(move)
    else if (loc !== 'stock') wiggle(loc)
  }

  const onDrop = (from: Loc, count: number, to: Loc) => {
    if (autoFinishing) return
    const move: Move = { kind: 'move', from, to, count }
    if (isLegal(state, move)) play(move)
    else wiggle(from)
  }

  const deal = () => {
    const midGame = state.status === 'playing' && state.counted
    if (midGame && !confirmDeal) {
      setConfirmDeal(true)
      return
    }
    setConfirmDeal(false)
    setHintFor(null)
    setFreshDeal(true)
    dispatch({ type: 'deal' })
  }

  const toggleHint = () => {
    if (state.status !== 'playing') return
    if (hintShown) {
      setHintFor(null)
      return
    }
    setHintFor(decisionId)
    dispatch({ type: 'hint' })
  }

  // The hint dispatch bumps no move counters, so decisionId survives it.
  const playHint = () => {
    if (hintShown && advice.move) play(advice.move)
  }

  const doUndo = () => {
    setHintFor(null)
    dispatch({ type: 'undo' })
  }

  const applySettings = (config: KlondikeConfig, dealNow: boolean) => {
    dispatch({ type: 'config', config })
    setSettingsOpen(false)
    if (dealNow) {
      setHintFor(null)
      setFreshDeal(true)
      dispatch({ type: 'deal' })
    }
  }

  // --- hotkeys --------------------------------------------------------------
  const hotkeys: HotkeyMap = settingsOpen
    ? {}
    : {
        n: deal,
        ...(state.status === 'playing' && !autoFinishing
          ? {
              space: () => onTap('stock', -1),
              d: () => onTap('stock', -1),
              u: doUndo,
              z: doUndo,
              h: toggleHint,
              '?': toggleHint,
              '/': toggleHint,
              ...(hintShown && advice.move ? { enter: playHint } : {}),
            }
          : {}),
        ...(state.status === 'won' ? { enter: deal, space: deal } : {}),
      }
  useHotkeys(hotkeys)

  // --- render ---------------------------------------------------------------
  const home = foundationCount(state)
  const won = state.status === 'won'
  const stuck = advice.stuck && state.status === 'playing'

  return (
    <div className="kl">
      <div className="kl__bar">
        <div className="kl__score">
          <span className="smallcaps">Home</span>
          <strong className="num">
            {home}
            <small>/52</small>
          </strong>
        </div>
        <div className="kl__meta">
          <span className="kl__line num">
            {state.moves} moves · {formatClock(elapsed())}
          </span>
          <span className="kl__metaline">
            Klondike · {drawLabel(state.draw)} · deal {state.dealNumber}
            {state.config.draw !== state.draw && <em> · {drawLabel(state.config.draw)} next</em>}
          </span>
        </div>
        <div className="kl__tools">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Solitaire settings"
          >
            <GearIcon />
          </button>
        </div>
      </div>

      <KlondikeStats stats={state.stats} open={statsOpen} onToggle={() => setStatsOpen((v) => !v)} />

      <div className="kl__stage">
        <KlondikeTable
          state={state}
          highlight={hintShown ? highlightFor(advice.move) : null}
          shake={shake}
          dealing={dealing}
          onTap={onTap}
          onDrop={onDrop}
        />
      </div>

      <div className="kl__controls">
        <div className="kl__float">
          {hintShown && !won && (
            <KlondikeHint advice={advice} onPlay={playHint} onDismiss={() => setHintFor(null)} />
          )}
          {stuck && !hintShown && (
            <p className="kl__stuck" role="status">
              <b>No moves left.</b> Nothing on the board or in the stock can go anywhere useful — undo to try
              another line, or deal again.
            </p>
          )}
        </div>

        {won ? (
          <div className="klwin" role="status">
            <p className="klwin__line">
              <b>Solved!</b> {state.moves} moves · {formatClock(elapsed())}
              {state.hintsUsed === 0 && state.undos === 0 && <span className="klwin__clean">clean</span>}
            </p>
            <p className="klwin__sub num">
              {state.stats.won} won of {state.stats.played} · streak {state.stats.streak}
            </p>
            <button type="button" className="btn btn--gold klwin__next" onClick={deal} autoFocus>
              Deal again
              <Kbd>⏎</Kbd>
            </button>
          </div>
        ) : (
          <div className="kl__actions">
            <button
              type="button"
              className={`btn ${confirmDeal ? 'btn--gold' : 'btn--ghost'} kl__btn`}
              onClick={deal}
            >
              {confirmDeal ? 'Abandon?' : 'New'}
              <Kbd>N</Kbd>
            </button>
            <button
              type="button"
              className="btn btn--ghost kl__btn"
              onClick={doUndo}
              disabled={!canUndo(state) || autoFinishing}
            >
              Undo
              <Kbd>U</Kbd>
            </button>
            <button
              type="button"
              className={`btn ${stuck ? 'btn--ghost' : 'btn--gold'} kl__btn kl__btn--hint`}
              onClick={toggleHint}
              aria-pressed={hintShown}
              disabled={autoFinishing}
            >
              <BulbIcon size={17} />
              Hint
              <Kbd>H</Kbd>
            </button>
          </div>
        )}
        {autoFinishing && (
          <p className="kl__auto" role="status">
            Everything's face up — playing it home…
          </p>
        )}
      </div>

      {settingsOpen && (
        <KlondikeSettings
          config={state.config}
          currentDraw={state.draw}
          onApply={applySettings}
          onResetStats={() => dispatch({ type: 'resetStats' })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
