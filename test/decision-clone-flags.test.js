import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { exercise } from './helpers/decision-flags-scenario.js';

/** Step 4: flagged clones are visible, filterable and explained; a splice result is imported only for its own request. */
test('the clone table flags unwanted changes and carries the splice review', async () => {
 const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, logLevel: 'error' });
 try {
  const { DecisionView } = await vite.ssrLoadModule('/src/components/qc/DecisionView.jsx');
  await exercise({ DecisionView, React, TestRenderer, assert });
 } finally { await vite.close(); }
});
