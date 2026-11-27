# Captures du site (vraies)

Les images de `site/img/v1/` viennent de l'app réelle (interface en anglais), pas de la maquette :

1. Préparer un profil avec de vraies demandes (`xvfb-run -a node …` : Fabro Cloud, photo jointe, projet de démo).
2. `shots-real.js <tmp> <userData> <outDir>` : chat, tâche, lecture, Fabro Code, connecteurs (Electron, ×2).
3. `cu-shot.js <out.png> <url> <statut>` : vraie page + vrai cadre + vraie pastille d'arrêt, superposés.
4. `phone-shot.js <outDir> "<question>"` : Fabro Anywhere (site/dist) avec une vraie question à Fabro Cloud.
5. `upd-shot.js <out.png>` : la page de l'installateur en mode mise à jour.
6. `to-site.js <outDir>` : conversion en webp + `site/src/dims.json`.

Crédits des contenus tiers visibles : voir la page légale (photo CC BY 2.0, carte OpenStreetMap).
