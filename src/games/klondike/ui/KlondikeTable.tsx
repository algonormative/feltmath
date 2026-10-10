import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Card } from '../../../shared/cards'
import { SUITS, SUIT_SYMBOL, isRedSuit } from '../../../shared/cards'
import { CardView } from '../../../shared/ui/CardView'
import { cssVars } from '../../../shared/ui/cssVars'
import { FOUNDATION_LOCS, TABLEAU_LOCS, isRun } from '../engine/game'
import type { KlondikeState, Loc } from '../types'

export interface Highlight {
  from?: Loc
  count?: number
  to?: Loc
}

export interface KlondikeTableProps {
  state: KlondikeState
  highlight: Highlight | null
  /** bump `key` to replay the "can't go anywhere" wiggle on a pile */
  shake: { loc: Loc; key: number } | null
  /** a fresh deal: cards fly in from the stock */
  dealing: boolean
  onTap: (loc: Loc, index: number) => void
  onDrop: (from: Loc, count: number, to: Loc) => void
}

interface Geometry {
  cardW: number
  cardH: number
  gap: number
  rowGap: number
  tableauH: number
}

interface Felt {
  width: number
  height: number
}

const RATIO = 1.4375
const DRAG_THRESHOLD = 7
/** Tightest fan that still shows a face-up card's rank and suit, in card heights. */
const UP_MIN = 0.19
const HIDDEN_MIN = 0.05

/** The felt's content box, kept current with a ResizeObserver. */
function useFelt(ref: React.RefObject<HTMLDivElement | null>): Felt | null {
  const [felt, setFelt] = useState<Felt | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const width = Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))
      const height = Math.floor(el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))
      if (width <= 0 || height <= 0) return
      setFelt((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return felt
}

/**
 * Card size for this felt and this deal. Seven across, a comfortable default
 * height, and — when a column grows long — small enough that the whole
 * column still fits above the controls at a legible fan.
 */
function fitGeometry({ width, height }: Felt, tableau: KlondikeState['tableau']): Geometry {
  const minGap = width < 440 ? 4 : 8
  const rowGap = width < 440 ? 10 : 16
  const byWidth = (width - minGap * 6) / 7
  const byHeight = height / (RATIO * 3.2)
  // top row (one card) + row gap + the tallest column at its tightest fan
  let worst = 0
  for (const col of tableau) {
    const up = col.cards.length - col.hidden
    if (col.cards.length === 0) continue
    worst = Math.max(worst, 1 + col.hidden * HIDDEN_MIN + Math.max(0, up - 1) * UP_MIN)
  }
  const byColumns = (height - rowGap) / (1 + worst) / RATIO
  const cardW = Math.floor(Math.max(30, Math.min(byWidth, byHeight, byColumns, 104)))
  const cardH = Math.round(cardW * RATIO)
  // When height is the limit, spread the columns a little — not edge to edge.
  const gap = Math.round(Math.min(Math.max(minGap, (width - cardW * 7) / 6), cardW * 0.3))
  return { cardW, cardH, gap, rowGap, tableauH: Math.max(cardH, height - cardH - rowGap) }
}

/** Vertical offsets for a column's cards, squeezed to fit the felt. */
function columnOffsets(cards: number, hidden: number, geo: Geometry): number[] {
  if (cards === 0) return []
  const { cardH, tableauH } = geo
  let dh = cardH * 0.13
  let uh = cardH * 0.29
  const up = cards - hidden
  const room = tableauH - cardH
  const need = () => hidden * dh + Math.max(0, up - 1) * uh
  if (need() > room && up > 1) uh = Math.max(cardH * UP_MIN, (room - hidden * dh) / (up - 1))
  if (need() > room && hidden > 0) dh = Math.max(cardH * HIDDEN_MIN, (room - Math.max(0, up - 1) * uh) / hidden)
  // Cards are already at their minimum size: squeeze whatever it takes.
  if (need() > room && need() > 0) {
    const k = Math.max(0, room) / need()
    dh *= k
    uh *= k
  }
  const out: number[] = []
  let y = 0
  for (let i = 0; i < cards; i++) {
    out.push(Math.round(y))
    y += i < hidden ? dh : uh
  }
  return out
}

interface PressState {
  loc: Loc
  index: number
  count: number
  pickable: boolean
  x: number
  y: number
  dragging: boolean
}

interface DragState {
  loc: Loc
  index: number
  dx: number
  dy: number
}

export function KlondikeTable({ state, highlight, shake, dealing, onTap, onDrop }: KlondikeTableProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const felt = useFelt(rootRef)
  const geo = useMemo(() => (felt ? fitGeometry(felt, state.tableau) : null), [felt, state.tableau])
  const press = useRef<PressState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  // Landing pops are for cards that move — not for the first paint after a
  // reload, when every card mounts at once.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 50)
    return () => clearTimeout(t)
  }, [])

  const pileCards = (loc: Loc): Card[] => {
    if (loc === 'stock') return state.stock
    if (loc === 'waste') return state.waste
    if (loc[0] === 'f') return state.foundations[Number(loc.slice(1))]
    return state.tableau[Number(loc.slice(1))].cards
  }

  const canPick = (loc: Loc, index: number): boolean => {
    if (state.status !== 'playing') return false
    const cards = pileCards(loc)
    if (loc === 'waste' || loc[0] === 'f') return index === cards.length - 1 && index >= 0
    if (loc[0] === 't') return isRun(state.tableau[Number(loc.slice(1))], index)
    return false
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, loc: Loc, index: number) => {
    if (e.button !== 0 || state.status !== 'playing') return
    e.preventDefault()
    const cards = pileCards(loc)
    press.current = {
      loc,
      index,
      count: Math.max(1, cards.length - index),
      pickable: canPick(loc, index),
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current
    if (!p || !p.pickable) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    p.dragging = true
    setDrag({ loc: p.loc, index: p.index, dx, dy })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (!p.dragging) {
      onTap(p.loc, p.index)
      return
    }
    setDrag(null)
    // Drop on whatever pile is under the finger (ignoring the pile we lifted from).
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const zone = (el as HTMLElement).closest<HTMLElement>('[data-drop]')
      const to = zone?.dataset.drop as Loc | undefined
      if (to && to !== p.loc) {
        onDrop(p.loc, p.count, to)
        return
      }
    }
  }

  const onPointerCancel = () => {
    press.current = null
    setDrag(null)
  }

  const handlers = (loc: Loc, index: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onPointerDown(e, loc, index),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  })

  const isDragged = (loc: Loc, index: number) => !!drag && drag.loc === loc && index >= drag.index
  const isHinted = (loc: Loc, index: number, length: number) =>
    !!highlight?.from && highlight.from === loc && index >= length - (highlight.count ?? 1)
  const shakeKey = (loc: Loc) => (shake && shake.loc === loc ? shake.key : 0)

  /** One positioned card. */
  const slot = (
    card: Card,
    loc: Loc,
    index: number,
    pos: { x: number; y: number; z: number },
    opts: { faceDown?: boolean; interactive?: boolean; length: number; delay?: number; deal?: { x: number; y: number } },
  ) => {
    const dragged = isDragged(loc, index)
    const hinted = isHinted(loc, index, opts.length)
    const target = highlight?.to === loc && index === opts.length - 1
    const shaking = shakeKey(loc) > 0 && !!opts.interactive
    const cls = [
      'klslot',
      dragged && 'is-dragging',
      hinted && 'is-hint',
      target && 'is-target',
      settled && !dealing && 'klslot--land',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <div
        key={shaking ? `${card.id}-s${shakeKey(loc)}` : card.id}
        className={`${cls}${shaking ? ' is-shake' : ''}`}
        style={cssVars({
          transform: dragged
            ? `translate(${pos.x + drag!.dx}px, ${pos.y + drag!.dy}px)`
            : `translate(${pos.x}px, ${pos.y}px)`,
          zIndex: dragged ? 100 + index : pos.z,
          '--delay': `${opts.delay ?? 0}ms`,
          '--deal-x': `${opts.deal?.x ?? 0}px`,
          '--deal-y': `${opts.deal?.y ?? 0}px`,
        } as Record<string, string | number>)}
        {...(opts.interactive ? handlers(loc, index) : {})}
      >
        <CardView card={card} faceDown={opts.faceDown} noDeal={!dealing} />
      </div>
    )
  }

  const g = geo
  const pitch = g ? g.cardW + g.gap : 0

  return (
    <div
      ref={rootRef}
      className={`kltable${drag ? ' is-dragging' : ''}${drag && (drag.loc === 'waste' || drag.loc[0] === 'f') ? ' is-dragging-top' : ''}`}
      style={
        g
          ? cssVars({
              '--card-w': `${g.cardW}px`,
              '--card-h': `${g.cardH}px`,
              '--kl-gap': `${g.gap}px`,
              '--kl-rowgap': `${g.rowGap}px`,
            })
          : undefined
      }
    >
      {g && (
        <>
          <div className="kltable__top">
            {/* stock */}
            <div
              className={`klpile klpile--stock${highlight?.from === 'stock' ? ' is-hint' : ''}`}
              data-drop="stock"
              onPointerDown={(e) => onPointerDown(e, 'stock', -1)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              role="button"
              aria-label={
                state.stock.length > 0
                  ? `Stock, ${state.stock.length} cards — tap to draw`
                  : state.waste.length > 0
                    ? 'Stock empty — tap to turn the waste over'
                    : 'Stock empty'
              }
            >
              {state.stock.length > 0 ? (
                <>
                  {state.stock.length > 1 && <div className="klpile__depth" aria-hidden="true" />}
                  <CardView card={state.stock[state.stock.length - 1]} faceDown noDeal />
                  <span className="klpile__count num" aria-hidden="true">
                    {state.stock.length}
                  </span>
                </>
              ) : (
                <span className="klpile__recycle" aria-hidden="true" data-live={state.waste.length > 0}>
                  {state.waste.length > 0 ? '↻' : ''}
                </span>
              )}
            </div>

            {/* waste */}
            <div className="klpile klpile--waste" data-drop="waste">
              {(() => {
                const w = state.waste
                if (w.length === 0) return null
                const fan = state.draw === 3 ? Math.max(1, Math.min(3, state.wasteFan, w.length)) : 1
                const start = Math.max(0, w.length - fan - 1) // one card beneath the fan for depth
                const out = []
                for (let i = start; i < w.length; i++) {
                  const fanPos = Math.max(0, i - (w.length - fan))
                  const under = i < w.length - fan
                  out.push(
                    slot(
                      w[i],
                      'waste',
                      i,
                      { x: under ? 0 : fanPos * g.cardW * 0.32, y: 0, z: i },
                      { interactive: i === w.length - 1, length: w.length },
                    ),
                  )
                }
                return out
              })()}
            </div>

            {/* foundations */}
            {FOUNDATION_LOCS.map((loc, f) => {
              const pile = state.foundations[f]
              const suit = SUITS[f]
              const target = highlight?.to === loc
              return (
                <div
                  key={loc}
                  className={`klpile klpile--found${target && pile.length === 0 ? ' is-target' : ''}`}
                  data-drop={loc}
                  aria-label={`${suit} foundation${pile.length ? `, up to ${pile[pile.length - 1].rank}` : ', empty'}`}
                >
                  <span className="klpile__ghost" data-red={isRedSuit(suit)} aria-hidden="true">
                    {SUIT_SYMBOL[suit]}
                  </span>
                  {pile.slice(-2).map((card, k) => {
                    const index = pile.length - Math.min(2, pile.length) + k
                    return slot(card, loc, index, { x: 0, y: 0, z: index }, {
                      interactive: index === pile.length - 1,
                      length: pile.length,
                    })
                  })}
                </div>
              )
            })}
          </div>

          <div className="kltable__cols">
            {TABLEAU_LOCS.map((loc, c) => {
              const column = state.tableau[c]
              const offsets = columnOffsets(column.cards.length, column.hidden, g)
              const source = drag?.loc === loc
              const emptyTarget = highlight?.to === loc && column.cards.length === 0
              return (
                <div
                  key={loc}
                  className={`klcol${source ? ' is-source' : ''}`}
                  data-drop={loc}
                  aria-label={`Column ${c + 1}`}
                >
                  <div className={`klcol__base${emptyTarget ? ' is-target' : ''}`} aria-hidden="true">
                    K
                  </div>
                  {column.cards.map((card, i) =>
                    slot(
                      card,
                      loc,
                      i,
                      { x: 0, y: offsets[i], z: i },
                      {
                        faceDown: i < column.hidden,
                        interactive: i >= column.hidden,
                        length: column.cards.length,
                        delay: (i * 7 + c - (i * (i + 1)) / 2) * 34,
                        deal: { x: -c * pitch, y: -(g.cardH + g.rowGap) - offsets[i] },
                      },
                    ),
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
