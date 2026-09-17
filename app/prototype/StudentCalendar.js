'use client';

/* Quiet until schedule data exists for the signed-in learner. */
export default function StudentCalendar() {
  return (
    <div className="s-two s-cal-wrap">
      <div>
        <div className="s-pagehead s-cal-head">
          <div>
            <h1>Calendar</h1>
          </div>
        </div>

        <section className="s-box">
          <h4 className="s-label">Schedule unavailable</h4>
          <p className="s-cal-empty">No schedule records yet.</p>
        </section>
      </div>
    </div>
  );
}