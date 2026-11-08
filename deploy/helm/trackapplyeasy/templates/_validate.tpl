{{- define "trackapplyeasy.validate" -}}
{{- if not .Values.configured }}{{ fail "configured=true is required after identity, storage, artifacts and TLS preparation" }}{{ end -}}
{{- if ne (int .Values.replicaCount) 1 }}{{ fail "SQLite rotating refresh sessions require exactly one replica" }}{{ end -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.image.digest) }}{{ fail "immutable image sha256 digest required" }}{{ end -}}
{{- if ne .Values.image.repository "ghcr.io/vvivid/trackapplyeasy" }}{{ fail "only the TrackApplyEasy artifact is accepted" }}{{ end -}}
{{- if or (ne .Values.origins.public "https://work.vvivid.dev") (ne .Values.origins.private "https://work.lab.vvivid.dev") }}{{ fail "exact public and private origins required" }}{{ end -}}
{{- if or (ne .Values.mcp.mode "gateway") (ne .Values.mcp.resource "https://mcp.rd.lab.vvivid.dev/trackapplyeasy/mcp") (ne .Values.mcp.audience "trackapplyeasy-mcp") (ne .Values.mcp.gatewayIssuer "https://mcp.rd.lab.vvivid.dev") }}{{ fail "production requires the fixed private gateway contract" }}{{ end -}}
{{- if or (not .Values.identity.secretName) (not .Values.identity.gatewayJWKSConfigMap) (not .Values.identity.mcpClientIDs) }}{{ fail "existing identity Secret, gateway public JWKS and explicit MCP clients required" }}{{ end -}}
{{- if and .Values.routes.publicEnabled (not .Values.routes.publicCertificateReady) }}{{ fail "public ingress requires observed trusted certificate readiness" }}{{ end -}}
{{- if and .Values.routes.privateEnabled (not .Values.routes.privateCertificateReady) }}{{ fail "private ingress requires observed trusted certificate readiness" }}{{ end -}}
{{- if not (has .Values.storage.storageClass (list "personal-local-retain" "rd-local-retain")) }}{{ fail "retained local storage class required" }}{{ end -}}
{{- if not (regexMatch "^[a-f0-9]{40}$" .Values.provenance.sourceCommit) }}{{ fail "source commit provenance required" }}{{ end -}}
{{- end -}}
