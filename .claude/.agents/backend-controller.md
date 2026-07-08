
# Backend Controller (ISB / backend-bun)

Thin HTTP layer only — business logic stays in `backend-bun/src/services/`.

## File layout

- Export `export const XController = { ... }` (object, not class).
- File header comment: endpoints, auth requirement, side-effects (email, file I/O, external API).
- Wire routes in `backend-bun/src/routes.ts` only — do not add route files under `src/routes/`.

## Handler signature

```ts
action: async (ctx: Context) => {
  const reqContext = ctx as RequestContext; // or AuthedRequestContext when guarded
  logger.info(`[${reqContext.requestId} (XX-01)] FooController.action() called.`);
  try {
    const data = await someService(...);
    return successResponse(reqContext, data, ResponseStatus.OK);
  } catch (error) {
    logger.error(`[${reqContext.requestId} (XX-01)] FooController.action() error:`, error);
    return errorResponse(reqContext, "English error message", ResponseStatus.INTERNAL_ERROR);
  }
};
```

- Parameter type: `Context` from Elysia, then cast to `RequestContext` / `AuthedRequestContext` from `@/interfaces/ServiceRequest`.
- Do **not** use `HandlerContext`, `ctx: any`, or `@isb/shared` `AuthUser` in controllers.

## Request context types

| Route | Cast to |
|-------|---------|
| Public | `RequestContext` (`requestId`, `body`) |
| JWT guarded | `AuthedRequestContext` extends `RequestContext` + `store.user` |

`requestId` comes from `timerMiddleware` (`backend-bun/src/middleware/TimerMiddleware.ts`).

## Auth (target pattern — migrating)

- JWT payload lives on **`ctx.store.user`** (`AccessTokenPayload`), set by `validateToken` / `requireAuth`.
- Use **`authedCtx(ctx)`** from `@/interfaces/ServiceRequest` → `{ reqContext, user }` where `user === reqContext.store.user`.
- Actor DB lookup: `resolveActorId(reqContext)` / `resolveActor(reqContext)` from `@/utils/ControllerValidatorUtils`.
- Role checks: `hasRole(user.roles, ...)` from `@/middleware/AuthMiddleware`.
- `requireAuth` also derives legacy `ctx.user` during migration — prefer `authedCtx` in new/edited handlers.

## Responses — `ResponseUtil` only

Import from `@/utils/ResponseUtil`. Status codes from `@/constants/ResponseStatus` (not axios `HttpStatusCode`).

| Use | Function |
|-----|----------|
| Success | `successResponse(ctx, body?, status?)` |
| Client/server error | `errorResponse(ctx, message, status, errors?)` |

- API error messages: **English**; shape `{ detail: string }` (optional `errors`).
- Do **not** use `forbidden`, `adminOnly`, `handleServiceError`, or manual `{ detail }` + `set.status` in new/edited handlers — use `errorResponse` instead.

```ts
// Guard example
if (!hasRole(reqContext.store.user.roles, "admin")) {
  logger.warn(`[${reqContext.requestId} (XX-01)] forbidden`, { roles: reqContext.store.user.roles });
  return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
}

// Service error example
} catch (error) {
  const err = error as { status?: number; message?: string };
  if (err.status && err.status >= 400 && err.status < 600) {
    return errorResponse(reqContext, err.message ?? "Bad request", err.status);
  }
  throw error;
}
```

## Logging

- Use `logger` from `@/logger` — never `console.log`.
- Business logs: `` `[${requestId} (OP-CODE)] Controller.method() ...` ``.
- Operation codes: short prefix + sequence per controller (e.g. `AA-01` AdminAudit, `AI-02` AdminImport). Increment per method; document new prefixes in the file header.
- Auth/validation rejections: `logger.warn` + structured context (no passwords/tokens).

## Validation & params

- Route body/query/params: TypeBox schemas in `backend-bun/src/interfaces/routes/*.schema.ts`.
- Path IDs: `parseIntParam(value, label, reqContext.set)` from `@/utils/ControllerValidatorUtils`; on invalid → `errorResponse(..., ResponseStatus.UNPROCESSABLE)`.

## Delegation

```ts
// Controller: HTTP + auth + logging + response envelope
return successResponse(reqContext, await myService({ actorId: resolveActorId(reqContext), ... }));

// Service: throws { status, message } for expected failures
```
