import { apiBase, apiUrl, publicApiOrigin, wsUrl } from "./endpoint";

test("unset API URL keeps paths same-origin", () => {
  expect(apiBase(undefined)).toBe("");
  expect(apiUrl("/api/stats", "")).toBe("/api/stats");
  expect(wsUrl("", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws");
  expect(wsUrl("", { protocol: "https:", host: "jarvis.vercel.app" })).toBe("wss://jarvis.vercel.app/ws");
  expect(publicApiOrigin("", { origin: "http://localhost:5173" })).toBe("http://localhost:5173");
});

test("configured API URL is trimmed and drives every address", () => {
  const base = apiBase(" https://jarvis-api.onrender.com/ ");
  expect(base).toBe("https://jarvis-api.onrender.com");
  expect(apiUrl("/api/stats", base)).toBe("https://jarvis-api.onrender.com/api/stats");
  expect(wsUrl(base)).toBe("wss://jarvis-api.onrender.com/ws");
  expect(wsUrl("http://127.0.0.1:8000")).toBe("ws://127.0.0.1:8000/ws");
  expect(publicApiOrigin(base, { origin: "https://jarvis.vercel.app" })).toBe("https://jarvis-api.onrender.com");
});
