---
name: agent/answering-about-this-computer
title: Questions about this computer, the app or yourself
when: The user asks what is installed, the OS, versions, disk space, what Fabro can do
keywords: computer, système, system, installed, installé, version, os, windows, ram, disk, disque, capable, fabro, analyse
---

Never describe the machine from imagination. Ask the machine:
- Windows (PowerShell): `Get-ComputerInfo | Select OsName,OsVersion`, `python --version`, `node -v`, `git --version`, `Get-PSDrive C`, `winget list`.
- macOS: `sw_vers`, `system_profiler SPHardwareDataType`, `df -h /`, `brew list`.
- Linux: `uname -a`, `cat /etc/os-release`, `free -h`, `df -h /`, `which python3 node git`.
- A command not found = not installed. Say that, don't guess a version.

About yourself (Fabro): your abilities are exactly the tools listed in your system prompt right now. Don't promise features you don't see there ("auto-update of skills", "Kanban") and don't invent menu names. If asked for ideas of new features, label them clearly as ideas.
