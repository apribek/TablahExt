# 🧩 Tablah AI Chrome Extension

**Enhance your job search with AI-powered insights directly in your browser.** 

The **Tablah AI Extension** brings the full power of the [Tablah](https://github.com/apribek/cv-aution) platform to LinkedIn and Indeed. It automatically analyzes job postings against your career profile, providing real-time "Fit Scores," detailed gap analyses, and one-click job imports.

---

## 🚀 Features

*   **🔍 Auto-Scraping**: Instantly reads job details from LinkedIn and Indeed.
*   **🤖 AI Fit Assessment**: Get a personalized "Fit Score" (0-100%) based on your uploaded experiences.
*   **✨ Interactive Overlay**: View Strengths and Gap Analysis directly on the job page via a sleek, interactive widget.
*   **📥 One-Click Import**: Save jobs to your Tablah dashboard with a single click—no manual copy-pasting required.
*   **🔑 Seamless Authentication**: Automatically synchronizes your login status from the Tablah web application.

---

## 🛠️ Installation

Since this is a developer version, follow these steps to load it into Chrome:

1.  **Download/Clone** this repository to your local machine.
2.  Open **Google Chrome** and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click the **Load unpacked** button.
5.  Select the `TablahExt` folder from this repository.
6.  The **Tablah AI** icon should now appear in your extension toolbar.

---

## ⚙️ Configuration

The extension connects to the Tablah API (default: `http://localhost:8000/api`). Ensure your backend is running for full functionality.

### For Power Users:
You can manually set your authentication token via the extension's console if needed:
```javascript
window.setToken('your-clerk-token-here');
```

---

## 🏗️ Technical Stack

*   **Manifest V3**: Using the latest Chrome Extension standards.
*   **Content Scripts**: Modular scraping and UI injection for job platforms.
*   **Auth Sync**: Real-time synchronization of session tokens between the web app and extension.
*   **Vanilla JS**: Lightweight, high-performance implementation.

---

## 🤝 Contributing

This is an open-source project! If you have suggestions or find bugs:
1. Fork the repo.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---

**Built with ❤️ for better career hunting.**
