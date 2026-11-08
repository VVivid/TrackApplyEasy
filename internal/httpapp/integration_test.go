package httpapp_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/VVivid/TrackApplyEasy/internal/httpapp"
	"github.com/VVivid/TrackApplyEasy/internal/identity"
	"github.com/VVivid/TrackApplyEasy/internal/mcptools"
	"github.com/VVivid/TrackApplyEasy/internal/store"
	"github.com/VVivid/TrackApplyEasy/internal/testoidc"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

type fixture struct {
	s        *store.Store
	auth     *identity.Manager
	provider *testoidc.Issuer
	server   *httptest.Server
	client   *http.Client
	origin   string
}

func newFixture(t *testing.T, browser bool) *fixture {
	t.Helper()
	p := testoidc.New(t)
	s, err := store.Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if _, err = s.Enroll(t.Context(), p.URL(), "test-subject", "Synthetic owner"); err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewUnstartedServer(nil)
	if browser {
		backend.Listener.Close()
		backend.Listener, err = net.Listen("tcp", "127.0.0.1:8099")
		if err != nil {
			t.Fatal(err)
		}
	}
	origin := "http://" + backend.Listener.Addr().String()
	if browser {
		origin = "https://" + backend.Listener.Addr().String()
	}
	raw, _ := json.Marshal(map[string]any{"active": "test", "keys": map[string]string{"test": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32))}})
	keys, err := identity.ParseKeys(raw)
	if err != nil {
		t.Fatal(err)
	}
	cfg := identity.Config{Origins: []string{origin}, Issuer: p.URL(), WebClientID: "track-web", WebClientSecret: "synthetic-secret", APIAudience: origin + "/api/v1", MCPMode: "direct", MCPResource: origin + "/mcp", MCPAudience: origin + "/mcp", MCPClients: []string{"track-test"}, Keys: keys}
	auth, err := identity.New(t.Context(), cfg, s)
	if err != nil {
		t.Fatal(err)
	}
	var handler http.Handler
	if browser {
		handler = httpapp.New(s, auth, mcptools.New(s), httpapp.StaticDir("../../web/out"))
	} else {
		handler = httpapp.New(s, auth, mcptools.New(s), fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>TrackApplyEasy</title>")}, "cvs/index.html": {Data: []byte("CV library")}})
	}
	backend.Config.Handler = handler
	if browser {
		backend.StartTLS()
	} else {
		backend.Start()
	}
	t.Cleanup(backend.Close)
	client := backend.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &fixture{s: s, auth: auth, provider: p, server: backend, client: client, origin: origin}
}
func (f *fixture) request(t *testing.T, method, path string, body io.Reader, content string, cookie *http.Cookie, csrf string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, f.origin+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if content != "" {
		req.Header.Set("Content-Type", content)
	}
	if method != "GET" {
		req.Header.Set("Origin", f.origin)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	res, err := f.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}
func (f *fixture) login(t *testing.T) (*http.Cookie, string) {
	t.Helper()
	res := f.request(t, "GET", "/auth/login", nil, "", nil, "")
	u, _ := url.Parse(res.Header.Get("Location"))
	f.provider.Prepare(u.Query())
	var login *http.Cookie
	for _, c := range res.Cookies() {
		if strings.Contains(c.Name, "login") {
			login = c
		}
	}
	res = f.request(t, "GET", "/auth/callback?code=synthetic-code&state="+u.Query().Get("state")+"&iss="+url.QueryEscape(f.provider.URL()), nil, "", login, "")
	if res.StatusCode != 303 {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("callback %d %s", res.StatusCode, raw)
	}
	var session *http.Cookie
	for _, c := range res.Cookies() {
		if strings.Contains(c.Name, "session") && c.Value != "" {
			session = c
		}
	}
	if session == nil {
		t.Fatal("session missing")
	}
	res = f.request(t, "GET", "/api/v1/session", nil, "", session, "")
	var out struct {
		CSRF string `json:"csrf_token"`
	}
	if json.NewDecoder(res.Body).Decode(&out) != nil || out.CSRF == "" {
		t.Fatal("CSRF missing")
	}
	return session, out.CSRF
}

type bearerTransport struct{ token string }

func (b bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	copy := r.Clone(r.Context())
	copy.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(copy)
}
func TestAuthenticatedAPIAndOfficialMCPSharePersistence(t *testing.T) {
	f := newFixture(t, false)
	if res := f.request(t, "GET", "/api/v1/applications", nil, "", nil, ""); res.StatusCode != 401 {
		t.Fatalf("anonymous API %d", res.StatusCode)
	}
	cookie, csrf := f.login(t)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writer.WriteField("name", "Synthetic CV")
	writer.WriteField("category", "Test")
	writer.WriteField("idempotency_key", "http-upload-01")
	part, _ := writer.CreateFormFile("pdf", "synthetic.pdf")
	part.Write([]byte("%PDF-1.4\nSynthetic fixture only\n%%EOF\n"))
	writer.Close()
	uploaded := f.request(t, "POST", "/api/v1/cvs", &body, writer.FormDataContentType(), cookie, csrf)
	var cv store.CV
	if uploaded.StatusCode != 200 || json.NewDecoder(uploaded.Body).Decode(&cv) != nil {
		t.Fatalf("upload %d", uploaded.StatusCode)
	}
	token := f.provider.Access("test-subject", "track-test", f.origin+"/mcp", store.Read+" "+store.Write, 300)
	client := sdk.NewClient(&sdk.Implementation{Name: "trackapplyeasy-integration", Version: "test"}, nil)
	session, err := client.Connect(t.Context(), &sdk.StreamableClientTransport{Endpoint: f.origin + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{token}}, DisableStandaloneSSE: true, MaxRetries: -1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(t.Context(), nil)
	if err != nil || len(tools.Tools) != 11 {
		t.Fatalf("tools/list = %+v %v", tools, err)
	}
	in := store.ApplicationInput{IdempotencyKey: "sdk-create-001", Title: "Synthetic SDK role", Company: "Example", Kind: "Job", AppliedAt: "2026-01-02T10:00:00Z", CVID: cv.ID, Status: "Applied"}
	called, err := session.CallTool(t.Context(), &sdk.CallToolParams{Name: "create_application", Arguments: in})
	if err != nil || called.IsError {
		t.Fatalf("tools/call = %+v %v", called, err)
	}
	res := f.request(t, "GET", "/api/v1/applications", nil, "", cookie, "")
	var page store.Page
	if json.NewDecoder(res.Body).Decode(&page) != nil || page.Total != 1 || page.Items[0].Title != in.Title {
		t.Fatalf("shared app data %+v", page)
	}

	if _, err = f.s.Enroll(t.Context(), f.provider.URL(), "other-test-subject", "Other synthetic owner"); err != nil {
		t.Fatal(err)
	}
	otherToken := f.provider.Access("other-test-subject", "track-test", f.origin+"/mcp", store.Read, 300)
	otherClient := sdk.NewClient(&sdk.Implementation{Name: "isolated-owner", Version: "test"}, nil)
	otherSession, err := otherClient.Connect(t.Context(), &sdk.StreamableClientTransport{Endpoint: f.origin + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{otherToken}}, DisableStandaloneSSE: true, MaxRetries: -1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer otherSession.Close()
	hidden, err := otherSession.CallTool(t.Context(), &sdk.CallToolParams{Name: "get_application", Arguments: map[string]any{"id": page.Items[0].ID}})
	if err != nil || !hidden.IsError {
		t.Fatalf("cross-owner SDK read: %+v %v", hidden, err)
	}
	forbiddenWrite, err := otherSession.CallTool(t.Context(), &sdk.CallToolParams{Name: "create_application", Arguments: in})
	if err != nil || !forbiddenWrite.IsError {
		t.Fatalf("read-only SDK write: %+v %v", forbiddenWrite, err)
	}
	pdf := f.request(t, "GET", "/api/v1/cvs/"+cv.ID+"/pdf", nil, "", cookie, "")
	raw, _ := io.ReadAll(pdf.Body)
	if pdf.StatusCode != 200 || !bytes.HasPrefix(raw, []byte("%PDF-")) || pdf.Header.Get("Content-Type") != "application/pdf" {
		t.Fatalf("PDF %d", pdf.StatusCode)
	}
	denied := f.request(t, "POST", "/api/v1/applications", strings.NewReader(`{}`), "application/json", cookie, "")
	if denied.StatusCode != 403 {
		t.Fatalf("CSRF missing %d", denied.StatusCode)
	}
	for _, path := range []string{"/", "/cvs/"} {
		res = f.request(t, "GET", path, nil, "", nil, "")
		if res.StatusCode != 200 {
			t.Fatalf("static %s = %d", path, res.StatusCode)
		}
	}
	for _, path := range []string{"/api/v1/not-found", "/.env", "/cvs-evil"} {
		res = f.request(t, "GET", path, nil, "", nil, "")
		if res.StatusCode != 404 {
			t.Fatalf("unknown route %s = %d", path, res.StatusCode)
		}
	}
	bad := f.provider.Access("test-subject", "track-test", f.origin+"/mcp", store.Write, 300)
	req, _ := http.NewRequest("POST", f.origin+"/mcp", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+bad)
	res, err = f.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("MCP missing read scope %d", res.StatusCode)
	}
}

// Playwright starts this opt-in test fixture. The production binary has no
// synthetic provider, enrollment bypass, fixture loader or test login mode.
func TestBrowserFixture(t *testing.T) {
	if os.Getenv("TRACK_BROWSER_FIXTURE") != "1" {
		t.Skip("only started by make browser-test")
	}
	f := newFixture(t, true)
	t.Log("Production static export fixture ready at " + f.origin)
	select {
	case <-t.Context().Done():
	case <-time.After(9 * time.Minute):
	}
}
