# TrackApplyEasy

Track applications, exact submitted CV PDFs and dated response history in one private workspace. The public website requires sign-in for all user data. Production begins empty: no example jobs, personal CVs or facts are seeded.

The three browser pages are Applications, CV library and Analysis. Applications supports title search, type/status/CV/submission-date filters, server-side sorting and pagination, drafts, submission, feedback, and a response history dialog. A submitted application permanently references its exact immutable CV version. CV cards link their submitted application counts back to the table. Analysis uses real submitted rows, submission-date cohorts and recorded history; drafts are excluded and comparisons do not claim causation.

## Architecture

Next.js statically exports the React UI. A single Go process serves that export, the authenticated browser API and an official Go SDK MCP endpoint. There is no Node server in the production image. SQLite stores application data, original PDF blobs, encrypted refresh sessions and login attempts together, with WAL, foreign keys, a busy timeout and one writer. The Helm deployment has one nonroot replica, `Recreate`, a retained PVC, a read-only root filesystem and no service-account token.

Browser endpoints are `https://work.vvivid.dev` and private `https://work.lab.vvivid.dev`. Both use the canonical API resource `https://work.vvivid.dev/api/v1`. Private MCP uses `https://mcp.rd.lab.vvivid.dev/trackapplyeasy/mcp` through the existing gateway; it is excluded from the browser ingress. This repository prepares the app and chart. The private `VVivid/homelab-gitops` repository owns its exact desired-state path and platform setup.

## Read the code

1. `internal/store/model.go`, `validation.go`, `db.go`: domain types, ownership, schema and durable identity state.
2. `internal/store/applications.go`, `cvs.go`, `analysis.go`, `reporting.go`: transactional operations shared by browser and MCP, including retries and immutable PDF versions.
3. `internal/identity`: exact OIDC claims, host-bound PKCE login, encrypted rotating refresh sessions, CSRF and the separate gateway token contract.
4. `internal/httpapp/server.go`, `internal/mcptools/handler.go`: transport adapters.
5. `web/components`: the three pages and dialogs; `cmd/trackapplyeasy/main.go` wires the service.
6. `deploy/helm/trackapplyeasy` and `deploy/gitops`: app deployment and release publication/promotion.

For example, uploading a PDF commits an immutable blob with SHA256 and an idempotent result. Recording a submission validates that CV against the verified owner's records. A later `append_response` checks the revision, inserts history and updates the application stage in the same transaction when it is the latest received event. A backfilled earlier reply keeps the current stage; equal received times use insertion order. A stale revision returns conflict without inserting history; retries of the same successful intent return the original result.

## Build and verify

Use Go 1.26.5 or later in the 1.26 series, Node 24.19, npm 11, Helm 4.3.1 and Python 3.12 or later. Dependency versions and npm lockfile are committed. Container builds use Go 1.26.9. `scripts/install-ci-tools.sh` installs checksum-verified Helm on the Linux CI runner.

```sh
make deps
make check test race build chart-test
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm --prefix web exec -- playwright install chromium
make browser-test
python3 -m unittest discover -s deploy/gitops -p 'test_*.py'
docker build --platform linux/amd64 --tag trackapplyeasy:local .
```

The browser test serves the **production export** through the actual Go handler and CSP, then signs in through a synthetic local issuer, uploads a synthetic PDF, reads back exact bytes, records an application and response, filters, inspects analysis and checks a mobile layout. The fixture exists only in test code and requires an explicit environment flag; production has no test login or anonymous data mode. Local tests establish these contracts, not real Keycloak, Fleet, DNS, tailnet isolation or actual external-client acceptance.

## Configuration and owner enrollment

Copy references from `.env.example` into your protected runtime configuration. All identity settings are required; partial configuration fails startup. Keep the client secret in a 0400/0600 file. Generate a stable keyring once and retain it separately from the database backup:

```sh
umask 077
mkdir -p .secrets
bin/trackapplyeasy -keygen-file .secrets/session-keys.json
```

Enrollment is explicit and never occurs during login. Prepare a protected JSON file with `issuer`, `subject` and `label` from the existing verified provider identity. Pass only its path:

```sh
bin/trackapplyeasy -db /protected/data/trackapplyeasy.sqlite -enroll-file /protected/enrollment.json
```

The command updates that issuer/subject's label and enables its account, or creates the owner. It does not print the subject. Each request looks up the currently enabled owner. Request bodies and tool inputs cannot choose an owner. Keep enrollment files out of Git. For Kubernetes, run the same command inside the app pod after copying the protected input with owner-only permissions; remove the input after read-back. Never enroll while another standalone process writes the same database.

## Authentication and staying signed in

The confidential browser client needs only `trackapplyeasy:read`, `trackapplyeasy:write`, `openid` negotiation and optional `offline_access`. Exact callbacks are `/auth/callback` on both configured origins. The app requests `offline_access` and uses code flow, S256 PKCE, state, nonce and issuer validation. Each login attempt, session and CSRF check is bound to the exact request Host; arbitrary forwarded headers cannot select an origin. Cookies are host-only, opaque, Secure, HttpOnly and SameSite Lax. The two browser hosts have independent cookies and the same database.

Access JWTs are signed RS256 and must have the exact issuer, single resource audience, explicit authorized client, expected scope and a lifetime no longer than 300 seconds. The refresh token stays encrypted server-side in SQLite with AES-256-GCM and authenticated session/host context. No tokens or user data are written to browser storage; only the selected color theme is stored there. Active browser use keeps a rolling **30-day app idle expiry**. There is no fixed ten-hour local maximum. Refresh calls for a session serialize so the provider's rotating refresh tokens cannot race. The original keyring must survive restarts. Rotation may retain up to two old decrypt-only keys while one active key encrypts new state.

A temporary token-endpoint network/5xx failure retains the last durable grant. An already valid access token can finish its remaining lifetime; after expiry the app returns retryable 503 without clearing the session. Temporary signing-key fetch failures also return 503. A received rotating refresh response is encrypted and persisted before signature verification, so a signing-key outage or a later app restart cannot discard its replacement refresh grant. Pending access/ID tokens never authorize a request. Recovery verifies their signatures and strict claims at the stored response receipt time, then obtains fresh tokens if they have since expired. `invalid_grant` requires a new login. Invalid cryptographic identity/claims are rejected. A refresh response must contain a new bounded refresh token; providers that do not rotate on every refresh are outside this deployment contract. A lost refresh response can require re-login if the provider consumed the old grant. A crash between provider rotation and durable persistence has the same unavoidable boundary; one instance and synchronous SQLite writes minimize that window.

Sign out destroys the local session/cookie and calls the provider's refresh-token revocation endpoint. If revocation cannot be confirmed, the response explicitly says so. It does not claim a global sign-out from other apps. The shared realm's SSO/idle/max policy is not changed. The external MCP client performs its own OAuth/refresh and must request `offline_access` if it needs offline persistence; the app cannot force that client to refresh, retain credentials or remain signed in.

Gateway MCP verifies a pinned public JWKS, `mcp-gateway+jwt` type, exact gateway issuer, sole internal audience `trackapplyeasy-mcp`, original provider issuer plus subject, explicit MCP client IDs, route scopes and a maximum 60-second lifetime. Browser grants cannot authenticate as gateway grants. Direct OIDC mode exists for local tests/independent deployments; the production chart fixes gateway mode. No dynamic client registration or automatic account signup is provided.

The CSP permits same-origin resources and inline Next export bootstrap scripts (`script-src 'self' 'unsafe-inline'`). React escapes saved text; there is no saved HTML renderer. PDF responses are authenticated, `application/pdf`, `nosniff`, no-store, sandboxed and viewable only by the owning browser. This compatible CSP is intentionally less restrictive than per-export script hashes; tightening it requires generating/verifying those hashes with each build.

## API and MCP

Browser data endpoints are under `/api/v1`: session, applications, application responses, CVs/PDFs, analysis and sourced facts. All mutations require same-origin CSRF. JSON rejects unknown fields and oversized bodies. PDFs are bounded at 10 MiB and checked for a PDF header/EOF; they are not malware-scanned or parsed for personal facts. Upload original, trusted documents. CV, fact and history collection views are bounded at 1000 records; application listings paginate up to 100 rows. Analysis totals include every matching application and activity fills zero calendar periods, switching to Monday-based weeks for long ranges. Report ranges are bounded at 100 years to prevent unbounded empty-calendar allocation. All report filters/activity/date displays use America/New_York, including DST; date input gaps are rejected and a repeated fall-back time chooses its earlier occurrence. Response dates must be at or after submission; late-entered replies are accepted without replacing a newer received event/current stage. Current status can be corrected explicitly without rewriting immutable history. Employer reply counts exclude self-withdrawals, and Interview/Offer metrics use current status. V1 does not delete immutable records.

Private MCP exposes `list_applications`, `get_application`, `create_application`, `update_application`, `append_response`, `list_responses`, `list_cvs`, `upload_cv`, `analyze_applications`, `list_facts`, and `add_fact`. Both transports invoke the same store rules and permission checks. MCP PDF upload uses standard base64 with a 4 MiB byte limit so the encoded request fits the shared gateway; browser multipart permits 10 MiB. Larger PDFs can be uploaded in the browser and referenced by immutable cv_id from MCP; lists return metadata, not blobs. Facts and experience require a source URL or source note and are never inferred from requirements. All saved text/links/PDFs are untrusted data, never agent instructions. The server does not research jobs, generate CVs or submit applications.

See [deployment and release operations](deploy/README.md) before activating anything. Public source has no license grant selected yet; do not assume a license from its visibility.
