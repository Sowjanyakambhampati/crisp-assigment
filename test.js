/**
 * End-to-end test for both stateful and stateless magic link flows.
 * Run with: node test.js (while server is running on port 3000)
 */

const BASE = "http://localhost:3000";

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log("\n=== Magic Link POC Tests ===\n");

  // ---- Stateful flow ----
  console.log("Stateful (database-backed) flow:");

  await test("request magic link for known user", async () => {
    const res = await fetch(`${BASE}/api/magic-link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com" }),
    });
    const data = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data._debug && data._debug.loginUrl, "Expected loginUrl in debug");
    globalThis._statefulUrl = data._debug.loginUrl;
  });

  await test("request magic link for unknown user returns same message", async () => {
    const res = await fetch(`${BASE}/api/magic-link/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    const data = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(!data._debug, "Should not leak debug info for unknown user");
  });

  await test("verify valid token logs in", async () => {
    const res = await fetch(globalThis._statefulUrl);
    const data = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data.session_token, "Expected session_token");
    assert(data.user.email === "alice@example.com", "Expected alice");
  });

  await test("replay same token is rejected", async () => {
    const res = await fetch(globalThis._statefulUrl);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("invalid token is rejected", async () => {
    const res = await fetch(`${BASE}/api/magic-link/verify?token=bogus`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ---- Stateless flow ----
  console.log("\nStateless (HMAC-signed) flow:");

  await test("request stateless magic link", async () => {
    const res = await fetch(`${BASE}/api/magic-link/stateless/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com" }),
    });
    const data = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data._debug && data._debug.loginUrl, "Expected loginUrl");
    globalThis._statelessUrl = data._debug.loginUrl;
  });

  await test("verify stateless token logs in", async () => {
    const res = await fetch(globalThis._statelessUrl);
    const data = await res.json();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data.user.email === "bob@example.com", "Expected bob");
  });

  await test("stateless token can be reused (no single-use enforcement)", async () => {
    const res = await fetch(globalThis._statelessUrl);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test("tampered stateless token is rejected", async () => {
    const res = await fetch(`${BASE}/api/magic-link/stateless/verify?token=tampered.123.abc`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  console.log("\n=== All tests complete ===\n");
}

run().catch(console.error);
