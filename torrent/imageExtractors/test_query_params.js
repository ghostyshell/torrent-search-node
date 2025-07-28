const { extractImageLinks } = require('./index');

// Test function for fastpic extractor with query parameters
async function testFastpicExtractorWithQueryParams() {
  console.log('Testing Fastpic Extractor with Query Parameters...');

  const testDescription = `
  SCREENLIST LINK
  BELOW
  
  https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html
  
  POSTER LINK
  BELOW
  
  https://i125.fastpic.org/big/2025/0630/13/09a2b3698a8c098ff135929c5102d213.jpg
  
  DIRECT LINK WITH QUERY PARAMS
  BELOW
  
  https://i125.fastpic.org/big/2025/0630/91/_7e0a7502d2d888807f5d70a01db91191.jpg?md5=nSE4NHgWfQVUOrK6qizwOA&expires=1753704000
  
  SCREENSHOTS LINK
  BELOW
  
  https://fastpic.org/view/125/2025/0630/_8589621650a647e54363a76e48e49430.jpg.html
  https://fastpic.org/view/125/2025/0630/_7e0a7502d2d888807f5d70a01db91191.jpg.html
  `;

  try {
    const imageLinks = await extractImageLinks(testDescription);
    console.log('Extracted image links:', JSON.stringify(imageLinks, null, 2));

    // Check if we found the URL with query parameters
    const urlWithQueryParams = imageLinks.find((link) =>
      link.originalUrl.includes(
        '?md5=nSE4NHgWfQVUOrK6qizwOA&expires=1753704000'
      )
    );

    if (urlWithQueryParams) {
      console.log('\n✅ Successfully detected URL with query parameters!');
    } else {
      console.log('\n❌ Failed to detect URL with query parameters');
    }
  } catch (error) {
    console.error('Error testing fastpic extractor:', error);
  }
}

// Run the test
testFastpicExtractorWithQueryParams();
