const assert = require('assert');
const axios = require('axios');
const HanimeApiClient = require('../lib/clients/hanime_api_client');
const config = require('../lib/config');

const originalGet = axios.get;
const originalPost = axios.post;

async function testSearchUsesSearchHvsDataset() {
  const calls = [];
  const searchUrl = 'https://cached.freeanimehentai.net/api/v10/search_hvs';

  axios.get = async (url) => {
    calls.push(['get', url]);
    assert.strictEqual(url, searchUrl);

    return {
      status: 200,
      data: [
        {
          id: 1,
          name: 'Alpha Episode',
          search_titles: 'Alpha',
          slug: 'alpha-episode',
          description: '<p>first result</p>',
          brand: 'Queen Bee',
          tags: ['hd', 'anal'],
          views: 10,
          likes: 2,
          created_at_unix: 100,
          released_at_unix: 1000
        },
        {
          id: 2,
          name: 'Beta Episode',
          search_titles: 'Beta alternate',
          slug: 'beta-episode',
          description: '<p>matching description</p>',
          brand: 'Queen Bee',
          tags: ['hd', 'milf'],
          views: 50,
          likes: 5,
          created_at_unix: 200,
          released_at_unix: 900
        },
        {
          id: 3,
          name: 'Beta Other Studio',
          search_titles: 'Beta',
          slug: 'beta-other-studio',
          description: '<p>matching but wrong brand</p>',
          brand: 'Pink Pineapple',
          tags: ['hd'],
          views: 100,
          likes: 1,
          created_at_unix: 300,
          released_at_unix: 800
        }
      ]
    };
  };

  axios.post = async () => {
    throw new Error('search should use the current GET search_hvs endpoint');
  };

  const client = new HanimeApiClient({
    api: {
      authority: 'hanime.tv',
      defaultAuthority: 'hw.hanime.tv',
      searchUrl
    }
  });

  const results = await client.search({
    query: 'beta',
    tags: ['hd'],
    brands: ['Queen Bee'],
    orderBy: 'views',
    ordering: 'desc',
    page: 0
  });

  assert.deepStrictEqual(results.map(item => item.slug), ['beta-episode']);
  assert.deepStrictEqual(calls, [['get', searchUrl]]);
}

async function testVideoMetadataUsesLiveUniversalCdnEndpoint() {
  let requestedUrl;
  axios.get = async (url) => {
    requestedUrl = url;
    return {
      status: 200,
      data: { hentai_video: { slug: 'test-video' } }
    };
  };

  const client = new HanimeApiClient(config);
  const result = await client.getVideoData('test-video', 0);

  assert.strictEqual(
    requestedUrl,
    'https://www.universal-cdn.com/api/v8/video?id=test-video&'
  );
  assert.strictEqual(result.hentai_video.slug, 'test-video');
}

async function testProductionSearchUsesSignedUniversalCdnEndpoint() {
  let request;
  axios.get = async (url, options) => {
    request = { url, options };
    return { status: 200, data: [] };
  };

  const client = new HanimeApiClient(config);
  await client.search({});

  assert.strictEqual(request.url, 'https://www.universal-cdn.com/api/v11/search_hvs');
  assert.strictEqual(request.options.headers['x-signature-version'], 'app2');
  assert.ok(request.options.headers['x-claim']);
  assert.ok(request.options.headers['x-signature']);
}

async function testVideoMetadataFallsBackToSearchDataset() {
  axios.get = async (url) => {
    if (url.includes('/api/v8/video')) {
      const error = new Error('Request failed with status code 404');
      error.response = { status: 404 };
      throw error;
    }
    if (url.includes('/api/v11/search_hvs')) {
      return {
        status: 200,
        data: [{
          slug: 'fallback-video',
          name: 'Fallback Video',
          tags: ['hd', 'plot'],
          description: '<p>Fallback description</p>'
        }]
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  };

  const client = new HanimeApiClient(config);
  const result = await client.getVideoData('fallback-video', 0);

  assert.strictEqual(result.hentai_video.slug, 'fallback-video');
  assert.strictEqual(result.hentai_video.duration_in_ms, 20 * 60 * 1000);
  assert.deepStrictEqual(result.hentai_video.hentai_tags, [
    { text: 'hd' },
    { text: 'plot' }
  ]);
}

function testSearchDatasetCacheWindowIsSixHours() {
  const client = new HanimeApiClient(config);
  assert.strictEqual(client.searchDatasetTtlMs, 6 * 60 * 60 * 1000);
}

async function main() {
  try {
    await testSearchUsesSearchHvsDataset();
    await testVideoMetadataUsesLiveUniversalCdnEndpoint();
    await testProductionSearchUsesSignedUniversalCdnEndpoint();
    await testVideoMetadataFallsBackToSearchDataset();
    testSearchDatasetCacheWindowIsSixHours();
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
  }
}

main()
  .then(() => {
    console.log('hanime_api_client tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
