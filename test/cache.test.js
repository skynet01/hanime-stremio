const assert = require('assert');
const { cacheWrapCatalog } = require('../lib/cache');

async function testConcurrentMissesShareOneUpstreamRequest() {
  let upstreamCalls = 0;
  const key = `single-flight-${Date.now()}-${Math.random()}`;
  const fetchCatalog = async () => {
    upstreamCalls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return [{ id: 'result' }];
  };

  const results = await Promise.all(
    Array.from({ length: 10 }, () => cacheWrapCatalog(key, fetchCatalog))
  );

  assert.strictEqual(upstreamCalls, 1);
  assert.strictEqual(results.length, 10);
  assert.deepStrictEqual(results[0], [{ id: 'result' }]);
}

testConcurrentMissesShareOneUpstreamRequest()
  .then(() => console.log('cache tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
