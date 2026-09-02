# OFP Companion release readiness

This checklist is the gate from the current release candidate to 1.0. The app is a companion workflow tool; this checklist does not make it an approved or certified operational source and does not replace the issued OFP or company procedures.

## Feature freeze

From the point this hardening PR becomes the release candidate:

- no new features or visual redesigns;
- only fixes for defects found by the gates below;
- every fix stays in a PR and must pass the same automated gates again;
- do not bump to 1.0 while any required gate is unresolved.

## Automated gates

All must be green on the exact commit proposed for release:

- [ ] `Unit and structure tests`
- [ ] `OFP regression gate`
- [ ] `Chromium smoke test`
- [ ] `WebKit iPad-like smoke test`, including the iPhone/iPad viewport matrix

The regression gate includes the reference OFP catalogue, full-flight workflow, midnight/time boundaries, Direct-To, fuel, altimeter cross-check and input-validation cases.

## iPad / PWA manual gate

Run on the actual target iPad in installed Home Screen/PWA mode:

- [ ] fresh online launch and first cache install;
- [ ] airplane-mode restart after installation;
- [ ] load a representative anonymised OFP and verify identity/route details;
- [ ] enter takeoff time, ATO and fuel through the custom keypad;
- [ ] Next / Previous / Done behaviour in portrait and landscape;
- [ ] rotate while entering data and confirm Step 3 remains usable;
- [ ] Direct-To, undo Direct-To and skipped-waypoint presentation;
- [ ] fuel due/overdue state and altimeter cross-check state;
- [ ] background/foreground the PWA and confirm state restoration;
- [ ] save the completed OFP PDF and inspect the written values;
- [ ] open Journey Log, enter data, rotate/zoom and export its PDF;
- [ ] switch OFP Companion → Journey Log → OFP Companion without losing the open-flight state;
- [ ] exercise the update prompt with an open flight and confirm it does not replace the running version under the crew.

## Real-flight RC gate

Before 1.0, use the RC on several normal real flights while continuing to rely on the issued operational documents and procedures as required. For each flight record only whether the companion behaved correctly; do not store proprietary OFPs in the repository.

- [ ] no wrong ETO/ATO-derived result observed;
- [ ] no missed or duplicated fuel-check indication observed;
- [ ] no missed or duplicated altimeter-check indication observed;
- [ ] no Direct-To state corruption observed;
- [ ] no lost entered data after backgrounding/relaunch;
- [ ] exported PDFs match the values entered in the app;
- [ ] no layout/keypad blocker on the target iPad.

Any failure returns the RC to bug-fix mode and restarts the relevant automated and manual gate after the fix.

## Repository gate

Before merge/release:

- [ ] protect `main` against merging when required CI checks are red;
- [ ] require these stable checks: `Unit and structure tests`, `OFP regression gate`, `Chromium smoke test`, `WebKit iPad-like smoke test`;
- [ ] PR #43 remains unmerged until the checks above and the manual gates are accepted.

Task 17 is administrative rather than a code change. The current connected GitHub integration can read that `main` is unprotected but cannot change branch-protection settings, so this box must be completed in GitHub repository settings by an administrator before 1.0.

## 1.0 decision

1.0 is allowed only when:

1. the four automated gates are green on the release commit;
2. `main` protection is enabled;
3. target-iPad/PWA validation is complete;
4. several real-flight RC runs have no unresolved blocker or correctness defect;
5. the RC has remained feature-frozen through that validation.

Until then, keep the version as a release candidate rather than presenting the hardening PR as a final 1.0 release.
