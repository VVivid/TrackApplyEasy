'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  Application,
  CV,
  date,
  dateTime,
  localDate,
  reportInputToISO,
  Page,
  ResponseEvent,
  statuses,
} from '../lib/api';
import { Dialog } from './dialog';
import { PDFDialog } from './pdf-dialog';
import { useSession } from './session';

type Filters = {
  query: string;
  kind: string;
  statuses: string[];
  cv_id: string;
  from: string;
  to: string;
  replied: boolean;
};
const emptyFilters: Filters = {
  query: '',
  kind: '',
  statuses: [],
  cv_id: '',
  from: '',
  to: '',
  replied: false,
};
// Keep the same key while a result is uncertain. After a confirmed success,
// complete() lets the next identical payload represent a new operation.
export function useIntent() {
  const pendingIntent = useRef({ payload: '', key: '' });
  return Object.assign(
    (payload: unknown) => {
      const serializedPayload = JSON.stringify(payload);
      if (pendingIntent.current.payload !== serializedPayload) {
        pendingIntent.current = { payload: serializedPayload, key: crypto.randomUUID() };
      }
      return pendingIntent.current.key;
    },
    {
      complete: () => {
        pendingIntent.current = { payload: '', key: '' };
      },
    },
  );
}
export function Applications() {
  const session = useSession();
  const canWrite = session.scopes.includes('trackapplyeasy:write');
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [draft, setDraft] = useState<Filters>(emptyFilters),
    [filterOpen, setFilterOpen] = useState(false),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [sort, setSort] = useState('applied_at'),
    [direction, setDirection] = useState('desc'),
    [result, setResult] = useState<Page>({ items: [], total: 0, page: 1, page_size: 10 }),
    [cvs, setCVs] = useState<CV[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [panel, setPanelState] = useState<{
    type: 'details' | 'editor' | 'history' | 'pdf';
    app?: Application;
    cv?: CV;
    returnToDetails?: boolean;
  } | null>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  // Keep the original table trigger while navigating details, editor, history
  // and PDF panels so closing the whole flow restores focus to that trigger.
  function setPanel(next: typeof panel, trigger?: HTMLElement) {
    if (!panel && next) panelTrigger.current = trigger || (document.activeElement as HTMLElement);
    setPanelState(next);
    if (!next) requestAnimationFrame(() => panelTrigger.current?.focus());
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters({
      query: params.get('query') || '',
      kind: params.get('kind') || '',
      statuses: params.getAll('status'),
      cv_id: params.get('cv_id') || '',
      from: params.get('from') || '',
      to: params.get('to') || '',
      replied: params.get('replied') === 'true',
    });
    api<CV[]>('/cvs')
      .then(setCVs)
      .catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({
      query: filters.query,
      kind: filters.kind,
      cv_id: filters.cv_id,
      from: filters.from,
      to: filters.to,
      page: String(page),
      page_size: String(size),
      sort,
      direction,
      replied: String(filters.replied),
    });
    filters.statuses.forEach((s) => q.append('status', s));
    setLoading(true);
    api<Page>('/applications?' + q)
      .then((data) => {
        if (active) {
          setResult(data);
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
  }, [filters, page, size, sort, direction, revision]);
  function sorting(field: string) {
    if (sort === field) setDirection((v) => (v === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(field);
      setDirection(field === 'company' || field === 'title' ? 'asc' : 'desc');
    }
    setPage(1);
  }
  function sortButton(field: string, label: string) {
    return (
      <button className="sort" onClick={() => sorting(field)}>
        {label}
        {sort === field ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
      </button>
    );
  }
  const pages = Math.max(1, Math.ceil(result.total / size));
  const activeCount =
    filters.statuses.length +
    Number(!!filters.kind) +
    Number(!!filters.cv_id) +
    Number(!!filters.from || !!filters.to) +
    Number(filters.replied);
  const cvFor = (id: string) => cvs.find((c) => c.id === id);
  const reload = () => setRevision((v) => v + 1);
  return (
    <section aria-label="Applications">
      <div className="toolbar">
        <div className="query-controls">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search job titles"
              placeholder="Search job titles…"
              value={filters.query}
              maxLength={120}
              onChange={(e) => {
                setFilters({ ...filters, query: e.target.value });
                setPage(1);
              }}
            />
          </label>
          <button
            onClick={() => {
              setDraft(filters);
              setFilterOpen(true);
            }}
          >
            ☷ Filters {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
          </button>
        </div>
        <div className="view-controls">
          <label>
            Rows{' '}
            <select
              aria-label="Rows per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <span role="status">
            {result.total} {result.total === 1 ? 'application' : 'applications'}
          </span>
          {canWrite && (
            <button
              className="primary"
              onClick={(e) => setPanel({ type: 'editor' }, e.currentTarget)}
            >
              + Add application
            </button>
          )}
        </div>
      </div>
      {activeCount > 0 && (
        <div className="chips" aria-label="Active filters">
          {filters.kind && (
            <button
              aria-label="Remove role type filter"
              onClick={() => {
                setFilters({ ...filters, kind: '' });
                setPage(1);
              }}
            >
              {filters.kind} ×
            </button>
          )}
          {filters.statuses.map((status) => (
            <button
              key={status}
              aria-label={'Remove ' + status + ' status filter'}
              onClick={() => {
                setFilters({ ...filters, statuses: filters.statuses.filter((s) => s !== status) });
                setPage(1);
              }}
            >
              {status} ×
            </button>
          ))}
          {filters.cv_id && (
            <button
              aria-label="Remove CV filter"
              onClick={() => {
                setFilters({ ...filters, cv_id: '' });
                setPage(1);
              }}
            >
              CV: {cvFor(filters.cv_id)?.name || 'Selected version'} ×
            </button>
          )}
          {(filters.from || filters.to) && (
            <button
              aria-label="Remove Analysis date filter"
              onClick={() => {
                setFilters({ ...filters, from: '', to: '' });
                setPage(1);
              }}
            >
              Analysis: {filters.from || 'Start'} – {filters.to || 'Today'} ×
            </button>
          )}
          {filters.replied && (
            <button
              aria-label="Remove replied filter"
              onClick={() => {
                setFilters({ ...filters, replied: false });
                setPage(1);
              }}
            >
              Replied ×
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              setFilters(emptyFilters);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={reload}>Retry</button>
        </p>
      )}
      <div className="table-wrap" aria-busy={loading}>
        <table className="applications-table">
          <colgroup>
            <col style={{ width: '21%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th
                aria-sort={
                  sort === 'title' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                {sortButton('title', 'Job title')}
              </th>
              <th
                aria-sort={
                  sort === 'company' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                {sortButton('company', 'Company')}
              </th>
              <th
                aria-sort={
                  sort === 'applied_at'
                    ? direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                {sortButton('applied_at', 'Applied')}
              </th>
              <th>Submitted CV</th>
              <th>Status</th>
              <th
                aria-sort={
                  sort === 'latest_response'
                    ? direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                {sortButton('latest_response', 'Latest response')}
              </th>
              <th>Feedback</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <button
                    className="job-title"
                    onClick={(e) => setPanel({ type: 'details', app: row }, e.currentTarget)}
                  >
                    {row.title}
                  </button>
                  <small>{row.kind}</small>
                  {row.url && (
                    <a
                      className="muted-link"
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Original posting ↗
                    </a>
                  )}
                </td>
                <td>{row.company}</td>
                <td>
                  <time title={dateTime(row.applied_at)}>{date(row.applied_at)}</time>
                  <small>{row.applied_at ? 'Submitted' : 'Not applied'}</small>
                </td>
                <td>
                  {row.cv_id ? (
                    <button
                      className="text-button cv-link"
                      onClick={(e) =>
                        setPanel({ type: 'pdf', app: row, cv: cvFor(row.cv_id) }, e.currentTarget)
                      }
                    >
                      {cvFor(row.cv_id)?.name || 'Exact PDF'}
                      <small>{cvFor(row.cv_id)?.sha256.slice(0, 8)}</small>
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span
                    className={'status status-' + row.status.toLowerCase().replaceAll(' ', '-')}
                  >
                    {row.status}
                  </span>
                </td>
                <td>
                  <button
                    className="response-link"
                    onClick={(e) => setPanel({ type: 'history', app: row }, e.currentTarget)}
                  >
                    {row.latest_summary ||
                      (row.applied_at ? 'Awaiting response' : 'Draft application')}
                  </button>
                  {row.latest_response && <small>{date(row.latest_response)}</small>}
                  <button
                    className="text-button mini"
                    onClick={(e) => setPanel({ type: 'history', app: row }, e.currentTarget)}
                  >
                    {canWrite && row.applied_at ? '+ Add response' : 'View history'}
                  </button>
                </td>
                <td>
                  <span className="feedback">{row.feedback || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && result.items.length === 0 && (
        <div className="empty">
          <h2>{result.total ? 'No rows on this page.' : 'No applications here yet.'}</h2>
          <p>
            {filters.query || activeCount
              ? 'Try a different search or clear your filters.'
              : 'Add an application when you are ready. Your workspace starts empty.'}
          </p>
          {page > 1 && <button onClick={() => setPage(1)}>First page</button>}
        </div>
      )}
      {loading && (
        <p className="loading" role="status">
          Loading applications…
        </p>
      )}
      <nav className="pagination" aria-label="Application pages">
        <span>
          {result.total ? Math.min((page - 1) * size + 1, result.total) : 0}–
          {Math.min(page * size, result.total)} of {result.total}
        </span>
        <div>
          <button disabled={page <= 1} onClick={() => setPage(1)}>
            First
          </button>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <label>
            Page{' '}
            <input
              aria-label="Page number"
              type="number"
              min="1"
              max={pages}
              value={page}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= pages) setPage(n);
              }}
            />{' '}
            of {pages}
          </label>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
          <button disabled={page >= pages} onClick={() => setPage(pages)}>
            Last
          </button>
        </div>
      </nav>
      {filterOpen && (
        <Dialog title="Filters" onClose={() => setFilterOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFilters(draft);
              setPage(1);
              setFilterOpen(false);
            }}
          >
            <label>
              Role type
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              >
                <option value="">All roles</option>
                <option>Job</option>
                <option>Internship</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.replied}
                onChange={(e) => setDraft({ ...draft, replied: e.target.checked })}
              />
              Recorded employer reply
            </label>
            <fieldset>
              <legend>Status</legend>
              <div className="status-options">
                {statuses.map((s) => (
                  <label key={s}>
                    <input
                      type="checkbox"
                      checked={draft.statuses.includes(s)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          statuses: e.target.checked
                            ? [...draft.statuses, s]
                            : draft.statuses.filter((v) => v !== s),
                        })
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Submitted CV
              <select
                value={draft.cv_id}
                onChange={(e) => setDraft({ ...draft, cv_id: e.target.value })}
              >
                <option value="">All versions</option>
                {cvs.map((cv) => (
                  <option key={cv.id} value={cv.id}>
                    {cv.name} · {cv.sha256.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Submitted from
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setDraft(emptyFilters)}>
                Reset
              </button>
              <button className="primary">Apply filters</button>
            </div>
          </form>
        </Dialog>
      )}
      {panel?.type === 'editor' && (
        <ApplicationEditor
          app={panel.app}
          cvs={cvs}
          readOnly={!canWrite}
          onBack={
            panel.returnToDetails ? () => setPanel({ type: 'details', app: panel.app }) : undefined
          }
          onClose={() => setPanel(null)}
          onSaved={() => {
            reload();
            setPanel(null);
          }}
        />
      )}
      {panel?.type === 'details' && panel.app && (
        <ApplicationDetails
          app={panel.app}
          cv={cvFor(panel.app.cv_id)}
          canWrite={canWrite}
          onClose={() => setPanel(null)}
          onEdit={() => setPanel({ type: 'editor', app: panel.app, returnToDetails: true })}
          onHistory={() => setPanel({ type: 'history', app: panel.app, returnToDetails: true })}
          onPDF={() =>
            setPanel({
              type: 'pdf',
              app: panel.app,
              cv: cvFor(panel.app!.cv_id),
              returnToDetails: true,
            })
          }
        />
      )}
      {panel?.type === 'history' && panel.app && (
        <ResponseHistory
          app={panel.app}
          canWrite={canWrite}
          onBack={
            panel.returnToDetails ? () => setPanel({ type: 'details', app: panel.app }) : undefined
          }
          onClose={() => setPanel(null)}
          onSaved={(app) => {
            setPanel({ type: 'history', app, returnToDetails: panel.returnToDetails });
            reload();
          }}
        />
      )}
      {panel?.type === 'pdf' && (
        <PDFDialog
          id={panel.app?.cv_id || ''}
          cv={panel.cv}
          onClose={() => setPanel(null)}
          onBack={
            panel.returnToDetails ? () => setPanel({ type: 'details', app: panel.app }) : undefined
          }
        />
      )}
    </section>
  );
}
function ApplicationDetails({
  app,
  cv,
  canWrite,
  onClose,
  onEdit,
  onHistory,
  onPDF,
}: {
  app: Application;
  cv?: CV;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onPDF: () => void;
}) {
  const [events, setEvents] = useState<ResponseEvent[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<ResponseEvent[]>('/applications/' + app.id + '/responses')
      .then((items) => {
        if (active) {
          setEvents(items);
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
  }, [app.id, app.revision, attempt]);
  return (
    <Dialog title={app.title} onClose={onClose}>
      <div className="application-detail-actions">
        <span className={'status status-' + app.status.toLowerCase().replaceAll(' ', '-')}>
          {app.status}
        </span>
        {canWrite && (
          <button className="primary" onClick={onEdit}>
            ✎ Edit application
          </button>
        )}
      </div>
      <dl className="application-facts">
        <div>
          <dt>Company</dt>
          <dd>{app.company}</dd>
        </div>
        <div>
          <dt>Role type</dt>
          <dd>{app.kind}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{app.applied_at ? dateTime(app.applied_at) : 'Not submitted · draft'}</dd>
        </div>
        <div>
          <dt>{app.applied_at ? 'Exact submitted CV' : 'CV to prepare'}</dt>
          <dd>
            {app.cv_id ? (
              <button className="text-button" onClick={onPDF}>
                {cv?.name || 'View exact PDF'}
                {cv?.archived ? ' · Archived' : ''}
                {cv && (
                  <small>
                    {cv.filename} · SHA256 {cv.sha256.slice(0, 12)}
                  </small>
                )}
              </button>
            ) : (
              'No CV selected'
            )}
          </dd>
        </div>
      </dl>
      {app.url && (
        <p className="posting-link">
          <a href={app.url} target="_blank" rel="noopener noreferrer">
            View original posting ↗
          </a>
        </p>
      )}
      <section className="application-detail-section">
        <h3>Why this role / job information</h3>
        <p className="pre-wrap">{app.rationale || 'No job information or rationale recorded.'}</p>
      </section>
      <section className="application-detail-section">
        <h3>Feedback / notes</h3>
        <p className="pre-wrap">{app.feedback || 'No feedback or notes recorded.'}</p>
      </section>
      <section className="application-detail-section">
        <div className="response-heading">
          <h3>Responses</h3>
          <button className="text-button" onClick={onHistory}>
            {canWrite && app.applied_at ? '+ Add response / history' : 'View history'}
          </button>
        </div>
        {loading ? (
          <p role="status" className="loading">
            Loading responses…
          </p>
        ) : error ? (
          <p role="alert" className="error">
            {error} <button onClick={() => setAttempt((n) => n + 1)}>Retry responses</button>
          </p>
        ) : (
          <ResponseTimeline events={events} />
        )}
      </section>
    </Dialog>
  );
}

function ApplicationEditor({
  app,
  cvs,
  onClose,
  onSaved,
  readOnly,
  onBack,
}: {
  app?: Application;
  cvs: CV[];
  onClose: () => void;
  onSaved: () => void;
  readOnly: boolean;
  onBack?: () => void;
}) {
  const session = useSession(),
    intent = useIntent();
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [submitted, setSubmitted] = useState(!!app?.applied_at);
  // Keep a saved archived draft selection visible, but prefer active versions
  // for a new application. Archived historical submissions stay valid.
  const selectableCVs = cvs.filter((cv) => !cv.archived || cv.id === app?.cv_id);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const payload = {
        url: String(data.get('url') || ''),
        title: String(data.get('title')),
        company: String(data.get('company')),
        kind: String(data.get('kind')),
        rationale: String(data.get('rationale') || ''),
        feedback: String(data.get('feedback') || ''),
        cv_id: app?.applied_at ? app.cv_id : String(data.get('cv_id') || ''),
        applied_at:
          app?.applied_at || (submitted ? reportInputToISO(String(data.get('applied_at'))) : ''),
        status: app?.applied_at ? String(data.get('status')) : submitted ? 'Applied' : 'Preparing',
        ...(app ? { expected_revision: app.revision } : {}),
      };
      await api(
        app ? '/applications/' + app.id : '/applications',
        {
          method: app ? 'PUT' : 'POST',
          body: JSON.stringify({ ...payload, idempotency_key: intent(payload) }),
        },
        session.csrf_token,
      );
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title={app ? 'Edit application' : 'Add application'} onClose={onClose} onBack={onBack}>
      <form onSubmit={save}>
        <fieldset disabled={readOnly || saving}>
          <label>
            Job title
            <input name="title" defaultValue={app?.title} maxLength={300} required />
          </label>
          <div className="form-grid">
            <label>
              Company
              <input name="company" defaultValue={app?.company} maxLength={200} required />
            </label>
            <label>
              Role type
              <select name="kind" defaultValue={app?.kind || 'Job'}>
                <option>Job</option>
                <option>Internship</option>
              </select>
            </label>
          </div>
          <label>
            Posting URL
            <input
              name="url"
              type="url"
              defaultValue={app?.url}
              maxLength={2048}
              placeholder="https://…"
            />
          </label>
          <label>
            Why this role
            <textarea name="rationale" rows={3} defaultValue={app?.rationale} maxLength={8000} />
          </label>
          <label>
            Feedback / notes
            <textarea name="feedback" rows={3} defaultValue={app?.feedback} maxLength={8000} />
          </label>
          {app?.applied_at ? (
            <div className="immutable">
              <label>
                Current stage
                <select name="status" defaultValue={app.status}>
                  {statuses.slice(1).map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <p>Submitted {dateTime(app.applied_at)} · exact CV version is locked.</p>
              <p>Record responses in history, or correct the current stage here.</p>
            </div>
          ) : (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={submitted}
                  onChange={(e) => setSubmitted(e.target.checked)}
                />
                Already submitted
              </label>
              {submitted && (
                <label>
                  Applied at (New York time)
                  <input
                    type="datetime-local"
                    name="applied_at"
                    defaultValue={localDate()}
                    required
                  />
                </label>
              )}
              <label>
                {submitted ? 'Exact submitted CV' : 'CV to prepare (optional)'}
                <select name="cv_id" defaultValue={app?.cv_id || ''} required={submitted}>
                  <option value="">Select CV version</option>
                  {selectableCVs.map((cv) => (
                    <option key={cv.id} value={cv.id}>
                      {cv.name} · {cv.sha256.slice(0, 8)}
                      {cv.archived ? ' · Archived' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {!selectableCVs.length && (
                <p className="muted">
                  Upload or restore a CV in the CV library before recording a submission.
                </p>
              )}
            </>
          )}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          {!readOnly && (
            <button className="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save application'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
function ResponseHistory({
  app,
  canWrite,
  onClose,
  onSaved,
  onBack,
}: {
  app: Application;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (a: Application) => void;
  onBack?: () => void;
}) {
  const session = useSession(),
    intent = useIntent();
  const [events, setEvents] = useState<ResponseEvent[]>([]),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    api<ResponseEvent[]>('/applications/' + app.id + '/responses')
      .then(setEvents)
      .catch((err) => setError(err.message));
  }, [app.id, app.revision]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setSaving(true);
    try {
      const payload = {
        expected_revision: app.revision,
        occurred_at: reportInputToISO(String(data.get('occurred_at'))),
        status: String(data.get('status')),
        channel: String(data.get('channel') || ''),
        summary: String(data.get('summary')),
        body: String(data.get('body')),
      };
      const updated = await api<Application>(
        '/applications/' + app.id + '/responses',
        { method: 'POST', body: JSON.stringify({ ...payload, idempotency_key: intent(payload) }) },
        session.csrf_token,
      );
      form.reset();
      setError('');
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title="Response history" onClose={onClose} onBack={onBack}>
      <div className="detail-heading">
        <h3>{app.title}</h3>
        <p>
          {app.company} · <span className="status">{app.status}</span>
        </p>
      </div>
      <ResponseTimeline events={events} />
      {canWrite && app.applied_at ? (
        <form onSubmit={save}>
          <h3>Add a response</h3>
          <p className="muted">
            Preserve what happened. Responses update the current stage when they are the latest by
            received time. Earlier replies can be recorded later.
          </p>
          <fieldset disabled={saving}>
            <div className="form-grid">
              <label>
                Received at (New York time)
                <input
                  type="datetime-local"
                  name="occurred_at"
                  defaultValue={localDate()}
                  required
                />
              </label>
              <label>
                Stage
                <select name="status" defaultValue="Response received">
                  {statuses.slice(2).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Channel
              <input name="channel" placeholder="Email, phone, recruiter…" maxLength={100} />
            </label>
            <label>
              Short summary
              <input name="summary" maxLength={500} required />
            </label>
            <label>
              Full response
              <textarea name="body" rows={5} maxLength={16000} required />
            </label>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
            <button className="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save response'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted">
            {app.applied_at
              ? 'Responses are read only.'
              : 'Submit this application before adding a response.'}
          </p>
          <button onClick={onClose}>Close</button>
        </>
      )}
    </Dialog>
  );
}
function ResponseTimeline({ events }: { events: ResponseEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div>
            <strong>{event.summary}</strong>
            <time>{dateTime(event.occurred_at)}</time>
          </div>
          <small>
            {event.status}
            {event.channel ? ' · ' + event.channel : ''}
          </small>
          <p className="pre-wrap">{event.body}</p>
        </li>
      ))}
      {!events.length && <li className="muted">No responses recorded.</li>}
    </ol>
  );
}
