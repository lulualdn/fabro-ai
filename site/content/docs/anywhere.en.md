# Fabro Anywhere

Fabro Anywhere is Fabro in a browser: [fabro.ufstudios.eu/app](app/). It has the chat and the agent, nothing else. You can add it to your phone’s home screen.

## Who answers
| Choice | What it does |
| --- | --- |
| **Fabro Cloud** (default) | Free open models, no account, no key. They can be busy at peak times. |
| **Your API keys** | OpenAI, Anthropic, Gemini, Mistral, OpenRouter, Groq or any OpenAI-compatible service. The key stays in this browser. |
| **Your PC** | The models installed on your computer, and its own keys. Everything runs on the PC. |

Pick one by tapping the model name at the top right.

## Where tools run
- **PC linked and on**: tools run on the PC, whatever the model. Files, terminal, documents, connectors: as in the app. What would ask for permission on the PC asks on your phone.
- **No PC**: only the browser’s tools remain (web search, reading pages, images, weather). The AI tells you when a task needs the PC.

## Link your PC
1. On the PC: Fabro → Settings → Fabro Anywhere → Link a phone.
2. In Fabro Anywhere: “Link your PC”, then aim the camera at the circle or type the code.
3. Conversations sync both ways.

The link is end-to-end encrypted. Both devices find each other through public relays (MQTT) that only see sealed messages, then switch to a direct connection (WebRTC) when they can.

## Fabro Code
Fabro Code works on your project files, so it needs the desktop app. The Code button in Fabro Anywhere offers the download for Windows, macOS or Linux.
