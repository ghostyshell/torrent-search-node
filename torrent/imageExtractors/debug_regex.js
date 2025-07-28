// Debug regex test
const testUrls = [
  'https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html',
  'https://fastpic.org/view/125/2025/0630/_8589621650a647e54363a76e48e49430.jpg.html',
  'https://fastpic.org/view/125/2025/0630/_7e0a7502d2d888807f5d70a01db91191.jpg.html',
  'https://i125.fastpic.org/big/2025/0630/13/09a2b3698a8c098ff135929c5102d213.jpg',
];

const patterns = [
  /https?:\/\/fastpic\.org\/view\/\d+\/\d{4}\/\d{4}\/_[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)\.html/g,
  /https?:\/\/i\d+\.fastpic\.org\/[^.\s]+\.(jpg|jpeg|png|gif|webp)/g,
];

console.log('Testing regex patterns:');
testUrls.forEach((url) => {
  console.log(`\nTesting: ${url}`);
  patterns.forEach((pattern, index) => {
    const match = url.match(pattern);
    console.log(`Pattern ${index + 1}: ${match ? 'MATCH' : 'NO MATCH'}`);
  });
});

// Test in full description
const testDescription = `
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
`;

console.log('\nTesting in full description:');
patterns.forEach((pattern, index) => {
  const matches = testDescription.match(pattern);
  console.log(`Pattern ${index + 1} matches:`, matches);
});
