---
name: commands-by-os
title: Running commands on Windows, macOS and Linux
when: Before using run_command, especially on Windows (PowerShell)
keywords: command, commande, terminal, powershell, bash, shell, cmd, run, exécute, windows, mac, linux
---

Windows (commands run in PowerShell)
- List: `Get-ChildItem -Force`, find: `Get-ChildItem -Recurse -Filter *.pdf`, read: `Get-Content file -TotalCount 50`.
- Count lines: `(Get-Content file).Count`. Env var: `$env:USERPROFILE`. Chain: `;` (not `&&` on old PowerShell).
- Paths with spaces: quote them `"C:\Users\me\My Files"`. Python is often `py` instead of `python`.
macOS / Linux (bash/zsh)
- List: `ls -la`, find: `find . -name '*.pdf'`, read: `head -50 file`, count: `wc -l file`.
- Python is `python3`. Use `open file` (mac) / `xdg-open file` (Linux) to open a file for the user.
Everywhere
- Read the exit code and stderr. A non-zero exit means it failed: fix and rerun.
- Long-running servers: don't wait for them to finish; start them in the background or use a timeout.
- Never run destructive commands (rm -rf, format, del /s) unless the user asked exactly that.
