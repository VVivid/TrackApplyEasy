'use client';
import { useEffect, useState } from 'react';
import { Analysis, api, percent, reportDay, shiftDay, statuses } from '../lib/api';
const empty: Analysis = {
  submitted: 0,
  responded: 0,
  interviews: 0,
  offers: 0,
  statuses: [],
  activity: [],
  cvs: [],
  from: '',
  to: '',
  timezone: 'America/New_York',
  grain: 'day',
};

export function analysisApplicationsURL(
  data: Pick<Analysis, 'from' | 'to'>,
  kind: string,
  metric = 'submitted',
  status = '',
  cvID = '',
) {
  const query = new URLSearchParams({ from: data.from, to: data.to });
  if (kind) query.set('kind', kind);
  if (status) query.append('status', status);
  else if (metric === 'interviews') query.append('status', 'Interview');
  else if (metric === 'offers') query.append('status', 'Offer');
  if (metric === 'replied') query.set('replied', 'true');
  if (cvID) query.set('cv_id', cvID);
  return '/?' + query.toString();
}
export function AnalysisPage() {
  const [period, setPeriod] = useState('all'),
    [kind, setKind] = useState(''),
    [data, setData] = useState<Analysis>(empty),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 500px)');
    const changed = () => setCompact(media.matches);
    changed();
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ kind });
    if (period !== 'all') {
      const today = reportDay();
      query.set('from', shiftDay(today, 1 - Number(period)));
      query.set('to', today);
    }
    if (compact) query.set('compact', 'true');
    setLoading(true);
    api<Analysis>('/analysis?' + query)
      .then((out) => {
        if (active) {
          setData(out);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, kind, compact]);
  const maximum = Math.max(1, ...data.activity.map((point) => point.count));
  const metrics = [
    { id: 'submitted', label: 'Submitted', value: data.submitted, detail: 'Drafts excluded' },
    {
      id: 'replied',
      label: 'Response rate',
      value: percent(data.responded, data.submitted),
      detail: data.responded + ' of ' + data.submitted + ' received a reply',
    },
    {
      id: 'interviews',
      label: 'In interview',
      value: data.interviews,
      detail: 'Current status · ' + percent(data.interviews, data.submitted) + ' of submitted',
    },
    {
      id: 'offers',
      label: 'Offers',
      value: data.offers,
      detail: 'Current status · ' + percent(data.offers, data.submitted) + ' of submitted',
    },
  ];
  const open = (metric = 'submitted', status = '', cvID = '') =>
    window.location.assign(analysisApplicationsURL(data, kind, metric, status, cvID));
  const periodLabel = period === '1' ? 'Today' : period === '7' ? 'Last 7 days' : 'Last 30 days';
  return (
    <section aria-label="Application analysis" aria-busy={loading}>
      <div className="analysis-toolbar">
        <div>
          <p className="analysis-intro">Your search, in numbers.</p>
          <p className="muted">
            {data.from && `${data.from} – ${data.to} · New York submission dates`}
          </p>
        </div>
        <div className="analysis-filters">
          <label>
            Applied during
            <select
              aria-label="Applied during"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="7">Last 7 days</option>
              <option value="1">Today</option>
            </select>
          </label>
          <label>
            Role type
            <select
              aria-label="Analysis role type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">Jobs & internships</option>
              <option value="Job">Jobs</option>
              <option value="Internship">Internships</option>
            </select>
          </label>
        </div>
      </div>
      {(period !== 'all' || kind) && (
        <div className="chips" aria-label="Analysis filters">
          {period !== 'all' && (
            <button aria-label="Remove Analysis period filter" onClick={() => setPeriod('all')}>
              {periodLabel} ×
            </button>
          )}
          {kind && (
            <button aria-label="Remove Analysis role type filter" onClick={() => setKind('')}>
              {kind} ×
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="metrics">
        {metrics.map((metric) => (
          <button
            className="analysis-metric"
            key={metric.id}
            disabled={loading}
            aria-label={metric.label + ': ' + metric.value + '. View matching applications'}
            onClick={() => open(metric.id)}
          >
            <span>
              {metric.label}
              <span aria-hidden="true">↗</span>
            </span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </button>
        ))}
      </div>
      <div className="analysis-grid">
        <article className="analysis-panel">
          <header>
            <div>
              <h2>Application activity</h2>
              <p className="muted">{data.submitted} submitted applications</p>
            </div>
            <span>By {data.grain === 'week' ? 'week' : 'day'}</span>
          </header>
          <div
            className="activity-chart"
            role="img"
            aria-label={data.activity.map((point) => point.name + ': ' + point.count).join('; ')}
          >
            {data.activity.map((point) => (
              <div
                className="activity-column"
                key={point.name}
                title={
                  (data.grain === 'week' ? 'Week starting ' : '') + point.name + ': ' + point.count
                }
              >
                <span>{point.count || ''}</span>
                <div
                  className={point.count ? '' : 'zero'}
                  style={{ height: point.count ? Math.max(4, (point.count / maximum) * 130) : 1 }}
                />
                <small>{point.name.slice(5)}</small>
              </div>
            ))}
          </div>
          <p className="analysis-note">
            {data.grain === 'week' ? 'Weeks start on Monday.' : 'Daily submissions.'} Calendar gaps
            are shown as zero.
          </p>
        </article>
        <article className="analysis-panel">
          <header>
            <div>
              <h2>Current status</h2>
              <p className="muted">For applications in this period</p>
            </div>
          </header>
          <ul className="analysis-status-list">
            {statuses.slice(1).map((status) => {
              const count = data.statuses.find((item) => item.name === status)?.count || 0;
              return (
                <li key={status}>
                  <button
                    disabled={loading}
                    aria-label={'View ' + count + ' ' + status + ' applications'}
                    onClick={() => open('submitted', status)}
                  >
                    <span>
                      <i
                        className={'status-dot status-' + status.toLowerCase().replaceAll(' ', '-')}
                      />
                      {status === 'Response received' ? 'Replied' : status}
                    </span>
                    <strong>{count}</strong>
                    <span>{percent(count, data.submitted)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </article>
      </div>
      <article className="analysis-panel cv-comparison">
        <header>
          <div>
            <h2>Responses by CV</h2>
            <p className="muted">Recorded employer replies ÷ submitted applications</p>
          </div>
          <span>Reply rate</span>
        </header>
        <ul className="cv-rate-bars">
          {data.cvs.map((cv) => (
            <li key={cv.cv_id}>
              <div className="cv-rate-label">
                <button className="text-button" onClick={() => open('submitted', '', cv.cv_id)}>
                  {cv.name}
                  <small>{cv.sha256.slice(0, 8)}</small>
                </button>
                <strong>{percent(cv.responses, cv.applications)}</strong>
              </div>
              <div
                className="cv-rate-track"
                role="img"
                aria-label={
                  cv.name +
                  ': ' +
                  percent(cv.responses, cv.applications) +
                  ', ' +
                  cv.responses +
                  ' replies / ' +
                  cv.applications +
                  ' applications'
                }
              >
                <span
                  style={{
                    width: (cv.applications ? (cv.responses / cv.applications) * 100 : 0) + '%',
                  }}
                />
              </div>
              <p>
                {cv.responses} replies / {cv.applications} applications
              </p>
            </li>
          ))}
        </ul>
        {!data.cvs.length && (
          <p className="chart-empty">Your uploaded CV versions will appear here.</p>
        )}
        <div className="cv-rate-axis" aria-hidden="true">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        <p className="analysis-note">
          Employer response rate. Small samples describe your records and do not establish why an
          employer replied.
        </p>
      </article>
      <details className="analysis-calculations">
        <summary>How these numbers are calculated</summary>
        <p>
          Period and role filters use the application&apos;s New York submission date and role type.
          Drafts are excluded. Response rate counts each application with a recorded employer reply
          once; your own withdrawals do not count as replies. Interviews and offers show the current
          status. Outcomes include replies received after the selected application period. CV labels
          show replied / submitted counts; a dash means no applications.
        </p>
      </details>
    </section>
  );
}
