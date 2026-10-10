// Klondike solitaire — single source of type truth (see CONTRACT-KLONDIKE.md).

import type { Card } from '../../shared/cards'

export type DrawMode = 1 | 3

export interface KlondikeConfig {
  /** cards turned per stock draw */
  draw: DrawMode
}

export const DEFAULT_KLONDIKE: KlondikeConfig = { draw: 1 }

/** Foundation slots are fixed by suit, in SUITS order (♠ ♥ ♦ ♣). */
export type FoundationLoc = 'f0' | 'f1' | 'f2' | 'f3'
export type TableauLoc = 't0' | 't1' | 't2' | 't3' | 't4' | 't5' | 't6'
/** Every place a card can be picked up from or dropped on. */
export type Loc = 'stock' | 'waste' | FoundationLoc | TableauLoc

export interface Column {
  /** bottom → top */
  cards: Card[]
  /** how many cards at the bottom are still face down */
  hidden: number
}

export type Move =
  | { kind: 'draw' }
  | { kind: 'recycle' }
  | { kind: 'move'; from: Loc; to: Loc; count: number }

export interface KlondikeStats {
  /** deals where at least one move was made */
  played: number
  won: number
  streak: number
  bestStreak: number
  fewestMoves: number | null
  fastestMs: number | null
  /** wins without a single hint or undo */
  cleanWins: number
}

export const EMPTY_KLONDIKE_STATS: KlondikeStats = {
  played: 0,
  won: 0,
  streak: 0,
  bestStreak: 0,
  fewestMoves: null,
  fastestMs: null,
  cleanWins: 0,
}

/** The board — everything an undo has to restore. */
export interface Board {
  stock: Card[] // top = last
  waste: Card[] // top = last
  /** cards from the latest draw still fanned on top of the waste (draw-3 display) */
  wasteFan: number
  foundations: Card[][] // [♠, ♥, ♦, ♣], top = last
  tableau: Column[] // 7 columns
  moves: number
  recycles: number
}

export interface KlondikeState extends Board {
  /** applies to the next deal */
  config: KlondikeConfig
  /** draw mode of the deal on the table */
  draw: DrawMode
  dealNumber: number
  /** seed for the next shuffle — all randomness flows through shared/rng */
  rngSeed: number
  status: 'playing' | 'won'
  hintsUsed: number
  undos: number
  /** this deal already counted toward stats.played */
  counted: boolean
  history: Board[]
  stats: KlondikeStats
}

/** A trainer recommendation for the current position. */
export interface KlondikeAdvice {
  /** null when the position is dead (no productive moves left) */
  move: Move | null
  /** short verb chip: "PLAY UP", "MOVE", "DRAW"… */
  label: string
  /** one-line what: "7♥ onto 8♣" */
  situation: string
  /** plain-English why */
  explanation: string
  /** the board has no productive move left, even cycling the stock */
  stuck: boolean
}
