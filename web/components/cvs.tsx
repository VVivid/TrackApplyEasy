'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, CV, date } from '../lib/api';
import { useIntent } from './applications';
import { PDFDialog } from './pdf-dialog';
import { useSession } from './session';
export function CVLibrary() {
  const session = useSession(),
    intent = useIntent();
  const [cvs, setCVs] = useState<CV[]>([]),
    [selected, setSelected] = useState<CV | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [uploading, setUploading] = useState(false),
    [query, setQuery] = useState(''),
    [activeOnly, setActiveOnly] = useState(true),
    [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null),
    selectedTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    api<CV[]>('/cvs')
      .then(setCVs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      fileRef.current?.click();
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a PDF of 10 MiB or smaller.');
      return;
    }
    const form = e.currentTarget,
      data = new FormData(form);
    data.set(
      'idempotency_key',
      intent({
        name: data.get('name'),
        category: data.get('category'),
        file: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }),
    );
    setUploading(true);
    try {
      const uploaded = await api<CV>('/cvs', { method: 'POST', body: data }, session.csrf_token);
      intent.complete();
      setCVs((current) => [uploaded, ...current.filter((cv) => cv.id !== uploaded.id)]);
      setFile(null);
      form.reset();
      setError('');
      // The upload is committed. A failed list refresh must keep its card and
      // cleared form so the user does not repeat a successful operation.
      try {
        setCVs(await api<CV[]>('/cvs'));
      } catch {
        setError('PDF uploaded successfully. Reload this page to refresh the full CV library.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }
  const search = query.trim().toLocaleLowerCase();
  const visible = cvs.filter(
    (cv) =>
      (!activeOnly || !cv.archived) &&
      [cv.name, cv.category, cv.filename].some((text) => text.toLocaleLowerCase().includes(search)),
  );
  return (
    <section aria-label="CV library">
      {session.scopes.includes('trackapplyeasy:write') && (
        <form className="upload-toolbar" onSubmit={upload}>
          <div>
            <h2>Keep every exact version.</h2>
            <p className="muted">
              Upload the original PDF. Its contents stay fixed when you submit an application.
            </p>
          </div>
          <div className="upload-fields">
            <label>
              Name
              <input name="name" maxLength={200} required placeholder="CV version name" />
            </label>
            <label>
              Category
              <input name="category" maxLength={80} required defaultValue="General" />
            </label>
            <label className="file-label">
              PDF · up to 10 MiB
              <input
                ref={fileRef}
                type="file"
                name="pdf"
                accept="application/pdf,.pdf"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button className="primary" disabled={uploading}>
              {uploading ? 'Uploading…' : '↑ Upload PDF'}
            </button>
          </div>
        </form>
      )}
      <div className="toolbar cv-filters">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search CVs"
            placeholder="Search name, category or filename…"
            value={query}
            maxLength={240}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="active-switch">
          <input
            type="checkbox"
            role="switch"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          <span>Active only</span>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="loading" role="status">
          Loading CVs…
        </p>
      ) : (
        <>
          <div className="collection-heading">
            <span>
              {visible.length} of {cvs.length} CV {cvs.length === 1 ? 'version' : 'versions'}
            </span>
            <span>Immutable original PDFs</span>
          </div>
          <div className="cv-grid">
            {visible.map((cv) => (
              <CVCard
                key={cv.id}
                cv={cv}
                onView={(trigger) => {
                  selectedTrigger.current = trigger;
                  setSelected(cv);
                }}
                onUpdated={(updated) =>
                  setCVs((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  )
                }
              />
            ))}
          </div>
          {!cvs.length && (
            <div className="empty cv-empty">
              <span aria-hidden="true">▤</span>
              <h2>Your CV library starts here.</h2>
              <p>Upload your first PDF above. Each new upload becomes an immutable version.</p>
            </div>
          )}
          {cvs.length > 0 && !visible.length && (
            <div className="empty cv-empty">
              <h2>{search ? 'No matching CVs.' : 'No active CVs.'}</h2>
              <p>
                {search
                  ? 'Try another name, category or filename.'
                  : 'Turn off Active only to view and restore archived versions.'}
              </p>
              {activeOnly && search && <p>Turn off Active only to include archived versions.</p>}
            </div>
          )}
          <p className="collection-note">
            Application counts include submitted applications only. Reusing the same bytes creates a
            separate named version with the same SHA256.
          </p>
        </>
      )}
      {selected && (
        <PDFDialog
          id={selected.id}
          cv={selected}
          onClose={() => {
            setSelected(null);
            requestAnimationFrame(() => selectedTrigger.current?.focus());
          }}
        />
      )}
    </section>
  );
}

function CVCard({
  cv,
  onView,
  onUpdated,
}: {
  cv: CV;
  onView: (trigger: HTMLButtonElement) => void;
  onUpdated: (cv: CV) => void;
}) {
  const session = useSession(),
    intent = useIntent();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  async function toggleArchived() {
    const payload = { expected_revision: cv.revision, archived: !cv.archived };
    setSaving(true);
    try {
      const updated = await api<CV>(
        '/cvs/' + encodeURIComponent(cv.id) + '/archive',
        { method: 'PUT', body: JSON.stringify({ ...payload, idempotency_key: intent(payload) }) },
        session.csrf_token,
      );
      intent.complete();
      setError('');
      onUpdated(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className="cv-card">
      <button
        className="cv-cover"
        aria-label={'View ' + cv.name + ' PDF'}
        onClick={(e) => onView(e.currentTarget)}
      >
        <span className="cover-label">Original PDF</span>
        <span className="paper">
          <span className="paper-heading">{cv.name}</span>
          <span className="paper-rule" />
          <span className="paper-lines" />
          <span className="pdf-tag">PDF</span>
        </span>
        <span className="cover-open">View original ↗</span>
      </button>
      <div className="cv-body">
        <div className="cv-name">
          <h2>{cv.name}</h2>
          <span className={'status ' + (cv.archived ? 'cv-archived' : 'cv-active')}>
            {cv.archived ? 'Archived' : 'Active'}
          </span>
        </div>
        <div className="cv-meta">
          <span>{cv.category}</span>
          <span>{date(cv.created_at)}</span>
        </div>
        <p className="filename">{cv.filename}</p>
        <code title={cv.sha256}>
          SHA256 {cv.sha256.slice(0, 12)} · {Math.ceil(cv.bytes / 1024)} KiB
        </code>
        <div className="cv-actions">
          <a href={'/?cv_id=' + encodeURIComponent(cv.id)}>{cv.applications} applications</a>
          <button onClick={(e) => onView(e.currentTarget)}>View PDF</button>
          {session.scopes.includes('trackapplyeasy:write') && (
            <button disabled={saving} onClick={toggleArchived}>
              {saving ? 'Saving…' : cv.archived ? 'Restore' : 'Archive'}
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
