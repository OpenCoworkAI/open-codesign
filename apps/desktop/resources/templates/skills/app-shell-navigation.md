---
schemaVersion: 1
name: app-shell-navigation
description: >
  Connects product navigation, shared records, work areas, and recovery paths.
  Use for app shells or changes that introduce a destination, detail view,
  or new entry point into an existing user journey.
aliases: [app-shell, sidebar, navigation, dashboard-shell, admin-shell, ia]
dependencies: [artifact-composition, responsive-layout, accessibility-states]
validationHints:
  - visible destinations reach implemented content and retain relevant record actions
  - new entry paths preserve shared state and return or recovery paths
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Task-Oriented Shell

Organize navigation around the user's work. Use concrete labels, a clear
active destination, and a visible page title/primary action. Make search,
filters, details, and status information available where the task needs them;
do not add account, notification, KPI, or chart modules just to complete a
standard shell anatomy.

Choose sidebar, tabs, or compact mobile navigation based on available space.
Keep the content hierarchy and selected destination clear as the viewport
changes. Stable widths and feedback should prevent accidental layout jumps.

## Shared Records And Reachable Actions

Keep domain records at the app root or another shared owner, with stable IDs.
Derive lists, details, filters, and counts from the same source. Route/screen
state and selection should refer to those records rather than seed independent
copies on each page.

Trace a new navigation control to its destination, relevant action, and return
path. Real `#section-id` anchors are valid for single-page dashboards.
`href="#"`, an invented route, or a 404 is not an implemented destination.
Omit unavailable destinations or disable them with a reason.

When extending a journey, identify the affected entry points and the actions
already available on the record. Preserve access directly or through a
working detail link, not necessarily duplicate buttons on every screen.

Example: a new My Bookings list with Reschedule must still provide access to
Cancel and booking details/confirmation. Cancellation reached from that list
must change the same booking status and return to a useful view. Testing only
the old confirmation screen misses this regression.

## Focus And Continuity

Back and close actions should restore useful list/filter context. Give newly
displayed screens a meaningful heading and deliberate focus destination.
Dialogs contain focus while open and return it to a sensible control on close.
Keep navigation action names consistent across entry points.

Use existing handlers and components when possible. Batch the smallest
coherent changes and check the new entry path, mutation, dependent view, and
recovery. Do not expand a narrow visual revision into unrelated flow work.
