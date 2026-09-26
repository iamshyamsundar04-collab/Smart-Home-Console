# Smart Home Console

Build the simulated Alexa+ testbed web app for the Amazon hackathon Alexa+ track. This is a demo-ready interface that simulates the Alexa+ experience backed by a self-hosted MCP server (Streamable HTTP, spec 2025-11-25+).

The app needs:
1. A chat-style Alexa+ assistant interface where the user types conversational requests (e.g., "What's going on around the house?", "Did anyone come to the door while I was out?", "Lock the front door and dim the living room lights", "Remind me to take out the trash at 7pm"). The assistant responds naturally, showing how Alexa+ would converse while calling tools.
2. A live tool call trace viewer showing each MCP JSON-RPC call made under the hood: the method (initialize, tools/list, tools/call), the tool name, arguments, latency, and the raw response payload — so judges can see the MCP protocol working in real time.
3. A device state dashboard showing the current state of household devices (front door lock, lights, thermostat, reminders) that updates when execute_device_action or schedule_family_reminder runs.
4. Mock/deterministic responses for the four tools (get_household_digest, query_security_events, execute_device_action, schedule_family_reminder) built in as a backend fallback, plus a settings field where a real MCP server URL can be set — when provided, the app sends real JSON-RPC 2.0 requests with headers "Accept: application/json, text/event-stream" and "mcp-session-id" session handling to that server instead of using mock data.

Design it like a polished product demo: dark, modern smart-home aesthetic, clear visual separation between the chat pane, the trace viewer, and the device dashboard. Make it look great on a laptop screen for a hackathon demo video.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2dd232f1-8a54-4d9d-ab4b-6c4e34d8a46b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
