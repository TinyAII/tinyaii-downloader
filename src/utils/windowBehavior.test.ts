import { describe, expect, it } from 'vitest';
import {
  shouldMinimizeOnClose,
  shouldMinimizeOnLaunch,
  shouldRestoreWindowOnLaunch,
  shouldResumeTasksOnLaunch,
} from './windowBehavior';

describe('window behavior', () => {
  it('minimizes on close when setting is enabled', () => {
    expect(shouldMinimizeOnClose(true)).toBe(true);
  });

  it('does not minimize on close when setting is disabled', () => {
    expect(shouldMinimizeOnClose(false)).toBe(false);
  });

  it('minimizes on launch only when all startup conditions are met', () => {
    expect(shouldMinimizeOnLaunch({
      startupMinimize: true,
      startupAutoRun: true,
      isAutostartLaunch: true,
    })).toBe(true);
  });

  it('does not minimize on launch when startup source is manual', () => {
    expect(shouldMinimizeOnLaunch({
      startupMinimize: true,
      startupAutoRun: true,
      isAutostartLaunch: false,
    })).toBe(false);
  });

  it('restores window when startup restore is enabled', () => {
    expect(shouldRestoreWindowOnLaunch(true)).toBe(true);
  });

  it('resumes tasks when startup resume is enabled', () => {
    expect(shouldResumeTasksOnLaunch(true)).toBe(true);
  });
});
