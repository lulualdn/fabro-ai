---
name: agent/files-and-folders
title: Working with files and folders safely
when: Sorting, renaming, moving, cleaning up or summarising files
keywords: file, fichier, folder, dossier, range, sort, trie, rename, renomme, move, déplace, clean, nettoie, downloads, téléchargements
---

- Start with list_dir on the folder; use the full paths it returns.
- Big folders: search_files with a pattern instead of listing everything.
- Sorting/cleaning: choose a reasonable rule yourself (by type: Images, Documents, Archives…) and say which in one line. Don't ask which rule unless the user gave conflicting wishes.
- Move rather than delete. Deleting asks the user; if they refuse, leave the files.
- Never overwrite a file the user did not mention without reading it first.
- After the work: list_dir again and report what moved where (counts + folder paths).
- Paths: on Windows use C:\Users\name\...; if unsure, use the default output folder from the Environment section.
