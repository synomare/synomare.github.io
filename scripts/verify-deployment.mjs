const expected = process.env.EXPECTED_SHA;
const baseUrl = (process.env.PAGES_URL || 'https://synomare.github.io/').replace(/\/?$/, '/');
if (!expected) throw new Error('EXPECTED_SHA is required');

let last = '';
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const response = await fetch(`${baseUrl}build-info.json?sha=${encodeURIComponent(expected)}&attempt=${attempt}`, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    last = await response.text();
    if (response.ok) {
      const info = JSON.parse(last);
      if (info.sha === expected && Number.isInteger(info.notes) && Number.isInteger(info.works)) {
        console.log(`Deployment verified: ${info.sha} / Notes ${info.notes} / Works ${info.works}`);
        process.exit(0);
      }
    }
  } catch (error) {
    last = error.message;
  }
  console.log(`Verification attempt ${attempt}/12 did not match yet.`);
  await new Promise(resolve => setTimeout(resolve, 10000));
}
throw new Error(`Public deployment did not reach ${expected}. Last response: ${last.slice(0, 300)}`);
