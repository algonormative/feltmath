import { ChevronIcon } from '../../../shared/ui/Icons'
import type { KlondikeStats as Stats } from '../types'
import { formatClock, formatPct } from './format'

export interface KlondikeStatsProps {
  stats: Stats
  open: boolean
  onToggle: () => void
}

export function KlondikeStats({ stats, open, onToggle }: KlondikeStatsProps) {
  const items = [
    { label: 'Played', value: String(stats.played) },
    { label: 'Won', value: `${stats.won} · ${formatPct(stats.won, stats.played)}` },
    { label: 'Streak', value: `${stats.streak} · best ${stats.bestStreak}` },
    { label: 'Fewest moves', value: stats.fewestMoves === null ? '—' : String(stats.fewestMoves) },
    { label: 'Fastest', value: stats.fastestMs === null ? '—' : formatClock(stats.fastestMs) },
    { label: 'Clean wins', value: String(stats.cleanWins) },
  ]

  return (
    <div className={`klstats${open ? ' is-open' : ''}`}>
      <button type="button" className="klstats__toggle" onClick={onToggle} aria-expanded={open}>
        <span className="smallcaps">All time</span>
        <span className="klstats__peek num">
          {stats.won}/{stats.played} won
        </span>
        <span className="klstats__peek klstats__peek--dim num">
          {formatPct(stats.won, stats.played)} · streak {stats.streak}
        </span>
        <ChevronIcon dir={open ? 'up' : 'down'} size={16} />
      </button>
      {open && (
        <dl className="klstats__grid">
          {items.map((item) => (
            <div className="klstats__cell" key={item.label}>
              <dt className="smallcaps">{item.label}</dt>
              <dd className="num">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
