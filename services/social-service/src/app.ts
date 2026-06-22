import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import type { AccessTokenVerifier } from "./application/ports/access-token-verifier.js";
import {
  createSocialRoutes,
  type SocialUseCases,
} from "./interface/http/routes/social.js";

/**
 * Builds the Elysia app (no `.listen`) so tests can drive it via `app.handle`
 * and the entry point can own the listen call.
 */
export function createApp(
  useCases: SocialUseCases,
  verifier: AccessTokenVerifier,
) {
  return new Elysia({ adapter: node() })
    .get("/health", () => ({ status: "ok", service: "social-service" }))
    .use(createSocialRoutes({ useCases, verifier }));
}
