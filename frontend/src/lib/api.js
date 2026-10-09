const BASE = import.meta.env.VITE_API_BASE || ''

async function json(res) {
  let body = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (HTTP ${res.status})`)
    err.status = res.status
    throw err
  }
  return body
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then(json),
  history: () => fetch(`${BASE}/api/history`).then(json),
  search: (id) => fetch(`${BASE}/api/search/${id}`).then(json),
  start: ({ query, image, includeTiktok }) => {
    const fd = new FormData()
    if (query) fd.append('query', query)
    if (image) fd.append('image', image)
    fd.append('includeTiktok', includeTiktok ? 'true' : 'false')
    return fetch(`${BASE}/api/search`, { method: 'POST', body: fd }).then(json)
  },
  thumbUrl: (path) => (path && path.startsWith('/api/') ? `${BASE}${path}` : path),

  /** Live progress via SSE. Falls back to polling if the stream breaks. */
  follow(id, onEvent) {
    let closed = false
    let poll = null
    const es = new EventSource(`${BASE}/api/search/${id}/events`)
    es.onmessage = (m) => {
      const e = JSON.parse(m.data)
      onEvent(e)
      if (e.type === 'end') stop()
    }
    es.onerror = () => {
      if (closed) return
      es.close()
      poll = setInterval(async () => {
        try {
          const s = await api.search(id)
          if (s.status === 'done' || s.status === 'failed') {
            onEvent(s.status === 'done' ? { type: 'done', summary: s.summary } : { type: 'error', message: s.error })
            onEvent({ type: 'end' })
            stop()
          }
        } catch {
          /* keep polling */
        }
      }, 2500)
    }
    function stop() {
      closed = true
      es.close()
      if (poll) clearInterval(poll)
    }
    return stop
  },
}

export const PLATFORMS = {
  instagram: { label: 'Instagram Reels', short: 'Instagram' },
  meta: { label: 'Meta Ad Library', short: 'Meta ads' },
  tiktok: { label: 'TikTok', short: 'TikTok' },
}
