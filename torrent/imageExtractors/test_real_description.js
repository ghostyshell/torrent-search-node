const { extractImageLinks } = require('./index');

// Test with a sample description that matches the format you're seeing
async function testWithRealDescription() {
  console.log('Testing with sample torrent description...\n');

  // Sample description similar to what you might see in a real torrent
  const sampleDescription = `
SCREENLIST LINK
BELOW

https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html

POSTER LINK  
BELOW

https://i125.fastpic.org/big/2025/0630/13/09a2b3698a8c098ff135929c5102d213.jpg

SCREENSHOTS LINK
BELOW

https://fastpic.org/view/125/2025/0630/_8589621650a647e54363a76e48e49430.jpg.html
https://fastpic.org/view/125/2025/0630/_7e0a7502d2d888807f5d70a01db91191.jpg.html
https://fastpic.org/view/125/2025/0630/_ae7d9d4f8351ca4f5c4bfb95ed45d119.jpg.html
https://fastpic.org/view/125/2025/0630/_ddb9db38681cf7fc587c7072c5b3c85e.jpg.html

Some other text and info here...
`;

  console.log('Description to process:');
  console.log(sampleDescription);
  console.log('\n' + '='.repeat(50) + '\n');

  try {
    const imageLinks = await extractImageLinks(sampleDescription);

    console.log(`Found ${imageLinks.length} image links:\n`);

    imageLinks.forEach((link, index) => {
      console.log(`${index + 1}. Original: ${link.originalUrl}`);
      console.log(`   Direct:   ${link.directUrl}`);
      console.log(
        `   Has query params: ${
          link.directUrl.includes('?md5=') ? 'YES' : 'NO'
        }`
      );
      console.log(
        `   Is view URL: ${link.originalUrl.includes('/view/') ? 'YES' : 'NO'}`
      );
      console.log('');
    });

    // Check if view URLs are being processed correctly
    const viewUrls = imageLinks.filter((link) =>
      link.originalUrl.includes('/view/')
    );
    const viewUrlsWithQueryParams = viewUrls.filter((link) =>
      link.directUrl.includes('?md5=')
    );

    console.log(`Summary:`);
    console.log(`- Total images: ${imageLinks.length}`);
    console.log(`- View URLs: ${viewUrls.length}`);
    console.log(
      `- View URLs with query params: ${viewUrlsWithQueryParams.length}`
    );
    console.log(
      `- Success rate: ${
        viewUrls.length > 0
          ? ((viewUrlsWithQueryParams.length / viewUrls.length) * 100).toFixed(
              1
            )
          : 0
      }%`
    );
  } catch (error) {
    console.error('Error:', error);
  }
}

testWithRealDescription();
