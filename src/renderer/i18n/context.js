// Context gauge and compression notes (src/renderer/context-ui.js). English and French.
Object.assign(I18N.en, {
  ctx_usage: 'Context: {used} / {max} tokens ({p} %)', ctx_covered: 'The first {n} messages are summarised (the originals are kept).',
  ctx_grown: 'Window enlarged to {n} tokens for this conversation.', ctx_busy: 'Summarising the beginning…',
  ctx_compressing: 'Summarising the beginning of the conversation…', ctx_doneNow: 'The beginning of the conversation is summarised ({n} messages). Nothing is lost.',
  ctx_grewNow: 'More room for this conversation: {n} tokens.',
});
Object.assign(I18N.fr, {
  ctx_usage: 'Contexte : {used} / {max} tokens ({p} %)', ctx_covered: 'Les {n} premiers messages sont résumés (les originaux sont gardés).',
  ctx_grown: 'Fenêtre agrandie à {n} tokens pour cette conversation.', ctx_busy: 'Résumé du début en cours…',
  ctx_compressing: 'Je résume le début de la conversation…', ctx_doneNow: 'Le début de la conversation est résumé ({n} messages). Rien n’est perdu.',
  ctx_grewNow: 'Plus de place pour cette conversation : {n} tokens.',
});
