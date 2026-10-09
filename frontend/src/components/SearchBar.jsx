import { useRef, useState } from 'react'

export function SearchBar({ onSearch, busy }) {
  const [query, setQuery] = useState('')
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [tiktok, setTiktok] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const isUrl = /^https?:\/\//i.test(query.trim())

  function pick(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('That file is not an image.')
    if (file.size > 8 * 1024 * 1024) return setError('Images must be under 8 MB.')
    setError('')
    setImage(file)
    setPreview(URL.createObjectURL(file))
  }

  function clearImage() {
    setImage(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function submit(e) {
    e.preventDefault()
    if (!query.trim() && !image) return setError('Type a product name, paste a product link, or add a photo.')
    setError('')
    onSearch({ query: query.trim(), image, includeTiktok: tiktok })
  }

  return (
    <form className="search" onSubmit={submit}>
      <div
        className="search-field"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          pick(e.dataTransfer.files?.[0])
        }}
      >
        <label htmlFor="q" className="sr-only">
          Product name or link
        </label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Product name, or paste a Shopify / Amazon / brand link"
          autoComplete="off"
          disabled={busy}
        />
        <span className="search-kind" aria-live="polite">
          {query.trim() ? (isUrl ? 'Link' : 'Name') : ''}
        </span>
        {preview ? (
          <span className="search-thumb">
            <img src={preview} alt="Uploaded product" />
            <button type="button" onClick={clearImage} aria-label="Remove photo" disabled={busy}>
              ×
            </button>
          </span>
        ) : (
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            Add photo
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <label className="toggle">
        <input type="checkbox" checked={tiktok} onChange={(e) => setTiktok(e.target.checked)} disabled={busy} />
        <span>Include TikTok</span>
      </label>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Searching…' : 'Find videos'}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
