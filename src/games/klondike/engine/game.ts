// Klondike engine — pure functions only. Every mutator returns a NEW state
// (React reducer friendly, StrictMode safe) or the identical object when the
// request is illegal. All randomness flows through rngSeed + shared/rng.

import type { Card, Rank } from '../../../shared/cards'
import { RANKS, SUITS, buildDecks, isRedSuit } from '../../../shared/cards'
import { shuffled } from '../../../shared/rng'
import type {
  Board,
  Column,
  FoundationLoc,
  KlondikeConfig,
  KlondikeState,
  KlondikeStats,
  Loc,
  Move,
  TableauLoc,
} from '../types'
import { EMPTY_KLONDIKE_STATS } from '../types'

export const TABLEAU_LOCS: readonly TableauLoc[] = ['t0', 't1', 't2', 't3', 't4', 't5', 't6']
export const FOUNDATION_LOCS: readonly FoundationLoc[] = ['f0', 'f1', 'f2', 'f3']

/** Undo depth. A full game is rarely more than ~200 moves. */
const HISTORY_LIMIT = 400

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

/** A=1 … K=13 */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 1
}

export function foundationIndex(card: Card): number {
  return SUITS.indexOf(card.suit)
}

export function isTableau(loc: Loc): loc is TableauLoc {
  return loc[0] === 't'
}

export function isFoundation(loc: Loc): loc is FoundationLoc {
  return loc[0] === 'f'
}

export function locIndex(loc: TableauLoc | FoundationLoc): number {
  return Number(loc.slice(1))
}

/** `upper` may sit on `lower` in the tableau: one rank lower, opposite colour. */
export function stacksOn(upper: Card, lower: Card): boolean {
  return (
    rankValue(upper.rank) === rankValue(lower.rank) - 1 &&
    isRedSuit(upper.suit) !== isRedSuit(lower.suit)
  )
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

function deal(seed: number): { board: Board; nextSeed: number } {
  const { items, nextSeed } = shuffled(buildDecks(1), seed)
  const tableau: Column[] = []
  let k = 0
  for (let c = 0; c < 7; c++) {
    const cards = items.slice(k, k + c + 1)
    k += c + 1
    tableau.push({ cards, hidden: c })
  }
  return {
    board: {
      stock: items.slice(k),
      waste: [],
      wasteFan: 0,
      foundations: [[], [], [], []],
      tableau,
      moves: 0,
      recycles: 0,
    },
    nextSeed,
  }
}

export function newKlondike(
  config: KlondikeConfig,
  seed: number,
  stats: KlondikeStats = EMPTY_KLONDIKE_STATS,
): KlondikeState {
  const { board, nextSeed } = deal(seed)
  return {
    ...board,
    config,
    draw: config.draw,
    dealNumber: 1,
    rngSeed: nextSeed,
    status: 'playing',
    hintsUsed: 0,
    undos: 0,
    counted: false,
    history: [],
    stats,
  }
}

/**
 * Shuffle up a fresh deal with the staged config. Walking away from a deal
 * that was played but not won breaks the win streak.
 */
export function newDeal(state: KlondikeState): KlondikeState {
  const { board, nextSeed } = deal(state.rngSeed)
  const abandoned = state.counted && state.status !== 'won'
  return {
    ...board,
    config: state.config,
    draw: state.config.draw,
    dealNumber: state.dealNumber + 1,
    rngSeed: nextSeed,
    status: 'playing',
    hintsUsed: 0,
    undos: 0,
    counted: false,
    history: [],
    stats: abandoned ? { ...state.stats, streak: 0 } : state.stats,
  }
}

/** Stage a config for the next deal (draw mode never changes mid-deal). */
export function applyConfig(state: KlondikeState, config: KlondikeConfig): KlondikeState {
  return { ...state, config }
}

export function resetStats(state: KlondikeState): KlondikeState {
  // The deal on the table no longer counts toward the fresh slate.
  return { ...state, stats: EMPTY_KLONDIKE_STATS, counted: false }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The cards at `loc` that would be picked up when grabbing `count` from the top. */
export function cardsAt(state: Board, loc: Loc): Card[] {
  if (loc === 'stock') return state.stock
  if (loc === 'waste') return state.waste
  if (isFoundation(loc)) return state.foundations[locIndex(loc)]
  return state.tableau[locIndex(loc)].cards
}

export function topCard(state: Board, loc: Loc): Card | undefined {
  const cards = cardsAt(state, loc)
  return cards[cards.length - 1]
}

/** Is `cards[from..]` a face-up, alternating, descending run? */
export function isRun(column: Column, from: number): boolean {
  if (from < column.hidden || from >= column.cards.length) return false
  for (let i = from + 1; i < column.cards.length; i++) {
    if (!stacksOn(column.cards[i], column.cards[i - 1])) return false
  }
  return true
}

/** Largest movable run at the top of a column (0 when empty). */
export function runLength(column: Column): number {
  let n = 0
  for (let i = column.cards.length - 1; i >= column.hidden; i--) {
    if (i < column.cards.length - 1 && !stacksOn(column.cards[i + 1], column.cards[i])) break
    n++
  }
  return n
}

/** Can `card` (the base of what's being moved) land on `to`? */
export function accepts(state: Board, to: Loc, card: Card, count: number): boolean {
  if (to === 'stock' || to === 'waste') return false
  if (isFoundation(to)) {
    if (count !== 1 || foundationIndex(card) !== locIndex(to)) return false
    return state.foundations[locIndex(to)].length === rankValue(card.rank) - 1
  }
  const dest = state.tableau[locIndex(to)].cards
  if (dest.length === 0) return card.rank === 'K'
  return stacksOn(card, dest[dest.length - 1])
}

/** Validate a move without applying it. */
export function isLegal(state: KlondikeState, move: Move): boolean {
  if (state.status !== 'playing') return false
  if (move.kind === 'draw') return state.stock.length > 0
  if (move.kind === 'recycle') return state.stock.length === 0 && state.waste.length > 0

  const { from, to, count } = move
  if (from === to || count < 1 || from === 'stock') return false
  const src = cardsAt(state, from)
  if (src.length < count) return false
  if (from === 'waste' || isFoundation(from)) {
    if (count !== 1) return false
  } else if (!isRun(state.tableau[locIndex(from)], src.length - count)) {
    return false
  }
  return accepts(state, to, src[src.length - count], count)
}

/** Every legal move in the position (draw / recycle included). */
export function legalMoves(state: KlondikeState): Move[] {
  if (state.status !== 'playing') return []
  const out: Move[] = []
  const push = (from: Loc, to: Loc, count: number) => {
    const move: Move = { kind: 'move', from, to, count }
    if (isLegal(state, move)) out.push(move)
  }

  if (state.waste.length > 0) {
    for (const f of FOUNDATION_LOCS) push('waste', f, 1)
    for (const t of TABLEAU_LOCS) push('waste', t, 1)
  }
  state.tableau.forEach((column, c) => {
    const from = TABLEAU_LOCS[c]
    const run = runLength(column)
    for (let count = 1; count <= run; count++) {
      if (count === 1) for (const f of FOUNDATION_LOCS) push(from, f, 1)
      for (const t of TABLEAU_LOCS) push(from, t, count)
    }
  })
  FOUNDATION_LOCS.forEach((f) => {
    for (const t of TABLEAU_LOCS) push(f, t, 1)
  })

  if (state.stock.length > 0) out.push({ kind: 'draw' })
  else if (state.waste.length > 0) out.push({ kind: 'recycle' })
  return out
}

export function foundationCount(state: Board): number {
  return state.foundations.reduce((n, f) => n + f.length, 0)
}

/** Everything face up and the stock spent — the rest plays itself. */
export function canAutoFinish(state: KlondikeState): boolean {
  return (
    state.status === 'playing' &&
    state.stock.length === 0 &&
    state.waste.length === 0 &&
    state.tableau.every((column) => column.hidden === 0)
  )
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

function snapshot(state: KlondikeState): Board {
  return {
    stock: state.stock,
    waste: state.waste,
    wasteFan: state.wasteFan,
    foundations: state.foundations,
    tableau: state.tableau,
    moves: state.moves,
    recycles: state.recycles,
  }
}

function withBoard(state: KlondikeState, board: Board): KlondikeState {
  const history = [...state.history, snapshot(state)]
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)

  let next: KlondikeState = { ...state, ...board, history }

  // First move of a deal counts it as played.
  if (!next.counted) {
    next = { ...next, counted: true, stats: { ...next.stats, played: next.stats.played + 1 } }
  }

  if (foundationCount(next) === 52) {
    const s = next.stats
    const streak = s.streak + 1
    next = {
      ...next,
      status: 'won',
      stats: {
        ...s,
        won: s.won + 1,
        streak,
        bestStreak: Math.max(s.bestStreak, streak),
        fewestMoves: s.fewestMoves === null ? next.moves : Math.min(s.fewestMoves, next.moves),
        cleanWins: s.cleanWins + (next.hintsUsed === 0 && next.undos === 0 ? 1 : 0),
      },
    }
  }
  return next
}

/** Apply a move. Illegal moves return the identical state object. */
export function applyMove(state: KlondikeState, move: Move): KlondikeState {
  if (!isLegal(state, move)) return state

  if (move.kind === 'draw') {
    const n = Math.min(state.draw, state.stock.length)
    // Turned cards land face up in draw order: the last one turned is on top.
    const turned = state.stock.slice(state.stock.length - n).reverse()
    return withBoard(state, {
      ...snapshot(state),
      stock: state.stock.slice(0, state.stock.length - n),
      waste: [...state.waste, ...turned],
      wasteFan: n,
      moves: state.moves + 1,
    })
  }

  if (move.kind === 'recycle') {
    return withBoard(state, {
      ...snapshot(state),
      stock: state.waste.slice().reverse(),
      waste: [],
      wasteFan: 0,
      moves: state.moves + 1,
      recycles: state.recycles + 1,
    })
  }

  const { from, to, count } = move
  const board = snapshot(state)
  const src = cardsAt(state, from)
  const moving = src.slice(src.length - count)

  let waste = board.waste
  let wasteFan = board.wasteFan
  const foundations = board.foundations.slice()
  const tableau = board.tableau.slice()

  // take
  if (from === 'waste') {
    waste = waste.slice(0, -1)
    wasteFan = waste.length === 0 ? 0 : Math.max(1, wasteFan - 1)
  } else if (isFoundation(from)) {
    const i = locIndex(from)
    foundations[i] = foundations[i].slice(0, -1)
  } else {
    const i = locIndex(from as TableauLoc)
    const column = tableau[i]
    const cards = column.cards.slice(0, column.cards.length - count)
    // Exposed face-down cards flip automatically.
    tableau[i] = { cards, hidden: Math.min(column.hidden, Math.max(0, cards.length - 1)) }
  }

  // place
  if (isFoundation(to)) {
    const i = locIndex(to)
    foundations[i] = [...foundations[i], ...moving]
  } else {
    const i = locIndex(to as TableauLoc)
    tableau[i] = { ...tableau[i], cards: [...tableau[i].cards, ...moving] }
  }

  return withBoard(state, {
    ...board,
    waste,
    wasteFan,
    foundations,
    tableau,
    moves: state.moves + 1,
  })
}

export function canUndo(state: KlondikeState): boolean {
  return state.status === 'playing' && state.history.length > 0
}

export function undo(state: KlondikeState): KlondikeState {
  if (!canUndo(state)) return state
  const prev = state.history[state.history.length - 1]
  return {
    ...state,
    ...prev,
    history: state.history.slice(0, -1),
    undos: state.undos + 1,
  }
}

/** Count a hint against this deal (clean-win tracking). */
export function noteHint(state: KlondikeState): KlondikeState {
  return state.status === 'playing' ? { ...state, hintsUsed: state.hintsUsed + 1 } : state
}

/** Record the wall-clock time of a win (the clock lives in the UI layer). */
export function recordWinTime(state: KlondikeState, ms: number): KlondikeState {
  if (state.status !== 'won' || !(ms > 0)) return state
  const fastestMs = state.stats.fastestMs === null ? ms : Math.min(state.stats.fastestMs, ms)
  if (fastestMs === state.stats.fastestMs) return state
  return { ...state, stats: { ...state.stats, fastestMs } }
}

/**
 * The next auto-finish step: the lowest card on any column top that can go
 * up. With every card face up and the stock spent one always exists.
 */
export function autoFinishMove(state: KlondikeState): Move | null {
  if (!canAutoFinish(state)) return null
  let best: Move | null = null
  let bestRank = 99
  state.tableau.forEach((column, c) => {
    const card = column.cards[column.cards.length - 1]
    if (!card) return
    const to = FOUNDATION_LOCS[foundationIndex(card)]
    const move: Move = { kind: 'move', from: TABLEAU_LOCS[c], to, count: 1 }
    if (rankValue(card.rank) < bestRank && isLegal(state, move)) {
      best = move
      bestRank = rankValue(card.rank)
    }
  })
  return best
}
