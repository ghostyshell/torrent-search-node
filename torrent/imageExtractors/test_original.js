const { extractImageLinks } = require('./index');

// Test with the exact description from the torrent you mentioned
async function testWithOriginalDescription() {
  console.log('Testing with the original torrent description...\n');

  // This is based on the description from the torrent URL you provided
  const originalDescription = `
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
https://fastpic.org/view/125/2025/0630/_d9274d06383974b8d80a76c2d76433e3.jpg.html
https://fastpic.org/view/125/2025/0630/_59ea50009d8dacb94bf05bd82cd6f2b.jpg.html
https://fastpic.org/view/125/2025/0630/_6e2fad838359e6314e7445613af8e63.jpg.html
https://fastpic.org/view/125/2025/0630/_cb864c752e7baf38051a483731df1df3.jpg.html
`;

  try {
    const imageLinks = await extractImageLinks(originalDescription);

    console.log(`Extracted ${imageLinks.length} image links:\n`);

    imageLinks.forEach((link, index) => {
      console.log(`${index + 1}. ${link.originalUrl}`);
      console.log(`    -> ${link.directUrl}`);
      console.log(
        `    Query params: ${link.directUrl.includes('?md5=') ? '✅' : '❌'}`
      );
      console.log('');
    });

    // Show summary
    const viewUrls = imageLinks.filter((link) =>
      link.originalUrl.includes('/view/')
    );
    const viewUrlsWithParams = viewUrls.filter((link) =>
      link.directUrl.includes('?md5=')
    );

    console.log('\n📊 Summary:');
    console.log(`Total URLs found: ${imageLinks.length}`);
    console.log(`View URLs: ${viewUrls.length}`);
    console.log(`View URLs with query params: ${viewUrlsWithParams.length}`);
    console.log(
      `Success rate: ${
        viewUrls.length > 0
          ? Math.round((viewUrlsWithParams.length / viewUrls.length) * 100)
          : 0
      }%`
    );

    // Show any failures
    const failedUrls = viewUrls.filter(
      (link) => !link.directUrl.includes('?md5=')
    );
    if (failedUrls.length > 0) {
      console.log('\n❌ Failed URLs:');
      failedUrls.forEach((link) => {
        console.log(`- ${link.originalUrl}`);
        console.log(`  -> ${link.directUrl}`);
      });
    }
  } catch (error) {
    console.error('Error extracting images:', error);
  }
}

testWithOriginalDescription();
