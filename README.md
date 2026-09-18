# Immpal Chrome Extension

> **Automated, validated form-filling for Canadian immigration portals (IRCC, Express Entry, PR Portal).**

The **Immpal Extension** is a Manifest V3 browser extension built with React 19, TypeScript, Material-UI, and Vite (via `@crxjs/vite-plugin`). It connects directly to the Immpal platform to automatically populate government immigration application forms using validated applicant profiles and case data.

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
  - [1. Installation](#1-installation)
  - [2. Environment Configuration](#2-environment-configuration)
  - [3. Development Mode](#3-development-mode)
  - [4. Production Build](#4-production-build)
- [Loading Extension in Chrome](#-loading-the-extension-in-chrome)
- [How It Works](#-how-it-works)
  - [1. Authentication Flow](#1-authentication-flow)
  - [2. Case Selection & Fetching](#2-case-selection--fetching)
  - [3. Form Autofill Injection](#3-form-autofill-injection)
- [Available Scripts](#-available-scripts)
- [Permissions & Supported Portals](#-permissions--supported-portals)
- [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## 🌟 Overview

Filling out government immigration portals can be repetitive, time-consuming, and error-prone. The **Immpal Extension** bridges the gap between your verified client case files stored on the Immpal platform and government immigration forms (such as IRCC / Canada.ca portals), enabling single-click data population with reactive change event handling.

---

## 🚀 Key Features

- **Seamless Web App Authentication:** Single-click authentication handover from the Immpal web app via window messaging and token synchronization.
- **Silent Token Refresh:** Built-in API interceptor automatically refreshes expired JWT tokens without interrupting the user workflow.
- **Ready Case Selection:** Fetches and displays cases that have completed documentation and are marked ready for submission.
- **Native DOM & React-Aware Autofill:** Dispatches native property setters and standard DOM events (`input`, `change`, `blur`) so modern frontend frameworks detect and persist auto-filled data.
- **Manifest V3 Compliant:** Built to modern Chrome Extension standards using service workers and secure content scripts.
- **Modern Developer Experience:** Fast HMR and bundle compilation powered by Vite 8 and CRXJS.

---

## 🛠 Architecture & Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **UI Components** | [Material UI (MUI v9)](https://mui.com/) & [Emotion](https://emotion.sh/) |
| **Build Tooling** | [Vite 8](https://vitejs.dev/) with [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin) |
| **Linter** | [Oxlint](https://oxc.rs/docs/guide/usage/linter) |
| **Extension Standard** | Chrome Extensions Manifest V3 |

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                       Immpal Platform                       │
│             (Backend API & Web Dashboard)                   │
└──────────────┬───────────────────────────────▲──────────────┘
               │ Broadcasts Token              │ API Requests
               ▼                               │ (with auto-refresh)
┌───────────────────────────────┐     ┌────────┴──────────────┐
│        Content Script         │     │     Popup UI &        │
│   - Intercepts Auth Token     │◄────┤  Background Worker    │
│   - Injects case data to DOM  │     │ - Case Selector       │
│   - Dispatches native events  │     │ - Storage Management  │
└───────────────────────────────┘     └───────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Government Portal Webpage                   │
│             (IRCC / cic.gc.ca / canada.ca)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
immpal-extension/
├── manifest.json              # Extension Manifest V3 configuration
├── index.html                 # Extension popup HTML entry point
├── vite.config.ts             # Vite configuration with CRXJS plugin
├── tsconfig.json              # TypeScript root configuration
├── .oxlintrc.json             # Oxlint configuration
├── .env                       # Environment variables (API base URL)
├── public/                    # Static assets & extension icons
│   ├── favicon.svg
│   ├── icons.svg
│   └── icons/                 # 16x16, 48x48, 128x128 extension icons
└── src/
    ├── main.tsx               # Popup React root mounting point
    ├── index.css              # Popup window dimensions & global reset
    ├── App.tsx                # Standalone demo / template component
    ├── App.css
    ├── popup/
    │   ├── Popup.tsx          # Main popup view (Auth state, Stepper, Actions)
    │   └── CaseSelector.tsx   # Dropdown selector for ready application cases
    ├── background/
    │   └── background.ts      # Service worker (auth orchestration, API relay)
    ├── contentScript/
    │   └── content.ts         # Injected script (web-app auth listener & DOM autofill)
    └── utils/
        └── api.ts             # Authenticated fetch wrapper with token refresh
```

---

## 📋 Prerequisites

Before running or building the extension, ensure you have:

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **Package Manager**: `npm` (v9+) or `pnpm`
- **Browser**: Google Chrome, Brave, Microsoft Edge, or any Chromium-based browser supporting Manifest V3

---

## 🏁 Getting Started

### 1. Installation

Clone the repository and install dependencies:

```bash
# Clone the repository
git clone <repository-url>
cd immpal-extension

# Install dependencies
npm install
```

### 2. Environment Configuration

The extension uses `.env` to configure the API backend URL:

```env
# .env
VITE_API_URL=http://localhost:8000/
```

> **Note:** For production or staging deployments, point `VITE_API_URL` to your live Immpal backend API (e.g. `https://api.immpal.com/`).

### 3. Development Mode

Start the Vite development server with Hot Module Replacement (HMR) and file watcher:

```bash
npm run dev
```

This compiles the extension into the `dist/` folder and watches for code changes automatically.

### 4. Production Build

Create an optimized, minified production build:

```bash
npm run build
```

The output bundle will be generated in the `dist/` directory.

---

## 🔌 Loading the Extension in Chrome

To test or use the extension in your browser:

1. Open Google Chrome (or any Chromium browser).
2. Navigate to `chrome://extensions/` in the address bar.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click the **Load unpacked** button in the top-left.
5. Select the **`dist`** directory inside the `immpal-extension` project folder.
6. The **Immpal** extension icon will now appear in your browser toolbar. Pin it for easy access.

> 💡 **Tip:** When running `npm run dev`, changes to popup UI and styles update with HMR. For changes to `manifest.json`, background service worker, or content script permissions, click the **Reload (🔄)** button on the extension card in `chrome://extensions/`.

---

## ⚙️ How It Works

### 1. Authentication Flow
1. User clicks **"Login to Immpal"** in the extension popup.
2. Background script opens the Immpal web application at `/#/extension-auth`.
3. The web app broadcasts the user's JWT access and refresh tokens via `window.postMessage`.
4. The injected content script intercepts the message and forwards tokens to the background service worker.
5. Tokens are saved securely in `chrome.storage.local` (`immpalAuthToken` and `immpalRefreshToken`).

### 2. Case Selection & Fetching
1. Once authenticated, the popup calls `GET /cases/options?package_ready_only=true` through `fetchWithAuth`.
2. Ready cases are presented in a dropdown menu. If only one case exists, it is automatically selected.
3. If an API call receives a `401 Unauthorized`, `api.ts` automatically attempts a token refresh at `POST /users/refresh-token` and transparently retries the request.

### 3. Form Autofill Injection
1. User navigates to a supported IRCC application portal page.
2. User selects their case in the Immpal extension popup and clicks **"Start Auto-fill"**.
3. The popup sends an `AUTOFILL_FORM` message to the active tab's content script.
4. The content script requests full applicant details from the background worker (`FETCH_CASE_DETAILS`).
5. The content script maps applicant data (e.g., First Name, Last Name, Email, Date of Birth, Country of Residence) to form inputs using native prototype value setters and dispatches `input`, `change`, and `blur` events so reactive web forms register the inputs.

---

## 📜 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs TypeScript check and starts Vite in watch/build mode for local development |
| `npm run build` | Compiles TypeScript and builds production assets into `dist/` |
| `npm run lint` | Runs [Oxlint](https://oxc.rs/) for high-performance static code analysis |
| `npm run preview` | Starts a local Vite preview server |

---

## 🔒 Permissions & Supported Portals

### Permissions (`manifest.json`)

- `storage`: Persisting auth tokens and user preferences locally.
- `activeTab`: Interacting with the currently active browser tab upon user action.
- `scripting`: Executing content scripts on supported portal pages.

### Host Permissions

- `http://localhost:*/*` (Local development)
- `https://*.immpal.com/*` (Immpal web applications)
- `https://*.cic.gc.ca/*` (Immigration, Refugees and Citizenship Canada)
- `https://*.canada.ca/*` (Government of Canada portals)

---

## ❓ Troubleshooting & FAQ

<details>
<summary><b>1. "Could not connect to webpage. Are you on a supported site?" error</b></summary>
<br>

- Ensure you are on a webpage matching one of the host permissions (`*.cic.gc.ca`, `*.canada.ca`, `*.immpal.com`, or `localhost`).
- Refresh the webpage after loading or updating the extension so the content script is properly injected.
</details>

<details>
<summary><b>2. Extension is not updating after code changes</b></summary>
<br>

- Go to `chrome://extensions/` and click the **Reload (🔄)** icon on the Immpal extension card.
- If you modified `manifest.json` or background scripts, close and re-open the extension popup.
</details>

<details>
<summary><b>3. Session expired or authentication issues</b></summary>
<br>

- Click the **Sign Out** icon in the top right of the popup and log in again.
- Verify that your backend server URL in `.env` (`VITE_API_URL`) is running and reachable.
</details>

---

## 📄 License

Internal Proprietary - All rights reserved. © **Immpal**.
