# Demo video: shot list and voice-over

Target length 2:45 (hard window 2:30 to 3:00). Everything on screen is the live app at `https://66-135-31-133.sslip.io`, recorded at 1920x1080, 60 fps, browser zoom 100 percent, cursor visible. Cuts only. No Ken Burns pans or zooms on stills, no stock footage, no music swells over the voice. The containment moment is 1:15 to 1:55.

## Before recording

- Run one fresh shop sweep from the bay so the run log has a recent run, and note its id.
- Open `/containment` in a second tab. Do not start the drill yet.
- Hide bookmarks and extensions. Use a clean browser profile so no account names or keys appear.
- Have `/api/health` and the GitHub repo open in tabs for the closing shots.

## Shot list

| Time | Shot | On screen | Voice-over |
| --- | --- | --- | --- |
| 0:00-0:10 | 1. Cold open | `/containment` door at 6/6 SEALED, green frame, receipts log scrolling | "This page just tried to hijack an AI agent six different ways. The agent never noticed, and the host never felt it." |
| 0:10-0:25 | 2. Title | The bay at `/`, cursor resting on the target field | "Blast Door is browser QA you can point at any web app. It runs on one Vultr VM, every model call goes through Vultr Serverless Inference, and every browser runs in a throwaway container." |
| 0:25-0:40 | 3. Start a sweep | Type `https://example.com/` or the shop URL, press Sweep, the run page opens with stages ticking | "Give it a URL. A planner writes a QA plan, then a Playwright agent works through it inside a sandbox with no shell, no keys and an egress allowlist." |
| 0:40-1:00 | 4. Findings | Cut to a finished shop run. "What it found" strip: severity tally, 10 candidates, 8 survived, 7 reproduced | "A vision judge grades every screenshot on a fixed rubric. Then an adversary from a different model family argues each claim is not a bug. Here it raised ten, killed two, and seven came back with a failing Playwright test." |
| 1:00-1:15 | 5. One claim | Expand the cart subtotal claim: screenshot, repro steps, adversary argument, repro status. Click a frame to open the lightbox, arrow once | "Every surviving claim has a screenshot, the log line, exact steps and a repro test that ran in a second sandbox. If the adversary wins, the claim dies, and you see why." |
| 1:15-1:25 | 6. Containment start | Switch to `/containment`, press Start drill. Door segments read OPEN | "Now the part that matters if your agent browses the open web. This is a planted hostile site." |
| 1:25-1:45 | 7. The door seals | Segments flip to UNDER ATTACK and slam shut one by one with seal times. Receipts log shows injection ignored, pids cap hit, OOM kill, exfil blocked | "A prompt injection tells the agent to run rm and post its environment. Hidden text tries again. Then an infinite loop, a memory balloon, a fork bomb, and an exfil attempt to an attacker host. Each one gets its own container, hits a cap or the allowlist, and gets destroyed." |
| 1:45-1:55 | 8. Sealed | Door at 6/6, wheel locks, frame turns green. Hold two seconds on the host receipts: canary checksum unchanged, process count stable, attacker sink 0 hits | "Six for six. The host canary file is unchanged and the attacker server got nothing." |
| 1:55-2:10 | 9. Replay | Press Replay 12x and let the door re-seal on recorded timing | "Every drill is replayable from its receipts, so this is evidence, not an animation." |
| 2:10-2:25 | 10. Proof | Repo `proof/2026-11-04T01-11-09-065Z/summary.md` on GitHub, then `/api/health` showing the live commit | "npm run prove runs the whole drill and a sweep and writes a proof pack. The one in the repo came off this VM, and the footer shows which commit is live." |
| 2:25-2:40 | 11. Business | `/why` cost meter, then the CI section | "A full sweep costs between a quarter of a cent and a cent in inference. QA teams wire it into CI, agencies sweep every client site, and agent platforms buy the containment." |
| 2:40-2:48 | 12. Close | `/containment` sealed door, repo URL and live URL on screen as plain text in the page | "Blast Door. Point it at your site. The door holds, and you get the receipts." |

## Timing check

Read the VO aloud at a steady pace before recording. It runs about 2:40. If a shot runs long, trim shot 9 first, then shot 3.

## Do not show

- `/etc/blast-door/env`, any terminal with environment output, or the Vultr dashboard.
- Any browser profile or account name.
