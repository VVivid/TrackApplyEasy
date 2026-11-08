package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
)

type UploadInput struct {
	IdempotencyKey string `json:"idempotency_key"`
	Name           string `json:"name"`
	Category       string `json:"category"`
	Filename       string `json:"filename"`
	PDF            []byte `json:"-"`
	Digest         string `json:"sha256"`
}

func (s *Store) UploadCV(ctx context.Context, a Actor, in UploadInput) (CV, error) {
	in.Filename = filepath.Base(strings.ReplaceAll(in.Filename, "\\", "/"))
	in.Name = strings.TrimSpace(in.Name)
	in.Category = strings.TrimSpace(in.Category)
	if !bounded(in.Name, 1, 200) || !bounded(in.Category, 1, 80) || !bounded(in.Filename, 1, 240) || !strings.HasSuffix(strings.ToLower(in.Filename), ".pdf") || len(in.PDF) < 12 || len(in.PDF) > MaxPDF || !bytes.HasPrefix(in.PDF, []byte("%PDF-")) || !bytes.Contains(in.PDF[max(0, len(in.PDF)-1024):], []byte("%%EOF")) {
		return CV{}, ErrInvalid
	}
	hash := sha256.Sum256(in.PDF)
	in.Digest = hex.EncodeToString(hash[:])
	return write(ctx, s, a, "cv.upload", in.IdempotencyKey, in, func(tx *sql.Tx) (CV, error) {
		cv := CV{ID: ID(), Name: in.Name, Category: in.Category, Filename: in.Filename, SHA256: in.Digest, Bytes: len(in.PDF), CreatedAt: s.timestamp()}
		_, err := tx.ExecContext(ctx, `INSERT INTO cvs(id,owner,name,category,filename,sha256,pdf,created_at)VALUES(?,?,?,?,?,?,?,?)`, cv.ID, a.Owner, cv.Name, cv.Category, cv.Filename, cv.SHA256, in.PDF, cv.CreatedAt)
		return cv, err
	})
}
func (s *Store) CVs(ctx context.Context, a Actor) ([]CV, error) {
	if err := a.Require(Read); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,c.name,c.category,c.filename,c.sha256,length(c.pdf),c.created_at,(SELECT count(*) FROM applications a WHERE a.owner=c.owner AND a.cv_id=c.id AND a.applied_at<>'') FROM cvs c WHERE c.owner=? ORDER BY c.created_at DESC,c.id DESC LIMIT 1000`, a.Owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CV{}
	for rows.Next() {
		var c CV
		if err = rows.Scan(&c.ID, &c.Name, &c.Category, &c.Filename, &c.SHA256, &c.Bytes, &c.CreatedAt, &c.Applications); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) PDF(ctx context.Context, a Actor, id string) (CV, []byte, error) {
	if err := a.Require(Read); err != nil {
		return CV{}, nil, err
	}
	var c CV
	var pdf []byte
	err := s.db.QueryRowContext(ctx, `SELECT id,name,category,filename,sha256,length(pdf),created_at,pdf FROM cvs WHERE owner=? AND id=?`, a.Owner, id).Scan(&c.ID, &c.Name, &c.Category, &c.Filename, &c.SHA256, &c.Bytes, &c.CreatedAt, &pdf)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return c, pdf, err
}
func (s *Store) AddFact(ctx context.Context, a Actor, in FactInput) (Fact, error) {
	if (in.Kind != "Fact" && in.Kind != "Experience") || !bounded(in.Content, 1, 12000) || !validURL(in.SourceURL, true) || !bounded(in.SourceNote, 0, 2000) || (in.SourceURL == "" && strings.TrimSpace(in.SourceNote) == "") {
		return Fact{}, ErrInvalid
	}
	return write(ctx, s, a, "fact.create", in.IdempotencyKey, in, func(tx *sql.Tx) (Fact, error) {
		f := Fact{ID: ID(), Kind: in.Kind, Content: in.Content, SourceURL: in.SourceURL, SourceNote: in.SourceNote, CreatedAt: s.timestamp()}
		_, err := tx.ExecContext(ctx, `INSERT INTO facts(id,owner,kind,content,source_url,source_note,created_at)VALUES(?,?,?,?,?,?,?)`, f.ID, a.Owner, f.Kind, f.Content, f.SourceURL, f.SourceNote, f.CreatedAt)
		return f, err
	})
}
func (s *Store) Facts(ctx context.Context, a Actor) ([]Fact, error) {
	if err := a.Require(Read); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,kind,content,source_url,source_note,created_at FROM facts WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 1000`, a.Owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Fact{}
	for rows.Next() {
		var f Fact
		if err = rows.Scan(&f.ID, &f.Kind, &f.Content, &f.SourceURL, &f.SourceNote, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
