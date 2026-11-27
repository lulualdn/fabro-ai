# Fabro Anywhere

Fabro Anywhere est Fabro dans un navigateur : [fabro.ufstudios.eu/app](app/). Il n’a que le chat et l’agent. Tu peux l’installer sur l’écran d’accueil de ton téléphone.

## Qui répond
| Choix | Ce que ça fait |
| --- | --- |
| **Fabro Cloud** (par défaut) | Des modèles libres gratuits, sans compte ni clé. Ils peuvent être saturés aux heures chargées. |
| **Tes clés API** | OpenAI, Anthropic, Gemini, Mistral, OpenRouter, Groq ou tout service compatible OpenAI. La clé reste dans ce navigateur. |
| **Ton PC** | Les modèles installés sur ton ordinateur, et ses propres clés. Tout tourne sur le PC. |

Le choix se fait en touchant le nom du modèle, en haut à droite.

## Où tournent les outils
- **PC relié et allumé** : les outils tournent sur le PC, quel que soit le modèle. Fichiers, terminal, documents, connecteurs : comme dans l’app. Ce qui demande une autorisation sur le PC la demande sur ton téléphone.
- **Sans PC** : seuls les outils du navigateur restent (recherche web, lecture de pages, images, météo). L’IA te dit quand une tâche a besoin du PC.

## Relier ton PC
1. Sur le PC : Fabro → Réglages → Fabro Anywhere → Relier un téléphone.
2. Dans Fabro Anywhere : « Relier ton PC », puis vise le cercle avec la caméra ou tape le code.
3. Les conversations se synchronisent dans les deux sens.

La liaison est chiffrée de bout en bout. Les deux appareils se trouvent via des relais publics (MQTT) qui ne voient que des messages scellés, puis passent en direct (WebRTC) quand c’est possible.

## Fabro Code
Fabro Code travaille sur les fichiers de tes projets : il lui faut l’app de bureau. Le bouton Code de Fabro Anywhere propose le téléchargement pour Windows, macOS ou Linux.
