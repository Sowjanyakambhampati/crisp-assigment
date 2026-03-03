# Crisp Technical Assessment — Answers

> **Note on LLM usage**: I used an LLM (Claude) as a coding assistant to help
> scaffold the Express server, write the HTML frontend, and format this
> document. All architectural decisions, security reasoning, and technical
> analysis are my own thinking. The LLM was used primarily for productivity —
> generating boilerplate, not for the core reasoning.

---

## Exercise 1: Magic Link

### 1a) Database Schema Design

The POC implements a Postgres-backed magic link system with three tables. The
full schema is in `supabase/migrations/20260303000001_magic_link_schema.sql`
and the live application is in `server.js`. Here is the reasoning behind the
design.

#### Tables

```
users
├── id           UUID (PK, auto-generated)
├── email        TEXT (UNIQUE, NOT NULL)
├── name         TEXT
├── created_at   TIMESTAMPTZ
└── last_login   TIMESTAMPTZ

magic_link_tokens
├── id           UUID (PK, auto-generated)
├── user_id      UUID (FK → users.id)
├── token_hash   BYTEA (SHA-256 of the raw token)
├── expires_at   TIMESTAMPTZ
├── used_at      TIMESTAMPTZ (NULL = unused)
├── created_at   TIMESTAMPTZ
├── created_ip   INET
└── used_ip      INET

sessions
├── id           UUID (PK, auto-generated)
├── user_id      UUID (FK → users.id)
├── token_hash   BYTEA (hashed session token)
├── expires_at   TIMESTAMPTZ
├── created_at   TIMESTAMPTZ
└── revoked_at   TIMESTAMPTZ
```

#### Key design decisions

1. **Store the hash, never the raw token.** The raw token is generated in
   memory, embedded in the email URL, and immediately discarded. Only its
   SHA-256 hash is persisted. This means that even if an attacker gains full
   read access to the database (via SQL injection, a backup leak, etc.), they
   cannot reconstruct valid login URLs. This is the same principle behind
   storing password hashes rather than plaintext passwords.

2. **Why SHA-256 and not bcrypt/scrypt?** Slow hashing algorithms like bcrypt
   exist to protect *low-entropy* secrets — passwords that humans choose,
   which typically have 20–40 bits of entropy and are vulnerable to dictionary
   attacks. Our magic link tokens are 256-bit random values. Brute-forcing
   2^256 possibilities is computationally infeasible regardless of how fast
   the hash function is. A single SHA-256 pass is therefore both secure and
   performant (no need to spend CPU on key stretching).

3. **Atomic claim with UPDATE ... WHERE ... RETURNING.** When verifying a
   token, the server does not SELECT first and then UPDATE. Instead, it
   issues a single UPDATE that atomically:
   - Finds the row by `token_hash`
   - Checks `used_at IS NULL` (not yet consumed)
   - Checks `expires_at > now()` (not expired)
   - Sets `used_at = now()` (marks it consumed)
   - Returns the `user_id`

   This prevents race conditions where two concurrent requests with the same
   token could both succeed (a TOCTOU — time-of-check-to-time-of-use bug).

4. **Anti-enumeration.** The request endpoint returns the same message
   ("If that email is registered, a login link has been sent.") regardless of
   whether the email exists. This prevents attackers from probing which email
   addresses are registered.

5. **Short TTL.** Tokens expire after 15 minutes. This limits the window
   during which a token is valid if an email is intercepted.

6. **Audit trail.** `created_ip` and `used_ip` fields allow detecting
   suspicious patterns (e.g., token created from IP in Netherlands but used
   from IP in another country).

---

### 1b) Token Entropy and URL Encoding

#### How much entropy?

The POC uses **32 bytes (256 bits)** of entropy, generated via Node.js's
`crypto.randomBytes(32)`, which draws from the operating system's
cryptographically secure pseudorandom number generator (CSPRNG — `/dev/urandom`
on Linux/macOS, `BCryptGenRandom` on Windows).

**Why 256 bits?**

The security requirement is that an attacker cannot guess a valid token by
trying random values. The probability of guessing a valid token is:

```
P(guess) = (number of valid tokens) / (2^entropy_bits)
```

Even in a worst case with 500 million (≈ 2^29) valid tokens simultaneously:

```
P(guess) = 2^29 / 2^256 = 2^(-227) ≈ 10^(-68)
```

This is astronomically small. Even at 10 billion guesses per second for the
age of the universe, the probability of a single hit is effectively zero.

**Why not fewer bits?** 128 bits would also be secure for this use case
(2^128 / 2^29 = 2^99 possible values per valid token), and is often cited as
the minimum for unguessable tokens. I chose 256 bits because:
- The cost difference is negligible (32 vs 16 bytes in the URL, ~43 vs ~22
  characters after encoding)
- It provides a massive safety margin
- It matches the SHA-256 hash output size, avoiding any entropy loss in the
  hash step

#### How are they encoded in URLs?

The raw bytes are encoded as **URL-safe Base64** (RFC 4648 §5):
- Standard Base64 characters `+` and `/` are replaced with `-` and `_`
- Trailing `=` padding is stripped

This gives a 43-character string for 32 bytes. Example:

```
/api/magic-link/verify?token=dG9rZW5fZXhhbXBsZV8zMl9ieXRlc19sb25n...
```

**Why URL-safe Base64 over hex?**

| Encoding     | Characters for 32 bytes | Alphabet            |
|-------------|------------------------|---------------------|
| Hex          | 64                     | 0-9, a-f            |
| Base64url    | 43                     | A-Z, a-z, 0-9, -, _ |
| Raw Base64   | 44 (with padding)      | A-Z, a-z, 0-9, +, / |

Base64url is ~33% shorter than hex while using only URL-safe characters (no
percent-encoding needed). Raw Base64's `+` and `/` would need to be
percent-encoded in URLs (`%2B`, `%2F`), defeating the compactness benefit.

---

### 1c) Postgres Indexes for 500 Million Tokens

At 500M rows, index design significantly impacts both query performance and
storage costs. Here is my reasoning:

#### Indexes I WOULD use

1. **Partial unique index on `token_hash WHERE used_at IS NULL`**

   ```sql
   CREATE UNIQUE INDEX idx_magic_link_token_hash
       ON magic_link_tokens (token_hash)
       WHERE used_at IS NULL;
   ```

   **Why:** This is the primary lookup path — every token verification queries
   by `token_hash`. Without an index, Postgres does a sequential scan over
   500M rows (unacceptable for a login flow).

   The `WHERE used_at IS NULL` partial index clause is critical at scale:
   - Only *unused* tokens are ever looked up (used tokens are never queried
     by hash again)
   - If 99% of tokens have been used, the index contains only 1% of rows
     (~5M instead of 500M)
   - This dramatically reduces index size in memory and on disk
   - The `UNIQUE` constraint also enforces that no two active tokens can
     share the same hash (a hash collision would be a security bug)

   **Size estimate:** A B-tree index on a 32-byte BYTEA column with 5M active
   rows ≈ ~250 MB (vs ~25 GB for all 500M rows). The savings are enormous.

2. **Partial index on `expires_at WHERE used_at IS NULL`**

   ```sql
   CREATE INDEX idx_magic_link_expires
       ON magic_link_tokens (expires_at)
       WHERE used_at IS NULL;
   ```

   **Why:** A background cleanup job periodically deletes expired tokens. This
   index allows it to efficiently find rows where `expires_at < now()` without
   scanning the full table. Again, the partial index keeps it small.

#### Indexes I WOULD NOT use

1. **No standalone index on `user_id`.** While one might query "all tokens for
   user X" for admin or debugging purposes, this is a rare operation that does
   not justify the cost. At 500M rows, a B-tree index on a UUID column
   consumes roughly **12–16 GB** of disk. The foreign key already has an
   implicit constraint; we simply don't need fast lookups by user_id on this
   table.

2. **No index on `created_at`.** Chronological listing of tokens is an admin
   operation, not a hot path. If needed, it can be served by the `expires_at`
   index (since tokens created around the same time also expire around the
   same time) or by a sequential scan with a LIMIT.

3. **No composite index on `(token_hash, used_at, expires_at)`.** The partial
   index on `token_hash WHERE used_at IS NULL` already covers the lookup. The
   `expires_at` check is done as a filter on the single row returned by the
   index lookup, which is O(1). A composite index would be larger for no
   measurable benefit.

4. **No hash index on `token_hash`.** While hash indexes in Postgres
   theoretically offer O(1) lookups, B-tree indexes are O(log n) with
   log2(5M) ≈ 22 comparisons — trivially fast. Hash indexes in Postgres also
   have historically been less reliable (not WAL-logged before PG 10) and
   don't support partial indexes or uniqueness constraints. The B-tree is the
   pragmatic choice.

---

### 1d) Stateless Magic Links (No Database)

The POC implements a stateless alternative using **HMAC-signed tokens**
(see the `/api/magic-link/stateless/*` endpoints in `server.js`).

#### How it works

Instead of storing a random token in the database, the server constructs a
self-contained token that carries its own proof of authenticity:

```
token = userId.expiresAt.HMAC-SHA256(userId.expiresAt, serverSecret)
```

For example: `550e8400-e29b-41d4-a716-446655440000.1709510400.dGhpcyBpcyBhIHNpZ25hdHVyZQ`

The three parts are:
1. **userId** — identifies who the link is for
2. **expiresAt** — Unix timestamp when the link expires
3. **signature** — HMAC-SHA256 of the first two parts, using a server-side
   secret key

#### Verification

When the user clicks the link, the server:
1. Splits the token into its three parts
2. Recomputes `HMAC-SHA256(userId.expiresAt, serverSecret)`
3. Compares the recomputed signature with the one in the token using
   **timing-safe comparison** (to prevent timing side-channel attacks)
4. Checks that `expiresAt` has not passed
5. If everything checks out, the user is logged in

No database lookup is needed. The server only needs its secret key.

#### Why this is secure

- **Unforgeability:** An attacker cannot construct a valid token without
  knowing the server secret. HMAC-SHA256 is a proven message authentication
  code — modifying any part of the payload invalidates the signature.
- **Tamper-proof expiry:** The expiry timestamp is part of the signed payload.
  An attacker cannot extend it without breaking the signature.
- **Timing-safe comparison:** The signature check uses `crypto.timingSafeEqual`
  rather than `===`. A naive equality check leaks information through timing:
  it returns faster when the first byte differs than when the 31st byte
  differs. An attacker could exploit this to guess the signature one byte at
  a time. Timing-safe comparison takes constant time regardless of where
  the mismatch occurs.

#### Trade-offs vs. database-backed tokens

| Property              | Stateful (DB)          | Stateless (HMAC)       |
|-----------------------|------------------------|------------------------|
| Single-use            | Yes (mark `used_at`)   | No (cannot revoke)     |
| Revocable             | Yes (delete/mark row)  | No (valid until expiry)|
| DB load on verify     | 1 read + 1 write       | None                   |
| DB load on create     | 1 write                | None                   |
| Secret management     | DB credentials         | HMAC key               |
| Blast radius if leaked| Token hashes (useless) | All tokens forged      |
| Audit trail           | Full (IPs, timestamps) | None                   |

The stateless approach is a valid choice when:
- You want to minimize infrastructure (no database needed at all)
- You accept that tokens cannot be revoked before expiry
- You accept that tokens can be replayed within their TTL
- Your TTL is very short (e.g., 5 minutes)

The database-backed approach is stronger for production use because
single-use enforcement prevents token replay attacks.

#### Could you use JWT?

Yes — the HMAC approach above is essentially a hand-rolled JWT. In production
you would use a standard JWT library with the `HS256` algorithm. The
principles are identical: the payload carries claims (userId, exp), and the
signature proves the server issued it.

---

### 1e) Magic Links with Native iOS/Android Apps

#### How it works technically

The fundamental challenge is that a magic link is a URL, and URLs open in web
browsers — not in native apps. To bridge this gap, mobile platforms provide
**deep linking** / **universal links** (iOS) / **app links** (Android):

1. **Universal Links (iOS) / App Links (Android):** The app registers to
   handle URLs matching a specific pattern (e.g.,
   `https://app.example.com/login/*`). A verification file hosted on the web
   server (`apple-app-site-association` for iOS, `assetlinks.json` for
   Android) proves the app and domain belong to the same entity.

2. **Custom URL schemes:** The app registers a custom scheme like
   `myapp://login?token=...`. The email contains this URL, and tapping it
   opens the app directly. However, custom schemes are less secure (any app
   can register the same scheme) and are being deprecated in favor of
   universal/app links.

#### Flow

```
User taps "Login" in app
    → App sends POST /api/magic-link/request with email
    → Server generates token, emails link: https://app.example.com/login?token=xyz
    → User opens email, taps link
    → OS recognizes the domain, opens the native app (or falls back to browser)
    → App extracts token from the URL, calls POST /api/magic-link/verify
    → Server returns session token, app stores it in secure storage (Keychain/Keystore)
```

#### UX challenges and trade-offs

1. **Context switching.** The user must leave the app to open their email
   client, find the email, tap the link, and return. This is disruptive,
   especially on mobile where app switching is more friction than on desktop.
   Users may get distracted or lost mid-flow.

2. **Email client behavior.** Some email clients (Gmail, Outlook) open links
   in an in-app browser (WebView) rather than the system browser. Universal
   links / app links may not trigger from WebViews, causing the link to open
   a web page instead of the native app. Workaround: the web page can show a
   "Open in App" button with the custom URL scheme as a fallback.

3. **Multiple devices.** A user might request the magic link on their phone
   but open the email on their laptop (or vice versa). The link opens in a
   browser on the laptop, not in the mobile app. The server needs to handle
   both web and app sessions gracefully.

4. **Email delivery latency.** Emails can take seconds to minutes to arrive.
   On mobile, users expect instant feedback. The app should show a clear
   "Check your email" screen with an option to resend, and ideally detect
   when the user returns (via app lifecycle events) to check if login
   completed.

5. **App not installed.** If the app is not installed, the universal link
   opens in the browser. The server should serve a web login page as a
   fallback, possibly with a prompt to install the app from the App
   Store / Play Store.

6. **Token interception.** On Android, if the user has multiple browsers or
   apps registered for the same intent, the OS may show a chooser dialog,
   which is confusing. On iOS, universal links are more deterministic but can
   still fail if the user has previously long-pressed and chosen "Open in
   Safari."

7. **Alternative: In-app OTP.** Some apps avoid the magic-link-to-app
   problem entirely by using a 6-digit OTP code that the user copies from
   the email and pastes into the app. This avoids the deep-linking complexity
   at the cost of requiring manual entry. On iOS, the AutoFill system can
   detect OTP codes in emails/SMS and suggest them on the keyboard, partially
   mitigating this.

---

## Exercise 2: JavaScript Promises & Garbage Collection

### 2a) Expected Output

```
a 1
b 124
```

**Reasoning:**

1. `x()` is called. `let d = 1` declares `d` with value `1`.

2. `fetch('/endpoint')` initiates an asynchronous HTTP request. It returns a
   `Promise` immediately. The `.then()` callback is registered but will not
   execute until the fetch completes and the current synchronous execution
   finishes.

3. `console.log("a", d)` executes synchronously, printing `a 1`.

4. The function `x()` returns. The call stack is now empty.

5. At some later point, the HTTP response arrives. The fetch `Promise`
   resolves with a `Response` object. **However**, there is a subtlety: the
   code does `data.d`, but `fetch()` resolves with a `Response` object, not
   the parsed JSON body. To get the JSON, you would call `data.json()` and
   await that. Since the code does `data.d` directly on the Response object,
   `data.d` would actually be `undefined`, and `d += undefined` would make
   `d` become `NaN`.

   **But** — reading the question charitably, it seems to assume that `data`
   is the parsed JSON body `{"d": 123}`. So assuming the intent is that the
   callback receives the parsed body:

   `d += data.d` → `d = 1 + 123` → `d = 124`

   `console.log("b", d)` prints `b 124`.

**Important note:** In real code, `fetch()` resolves to a `Response` object,
not the JSON body. You would need:

```javascript
fetch('/endpoint')
  .then(response => response.json())
  .then(data => {
    d += data.d;
    console.log("b", d);
  });
```

Without `.json()`, the actual output would be `a 1` then `b NaN` (since
`1 + undefined = NaN`). I'm answering based on the question's stated
assumption that the body is received as `{"d": 123}`.

---

### 2b) Memory Allocation and Garbage Collection of Variable `d`

Let me trace the lifecycle of `d` from JavaScript source code down to the
silicon.

#### JavaScript VM level (V8, SpiderMonkey, etc.)

1. **Parsing & Compilation.** When `x()` is first seen, the JS engine parses
   it and creates bytecode (or in V8, Ignition bytecode that may later be
   JIT-compiled by TurboFan to machine code). The engine performs *scope
   analysis* and notices that `d` is declared in `x()` but is referenced
   inside the `.then()` callback — a **closure**.

2. **Closure creation.** Because the inner function (the `.then()` callback)
   references `d`, the engine cannot allocate `d` on the stack frame of `x()`
   in the simple sense. Instead, it creates a **closure context** (V8 calls
   this a `Context` object) — a heap-allocated record that holds the variables
   shared between `x()` and its inner function. `d` lives in this context
   object, not in `x()`'s stack frame.

   Conceptually:
   ```
   ContextObject {
     d: 1          // allocated on the heap
   }
   ```

   Both `x()` and the `.then()` callback hold a reference to this context.

3. **When `x()` returns.** The stack frame for `x()` is popped. But `d` is
   NOT freed, because the `.then()` callback still holds a reference to the
   closure context. The callback itself is alive because the Promise's
   internal reaction list holds a reference to it (and the Promise is alive
   because the pending fetch holds a reference to it).

4. **When the `.then()` callback executes.** It accesses `d` via the closure
   context, modifies it (`d = 124`), and calls `console.log`. After the
   callback returns, there are no more references to the closure context:
   - `x()`'s stack frame is long gone
   - The callback has finished and the Promise's reaction list is cleared
   - The fetch response has been consumed

   The closure context (and `d` within it) is now **unreachable** and eligible
   for garbage collection.

5. **Garbage collection.** Modern JS engines (V8, SpiderMonkey, JavaScriptCore)
   use **generational garbage collectors** with mark-and-sweep:
   - **Nursery / young generation:** Newly allocated objects go here. Short-
     lived objects are collected cheaply via a **scavenge** (semi-space copy).
   - **Old generation:** Objects that survive one or more scavenges are
     promoted. These are collected via **mark-sweep-compact**, which is more
     expensive but infrequent.

   The closure context is initially allocated in the young generation. If the
   fetch is fast enough, it may be collected there. If the fetch takes a while
   (e.g., network latency), it may get promoted to the old generation and
   collected later.

   The GC runs when memory pressure triggers it — there is no deterministic
   "moment" when `d` is freed.

#### OS level

From the OS perspective, the JS engine's heap is just a region of virtual
memory allocated via `mmap` (on macOS/Linux) or `VirtualAlloc` (on Windows).
The GC manages objects within this region. When the GC compacts the heap, it
may return pages to the OS via `madvise(MADV_DONTNEED)` (Linux) or
equivalent, but this is a coarse-grained operation — individual small objects
like a closure context are not individually returned to the OS.

The OS sees:
- The process has N pages of virtual memory mapped for the JS heap
- Some pages are actively used, others are free within the heap
- The RSS (resident set size) may shrink when the GC releases pages, but
  only when enough objects in a contiguous region are freed

#### Silicon level

At the hardware level:
- `d` (the number `1`, later `124`) is a 64-bit IEEE 754 double or a
  SMI (Small Integer, often a tagged 31-bit integer in V8's internal
  representation) stored somewhere in the heap memory region.
- When `d` is actively being used (in a register during computation), it
  sits in a CPU register (e.g., `xmm0` for floating point or `rax` for
  tagged integers on x86-64).
- When it's in the closure context on the heap, it's in DRAM, potentially
  cached in L1/L2/L3 CPU cache depending on access recency.
- "Freeing" memory doesn't zero it at the silicon level. The GC marks the
  region as reusable; the physical DRAM cells still hold the bit pattern
  until overwritten. (This is why secure applications explicitly zero
  sensitive data before releasing it — though JavaScript doesn't provide
  control over this.)

#### Summary of `d`'s journey

```
1. x() called       → d=1 allocated in closure context on JS heap (DRAM)
2. x() returns      → stack frame gone, but closure context alive (d=1 on heap)
3. callback runs    → d modified to 124, still on heap
4. callback returns → closure context unreachable
5. GC runs          → closure context's memory marked free in JS heap
6. (maybe later)    → JS engine returns heap pages to OS
7. (never explicitly)→ DRAM cells still hold bit pattern until reused
```

---

### 2c) Replacing `fetch` with a Synchronously-Resolving Promise

```javascript
fetch = () => new Promise((resolve) => resolve({ d: 234 }));
```

#### Expected output

```
a 1
b 235
```

**NOT** `b 235` then `a 1`. The order remains the same.

#### Reasoning

Even though the Promise is resolved *immediately* (synchronously, inside the
`Promise` constructor), the `.then()` callback is **not** invoked
synchronously. The Promises/A+ specification (section 2.2.4) mandates:

> "onFulfilled or onRejected must not be called until the execution context
> stack contains only platform code."

This means `.then()` callbacks are always deferred to a **microtask** (in
modern engines) or the next tick. They execute after the current synchronous
code finishes but before any macrotask (like `setTimeout` or I/O callbacks).

So the execution order is:
1. `d = 1`
2. `fetch()` runs → creates a Promise that is already resolved with `{d: 234}`
3. `.then(callback)` registers the callback. Since the Promise is already
   resolved, the callback is **scheduled as a microtask**, not invoked
   immediately.
4. `console.log("a", d)` runs synchronously → prints `a 1`
5. `x()` returns, call stack empties
6. The microtask queue is drained: the callback runs
7. `d += 234` → `d = 235`
8. `console.log("b", d)` → prints `b 235`

#### Would this be the same in any JavaScript VM?

**Yes**, in any spec-compliant VM (V8/Chrome/Node.js, SpiderMonkey/Firefox,
JavaScriptCore/Safari). The ECMAScript specification (§27.2.5.4,
PerformPromiseThen) requires that fulfilled handlers are enqueued as
microtasks via the HostEnqueuePromiseJob abstract operation. This behavior is
normative, not implementation-defined.

Older engines (pre-ES2015) that did not have native Promises would not have
this guarantee, but all modern engines conform.

#### Would it be the same for all Promise implementations?

**Not necessarily.** Third-party Promise libraries (polyfills) could deviate:

- **Promises/A+ compliant libraries** (like Bluebird, Q, RSVP) will behave
  identically — the spec requires asynchronous resolution.

- **Non-compliant implementations** could theoretically invoke callbacks
  synchronously when the Promise is already resolved, which would change the
  output to:
  ```
  b 235
  a 235
  ```
  Notice `a 235` not `a 1`, because the callback would modify `d` before the
  `console.log("a", d)` line executes.

  However, such an implementation would violate Promises/A+ and is considered
  buggy. The asynchronous guarantee exists precisely to ensure predictable
  execution order: callers can always rely on code after `.then()` executing
  before the callback, regardless of whether the Promise was already resolved.

- **Historical note:** jQuery's `Deferred` (pre-3.0) was a notable non-A+
  implementation that could invoke callbacks synchronously. This caused many
  subtle bugs, and jQuery 3.0 fixed this by making Deferreds A+ compliant.

---

## Running the POC

### Prerequisites

- Node.js 18+
- Docker Desktop
- Supabase CLI (`brew install supabase/tap/supabase`)

### Setup

```bash
# Start local Supabase (Postgres + services)
supabase start

# Install dependencies
npm install

# Start the server
npm start
```

### Usage

- Open http://localhost:3000 in your browser
- Click a demo user to autofill their email
- Click "Database-backed" or "HMAC-signed" to generate a magic link
- Click the generated link to verify and log in
- View the token audit log at the bottom

### Run tests

```bash
# (with server running)
npm test
```

### Architecture

```
crisp-assessment/
├── server.js                          # Express server with both approaches
├── test.js                            # End-to-end tests
├── public/
│   └── index.html                     # Frontend UI
├── supabase/
│   ├── config.toml                    # Local Supabase configuration
│   └── migrations/
│       └── 20260303000001_...sql      # Database schema
├── ANSWERS.md                         # This document
└── package.json
```
