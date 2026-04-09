import assert from "node:assert/strict";
import test from "node:test";
import loginPage from "./loginPage.js";

const originalAllowedRedirectUris = process.env.ALLOWED_REDIRECT_URIS;

function setAllowedRedirectUris(value: string): void {
  process.env.ALLOWED_REDIRECT_URIS = value;
}

async function readText(response: Response): Promise<string> {
  return await response.text();
}

test.afterEach(() => {
  if (originalAllowedRedirectUris === undefined) {
    delete process.env.ALLOWED_REDIRECT_URIS;
    return;
  }

  process.env.ALLOWED_REDIRECT_URIS = originalAllowedRedirectUris;
});

test("login page uses the explicit locale hint when it is supported", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview&locale=es-MX",
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="es" dir="ltr">/);
  assert.match(html, />Iniciar sesión</);
  assert.match(html, />Volver al sitio web</);
});

test("login page derives the locale from Accept-Language when no locale hint is present", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview",
    {
      headers: {
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
      },
    },
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="es" dir="ltr">/);
  assert.match(html, />Enviar código</);
});

test("login page falls back safely to English for unsupported locale inputs", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview&locale=fr-FR",
    {
      headers: {
        "accept-language": "de-DE,de;q=0.9",
      },
    },
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, />Sign in</);
  assert.match(html, />Back to website</);
});
