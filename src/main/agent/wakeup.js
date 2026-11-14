// wake_me_when: start a script in the background, end the turn, be called back with its output (wave 3).
// Same guards as run_command (dangerous commands and commands outside the project ask first).
const agent = require('./index');
const files = require('./files');
const shell = require('./shell');
const wakeups = require('../wakeups');

agent.register({
  name: 'wake_me_when', category: 'shell', risk: 'exec', core: false, noMcpWrap: true,
  keywords: ['wait', 'attendre', 'attends', 'deploy', 'déploiement', 'build', 'ci', 'github', 'watch', 'surveille', 'quand', 'when', 'finished', 'terminé', 'fini', 'background', 'arrière-plan'],
  description: `Start a script in the background, then your turn ENDS: you are stopped, and called back automatically with the script's output when it exits. Use it instead of repeated \`wait\` calls for anything long (a deployment, a CI run, a build, a download). Write a command that exits when the condition is met, e.g. a loop that polls every 30 s and exits. Max ${wakeups.MAX_MIN} minutes. Call it last: nothing runs after it in this turn.`,
  parameters: { type: 'object', properties: {
    command: { type: 'string', description: 'Exits when the condition is met; its output is what you get back' },
    cwd: { type: 'string', description: 'Folder to run in' },
    timeout_minutes: { type: 'integer', description: `Default 30, max ${wakeups.MAX_MIN}` },
    then: { type: 'string', description: 'One sentence: what you will do when called back' },
  }, required: ['command'] },
  summarize: (a) => `${a.command}${a.cwd ? `\n📁 ${a.cwd}` : ''}\n⏰ ${Math.min(wakeups.MAX_MIN, Math.max(1, a.timeout_minutes || 30))} min max`,
  guard: (a, ctx) => agent.get('run_command').guard(a, ctx),
  async run(a, ctx) {
    if (!ctx.convId || ctx.subOf || ctx.unattended) return { content: 'wake_me_when needs an open conversation: it is not available to sub-agents or scheduled tasks. Use `wait` instead.', isError: true };
    if (!String(a.command || '').trim()) return { content: 'Give a command.', isError: true };
    const cwd = a.cwd ? files.resolvePath(a.cwd, ctx) : ctx.projectRoot || files.defaultOut();
    require('fs').mkdirSync(cwd, { recursive: true });
    await files.access(cwd, ctx, true);
    const [bin, pre] = shell.shellFor('auto');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !shell.SECRET_ENV.test(k) && !/^ELECTRON_/.test(k)));
    env.FABRO_AGENT = '1'; env.GIT_TERMINAL_PROMPT = '0';
    const j = wakeups.start({ convId: ctx.convId, command: String(a.command), cwd, env, bin, pre, timeoutMin: a.timeout_minutes, note: a.then });
    return {
      content: `Background script started (${j.id}), ${j.timeoutMin} min at most. Your turn ends now: you will be called back with its output when it exits.`,
      view: { kind: 'wakeup', id: j.id, command: j.command, minutes: j.timeoutMin },
      endTurn: true,
    };
  },
});
