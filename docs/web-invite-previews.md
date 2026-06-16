# Web Invite Previews

Use these pages to inspect friend-invite web states without creating or accepting a real invite.

The preview routes are non-production tooling:

- Vite dev server enables them automatically.
- Production-style preview builds require `VITE_ENABLE_DEV_PREVIEWS=true`.
- Do not set `VITE_ENABLE_DEV_PREVIEWS=true` for the deployed production web app.

From `apps/web`:

```sh
npm run dev
```

For a production-style local preview:

```sh
VITE_ENABLE_DEV_PREVIEWS=true npm run build
npm run preview
```

Open the index page:

```text
http://localhost:3000/dev/previews/invite
```

The index links to each state:

- `/dev/previews/invite/loading`
- `/dev/previews/invite/inactive`
- `/dev/previews/invite/error`
- `/dev/previews/invite/signed-out`
- `/dev/previews/invite/ready`
- `/dev/previews/invite/success`
- `/dev/previews/invite/already-friends`

These pages do not call the backend and do not create friendship rows. The real invite route is still `/invite/:token`.

Implementation entry points:

- Production panels: `apps/web/src/screens/invite/FriendInviteScreen.tsx`
- Preview routes: `apps/web/src/dev/previews/invite/FriendInvitePreviewScreen.tsx`
