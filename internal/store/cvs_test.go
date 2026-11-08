package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestCVArchivePermissionsRevisionAndRetry(t *testing.T) {
	s, a, other := testStore(t)
	cv := upload(t, s, a, "archive-upload-01")
	app, err := s.CreateApplication(t.Context(), a, input(cv, "archive-application-01"))
	if err != nil {
		t.Fatal(err)
	}
	in := CVArchiveInput{IdempotencyKey: "archive-intent-01", ID: cv.ID, ExpectedRevision: 1, Archived: new(true)}
	if _, err = s.SetCVArchived(t.Context(), Actor{Owner: a.Owner, Scopes: []string{Read}}, in); !errors.Is(err, ErrForbidden) {
		t.Fatalf("read-only archive: %v", err)
	}
	if _, err = s.SetCVArchived(t.Context(), other, in); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner archive: %v", err)
	}
	missingTarget := in
	missingTarget.Archived = nil
	if _, err = s.SetCVArchived(t.Context(), a, missingTarget); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing target: %v", err)
	}
	archived, err := s.SetCVArchived(t.Context(), a, in)
	if err != nil || !archived.Archived || archived.Revision != 2 || archived.ID != cv.ID || archived.SHA256 != cv.SHA256 || archived.CreatedAt != cv.CreatedAt || archived.Applications != 1 {
		t.Fatalf("archive: %+v %v", archived, err)
	}
	replay, err := s.SetCVArchived(t.Context(), a, in)
	if err != nil || replay != archived {
		t.Fatalf("exact retry: %+v %v", replay, err)
	}
	stale := in
	stale.IdempotencyKey = "archive-stale-01"
	if _, err = s.SetCVArchived(t.Context(), a, stale); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale archive: %v", err)
	}
	changedIntent := in
	changedIntent.Archived = new(false)
	if _, err = s.SetCVArchived(t.Context(), a, changedIntent); !errors.Is(err, ErrConflict) {
		t.Fatalf("reused archive key: %v", err)
	}
	list, err := s.CVs(t.Context(), a)
	if err != nil || len(list) != 1 || list[0] != archived {
		t.Fatalf("list includes archived: %+v %v", list, err)
	}
	meta, raw, err := s.PDF(t.Context(), a, cv.ID)
	if err != nil || meta != archived || !bytes.Equal(raw, syntheticPDF) {
		t.Fatalf("archived exact PDF changed: %+v %v", meta, err)
	}
	saved, err := s.Application(t.Context(), a, app.ID)
	if err != nil || saved.CVID != app.CVID || saved.AppliedAt != app.AppliedAt || saved.Revision != app.Revision {
		t.Fatalf("historical submission changed: %+v %v", saved, err)
	}
	analysis, err := s.Analyze(t.Context(), a, Filter{})
	if err != nil || analysis.Submitted != 1 || len(analysis.CVs) != 1 || analysis.CVs[0].Applications != 1 {
		t.Fatalf("archived analysis lost history: %+v %v", analysis, err)
	}
	// Archival is library organization, not invalidation of an exact old CV.
	if _, err = s.CreateApplication(t.Context(), a, input(cv, "archive-historical-02")); err != nil {
		t.Fatalf("archived historical CV rejected: %v", err)
	}
	restored, err := s.SetCVArchived(t.Context(), a, CVArchiveInput{IdempotencyKey: "restore-intent-01", ID: cv.ID, ExpectedRevision: 2, Archived: new(false)})
	if err != nil || restored.Archived || restored.Revision != 3 || restored.Applications != 2 || restored.SHA256 != cv.SHA256 {
		t.Fatalf("restore: %+v %v", restored, err)
	}
}

func TestCVArchivePersistsAfterReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "archive.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	o, err := s.Enroll(t.Context(), "https://issuer.example.test", "synthetic-persist", "Synthetic owner")
	if err != nil {
		t.Fatal(err)
	}
	a := Actor{Owner: o.ID, Scopes: []string{Read, Write}}
	cv := upload(t, s, a, "persist-archive-upload")
	in := CVArchiveInput{IdempotencyKey: "persist-archive-intent", ID: cv.ID, ExpectedRevision: 1, Archived: new(true)}
	archived, err := s.SetCVArchived(t.Context(), a, in)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	list, err := s.CVs(t.Context(), a)
	if err != nil || len(list) != 1 || list[0] != archived {
		t.Fatalf("reopened archive: %+v %v", list, err)
	}
	replay, err := s.SetCVArchived(t.Context(), a, in)
	if err != nil || replay != archived {
		t.Fatalf("reopened receipt: %+v %v", replay, err)
	}
}

func TestSchemaOneUpgradePreservesAllRecordsAndOldUploadRetry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(schemaV1 + `PRAGMA user_version=1;`); err != nil {
		t.Fatal(err)
	}
	legacy := &Store{db: db, now: time.Now}
	o, err := legacy.Enroll(t.Context(), "https://issuer.example.test", "synthetic-legacy", "Legacy owner")
	if err != nil {
		t.Fatal(err)
	}
	a := Actor{Owner: o.ID, Scopes: []string{Read, Write}}
	up := UploadInput{IdempotencyKey: "legacy-upload-retry", Name: "Synthetic legacy CV", Category: "Test", Filename: "synthetic.pdf", PDF: syntheticPDF}
	cv, err := legacy.UploadCV(t.Context(), a, up)
	if err != nil {
		t.Fatal(err)
	}
	app, err := legacy.CreateApplication(t.Context(), a, input(cv, "legacy-application"))
	if err != nil {
		t.Fatal(err)
	}
	app, err = legacy.AddResponse(t.Context(), a, ResponseInput{IdempotencyKey: "legacy-response", ApplicationID: app.ID, ExpectedRevision: 1, OccurredAt: "2026-01-03T14:00:00Z", Status: "Interview", Summary: "Synthetic invitation", Body: "Synthetic response"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = legacy.AddFact(t.Context(), a, FactInput{IdempotencyKey: "legacy-fact", Kind: "Fact", Content: "Synthetic fact", SourceNote: "Synthetic test source"}); err != nil {
		t.Fatal(err)
	}
	if err = legacy.SaveSession(t.Context(), Session{Hash: []byte("synthetic-session"), Owner: a.Owner, Host: "example.test", Cipher: []byte("synthetic-encrypted-data"), ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if err = legacy.SaveLogin(t.Context(), []byte("synthetic-login"), "example.test", []byte("synthetic-encrypted-login"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// A real pre-upgrade receipt contains neither new field.
	raw, _ := json.Marshal(cv)
	var receipt map[string]any
	if err = json.Unmarshal(raw, &receipt); err != nil {
		t.Fatal(err)
	}
	delete(receipt, "archived")
	delete(receipt, "revision")
	raw, _ = json.Marshal(receipt)
	if _, err = db.Exec(`UPDATE idempotency SET result=? WHERE operation='cv.upload'`, raw); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for table, count := range map[string]int{"owners": 1, "cvs": 1, "applications": 1, "responses": 1, "facts": 1, "sessions": 1, "logins": 1, "idempotency": 4} {
		var got int
		if err = s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&got); err != nil || got != count {
			t.Fatalf("retained %s: %d %v", table, got, err)
		}
	}
	var version int
	if err = s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 2 {
		t.Fatalf("schema version: %d %v", version, err)
	}
	list, err := s.CVs(t.Context(), a)
	if err != nil || len(list) != 1 || list[0].Archived || list[0].Revision != 1 || list[0].ID != cv.ID || list[0].Applications != 1 {
		t.Fatalf("upgraded CV: %+v %v", list, err)
	}
	saved, err := s.Application(t.Context(), a, app.ID)
	if err != nil || saved != app {
		t.Fatalf("upgraded application/history: %+v %v", saved, err)
	}
	if _, err = s.SetCVArchived(t.Context(), a, CVArchiveInput{IdempotencyKey: "legacy-archive", ID: cv.ID, ExpectedRevision: 1, Archived: new(true)}); err != nil {
		t.Fatal(err)
	}
	replayed, err := s.UploadCV(t.Context(), a, up)
	if err != nil || replayed.ID != cv.ID || replayed.SHA256 != cv.SHA256 || !replayed.Archived || replayed.Revision != 2 {
		t.Fatalf("old upload receipt: %+v %v", replayed, err)
	}
	_, data, err := s.PDF(t.Context(), a, cv.ID)
	if err != nil || !bytes.Equal(data, syntheticPDF) {
		t.Fatalf("legacy PDF changed: %v", err)
	}
	var integrity string
	if err = s.db.QueryRow(`PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		t.Fatalf("upgrade integrity: %s %v", integrity, err)
	}
	rows, err := s.db.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Fatal("upgrade broke foreign keys")
	}
}

func TestSchemaMigrationRollsBackAndRejectsNewerVersions(t *testing.T) {
	for _, newer := range []bool{false, true} {
		t.Run(map[bool]string{false: "rollback", true: "newer"}[newer], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "schema.sqlite")
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			setup := schemaV1 + `ALTER TABLE cvs ADD COLUMN revision INTEGER; PRAGMA user_version=1;`
			if newer {
				setup = `PRAGMA user_version=3;`
			}
			if _, err = db.Exec(setup); err != nil {
				t.Fatal(err)
			}
			if s, err := Open(path); err == nil {
				s.Close()
				t.Fatal("invalid migration unexpectedly opened")
			}
			var version int
			if err = db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != map[bool]int{false: 1, true: 3}[newer] {
				t.Fatalf("schema version changed: %d %v", version, err)
			}
			if !newer {
				var archived int
				if err = db.QueryRow(`SELECT count(*) FROM pragma_table_info('cvs') WHERE name='archived'`).Scan(&archived); err != nil || archived != 0 {
					t.Fatalf("partial migration leaked: %d %v", archived, err)
				}
			}
		})
	}
}
