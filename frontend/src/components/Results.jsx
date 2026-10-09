import { useMemo, useState } from 'react'
import { PLATFORMS } from '../lib/api.js'
import { VideoCard } from './VideoCard.jsx'

const SORTS = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  newest: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
  oldest: (a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0),
}

export function Results({ search, summary, shortlist, onToggleShortlist, onExport }) {
  const results = useMemo(() => search?.results || [], [search])
  const counts = summary?.counts || {}
  const min = summary?.minPerSource || 20
  const threshold = summary?.threshold ?? 55
  const platforms = ['instagram', 'meta', 'tiktok'].filter((p) => counts[p] || results.some((r) => r.platform === p))

  const [tab, setTab] = useState('all')
  const [sort, setSort] = useState('score')
  const [showLow, setShowLow] = useState(false)
  const [showSeen, setShowSeen] = useState(false)
  const [onlyShortlist, setOnlyShortlist] = useState(false)

  const visible = useMemo(() => {
    return results
      .filter((r) => tab === 'all' || r.platform === tab)
      .filter((r) => r.status === 'match' || (showLow && r.status === 'low') || (showSeen && r.status === 'previously_seen'))
      .filter((r) => !onlyShortlist || shortlist.has(r.uid))
      .sort(SORTS[sort])
  }, [results, tab, sort, showLow, showSeen, onlyShortlist, shortlist])

  const n = (p, status) => results.filter((r) => r.platform === p && r.status === status).length
  const lowCount = results.filter((r) => (tab === 'all' || r.platform === tab) && r.status === 'low').length
  const seenCount = results.filter((r) => (tab === 'all' || r.platform === tab) && r.status === 'previously_seen').length
  const shortfalls = platforms.filter((p) => (counts[p]?.shortfall || 0) > 0)

  return (
    <section className="results" aria-label="Results">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All <span className="tab-n">{results.filter((r) => r.status === 'match').length}</span>
        </button>
        {platforms.map((p) => {
          const m = n(p, 'match')
          const met = m >= min
          return (
            <button key={p} role="tab" aria-selected={tab === p} className={tab === p ? 'on' : ''} onClick={() => setTab(p)}>
              {PLATFORMS[p].label}
              <span className={`tab-n ${met ? 'met' : 'short'}`} title={met ? 'Minimum met' : 'Below the minimum'}>
                {m}/{min}
              </span>
            </button>
          )
        })}
      </div>

      {shortfalls.map((p) => (
        <div key={p} className="notice" role="status">
          <strong>{PLATFORMS[p].label}: {counts[p].matches}/{min} matches.</strong> {counts[p].message}{' '}
          {counts[p].errors?.length ? `Last error: ${counts[p].errors.at(-1)}. ` : ''}
          Try a broader product name, add a clearer product photo, or turn on “Show low matches” to review near misses.
        </div>
      ))}

      <div className="toolbar">
        <label>
          Sort by{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Match score</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />
          <span>Show low matches ({lowCount}, below {threshold})</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showSeen} onChange={(e) => setShowSeen(e.target.checked)} />
          <span>Show previously seen ({seenCount})</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={onlyShortlist} onChange={(e) => setOnlyShortlist(e.target.checked)} />
          <span>Shortlist only ({shortlist.size})</span>
        </label>
        <button type="button" className="ghost" onClick={onExport} disabled={!shortlist.size}>
          Export shortlist (CSV)
        </button>
      </div>

      {visible.length ? (
        <div className="grid">
          {visible.map((v) => (
            <VideoCard key={v.uid} v={v} shortlisted={shortlist.has(v.uid)} onToggleShortlist={onToggleShortlist} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>No videos match these filters.</p>
          <p className="muted">
            {onlyShortlist ? 'Shortlist videos with the Shortlist button on each card.' : 'Turn on “Show low matches” or “Show previously seen”, or pick another source tab.'}
          </p>
        </div>
      )}
    </section>
  )
}
