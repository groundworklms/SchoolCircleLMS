import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
// @ts-expect-error Auth boundary remains a JavaScript integration seam.
import { authBoundary } from "./lib/auth-boundary.js";
// @ts-expect-error OIDC origin policy remains a JavaScript integration seam.
import { corsOrigin } from "./lib/oidc.js";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Credentialed CORS must reflect only configured deployment origins. Never use
// origin:true here: it reflects arbitrary Origin headers and grants them the
// session cookie.
app.use(cors({ credentials: true, origin: corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// This boundary only recognizes identity attached by a verified server-side
// session middleware. It never promotes request headers into a user or role.
app.use(authBoundary);

app.use("/api", router);

export default app;
