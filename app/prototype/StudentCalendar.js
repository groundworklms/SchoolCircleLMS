'use client';

/*
 * The student calendar is intentionally quiet until schedule data is available
 * for the signed-in learner. Keeping an empty state here is safer than showing
 * a course timetable that is not backed by records.
 */
export default function StudentCalendar() {
  return (
    <div className="s-two s-cal-wrap">
      <div>
        <div className="s-pagehead s-cal-head">
          <div>
            <h1>Calendar</h1>
            <p>Your schedule is not available yet.</p>
          </div>
        </div>

        <section className="s-box">
          <h4 className="s-label">Schedule unavailable</h4>
          <p className="s-cal-empty">
            There are no schedule records to display for this account.
          </p>
        </section>
      </div>
    </div>
  );
}