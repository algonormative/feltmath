import type { Card } from '../../../shared/cards'
import { RANKS, SUITS } from '../../../shared/cards'
import type { Board, Column, KlondikeConfig, KlondikeState, KlondikeStats } from '../types'
import { DEFAULT_KLONDIKE, EMPTY_KLONDIKE_STATS } from '../types'

const STORAGE_KEY = 'feltmath-klondike-v1'

/** Undo depth kept across a reload — enough to back out of most mistakes. */
const SAVED_HISTORY = 120

export interface PersistedKlondike {
  config: KlondikeConfig
  stats: KlondikeStats
  /** the deal in progress, so closing the app never loses a game */
  game: KlondikeState | null
  /** wall-clock time already spent on that deal */
  elapsedMs: number
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function coerceConfig(raw: unknown): KlondikeConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_KLONDIKE
  const c = raw as Record<string, unknown>
  return { draw: c.draw === 3 ? 3 : 1 }
}

function coerceStats(raw: unknown): KlondikeStats {
  if (!raw || typeof raw !== 'object') return EMPTY_KLONDIKE_STATS
  const s = raw as Record<string, unknown>
  return {
    played: num(s.played, 0),
    won: num(s.won, 0),
    streak: num(s.streak, 0),
    bestStreak: num(s.bestStreak, 0),
    fewestMoves: nullableNum(s.fewestMoves),
    fastestMs: nullableNum(s.fastestMs),
    cleanWins: num(s.cleanWins, 0),
  }
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    RANKS.includes(c.rank as Card['rank']) &&
    SUITS.includes(c.suit as Card['suit'])
  )
}

function isCards(value: unknown): value is Card[] {
  return Array.isArray(value) && value.every(isCard)
}

function isColumn(value: unknown): value is Column {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return isCards(c.cards) && typeof c.hidden === 'number' && c.hidden >= 0
}

/** A board is trusted only if it holds exactly one of each card. */
function isBoard(value: unknown): value is Board {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  if (!isCards(b.stock) || !isCards(b.waste)) return false
  if (!Array.isArray(b.foundations) || b.foundations.length !== 4 || !b.foundations.every(isCards)) return false
  if (!Array.isArray(b.tableau) || b.tableau.length !== 7 || !b.tableau.every(isColumn)) return false
  const all = [
    ...b.stock,
    ...b.waste,
    ...(b.foundations as Card[][]).flat(),
    ...(b.tableau as Column[]).flatMap((col) => col.cards),
  ]
  return all.length === 52 && new Set(all.map((card) => `${card.rank}${card.suit}`)).size === 52
}

function coerceGame(raw: unknown, config: KlondikeConfig, stats: KlondikeStats): KlondikeState | null {
  if (!isBoard(raw)) return null
  const g = raw as unknown as Record<string, unknown>
  if (g.status !== 'playing' && g.status !== 'won') return null
  const history = Array.isArray(g.history) ? (g.history as unknown[]).filter(isBoard) : []
  return {
    stock: g.stock as Card[],
    waste: g.waste as Card[],
    wasteFan: num(g.wasteFan, 0),
    foundations: g.foundations as Card[][],
    tableau: g.tableau as Column[],
    moves: num(g.moves, 0),
    recycles: num(g.recycles, 0),
    config,
    draw: g.draw === 3 ? 3 : 1,
    dealNumber: num(g.dealNumber, 1),
    rngSeed: num(g.rngSeed, 1) >>> 0,
    status: g.status === 'won' ? 'won' : 'playing',
    hintsUsed: num(g.hintsUsed, 0),
    undos: num(g.undos, 0),
    counted: g.counted === true,
    history,
    stats,
  }
}

export function loadKlondike(): PersistedKlondike | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const config = coerceConfig(parsed.config)
    const stats = coerceStats(parsed.stats)
    return {
      config,
      stats,
      game: coerceGame(parsed.game, config, stats),
      elapsedMs: Math.max(0, num(parsed.elapsedMs, 0)),
    }
  } catch {
    return null
  }
}

export function saveKlondike(state: KlondikeState, elapsedMs: number): void {
  try {
    // A won deal is kept too, so a reload lands back on the win screen.
    const game = {
      ...state,
      stats: undefined,
      config: undefined,
      history: state.status === 'won' ? [] : state.history.slice(-SAVED_HISTORY),
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ config: state.config, stats: state.stats, game, elapsedMs }),
    )
  } catch {
    /* private mode / quota — persistence is a nicety, never a blocker */
  }
}
