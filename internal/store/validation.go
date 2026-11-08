package store

import (
	"crypto/rand"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

func ID() string { return rand.Text() }
func bounded(v string, min, max int) bool {
	return utf8.ValidString(v) && len(v) >= min && len(v) <= max && !strings.ContainsRune(v, 0) && !strings.ContainsFunc(v, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' && r != '\r' })
}

func validURL(v string, optional bool) bool {
	if v == "" {
		return optional
	}
	u, e := url.Parse(v)
	return e == nil && len(v) <= 2048 && u.Host != "" && u.User == nil && (u.Scheme == "http" || u.Scheme == "https")
}

func canonicalTime(raw string, optional bool, now time.Time) (string, error) {
	if raw == "" && optional {
		return "", nil
	}
	v, err := time.Parse(time.RFC3339, raw)
	if err != nil || v.Year() < 2000 || v.After(now.Add(5*time.Minute)) {
		return "", fmt.Errorf("%w: use a real RFC3339 date, no later than now", ErrInvalid)
	}
	return v.UTC().Format(timestampFormat), nil
}

func keyValid(v string) bool { return bounded(v, 8, 128) && strings.TrimSpace(v) == v }
func validateApplication(in *ApplicationInput, now time.Time) error {
	in.Title = strings.TrimSpace(in.Title)
	in.Company = strings.TrimSpace(in.Company)
	if !keyValid(in.IdempotencyKey) ||
		!bounded(in.Title, 1, 300) || !bounded(in.Company, 1, 200) ||
		!slices.Contains(Kinds, in.Kind) || !validURL(in.URL, true) ||
		!bounded(in.Rationale, 0, 8000) || !bounded(in.Feedback, 0, 8000) ||
		!bounded(in.CVID, 0, 64) {
		return ErrInvalid
	}
	var err error
	in.AppliedAt, err = canonicalTime(in.AppliedAt, true, now)
	if err != nil {
		return err
	}
	if in.Status == "" {
		if in.AppliedAt == "" {
			in.Status = "Preparing"
		} else {
			in.Status = "Applied"
		}
	}
	// Preparing is the only unsubmitted stage. Every submitted stage keeps
	// both an exact submission timestamp and an immutable CV reference.
	if !slices.Contains(Statuses, in.Status) ||
		(in.AppliedAt == "") != (in.Status == "Preparing") ||
		(in.AppliedAt != "" && in.CVID == "") {
		return fmt.Errorf("%w: submitted applications require an exact CV and date", ErrInvalid)
	}
	return nil
}

func normalizeFilter(f *Filter) error {
	if !bounded(f.Query, 0, 120) || !bounded(f.CVID, 0, 64) ||
		(f.Kind != "" && !slices.Contains(Kinds, f.Kind)) || len(f.Status) > len(Statuses) {
		return ErrInvalid
	}
	for _, v := range f.Status {
		if !slices.Contains(Statuses, v) {
			return ErrInvalid
		}
	}
	if f.Grain != "" && f.Grain != "day" && f.Grain != "week" {
		return ErrInvalid
	}
	if f.Page == 0 {
		f.Page = 1
	}
	if f.PageSize == 0 {
		f.PageSize = 10
	}
	if f.Page < 1 || f.Page > 100000 || f.PageSize < 1 || f.PageSize > 100 {
		return ErrInvalid
	}
	if f.Sort == "" {
		f.Sort = "applied_at"
	}
	if f.Direction == "" {
		f.Direction = "desc"
	}
	if !slices.Contains([]string{"applied_at", "company", "title", "latest_response"}, f.Sort) || !slices.Contains([]string{"asc", "desc"}, f.Direction) {
		return ErrInvalid
	}
	for _, v := range []string{f.From, f.To} {
		if v != "" {
			if _, err := time.Parse("2006-01-02", v); err != nil {
				return ErrInvalid
			}
		}
	}
	if f.From != "" && f.To != "" && f.From > f.To {
		return ErrInvalid
	}
	return nil
}
