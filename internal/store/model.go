// Package store owns TrackApplyEasy's data rules and SQLite transactions.
package store

import (
	"errors"
	"slices"
	"time"
)

const (
	Read   = "trackapplyeasy:read"
	Write  = "trackapplyeasy:write"
	MaxPDF = 10 << 20
)

var (
	ErrInvalid   = errors.New("invalid input")
	ErrNotFound  = errors.New("record not found")
	ErrConflict  = errors.New("record changed or idempotency key reused")
	ErrForbidden = errors.New("permission denied")
)
var Statuses = []string{"Preparing", "Applied", "Response received", "Screening", "Interview", "Offer", "Rejected", "Withdrawn"}
var Kinds = []string{"Job", "Internship"}

type Actor struct {
	Owner  string
	Scopes []string
}

func (a Actor) Require(scope string) error {
	if a.Owner == "" || !slices.Contains(a.Scopes, scope) {
		return ErrForbidden
	}
	return nil
}

type Owner struct {
	ID      string `json:"id"`
	Issuer  string `json:"issuer"`
	Subject string `json:"-"`
	Label   string `json:"label"`
}
type CV struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Category     string `json:"category"`
	Filename     string `json:"filename"`
	SHA256       string `json:"sha256"`
	Bytes        int    `json:"bytes"`
	CreatedAt    string `json:"created_at"`
	Applications int    `json:"applications"`
	Archived     bool   `json:"archived"`
	Revision     int    `json:"revision"`
}
type CVArchiveInput struct {
	IdempotencyKey   string `json:"idempotency_key"`
	ID               string `json:"id"`
	ExpectedRevision int    `json:"expected_revision"`
	Archived         *bool  `json:"archived"`
}
type Application struct {
	ID             string `json:"id"`
	URL            string `json:"url"`
	Title          string `json:"title"`
	Company        string `json:"company"`
	Kind           string `json:"kind"`
	AppliedAt      string `json:"applied_at"`
	Rationale      string `json:"rationale"`
	Status         string `json:"status"`
	CVID           string `json:"cv_id"`
	Feedback       string `json:"feedback"`
	Revision       int    `json:"revision"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	LatestResponse string `json:"latest_response"`
	LatestSummary  string `json:"latest_summary"`
}
type ApplicationInput struct {
	IdempotencyKey string `json:"idempotency_key"`
	URL            string `json:"url"`
	Title          string `json:"title"`
	Company        string `json:"company"`
	Kind           string `json:"kind"`
	AppliedAt      string `json:"applied_at"`
	Rationale      string `json:"rationale"`
	Status         string `json:"status"`
	CVID           string `json:"cv_id"`
	Feedback       string `json:"feedback"`
}
type UpdateInput struct {
	ApplicationInput
	ID               string `json:"id"`
	ExpectedRevision int    `json:"expected_revision"`
}
type ResponseInput struct {
	IdempotencyKey   string `json:"idempotency_key"`
	ApplicationID    string `json:"application_id"`
	ExpectedRevision int    `json:"expected_revision"`
	OccurredAt       string `json:"occurred_at"`
	Status           string `json:"status"`
	Channel          string `json:"channel"`
	Summary          string `json:"summary"`
	Body             string `json:"body"`
}
type Response struct {
	ID            string `json:"id"`
	ApplicationID string `json:"application_id"`
	OccurredAt    string `json:"occurred_at"`
	Status        string `json:"status"`
	Channel       string `json:"channel"`
	Summary       string `json:"summary"`
	Body          string `json:"body"`
	CreatedAt     string `json:"created_at"`
}
type Filter struct {
	Query     string   `json:"query,omitempty"`
	Kind      string   `json:"kind,omitempty"`
	Status    []string `json:"status,omitempty"`
	CVID      string   `json:"cv_id,omitempty"`
	From      string   `json:"from,omitempty"`
	Replied   bool     `json:"replied,omitzero"`
	Compact   bool     `json:"compact,omitzero"`
	Grain     string   `json:"grain,omitempty"`
	To        string   `json:"to,omitempty"`
	Sort      string   `json:"sort,omitempty"`
	Direction string   `json:"direction,omitempty"`
	Page      int      `json:"page"`
	PageSize  int      `json:"page_size"`
}
type Page struct {
	Items    []Application `json:"items"`
	Total    int           `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}
type Count struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
type CVComparison struct {
	CVID         string `json:"cv_id"`
	Name         string `json:"name"`
	SHA256       string `json:"sha256"`
	Applications int    `json:"applications"`
	Responses    int    `json:"responses"`
	Interviews   int    `json:"interviews"`
	Offers       int    `json:"offers"`
}
type Analysis struct {
	Submitted  int            `json:"submitted"`
	From       string         `json:"from"`
	To         string         `json:"to"`
	Timezone   string         `json:"timezone"`
	Grain      string         `json:"grain"`
	Responded  int            `json:"responded"`
	Interviews int            `json:"interviews"`
	Offers     int            `json:"offers"`
	Statuses   []Count        `json:"statuses"`
	Activity   []Count        `json:"activity"`
	CVs        []CVComparison `json:"cvs"`
}
type FactInput struct {
	IdempotencyKey string `json:"idempotency_key"`
	Kind           string `json:"kind"`
	Content        string `json:"content"`
	SourceURL      string `json:"source_url"`
	SourceNote     string `json:"source_note"`
}
type Fact struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Content    string `json:"content"`
	SourceURL  string `json:"source_url"`
	SourceNote string `json:"source_note"`
	CreatedAt  string `json:"created_at"`
}
type Session struct {
	Hash      []byte
	Owner     string
	Host      string
	Cipher    []byte
	ExpiresAt time.Time
}
