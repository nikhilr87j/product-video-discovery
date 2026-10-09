import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './lib/api.js'
import { SearchBar } from './components/SearchBar.jsx'
import { ProductPanel } from './components/ProductPanel.jsx'
import { Pipeline } from './components/Pipeline.jsx'
import { Results } from './components/Results.jsx'
import { History } from './components/History.jsx'

const SHORTLIST_KEY = 'pvd.shortlist'

function loadShortlist() {
  try {
    return new Map(JSON.parse(localStorage.getItem(SHORTLIST_KEY) || '[]'))
  } catch {
    return new Map()
  }
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState('')
  const [busy, setBusy] = useState(false)
  const [searchId, setSearchId] = useState(null)
  const [search, setSearch] = useState(null)
  const [product, setProduct] = useState(null)
  const [stages, setStages] = useState({})
  const [sources, setSources] = useState({})
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [includeTiktok, setIncludeTiktok] = useState(false)
  const [history, setHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [shortlist, setShortlist] = useState(loadShortlist)
  const stopRef = useRef(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealthError('Cannot reach the API. Start the backend (npm run dev in backend/) and reload.'))
  }, [])

  const refreshHistory = useCallback(() => {
    api.history().then((r) => { setHistory(r.items); setHistoryError('') }).catch((e) => setHistoryError(e.message))
  }, [])
  useEffect(refreshHistory, [refreshHistory])

  useEffect(() => {
    try {
      localStorage.setItem(SHORTLIST_KEY, JSON.stringify([...shortlist]))
    } catch {
      /* storage unavailable */
    }
  }, [shortlist])

  useEffect(() => () => stopRef.current?.(), [])

  function reset() {
    stopRef.current?.()
    setSearch(null)
    setProduct(null)
    setStages({})
    setSources({})
    setSummary(null)
    setError('')
  }

  async function startSearch(input) {
    reset()
    setBusy(true)
    setIncludeTiktok(input.includeTiktok)
    try {
      const { id } = await api.start(input)
      setSearchId(id)
      stopRef.current = api.follow(id, (e) => {
        if (e.type === 'stage') setStages((s) => ({ ...s, [e.stage]: e }))
        if (e.type === 'source') setSources((s) => ({ ...s, [e.platform]: { ...s[e.platform], ...e } }))
        if (e.type === 'product') setProduct(e.product)
        if (e.type === 'error') setError(e.message)
        if (e.type === 'done') setSummary(e.summary)
        if (e.type === 'end') {
          api.search(id).then((s) => {
            setSearch(s)
            if (s.product) setProduct(s.product)
            if (s.summary) setSummary(s.summary)
            if (s.status === 'failed') setError(s.error)
          }).catch((err) => setError(err.message)).finally(() => {
            setBusy(false)
            refreshHistory()
          })
        }
      })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function openSearch(id) {
    reset()
    setShowHistory(false)
    setSearchId(id)
    try {
      const s = await api.search(id)
      setSearch(s)
      setProduct(s.product)
      setSummary(s.summary)
      if (s.status === 'failed') setError(s.error)
      const src = {}
      for (const [p, c] of Object.entries(s.summary?.counts || {})) src[p] = { ...c, status: c.shortfall ? (c.matches ? 'warn' : 'error') : 'done' }
      setSources(src)
      setIncludeTiktok(!!src.tiktok)
      if (s.status === 'done') setStages({ resolve: { status: 'done' }, analyze: { status: 'done' }, save: { status: 'done', message: `Finished ${new Date(s.finishedAt).toLocaleString('en-IN')}` } })
    } catch (err) {
      setError(err.message)
    }
  }

  function toggleShortlist(v) {
    setShortlist((prev) => {
      const next = new Map(prev)
      if (next.has(v.uid)) next.delete(v.uid)
      else next.set(v.uid, { uid: v.uid, platform: v.platform, url: v.url, score: v.score, reason: v.reason, caption: v.caption, author: v.author, publishedAt: v.publishedAt, product: product?.title })
      return next
    })
  }

  function exportShortlist() {
    const rows = [['product', 'platform', 'url', 'score', 'reason', 'author', 'published', 'caption']]
    for (const v of shortlist.values()) rows.push([v.product, v.platform, v.url, v.score, v.reason, v.author, v.publishedAt, v.caption])
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `video-shortlist-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const started = busy || search || error || product
  const min = health?.minPerSource || 20
  const shortlistSet = { has: (uid) => shortlist.has(uid), size: shortlist.size }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Product video finder</h1>
        </div>
        <div className="top-right">
          {health?.mockMode && <span className="mode" title="No Gemini/Apify keys set: using generated demo data">Demo data</span>}
          <button type="button" className="ghost" onClick={() => { setShowHistory((s) => !s); refreshHistory() }} aria-expanded={showHistory}>
            History ({history.length})
          </button>
        </div>
      </header>

      {healthError && <div className="notice notice-error">{healthError}</div>}

      <SearchBar onSearch={startSearch} busy={busy} />

      {!started && (
        <div className="intro">
          <p>Find {min} Instagram Reels and {min} Meta video ads showing your exact product.</p>
          <p className="muted">
            Paste a product link and we read its title and photo, or type a name and add a photo. Every video is checked against the photo and given a match score, and repeat searches only show videos you haven’t seen.
          </p>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          <strong>Search stopped.</strong> {error}
        </div>
      )}

      {started && (
        <div className="overview">
          {product ? <ProductPanel product={product} /> : <section className="product product-skeleton" aria-hidden="true" />}
          <Pipeline stages={stages} sources={sources} min={min} includeTiktok={includeTiktok} />
        </div>
      )}

      {search?.status === 'done' && <Results key={searchId} search={search} summary={summary} shortlist={shortlistSet} onToggleShortlist={toggleShortlist} onExport={exportShortlist} />}

      {showHistory && <History items={history} activeId={searchId} onOpen={openSearch} onClose={() => setShowHistory(false)} error={historyError} />}
    </div>
  )
}
