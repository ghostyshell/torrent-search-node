const { extractImageLinks } = require('./imageExtractor');

// Test with both .top and .org domains
const testDescription = `
Test description with both domains:

xxxwebdlxxx.top images:
https://xxxwebdlxxx.top/img-6849e4c9ba87a.html
https://xxxwebdlxxx.top/img-6849e4c9c40ea.html

xxxwebdlxxx.org images:
https://xxxwebdlxxx.org/img-6883bbbca0280.html
https://xxxwebdlxxx.org/img-abcdef123456.html

Some other text here.
`;

async function testBothDomains() {
  console.log('Testing both xxxwebdlxxx.top and xxxwebdlxxx.org extractor...');

  try {
    const imageLinks = await extractImageLinks(testDescription);
    console.log(`Found ${imageLinks.length} image links:`);

    for (const link of imageLinks) {
      const domain = link.originalUrl.includes('.top') ? '.top' : '.org';
      console.log(`Domain: ${domain}`);
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
  console.log('\nTesting regex pattern for both domains:');

  const pattern = /https?:\/\/xxxwebdlxxx\.(top|org)\/img-[a-zA-Z0-9]+\.html/g;
  const testUrls = [
    'https://xxxwebdlxxx.top/img-6849e4c9ba87a.html',
    'https://xxxwebdlxxx.org/img-6883bbbca0280.html',
    'http://xxxwebdlxxx.top/img-abcdef123456.html',
    'https://xxxwebdlxxx.com/img-123.html', // Should not match
    'https://other-site.org/img-123.html', // Should not match
  ];

  testUrls.forEach((url) => {
    const matches = url.match(pattern);
    console.log(`${url} -> ${matches ? 'MATCH' : 'NO MATCH'}`);
  });
}

// Run tests
testRegexPattern();
testBothDomains();
