## Verification

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
