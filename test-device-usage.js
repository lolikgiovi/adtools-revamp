/**
 * Test script to verify device_usage tracking
 * Run in browser console to test the implementation
 */

// 1. Clear existing analytics
console.log('=== Clearing existing analytics ===');
localStorage.removeItem('usage.analytics.v1');
localStorage.setItem('user.email', 'test@example.com');

// 2. Import and initialize UsageTracker
import { UsageTracker } from './app/core/UsageTracker.js';
UsageTracker.init();

// 3. Track some events
console.log('\n=== Tracking events ===');
UsageTracker.trackEvent('quick-query', 'run');
UsageTracker.trackEvent('quick-query', 'run');
UsageTracker.trackEvent('quick-query', 'merge');
UsageTracker.trackEvent('base64-tools', 'encode');
UsageTracker.trackEvent('base64-tools', 'encode');
UsageTracker.trackEvent('base64-tools', 'encode');

// 4. Check local state
console.log('\n=== Local counts ===');
const counts = UsageTracker.getCounts();
console.log(JSON.stringify(counts, null, 2));

// 5. Build batch payload
console.log('\n=== Batch payload ===');
const payload = UsageTracker._toBatchPayload();
console.log('device_id:', payload.device_id);
console.log('user_email:', payload.user_email);
console.log('device_usage:', JSON.stringify(payload.device_usage, null, 2));

// 6. Verify payload structure
console.log('\n=== Verification ===');
const expectedCounts = {
  'quick-query.run': 2,
  'quick-query.merge': 1,
  'base64-tools.encode': 3
};

const allCorrect = payload.device_usage.every(du => {
  const key = `${du.tool_id}.${du.action}`;
  const expected = expectedCounts[key];
  const match = du.count === expected;
  console.log(`${key}: ${du.count} === ${expected}? ${match ? '✓' : '✗'}`);
  return match;
});

console.log(allCorrect ? '\n✅ All counts correct!' : '\n❌ Some counts incorrect');

// 7. Test idempotency - flush twice and verify counts don't double
console.log('\n=== Testing idempotency ===');
console.log('Flushing batch...');
await UsageTracker._flushBatch();
console.log('First flush complete');

const payload2 = UsageTracker._toBatchPayload();
console.log('Second payload device_usage:', JSON.stringify(payload2.device_usage, null, 2));

const idempotent = payload.device_usage.every((du, i) => {
  const du2 = payload2.device_usage[i];
  return du.count === du2.count;
});

console.log(idempotent ? '✅ Idempotent - counts unchanged after flush' : '❌ Not idempotent');

// 8. Check that events were cleared but counts remain
console.log('\n=== State after flush ===');
const state = JSON.parse(localStorage.getItem('usage.analytics.v1'));
console.log('Events count:', state.events.length, '(should be 0)');
console.log('Counts still present:', Object.keys(state.counts).length > 0 ? '✓' : '✗');
