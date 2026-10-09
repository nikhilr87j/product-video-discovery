const fmt = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function History({ items, activeId, onOpen, onClose, error }) {
  return (
    <aside className="history" aria-label="Search history">
      <div className="history-head">
        <h2>Earlier searches</h2>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!items.length && !error && <p className="muted">Your searches will appear here.</p>}
      <ul>
        {items.map((h) => (
          <li key={h.id}>
            <button type="button" className={`history-item ${h.id === activeId ? 'on' : ''}`} onClick={() => onOpen(h.id)}>
              <span className="history-title">{h.title}</span>
              <span className="history-meta">
                {fmt(h.createdAt)} · {h.inputType}
                {h.status === 'done' && h.counts && (
                  <> · {Object.entries(h.counts).map(([p, c]) => `${p === 'instagram' ? 'IG' : p === 'meta' ? 'Meta' : 'TT'} ${c.matches}`).join(', ')}</>
                )}
                {h.status !== 'done' && <> · {h.status}</>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
