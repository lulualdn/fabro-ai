# Petit modèle : avant / après (13 nov. 2026)

`scripts/small-model-eval.js`, Gemma 4 E4B Q4_K_M, llama.cpp sur processeur seul (4 fils, fenêtre 16 384),
température 0,3, **un seul passage par scénario**.
- avant = `main` (v0.1.56)
- après = `v0.2` au commit `01f9111` (après la fusion des skills, **avant** modèles, thèmes, réglages et contexte)

| Scénario | avant | après |
|---|---|---|
| count_lines | ✓ | ✓ |
| create_file | ✓ | ✓ |
| multi_step | ✓ | ✓ |
| number_from_tool | ✓ | ✓ |
| sort_no_question | ✓ | ✗ (5 fichiers non rangés) |
| recover_error | ✗ (pose une question) | ✗ |
| no_fabrication | ✗ (réponse vide, 8 outils, 468 s) | ✗ (réponse vide, 4 outils, 204 s) |
| evidence_scores | ✓ | ✓ |
| system_fact | ✓ | ✓ |
| all_steps | ✓ | ✓ |
| autonomy_pref | ✓ | ✓ |
| plan_then_do | ✓ | ✓ |
| **Total** | **10/12** | **9/12** |

## Ce qu'on peut en dire
- Aucun gain mesuré. Le prompt système v0.2 ne rend pas Gemma 4 E4B plus fiable sur ces scénarios.
- L'écart d'un scénario (`sort_no_question`) ne prouve pas une régression : un seul passage à 0,3 de température,
  c'est du bruit. Il faudrait 5 passages par scénario pour conclure.
- Les deux échecs communs sont les vrais points faibles : après une erreur d'outil le modèle s'arrête ou demande
  (`recover_error`), et il finit sans message quand il n'a pas les chiffres (`no_fabrication`).
- Le « après » ne contient pas le gestionnaire de contexte : son effet sur un petit modèle n'est pas mesuré.
- Non mesuré non plus : GPU, Windows, d'autres petits modèles.

Transcriptions : `/tmp/small-model-eval/{baseline,after}` sur la machine de la session (non gardées).
