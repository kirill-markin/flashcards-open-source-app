# Web Invite Previews

Use these pages to inspect every friend-invite web state without creating or accepting a real invite. They do not call the backend and do not create friendship rows; the real invite route is `/invite/:token`.

The preview routes are non-production tooling: the Vite dev server enables them, production-style preview builds need `VITE_ENABLE_DEV_PREVIEWS=true`, and the deployed production web app must never set it.

From `apps/web`:

```sh
npm run dev
```

For a production-style local preview:

```sh
VITE_ENABLE_DEV_PREVIEWS=true npm run build
npm run preview
```

Open `http://localhost:3000/dev/previews/invite`; the index links to each state ([preview routes](../apps/web/src/dev/previews/invite/FriendInvitePreviewScreen.tsx), [production panels](../apps/web/src/screens/invite/FriendInviteScreen.tsx)).
