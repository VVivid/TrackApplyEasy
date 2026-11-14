package store

import (
	"bytes"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

var syntheticPDF = []byte("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n")

func testStore(t *testing.T) (*Store, Actor, Actor) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	a, err := s.Enroll(t.Context(), "https://issuer.example.test", "owner-a", "Test owner")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Enroll(t.Context(), "https://issuer.example.test", "owner-b", "Other test owner")
	if err != nil {
		t.Fatal(err)
	}
	return s, Actor{a.ID, []string{Read, Write}}, Actor{b.ID, []string{Read, Write}}
}
func upload(t *testing.T, s *Store, a Actor, key string) CV {
	t.Helper()
	cv, err := s.UploadCV(t.Context(), a, UploadInput{IdempotencyKey: key, Name: "Synthetic test CV", Category: "Test", Filename: "synthetic.pdf", PDF: syntheticPDF})
	if err != nil {
		t.Fatal(err)
	}
	return cv
}
func input(cv CV, key string) ApplicationInput {
	return ApplicationInput{IdempotencyKey: key, Title: "Synthetic role", Company: "Example", Kind: "Job", AppliedAt: "2026-01-02T14:00:00Z", CVID: cv.ID, Status: "Applied"}
}
func TestAtomicSubmissionResponseAndIsolation(t *testing.T) {
	s, a, b := testStore(t)
	cv := upload(t, s, a, "cv-test-0001")
	in := input(cv, "app-test-0001")
	app, err := s.CreateApplication(t.Context(), a, in)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.CreateApplication(t.Context(), a, in)
	if err != nil || replay.ID != app.ID {
		t.Fatalf("retry = %+v, %v", replay, err)
	}
	in.Company = "Changed intent"
	if _, err = s.CreateApplication(t.Context(), a, in); !errors.Is(err, ErrConflict) {
		t.Fatalf("key reuse: %v", err)
	}
	if _, err = s.CreateApplication(t.Context(), b, input(cv, "cross-own-001")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner CV accepted: %v", err)
	}
	if _, _, err = s.PDF(t.Context(), b, cv.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner PDF: %v", err)
	}
	if _, err = s.Application(t.Context(), b, app.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner app: %v", err)
	}
	response := ResponseInput{IdempotencyKey: "response-0001", ApplicationID: app.ID, ExpectedRevision: 1, OccurredAt: "2026-01-03T14:00:00Z", Status: "Interview", Channel: "Test", Summary: "Synthetic response", Body: "Synthetic response body"}
	updated, err := s.AddResponse(t.Context(), a, response)
	if err != nil || updated.Status != "Interview" || updated.Revision != 2 {
		t.Fatalf("response = %+v, %v", updated, err)
	}
	response.IdempotencyKey = "response-0002"
	if _, err = s.AddResponse(t.Context(), a, response); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision: %v", err)
	}
	events, err := s.Responses(t.Context(), a, app.ID)
	if err != nil || len(events) != 1 {
		t.Fatalf("failed response leaked history: %+v %v", events, err)
	}
	cv2 := upload(t, s, a, "cv-test-0002")
	edit := UpdateInput{ApplicationInput: input(cv2, "edit-test-001"), ID: app.ID, ExpectedRevision: 2}
	edit.Status = "Interview"
	if _, err = s.UpdateApplication(t.Context(), a, edit); !errors.Is(err, ErrInvalid) {
		t.Fatalf("submitted CV changed: %v", err)
	}
	meta, raw, err := s.PDF(t.Context(), a, cv.ID)
	if err != nil || !bytes.Equal(raw, syntheticPDF) || meta.SHA256 != cv2.SHA256 {
		t.Fatalf("exact PDF/hash mismatch: %v", err)
	}
	draft := ApplicationInput{IdempotencyKey: "draft-test-01", Title: "Synthetic draft", Company: "Example", Kind: "Internship"}
	if _, err = s.CreateApplication(t.Context(), a, draft); err != nil {
		t.Fatal(err)
	}
	analysis, err := s.Analyze(t.Context(), a, Filter{})
	if err != nil || analysis.Submitted != 1 || analysis.Responded != 1 || analysis.Interviews != 1 || len(analysis.CVs) != 2 {
		t.Fatalf("analysis = %+v %v", analysis, err)
	}
	empty, err := s.Analyze(t.Context(), b, Filter{})
	if err != nil || empty.Submitted != 0 {
		t.Fatalf("owner isolation: %+v %v", empty, err)
	}
	list, err := s.CVs(t.Context(), a)
	usage := 0
	for _, v := range list {
		if v.ID == cv.ID {
			usage = v.Applications
		}
	}
	if err != nil || usage != 1 {
		t.Fatalf("CV usage = %+v %v", list, err)
	}
}
func TestPersistencePaginationAndSubmissionCohort(t *testing.T) {
	s, a, _ := testStore(t)
	cv := upload(t, s, a, "cv-cohort-01")
	for i, title := range []string{"Alpha", "Beta", "Gamma"} {
		in := input(cv, ID())
		in.Title = title
		if i == 2 {
			in.AppliedAt = "2026-02-01T14:00:00Z"
			in.Kind = "Internship"
		}
		if _, err := s.CreateApplication(t.Context(), a, in); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.Applications(t.Context(), a, Filter{Page: 2, PageSize: 1, Sort: "title", Direction: "asc"})
	if err != nil || page.Total != 3 || page.Items[0].Title != "Beta" {
		t.Fatalf("page %+v %v", page, err)
	}
	analysis, err := s.Analyze(t.Context(), a, Filter{From: "2026-01-01", To: "2026-01-31"})
	if err != nil || analysis.Submitted != 2 {
		t.Fatalf("cohort %+v %v", analysis, err)
	}
	path := filepath.Join(t.TempDir(), "persist.sqlite")
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := other.Enroll(t.Context(), "https://issuer.example.test", "persist", "Persist")
	if err != nil {
		t.Fatal(err)
	}
	actor := Actor{owner.ID, []string{Read, Write}}
	v := upload(t, other, actor, "cv-persist01")
	other.Close()
	other, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	_, raw, err := other.PDF(t.Context(), actor, v.ID)
	if err != nil || !bytes.Equal(raw, syntheticPDF) {
		t.Fatalf("restart persistence: %v", err)
	}
}
func TestBoundariesAndDraftSubmission(t *testing.T) {
	s, a, _ := testStore(t)
	cv := upload(t, s, a, "cv-bound-001")
	draft, err := s.CreateApplication(t.Context(), a, ApplicationInput{IdempotencyKey: "draft-bound01", Title: "Draft", Company: "Example", Kind: "Job"})
	if err != nil {
		t.Fatal(err)
	}
	submitted, err := s.UpdateApplication(t.Context(), a, UpdateInput{ApplicationInput: input(cv, "submit-bound1"), ID: draft.ID, ExpectedRevision: 1})
	if err != nil || submitted.AppliedAt == "" {
		t.Fatalf("draft submit %+v %v", submitted, err)
	}
	for _, f := range []Filter{{PageSize: 101}, {Sort: "title; DROP TABLE owners"}, {Status: []string{"unknown"}}, {From: "2026-02-01", To: "2026-01-01"}} {
		if _, err = s.Applications(t.Context(), a, f); !errors.Is(err, ErrInvalid) {
			t.Errorf("accepted filter %+v: %v", f, err)
		}
	}
	if _, err = s.CreateApplication(t.Context(), Actor{Owner: a.Owner, Scopes: []string{Read}}, input(cv, "read-only-01")); !errors.Is(err, ErrForbidden) {
		t.Errorf("read-only write: %v", err)
	}
	if _, err = s.AddFact(t.Context(), a, FactInput{IdempotencyKey: "fact-test-001", Kind: "Fact", Content: "Synthetic fact"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("unsourced fact: %v", err)
	}
}

func TestBackfilledAndEqualTimeResponsesPreserveLatestAndCurrentStage(t *testing.T) {
	s, a, _ := testStore(t)
	cv := upload(t, s, a, "cv-history-01")
	app, err := s.CreateApplication(t.Context(), a, input(cv, "app-history01"))
	if err != nil {
		t.Fatal(err)
	}
	add := func(when, status, summary string) Application {
		t.Helper()
		next, err := s.AddResponse(t.Context(), a, ResponseInput{IdempotencyKey: ID(), ApplicationID: app.ID, ExpectedRevision: app.Revision, OccurredAt: when, Status: status, Summary: summary, Body: "Synthetic response history fixture"})
		if err != nil {
			t.Fatal(err)
		}
		app = next
		return next
	}
	add("2026-01-05T10:00:00Z", "Interview", "Latest interview")
	backfilled := add("2026-01-03T10:00:00Z", "Response received", "Earlier reply entered later")
	if backfilled.Status != "Interview" || backfilled.LatestSummary != "Latest interview" {
		t.Fatalf("backfill changed latest/current: %+v", backfilled)
	}
	tied := add("2026-01-05T10:00:00Z", "Offer", "Equal-time event entered last")
	reloaded, err := s.Application(t.Context(), a, app.ID)
	if err != nil || reloaded.LatestSummary != tied.LatestSummary || reloaded.Status != "Offer" {
		t.Fatalf("tie latest differs after read: %+v %v", reloaded, err)
	}
	history, err := s.Responses(t.Context(), a, app.ID)
	if err != nil || len(history) != 3 || history[0].Summary != tied.LatestSummary || history[1].Summary != "Latest interview" {
		t.Fatalf("deterministic history order: %+v %v", history, err)
	}
	edit := input(cv, "correct-stage1")
	edit.Status = "Rejected"
	corrected, err := s.UpdateApplication(t.Context(), a, UpdateInput{ApplicationInput: edit, ID: app.ID, ExpectedRevision: app.Revision})
	if err != nil || corrected.Status != "Rejected" {
		t.Fatalf("explicit current-stage correction: %+v %v", corrected, err)
	}
	analysis, err := s.Analyze(t.Context(), a, Filter{})
	if err != nil || analysis.Interviews != 0 || analysis.Offers != 0 || analysis.Responded != 1 {
		t.Fatalf("current status semantics: %+v %v", analysis, err)
	}
}

func TestNewYorkCalendarCohortsAcrossMidnightAndDST(t *testing.T) {
	s, a, _ := testStore(t)
	s.now = func() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }
	cv := upload(t, s, a, "cv-timezone01")
	moments := []string{"2026-03-08T04:59:59Z", "2026-03-08T05:00:00Z", "2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z", "2026-11-01T03:59:59Z", "2026-11-01T04:00:00Z", "2026-11-02T04:59:59Z", "2026-11-02T05:00:00Z", "2026-11-08T04:30:00Z"}
	for _, moment := range moments {
		in := input(cv, ID())
		in.AppliedAt = moment
		if _, err := s.CreateApplication(t.Context(), a, in); err != nil {
			t.Fatal(err)
		}
	}
	for _, day := range []string{"2026-03-08", "2026-11-01"} {
		t.Run(day, func(t *testing.T) {
			f := Filter{From: day, To: day}
			page, err := s.Applications(t.Context(), a, f)
			if err != nil || page.Total != 2 {
				t.Fatalf("NY day selection %+v %v", page, err)
			}
			analysis, err := s.Analyze(t.Context(), a, f)
			if err != nil || analysis.Submitted != 2 || analysis.Timezone != ReportTimezone || len(analysis.Activity) != 1 || analysis.Activity[0].Count != 2 {
				t.Fatalf("DST cohort %+v %v", analysis, err)
			}
		})
	}
	evening, err := s.Applications(t.Context(), a, Filter{From: "2026-11-07", To: "2026-11-07"})
	if err != nil || evening.Total != 1 {
		t.Fatalf("Eastern evening shifted into next UTC day: %+v %v", evening, err)
	}
	gaps, err := s.Analyze(t.Context(), a, Filter{From: "2026-03-07", To: "2026-03-10"})
	if err != nil || len(gaps.Activity) != 4 || gaps.Activity[0].Count != 1 || gaps.Activity[1].Count != 2 || gaps.Activity[2].Count != 1 || gaps.Activity[3].Count != 0 {
		t.Fatalf("calendar zero fill: %+v %v", gaps, err)
	}
}

func TestAnalysisLongHistoryDoesNotDropActivityAndWithdrawalsAreNotReplies(t *testing.T) {
	s, a, _ := testStore(t)
	cv := upload(t, s, a, "cv-long-hist1")
	unused := upload(t, s, a, "cv-unused-001")
	_ = unused
	var last Application
	for day := range 400 {
		in := input(cv, ID())
		in.AppliedAt = time.Date(2020, 1, 1+day, 12, 0, 0, 0, time.UTC).Format(time.RFC3339)
		var err error
		last, err = s.CreateApplication(t.Context(), a, in)
		if err != nil {
			t.Fatal(err)
		}
	}
	analysis, err := s.Analyze(t.Context(), a, Filter{From: "2020-01-01", To: "2021-02-28"})
	if err != nil {
		t.Fatal(err)
	}
	sum := 0
	for _, period := range analysis.Activity {
		sum += period.Count
	}
	if analysis.Submitted != 400 || sum != 400 || analysis.Grain != "week" || len(analysis.Activity) > 64 || len(analysis.CVs) != 2 {
		t.Fatalf("long history total/bins %+v sum=%d", analysis, sum)
	}
	_, err = s.AddResponse(t.Context(), a, ResponseInput{IdempotencyKey: "withdrawn-001", ApplicationID: last.ID, ExpectedRevision: last.Revision, OccurredAt: "2021-02-10T12:00:00Z", Status: "Withdrawn", Summary: "Own withdrawal", Body: "Synthetic owner action"})
	if err != nil {
		t.Fatal(err)
	}
	replied, err := s.Applications(t.Context(), a, Filter{Replied: true})
	if err != nil || replied.Total != 0 {
		t.Fatalf("own withdrawal counted as employer reply: %+v %v", replied, err)
	}
	last, err = s.Application(t.Context(), a, last.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.AddResponse(t.Context(), a, ResponseInput{IdempotencyKey: "late-reply001", ApplicationID: last.ID, ExpectedRevision: last.Revision, OccurredAt: "2021-02-08T12:00:00Z", Status: "Interview", Summary: "Earlier employer reply", Body: "Synthetic employer response"})
	if err != nil {
		t.Fatal(err)
	}
	replied, err = s.Applications(t.Context(), a, Filter{Replied: true})
	if err != nil || replied.Total != 1 || replied.Items[0].Status != "Withdrawn" {
		t.Fatalf("reply drill-down/backfill: %+v %v", replied, err)
	}
}

func TestCompactAnalysisSwitchesGrainWithoutChangingCohort(t *testing.T) {
	s, a, _ := testStore(t)
	cv := upload(t, s, a, "compact-cv01")
	if _, err := s.CreateApplication(t.Context(), a, input(cv, "compact-app1")); err != nil {
		t.Fatal(err)
	}
	daily, err := s.Analyze(t.Context(), a, Filter{From: "2026-01-01", To: "2026-01-30"})
	if err != nil {
		t.Fatal(err)
	}
	compact, err := s.Analyze(t.Context(), a, Filter{From: "2026-01-01", To: "2026-01-30", Compact: true})
	if err != nil || daily.Grain != "day" || compact.Grain != "week" || daily.Submitted != compact.Submitted {
		t.Fatalf("compact grain/cohort: %+v %+v %v", daily, compact, err)
	}
	short, err := s.Analyze(t.Context(), a, Filter{From: "2026-01-01", To: "2026-01-07", Compact: true})
	if err != nil || short.Grain != "day" || len(short.Activity) != 7 {
		t.Fatalf("short compact days: %+v %v", short, err)
	}
}

func TestAnalysisRejectsUnboundedEmptyCalendarRanges(t *testing.T) {
	s, a, _ := testStore(t)
	if _, err := s.Analyze(t.Context(), a, Filter{From: "0001-01-01", To: "9999-12-31"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unbounded report range: %v", err)
	}
}

func TestDeleteDraftOnlyWithRevisionPermissionsAndRetry(t *testing.T) {
	s, a, other := testStore(t)
	cv := upload(t, s, a, "cv-delete-001")
	draft, err := s.CreateApplication(t.Context(), a, ApplicationInput{IdempotencyKey: "draft-delete-01", Title: "Synthetic draft", Company: "Example", Kind: "Internship"})
	if err != nil {
		t.Fatal(err)
	}
	in := DeleteInput{IdempotencyKey: "delete-intent-01", ID: draft.ID, ExpectedRevision: 1}
	if _, err = s.DeleteApplication(t.Context(), Actor{Owner: a.Owner, Scopes: []string{Read}}, in); !errors.Is(err, ErrForbidden) {
		t.Fatalf("read-only delete: %v", err)
	}
	if _, err = s.DeleteApplication(t.Context(), other, in); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner delete: %v", err)
	}
	if _, err = s.DeleteApplication(t.Context(), a, DeleteInput{IdempotencyKey: "delete-stale-01", ID: draft.ID, ExpectedRevision: 2}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision delete: %v", err)
	}
	if _, err = s.DeleteApplication(t.Context(), a, DeleteInput{IdempotencyKey: "delete-badrev-1", ID: draft.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing revision delete: %v", err)
	}
	deleted, err := s.DeleteApplication(t.Context(), a, in)
	if err != nil || !deleted.Deleted || deleted.ID != draft.ID {
		t.Fatalf("delete %+v %v", deleted, err)
	}
	if _, err = s.Application(t.Context(), a, draft.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted draft still readable: %v", err)
	}
	retry, err := s.DeleteApplication(t.Context(), a, in)
	if err != nil || retry != deleted {
		t.Fatalf("retry %+v %v", retry, err)
	}
	if _, err = s.DeleteApplication(t.Context(), a, DeleteInput{IdempotencyKey: "delete-intent-02", ID: draft.ID, ExpectedRevision: 1}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("new intent on deleted draft: %v", err)
	}

	submitted, err := s.CreateApplication(t.Context(), a, input(cv, "submitted-del-01"))
	if err != nil {
		t.Fatal(err)
	}
	withReply, err := s.AddResponse(t.Context(), a, ResponseInput{IdempotencyKey: "reply-delete-01", ApplicationID: submitted.ID, ExpectedRevision: 1, OccurredAt: "2026-01-03T14:00:00Z", Status: "Rejected", Summary: "Synthetic reply", Body: "Synthetic reply body"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DeleteApplication(t.Context(), a, DeleteInput{IdempotencyKey: "delete-submit-1", ID: submitted.ID, ExpectedRevision: withReply.Revision}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("submitted delete: %v", err)
	}
	kept, err := s.Responses(t.Context(), a, submitted.ID)
	if err != nil || len(kept) != 1 {
		t.Fatalf("submitted history changed: %d %v", len(kept), err)
	}
}
