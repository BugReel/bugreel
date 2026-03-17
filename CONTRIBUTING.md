# Contributing to BugReel

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/your-org/bugreel.git
   cd bugreel
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Run locally**
   ```bash
   npm run dev
   ```
   The server starts at `http://localhost:3500`. The dashboard is served at the root URL.

## Project Structure

```
server/          Backend (Node.js + Express + SQLite)
dashboard/       Admin dashboard (served as static files)
extension/       Chrome extension (screen recorder)
landing/         Landing page
docs/            Documentation
```

## Adding a New Tracker Integration

BugReel supports pluggable issue tracker integrations. To add a new one:

1. Create `server/trackers/your-tracker.js` exporting a class with:
   - `constructor(config)` — receives `{ url, token, project }`
   - `async createIssue({ title, description, priority })` — creates an issue, returns `{ id, url }`
   - `async testConnection()` — returns `true` if credentials are valid

2. Register your tracker in `server/trackers/index.js`.

3. Add configuration fields to the dashboard UI in `dashboard/`.

4. Update `.env.example` if new environment variables are needed.

5. Add a section to `docs/` describing the setup process for users.

## Code Style

- ES modules (`import`/`export`), not CommonJS
- Use `async`/`await` for asynchronous code
- Keep functions small and focused
- No TypeScript in the server — plain JavaScript for simplicity
- Meaningful variable names, minimal comments (code should be self-explanatory)

## Pull Request Process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes with clear, atomic commits.
3. Test locally — make sure the server starts, the dashboard loads, and existing features still work.
4. Open a PR with a short description of what changed and why.
5. PRs require one approval before merging.

## Reporting Issues

Open a GitHub issue with:
- Steps to reproduce
- Expected vs. actual behavior
- Browser/OS version (for extension issues)
- Server logs if applicable

## License

By contributing, you agree that your contributions will be licensed under the project's BSL (Business Source License).
