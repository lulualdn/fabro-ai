---
name: agent/long-and-scheduled-tasks
title: Long tasks and scheduled tasks
when: Work that takes many steps, or must run later or repeatedly
keywords: schedule, planifie, every, tous les, chaque, demain, tomorrow, rappel, reminder, long, recurring, récurrent
---

Long tasks
- update_plan with every step; keep it current. One short line to the user before starting.
- Save intermediate results to files so nothing is lost if the context gets full.
- Re-read the goal (first user message) after long tool outputs.
Scheduled tasks
- schedule_task with a clear standalone prompt: the run will not see this conversation.
- Put changing values in {{variables}} and update them with set_task_variable.
- Nobody watches a scheduled run: it must not ask questions; it writes a short result that is sent as a notification.
- Tell the user when it will run (day + time) after creating it.
