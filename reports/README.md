# Reports — what's here and why

- **`HMG_Bot_Validation_Checklist.md`** — carried over unchanged (renamed
  from `WRG_Bot_Validation_Checklist.md`). This is your own checklist to
  run through; nothing in it was auto-updated for the rename, so re-verify
  it against the new HMG commands before relying on it.
- **`CHANGE_LOG.md`** — new. A concise, accurate record of exactly what
  changed in this pass, since the old `LOGIC_FLOW.md` and
  `WRG_Bot_Command_Report.md` described the pre-rename WRG bot in detail
  (pseudocode-level routing, per-command specs) and would now be
  misleading if carried forward as-is rather than rewritten.

**Dropped:** `WRG_Bot_File_Summary.md` — confirmed in the prior session to
be a strict subset of the other two reports, with nothing unique. Still
excluded here for the same reason.

**Not carried forward:** the old `LOGIC_FLOW.md` and
`WRG_Bot_Command_Report.md` themselves. Both describe file/command
behavior that no longer matches the restructured, renamed codebase in
detail (folder layout, prefixes, difficulty model all changed). Keeping
stale pseudocode next to working code is worse than not having it —
`CHANGE_LOG.md` plus the root `README.md` supersede them for this
version. If you want a full line-by-line LOGIC_FLOW-style doc regenerated
for the new structure, say so and it can be built fresh from the new code.
