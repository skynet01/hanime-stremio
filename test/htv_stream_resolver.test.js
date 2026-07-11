const assert = require('assert');
const axios = require('axios');
const signatureService = require('../lib/services/htv_signature_service');
const HtvStreamResolver = require('../lib/services/htv_stream_resolver');
const { sealMessage } = require('../lib/services/htv_stream_resolver');
const { toStremioStream } = require('../lib/transformers/stream_transformer');

const originalGet = axios.get;
const originalPost = axios.post;
const originalGetSignature = signatureService.getSignature;

async function testFallsBackToPlayableHlsMetadata() {
  const playlistUrl = 'https://hanime.tv/hls/test-720';
  const segmentOne = 'https://cdn.example/0000.html';
  const segmentTwo = 'https://cdn.example/0001.html';

  signatureService.getSignature = async () => ({ signature: 'test', time: 123 });
  axios.post = async () => ({
    status: 200,
    headers: {
      'x-token': sealMessage({ sources: [{ height: 720, url: '/hls/test-720' }] })
    }
  });
  axios.get = async (url, options = {}) => {
    if (url.includes('/videos_manifests/')) {
      return { status: 403, data: '<html>blocked</html>' };
    }
    if (url === playlistUrl) {
      return {
        status: 200,
        data: [
          '#EXTM3U',
          '#EXTINF:1.25,',
          segmentOne,
          '#EXTINF:2.75,',
          segmentTwo,
          '#EXT-X-ENDLIST'
        ].join('\n')
      };
    }
    if (options.headers && options.headers.Range === 'bytes=0-0') {
      const bytes = url === segmentOne ? 1024 * 1024 : 2 * 1024 * 1024;
      return {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${bytes}` },
        data: Buffer.from([0])
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  };

  const resolver = new HtvStreamResolver({
    api: {
      htv: {
        handshakeUrl: 'https://guest.example/handshake',
        manifestUrl: 'https://guest.example/videos_manifests',
        hlsHost: 'https://hanime.tv'
      }
    }
  });

  const streams = await resolver.resolveStreams('test-video');

  assert.strictEqual(streams.length, 1);
  assert.strictEqual(streams[0].durationMs, 4000);
  assert.strictEqual(streams[0].filesizeMbs, 3);
}

async function testLimitsSegmentProbesForLargePlaylists() {
  const playlistUrl = 'https://hanime.tv/hls/large-720';
  const segments = Array.from({ length: 30 }, (_, index) => (
    `https://cdn.example/${String(index).padStart(4, '0')}.html`
  ));
  let segmentProbeCount = 0;

  signatureService.getSignature = async () => ({ signature: 'test', time: 123 });
  axios.post = async () => ({
    status: 200,
    headers: {
      'x-token': sealMessage({ sources: [{ height: 720, url: '/hls/large-720' }] })
    }
  });
  axios.get = async (url, options = {}) => {
    if (url.includes('/videos_manifests/')) {
      return { status: 403, headers: {}, data: '<html>blocked</html>' };
    }
    if (url === playlistUrl) {
      return {
        status: 200,
        data: [
          '#EXTM3U',
          ...segments.flatMap(segment => ['#EXTINF:10,', segment]),
          '#EXT-X-ENDLIST'
        ].join('\n')
      };
    }
    if (options.headers && options.headers.Range === 'bytes=0-0') {
      segmentProbeCount++;
      return {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${1024 * 1024}` },
        data: Buffer.from([0])
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  };

  const resolver = new HtvStreamResolver({
    api: { htv: { manifestUrl: 'https://guest.example/videos_manifests' } }
  });
  const streams = await resolver.resolveStreams('large-video');

  assert.strictEqual(streams[0].durationMs, 300000);
  assert.strictEqual(streams[0].filesizeMbs, 30);
  assert.ok(segmentProbeCount <= 12, `made ${segmentProbeCount} segment probes`);
}

function testMissingMetadataDoesNotRenderZeroes() {
  const stream = toStremioStream({
    url: 'https://hanime.tv/hls/test',
    height: 720,
    video_stream_group_id: 'Hanime.TV'
  });

  assert.ok(!stream.title.includes('0 MB'));
  assert.ok(!stream.title.includes('0 min'));
}

async function run() {
  try {
    await testFallsBackToPlayableHlsMetadata();
    await testLimitsSegmentProbesForLargePlaylists();
    testMissingMetadataDoesNotRenderZeroes();
    console.log('htv_stream_resolver tests passed');
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    signatureService.getSignature = originalGetSignature;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
