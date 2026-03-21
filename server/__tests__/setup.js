/**
 * Test setup — creates an in-memory SQLite database for each test suite.
 *
 * Usage: import { getTestDB, cleanupDB } from './setup.js';
 *
 * The BugReel config and db modules use singletons, so we override them
 * before each test file by setting env vars and re-importing.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Set test environment before any imports from server/
const testDataDir = path.join(os.tmpdir(), `bugreel-test-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = testDataDir;
process.env.DASHBOARD_PASSWORD = 'test-password-123';
process.env.NODE_ENV = 'test';

// Ensure data dir exists
fs.mkdirSync(testDataDir, { recursive: true });

/**
 * Get the test data directory path.
 */
export function getTestDataDir() {
  return testDataDir;
}

/**
 * Cleanup test data directory after tests.
 */
export function cleanupTestData() {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
