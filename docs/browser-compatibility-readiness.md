# Browser compatibility readiness for real-site integration

This guidance is activated by any future task that embeds, integrates, or deploys W-Editor in a real website. It must be reviewed before that work is described as integration-ready.

The first-round standalone editor has blocking Playwright Chromium coverage and compact production-build smoke evidence from the stable system Google Chrome and Microsoft Edge versions recorded in `tests/fixtures/acceptance/system-browser-smoke.json`. That evidence does not imply support for Firefox, WebKit/Safari, iOS, Android, embedded webviews, or an untested accessibility environment.

## Required audience evidence

Before choosing a compatibility matrix, ask for or inspect the best available real-site evidence:

- browser, engine, operating-system, and device analytics, including material long-tail segments;
- desktop/mobile split, important viewport classes, input methods, and geographic or language needs;
- the editor journeys that are business-critical, including import, export, upload, print, clipboard, fullscreen, iframe, and persistence behavior;
- the site's embedding boundary, CSP, sandbox, authentication, storage, offline, and third-party integration constraints;
- applicable accessibility policy, conformance target, assistive-technology usage, and known user accommodations.

If analytics do not exist, record that fact and use an explicit risk-based assumption. Do not silently treat the current Chromium evidence as audience evidence.

## Required matrix decision

Record one decision for every row below. Allowed dispositions are `blocking`, `non-blocking smoke`, `deferred with evidence`, or `not applicable`. Every deferred or not-applicable row needs a rationale; every included row needs the journeys, environments, and evidence location.

| Environment | Decision required before readiness | Minimum questions |
| --- | --- | --- |
| Stable desktop Chrome/Chromium | Yes | Do the production journeys and site embedding constraints still match the standalone baseline? |
| Stable desktop Microsoft Edge | Yes | Are enterprise policies, downloads, clipboard, print, or storage material to the audience? |
| Firefox | Yes | Does audience share or engine diversity require blocking or smoke coverage? |
| Desktop WebKit/Safari | Yes | Do macOS users, WebKit editing behavior, downloads, print, or storage make it blocking? |
| iOS Safari and relevant iOS webviews | Yes | Are touch selection, virtual keyboard/IME, viewport resizing, file flows, and WebKit storage required? |
| Android Chrome and relevant Android webviews | Yes | Are touch selection, virtual keyboard/IME, file flows, downloads, and lifecycle persistence required? |
| Accessibility environments | Yes | Which keyboard-only, zoom/reflow, contrast, reduced-motion, screen-reader, and voice-input combinations are required? |

Accessibility is not satisfied by selecting browsers alone. Name the relevant combinations, such as NVDA with Firefox or Chrome, JAWS with Chrome or Edge, VoiceOver with Safari on macOS/iOS, and TalkBack with Android Chrome, based on audience and policy evidence.

## Decision record

The integration change must record:

1. the evidence date and source;
2. audience assumptions and unknowns;
3. each matrix disposition and rationale;
4. blocking journeys and pass criteria for included environments;
5. devices, operating systems, browser versions, and assistive technologies actually exercised;
6. evidence locations, findings, accepted limitations, and the owner/date for reassessment.

Do not claim real-site integration readiness until this record exists and every blocking environment passes. Expanding the matrix is a decision for the future integration change; it does not retroactively alter the standalone first-round boundary.
