// Stage 5 hardening: lightweight local-dev performance baseline.
// Not a substitute for a real load test against staging/production
// infrastructure with representative authenticated + DB-querying traffic —
// see docs/performance-slas.md for the caveats on these numbers. k6 isn't
// installed in this environment, so autocannon (an npm-installable
// equivalent) is used for a quick, honest baseline rather than skipping
// this stage entirely.
const autocannon = require('autocannon');

const url = process.env.LOAD_TEST_URL || 'http://localhost:3000/health';

autocannon(
  {
    url,
    connections: 20,
    duration: 10,
  },
  (err, result) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  },
);
