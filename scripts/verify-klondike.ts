// Klondike verification probe: deal shape, rule legality, draw-3 cycling,
// undo, and a hint-driven fuzz over many deals with conservation invariants.

import type { Card, Rank, Suit } from '../src/shared/cards'
import {
  TABLEAU_LOCS,
  applyMove,
  autoFinishMove,
  canAutoFinish,
  isLegal,
  legalMoves,
  newDeal,
  newKlondike,
  noteHint,
  recordWinTime,
  undo,
} from '../src/games/klondike/engine/game'
import { klondikeAdvice, smartMove } from '../src/games/klondike/strategy/advice'
import type { KlondikeState } from '../src/games/klondike/types'
import { DEFAULT_KLONDIKE } from '../src/games/klondike/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label} ${detail}`)
  if (!ok) failures++
}

const c = (spec: string): Card => {
  const suitCh = spec.slice(-1)
  let rank = spec.slice(0, -1)
  if (rank === 'T') rank = '10'
  const suit: Suit =
    suitCh === 's' ? 'spades' : suitCh === 'h' ? 'hearts' : suitCh === 'd' ? 'diamonds' : 'clubs'
  return { rank: rank as Rank, suit, id: spec }
}

function allCards(s: KlondikeState): Card[] {
  return [...s.stock, ...s.waste, ...s.foundations.flat(), ...s.tableau.flatMap((col) => col.cards)]
}

function invariants(s: KlondikeState): string | null {
  const cards = allCards(s)
  if (cards.length !== 52) return `card count ${cards.length}`
  if (new Set(cards.map((x) => x.id)).size !== 52) return 'duplicate card'
  for (let i = 0; i < 4; i++) {
    const pile = s.foundations[i]
    for (let k = 0; k < pile.length; k++) {
      if (pile[k].suit !== ['spades', 'hearts', 'diamonds', 'clubs'][i]) return 'foundation suit'
      if (pile[k].rank !== ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][k])
        return 'foundation order'
    }
  }
  for (const col of s.tableau) {
    if (col.hidden < 0 || col.hidden > Math.max(0, col.cards.length - 1)) return 'hidden range'
  }
  if (s.wasteFan > Math.min(s.waste.length, s.draw)) return 'waste fan'
  return null
}

/** Hand-built position on a fresh state. */
function position(patch: Partial<KlondikeState>): KlondikeState {
  const base = newKlondike(DEFAULT_KLONDIKE, 1)
  return {
    ...base,
    stock: [],
    waste: [],
    wasteFan: 0,
    foundations: [[], [], [], []],
    tableau: TABLEAU_LOCS.map(() => ({ cards: [], hidden: 0 })),
    ...patch,
  }
}

// --- deal shape ------------------------------------------------------------
{
  const s = newKlondike(DEFAULT_KLONDIKE, 12345)
  check('deal: 52 unique cards', invariants(s) === null, invariants(s) ?? '')
  check('deal: 24 in stock', s.stock.length === 24)
  check('deal: columns 1..7 with i hidden', s.tableau.every((col, i) => col.cards.length === i + 1 && col.hidden === i))
  check('deal: deterministic per seed',
    JSON.stringify(newKlondike(DEFAULT_KLONDIKE, 99).tableau) === JSON.stringify(newKlondike(DEFAULT_KLONDIKE, 99).tableau))
  const n = newDeal(s)
  check('newDeal shuffles a different deal', JSON.stringify(n.tableau) !== JSON.stringify(s.tableau))
}

// --- rules -------------------------------------------------------------------
{
  const s = position({
    waste: [c('As')],
    tableau: [
      { cards: [c('8c')], hidden: 0 },
      { cards: [c('3d'), c('7h')], hidden: 1 },
      { cards: [], hidden: 0 },
      { cards: [c('3c'), c('Kh'), c('Qs')], hidden: 1 },
      { cards: [c('8h')], hidden: 0 },
      { cards: [], hidden: 0 },
      { cards: [], hidden: 0 },
    ],
  })
  check('rule: 7♥ on 8♣', isLegal(s, { kind: 'move', from: 't1', to: 't0', count: 1 }))
  check('rule: 7♥ not on 8♥ (same colour)', !isLegal(s, { kind: 'move', from: 't1', to: 't4', count: 1 }))
  check('rule: only kings fill empty columns', !isLegal(s, { kind: 'move', from: 't1', to: 't2', count: 1 }))
  check('rule: K-Q run to empty column', isLegal(s, { kind: 'move', from: 't3', to: 't2', count: 2 }))
  check('rule: A♠ only to the ♠ foundation',
    isLegal(s, { kind: 'move', from: 'waste', to: 'f0', count: 1 })
    && !isLegal(s, { kind: 'move', from: 'waste', to: 'f1', count: 1 }))
  check('rule: 3♦ cannot go up before the A♦', !isLegal(s, { kind: 'move', from: 't4', to: 'f2', count: 1 }))
  check('rule: face-down card cannot move', !isLegal(s, { kind: 'move', from: 't1', to: 't0', count: 2 }))
  const moved = applyMove(s, { kind: 'move', from: 't1', to: 't0', count: 1 })
  check('move auto-flips the exposed card', moved.tableau[1].hidden === 0 && moved.tableau[0].cards.length === 2)
  check('illegal move returns identical state', applyMove(s, { kind: 'move', from: 't1', to: 't4', count: 1 }) === s)
  check('undo restores the board', JSON.stringify(undo(moved).tableau) === JSON.stringify(s.tableau) && undo(moved).undos === 1)
  const tap = smartMove(s, 'waste', 1)
  check('tap sends the ace up', tap?.kind === 'move' && tap.to === 'f0')
  const kingTap = smartMove(s, 't3', 2)
  check('tap sends K-Q to an empty column', kingTap?.kind === 'move' && kingTap.to === 't2')
  const advice = klondikeAdvice(s)
  check('hint plays the ace first', advice.move?.kind === 'move' && advice.move.to === 'f0', advice.situation)
}

// --- draw 3 ------------------------------------------------------------------
{
  const s0 = newKlondike({ draw: 3 }, 7)
  const physical = s0.stock.slice(-3).reverse()
  const s1 = applyMove(s0, { kind: 'draw' })
  check('draw-3 turns three, packet order flipped',
    s1.waste.length === 3 && s1.waste.map((x) => x.id).join() === physical.map((x) => x.id).join())
  check('draw-3 fan is three', s1.wasteFan === 3)
  let s = s1
  while (s.stock.length > 0) s = applyMove(s, { kind: 'draw' })
  check('draw-3 runs the stock out (8 draws)', s.moves === 8 && s.waste.length === 24)
  const r = applyMove(s, { kind: 'recycle' })
  check('recycle restores original stock order',
    r.stock.map((x) => x.id).join() === s0.stock.map((x) => x.id).join() && r.recycles === 1)
}

// --- auto finish ---------------------------------------------------------
{
  const suits = ['s', 'h', 'd', 'c']
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']
  // Foundations up to 9; four columns of K-Q-J-10 alternating colours.
  const foundations = suits.map((suit) => ranks.slice(0, 9).map((r) => c(r + suit)))
  const tableau = TABLEAU_LOCS.map(() => ({ cards: [] as Card[], hidden: 0 }))
  tableau[0].cards = [c('Ks'), c('Qh'), c('Jc'), c('Td')]
  tableau[1].cards = [c('Kh'), c('Qs'), c('Jd'), c('Tc')]
  tableau[2].cards = [c('Kd'), c('Qc'), c('Jh'), c('Ts')]
  tableau[3].cards = [c('Kc'), c('Qd'), c('Js'), c('Th')]
  let s = position({ foundations, tableau, counted: true })
  check('auto-finish available', canAutoFinish(s))
  let steps = 0
  for (let m = autoFinishMove(s); m && steps < 60; m = autoFinishMove(s)) {
    s = applyMove(s, m)
    steps++
  }
  check('auto-finish solves it', s.status === 'won' && steps === 16, `${steps} steps`)
  check('win counted', s.stats.won === 1 && s.stats.streak === 1 && s.stats.fewestMoves === 16)
  check('clean win counted', s.stats.cleanWins === 1)
  check('win time recorded', recordWinTime(s, 90_000).stats.fastestMs === 90_000)
  check('no moves after a win', legalMoves(s).length === 0)
  check('hinted win is not clean',
    (() => {
      let h = noteHint(position({ foundations, tableau }))
      for (let m = autoFinishMove(h); m; m = autoFinishMove(h)) h = applyMove(h, m)
      return h.status === 'won' && h.stats.cleanWins === 0
    })())
}

// --- hint-driven fuzz ---------------------------------------------------------
for (const draw of [1, 3] as const) {
  let won = 0
  let stuck = 0
  let bad = ''
  let illegal = 0
  const deals = 300
  for (let d = 0; d < deals && !bad; d++) {
    let s = newKlondike({ draw }, 1000 + d * 7919)
    for (let i = 0; i < 1500; i++) {
      if (canAutoFinish(s)) {
        const m = autoFinishMove(s)
        if (!m) { bad = 'auto-finish had no move'; break }
        s = applyMove(s, m)
        continue
      }
      const advice = klondikeAdvice(s)
      if (!advice.move) { if (advice.stuck) stuck++; break }
      if (!isLegal(s, advice.move)) { illegal++; break }
      const next = applyMove(s, advice.move)
      const err = invariants(next)
      if (err) { bad = `deal ${d}: ${err}`; break }
      s = next
      if (s.status === 'won') break
    }
    if (s.status === 'won') won++
  }
  check(`fuzz draw-${draw}: invariants hold over ${deals} deals`, bad === '', bad)
  check(`fuzz draw-${draw}: hint never suggests an illegal move`, illegal === 0)
  check(`fuzz draw-${draw}: every deal ends won or stuck (no loops)`, won + stuck === deals,
    `won ${won} · stuck ${stuck}`)
  check(`fuzz draw-${draw}: hint bot wins some deals`, won > deals * (draw === 1 ? 0.35 : 0.08),
    `${((won / deals) * 100).toFixed(1)}%`)
}


console.log(failures === 0 ? '\nALL KLONDIKE CHECKS PASSED' : `\n${failures} KLONDIKE CHECKS FAILED`)
if (failures > 0) process.exitCode = 1
