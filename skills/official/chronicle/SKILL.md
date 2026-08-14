---
name: chronicle
description: Use OpenAI's built-in Chronicle to identify the user's current screen or recent on-screen work and to interpret Chronicle-generated memory. Use when the user explicitly asks what is visible, what they were doing, or about Chronicle; or when recent on-screen context cannot be identified safely from the request, workspace, or a narrower source. Do not invoke for ordinary ambiguity that a reasonable inference or concise question can resolve.
author: Midas
category: Memory
---

# Chronicle

Use OpenAI's built-in Chronicle recorder and generated memory. Do not install,
run, or maintain a second recorder. The host owns capture and summarisation;
this skill owns careful retrieval, verification, and interpretation.

Give the user a concise, outcome-first answer: normally one short paragraph or
up to three brief bullets. Keep retrieval mechanics internal; expand only when
confidence is materially limited or the user asks for detail.

## Availability and freshness

1. Use Chronicle only when Chronicle memory context is available or the
   built-in recorder can be verified locally. If neither is available, mention
   this only when the user explicitly requested Chronicle.
2. On macOS, run `python3 scripts/chronicle_health.py` before a current-screen
   claim or whenever availability or freshness is uncertain. It verifies the
   saved PID belongs to `codex_chronicle` and reports raw-frame and
   generated-summary freshness separately. Treat its `degraded` and
   `unavailable` results as evidence, not as permission to repair or restart
   the recorder.
3. Track raw-frame and generated-summary timestamps separately. A current-screen
   claim requires a running recorder and a fresh frame; a newer summary does not
   make an older frame current. Name the stale evidence type precisely rather
   than calling it the latest Chronicle evidence generally.
4. Do not start, replace, or repair the built-in recorder from this skill. If
   it is unavailable, use a narrower authoritative source or tell the user that
   Chronicle needs to be enabled or ChatGPT restarted.

## Evidence sources

Chronicle provides two complementary sources:

- **Raw screen history:** latest images, timestamped historical frames, capture
  metadata, and OCR sidecars under the temporary recording root. Latest images
  can be overwritten; copy the exact file to a temporary path before inspecting
  it when consistency matters.
- **Generated Chronicle memory:** `instructions.md` and timestamped resources
  under `~/.codex/memories/extensions/chronicle/`. Read `instructions.md`
  before using those resources. Prefer the shortest resource window covering
  the request; use longer summaries only to reconstruct a broader session. A
  longer summary may not exist. For a broad span, run
  `python3 scripts/select_summaries.py --start <ISO-8601> --end <ISO-8601>` and
  read only the selected resources. The helper chooses the minimum
  chronological set, reports coverage gaps, and identifies the nearest
  resources when exact coverage is unavailable. A nearest resource locates a
  boundary but does not fill a reported gap. Consolidate selected summaries by
  underlying task and inspect raw frames only for material uncertainty.

Generated summaries are retrieval aids, not authoritative truth. Raw frames are
better for exact visible context, while summaries are better for locating a
relevant time, activity, or transition.

Before interpreting Chronicle evidence, read
[references/evidence-quality.md](references/evidence-quality.md). It contains
the required rules for chronology, changed facts, completion, operational
claims, decisions, and manual memory updates.

## Retrieval workflow

1. Prefer sufficient current conversation, workspace, file, connector, or
   domain-skill evidence before Chronicle. Do not consult screen history or ask
   the user again when a narrower available source already answers the request.
2. Start with the smallest relevant time range and display. For current state,
   start with the freshest latest frame; for history, search the nearest
   generated summary or OCR sidecar by time and keyword.
3. Use OCR only to locate candidate frames. Verify names, identifiers, amounts,
   addresses, recipients, and payloads visually and then through the owning
   file, connector, website, email, or domain skill.
4. Inspect only the frames needed to establish the app, document, website,
   error, action, or transition. Combine displays by timestamp only when the
   request requires it, attribute each observation to its actual display, and
   then state separately what the authoritative source verifies.
5. Upgrade immediately to the authoritative source once Chronicle identifies
   it. Do not review an entire document, conversation, account, or form through
   screenshots when structured access exists.
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
  because the selector or recorder makes it available.
- Before a communication action, verify the exact destination, final payload,
  and sending account in the owning communication system; never infer them from
  Chronicle or conversational identity alone. Inspect accessible source fields
  first and ask the user only for genuinely unresolved choices.
- Keep inspection bounded to the user's request; do not browse unrelated screen
  history merely because it is available.
- Do not extract or reuse passwords, session tokens, authentication codes,
  private keys, or other secrets visible in recordings. Withhold the secret and
  unnecessary surrounding sensitive data, but preserve useful non-sensitive
  context such as the app, project, and action.
- This skill improves how Chronicle evidence is selected, verified, and used,
  but it cannot change the built-in recorder's capture schedule, generated
  summary contents, or host-level memory integration.
