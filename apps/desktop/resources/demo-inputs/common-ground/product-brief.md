# Common Ground / neighborhood workshops

Original fictional demo by Open CoDesign contributors, MIT licensed. No real
venues, hosts or bookings. Use DESIGN.md, logo.svg and poster.svg as references.

## Experience
People want an easy way to try a creative activity nearby without joining a
club. Warm editorial typography and visible practical details matter more than
sales urgency. The poster is an original illustration, not a stock photograph.

## Connected flow
1. Discover: browse schedule.csv; filter by category and available seats.
   Cards show date, duration, price, host and remaining capacity. Poster.svg
   can anchor a featured section but must not replace the workshop list.
2. Details: show the selected session's full information and booking action.
   Sold-out sessions have a clear disabled state.
3. Booking: retain selection; collect name, email and 1-4 seats. Require a
   nonblank name and plausible email, and enforce remaining capacity. Back
   preserves the draft. Show price = seats * pricePerSeat, in USD.
4. Confirmation: label "Simulated reservation - no payment taken", show a local
   reference, session and guest summary. Return to discovery with updated seats.
   Cancelling this reservation restores seats exactly once.

## State and boundaries
Seed one shared in-memory state from the CSV. Disable repeated confirmation
submissions; no double capacity deduction. Do not invent a checkout, charge
money, email tickets, use authentication or request network dependencies.
Include a sold-out state and a no-results filter state. Use explicit September
2026 dates, not relative "tomorrow" copy based on the user's clock.
Review discovery -> details -> invalid form -> confirmation -> cancel, including
back navigation, narrow viewport and keyboard focus. This is a prototype only.
