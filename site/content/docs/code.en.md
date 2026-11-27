# Fabro Code

Fabro Code is the mode for programming. It reads your project, edits files, runs tests and the command line, and keeps restore points.

## In the app
Open **Fabro Code** in the sidebar and pick a folder. Each change shows as a diff you can keep or undo.

## In the terminal
The installer adds the `fabro` command. In a project folder:

```
fabro code
```

It’s the same interface in text mode, with the same engine, sessions and permissions as the app. The mascot shows in ANSI colors, or without color if your terminal has none.

## Permissions
Reading the project’s files asks nothing. Writing and running commands ask the first time, per project.
