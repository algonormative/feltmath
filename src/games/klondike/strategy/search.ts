// Look-ahead for positions where no single move is obviously productive.
//
// Breadth-first over every legal move (stock included) until a position
// turns over a face-down card or gets a card home beyond today's best. The
// first move of the shortest such line is the hint; exhausting the reachable
// positions without one proves the deal is dead. Looks through face-down
// stock cards — this only runs when the board itself offers nothing.
//
// The search runs on a compact integer board (card = suit*13 + rank-1) with
// its own move generator, ~10× faster than stepping the full engine state.
// scripts/verify-klondike.ts cross-checks it against engine/game.ts.

import { SUITS, RANKS } from '../../../shared/cards'
import type { Card } from '../../../shared/cards'
import { FOUNDATION_LOCS, TABLEAU_LOCS } from '../engine/game'
import type { Board, DrawMode, KlondikeState, Move } from '../types'

export type LineResult =
  | { kind: 'found'; path: Move[]; reveals: boolean }
  | { kind: 'dead' }
  | { kind: 'unknown' }

/** Positions examined before giving up. */
export const SEARCH_BUDGET = 20_000

// ---------------------------------------------------------------------------
// Compact board
// ---------------------------------------------------------------------------

interface Lean {
  stock: number[] // top = last
  waste: number[] // top = last
  found: number[] // cards home per suit
  cols: number[][] // bottom → top
  hidden: number[]
}

const code = (card: Card): number => SUITS.indexOf(card.suit) * 13 + RANKS.indexOf(card.rank)
const suitOf = (c: number) => (c / 13) | 0
const rankOf = (c: number) => (c % 13) + 1 // A=1 … K=13
const redOf = (c: number) => {
  const s = suitOf(c)
  return s === 1 || s === 2
}
const stacks = (upper: number, lower: number) =>
  rankOf(upper) === rankOf(lower) - 1 && redOf(upper) !== redOf(lower)

function toLean(b: Board): Lean {
  return {
    stock: b.stock.map(code),
    waste: b.waste.map(code),
    found: b.foundations.map((f) => f.length),
    cols: b.tableau.map((col) => col.cards.map(code)),
    hidden: b.tableau.map((col) => col.hidden),
  }
}

function keyOf(l: Lean): string {
  // One char per card (offset clear of the separators).
  const ch = (a: number[]) => String.fromCharCode(...a.map((c) => c + 64))
  let k = `${ch(l.stock)}|${ch(l.waste)}|${l.found.join('')}`
  for (let i = 0; i < 7; i++) k += `|${l.hidden[i]}${ch(l.cols[i])}`
  return k
}

const hiddenTotal = (l: Lean) => l.hidden.reduce((a, b) => a + b, 0)
const homeTotal = (l: Lean) => l.found.reduce((a, b) => a + b, 0)

/** Can card `c` go up on its suit's foundation? */
const upOk = (l: Lean, c: number) => l.found[suitOf(c)] === rankOf(c) - 1

/** Can a run headed by `c` land on column `t`? */
function landOk(l: Lean, t: number, c: number): boolean {
  const col = l.cols[t]
  return col.length === 0 ? rankOf(c) === 13 : stacks(c, col[col.length - 1])
}

/** Every legal move, as engine Moves (so a found line can be replayed). */
export function leanMoves(l: Lean): Move[] {
  const out: Move[] = []
  const w = l.waste[l.waste.length - 1]
  if (w !== undefined) {
    if (upOk(l, w)) out.push({ kind: 'move', from: 'waste', to: FOUNDATION_LOCS[suitOf(w)], count: 1 })
    for (let t = 0; t < 7; t++) if (landOk(l, t, w)) out.push({ kind: 'move', from: 'waste', to: TABLEAU_LOCS[t], count: 1 })
  }
  for (let f = 0; f < 7; f++) {
    const col = l.cols[f]
    const n = col.length
    if (n === 0) continue
    const top = col[n - 1]
    if (upOk(l, top)) out.push({ kind: 'move', from: TABLEAU_LOCS[f], to: FOUNDATION_LOCS[suitOf(top)], count: 1 })
    // every valid run from the top down to the first face-up card
    for (let i = n - 1; i >= l.hidden[f]; i--) {
      if (i < n - 1 && !stacks(col[i + 1], col[i])) break
      const count = n - i
      for (let t = 0; t < 7; t++) {
        if (t === f || !landOk(l, t, col[i])) continue
        // a whole king-headed column into another empty one changes nothing
        if (i === 0 && l.cols[t].length === 0) continue
        out.push({ kind: 'move', from: TABLEAU_LOCS[f], to: TABLEAU_LOCS[t], count })
      }
    }
  }
  for (let s = 0; s < 4; s++) {
    if (l.found[s] === 0) continue
    const c = s * 13 + l.found[s] - 1
    for (let t = 0; t < 7; t++) if (landOk(l, t, c)) out.push({ kind: 'move', from: FOUNDATION_LOCS[s], to: TABLEAU_LOCS[t], count: 1 })
  }
  if (l.stock.length > 0) out.push({ kind: 'draw' })
  else if (l.waste.length > 0) out.push({ kind: 'recycle' })
  return out
}

function leanApply(l: Lean, m: Move, draw: DrawMode): Lean {
  if (m.kind === 'draw') {
    const n = Math.min(draw, l.stock.length)
    const turned = l.stock.slice(l.stock.length - n).reverse()
    return { ...l, stock: l.stock.slice(0, l.stock.length - n), waste: l.waste.concat(turned) }
  }
  if (m.kind === 'recycle') return { ...l, stock: l.waste.slice().reverse(), waste: [] }

  const next: Lean = { ...l }
  let moving: number[]
  if (m.from === 'waste') {
    moving = [l.waste[l.waste.length - 1]]
    next.waste = l.waste.slice(0, -1)
  } else if (m.from[0] === 'f') {
    const s = Number(m.from.slice(1))
    moving = [s * 13 + l.found[s] - 1]
    next.found = l.found.slice()
    next.found[s]--
  } else {
    const f = Number(m.from.slice(1))
    const col = l.cols[f]
    moving = col.slice(col.length - m.count)
    next.cols = l.cols.slice()
    next.cols[f] = col.slice(0, col.length - m.count)
    next.hidden = l.hidden.slice()
    next.hidden[f] = Math.min(l.hidden[f], Math.max(0, next.cols[f].length - 1))
  }
  if (m.to[0] === 'f') {
    if (next.found === l.found) next.found = l.found.slice()
    next.found[Number(m.to.slice(1))]++
  } else {
    const t = Number(m.to.slice(1))
    if (next.cols === l.cols) next.cols = l.cols.slice()
    next.cols[t] = next.cols[t].concat(moving)
  }
  return next
}

/** Test hook: lean move generation for an engine board. */
export function leanMovesFor(b: Board): Move[] {
  return leanMoves(toLean(b))
}

/** Stable identity of a board (for "don't undo the last move" checks). */
export function boardKey(b: Board): string {
  return keyOf(toLean(b))
}

// ---------------------------------------------------------------------------

export function findProgress(state: KlondikeState, budget = SEARCH_BUDGET): LineResult {
  if (state.status !== 'playing') return { kind: 'dead' }
  const root = toLean(state)
  const hidden0 = hiddenTotal(root)
  // Progress is measured against the best this deal has reached recently, so
  // taking a card down and putting it straight back up never counts.
  const recent = state.history.slice(-60)
  const home0 = recent.reduce((m, b) => Math.max(m, homeTotal(toLean(b))), homeTotal(root))

  const boards: Lean[] = [root]
  const parent: number[] = [-1]
  const via: (Move | null)[] = [null]
  const seen = new Set<string>([keyOf(root)])
  // Never route back through the position the player just left.
  const prev = state.history[state.history.length - 1]
  if (prev) seen.add(keyOf(toLean(prev)))

  for (let head = 0; head < boards.length; head++) {
    if (boards.length > budget) return { kind: 'unknown' }
    const board = boards[head]
    for (const move of leanMoves(board)) {
      const next = leanApply(board, move, state.draw)
      const key = keyOf(next)
      if (seen.has(key)) continue
      seen.add(key)
      boards.push(next)
      parent.push(head)
      via.push(move)

      const reveals = hiddenTotal(next) < hidden0
      if (reveals || homeTotal(next) > home0) {
        const path: Move[] = []
        for (let i = boards.length - 1; i > 0; i = parent[i]) path.unshift(via[i] as Move)
        return { kind: 'found', path, reveals }
      }
    }
  }
  return { kind: 'dead' }
}
