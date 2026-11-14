package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

const timestampFormat = "2006-01-02T15:04:05.000000000Z"

func (s *Store) timestamp() string { return s.now().UTC().Format(timestampFormat) }

// Each write and its retry result commit together. A reused key with different
// input fails instead of accidentally replaying an earlier intent.
func write[T any](ctx context.Context, s *Store, a Actor, operation, key string, input any, change func(*sql.Tx) (T, error)) (T, error) {
	var zero T
	if err := a.Require(Write); err != nil {
		return zero, err
	}
	if !keyValid(key) {
		return zero, ErrInvalid
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return zero, err
	}
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	var priorHash string
	var prior []byte
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result FROM idempotency WHERE owner=? AND operation=? AND key=?`, a.Owner, operation, key).Scan(&priorHash, &prior)
	if err == nil {
		if priorHash != hash {
			return zero, ErrConflict
		}
		var out T
		if err = json.Unmarshal(prior, &out); err != nil {
			return zero, err
		}
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return zero, err
	}
	out, err := change(tx)
	if err != nil {
		return zero, err
	}
	result, err := json.Marshal(out)
	if err != nil {
		return zero, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO idempotency(owner,operation,key,request_hash,result)VALUES(?,?,?,?,?)`, a.Owner, operation, key, hash, result); err != nil {
		return zero, err
	}
	if err = tx.Commit(); err != nil {
		return zero, err
	}
	return out, nil
}

func (s *Store) CreateApplication(ctx context.Context, a Actor, in ApplicationInput) (Application, error) {
	if err := validateApplication(&in, s.now()); err != nil {
		return Application{}, err
	}
	return write(ctx, s, a, "application.create", in.IdempotencyKey, in, func(tx *sql.Tx) (Application, error) {
		if err := ownCV(ctx, tx, a.Owner, in.CVID); err != nil {
			return Application{}, err
		}
		app := Application{
			ID:        ID(),
			URL:       in.URL,
			Title:     in.Title,
			Company:   in.Company,
			Kind:      in.Kind,
			AppliedAt: in.AppliedAt,
			Rationale: in.Rationale,
			Status:    in.Status,
			CVID:      in.CVID,
			Feedback:  in.Feedback,
			Revision:  1,
			CreatedAt: s.timestamp(),
			UpdatedAt: s.timestamp(),
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO applications(id,owner,url,title,company,kind,applied_at,rationale,status,cv_id,feedback,revision,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, app.ID, a.Owner, app.URL, app.Title, app.Company, app.Kind, app.AppliedAt, app.Rationale, app.Status, nullable(app.CVID), app.Feedback, app.Revision, app.CreatedAt, app.UpdatedAt)
		return app, err
	})
}

func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func ownCV(ctx context.Context, tx *sql.Tx, owner, id string) error {
	if id == "" {
		return nil
	}
	var found string
	err := tx.QueryRowContext(ctx, `SELECT id FROM cvs WHERE owner=? AND id=?`, owner, id).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

const appColumns = `a.id,a.url,a.title,a.company,a.kind,a.applied_at,a.rationale,a.status,COALESCE(a.cv_id,''),a.feedback,a.revision,a.created_at,a.updated_at,COALESCE((SELECT occurred_at FROM responses r WHERE r.owner=a.owner AND r.application_id=a.id ORDER BY occurred_at DESC,r.sequence DESC LIMIT 1),''),COALESCE((SELECT summary FROM responses r WHERE r.owner=a.owner AND r.application_id=a.id ORDER BY occurred_at DESC,r.sequence DESC LIMIT 1),'')`

type scanner interface{ Scan(...any) error }

func scanApplication(row scanner) (Application, error) {
	var a Application
	err := row.Scan(&a.ID, &a.URL, &a.Title, &a.Company, &a.Kind, &a.AppliedAt, &a.Rationale, &a.Status, &a.CVID, &a.Feedback, &a.Revision, &a.CreatedAt, &a.UpdatedAt, &a.LatestResponse, &a.LatestSummary)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return a, err
}

func (s *Store) Application(ctx context.Context, a Actor, id string) (Application, error) {
	if err := a.Require(Read); err != nil {
		return Application{}, err
	}
	return scanApplication(s.db.QueryRowContext(ctx, `SELECT `+appColumns+` FROM applications a WHERE a.owner=? AND a.id=?`, a.Owner, id))
}

func (s *Store) UpdateApplication(ctx context.Context, a Actor, in UpdateInput) (Application, error) {
	if !bounded(in.ID, 1, 64) || in.ExpectedRevision < 1 {
		return Application{}, ErrInvalid
	}
	if err := validateApplication(&in.ApplicationInput, s.now()); err != nil {
		return Application{}, err
	}
	return write(ctx, s, a, "application.update", in.IdempotencyKey, in, func(tx *sql.Tx) (Application, error) {
		old, err := scanApplication(tx.QueryRowContext(ctx, `SELECT `+appColumns+` FROM applications a WHERE a.owner=? AND a.id=?`, a.Owner, in.ID))
		if err != nil {
			return Application{}, err
		}
		if old.Revision != in.ExpectedRevision {
			return Application{}, ErrConflict
		}
		if old.AppliedAt != "" && (old.CVID != in.CVID || old.AppliedAt != in.AppliedAt) {
			return Application{}, fmt.Errorf("%w: submitted CV and submission time are immutable", ErrInvalid)
		}
		if err := ownCV(ctx, tx, a.Owner, in.CVID); err != nil {
			return Application{}, err
		}
		old.URL, old.Title, old.Company, old.Kind, old.AppliedAt, old.Rationale, old.Status, old.CVID, old.Feedback = in.URL, in.Title, in.Company, in.Kind, in.AppliedAt, in.Rationale, in.Status, in.CVID, in.Feedback
		old.Revision++
		old.UpdatedAt = s.timestamp()
		_, err = tx.ExecContext(ctx, `UPDATE applications SET url=?,title=?,company=?,kind=?,applied_at=?,rationale=?,status=?,cv_id=?,feedback=?,revision=?,updated_at=? WHERE owner=? AND id=? AND revision=?`, old.URL, old.Title, old.Company, old.Kind, old.AppliedAt, old.Rationale, old.Status, nullable(old.CVID), old.Feedback, old.Revision, old.UpdatedAt, a.Owner, in.ID, in.ExpectedRevision)
		return old, err
	})
}

// DeleteApplication permanently removes an owned draft. Submitted rows keep
// their immutable CV, submission time and response history, so they are
// refused; a draft cannot have responses because responses need a submission.
func (s *Store) DeleteApplication(ctx context.Context, a Actor, in DeleteInput) (DeleteResult, error) {
	if !bounded(in.ID, 1, 64) || in.ExpectedRevision < 1 {
		return DeleteResult{}, ErrInvalid
	}
	return write(ctx, s, a, "application.delete", in.IdempotencyKey, in, func(tx *sql.Tx) (DeleteResult, error) {
		var appliedAt string
		var revision int
		err := tx.QueryRowContext(ctx, `SELECT applied_at,revision FROM applications WHERE owner=? AND id=?`, a.Owner, in.ID).Scan(&appliedAt, &revision)
		if errors.Is(err, sql.ErrNoRows) {
			return DeleteResult{}, ErrNotFound
		}
		if err != nil {
			return DeleteResult{}, err
		}
		if revision != in.ExpectedRevision {
			return DeleteResult{}, ErrConflict
		}
		if appliedAt != "" {
			return DeleteResult{}, fmt.Errorf("%w: submitted applications cannot be deleted", ErrInvalid)
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM applications WHERE owner=? AND id=? AND revision=? AND applied_at=''`, a.Owner, in.ID, in.ExpectedRevision)
		if err != nil {
			return DeleteResult{}, err
		}
		if n, err := res.RowsAffected(); err != nil || n != 1 {
			return DeleteResult{}, ErrConflict
		}
		return DeleteResult{ID: in.ID, Deleted: true}, nil
	})
}

func (s *Store) AddResponse(ctx context.Context, a Actor, in ResponseInput) (Application, error) {
	// Responses may move a submitted application to any stage after Applied;
	// Preparing and Applied are entry stages, not response outcomes.
	if !bounded(in.ApplicationID, 1, 64) || in.ExpectedRevision < 1 ||
		!slices.Contains(Statuses[2:], in.Status) || !bounded(in.Channel, 0, 100) ||
		!bounded(in.Summary, 1, 500) || !bounded(in.Body, 1, 16000) {
		return Application{}, ErrInvalid
	}
	var err error
	in.OccurredAt, err = canonicalTime(in.OccurredAt, false, s.now())
	if err != nil {
		return Application{}, err
	}
	return write(ctx, s, a, "response.create", in.IdempotencyKey, in, func(tx *sql.Tx) (Application, error) {
		app, err := scanApplication(tx.QueryRowContext(ctx, `SELECT `+appColumns+` FROM applications a WHERE a.owner=? AND a.id=?`, a.Owner, in.ApplicationID))
		if err != nil {
			return Application{}, err
		}
		if app.Revision != in.ExpectedRevision {
			return Application{}, ErrConflict
		}
		if app.AppliedAt == "" || in.OccurredAt < app.AppliedAt {
			return Application{}, fmt.Errorf("%w: response must be at or after submission", ErrInvalid)
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO responses(id,owner,application_id,occurred_at,status,channel,summary,body,created_at)VALUES(?,?,?,?,?,?,?,?,?)`, ID(), a.Owner, app.ID, in.OccurredAt, in.Status, in.Channel, in.Summary, in.Body, s.timestamp())
		if err != nil {
			return Application{}, err
		}
		app.Revision++
		// For equal received times, the most recently inserted event wins.
		// A late-entered earlier response preserves the current recorded stage.
		if in.OccurredAt >= app.LatestResponse {
			app.Status = in.Status
			app.LatestResponse = in.OccurredAt
			app.LatestSummary = in.Summary
		}
		app.UpdatedAt = s.timestamp()
		_, err = tx.ExecContext(ctx, `UPDATE applications SET status=?,revision=?,updated_at=? WHERE owner=? AND id=?`, app.Status, app.Revision, app.UpdatedAt, a.Owner, app.ID)
		return app, err
	})
}

func (s *Store) Responses(ctx context.Context, a Actor, id string) ([]Response, error) {
	if _, err := s.Application(ctx, a, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,application_id,occurred_at,status,channel,summary,body,created_at FROM responses r WHERE owner=? AND application_id=? ORDER BY occurred_at DESC,r.sequence DESC LIMIT 1000`, a.Owner, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Response{}
	for rows.Next() {
		var r Response
		if err = rows.Scan(&r.ID, &r.ApplicationID, &r.OccurredAt, &r.Status, &r.Channel, &r.Summary, &r.Body, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func filterSQL(a Actor, f Filter) (string, []any) {
	clauses := []string{"a.owner=?"}
	args := []any{a.Owner}
	if f.Replied {
		clauses = append(clauses, employerReplySQL)
	}
	if f.Query != "" {
		clauses = append(clauses, `instr(lower(a.title),lower(?))>0`)
		args = append(args, f.Query)
	}
	if f.Kind != "" {
		clauses = append(clauses, "a.kind=?")
		args = append(args, f.Kind)
	}
	if f.CVID != "" {
		clauses = append(clauses, "a.cv_id=? AND a.applied_at<>''")
		args = append(args, f.CVID)
	}
	if len(f.Status) > 0 {
		clauses = append(clauses, "a.status IN("+strings.TrimSuffix(strings.Repeat("?,", len(f.Status)), ",")+")")
		for _, v := range f.Status {
			args = append(args, v)
		}
	}
	if f.From != "" {
		clauses = append(clauses, "track_report_day(a.applied_at)>=?")
		args = append(args, f.From)
	}
	if f.To != "" {
		clauses = append(clauses, "track_report_day(a.applied_at)<=?")
		args = append(args, f.To)
	}
	return strings.Join(clauses, " AND "), args
}

func (s *Store) Applications(ctx context.Context, a Actor, f Filter) (Page, error) {
	if err := a.Require(Read); err != nil {
		return Page{}, err
	}
	if err := normalizeFilter(&f); err != nil {
		return Page{}, err
	}
	where, args := filterSQL(a, f)
	out := Page{Items: []Application{}, Page: f.Page, PageSize: f.PageSize}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM applications a WHERE `+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	sortColumn := "a." + f.Sort
	if f.Sort == "latest_response" {
		sortColumn = "COALESCE((SELECT max(occurred_at) FROM responses r WHERE r.owner=a.owner AND r.application_id=a.id),'')"
	}
	args = append(args, f.PageSize, (f.Page-1)*f.PageSize)
	rows, err := tx.QueryContext(ctx, `SELECT `+appColumns+` FROM applications a WHERE `+where+` ORDER BY `+sortColumn+` `+f.Direction+`,a.id `+f.Direction+` LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		app, e := scanApplication(rows)
		if e != nil {
			rows.Close()
			return out, e
		}
		out.Items = append(out.Items, app)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
