# Klondike module contract

Klondike solitaire lives in `src/games/klondike/`. Types are defined once in
`src/games/klondike/types.ts`; cards and the seeded RNG come from
`src/shared/`. Do not redefine them.

## Rules implemented

- One 52-card deck; seven columns of 1–7 cards, top card face up; 24 in the stock.
- Tableau builds down in alternating colours; only a king (or a run headed by
  one) fills an empty column. Any face-up run that is itself a valid sequence
  can move.
- Foundations build up by suit from the ace. Slots are fixed by suit in
  `SUITS` order (♠ ♥ ♦ ♣) — `f0`…`f3`. A foundation top may come back down to
  the tableau.
- Draw 1 or Draw 3 from the stock, unlimited passes. A draw-3 packet lands in
  physical order (the last of the three turned is on top); a recycle restores
  the original stock order.
- An exposed face-down card flips automatically as part of the move that
  exposed it.

## src/games/klondike/engine/game.ts

Pure functions only — every mutator returns a NEW `KlondikeState`, or the
identical object when the request is illegal (so React bails out of a
re-render). All randomness flows through `rngSeed` + `src/shared/rng.ts`; no
`Date.now` / `Math.random`.

```ts
export function newKlondike(config: KlondikeConfig, seed: number, stats?: KlondikeStats): KlondikeState
export function newDeal(state: KlondikeState): KlondikeState          // abandoning a counted, unwon deal resets the streak
export function applyConfig(state: KlondikeState, config: KlondikeConfig): KlondikeState // staged for the next deal
export function resetStats(state: KlondikeState): KlondikeState

export function isLegal(state: KlondikeState, move: Move): boolean
export function legalMoves(state: KlondikeState): Move[]              // includes draw / recycle
export function applyMove(state: KlondikeState, move: Move): KlondikeState
export function undo(state: KlondikeState): KlondikeState             // history capped at 400 boards
export function canUndo(state: KlondikeState): boolean

export function canAutoFinish(state: KlondikeState): boolean          // stock + waste empty, nothing face down
export function autoFinishMove(state: KlondikeState): Move | null     // lowest column top that can go up

export function noteHint(state: KlondikeState): KlondikeState         // clean-win tracking
export function recordWinTime(state: KlondikeState, ms: number): KlondikeState // clock lives in the UI
```

Stats are updated inside the engine: the first move of a deal counts it as
played; reaching 52 cards home records the win, streak, fewest moves and a
"clean" win when no hint or undo was used.

## src/games/klondike/strategy/advice.ts

```ts
export function klondikeAdvice(state: KlondikeState): KlondikeAdvice
export function rankedMoves(state: KlondikeState): ScoredMove[]
export function smartMove(state: KlondikeState, from: Loc, count: number): Move | null  // tap-to-move target
```

Moves are ranked by classic Klondike strategy, each with a plain-English
reason: aces and twos up first; moves that turn over a face-down card,
preferring the column with the most hidden; foundation plays that are safe
(both opposite-colour foundations already high enough); waste cards into play;
empty a column only when a king is ready to fill it; split a run only when the
card underneath can then go up or receive the waste card. Pointless shuffles
are never suggested.

Ordinary hints never peek at face-down stock cards. When nothing on the
board is obviously productive and the stock can't help either,
`strategy/search.ts` takes over: a breadth-first look-ahead over every legal
move (take-downs and stock passes included, on a compact integer board) for
the shortest line that turns over a face-down card or gets a card home past
the deal's recent best. Its first move becomes the hint ("starts a 7-move
line…"). It never routes back through the position just left, so hints can't
ping-pong. If the reachable positions run out, the deal is provably dead
("No moves left"); if the 20k-position budget runs out first, the verdict is
the softer "No obvious moves".

```ts
export function findProgress(state: KlondikeState, budget?: number): LineResult // found | dead | unknown
```

`scripts/verify-klondike.ts` covers deal shape, rule legality, draw-3 packet
order and recycling, undo, auto-finish, stats, boards a playtester found
wrongly called dead (`scripts/fixtures/`), a cross-check of the look-ahead's
move generator against the engine, and a 600-deal hint-driven fuzz asserting
card conservation, legal hints, no loops, and a minimum win rate.

## src/games/klondike/ui/

`KlondikeGame` owns `useReducer` over the engine, the wall clock (paused while
the tab is hidden), persistence (the whole deal in progress survives a reload
or a game switch) and hotkeys. `KlondikeTable` measures the felt and sizes
cards to fit seven columns — and shrinks them when a column grows too long to
fan legibly above the controls; a tap sends a card to its best spot, a drag drops
it exactly. Plain CSS in `klondike.css`, own class names (`kl*`).
