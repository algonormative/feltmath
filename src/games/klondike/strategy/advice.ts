// Klondike coaching: rank the legal moves by classic solitaire strategy and
// explain the pick in plain English. Ordinary hints never peek at face-down
// stock cards. Only when the board offers nothing obvious does the look-ahead
// in search.ts (which sees the whole deck) step in — either to find the line
// that keeps the deal alive, or to prove it is dead, because a trainer saying
// "you're done" must be right.

import type { Card } from '../../../shared/cards'
import { SUIT_SYMBOL, isRedSuit } from '../../../shared/cards'
import {
  FOUNDATION_LOCS,
  TABLEAU_LOCS,
  applyMove,
  cardsAt,
  foundationIndex,
  isFoundation,
  isLegal,
  isTableau,
  legalMoves,
  locIndex,
  rankValue,
  stacksOn,
} from '../engine/game'
import type { KlondikeAdvice, KlondikeState, Loc, Move } from '../types'
import { boardKey, findProgress } from './search'

export function cardName(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

export function locName(loc: Loc): string {
  if (loc === 'stock') return 'the stock'
  if (loc === 'waste') return 'the waste'
  if (isFoundation(loc)) return 'the foundation'
  return `column ${locIndex(loc) + 1}`
}

export interface ScoredMove {
  move: Move
  score: number
  label: string
  situation: string
  explanation: string
}

/** Below this a move is busywork, not progress. */
const PRODUCTIVE = 12

/** Both opposite-colour foundations are high enough that nothing needs this card as a parent. */
function safeToPlayUp(state: KlondikeState, card: Card): boolean {
  const r = rankValue(card.rank)
  if (r <= 2) return true
  const red = isRedSuit(card.suit)
  return state.foundations.every((pile, i) => {
    const suitRed = i === 1 || i === 2 // ♥ ♦
    return suitRed === red || pile.length >= r - 1
  })
}

/** A king is somewhere the player can see and could bring to an empty column. */
function kingReady(state: KlondikeState, exceptColumn: number): Card | null {
  const waste = state.waste[state.waste.length - 1]
  if (waste?.rank === 'K') return waste
  for (let c = 0; c < 7; c++) {
    if (c === exceptColumn) continue
    const column = state.tableau[c]
    // A face-up king with cards hidden under it — moving it would turn one over.
    const base = column.cards[column.hidden]
    if (column.hidden > 0 && base?.rank === 'K') return base
  }
  return null
}

function mostHidden(state: KlondikeState): number {
  return Math.max(...state.tableau.map((column) => column.hidden))
}

function scoreMove(state: KlondikeState, move: Move): ScoredMove | null {
  if (move.kind === 'draw') {
    return {
      move,
      score: 10,
      label: 'DRAW',
      situation: `Turn ${state.draw === 3 ? 'three' : 'a card'} from the stock`,
      explanation:
        'Nothing on the board makes progress right now, so dig into the stock for a card you can use.',
    }
  }
  if (move.kind === 'recycle') {
    return {
      move,
      score: 8,
      label: 'RESET',
      situation: 'Flip the waste back into the stock',
      explanation:
        'The stock is spent and nothing else helps. Turn the waste over and go through it again — cards you played since last pass change what comes up.',
    }
  }

  const { from, to, count } = move
  const src = cardsAt(state, from)
  const card = src[src.length - count]
  const name = cardName(card)

  // How the source column changes.
  const fromCol = isTableau(from) ? state.tableau[locIndex(from)] : null
  const baseIndex = fromCol ? fromCol.cards.length - count : -1
  const reveals = !!fromCol && fromCol.hidden > 0 && baseIndex === fromCol.hidden
  const empties = !!fromCol && baseIndex === 0
  const exposed = fromCol && baseIndex > fromCol.hidden ? fromCol.cards[baseIndex - 1] : null
  const hidden = fromCol?.hidden ?? 0

  // ---- to a foundation -----------------------------------------------------
  if (isFoundation(to)) {
    const r = rankValue(card.rank)
    if (r <= 2) {
      return {
        move,
        score: 100,
        label: 'PLAY UP',
        situation: `${name} to the foundation`,
        explanation:
          card.rank === 'A'
            ? 'Aces belong on the foundation the moment you see them — nothing can ever be built on one in the tableau.'
            : 'Twos are always safe to play up: the only card that could sit on one is an ace, and aces go straight up.',
      }
    }
    if (reveals) {
      return {
        move,
        score: 90 + hidden,
        label: 'PLAY UP',
        situation: `${name} up from ${locName(from)}`,
        explanation: `Plays the ${name} up and turns over a face-down card in ${locName(from)} — two kinds of progress in one move.`,
      }
    }
    if (safeToPlayUp(state, card)) {
      const parent = r - 1
      return {
        move,
        score: 80,
        label: 'PLAY UP',
        situation: `${name} to the foundation`,
        explanation: `Safe to play up: both ${isRedSuit(card.suit) ? 'black' : 'red'} foundations are already at ${rankLabel(parent)} or higher, so no card will ever need the ${name} to land on.`,
      }
    }
    return {
      move,
      score: from === 'waste' ? 34 : 30,
      label: 'PLAY UP',
      situation: `${name} to the foundation`,
      explanation: `Legal and it's progress, but not risk-free: a ${isRedSuit(card.suit) ? 'black' : 'red'} ${rankLabel(r - 1)} still in play might want the ${name} as a home. Play it up when nothing better is on.`,
    }
  }

  // ---- foundation back down ---------------------------------------------
  if (isFoundation(from)) {
    // Only worth it when it lets something else land.
    const wasteTop = state.waste[state.waste.length - 1]
    if (wasteTop && stacksOn(wasteTop, card)) {
      return {
        move,
        score: 22,
        label: 'TAKE DOWN',
        situation: `${name} back to ${locName(to)}`,
        explanation: `Pulling the ${name} off the foundation gives the ${cardName(wasteTop)} from the waste somewhere to go.`,
      }
    }
    for (const column of state.tableau) {
      const base = column.cards[column.hidden]
      if (column.hidden > 0 && base && stacksOn(base, card)) {
        return {
          move,
          score: 20,
          label: 'TAKE DOWN',
          situation: `${name} back to ${locName(to)}`,
          explanation: `Bringing the ${name} down makes a landing spot for the ${cardName(base)}, which is sitting on face-down cards.`,
        }
      }
    }
    return null
  }

  const toCol = state.tableau[locIndex(to as (typeof TABLEAU_LOCS)[number])]
  const intoEmpty = toCol.cards.length === 0
  const onto = intoEmpty ? 'the empty column' : `the ${cardName(toCol.cards[toCol.cards.length - 1])}`

  // ---- waste to tableau ---------------------------------------------------
  if (from === 'waste') {
    return {
      move,
      score: intoEmpty ? 55 : 60,
      label: 'MOVE',
      situation: `${name} onto ${onto}`,
      explanation: intoEmpty
        ? `A king from the waste is a fine use of an empty column — it's the only card that can start one.`
        : `Getting the ${name} out of the waste puts another card in play and keeps the stock moving.`,
    }
  }

  // ---- tableau to tableau -------------------------------------------------
  const what = runLabel(name, count)
  if (reveals) {
    const most = hidden === mostHidden(state)
    return {
      move,
      score: 70 + hidden * 2 - (intoEmpty ? 4 : 0),
      label: 'MOVE',
      situation: `${what} onto ${onto}`,
      explanation: `Turns over a face-down card in ${locName(from)}${
        hidden > 1
          ? most
            ? ` — it has ${hidden} hidden, the most on the table, so that's where the buried cards are`
            : ` (${hidden} hidden there)`
          : ''
      }. Revealing cards is the main way to win Klondike.`,
    }
  }

  if (empties) {
    if (card.rank === 'K') return null // king to another empty column: going nowhere
    const king = kingReady(state, locIndex(from as (typeof TABLEAU_LOCS)[number]))
    if (!king) return null
    return {
      move,
      score: 50,
      label: 'MOVE',
      situation: `${what} onto ${onto}`,
      explanation: `Clears ${locName(from)} so the ${cardName(king)} has a home. Only empty a column when a king is ready to fill it.`,
    }
  }

  if (exposed) {
    // Splitting a run is only worth it when the card underneath does something.
    const exposedUp = state.foundations[foundationIndex(exposed)].length === rankValue(exposed.rank) - 1
    // Burying a card that could go up itself just trades one for the other.
    const destTop = toCol.cards[toCol.cards.length - 1]
    const destUp =
      !!destTop &&
      state.foundations[foundationIndex(destTop)].length === rankValue(destTop.rank) - 1
    if (exposedUp && !destUp) {
      return {
        move,
        score: 45,
        label: 'MOVE',
        situation: `${what} onto ${onto}`,
        explanation: `Uncovers the ${cardName(exposed)} so it can go up to the foundation next.`,
      }
    }
    const wasteTop = state.waste[state.waste.length - 1]
    // …and only if the waste card has nowhere to go today (otherwise this is
    // just shuffling a run between two equal parents).
    const wasteStuck =
      !!wasteTop &&
      !TABLEAU_LOCS.some((t) => isLegal(state, { kind: 'move', from: 'waste', to: t, count: 1 }))
    if (wasteTop && wasteStuck && stacksOn(wasteTop, exposed)) {
      return {
        move,
        score: 40,
        label: 'MOVE',
        situation: `${what} onto ${onto}`,
        explanation: `Frees the ${cardName(exposed)} so the ${cardName(wasteTop)} from the waste can land on it.`,
      }
    }
  }
  return null
}

function runLabel(name: string, count: number): string {
  return count > 1 ? `${name} and ${count - 1} more card${count > 2 ? 's' : ''}` : name
}

function rankLabel(value: number): string {
  return value === 1 ? 'A' : value === 11 ? 'J' : value === 12 ? 'Q' : value === 13 ? 'K' : String(value)
}

/** Every legal, non-pointless move with its score, best first. */
export function rankedMoves(state: KlondikeState): ScoredMove[] {
  const scored: ScoredMove[] = []
  // Never advise straight back to the position before the last move — that is
  // how a take-down followed by a play-up (or a run shuffled back) loops.
  const prev = state.history[state.history.length - 1]
  const prevKey = prev ? boardKey(prev) : null
  for (const move of legalMoves(state)) {
    const s = scoreMove(state, move)
    if (!s) continue
    if (prevKey && move.kind === 'move' && boardKey(applyMove(state, move)) === prevKey) continue
    scored.push(s)
  }
  // Stable: ties keep enumeration order (waste first, then columns left → right).
  return scored.sort((a, b) => b.score - a.score)
}

/**
 * Does any card the stock will ever show have a legal landing spot? Looks
 * through face-down stock cards — used only for the dead-deal verdict.
 */
function stockCanHelp(state: KlondikeState): boolean {
  let probe = state
  const limit = (state.stock.length + state.waste.length + 2) * 2
  for (let i = 0; i < limit; i++) {
    const top = probe.waste[probe.waste.length - 1]
    if (top) {
      for (const to of [...FOUNDATION_LOCS, ...TABLEAU_LOCS]) {
        if (isLegal(probe, { kind: 'move', from: 'waste', to, count: 1 })) return true
      }
    }
    const next = probe.stock.length > 0 ? applyMove(probe, { kind: 'draw' }) : applyMove(probe, { kind: 'recycle' })
    if (next === probe) return false
    probe = next
  }
  return false
}

/** Label + one-line description for any legal move (used for look-ahead lines). */
function describeMove(state: KlondikeState, move: Move): { label: string; situation: string } {
  if (move.kind === 'draw') return { label: 'DRAW', situation: `Turn ${state.draw === 3 ? 'three' : 'a card'} from the stock` }
  if (move.kind === 'recycle') return { label: 'RESET', situation: 'Flip the waste back into the stock' }
  const src = cardsAt(state, move.from)
  const card = src[src.length - move.count]
  const name = cardName(card)
  if (isFoundation(move.to)) return { label: 'PLAY UP', situation: `${name} to the foundation` }
  if (isFoundation(move.from)) return { label: 'TAKE DOWN', situation: `${name} back to ${locName(move.to)}` }
  const dest = cardsAt(state, move.to)
  const onto = dest.length === 0 ? 'the empty column' : `the ${cardName(dest[dest.length - 1])}`
  return { label: 'MOVE', situation: `${runLabel(name, move.count)} onto ${onto}` }
}

export function klondikeAdvice(state: KlondikeState): KlondikeAdvice {
  if (state.status !== 'playing') {
    return { move: null, label: 'SOLVED', situation: 'Every card is home', explanation: 'Nice work.', stuck: false }
  }
  const ranked = rankedMoves(state)
  const best = ranked[0]

  if (best && best.score >= PRODUCTIVE) {
    return { ...best, stuck: false }
  }

  // Only stock moves (or busywork) remain: will the stock show something playable?
  if (best && stockCanHelp(state)) {
    return { ...best, stuck: false }
  }

  // Nothing obvious. Look further ahead before calling it.
  const line = findProgress(state)
  if (line.kind === 'found') {
    const move = line.path[0]
    const steps = line.path.length
    const goal = line.reveals ? 'turns over a face-down card' : 'gets another card home'
    return {
      move,
      ...describeMove(state, move),
      explanation:
        steps === 1
          ? `It doesn't look like much, but it ${goal}.`
          : `Nothing pays off right away, but looking ahead this starts a ${steps}-move line that ${goal}. Ask again after each move to follow it.`,
      stuck: false,
    }
  }

  if (line.kind === 'dead') {
    return {
      move: null,
      label: 'STUCK',
      situation: 'No moves left',
      explanation:
        'Every line from here — board moves, take-downs, and every pass through the stock — has been checked, and none turns over another card or gets one home. Undo to try a different line, or deal a new game: not every Klondike deal can be won.',
      stuck: true,
      certain: true,
    }
  }

  return {
    move: null,
    label: 'STUCK?',
    situation: 'No obvious moves',
    explanation:
      "Thousands of lines from here were checked without finding a way to turn over another card. There may be a long one, but it's probably time to undo or deal again.",
    stuck: true,
    certain: false,
  }
}

/**
 * The destination a tap should send a card to: the foundation if it can go
 * up, otherwise the best-ranked tableau spot (kings prefer empty columns,
 * everything else prefers a real card to sit on).
 */
export function smartMove(state: KlondikeState, from: Loc, count: number): Move | null {
  if (from === 'stock') {
    if (state.stock.length > 0) return { kind: 'draw' }
    if (state.waste.length > 0) return { kind: 'recycle' }
    return null
  }
  const candidates: Move[] = []
  if (count === 1) {
    for (const to of FOUNDATION_LOCS) candidates.push({ kind: 'move', from, to, count })
  }
  for (const to of TABLEAU_LOCS) candidates.push({ kind: 'move', from, to, count })
  const legal = candidates.filter((m) => isLegal(state, m))
  if (legal.length === 0) return null

  const up = legal.find((m) => m.kind === 'move' && isFoundation(m.to))
  if (up) return up

  const src = cardsAt(state, from)
  const card = src[src.length - count]
  // A king already at the bottom of its column gains nothing from a new empty one.
  const fromBase = isTableau(from) && state.tableau[locIndex(from)].cards.length === count
  const useful = legal.filter(
    (m) =>
      !(fromBase && m.kind === 'move' && state.tableau[locIndex(m.to as (typeof TABLEAU_LOCS)[number])].cards.length === 0),
  )
  if (useful.length === 0) return null
  const rank = (m: Move): number => {
    if (m.kind !== 'move') return 0
    const empty = state.tableau[locIndex(m.to as (typeof TABLEAU_LOCS)[number])].cards.length === 0
    const scored = scoreMove(state, m)?.score ?? 0
    return scored + (empty ? (card.rank === 'K' ? 5 : -50) : 0)
  }
  return useful.sort((a, b) => rank(b) - rank(a))[0]
}
