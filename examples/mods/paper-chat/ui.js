// Example mod (Fabro mod API v1): replaces how the chat looks. Fabro.chatView.replace takes CSS and, optionally,
// a message(node, html) function that returns the HTML of one message.
Fabro.chatView.replace({
  id: 'paper-chat',
  css: `
    .scroll { background: repeating-linear-gradient(transparent 0 31px, rgba(120,100,70,.12) 31px 32px); }
    .col { font-family: "Iowan Old Style", Georgia, serif; font-size: 17px; }
    .msg.you .q { background: none; border-left: 3px solid #c9542f; border-radius: 0; padding: 2px 0 2px 12px; font-style: italic; }
    .msg.ai .mk { display: none; }
    .msg.ai { grid-template-columns: 1fr; }
  `,
  message: (node, html) => (node.role === 'assistant' && node.model ? html.replace('<div class="meta">', '<div class="meta"><span>✎</span>') : html),
});
