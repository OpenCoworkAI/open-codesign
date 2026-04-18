import { dirname } from 'node:path';

export interface AppPaths {
  config: string;
  configFolder: string;
  logs: string;
  logsFolder: string;
  data: string;
}

export function buildAppPaths(configFile: string, logFile: string, dataDir: string): AppPaths {
  return {
    config: configFile,
    configFolder: dirname(configFile),
    logs: logFile,
    logsFolder: dirname(logFile),
    data: dataDir,
  };
}
