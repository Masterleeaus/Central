import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfigFile } from './config.mjs';
import { createLauncherHandler } from './app.mjs';

/**
 * Session resolution is the one piece not provided in this app. Until control-api exposes a way to
 * exchange the signed-in browser session for an organisation and access token, the launcher stays
 * signed out. Callers (tests, or a future adapter) pass a real resolveSession.
 */
export const noSessionResolver = async () => null;

export function createLauncherServer({ config, resolveSession = noSessionResolver, fetchImpl, logger }) {
  return createServer(createLauncherHandler({ config, resolveSession, fetchImpl, logger }));
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const configPath = process.env.LAUNCHER_CONFIG ?? fileURLToPath(new URL('../config/launcher.json', import.meta.url));
  const config = loadConfigFile(configPath);
  const port = Number(process.env.PORT ?? 3100);
  const host = process.env.HOST ?? '127.0.0.1';
  const server = createLauncherServer({
    config,
    logger: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  });
  server.listen(port, host, () => console.log(JSON.stringify({ event: 'listening', host, port })));
}
