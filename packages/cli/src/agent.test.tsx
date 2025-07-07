/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import stripAnsi from 'strip-ansi';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from './agent.js';
import {
  LoadedSettings,
  SettingsFile,
  loadSettings,
} from './config/settings.js';

// Custom error to identify mock process.exit calls
class MockProcessExitError extends Error {
  constructor(readonly code?: string | number | null | undefined) {
    super('PROCESS_EXIT_MOCKED');
    this.name = 'MockProcessExitError';
  }
}

// Mock dependencies
vi.mock('./config/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config/settings.js')>();
  return {
    ...actual,
    loadSettings: vi.fn(),
  };
});

vi.mock('./config/config.js', () => ({
  loadCliConfig: vi.fn().mockResolvedValue({
    config: {
      getSandbox: vi.fn(() => false),
      getQuestion: vi.fn(() => ''),
    },
    modelWasSwitched: false,
    originalModelBeforeSwitch: null,
    finalModel: 'test-model',
  }),
}));

vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn().mockResolvedValue({
    packageJson: { name: 'test-pkg', version: 'test-version' },
    path: '/fake/path/package.json',
  }),
}));

vi.mock('update-notifier', () => ({
  default: vi.fn(() => ({
    notify: vi.fn(),
  })),
}));

vi.mock('./utils/sandbox.js', () => ({
  sandbox_command: vi.fn(() => ''), // Default to no sandbox command
  start_sandbox: vi.fn(() => Promise.resolve()), // Mock as an async function that resolves
}));

describe('agent.tsx main function', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let loadSettingsMock: ReturnType<typeof vi.mocked<typeof loadSettings>>;
  let originalEnvAgentSandbox: string | undefined;
  let originalEnvSandbox: string | undefined;

  const processExitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((code) => {
      throw new MockProcessExitError(code);
    });

  beforeEach(() => {
    loadSettingsMock = vi.mocked(loadSettings);

    // Store and clear sandbox-related env variables to ensure a consistent test environment
    originalEnvAgentSandbox = process.env.AGENT_SANDBOX;
    originalEnvSandbox = process.env.SANDBOX;
    delete process.env.AGENT_SANDBOX;
    delete process.env.SANDBOX;

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env variables
    if (originalEnvAgentSandbox !== undefined) {
      process.env.AGENT_SANDBOX = originalEnvAgentSandbox;
    } else {
      delete process.env.AGENT_SANDBOX;
    }
    if (originalEnvSandbox !== undefined) {
      process.env.SANDBOX = originalEnvSandbox;
    } else {
      delete process.env.SANDBOX;
    }
    vi.restoreAllMocks();
  });

  it('should call process.exit(1) if settings have errors', async () => {
    const settingsError = {
      message: 'Test settings error',
      path: '/test/settings.json',
    };
    const userSettingsFile: SettingsFile = {
      path: '/user/settings.json',
      settings: {},
    };
    const workspaceSettingsFile: SettingsFile = {
      path: '/workspace/.agent/settings.json',
      settings: {},
    };
    const mockLoadedSettings = new LoadedSettings(
      userSettingsFile,
      workspaceSettingsFile,
      [settingsError],
    );

    loadSettingsMock.mockReturnValue(mockLoadedSettings);

    try {
      await main();
      // If main completes without throwing, the test should fail because process.exit was expected
      expect.fail('main function did not exit as expected');
    } catch (error) {
      expect(error).toBeInstanceOf(MockProcessExitError);
      if (error instanceof MockProcessExitError) {
        expect(error.code).toBe(1);
      }
    }

    // Verify console.error was called with the error message
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    expect(stripAnsi(String(consoleErrorSpy.mock.calls[0][0]))).toBe(
      'Error in /test/settings.json: Test settings error',
    );
    expect(stripAnsi(String(consoleErrorSpy.mock.calls[1][0]))).toBe(
      'Please fix /test/settings.json and try again.',
    );

    // Verify process.exit was called (indirectly, via the thrown error)
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
