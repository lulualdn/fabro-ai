// Tool: find_model — the user asks Fabro for a model in plain words, Fabro answers with picks shown as cards (Install button).
// The tool never installs anything: only the user's click on the card starts a download.
const agent = require('./index');
const finder = require('../modelfinder');

agent.register({
  name: finder.TOOL.name, category: 'models', risk: 'read',
  keywords: ['model', 'modèle', 'modele', 'llm', 'gguf', 'ia locale', 'local ai', 'quelle ia', 'which ai', 'hugging'],
  description: finder.TOOL.description, parameters: finder.TOOL.parameters,
  summarize: (a) => String((a && a.need) || '').slice(0, 120),
  run: (a, ctx) => finder.toolRun(a, ctx),
});

module.exports = {};
