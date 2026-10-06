import { useDataset } from '../datasets/dataset'
import { formatTime } from '../lib/util'
import { RESULTS, type Finish, type Result } from './useQuizRun'

type Props = {
  ids: string[]
  results: Record<string, Result>
  finish: Finish
  onRestart: (ids?: string[]) => void
}

const pct = (n: number, total: number) => Math.round((n / total) * 100)

/** Colour key for the result fills, shown under quiz maps. */
export function ResultLegend() {
  return (
    <div className="legend result-legend">
      {RESULTS.map((r) => (
        <span key={r.id}>
          <i className={r.id} /> {r.label}
        </span>
      ))}
    </div>
  )
}

export function Summary({ ids, results, finish, onRestart }: Props) {
  const ds = useDataset()
  const byResult = Object.fromEntries(
    RESULTS.map((r) => [
      r.id,
      ids.filter((id) => results[id] === r.id).sort((a, b) => ds.byId[a].name.localeCompare(ds.byId[b].name)),
    ]),
  ) as Record<Result, string[]>

  const total = ids.length
  const firstPct = pct(byResult.first.length, total)
  const gotPct = pct(total - byResult.missed.length, total)
  const notFirst = ids.filter((id) => results[id] !== 'first')

  return (
    <div className="summary">
      <h2>{firstPct === 100 ? 'Perfect!' : firstPct >= 80 ? 'Great job!' : 'Run complete'}</h2>
      <p className="score">
        <strong>{firstPct}%</strong> on the first try · {gotPct}% within {RESULTS.length - 1} tries ·{' '}
        {formatTime(finish.ms)}
        {finish.newBest && <span className="pill good">New best</span>}
      </p>

      <div className="stack-bar" role="img" aria-label="Results breakdown">
        {RESULTS.map((r) =>
          byResult[r.id].length ? (
            <span key={r.id} className={r.id} style={{ flexGrow: byResult[r.id].length }} />
          ) : null,
        )}
      </div>

      <table className="breakdown">
        <tbody>
          {RESULTS.map((r) => (
            <tr key={r.id}>
              <th>
                <i className={`swatch ${r.id}`} /> {r.label}
              </th>
              <td className="num">{byResult[r.id].length}</td>
              <td className="num muted">{pct(byResult[r.id].length, total)}%</td>
              <td>
                <ul className="name-list">
                  {byResult[r.id].map((id) => (
                    <li key={id}>{ds.byId[id].name}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="actions">
        {notFirst.length > 0 && (
          <button onClick={() => onRestart(notFirst)}>Practise the {notFirst.length} not got first try</button>
        )}
        <button className={notFirst.length > 0 ? 'ghost' : ''} onClick={() => onRestart()}>
          Play again
        </button>
      </div>
    </div>
  )
}
