// Test regex pattern for xxxwebdlxxx.top URLs
const testUrls = [
  'https://xxxwebdlxxx.top/img-6849e4c9ba87a.html',
  'https://xxxwebdlxxx.top/img-6849e4c9c40ea.html',
  'https://xxxwebdlxxx.top/img-6849e4ca0ef8b.html',
  'https://xxxwebdlxxx.top/img-6849e4ca6f419.html',
  'http://xxxwebdlxxx.top/img-abcdef123456.html',
  'https://other-site.com/img-123.html', // Should not match
];

const pattern = /https?:\/\/xxxwebdlxxx\.top\/img-[a-zA-Z0-9]+\.html/g;

console.log('Testing xxxwebdlxxx.top regex pattern:');
testUrls.forEach((url) => {
  const matches = url.match(pattern);
  console.log(`${url} -> ${matches ? 'MATCH' : 'NO MATCH'}`);
});

// Test with full description
const description = `
Babes Thirst over Sharing BBC Together 2160p

https://xxxwebdlxxx.top/img-6849e4c9ba87a.html
https://xxxwebdlxxx.top/img-6849e4c9c40ea.html
https://xxxwebdlxxx.top/img-6849e4ca0ef8b.html
https://xxxwebdlxxx.top/img-6849e4ca6f419.html

Some other text
`;

const matches = description.match(pattern);
console.log(`\nFound ${matches ? matches.length : 0} URLs in description:`);
if (matches) {
  matches.forEach((url) => console.log(`  ${url}`));
}
