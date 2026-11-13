---
name: agent/git-basics
title: Git basics
when: Working in a git repository: status, commits, branches, diffs
keywords: git, commit, branch, branche, merge, diff, push, pull, repository, dépôt
---

- Look first: `git status`, `git branch --show-current`, `git log --oneline -5`, `git diff`.
- Commit only when the user asks. Message: what changed and why, in one line.
- Never `git push --force`, `git reset --hard` or delete branches unless asked exactly that.
- Conflicts: show the conflicting files (`git diff --name-only --diff-filter=U`), fix them, then `git add` + commit.
- Undo a local change to a file: `git checkout -- file` (ask first if the user may want it).
