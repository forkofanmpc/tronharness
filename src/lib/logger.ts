import pino from "pino";

let rootLogger: pino.Logger | null = null;

export function getLogger(verbose = false): pino.Logger {
  if (!rootLogger) {
    rootLogger = pino({
      level: verbose ? "debug" : "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      },
    });
  } else if (verbose) {
    rootLogger.level = "debug";
  }
  return rootLogger;
}

export function setLogLevel(verbose: boolean): void {
  getLogger(verbose);
}
