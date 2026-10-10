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

The hint never peeks at face-down stock cards when choosing a move. Only the
"no moves left" verdict looks through the stock (simulating a full cycle),
because a trainer that says a deal is dead must be right.

`scripts/verify-klondike.ts` covers deal shape, rule legality, draw-3 packet
order and recycling, undo, auto-finish, stats, and a 600-deal hint-driven fuzz
asserting card conservation, legal hints, no loops, and a minimum win rate.

## src/games/klondike/ui/

`KlondikeGame` owns `useReducer` over the engine, the wall clock (paused while
the tab is hidden), persistence (the whole deal in progress survives a reload
or a game switch) and hotkeys. `KlondikeTable` measures the felt and sizes
cards to fit seven columns; a tap sends a card to its best spot, a drag drops
it exactly. Plain CSS in `klondike.css`, own class names (`kl*`).
