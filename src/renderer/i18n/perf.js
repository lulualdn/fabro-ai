// v0.2 perf: strings for the slow-disk notice and the generation queue.
Object.assign(I18N.en, {
  perf_slowMove: '{model} is on a slow disk ({kind}). Moving it to {lib} makes it start faster.',
  perf_slowSmall: '{model} is on a slow disk ({kind}). {small} ({size} GB) on your internal disk would answer faster.',
  perf_slowSmallRoom: ' Free up {room} GB first.',
  perf_move: 'Move it', perf_get: 'Get it', perf_noThanks: 'No thanks',
  perf_kind_hdd: 'hard drive', perf_kind_usb: 'USB', perf_kind_network: 'network', perf_kind_sd: 'SD card', perf_kind_slow: 'slow',
  perf_unloaded: 'Memory was running low: {model} was unloaded.',
  perf_queued: 'Waiting for the other answer to finish…',
  rt_check: 'Fabro is checking its own work…',
  rt_rate: 'The provider is limiting requests. Trying again in {wait} s ({n}/{of})…', rt_err: 'The provider returned an error. Trying again in {wait} s ({n}/{of})…',
});
Object.assign(I18N.fr, {
  perf_slowMove: '{model} est sur un disque lent ({kind}). Le déplacer sur {lib} le fera démarrer plus vite.',
  perf_slowSmall: '{model} est sur un disque lent ({kind}). {small} ({size} Go) sur ton disque interne répondrait plus vite.',
  perf_slowSmallRoom: ' Libère d’abord {room} Go.',
  perf_move: 'Le déplacer', perf_get: 'Le télécharger', perf_noThanks: 'Non merci',
  perf_kind_hdd: 'disque dur', perf_kind_usb: 'USB', perf_kind_network: 'réseau', perf_kind_sd: 'carte SD', perf_kind_slow: 'lent',
  perf_unloaded: 'La mémoire était presque pleine : {model} a été déchargé.',
  perf_queued: 'J’attends que l’autre réponse se termine…',
  rt_check: 'Fabro relit son travail et cherche l’erreur…',
  rt_rate: 'Le fournisseur limite les requêtes. Nouvel essai dans {wait} s ({n}/{of})…', rt_err: 'Le fournisseur a renvoyé une erreur. Nouvel essai dans {wait} s ({n}/{of})…',
});
