# TrackApplyEasy contributor instructions

TrackApplyEasy is an independent application. Keep original user PDFs, identity
subjects, access/refresh tokens, credentials, database files and production dumps
out of source and fixtures. New production installations start empty. Tests use
explicitly synthetic data. Public source visibility does not select a license.

Read README.md and deploy/README.md before changing identity, persistence or
release behavior. Browser and MCP must share owner-qualified domain rules.
Preserve immutable submitted CV blobs/submission times, transactional response
history, optimistic revisions and exact idempotent retry semantics.

Use modern Go guidance for the declared Go version. Format Go with gofmt and the
frontend with the pinned Prettier configuration. Required local checks are in the
Makefile: check, test, race, build, chart-test and browser-test; container-test
runs against an already built image. Browser tests run a test-only synthetic
issuer; production must never gain a bypass. Real identity/deployment acceptance
is separate from these local contracts.

One process/replica owns SQLite and rotating browser refresh tokens. Keep exact
issuer, audience, client, scope, Host, callback and CSRF checks. Session keys are
stable protected files; refresh tokens stay encrypted server-side. Transient
provider outages preserve viable grants. Do not change a shared realm or gateway
policy incidentally. The existing private gateway and public/private origin
boundaries are deliberate.

The source chart owns only app resources. Private GitOps owns fixed desired state
and separate infrastructure setup. Publish, push, deployment, DNS, live identity
changes and shared-cluster changes require their corresponding user authority.
Do not copy unrelated monorepo deployment credentials into this repository.
