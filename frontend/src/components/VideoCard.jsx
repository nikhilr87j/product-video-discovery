import { useState } from 'react'
import { api, PLATFORMS } from '../lib/api.js'

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function ScoreBadge({ score, status }) {
  if (score == null) return <span className="score score-none">–</span>
  const tier = status === 'previously_seen' ? 'seen' : score >= 70 ? 'high' : score >= 55 ? 'mid' : 'low'
  return (
    <span className={`score score-${tier}`} title="Match score (0–100)">
      {score}
    </span>
  )
}

export function VideoCard({ v, shortlisted, onToggleShortlist }) {
  const [playing, setPlaying] = useState(false)
  const [playFailed, setPlayFailed] = useState(false)
  const thumb = api.thumbUrl(v.thumbnail)
  const canPlay = v.mediaUrl && !v.mediaUrl.includes('cdn.example.com') && !playFailed
  const platform = PLATFORMS[v.platform]?.short || v.platform

  return (
    <article className={`card card-${v.status}`}>
      <div className="card-media">
        {playing && canPlay ? (
          <video src={v.mediaUrl} poster={thumb} controls autoPlay playsInline onError={() => setPlayFailed(true)} />
        ) : (
          <>
            {thumb ? <img src={thumb} alt="" loading="lazy" /> : <div className="no-thumb">No preview</div>}
            {canPlay && (
              <button type="button" className="play" onClick={() => setPlaying(true)} aria-label="Play video here">
                ▶
              </button>
            )}
          </>
        )}
        <span className={`platform platform-${v.platform}`}>{platform}</span>
        <ScoreBadge score={v.score} status={v.status} />
      </div>
      <div className="card-body">
        {v.reason && (() => {
          const i = v.reason.indexOf(': ')
          const band = i > 0 && i < 40 ? v.reason.slice(0, i) : null
          return (
            <p className="reason">
              {band && <strong>{band}. </strong>}
              {band ? v.reason.slice(i + 2) : v.reason}
            </p>
          )
        })()}
        {v.caption && <p className="caption">{v.caption}</p>}
        <div className="card-meta">
          <span className="author">{v.author ? (v.platform === 'meta' ? v.author : `@${v.author}`) : ''}</span>
          <span className="date">{fmtDate(v.publishedAt)}</span>
        </div>
        {v.status === 'previously_seen' && <p className="seen-note">Shown in an earlier search</p>}
        {playFailed && <p className="seen-note">This video can only be played on {platform}.</p>}
        <div className="card-actions">
          {v.url && (
            <a href={v.url} target="_blank" rel="noreferrer">
              Open original
            </a>
          )}
          <button type="button" className={`star ${shortlisted ? 'on' : ''}`} aria-pressed={shortlisted} onClick={() => onToggleShortlist(v)}>
            {shortlisted ? 'Shortlisted' : 'Shortlist'}
          </button>
        </div>
      </div>
    </article>
  )
}
