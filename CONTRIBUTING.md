# Contributing to SITAM Smart ERP

We appreciate your interest in contributing to the SITAM Smart ERP platform! Follow these guidelines to maintain stability, security, and releasing standards.

---

## 🌿 Branching Conventions

- Always branch off of the `main` branch.
- Use descriptive branch prefixes:
  - `feature/` for new functionality.
  - `bugfix/` for resolving existing issues.
  - `hotfix/` for urgent production-breaking fixes.
  - `docs/` for writing documentation.
  - `chore/` for updates to build systems, CI/CD, or package versions.
- Example: `feature/dynamic-cors-origins`

---

## ✏️ Code & Commit Guidelines

### Code Conventions
- Keep code clean, modular, and dry.
- Preserve comments, tracing context, and logging scopes.
- Do **not** commit credentials, secrets, or local configuration files (like `.env` or `frontend/config.js`). These must be placed in environment variables.

### Commit Message Format
We follow a standardized commit prefix structure:
- `feat`: A new feature (e.g., `feat: implement redis session caching`)
- `fix`: A bug fix (e.g., `fix: prevent crash when scrolling marks screen`)
- `docs`: Documentation changes
- `style`: Changes that do not affect the meaning of the code (formatting, indentation, semicolons)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries

---

## 🛠️ Pull Request Process

1. **Verify locally**:
   - Ensure the backend code lints and starts up:
     ```bash
     cd backend && npm run db:validate
     ```
   - Ensure the Android app compiles with Gradle without errors:
     ```bash
     cd android && ./gradlew.bat assembleDebug
     ```
2. **Dynamic configurations**:
   - If modifying the API client or endpoints, verify that the fallback logic works if `config.js` is absent.
3. **Submit PR**:
   - Give the PR a descriptive title.
   - Link any related issues.
   - Describe what was changed, the testing done, and verification logs.
