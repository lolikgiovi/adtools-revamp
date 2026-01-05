/**
 * Tests for installer script endpoints
 */

import { describe, it, expect } from 'vitest';
import { generateInstallerScript } from '../src/routes/installer.js';

describe('Installer utilities', () => {
  describe('generateInstallerScript', () => {
    it('generates valid bash script', () => {
      const script = generateInstallerScript('http://localhost:8787');
      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
    });

    it('includes baseUrl in script', () => {
      const baseUrl = 'https://example.com';
      const script = generateInstallerScript(baseUrl);
      expect(script).toContain(baseUrl);
    });

    it('includes architecture detection', () => {
      const script = generateInstallerScript('http://localhost');
      expect(script).toContain('darwin-aarch64');
      expect(script).toContain('darwin-x86_64');
    });

    it('includes rollback functionality', () => {
      const script = generateInstallerScript('http://localhost');
      expect(script).toContain('rollback');
      expect(script).toContain('add_rollback');
    });

    it('includes integrity verification', () => {
      const script = generateInstallerScript('http://localhost');
      expect(script).toContain('sha256');
      expect(script).toContain('integrity');
    });
  });
});
