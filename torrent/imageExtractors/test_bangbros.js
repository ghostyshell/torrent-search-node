const { extractImageLinks } = require('./imageExtractor');

// Test with the actual URLs from the BangBros torrent description
const testDescription = `
BangBros18 - BangBros - Kira Perez - Big Dick Show Off - bbe18138 4k 2160p

https://xxxwebdlxxx.org/img-66e2f65dc6c2d.html

https://xxxwebdlxxx.org/img-66e2f65dd6396.html

https://xxxwebdlxxx.org/img-66e2f65e28012.html

2022-07-22

Teen, Hardcore, All Sex, Blowjob, Latina, Big Tits, Big Dick, Cumshot
`;

async function testBangBrosUrls() {
  console.log('Testing xxxwebdlxxx.org extractor with BangBros URLs...');

  try {
    const imageLinks = await extractImageLinks(testDescription);
    console.log(`Found ${imageLinks.length} image links:`);

    for (const link of imageLinks) {
      console.log(`Original: ${link.originalUrl}`);
      console.log(`Direct: ${link.directUrl || 'Failed to extract'}`);
      console.log('---');
    }
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Test regex pattern separately
function testRegexPattern() {
  console.log('Testing regex pattern for xxxwebdlxxx.org URLs:');

  const pattern = /https?:\/\/xxxwebdlxxx\.(top|org)\/img-[a-zA-Z0-9]+\.html/g;
  const testUrls = [
    'https://xxxwebdlxxx.org/img-66e2f65dc6c2d.html',
    'https://xxxwebdlxxx.org/img-66e2f65dd6396.html',
    'https://xxxwebdlxxx.org/img-66e2f65e28012.html',
    'https://xxxwebdlxxx.top/img-6849e4c9ba87a.html', // Should also match
    'https://other-site.org/img-123.html', // Should not match
  ];

  testUrls.forEach((url) => {
    const matches = url.match(pattern);
    console.log(`${url} -> ${matches ? 'MATCH' : 'NO MATCH'}`);
  });

  // Test with full description
  const matches = testDescription.match(pattern);
  console.log(
    `\nFound ${matches ? matches.length : 0} URLs in BangBros description:`
  );
  if (matches) {
    matches.forEach((url) => console.log(`  ${url}`));
  }
  console.log('');
}

// Run tests
testRegexPattern();
testBangBrosUrls();
