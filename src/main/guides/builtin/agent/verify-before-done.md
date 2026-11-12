---
name: verify-before-done
title: Checking your work before saying it is done
when: Before you tell the user something is created, fixed, tested or measured
keywords: verify, check, test, done, fini, vérifier, tester, terminé, résultat
---

Pick the check that matches the claim:
- Created/edited a file → read_file it (or list_dir the folder) and look at the content.
- Wrote code → run it (run_command / run_python). A run that prints an error is not "done".
- Fixed a bug → reproduce the failing case again and show it now passes.
- Measured something → the number must come from a command output. Copy it exactly, with its unit.
- Made a page/document → look at the preview the tool returns; fix every ✗.
- Sent/published → the tool result says it was sent; otherwise say it was not.

If a check is impossible (no tool, no permission), say so plainly: "Not tested: Python is not installed."

A test script must test something real. A script that loops and prints the same fixed score is not a test — never write one, never report its output as results.
