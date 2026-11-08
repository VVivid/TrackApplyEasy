package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func Open(path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, err
		}
		file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
		if err != nil {
			return nil, err
		}
		if err = file.Chmod(0600); err != nil {
			file.Close()
			return nil, err
		}
		file.Close()
	}
	dsn := "file::memory:?mode=memory&cache=private"
	if path != ":memory:" {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		dsn = (&url.URL{Scheme: "file", Path: absolute}).String() + "?"
	}
	separator := "&"
	if path != ":memory:" {
		separator = ""
	}
	dsn += separator + "_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: time.Now}
	if err = s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize database: %w", err)
	}
	return s, nil
}
func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

// Schema changes and user_version commit together. Reopening an existing
// database must neither replay ALTER TABLE nor lower a newer schema version.
func (s *Store) migrate() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err = tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > 2 {
		return fmt.Errorf("database schema %d is newer than this application", version)
	}
	if version == 0 {
		if _, err = tx.Exec(schemaV1); err != nil {
			return err
		}
	}
	if version < 2 {
		if _, err = tx.Exec(`ALTER TABLE cvs ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1));
ALTER TABLE cvs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
PRAGMA user_version=2;`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

const schemaV1 = `
CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,label TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),UNIQUE(issuer,subject));
CREATE TABLE IF NOT EXISTS cvs(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES owners(id),name TEXT NOT NULL,category TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL,pdf BLOB NOT NULL,created_at TEXT NOT NULL,UNIQUE(owner,id));
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES owners(id),url TEXT NOT NULL,title TEXT NOT NULL,company TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('Job','Internship')),applied_at TEXT NOT NULL DEFAULT '',rationale TEXT NOT NULL,status TEXT NOT NULL,cv_id TEXT,feedback TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(owner,id),FOREIGN KEY(owner,cv_id) REFERENCES cvs(owner,id),CHECK((applied_at='' AND status='Preparing') OR(applied_at<>'' AND status<>'Preparing' AND cv_id IS NOT NULL)));
CREATE INDEX IF NOT EXISTS apps_owner_date ON applications(owner,applied_at DESC,id);
CREATE TABLE IF NOT EXISTS responses(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,application_id TEXT NOT NULL,occurred_at TEXT NOT NULL,status TEXT NOT NULL,channel TEXT NOT NULL,summary TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(owner,application_id) REFERENCES applications(owner,id));
CREATE INDEX IF NOT EXISTS response_app_date ON responses(owner,application_id,occurred_at DESC,sequence DESC);
CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES owners(id),kind TEXT NOT NULL,content TEXT NOT NULL,source_url TEXT NOT NULL,source_note TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(owner TEXT NOT NULL REFERENCES owners(id),operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,result BLOB NOT NULL,PRIMARY KEY(owner,operation,key));
CREATE TABLE IF NOT EXISTS sessions(hash BLOB PRIMARY KEY,owner TEXT NOT NULL REFERENCES owners(id),host TEXT NOT NULL,cipher BLOB NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logins(hash BLOB PRIMARY KEY,host TEXT NOT NULL,cipher BLOB NOT NULL,expires_at INTEGER NOT NULL);
`

func (s *Store) Enroll(ctx context.Context, issuer, subject, label string) (Owner, error) {
	if !bounded(issuer, 1, 2048) || !bounded(subject, 1, 255) || !bounded(label, 1, 100) {
		return Owner{}, ErrInvalid
	}
	o := Owner{ID: ID(), Issuer: issuer, Subject: subject, Label: label}
	_, err := s.db.ExecContext(ctx, `INSERT INTO owners(id,issuer,subject,label)VALUES(?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET label=excluded.label,enabled=1`, o.ID, issuer, subject, label)
	if err != nil {
		return Owner{}, err
	}
	return s.Owner(ctx, issuer, subject)
}
func (s *Store) Owner(ctx context.Context, issuer, subject string) (Owner, error) {
	var o Owner
	err := s.db.QueryRowContext(ctx, `SELECT id,issuer,subject,label FROM owners WHERE issuer=? AND subject=? AND enabled=1`, issuer, subject).Scan(&o.ID, &o.Issuer, &o.Subject, &o.Label)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return o, err
}
func (s *Store) SaveSession(ctx context.Context, v Session) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions(hash,owner,host,cipher,expires_at)VALUES(?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET cipher=excluded.cipher,expires_at=excluded.expires_at`, v.Hash, v.Owner, v.Host, v.Cipher, v.ExpiresAt.Unix())
	return err
}
func (s *Store) Session(ctx context.Context, hash []byte, host string, now time.Time) (Session, error) {
	v := Session{Hash: hash}
	var expiry int64
	err := s.db.QueryRowContext(ctx, `SELECT s.owner,s.host,s.cipher,s.expires_at FROM sessions s JOIN owners o ON o.id=s.owner WHERE s.hash=? AND s.host=? AND s.expires_at>? AND o.enabled=1`, hash, host, now.Unix()).Scan(&v.Owner, &v.Host, &v.Cipher, &expiry)
	v.ExpiresAt = time.Unix(expiry, 0)
	return v, err
}
func (s *Store) DeleteSession(ctx context.Context, hash []byte) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE hash=?`, hash)
	return err
}
func (s *Store) SaveLogin(ctx context.Context, hash []byte, host string, cipher []byte, expiry time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM logins WHERE expires_at<=?`, s.now().Unix()); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO logins(hash,host,cipher,expires_at)VALUES(?,?,?,?)`, hash, host, cipher, expiry.Unix())
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) ConsumeLogin(ctx context.Context, hash []byte, host string, now time.Time) ([]byte, error) {
	var cipher []byte
	err := s.db.QueryRowContext(ctx, `DELETE FROM logins WHERE hash=? AND host=? AND expires_at>? RETURNING cipher`, hash, host, now.Unix()).Scan(&cipher)
	return cipher, err
}
