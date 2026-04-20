import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import zlib from "node:zlib";

EventEmitter.defaultMaxListeners = 50;

import fastifyMiddie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
// @ts-ignore
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
// @ts-ignore
import { build } from "astro";
import Fastify from "fastify";
import INConfig from "./config";
import { ASSET_FOLDERS, generateMaps, getClientScript, type ObfuscationMaps, ROUTES, transformCss, transformHtml, transformJs } from "./src/lib/obfuscate";

let obfuscationMaps: ObfuscationMaps | null = null;

async function Start() {
  const FirstRun = process.env.FIRST === "true";

  if (!fs.existsSync("dist")) {
    console.log("Interstellar's not built yet! Building now...");

    // @ts-ignore
    await build({}).catch((err) => {
      console.error("Build failed:", err);
      process.exit(1);
    });

    if (FirstRun) {
      console.log("Restarting Server...");
      const disable = spawn("pnpm", ["disable"], { stdio: "inherit" });
      disable.on("close", (code) => {
        if (code === 0) {
          const start = spawn("pnpm", ["start"], { stdio: "inherit" });
          start.on("close", () => process.exit(0));
        } else {
          process.exit(code ?? 1);
        }
      });
      return;
    }
  }

  if (INConfig.server?.obfuscate !== false) {
    obfuscationMaps = generateMaps();
  }

  const port = INConfig.server?.port || 8080;

  const app = Fastify({
    serverFactory: (handler) => createServer(handler).on("upgrade", (req, socket: Socket, head) => (req.url?.startsWith("/f") ? wisp.routeRequest(req, socket, head) : socket.destroy())),
  });

  if (INConfig.server?.compress !== false) {
    await app.register(import("@fastify/compress"), {
      encodings: ["br", "gzip", "deflate"],
    });
  }

  if (INConfig.auth?.challenge) {
    await app.register(import("@fastify/basic-auth"), {
      authenticate: true,
      validate(username, password, _req, _reply, done) {
        const users = INConfig.auth?.users || {};
        const storedPass = users[username];

        if (!storedPass) {
          const dummyPass = crypto.randomBytes(32).toString("hex");
          const inputBuf = Buffer.from(password);
          const dummyBuf = Buffer.alloc(inputBuf.length, dummyPass);
          crypto.timingSafeEqual(inputBuf, dummyBuf);
          return done(new Error("Invalid credentials"));
        }

        const inputBuf = Buffer.from(password);
        const storedBuf = Buffer.from(storedPass);

        if (inputBuf.length !== storedBuf.length) {
          const inputHash = crypto.createHash("sha256").update(password).digest();
          const storedHash = crypto.createHash("sha256").update(storedPass).digest();
          if (crypto.timingSafeEqual(inputHash, storedHash)) {
            return done();
          }
          return done(new Error("Invalid credentials"));
        }

        if (crypto.timingSafeEqual(inputBuf, storedBuf)) {
          return done();
        }
        return done(new Error("Invalid credentials"));
      },
    });
    await app.after();
    app.addHook("onRequest", app.basicAuth);
  }

  if (obfuscationMaps) {
    const reverseRoutes = obfuscationMaps.reverseRoutes;
    const reverseAssets = obfuscationMaps.reverseAssets;
    const literalRoutes = new Set<string>(ROUTES);
    const literalAssetFolders = new Set<string>(ASSET_FOLDERS);

    app.addHook("onRequest", (req, reply, done) => {
      if (req.headers) {
        req.headers["accept-encoding"] = "identity";
      }
      const rawHeaders = (req.raw as { headers?: Record<string, string> }).headers;
      if (rawHeaders) {
        rawHeaders["accept-encoding"] = "identity";
      }

      const [urlPath, query] = req.url.split("?");
      const pathParts = urlPath.split("/").filter(Boolean);
      let modified = false;

      if (pathParts.length > 0) {
        const firstPart = pathParts[0];

        if (literalRoutes.has(firstPart)) {
          reply.code(404).send("Not Found");
          return;
        }

        if (firstPart === "assets" && pathParts.length >= 2) {
          const assetFolder = pathParts[1];
          if (literalAssetFolders.has(assetFolder)) {
            reply.code(404).send("Not Found");
            return;
          }
        }

        const realRoute = reverseRoutes[firstPart];
        if (realRoute && realRoute !== "scramjet") {
          pathParts[0] = realRoute;
          modified = true;
        }

        if (pathParts[0] === "assets" && pathParts.length >= 2) {
          const assetFolder = pathParts[1];
          const realFolder = reverseAssets[assetFolder];
          if (realFolder && realFolder !== "scramjet") {
            pathParts[1] = realFolder;
            modified = true;
          }

          if (pathParts.length >= 3) {
            const fileName = pathParts[2];
            const lastDot = fileName.lastIndexOf(".");
            const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
            const ext = lastDot > 0 ? fileName.slice(lastDot) : "";
            const realBaseName = reverseAssets[baseName];
            if (realBaseName) {
              pathParts[2] = realBaseName + ext;
              modified = true;
            }
          }
        }
      }

      if (modified) {
        const newUrl = `/${pathParts.join("/")}${query ? `?${query}` : ""}`;
        (req.raw as { url?: string }).url = newUrl;
        Object.defineProperty(req, "url", {
          value: newUrl,
          writable: true,
          configurable: true,
        });
      }

      done();
    });
  }

  if (obfuscationMaps) {
    const assets = obfuscationMaps.assets;
    const routes = obfuscationMaps.routes;
    const scramjetFolder = assets.scramjet;
    const scramjetRoute = routes.scramjet;
    const sjAll = assets["scramjet.all"];

    app.get("/sw.js", (_req, reply) => {
      const swCode = `importScripts("/assets/${scramjetFolder}/${sjAll}.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const scramjetPrefix = "/${scramjetRoute}/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      await scramjet.loadConfig();
      try {
        const url = new URL(event.request.url);
        if (!url.pathname.startsWith(scramjetPrefix)) {
          return fetch(event.request);
        }
      } catch (_e) {}
      if (scramjet.route(event)) {
        return scramjet.fetch(event);
      }
      return fetch(event.request);
    })()
  );
});
`;
      reply.header("Service-Worker-Allowed", "/").type("application/javascript").send(swCode);
    });

    app.get(`/assets/${scramjetFolder}/*`, (req, reply) => {
      const fileName = req.url.split("/").pop() || "";
      let realFileName = fileName;
      for (const [original, obfuscated] of Object.entries(assets)) {
        if (fileName.startsWith(obfuscated)) {
          const ext = fileName.slice(obfuscated.length);
          realFileName = original + ext;
          break;
        }
      }
      reply.header("Access-Control-Allow-Origin", "*");
      return reply.sendFile(`assets/scramjet/${realFileName}`, path.join(process.cwd(), "dist", "client"));
    });

    // Main Entry Point Logic
    try {
      // @ts-ignore
      const { handler } = (await import("./dist/server/entry.mjs")) as {
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
      };

      app.all("/*", async (req, reply) => {
        await handler(req.raw, reply.raw);
      });
    } catch (e) {
      console.warn("Astro entry point not found. Build is required.");
    }
  }

  app.listen({ port, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  });
}

Start();
