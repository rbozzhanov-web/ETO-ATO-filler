# OFP / Journey Log filler — release readiness

This checklist is the gate from the current release candidate to a controlled pilot and, later, to a verified production filling tool.

> Приложение предназначено исключительно для заполнения и оформления OFP/Journey Log. Оно не заменяет утверждённые источники полётной информации, OFP, SOP и одобренные приложения авиакомпании.

The application is an electronic filling and formatting tool. Weather, NOTAM and chart views only duplicate information from the loaded package for document navigation; they are not live operational sources or decision aids.

Until every required manual gate below is complete, present the build as a **working prototype / candidate for a controlled pilot**, not as a verified production tool.

## Feature freeze

From the point this hardening branch becomes the release candidate:

- no new features or visual redesigns;
- only fixes for defects found by the gates below;
- every fix stays in a PR and must pass the same automated gates again;
- do not call the application a verified production filling tool while any required gate is unresolved.

## Automated gates

All must be green on the exact commit proposed for the controlled pilot:

- [ ] `Unit and structure tests`
- [ ] `OFP regression gate`
- [ ] `Chromium smoke test`
- [ ] `WebKit iPad-like smoke test`, including the iPhone/iPad viewport matrix

The regression gate includes strict four-digit HHMM input, midnight/time boundaries, the reference OFP catalogue, full-flight workflow, Direct-To, fuel, altimeter cross-check and input-validation cases. Journey Log export must refuse malformed or out-of-range time values.

## Real anonymised document gate

Use multiple real, anonymised source documents representing the variants crews actually receive. Do not commit proprietary OFPs or Journey Logs to the repository.

For each OFP and Journey Log variant, complete the entire cycle:

- [ ] load the original PDF;
- [ ] verify that identity, route/legs, crew and other parsed source values map to the correct fields;
- [ ] enter distinctive test values in every writable field class, including times and fuel;
- [ ] exercise Direct-To and midnight rollover where the source document permits it;
- [ ] background/foreground the app once during entry;
- [ ] save/export the finished PDF;
- [ ] close the app, reopen the same document and confirm saved state is restored correctly;
- [ ] reopen the exported PDF and confirm all expected entries remain present and no original content is lost.

Record the source-document variant, app build, device/iPadOS version and pass/fail result outside the repository if the record contains operationally sensitive information.

## Final PDF acceptance gate

For every representative exported OFP and Journey Log:

- [ ] all written values are in the intended fields and on the intended page;
- [ ] no value is missing, duplicated, shifted into a neighbouring field or clipped;
- [ ] font size and contrast remain readable at normal document zoom;
- [ ] page count and original document content remain intact;
- [ ] the PDF opens without repair warnings in Apple Files / Quick Look;
- [ ] the PDF opens without repair warnings in Adobe Acrobat;
- [ ] the PDF opens correctly in the airline's approved corporate EFB environment;
- [ ] reopening/exporting does not change previously written values.

A viewer-specific failure is a release blocker until its cause is understood and corrected or the affected viewer is formally excluded by the pilot owner.

## iPad / PWA data-survival gate

Run on the actual target iPad in installed Home Screen/PWA mode. After each disruption, verify the **last value entered immediately before the disruption**, not only older saved data.

- [ ] fresh online launch and first cache install;
- [ ] airplane-mode restart after installation;
- [ ] app switch/background → foreground;
- [ ] lock iPad → unlock → return to the PWA;
- [ ] portrait → landscape → portrait while an editable section is active;
- [ ] terminate/relaunch the PWA and restore the open OFP;
- [ ] terminate/relaunch the PWA and restore the open Journey Log;
- [ ] OFP Companion → Journey Log → OFP Companion without losing state;
- [ ] update prompt with an open document does not replace the running version before the user accepts it;
- [ ] after accepting an update, saved document state is still restored;
- [ ] all of the above also work with network connectivity unavailable after installation.

Also verify Next / Previous / Done, the custom keypad, Step 3 positioning after keyboard dismissal, Direct-To/undo, fuel state and altimeter cross-check state in both orientations.

## Shadow-flight gate

Before calling the application a verified working filling tool, run a series of normal flights **in parallel with the currently approved process**. The issued OFP, SOP, approved applications and company procedures remain authoritative throughout the trial.

The acceptance criterion for the filling function is **zero**:

- [ ] zero missed entries;
- [ ] zero entries written to the wrong field or wrong waypoint/leg;
- [ ] zero incorrect HHMM, ETO/ATO or midnight-rollover results;
- [ ] zero Direct-To state corruptions;
- [ ] zero wrong or incorrectly preserved fuel entries;
- [ ] zero lost entries after backgrounding, locking, rotation, relaunch or update;
- [ ] zero exported PDFs whose written values differ from the values shown/entered in the app;
- [ ] zero iPad layout/keypad blockers that prevent normal completion of the document.

Any failure returns the RC to bug-fix mode and restarts the relevant automated, document, iPad and shadow gate after the fix.

## Positioning / presentation gate

Before any presentation or pilot briefing:

- [ ] the UI describes the product as an electronic OFP / Journey Log filling tool;
- [ ] README contains the scope disclaimer above;
- [ ] presentation materials use the same scope and do not describe the app as a replacement for EFB, OFP, SOP or approved sources;
- [ ] weather, NOTAM, chart and other duplicated package data are described only as document-navigation conveniences unless a separately approved operational role is established;
- [ ] the current status is stated accurately: working prototype / controlled-pilot candidate until all manual gates pass.

## Repository gate

Before merge/release:

- [ ] required CI checks protect `main` from a red merge;
- [ ] the stable required checks are `Unit and structure tests`, `OFP regression gate`, `Chromium smoke test`, and `WebKit iPad-like smoke test`;
- [ ] the exact commit proposed for deployment has all four required checks green;
- [ ] no temporary patch/test workflow remains in the release tree.

## Verified-tool decision

The application may be described as a **verified working electronic filling tool** only when:

1. the four automated gates are green on the exact release commit;
2. real anonymised OFP and Journey Log variants have passed the complete load → fill → save/export → reopen cycle;
3. exported PDFs have passed Files, Acrobat and corporate-EFB acceptance;
4. target-iPad/PWA survival testing is complete;
5. shadow flights have completed with zero missed, swapped, incorrect or lost entries;
6. the release candidate remained feature-frozen through that validation.

Until then, keep the release-candidate / controlled-pilot wording and do not present automated CI success as proof of operational approval.
