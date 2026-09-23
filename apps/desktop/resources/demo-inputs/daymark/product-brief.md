# Daymark / product brief

Original fictional demo by Open CoDesign contributors. MIT licensed.

## People and promise
Mira is a freelance illustrator juggling client work and daily life. Daymark helps
her choose a few important tasks without a gamified productivity score.
Use the supplied logo.svg and DESIGN.md. All tasks and people are fictional.

## Connected screens
1. Today: show tasks for the fixed demo date 2026-09-17, with project labels.
   Include overdue tasks, a completion toggle and an Add task action.
2. Projects: list projects.json with progress derived from tasks.json, not
   separate hard-coded counters. A card opens that project's task list.
3. Project detail: filter tasks by projectId; support completed-task visibility.
4. Task editor: edit title, project, due date and notes. Save returns to the
   originating list. Cancel discards edits. Reject an empty title.

## Data and interactions
Read the JSON files as seed data, then keep shared in-memory state. A change in
Today must be reflected in Projects and detail. New tasks receive a stable ID.
Show a useful empty state after the last task is completed. Allow undoing
completion through the same control; avoid notifications with no state change.
Do not modify the seed files during normal prototype use.

## Boundaries and review
This is a simulated local prototype, not a synced task service. No login,
backend, telemetry, external fonts, APIs or installation. Use a narrow phone
layout on mobile and a useful two-pane list/detail arrangement on wider screens.
Check add -> project detail -> complete -> Today, and verify the counts agree.
