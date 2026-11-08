package store

import (
	"context"
	"database/sql"
	"fmt"
)

// A self-recorded withdrawal is not an employer reply. Each application counts
// at most once, regardless of how many actual employer responses were recorded.
const employerReplySQL = `EXISTS(SELECT 1 FROM responses r WHERE r.owner=a.owner AND r.application_id=a.id AND r.status<>'Withdrawn')`

// Analyze uses New York submission-date cohorts and current statuses. Replies
// received after the selected submission period still belong to that cohort.
func (s *Store) Analyze(ctx context.Context, a Actor, f Filter) (Analysis, error) {
	if err := a.Require(Read); err != nil {
		return Analysis{}, err
	}
	if err := normalizeFilter(&f); err != nil {
		return Analysis{}, err
	}
	out := Analysis{Statuses: []Count{}, Activity: []Count{}, CVs: []CVComparison{}, Timezone: ReportTimezone}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	out.To = f.To
	if out.To == "" {
		out.To = reportDay(s.now())
	}
	out.From = f.From
	if out.From == "" {
		var first sql.NullString
		if err = tx.QueryRowContext(ctx, `SELECT min(track_report_day(applied_at)) FROM applications WHERE owner=? AND applied_at<>'' AND track_report_day(applied_at)<=?`, a.Owner, out.To).Scan(&first); err != nil {
			return out, err
		}
		out.From = first.String
		if out.From == "" {
			out.From = out.To
		}
	}
	span := int(parseDay(out.To).Sub(parseDay(out.From)).Hours() / 24)
	if span < 0 || span > 366*100 {
		return out, fmt.Errorf("%w: analysis ranges must be ordered and at most 100 years", ErrInvalid)
	}
	f.From, f.To = out.From, out.To
	where, args := filterSQL(a, f)
	where += " AND a.applied_at<>''"
	rows, err := tx.QueryContext(ctx, `SELECT a.status,count(*) FROM applications a WHERE `+where+` GROUP BY a.status ORDER BY count(*) DESC,a.status`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var c Count
		if err = rows.Scan(&c.Name, &c.Count); err != nil {
			rows.Close()
			return out, err
		}
		out.Submitted += c.Count
		out.Statuses = append(out.Statuses, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(sum(`+employerReplySQL+`),0),COALESCE(sum(a.status='Interview'),0),COALESCE(sum(a.status='Offer'),0) FROM applications a WHERE `+where, args...).Scan(&out.Responded, &out.Interviews, &out.Offers); err != nil {
		return out, err
	}
	// Aggregate every matching row, then fill calendar gaps. Long ranges use
	// Monday-based weeks rather than discarding history or active dates.
	out.Grain = "day"
	if span > 35 || f.Grain == "week" || (f.Compact && span > 14) {
		out.Grain = "week"
	}
	counts := map[string]int{}
	rows, err = tx.QueryContext(ctx, `SELECT track_report_day(a.applied_at),count(*) FROM applications a WHERE `+where+` GROUP BY track_report_day(a.applied_at)`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var c Count
		if err = rows.Scan(&c.Name, &c.Count); err != nil {
			rows.Close()
			return out, err
		}
		if out.Grain == "week" {
			c.Name = weekStart(c.Name)
		}
		counts[c.Name] += c.Count
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	start, step := out.From, 1
	if out.Grain == "week" {
		start = weekStart(start)
		step = 7
	}
	for day := parseDay(start); day.Format("2006-01-02") <= out.To; day = day.AddDate(0, 0, step) {
		key := day.Format("2006-01-02")
		out.Activity = append(out.Activity, Count{Name: key, Count: counts[key]})
	}
	// Include unused uploaded versions with zero submissions and an undefined
	// reply rate. Filters belong in the join so those CVs survive the left join.
	cvArgs := append(append([]any{}, args...), a.Owner)
	rows, err = tx.QueryContext(ctx, `SELECT c.id,c.name,c.sha256,count(a.id),COALESCE(sum(`+employerReplySQL+`),0),COALESCE(sum(a.status='Interview'),0),COALESCE(sum(a.status='Offer'),0) FROM cvs c LEFT JOIN applications a ON a.cv_id=c.id AND a.owner=c.owner AND `+where+` WHERE c.owner=? GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC LIMIT 1000`, cvArgs...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var c CVComparison
		if err = rows.Scan(&c.CVID, &c.Name, &c.SHA256, &c.Applications, &c.Responses, &c.Interviews, &c.Offers); err != nil {
			rows.Close()
			return out, err
		}
		out.CVs = append(out.CVs, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
