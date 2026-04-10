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
  assert.match(html, /<html lang="es-MX" dir="ltr">/);
  assert.match(html, />Iniciar sesión</);
  assert.match(html, />Volver al sitio web</);
});

test("login page upgrades a legacy Spanish locale hint to the exact supported locale tag", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview&locale=es",
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="es-ES" dir="ltr">/);
  assert.match(html, />Comprobando la sesión\.\.\.</);
});

test("login page derives the locale from weighted Accept-Language entries when no locale hint is present", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview",
    {
      headers: {
        "accept-language": "fr-FR;q=1.0,es-MX;q=0.6,de-DE;q=0.8",
      },
    },
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="de" dir="ltr">/);
  assert.match(html, />Code senden</);
});

test("login page maps supported locale families from Accept-Language to the exact auth locale set", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview",
    {
      headers: {
        "accept-language": "zh-CN,fr-FR;q=0.9",
      },
    },
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="zh-Hans" dir="ltr">/);
  assert.match(html, />发送验证码</);
});

test("login page falls back from an unsupported locale hint to a supported Accept-Language locale", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview&locale=fr-FR",
    {
      headers: {
        "accept-language": "ru-RU,fr-FR;q=0.9",
      },
    },
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="ru" dir="ltr">/);
  assert.match(html, />Отправить код</);
});

test("login page renders Arabic with RTL direction", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview&locale=ar",
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, />إرسال الرمز</);
});

test("login page falls back safely to English when locale inputs are unsupported", async () => {
  setAllowedRedirectUris("https://app.flashcards-open-source-app.com");

  const response = await loginPage.request(
    "https://auth.flashcards-open-source-app.com/login?redirect_uri=https%3A%2F%2Fapp.flashcards-open-source-app.com%2Freview&locale=fr-FR",
    {
      headers: {
        "accept-language": "pt-BR,it-IT;q=0.9",
      },
    },
  );
  const html = await readText(response);

  assert.equal(response.status, 200);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, />Sign in</);
  assert.match(html, />Back to website</);
});
