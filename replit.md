# SchoolCircle project constraints

## Keep Next.js

SchoolCircle must remain the original **Next.js** application. Do not replace it
with Vite, migrate it into a separate frontend/API monorepo, or introduce a
parallel application framework unless the user explicitly authorizes that change.

The team is developing the same GitHub repository concurrently. A framework port
creates incompatible work and merge conflicts. Preserve the upstream application
structure and limit Replit compatibility changes to workspace configuration.

Make changes on a feature branch and submit a pull request into `main`.
Do not commit/push directly to `main`, merge, or publish without explicit approval.

## Student dashboard greeting

Keep the student dashboard's top heading as a browser-local, time-based greeting:
Good morning (05:00–11:59), Good afternoon (12:00–16:59), or Good evening
(17:00–04:59). It must update in long-lived tabs and after returning from sleep.
Format it as "Good afternoon, Cpl Rivera": greeting, comma, rank, last name.
Use the signed-in student's profile; omit missing fields rather than invent them.
This is a standing product requirement, not temporary preview copy. Do not
replace it with "Dashboard" during merges or redesigns without an explicit
product request. Keep the sidebar's Dashboard label and instructor UI unchanged.
The focused-dashboard tests in `npm test` protect this contract.

## Self-service profile roles

Users may select Student, Instructor, or Both during onboarding and in Settings.
The owner explicitly approved granting instructor permissions immediately when
Instructor or Both is saved; no approval queue is required. Changing back to
Student removes instructor permissions. Keep authorization tied to the saved
database role, never to an unverified token claim or a client-only view switch.

## Retired manual-course experience

Student and instructor interfaces use the generated-course workflow only. Do not
restore the old manual-course library, reader, teaching-list entries, or editing
links merely because legacy authoring APIs still exist. Stored manual courses
and learner history are retained for compatibility and administrative cleanup;
removing those records requires separate, explicit authorization.

## Student data must be real

Do not restore demo courses or sample learner material in the student interface.
The student experience is not being built on those fixtures. Show actual course,
progress, account, and roster-message data, with truthful empty, loading, error,
or unavailable states when data or a service is absent. Do not fill those states
with sample grades, schedules, training records, messages, or personas.