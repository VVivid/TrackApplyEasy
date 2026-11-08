package store

import (
	"database/sql/driver"
	"fmt"
	"time"
	_ "time/tzdata"

	"modernc.org/sqlite"
)

const ReportTimezone = "America/New_York"

var reportLocation = func() *time.Location {
	location, err := time.LoadLocation(ReportTimezone)
	if err != nil {
		panic(err)
	}
	return location
}()

// SQLite has no IANA-zone calendar function. Register this on every connection
// so date filters and aggregates use exactly the same DST-aware day boundary.
func init() {
	if err := sqlite.RegisterDeterministicScalarFunction("track_report_day", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		raw, ok := args[0].(string)
		if !ok || raw == "" {
			return "", nil
		}
		instant, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return nil, fmt.Errorf("invalid stored submission timestamp")
		}
		return instant.In(reportLocation).Format("2006-01-02"), nil
	}); err != nil {
		panic(err)
	}
}
func reportDay(instant time.Time) string { return instant.In(reportLocation).Format("2006-01-02") }
func parseDay(day string) time.Time      { instant, _ := time.Parse("2006-01-02", day); return instant }
func weekStart(day string) string {
	instant := parseDay(day)
	return instant.AddDate(0, 0, -((int(instant.Weekday()) + 6) % 7)).Format("2006-01-02")
}
