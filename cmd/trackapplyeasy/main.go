// TrackApplyEasy serves static Next.js pages, authenticated APIs and private MCP.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/VVivid/TrackApplyEasy/internal/httpapp"
	"github.com/VVivid/TrackApplyEasy/internal/identity"
	"github.com/VVivid/TrackApplyEasy/internal/mcptools"
	"github.com/VVivid/TrackApplyEasy/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("TrackApplyEasy stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	dbPath := flag.String("db", "/data/trackapplyeasy.sqlite", "SQLite database path")
	staticDir := flag.String("static", "web/out", "Next static export directory")
	listen := flag.String("listen", ":8090", "HTTP listen address")
	enroll := flag.String("enroll-file", "", "Read protected JSON {issuer,subject,label} and enroll owner; exit")
	keygen := flag.String("keygen-file", "", "Create protected session keyring file; exit")
	prepareSource := flag.String("prepare-secrets-source", "", "Copy the two mounted secret files to an owner-only runtime directory; exit")
	prepareDest := flag.String("prepare-secrets-dest", "", "Destination for secret preparation")
	flag.Parse()
	if *prepareSource != "" {
		if *prepareDest == "" {
			return fmt.Errorf("secret destination required")
		}
		if err := os.MkdirAll(*prepareDest, 0700); err != nil {
			return err
		}
		for _, name := range []string{"client-secret", "session-keys.json"} {
			f, err := os.Open(filepath.Join(*prepareSource, name))
			if err != nil {
				return fmt.Errorf("secret input unavailable")
			}
			raw, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
			f.Close()
			if err != nil || len(raw) > 64<<10 {
				return fmt.Errorf("invalid secret input")
			}
			dest, err := os.OpenFile(filepath.Join(*prepareDest, name), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			if err = dest.Chmod(0600); err == nil {
				_, err = dest.Write(raw)
			}
			dest.Close()
			if err != nil {
				return err
			}
		}
		return nil
	}

	if *keygen != "" {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return err
		}
		raw, err := json.Marshal(map[string]any{"active": "v1", "keys": map[string]string{"v1": base64.StdEncoding.EncodeToString(key)}})
		if err != nil {
			return err
		}
		file, err := os.OpenFile(*keygen, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = file.Write(append(raw, '\n'))
		return err
	}
	s, err := store.Open(*dbPath)
	if err != nil {
		return err
	}
	defer s.Close()
	if *enroll != "" {
		raw, err := identity.PrivateFile(*enroll)
		if err != nil {
			return err
		}
		var in struct {
			Issuer  string `json:"issuer"`
			Subject string `json:"subject"`
			Label   string `json:"label"`
		}
		if json.Unmarshal(raw, &in) != nil {
			return fmt.Errorf("invalid enrollment file")
		}
		_, err = s.Enroll(context.Background(), in.Issuer, in.Subject, in.Label)
		if err != nil {
			return err
		}
		slog.Info("Owner enrollment saved")
		return nil
	}
	cfg, err := identity.LoadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	auth, err := identity.New(ctx, cfg, s)
	if err != nil {
		return err
	}
	if _, err = os.Stat(*staticDir + "/index.html"); err != nil {
		return fmt.Errorf("build the Next static export before starting")
	}
	server := &http.Server{Addr: *listen, Handler: httpapp.New(s, auth, mcptools.New(s), httpapp.StaticDir(*staticDir)), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 40 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		<-ctx.Done()
		shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("TrackApplyEasy listening", "address", *listen)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
