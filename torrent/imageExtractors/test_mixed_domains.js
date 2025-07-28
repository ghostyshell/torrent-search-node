const { extractImageLinks } = require('./imageExtractor');

// Test with mixed .top and .org domains
const mixedDescription = `
Mixed torrent description with both domains:

From OnlyFans torrent (.top domain):
https://xxxwebdlxxx.top/img-6849e4c9ba87a.html
https://xxxwebdlxxx.top/img-6849e4c9c40ea.html

From BangBros torrent (.org domain):
https://xxxwebdlxxx.org/img-66e2f65dc6c2d.html
https://xxxwebdlxxx.org/img-66e2f65dd6396.html

Some other content and images...
`;

async function testMixedDomains() {
  console.log('Testing mixed xxxwebdlxxx.top and xxxwebdlxxx.org URLs...');

  try {
    const imageLinks = await extractImageLinks(mixedDescription);
    console.log(`Found ${imageLinks.length} image links:`);

    for (const link of imageLinks) {
      const domain = link.originalUrl.includes('.top') ? '.top' : '.org';
      console.log(`Domain: ${domain}`);
      console.log(`Original: ${link.originalUrl}`);
      console.log(`Direct: ${link.directUrl || 'Failed to extract'}`);
      console.log('---');
    }

    // Summary
    const topCount = imageLinks.filter((link) =>
      link.originalUrl.includes('.top')
    ).length;
    const orgCount = imageLinks.filter((link) =>
      link.originalUrl.includes('.org')
    ).length;
    console.log(
      `Summary: ${topCount} .top URLs and ${orgCount} .org URLs processed successfully`
    );
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testMixedDomains();
