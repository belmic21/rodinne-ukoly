import js from "@eslint/js";
// Skutečný plugin, ne atrapa. Do 13. 10. 2026 tu byla podvržená
// náhrada, která nic nekontrolovala — a díky tomu prošlo nasazení,
// kde byly hooky až za předčasným návratem. Aplikace pak spadla
// na React chybě #310. Tohle to odhalí ještě před odesláním.
import reactHooks from "eslint-plugin-react-hooks";
export default [
  js.configs.recommended,
  { ignores: [] },
  {
    files: ["App.jsx", "src_obchod/**/*.js", "src_obchod/**/*.jsx"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly", console: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", alert: "readonly",
        confirm: "readonly", Notification: "readonly", FileReader: "readonly", Image: "readonly", Blob: "readonly", URL: "readonly", atob: "readonly",
        btoa: "readonly", crypto: "readonly", Intl: "readonly", structuredClone: "readonly", requestAnimationFrame: "readonly",
        AbortController: "readonly", CustomEvent: "readonly", Audio: "readonly", File: "readonly", FormData: "readonly", Headers: "readonly",
        Response: "readonly", Request: "readonly", MutationObserver: "readonly", IntersectionObserver: "readonly",
        ResizeObserver: "readonly", matchMedia: "readonly", performance: "readonly", screen: "readonly", history: "readonly",
        location: "readonly", self: "readonly", caches: "readonly", indexedDB: "readonly", PushManager: "readonly", process: "readonly", prompt: "readonly", URLSearchParams: "readonly", __BUILD_TIME__: "readonly",
      },
    },
    rules: {
      // Tohle je ta kontrola, která chyběla. Hook smí být jen na
      // nejvyšší úrovni komponenty a nikdy za podmínkou ani za
      // předčasným návratem.
      "react-hooks/rules-of-hooks": "error",
      // Závislosti efektů necháváme vypnuté — v tomhle souboru by to
      // vypsalo stovky hlášek a zapadlo by v nich to podstatné.
      "react-hooks/exhaustive-deps": "off",
      "no-undef": "error",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-cond-assign": "off",
      "no-fallthrough": "off",
    },
  },
];
