---
name: agent/project-conventions
title: Learning a project's conventions
when: Working in a user's code or document project for the first time
keywords: project, projet, conventions, style, readme, structure, repo, codebase
---

- Read README, package.json / pyproject / requirements, and any CONTRIBUTING or instructions file first.
- Look at 2-3 existing files of the same kind before writing a new one; copy their style.
- Find how to run and test: scripts in package.json, Makefile, tests folder.
- When you discover something non-obvious (a build step, a quirk, where config lives), save it with write_guide (name like `project-<name>`) so next time is quick.
