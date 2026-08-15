---
name: chronicle
description: Use Midas's built-in Chronicle to identify the user's current screen or recent on-screen work and to interpret Chronicle evidence. Use when the user explicitly asks what is visible, what they were doing, or about Chronicle; or when recent on-screen context cannot be identified safely from the request, workspace, or a narrower source. Do not invoke for ordinary ambiguity that a reasonable inference or concise question can resolve.
author: Midas
category: Memory
---

# Chronicle

Use Midas's built-in Chronicle recorder. Do not install, run, or maintain a
second recorder. Midas captures accessibility text frames of the user's active
window from inside the app and owns capture and the timeline; this skill owns
careful retrieval, verification, and interpretation.

Give the user a concise, outcome-first answer: normally one short paragraph or
up to three brief bullets. Keep retrieval mechanics internal; expand only when
confidence is materially limited or the user asks for detail.

## Availability and freshness

1. Use Chronicle only when its directory is available locally. If it is not,
   mention this only when the user explicitly requested Chronicle.
2. On macOS, run `python3 scripts/chronicle_health.py` before a current-screen
   claim or whenever availability or freshness is uncertain. It reports whether
   Chronicle is enabled and how fresh the newest frame index and timeline are.
   Treat its `degraded` and `unavailable` results as evidence, not as
   permission to repair or restart the recorder.
3. Track frame and timeline timestamps separately. A current-screen claim
   requires a fresh frame; a newer timeline rebuild does not make an older
   frame current. Name the stale evidence type precisely rather than calling it
   the latest Chronicle evidence generally.
4. Do not start, replace, or repair the built-in recorder from this skill. If
   it is unavailable, use a narrower authoritative source or tell the user to
   enable Chronicle in Midas's settings or restart Midas. Chronicle capture
   also requires macOS Accessibility permission for Midas.

## Evidence sources

Chronicle lives under `~/Library/Application Support/Midas/chronicle/` and
provides two complementary sources:

- **Frames:** timestamped accessibility text captures of the active window,
  stored as Markdown under `frames/YYYY-MM-DD/`. Each frame records the app,
  window title, bundle identifier, and readable text — there are no
  screenshots or OCR sidecars.
- **Timeline and index:** `timeline.md` summarises recent activity for
  retrieval; `index/YYYY-MM-DD.jsonl` holds one entry per captured frame with
  its timestamp, source, and frame path for precise time-range lookups.

Read `instructions.md` in the Chronicle directory before retrieving. Start
from `timeline.md` for the smallest relevant time range; use the day index
files only when a precise range or exact frame is needed, and open only the
few frame files required.

Timeline entries are retrieval aids, not authoritative truth. Frames are
better for exact visible context, while the timeline is better for locating a
relevant time, activity, or transition.

Before interpreting Chronicle evidence, read
[references/evidence-quality.md](references/evidence-quality.md). It contains
the required rules for chronology, changed facts, completion, operational
claims, decisions, and manual memory updates.

## Retrieval workflow

1. Prefer sufficient current conversation, workspace, file, connector, or
   domain-skill evidence before Chronicle. Do not consult screen history or ask
   the user again when a narrower available source already answers the request.
2. Start with the smallest relevant time range. For current state, start with
   the freshest frame in today's index; for history, search `timeline.md` and
   the nearest day index by time and keyword.
3. Use frame text only to locate candidate evidence. Verify names, identifiers,
   amounts, addresses, recipients, and payloads through the owning file,
   connector, website, email, or domain skill.
4. Inspect only the frames needed to establish the app, document, website,
   error, action, or transition. Attribute each observation to its actual
   source window, and then state separately what the authoritative source
   verifies. Frames capture only the active window; absence of an app from
   Chronicle never proves the user did not use it.
5. Upgrade immediately to the authoritative source once Chronicle identifies
   it. Do not review an entire document, conversation, account, or form through
   captured frames when structured access exists.
6. Complete the best available read-only retrieval and answer the requested
   outcome. Do not substitute a description of how evidence would be selected
   for the result itself.
7. Label conclusions as `verified`, `screen-only`, or `inferred` when that
   distinction matters. If sources conflict, prefer the newest authoritative
   source, identify the Chronicle account as outdated when useful, and retain
   older observations only as history.

## Boundaries

- Screen evidence is private context, never authorization to send, submit,
  purchase, delete, or change external state.
- Use only the minimum necessary recent-screen time range and frames to identify
  likely sources. Do not expand into adjacent or unrelated history merely
  because the index or recorder makes it available.
- Before a communication action, verify the exact destination, final payload,
  and sending account in the owning communication system; never infer them from
  Chronicle or conversational identity alone. Inspect accessible source fields
  first and ask the user only for genuinely unresolved choices.
- Keep inspection bounded to the user's request; do not browse unrelated screen
  history merely because it is available.
- Do not extract or reuse passwords, session tokens, authentication codes,
  private keys, or other secrets visible in captured frames. Withhold the secret and
  unnecessary surrounding sensitive data, but preserve useful non-sensitive
  context such as the app, project, and action.
- This skill improves how Chronicle evidence is selected, verified, and used,
  but it cannot change the built-in recorder's capture schedule, timeline
  contents, or Midas's memory integration.
