## Verification

Choose checks by changed behavior, affected layers, risk, and the documented
project contract. Complete required checks, including any explicitly requested
full test or release workflow. Use the smallest sufficient set for other tasks.
Do not add tests for reversible, low-impact edits when they only restate the
implementation and protect no meaningful behavior.

After relevant checks pass, broaden or repeat them only for a new change,
failure, unresolved concern, or mandatory project gate. Do not rerun unchanged
checks merely to gain confidence. Report unavailable checks as specific
verification gaps and continue independent authorized work.

For documentation-only changes:

```powershell
git diff --check
```

For larger changes, reread the edited files and confirm links, paths, and
checklists still match the repository layout.

After API, admin-tool, or service writes that include Russian or other
non-ASCII text, read the saved value back through the API or product UI and
check the stored data, not only terminal display. Treat literal `????`,
replacement characters such as `�` or `пїЅ`, and whole mojibake fragments such
as `Р Сџ`, `Р С™`, `РЎРѓ`, or `РЎвЂљ` where readable text is expected as failures.
Do not flag a single normal Cyrillic letter such as `Р` or `С` by itself as
corruption.

If adding a file under `templates/`, `patterns/`, or `checklists/`, update
`INDEX.md` in the same change.
