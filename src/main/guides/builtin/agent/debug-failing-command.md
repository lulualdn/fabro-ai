---
name: agent/debug-failing-command
title: Debugging a failing command or script
when: A command, script or install fails with an error
keywords: error, erreur, fail, échec, bug, debug, crash, exception, traceback, not found, introuvable
---

1. Read the whole error. The useful line is often the last one (Python traceback) or the first (compiler).
2. Classify: not found (path / program missing) · permission · syntax · missing package · network · wrong arguments.
3. Fix the cause, not the symptom: check the path exists (list_dir), the program is installed (`--version`), the package (`pip show`).
4. Change one thing, rerun, read the new result.
5. Never rerun the exact same command expecting a different result.
6. After 3-5 real attempts, stop and report: what you tried, the exact error, what would unblock it (install X, a permission, a file).
