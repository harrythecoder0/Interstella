import { execFileSync } from "node:child_process";
import path from "node:path";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
// @ts-ignore
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
// @ts-ignore
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import compress from "@playform/compress";
import { defineConfig } from "astro/config";
import { viteStaticCopy } from "vite-plugin-static-copy";
import INConfig from "./config";

const integrations = [react(), tailwind({ applyBaseStyles: false })];

if (INConfig.server?.compress !== false) {
  integrations.push(
    compress({
      CSS: false,
      HTML: true,
      Image: false,
      JavaScript: true,
      SVG: true,
      Logger: 0,
    }),
  );
}

export default defineConfig({
  output: "server",
  adapter: node({
    mode: "middleware",
  }),
  integrations,
  prefetch: {
    defaultStrategy: "viewport",
    prefetchAll: false,
  },
  image: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/UseInterstellar/**",
      },
    ],
  },
  vite: {
    logLevel: "warn",
    define: {
      __COMMIT_DATE__: JSON.stringify(
        (() => {
          try {
            return execFileSync("git", ["show", "--no-patch", "--format=%ci"])
              .toString()
              .trim()
              .replace(/[<>"'&]/g, "");
          } catch {
            return new Date().toISOString();
          }
        })(),
      ),
    },
    resolve: {
      alias: {
        "@": path.resolve("./src"),
      },
    },
    plugins: [
      {
        name: "vite-wisp-server",
        configureServer(server) {
          server.httpServer?.on("upgrade", (req, socket, head) => 
            (req.url?.startsWith("/f") ? wisp.routeRequest(req, socket, head) : undefined)
          );
        },
      }, // <-- Fixed: Added missing closing brace and comma
      // @ts-ignore
      viteStaticCopy({
        targets: [
          {,{
            src: `${epoxyPath()}/**/*.mjs`.replace(/\\/g, "/"), // Fixed: epoxyPath() is a function
            dest: "assets/bundled",
            overwrite: false,
            rename: (name) => `ex-${name}.mjs`,
          },
          {
            src: `${baremuxPath()}/**/*.js`.replace(/\\/g, "/"), // Fixed: baremuxPath() is a function
            dest: "assets/bundled",
            overwrite: false,
            rename: (name) => `bm-${name}.js`,
          },
        ],
      }),
    ],
  },
});

  
