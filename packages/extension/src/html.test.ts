import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, createNonce, renderWebviewHtml } from "./html.js";

describe("html", () => {
  it("nonce: 32 random base64 chars, different per load", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{32}$/);
    expect(a).not.toBe(b);
  });

  it("CSP is exactly the global-constraints string", () => {
    expect(contentSecurityPolicy("https://csp.example.com", "NONCE")).toBe(
      "default-src 'none'; script-src 'nonce-NONCE'; style-src https://csp.example.com 'unsafe-inline'; img-src https://csp.example.com data:",
    );
  });

  it("renders the CSP meta, #root, the theme stylesheet and a nonce'd script", () => {
    const html = renderWebviewHtml({
      cspSource: "https://csp.example.com",
      nonce: "abc123",
      styleUri: "https://file.example.com/dist/theme.css",
      scriptUri: "https://file.example.com/dist/dashboard.js",
      title: "EM OS",
    });
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-abc123'; style-src https://csp.example.com 'unsafe-inline'; img-src https://csp.example.com data:">`,
    );
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(
      '<link rel="stylesheet" href="https://file.example.com/dist/theme.css">',
    );
    expect(html).toContain(
      '<script nonce="abc123" src="https://file.example.com/dist/dashboard.js"></script>',
    );
    // Exactly one script tag, and it carries the nonce.
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it("escapes attribute values", () => {
    const html = renderWebviewHtml({
      cspSource: "x",
      nonce: "n",
      styleUri: 'https://e.example.com/a"b&c',
      scriptUri: "https://e.example.com/s.js",
      title: "<T>",
    });
    expect(html).toContain('href="https://e.example.com/a&quot;b&amp;c"');
    expect(html).toContain("<title>&lt;T&gt;</title>");
  });
});
