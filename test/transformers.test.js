const assert = require('assert');
const { cleanDescription } = require('../lib/transformers/formatters');

function testCleanDescriptionPreservesLetterP() {
  const description = '<p>A popular episode with plenty of suspense.</p>\n<p>Part two.</p>';

  assert.strictEqual(
    cleanDescription(description),
    'A popular episode with plenty of suspense.\nPart two.'
  );
}

testCleanDescriptionPreservesLetterP();
console.log('transformer tests passed');
