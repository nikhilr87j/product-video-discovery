import { PLATFORMS } from '../lib/api.js'

const STEPS = [
  { key: 'resolve', label: 'Reading the product' },
  { key: 'analyze', label: 'Analysing the image' },
  { key: 'instagram', label: 'Searching Instagram', source: true },
  { key: 'meta', label: 'Searching Meta Ad Library', source: true },
  { key: 'tiktok', label: 'Searching TikTok', source: true, optional: true },
  { key: 'save', label: 'Scoring and saving' },
]

const ICON = { active: '◌', done: '✓', warn: '!', error: '×', pending: '' }

export function Pipeline({ stages, sources, min, includeTiktok }) {
  const steps = STEPS.filter((s) => !s.optional || includeTiktok || sources.tiktok)
  return (
    <section className="pipeline" aria-label="Search progress" aria-live="polite">
      <ol>
        {steps.map((s) => {
          const st = s.source ? sources[s.key] : stages[s.key]
          const status = st?.status || 'pending'
          return (
            <li key={s.key} className={`step step-${status}`}>
              <span className="step-icon" aria-hidden="true">
                {ICON[status]}
              </span>
              <div>
                <div className="step-title">
                  {s.label}
                  {s.source && st?.matches !== undefined && (
                    <span className="step-count">
                      {st.matches}/{min}
                    </span>
                  )}
                </div>
                {st?.message && <div className="step-msg">{st.message}</div>}
                {s.source && st?.matches !== undefined && (
                  <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={min} aria-valuenow={Math.min(st.matches, min)} aria-label={`${PLATFORMS[s.key].label} matches`}>
                    <span style={{ width: `${Math.min(100, (st.matches / min) * 100)}%` }} />
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
