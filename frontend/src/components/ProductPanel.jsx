function Attr({ label, values }) {
  const list = [].concat(values || []).filter(Boolean)
  if (!list.length) return null
  return (
    <div className="attr">
      <dt>{label}</dt>
      <dd>
        {list.map((v) => (
          <span key={v} className="chip">
            {v}
          </span>
        ))}
      </dd>
    </div>
  )
}

export function ProductPanel({ product }) {
  if (!product) return null
  const a = product.analysis || {}
  const img = product.imageData || product.imageUrl
  return (
    <section className="product" aria-label="Product">
      <div className="product-img">{img ? <img src={img} alt={product.title} /> : <span>No image. Add a photo for exact matching.</span>}</div>
      <div className="product-body">
        <h2>{product.title}</h2>
        {product.sourceUrl && (
          <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="product-src">
            {new URL(product.sourceUrl).hostname}
          </a>
        )}
        {a.summary && <p className="product-summary">{a.summary}</p>}
        <dl className="attrs">
          <Attr label="Type" values={a.productType} />
          <Attr label="Colours" values={a.colors} />
          <Attr label="Print / graphic" values={a.printsOrGraphics} />
          <Attr label="Logos" values={a.logos} />
          <Attr label="Text on product" values={a.textOnProduct} />
          <Attr label="Material" values={a.material} />
          <Attr label="Shape" values={a.shape} />
          <Attr label="Tells it apart" values={a.distinctiveFeatures} />
        </dl>
        <details className="terms">
          <summary>Search terms the brain generated</summary>
          <p>
            <strong>Instagram:</strong> {(a.hashtags || []).map((h) => `#${h}`).join(' ')}
          </p>
          <p>
            <strong>Meta Ad Library:</strong> {(a.metaQueries || []).join(', ')}
          </p>
          <p>
            <strong>Fallbacks:</strong> {[...(a.expandedQueries || []), ...(a.expandedHashtags || []).map((h) => `#${h}`)].join(', ')}
          </p>
        </details>
      </div>
    </section>
  )
}
