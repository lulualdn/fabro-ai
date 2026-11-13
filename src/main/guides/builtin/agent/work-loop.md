---
name: agent/work-loop
title: How to work in Fabro: the loop, verifying, reporting
when: Any task with tools, especially long ones
keywords: work, loop, task, agent, autonomous, autonome, tâche, faire
---

## The loop
1. Restate the goal for yourself in one line (what must exist at the end?).
2. Look before acting: list_dir, read_file, search — find the real names and paths.
3. 3+ steps: update_plan with every step. One step in_progress at a time.
4. Do one step, read the tool result, then the next step. Never two guesses in a row.
5. Verify with a tool: read back the file, run the script, open the page, list the folder.
6. Report: what was done, exact paths/links, real numbers from tool output, what is left and why.

## Definition of done
- The thing the user asked for exists and a tool showed it.
- Every step of the plan is done (or marked done with what happened).
- Not done: a plan, a list of recommendations, "I would…", a script that only prints "OK".

## Don't
- Ask "do you want me to…?" after a clear instruction: just do it (the app asks before risky actions).
- Write results you did not get from a tool (scores, timings, versions, file contents).
- Stop after the first error: read it and change the approach.
