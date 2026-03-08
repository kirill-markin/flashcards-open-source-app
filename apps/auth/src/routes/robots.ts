import { Hono } from "hono";

const app = new Hono();

app.get("/robots.txt", (c) => {
  const body = "User-agent: *\nDisallow: /\n";
  return c.body(body, 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

export default app;
