const assert = require('assert');
const { cleanDescription } = require('../lib/transformers/formatters');
const { toStremioStream } = require('../lib/transformers/stream_transformer');

function testCleanDescriptionPreservesLetterP() {
  const description = '<p>A popular episode with plenty of suspense.</p>\n<p>Part two.</p>';

  assert.strictEqual(
    cleanDescription(description),
    'A popular episode with plenty of suspense.\nPart two.'
  );
}

function testStreamMetadataUsesStremioCompatibleNotation() {
  const stream = toStremioStream({
    url: 'https://hanime.tv/hls/test',
    height: 720,
    video_stream_group_id: 'Hanime.TV',
    filesize_mbs: 202.5,
    filesize_estimated: true,
    duration_in_ms: 20 * 60 * 1000,
    duration_estimated: true
  });

  assert.ok(stream.title.includes('💾 203 MB'));
  assert.ok(stream.title.includes('⌚ 20 min'));
  assert.ok(!stream.title.includes('~'));
  assert.strictEqual(stream.description, stream.title);
  assert.strictEqual(
    stream.behaviorHints.videoSize,
    Math.round(202.5 * 1024 * 1024)
  );
}

testCleanDescriptionPreservesLetterP();
testStreamMetadataUsesStremioCompatibleNotation();
console.log('transformer tests passed');
