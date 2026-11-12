---
name: sub-agents
title: Splitting work across sub-agents
when: Big tasks with independent parts (research several topics, several files, several sites)
keywords: subagent, sous-agent, parallel, parallèle, split, delegate, déléguer, plusieurs
---

- Use run_subagent for parts that don't depend on each other; call it several times in the same turn to run them in parallel.
- The sub-agent sees nothing of the conversation: put every detail in `task` — goal, paths, constraints, what to report.
- Ask for a concrete report: "Return: the 3 best options with price and URL", "Return: the path of the file you wrote".
- Check the reports: they can be wrong. Verify key facts or files before relaying.
- Don't delegate tiny steps; one tool call is faster done yourself.
