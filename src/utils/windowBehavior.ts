export function shouldMinimizeOnClose(minimizeToTray: boolean) {
  return minimizeToTray;
}

export function shouldMinimizeOnLaunch(input: {
  startupMinimize: boolean;
  startupAutoRun: boolean;
  isAutostartLaunch: boolean;
}) {
  return input.startupMinimize && input.startupAutoRun && input.isAutostartLaunch;
}

export function shouldRestoreWindowOnLaunch(startupRestore: boolean) {
  return startupRestore;
}

export function shouldResumeTasksOnLaunch(startupResume: boolean) {
  return startupResume;
}
