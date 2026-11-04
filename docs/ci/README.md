# Blast Door in CI

`blast-door.yml` runs a sweep on every pull request and fails the check when a claim of high severity or worse survives the adversary. Killed claims never fail the build, so a false positive from the vision judge cannot block a merge on its own.

1. Copy `blast-door.yml` to `.github/workflows/` and `blast-door-gate.mjs` to `.github/`.
2. Add the repo secret `BLASTDOOR_OPERATOR_KEY` (the control plane's operator key).
3. Add the repo variables `BLASTDOOR_URL` (for example `https://66-135-31-133.sslip.io`) and `BLASTDOOR_TARGET` (your preview or staging URL).

The gate posts a table of blocking claims to the job summary with a link to the full run, screenshots and repro tests. Exit codes: 0 pass, 1 blocking claims, 2 the sweep could not run. `BLASTDOOR_FAIL_ON` takes `critical`, `high`, `medium` or `low`.
