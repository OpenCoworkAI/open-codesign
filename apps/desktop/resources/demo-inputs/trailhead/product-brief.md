# Trailhead / from sketch to connected trip planner

Original fictional demo by Open CoDesign contributors, MIT licensed.
sketch-reference.svg is an authored hand-drawn-style SVG wireframe, not a scan,
photograph, AI-generated screenshot or finished prototype. It is intentionally
low fidelity. If SVG image viewing is unsupported, read the SVG labels and the
complete textual annotations below. No vision capability is required.

## Annotations matching the sketch
1. Trips (left frame): heading, two saved-trip cards, duration and stop count.
   A card opens its itinerary. The first trip is selected in the sketch.
2. Itinerary (middle frame): Back to trips, trip title, date and ordered stop
   rows. Each row has a title and duration. The footer sums duration. Add stop
   opens the editor. A row opens that stop for editing; up/down controls reorder.
3. Stop editor (right frame): label, duration in minutes and a note. Save updates
   the shared itinerary and returns to it. Cancel changes nothing. Delete an
   existing stop returns to the itinerary; adding a stop must not show Delete.

The dashed arrows mean navigation with retained state, not separate unrelated
screens. The bottom scribble means "totals derive from stops".

## Data and behavior
Read trips.json for fictional, non-geographic seed data. Keep trip IDs and stop
IDs stable. Reject blank labels and duration outside 5-480 minutes. Sum stop
durations on both the Trips and Itinerary screens after edit, add or delete.
Empty itineraries invite adding a first stop. Reordering must preserve contents
and never drop a stop. Dates are fixed demo dates, not live availability.

## Visual translation
Turn the loose hierarchy into a polished outdoor editorial interface: warm
paper, strong typography, a restrained green accent, useful white space.
Create workspace DESIGN.md with chosen tokens. Do not paste the sketch image
as the final product or add decorative maps that imply accurate routing.
Mobile uses one screen at a time; desktop can use a list/detail layout.

## Scope and review
Label the app as a local prototype with simulated trip data. No real locations,
routing, weather, bookings, auth, network requests or dependencies to install.
Exercise Trips -> itinerary -> add -> edit -> reorder -> delete -> Trips.
Check totals and back navigation after each mutation.
