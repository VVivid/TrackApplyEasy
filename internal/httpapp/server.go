// Package httpapp maps authenticated browser requests to the shared data service.
package httpapp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/VVivid/TrackApplyEasy/internal/identity"
	"github.com/VVivid/TrackApplyEasy/internal/store"
)

func New(s *store.Store, auth *identity.Manager, mcp http.Handler, static fs.FS) http.Handler {
	mux := http.NewServeMux()
	auth.Register(mux)
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Ping(r.Context()); err != nil {
			http.Error(w, "Unavailable", 503)
			return
		}
		w.WriteHeader(204)
	})
	route := func(pattern, scope string, h http.HandlerFunc) { mux.Handle(pattern, auth.Browser(scope, h)) }
	route("GET /api/v1/applications", store.Read, func(w http.ResponseWriter, r *http.Request) {
		f, err := parseFilter(r)
		if err != nil {
			fail(w, err)
			return
		}
		p, _ := identity.FromContext(r.Context())
		out, err := s.Applications(r.Context(), p.Actor, f)
		respond(w, out, err)
	})
	route("POST /api/v1/applications", store.Write, func(w http.ResponseWriter, r *http.Request) {
		var in store.ApplicationInput
		if !decode(w, r, &in) {
			return
		}
		p, _ := identity.FromContext(r.Context())
		out, err := s.CreateApplication(r.Context(), p.Actor, in)
		respond(w, out, err)
	})
	route("GET /api/v1/applications/{id}", store.Read, func(w http.ResponseWriter, r *http.Request) {
		p, _ := identity.FromContext(r.Context())
		out, err := s.Application(r.Context(), p.Actor, r.PathValue("id"))
		respond(w, out, err)
	})
	route("PUT /api/v1/applications/{id}", store.Write, func(w http.ResponseWriter, r *http.Request) {
		var in store.UpdateInput
		if !decode(w, r, &in) {
			return
		}
		if in.ID != "" && in.ID != r.PathValue("id") {
			fail(w, store.ErrInvalid)
			return
		}
		in.ID = r.PathValue("id")
		p, _ := identity.FromContext(r.Context())
		out, err := s.UpdateApplication(r.Context(), p.Actor, in)
		respond(w, out, err)
	})
	route("DELETE /api/v1/applications/{id}", store.Write, func(w http.ResponseWriter, r *http.Request) {
		var in store.DeleteInput
		if !decode(w, r, &in) {
			return
		}
		if in.ID != "" && in.ID != r.PathValue("id") {
			fail(w, store.ErrInvalid)
			return
		}
		in.ID = r.PathValue("id")
		p, _ := identity.FromContext(r.Context())
		out, err := s.DeleteApplication(r.Context(), p.Actor, in)
		respond(w, out, err)
	})
	route("GET /api/v1/applications/{id}/responses", store.Read, func(w http.ResponseWriter, r *http.Request) {
		p, _ := identity.FromContext(r.Context())
		out, err := s.Responses(r.Context(), p.Actor, r.PathValue("id"))
		respond(w, out, err)
	})
	route("POST /api/v1/applications/{id}/responses", store.Write, func(w http.ResponseWriter, r *http.Request) {
		var in store.ResponseInput
		if !decode(w, r, &in) {
			return
		}
		if in.ApplicationID != "" && in.ApplicationID != r.PathValue("id") {
			fail(w, store.ErrInvalid)
			return
		}
		in.ApplicationID = r.PathValue("id")
		p, _ := identity.FromContext(r.Context())
		out, err := s.AddResponse(r.Context(), p.Actor, in)
		respond(w, out, err)
	})
	route("GET /api/v1/cvs", store.Read, func(w http.ResponseWriter, r *http.Request) {
		p, _ := identity.FromContext(r.Context())
		out, err := s.CVs(r.Context(), p.Actor)
		respond(w, out, err)
	})
	route("PUT /api/v1/cvs/{id}/archive", store.Write, func(w http.ResponseWriter, r *http.Request) {
		var in store.CVArchiveInput
		if !decode(w, r, &in) {
			return
		}
		if in.ID != "" && in.ID != r.PathValue("id") {
			fail(w, store.ErrInvalid)
			return
		}
		in.ID = r.PathValue("id")
		p, _ := identity.FromContext(r.Context())
		out, err := s.SetCVArchived(r.Context(), p.Actor, in)
		respond(w, out, err)
	})
	route("POST /api/v1/cvs", store.Write, func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, store.MaxPDF+(1<<20))
		if err := r.ParseMultipartForm(store.MaxPDF + (1 << 20)); err != nil {
			fail(w, store.ErrInvalid)
			return
		}
		defer r.MultipartForm.RemoveAll()
		if len(r.MultipartForm.File["pdf"]) != 1 {
			fail(w, store.ErrInvalid)
			return
		}
		file, header, err := r.FormFile("pdf")
		if err != nil {
			fail(w, store.ErrInvalid)
			return
		}
		defer file.Close()
		raw, err := io.ReadAll(io.LimitReader(file, store.MaxPDF+1))
		if err != nil {
			fail(w, store.ErrInvalid)
			return
		}
		p, _ := identity.FromContext(r.Context())
		out, err := s.UploadCV(r.Context(), p.Actor, store.UploadInput{IdempotencyKey: r.FormValue("idempotency_key"), Name: r.FormValue("name"), Category: r.FormValue("category"), Filename: header.Filename, PDF: raw})
		respond(w, out, err)
	})
	route("GET /api/v1/cvs/{id}/pdf", store.Read, func(w http.ResponseWriter, r *http.Request) {
		p, _ := identity.FromContext(r.Context())
		cv, pdf, err := s.PDF(r.Context(), p.Actor, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": cv.Filename}))
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		w.Header().Set("Content-Length", strconv.Itoa(len(pdf)))
		w.WriteHeader(200)
		_, _ = w.Write(pdf)
	})
	route("GET /api/v1/analysis", store.Read, func(w http.ResponseWriter, r *http.Request) {
		f, err := parseFilter(r)
		if err != nil {
			fail(w, err)
			return
		}
		p, _ := identity.FromContext(r.Context())
		out, err := s.Analyze(r.Context(), p.Actor, f)
		respond(w, out, err)
	})
	route("GET /api/v1/facts", store.Read, func(w http.ResponseWriter, r *http.Request) {
		p, _ := identity.FromContext(r.Context())
		out, err := s.Facts(r.Context(), p.Actor)
		respond(w, out, err)
	})
	route("POST /api/v1/facts", store.Write, func(w http.ResponseWriter, r *http.Request) {
		var in store.FactInput
		if !decode(w, r, &in) {
			return
		}
		p, _ := identity.FromContext(r.Context())
		out, err := s.AddFact(r.Context(), p.Actor, in)
		respond(w, out, err)
	})
	mux.Handle("/mcp", auth.MCP(mcp))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	mux.Handle("/", staticHandler(static))
	return securityHeaders(auth.RestrictOrigin(mux))
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		http.Error(w, "JSON content type required.", 415)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(v) != nil || dec.Decode(new(any)) != io.EOF {
		fail(w, store.ErrInvalid)
		return false
	}
	return true
}
func parseFilter(r *http.Request) (store.Filter, error) {
	q := r.URL.Query()
	allowed := map[string]bool{"query": true, "kind": true, "status": true, "cv_id": true, "from": true, "to": true, "sort": true, "direction": true, "page": true, "page_size": true, "replied": true, "grain": true, "compact": true}
	for k, values := range q {
		if !allowed[k] || (k != "status" && len(values) != 1) {
			return store.Filter{}, store.ErrInvalid
		}
	}
	f := store.Filter{Query: q.Get("query"), Kind: q.Get("kind"), Status: q["status"], CVID: q.Get("cv_id"), From: q.Get("from"), To: q.Get("to"), Sort: q.Get("sort"), Direction: q.Get("direction")}
	for _, field := range []struct {
		name   string
		target *bool
	}{{"replied", &f.Replied}, {"compact", &f.Compact}} {
		if q.Get(field.name) != "" {
			value, err := strconv.ParseBool(q.Get(field.name))
			if err != nil {
				return f, store.ErrInvalid
			}
			*field.target = value
		}
	}
	f.Grain = q.Get("grain")
	for _, v := range []struct {
		name  string
		value *int
	}{{"page", &f.Page}, {"page_size", &f.PageSize}} {
		if q.Get(v.name) != "" {
			n, err := strconv.Atoi(q.Get(v.name))
			if err != nil {
				return f, store.ErrInvalid
			}
			*v.value = n
		}
	}
	return f, nil
}
func respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func SafeError(err error) string {
	switch {
	case errors.Is(err, store.ErrInvalid):
		return err.Error()
	case errors.Is(err, store.ErrNotFound):
		return "Record not found."
	case errors.Is(err, store.ErrConflict):
		return "The record changed or this retry key was already used. Reload and try again."
	case errors.Is(err, store.ErrForbidden):
		return "Permission denied."
	default:
		return "The request could not be saved. Please retry."
	}
}
func fail(w http.ResponseWriter, err error) {
	status := 500
	switch {
	case errors.Is(err, store.ErrInvalid):
		status = 400
	case errors.Is(err, store.ErrNotFound):
		status = 404
	case errors.Is(err, store.ErrConflict):
		status = 409
	case errors.Is(err, store.ErrForbidden):
		status = 403
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": SafeError(err)})
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob:; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
		next.ServeHTTP(w, r)
	})
}
func staticHandler(root fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(405)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		if strings.HasPrefix(name, ".") || strings.Contains(name, "\\") {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(root, name)
		if err != nil {
			if strings.Contains(path.Base(name), ".") {
				http.NotFound(w, r)
				return
			}
			name = strings.TrimSuffix(name, "/") + "/index.html"
			info, err = fs.Stat(root, name)
		} else if info.IsDir() {
			name = path.Join(name, "index.html")
			info, err = fs.Stat(root, name)
		}
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(name, "_next/static/") {
			w.Header().Set("Cache-Control", "public,max-age=31536000,immutable")
		}
		raw, readErr := fs.ReadFile(root, name)
		if readErr != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeContent(w, r, name, info.ModTime(), bytes.NewReader(raw))
	})
}
func StaticDir(dir string) fs.FS { return os.DirFS(dir) }
