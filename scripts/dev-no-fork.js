/* eslint-disable no-console */
const path = require("path");
const loadConfig = require("next/dist/server/config").default;
const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");
const { setGlobal } = require("next/dist/trace/shared");
const { startServer } = require("next/dist/server/lib/start-server");

async function main() {
  const dir = process.cwd();
  const port = Number(process.env.PORT || 3000);
  const hostname = process.env.HOSTNAME || undefined;
  const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, dir, { silent: false });
  const distDir = path.join(dir, config.distDir || ".next");

  setGlobal("phase", PHASE_DEVELOPMENT_SERVER);
  setGlobal("distDir", distDir);

  await startServer({
    dir,
    port,
    allowRetry: true,
    isDev: true,
    hostname
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
