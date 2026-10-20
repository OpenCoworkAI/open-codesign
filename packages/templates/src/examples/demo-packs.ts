import { DEMO_INPUTS } from '../demo-inputs';
import type { Example } from './index';

const sharedPrompt =
  ' Read every supplied file before designing. These are fictional, original MIT reference inputs, not finished UI. Build an interactive connected prototype in App.jsx using local assets and simulated data only: no backend, authentication, payments, API keys, installs or network calls. Keep a single shared state across screens, visible back navigation, working primary actions, accessible labels, empty and validation states, and responsive mobile/desktop layouts. Preserve the input files. Update workspace DESIGN.md as design choices emerge. Preview and exercise the main flow before finishing; do not describe untested behavior as verified.';

function cover(name: string, motif: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" fill="none"><title>${name} reference pack illustration</title><g stroke="currentColor" stroke-width="2" opacity=".5"><path d="M100 56h140v144H100zM116 80h90m-90 16h65m-65 16h80"/><rect x="245" y="80" width="116" height="104" rx="8"/><path d="${motif}"/></g><text x="118" y="157" fill="currentColor" font-family="sans-serif" font-size="13">INPUT FILES</text></svg>`;
}

export const demoPackExamples: Example[] = [
  {
    id: 'daymark',
    category: 'mobile',
    inputBundle: 'daymark',
    inputFiles: DEMO_INPUTS.daymark.files,
    features: [
      'local-assets',
      'document-input',
      'multi-screen',
      'shared-state',
      'interactive-flow',
      'responsive',
    ],
    thumbnail: cover('Daymark', 'M268 120l12 12 22-25m-34 44h67'),
    prompt:
      'Create Daymark, a calm mobile-first Todo product, from product-brief.md, tasks.json, projects.json, logo.svg and DESIGN.md in this workspace. Connect Today, Projects, project detail and task editor. Completing, adding or editing a task must update every list and progress count consistently. Use the supplied fictional brand tokens and actual SVG logo, not a generic replacement.' +
      sharedPrompt,
  },
  {
    id: 'common-ground',
    category: 'ui',
    inputBundle: 'common-ground',
    inputFiles: DEMO_INPUTS['common-ground'].files,
    features: [
      'local-assets',
      'document-input',
      'multi-screen',
      'shared-state',
      'interactive-flow',
      'responsive',
    ],
    thumbnail: cover(
      'Common Ground',
      'M267 154v-34a20 20 0 0 1 40 0v34m-23 0v-34a20 20 0 0 1 40 0v34',
    ),
    prompt:
      'Create Common Ground, a neighborhood workshop booking prototype, from product-brief.md, schedule.csv, poster.svg, logo.svg and DESIGN.md in this workspace. Connect discovery, workshop details, booking and confirmation. Use the CSV as the source of sessions, capacity and prices; retain selected session and guest details across steps. Validate booking locally, update remaining seats once, allow cancellation, and label every booking as a simulation. Reuse the original poster and logo.' +
      sharedPrompt,
  },
  {
    id: 'trailhead',
    category: 'mobile',
    inputBundle: 'trailhead',
    inputFiles: DEMO_INPUTS.trailhead.files,
    features: [
      'document-input',
      'sketch-reference',
      'multi-screen',
      'shared-state',
      'interactive-flow',
      'responsive',
    ],
    thumbnail: cover('Trailhead', 'M262 157l24-46 22 30 14-20 24 36m-84-57 84 3'),
    prompt:
      'Turn Trailhead, a trip-planner draft, into a connected prototype using sketch-reference.svg, product-brief.md and trips.json in this workspace. The SVG is an original hand-drawn-style low-fidelity sketch reference, not a photograph or finished design. Read its SVG text and the brief annotations even if image viewing is unavailable; view it only if supported. Translate its three numbered frames into Trips, itinerary and stop editor screens rather than copying the sketch as the final UI. Adding, removing, reordering and editing stops must update one shared itinerary and total duration. No real maps, routing or bookings.' +
      sharedPrompt,
  },
];
