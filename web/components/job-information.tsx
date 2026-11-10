import { type JobFact, parseJobInformation } from '../lib/job-information';

function JobFacts({ facts, label }: { facts: JobFact[]; label: string }) {
  return (
    <dl className="job-facts" aria-label={label}>
      {facts.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JobInformation({ rationale }: { rationale: string }) {
  const job = parseJobInformation(rationale);
  if (!job) {
    return (
      <section className="application-detail-section">
        <h3>Why this role / job information</h3>
        <p className="pre-wrap">{rationale || 'No job information or rationale recorded.'}</p>
      </section>
    );
  }

  return (
    <div className="job-information">
      {(job.roleFacts.length > 0 || job.tags.length > 0) && (
        <div className="job-overview">
          {job.roleFacts.length > 0 && <JobFacts facts={job.roleFacts} label="Role facts" />}
          {job.tags.length > 0 && (
            <ul className="job-tags" aria-label="Tags" role="list">
              {job.tags.map((tag, index) => (
                <li key={index}>{tag}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <section className="job-section" aria-labelledby="job-description-heading">
        <h3 id="job-description-heading">Description</h3>
        <p className="pre-wrap">{job.description}</p>
      </section>
      {job.requirement && (
        <section className="job-section" aria-labelledby="job-requirements-heading">
          <h3 id="job-requirements-heading">Requirements</h3>
          <ul className="job-requirements">
            <li className="pre-wrap">{job.requirement}</li>
          </ul>
        </section>
      )}
      <section className="job-section job-agent-note" aria-labelledby="job-agent-note-heading">
        <h3 id="job-agent-note-heading">Agent Note</h3>
        {job.agentNote.map((paragraph, index) => (
          <p className="pre-wrap" key={index}>
            {paragraph}
          </p>
        ))}
      </section>
      <details className="job-source">
        <summary>Source details</summary>
        <div>
          <p>Imported from AgentNewsfeed</p>
          <JobFacts facts={job.sourceFacts} label="Import provenance" />
        </div>
      </details>
    </div>
  );
}
