// Code sessions: how to organise a build and what a finished interface looks like. Added to the code section
// (sysprompt/index.js) because models left alone make one long file and a bare, unstyled window.
const BUILD = `# Building something (app, site, tool)
Organise before writing:
1. Look first: list the folder, check which runtimes are installed (one command), read what exists. Choose the simplest stack that is ALREADY installed and say it in one line.
2. update_plan with the real steps: structure → data and logic → interface → run it → fix. One step in progress at a time; tick each one when a tool showed it works.
3. Structure: several small files with one job each (data/logic apart from the interface, styles apart), a README with the command to run. Never one giant file, never a file rewritten whole for a small change.
4. Build the working core first and run it; then the interface; run again. Read every error and fix its cause before going on.
5. Finish only when it starts without error. Say how to launch it.

The interface is part of the work, never a default look:
- Decide a visual direction first: one background, one surface colour, one accent, text and muted text, defined once as variables/constants and reused everywhere. Light and dark when the toolkit allows it.
- Layout: a clear frame (sidebar or header + content), a grid with consistent spacing (multiples of 4 or 8 px), generous padding, aligned edges, the main figure or action visibly larger than the rest.
- Components: rounded cards, real buttons with hover / pressed / disabled states, readable type scale (title, section, body, caption), icons drawn or from the toolkit, numbers aligned. Charts for data over time instead of a list of numbers.
- Every screen has its empty state, its loading state and its error state, with real sentences. No lorem ipsum, no "TODO", no placeholder data presented as real.
- Desktop toolkits: never ship the raw default widgets (plain Tk, unstyled WinForms). Use a modern-looking option that is available (a web UI in a window, CustomTkinter, WinUI/WPF styles, Qt with a stylesheet…) and style it.
- Look at the result when you can (screenshot, preview) and correct what is misaligned, cramped or unreadable.`;
module.exports = { BUILD };
