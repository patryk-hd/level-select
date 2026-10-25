# Contributing and preparing a release

Use Node.js 22+; no dependency installation is needed. Start with `npm run dev`.
Keep test data synthetic and under `library/sample/` or in temporary test fixtures.
Never attach your real library export or browser backup to an issue or pull request.

Before committing:

```sh
npm run check:share
npm test
python3 -m unittest discover -s tests -p '*_test.py'
npm run build
git diff --check
git diff --cached
```

`check:share` checks tracked and untracked candidate files for known private paths,
common credential-token formats and oversized files. It also catches ignored
personal files that were force-added to Git. It is a guardrail, not an exhaustive
secret scanner. Review changes manually, especially new data files and fixtures.

Public builds must use the authored examples even when personal files are present.
Privacy tests plant synthetic private markers and confirm they are not copied into
the shareable build. Do not weaken that behavior to simplify deployment.

GitHub Actions runs the portable checks with read-only permissions on fresh
checkouts. No personal assets, credentials or exports should be needed. Local
asset integrity is checked separately with `npm run library:verify` after import.

Before making a private repository public, inspect its full history and any
branches/tags for data or credentials, plus issues, attachments, workflow artifacts
and releases. `.gitignore` does not remove previously committed files or history.
If a credential was committed, revoke it and clean the history before publication.
Changing repository visibility does not set a deployed website's access policy.

Push an explicitly selected branch using a normal Git push. Do not use
`git push --mirror`, push `refs/*`, or upload the `.git` directory. Local editor
checkpoint refs (such as `refs/codex/`) can capture ignored or uncommitted private
files; they are not part of normal branch history and must remain local.

Back up ignored imports, artwork and exported browser edits outside Git. Publish
only `dist/` for a demo; `dist-local/` is explicitly personal output.

Original contributions use the MIT license in `LICENSE`. Preserve third-party
notices and artwork credits; the code license does not relicense game artwork or
grant rights to third-party content.
