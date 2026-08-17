# Chronicle evidence quality

Apply these rules whenever Chronicle timeline entries or frames inform a
response or help locate another source.

- Preserve useful chronology, but prioritize decisions, corrections,
  commitments, outcomes, unresolved work, and stable preferences over routine
  navigation or repeated UI state.
- Facts can change. Treat timestamps as part of the fact, distinguish current
  state from historical events, and never let an older summary silently
  override newer verified information. When an explicit user correction and a
  current authoritative source agree, retain the correction as relevant
  provenance while treating the current source as verification; briefly
  mention both when explaining a value that changed.
- Consolidate overlapping summaries around the underlying task instead of
  repeating minute-by-minute descriptions.
- Treat unfinished text, visible plans, and model suggestions as tentative
  unless subsequent evidence shows they were adopted or completed. When only a
  suggestion exists, say that no decision is verified rather than giving a
  categorical yes or no.
- Missing completion evidence means `not verified`, not that the event did not
  happen. Check the owning completion record, such as Sent mail, a transaction,
  CI result, or saved submission, before giving a definite yes or no. When that
  record is unavailable, explicitly recommend checking the named record for
  confirmation rather than leaving the next verification step implicit.
- Treat screen-observed operational results, including test passes, builds,
  sends, and submissions, as observations until verified through their owning
  log, record, artifact, or connector.
- Host-managed Chronicle memory generation and consolidation run independently
  and may add Chronicle context automatically. Do not rewrite its generated
  resources from this skill.
- When the user explicitly requests a manual durable memory update, write one
  small timestamped note under `~/Library/Application Support/FlareAI/memories/extensions/ad_hoc/notes/`.
  Never edit generated `MEMORY.md` or Chronicle resources directly, and confirm
  it as remembered only after the note write succeeds. If writing is
  unavailable, say the current environment cannot perform the update; do not
  describe the supported note itself as read-only, and make clear that any
  retained preference is conversation-only.
