const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
  TableBorders, convertInchesToTwip, TabStopPosition, TabStopType,
  LevelFormat, UnderlineType,
} = require("docx");
const fs = require("fs");

const COLORS = {
  primary: "2B6CB0",
  accent: "276749",
  dark: "1A202C",
  mid: "4A5568",
  light: "718096",
  bg: "F7FAFC",
  codeBg: "EDF2F7",
  tableBorder: "CBD5E0",
  tableHeader: "2D3748",
  tableHeaderBg: "EBF8FF",
  white: "FFFFFF",
};

const font = "Calibri";
const monoFont = "Consolas";

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 400 : 280, after: 120 },
    children: [new TextRun({ text, font, bold: true, size: level === HeadingLevel.HEADING_1 ? 36 : level === HeadingLevel.HEADING_2 ? 28 : 24, color: level === HeadingLevel.HEADING_1 ? COLORS.primary : COLORS.dark })],
  });
}

function para(...runs) {
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    children: runs,
  });
}

function text(t, opts = {}) {
  return new TextRun({ text: t, font, size: 21, color: COLORS.dark, ...opts });
}

function bold(t, opts = {}) {
  return text(t, { bold: true, ...opts });
}

function italic(t, opts = {}) {
  return text(t, { italics: true, ...opts });
}

function code(t) {
  return new TextRun({ text: t, font: monoFont, size: 19, color: COLORS.primary, shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg } });
}

function codeBlock(lines) {
  return lines.map((line) =>
    new Paragraph({
      spacing: { after: 0, line: 240 },
      shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg },
      indent: { left: convertInchesToTwip(0.3) },
      children: [new TextRun({ text: line || " ", font: monoFont, size: 18, color: COLORS.mid })],
    })
  );
}

function bullet(runs, level = 0) {
  return new Paragraph({
    spacing: { after: 80, line: 276 },
    indent: { left: convertInchesToTwip(0.4 + level * 0.3), hanging: convertInchesToTwip(0.2) },
    children: [text("•  "), ...runs],
  });
}

function numberedItem(num, runs) {
  return new Paragraph({
    spacing: { after: 100, line: 276 },
    indent: { left: convertInchesToTwip(0.4), hanging: convertInchesToTwip(0.3) },
    children: [bold(`${num}. `), ...runs],
  });
}

function spacer(pts = 100) {
  return new Paragraph({ spacing: { after: pts }, children: [] });
}

function hr() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder } },
    children: [],
  });
}

const thinBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder },
  left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder },
  right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: COLORS.tableBorder },
};

function tableCell(children, opts = {}) {
  const paragraphs = children.map((c) =>
    c instanceof Paragraph ? c : new Paragraph({ spacing: { after: 40 }, children: Array.isArray(c) ? c : [c] })
  );
  return new TableCell({
    children: paragraphs,
    shading: opts.header ? { type: ShadingType.CLEAR, fill: COLORS.tableHeaderBg } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    ...opts,
  });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      tableCell([bold(h, { color: COLORS.tableHeader, size: 19 })], {
        header: true,
        width: colWidths ? { size: colWidths[i], type: WidthType.PERCENTAGE } : undefined,
      })
    ),
  });
  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell, i) =>
          tableCell([typeof cell === "string" ? text(cell, { size: 19 }) : cell], {
            width: colWidths ? { size: colWidths[i], type: WidthType.PERCENTAGE } : undefined,
          })
        ),
      })
  );
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders,
  });
}

function quotePara(t) {
  return new Paragraph({
    spacing: { after: 100, line: 276 },
    indent: { left: convertInchesToTwip(0.4) },
    border: { left: { style: BorderStyle.SINGLE, size: 3, color: COLORS.primary } },
    children: [italic(t, { color: COLORS.light })],
  });
}

async function main() {
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font, size: 21, color: COLORS.dark } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } },
        },
        children: [
          // ==================== TITLE PAGE ====================
          spacer(600),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [new TextRun({ text: "Crisp Technical Assessment", font, size: 52, bold: true, color: COLORS.primary })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [new TextRun({ text: "Answers & Working POC", font, size: 28, color: COLORS.mid })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [new TextRun({ text: "Sowjanya Kambhampati", font, size: 24, color: COLORS.light })],
          }),
          hr(),
          spacer(100),
          quotePara("Note on LLM usage: I used an LLM (Claude) as a coding assistant to help scaffold the Express server, write the HTML frontend, and format this document. All architectural decisions, security reasoning, and technical analysis are my own thinking. The LLM was used primarily for productivity — generating boilerplate, not for the core reasoning."),
          spacer(200),

          // ==================== EXERCISE 1 ====================
          heading("Exercise 1: Magic Link"),
          heading("1a) Database Schema Design", HeadingLevel.HEADING_2),
          para(text("The POC implements a Postgres-backed magic link system with three tables. The full schema is in "), code("supabase/migrations/20260303000001_magic_link_schema.sql"), text(" and the live application is in "), code("server.js"), text(". Here is the reasoning behind the design.")),

          heading("Tables", HeadingLevel.HEADING_3),
          ...codeBlock([
            "users",
            "├── id           UUID (PK, auto-generated)",
            "├── email        TEXT (UNIQUE, NOT NULL)",
            "├── name         TEXT",
            "├── created_at   TIMESTAMPTZ",
            "└── last_login   TIMESTAMPTZ",
            "",
            "magic_link_tokens",
            "├── id           UUID (PK, auto-generated)",
            "├── user_id      UUID (FK → users.id)",
            "├── token_hash   BYTEA (SHA-256 of the raw token)",
            "├── expires_at   TIMESTAMPTZ",
            "├── used_at      TIMESTAMPTZ (NULL = unused)",
            "├── created_at   TIMESTAMPTZ",
            "├── created_ip   INET",
            "└── used_ip      INET",
            "",
            "sessions",
            "├── id           UUID (PK, auto-generated)",
            "├── user_id      UUID (FK → users.id)",
            "├── token_hash   BYTEA (hashed session token)",
            "├── expires_at   TIMESTAMPTZ",
            "├── created_at   TIMESTAMPTZ",
            "└── revoked_at   TIMESTAMPTZ",
          ]),
          spacer(80),

          heading("Key Design Decisions", HeadingLevel.HEADING_3),
          numberedItem(1, [bold("Store the hash, never the raw token. "), text("The raw token is generated in memory, embedded in the email URL, and immediately discarded. Only its SHA-256 hash is persisted. This means that even if an attacker gains full read access to the database (via SQL injection, a backup leak, etc.), they cannot reconstruct valid login URLs. This is the same principle behind storing password hashes rather than plaintext passwords.")]),
          numberedItem(2, [bold("Why SHA-256 and not bcrypt/scrypt? "), text("Slow hashing algorithms like bcrypt exist to protect "), italic("low-entropy"), text(" secrets — passwords that humans choose, which typically have 20–40 bits of entropy and are vulnerable to dictionary attacks. Our magic link tokens are 256-bit random values. Brute-forcing 2^256 possibilities is computationally infeasible regardless of how fast the hash function is. A single SHA-256 pass is therefore both secure and performant (no need to spend CPU on key stretching).")]),
          numberedItem(3, [bold("Atomic claim with UPDATE ... WHERE ... RETURNING. "), text("When verifying a token, the server does not SELECT first and then UPDATE. Instead, it issues a single UPDATE that atomically finds the row by "), code("token_hash"), text(", checks "), code("used_at IS NULL"), text(" (not yet consumed), checks "), code("expires_at > now()"), text(" (not expired), sets "), code("used_at = now()"), text(" (marks it consumed), and returns the "), code("user_id"), text(". This prevents race conditions where two concurrent requests with the same token could both succeed (a TOCTOU — time-of-check-to-time-of-use bug).")]),
          numberedItem(4, [bold("Anti-enumeration. "), text("The request endpoint returns the same message (\"If that email is registered, a login link has been sent.\") regardless of whether the email exists. This prevents attackers from probing which email addresses are registered.")]),
          numberedItem(5, [bold("Short TTL. "), text("Tokens expire after 15 minutes. This limits the window during which a token is valid if an email is intercepted.")]),
          numberedItem(6, [bold("Audit trail. "), code("created_ip"), text(" and "), code("used_ip"), text(" fields allow detecting suspicious patterns (e.g., token created from one country but used from another).")]),

          hr(),

          // ==================== 1b ====================
          heading("1b) Token Entropy and URL Encoding", HeadingLevel.HEADING_2),
          heading("How much entropy?", HeadingLevel.HEADING_3),
          para(text("The POC uses "), bold("32 bytes (256 bits)"), text(" of entropy, generated via Node.js's "), code("crypto.randomBytes(32)"), text(", which draws from the operating system's cryptographically secure pseudorandom number generator (CSPRNG — "), code("/dev/urandom"), text(" on Linux/macOS, "), code("BCryptGenRandom"), text(" on Windows).")),

          para(bold("Why 256 bits?")),
          para(text("The security requirement is that an attacker cannot guess a valid token by trying random values. The probability of guessing a valid token is:")),
          ...codeBlock(["P(guess) = (number of valid tokens) / (2^entropy_bits)"]),
          spacer(40),
          para(text("Even in a worst case with 500 million (≈ 2^29) valid tokens simultaneously:")),
          ...codeBlock(["P(guess) = 2^29 / 2^256 = 2^(-227) ≈ 10^(-68)"]),
          spacer(40),
          para(text("This is astronomically small. Even at 10 billion guesses per second for the age of the universe, the probability of a single hit is effectively zero.")),

          para(bold("Why not fewer bits? "), text("128 bits would also be secure (2^99 values per valid token). I chose 256 because:")),
          bullet([text("The cost difference is negligible (43 vs 22 characters in the URL)")]),
          bullet([text("It provides a massive safety margin")]),
          bullet([text("It matches the SHA-256 hash output size, avoiding any entropy loss in the hash step")]),

          heading("URL Encoding", HeadingLevel.HEADING_3),
          para(text("The raw bytes are encoded as "), bold("URL-safe Base64"), text(" (RFC 4648 §5): standard Base64 characters "), code("+"), text(" and "), code("/"), text(" are replaced with "), code("-"), text(" and "), code("_"), text(", and trailing "), code("="), text(" padding is stripped. This gives a 43-character string for 32 bytes.")),

          spacer(40),
          makeTable(
            ["Encoding", "Characters for 32 bytes", "Alphabet"],
            [
              ["Hex", "64", "0-9, a-f"],
              ["Base64url", "43", "A-Z, a-z, 0-9, -, _"],
              ["Raw Base64", "44 (with padding)", "A-Z, a-z, 0-9, +, /"],
            ],
            [25, 30, 45]
          ),
          spacer(40),
          para(text("Base64url is ~33% shorter than hex while using only URL-safe characters (no percent-encoding needed). Raw Base64's "), code("+"), text(" and "), code("/"), text(" would need percent-encoding in URLs ("), code("%2B"), text(", "), code("%2F"), text("), defeating the compactness benefit.")),

          hr(),

          // ==================== 1c ====================
          heading("1c) Postgres Indexes for 500 Million Tokens", HeadingLevel.HEADING_2),
          para(text("At 500M rows, index design significantly impacts both query performance and storage costs.")),

          heading("Indexes I WOULD Use", HeadingLevel.HEADING_3),
          numberedItem(1, [bold("Partial unique index on token_hash WHERE used_at IS NULL")]),
          ...codeBlock([
            "CREATE UNIQUE INDEX idx_magic_link_token_hash",
            "    ON magic_link_tokens (token_hash)",
            "    WHERE used_at IS NULL;",
          ]),
          spacer(40),
          para(text("This is the primary lookup path — every token verification queries by "), code("token_hash"), text(". Without an index, Postgres does a sequential scan over 500M rows.")),
          para(text("The "), code("WHERE used_at IS NULL"), text(" partial index clause is critical at scale:")),
          bullet([text("Only unused tokens are ever looked up (used tokens are never queried by hash again)")]),
          bullet([text("If 99% of tokens have been used, the index contains only ~5M rows instead of 500M")]),
          bullet([text("This dramatically reduces index size in memory and on disk")]),
          bullet([text("The UNIQUE constraint also prevents two active tokens sharing the same hash")]),
          para(bold("Size estimate: "), text("A B-tree index on a 32-byte BYTEA column with 5M active rows ≈ ~250 MB (vs ~25 GB for all 500M rows).")),

          spacer(40),
          numberedItem(2, [bold("Partial index on expires_at WHERE used_at IS NULL")]),
          ...codeBlock([
            "CREATE INDEX idx_magic_link_expires",
            "    ON magic_link_tokens (expires_at)",
            "    WHERE used_at IS NULL;",
          ]),
          spacer(40),
          para(text("A background cleanup job periodically deletes expired tokens. This index allows it to efficiently find rows where "), code("expires_at < now()"), text(" without scanning the full table.")),

          heading("Indexes I WOULD NOT Use", HeadingLevel.HEADING_3),
          numberedItem(1, [bold("No standalone index on user_id. "), text("While one might query \"all tokens for user X\" for admin purposes, this is rare and does not justify the cost. At 500M rows, a B-tree index on UUID consumes roughly 12–16 GB of disk.")]),
          numberedItem(2, [bold("No index on created_at. "), text("Chronological listing is an admin operation, not a hot path. Can be served by the expires_at index or a sequential scan with LIMIT.")]),
          numberedItem(3, [bold("No composite index on (token_hash, used_at, expires_at). "), text("The partial index already covers the lookup. The expires_at check is done as a filter on the single row returned, which is O(1).")]),
          numberedItem(4, [bold("No hash index on token_hash. "), text("While hash indexes offer O(1) lookups, B-tree indexes are O(log n) with log2(5M) ≈ 22 comparisons — trivially fast. Hash indexes also don't support partial indexes or uniqueness constraints.")]),

          hr(),

          // ==================== 1d ====================
          heading("1d) Stateless Magic Links (No Database)", HeadingLevel.HEADING_2),
          para(text("The POC implements a stateless alternative using "), bold("HMAC-signed tokens"), text(" (see the "), code("/api/magic-link/stateless/*"), text(" endpoints in "), code("server.js"), text(").")),

          heading("How It Works", HeadingLevel.HEADING_3),
          para(text("Instead of storing a random token in the database, the server constructs a self-contained token that carries its own proof of authenticity:")),
          ...codeBlock(["token = userId.expiresAt.HMAC-SHA256(userId.expiresAt, serverSecret)"]),
          spacer(40),
          para(text("The three parts are:")),
          numberedItem(1, [bold("userId"), text(" — identifies who the link is for")]),
          numberedItem(2, [bold("expiresAt"), text(" — Unix timestamp when the link expires")]),
          numberedItem(3, [bold("signature"), text(" — HMAC-SHA256 of the first two parts, using a server-side secret key")]),

          heading("Verification", HeadingLevel.HEADING_3),
          para(text("When the user clicks the link, the server:")),
          numberedItem(1, [text("Splits the token into its three parts")]),
          numberedItem(2, [text("Recomputes "), code("HMAC-SHA256(userId.expiresAt, serverSecret)")]),
          numberedItem(3, [text("Compares the recomputed signature with the one in the token using "), bold("timing-safe comparison"), text(" (to prevent timing side-channel attacks)")]),
          numberedItem(4, [text("Checks that "), code("expiresAt"), text(" has not passed")]),
          numberedItem(5, [text("If everything checks out, the user is logged in")]),
          para(text("No database lookup is needed. The server only needs its secret key.")),

          heading("Why This Is Secure", HeadingLevel.HEADING_3),
          bullet([bold("Unforgeability: "), text("An attacker cannot construct a valid token without knowing the server secret. HMAC-SHA256 is a proven message authentication code — modifying any part of the payload invalidates the signature.")]),
          bullet([bold("Tamper-proof expiry: "), text("The expiry timestamp is part of the signed payload. An attacker cannot extend it without breaking the signature.")]),
          bullet([bold("Timing-safe comparison: "), text("The signature check uses "), code("crypto.timingSafeEqual"), text(" rather than "), code("==="), text(". A naive equality check leaks information through timing: it returns faster when the first byte differs. An attacker could exploit this to guess the signature byte-by-byte.")]),

          heading("Trade-offs: Stateful vs. Stateless", HeadingLevel.HEADING_3),
          makeTable(
            ["Property", "Stateful (DB)", "Stateless (HMAC)"],
            [
              ["Single-use", "Yes (mark used_at)", "No (cannot revoke)"],
              ["Revocable", "Yes (delete/mark row)", "No (valid until expiry)"],
              ["DB load on verify", "1 read + 1 write", "None"],
              ["DB load on create", "1 write", "None"],
              ["Secret management", "DB credentials", "HMAC key"],
              ["Blast radius if leaked", "Token hashes (useless)", "All tokens forged"],
              ["Audit trail", "Full (IPs, timestamps)", "None"],
            ],
            [25, 37, 38]
          ),
          spacer(60),
          para(text("The stateless approach is valid when you want to minimize infrastructure and accept that tokens cannot be revoked before expiry. The database-backed approach is stronger for production because single-use enforcement prevents token replay attacks.")),
          para(bold("Could you use JWT? "), text("Yes — the HMAC approach above is essentially a hand-rolled JWT. In production you would use a standard JWT library with the HS256 algorithm.")),

          hr(),

          // ==================== 1e ====================
          heading("1e) Magic Links with Native iOS/Android Apps", HeadingLevel.HEADING_2),

          heading("How It Works Technically", HeadingLevel.HEADING_3),
          para(text("The fundamental challenge is that a magic link is a URL, and URLs open in web browsers — not in native apps. To bridge this gap, mobile platforms provide "), bold("deep linking"), text(":")),
          bullet([bold("Universal Links (iOS) / App Links (Android): "), text("The app registers to handle URLs matching a specific pattern (e.g., "), code("https://app.example.com/login/*"), text("). A verification file hosted on the web server ("), code("apple-app-site-association"), text(" for iOS, "), code("assetlinks.json"), text(" for Android) proves the app and domain belong to the same entity.")]),
          bullet([bold("Custom URL schemes: "), text("The app registers a custom scheme like "), code("myapp://login?token=..."), text(". However, custom schemes are less secure (any app can register the same scheme) and are being deprecated in favor of universal/app links.")]),

          heading("Flow", HeadingLevel.HEADING_3),
          ...codeBlock([
            "User taps \"Login\" in app",
            "  → App sends POST /api/magic-link/request with email",
            "  → Server generates token, emails link",
            "  → User opens email, taps link",
            "  → OS recognizes the domain, opens the native app (or falls back to browser)",
            "  → App extracts token from URL, calls POST /api/magic-link/verify",
            "  → Server returns session token, app stores it in Keychain/Keystore",
          ]),

          heading("UX Challenges and Trade-offs", HeadingLevel.HEADING_3),
          numberedItem(1, [bold("Context switching. "), text("The user must leave the app to open their email client, find the email, tap the link, and return. This is disruptive, especially on mobile where app switching is more friction than on desktop.")]),
          numberedItem(2, [bold("Email client behavior. "), text("Some email clients (Gmail, Outlook) open links in an in-app browser (WebView) rather than the system browser. Universal links may not trigger from WebViews, causing the link to open a web page instead of the native app. Workaround: show an \"Open in App\" button with the custom URL scheme as a fallback.")]),
          numberedItem(3, [bold("Multiple devices. "), text("A user might request the magic link on their phone but open the email on their laptop. The link opens in a browser, not the mobile app. The server needs to handle both web and app sessions gracefully.")]),
          numberedItem(4, [bold("Email delivery latency. "), text("Emails can take seconds to minutes to arrive. The app should show a clear \"Check your email\" screen with an option to resend.")]),
          numberedItem(5, [bold("App not installed. "), text("If the app is not installed, the universal link opens in the browser. The server should serve a web login page as a fallback, with a prompt to install from the App Store / Play Store.")]),
          numberedItem(6, [bold("Token interception. "), text("On Android, if multiple apps are registered for the same intent, the OS may show a chooser dialog. On iOS, universal links can fail if the user has previously long-pressed and chosen \"Open in Safari.\"")]),
          numberedItem(7, [bold("Alternative: In-app OTP. "), text("Some apps avoid the deep-linking complexity by using a 6-digit OTP code that the user copies from the email. On iOS, the AutoFill system can detect OTP codes and suggest them on the keyboard.")]),

          hr(),
          spacer(200),

          // ==================== EXERCISE 2 ====================
          heading("Exercise 2: JavaScript Promises & Garbage Collection"),

          // ==================== 2a ====================
          heading("2a) Expected Output", HeadingLevel.HEADING_2),
          ...codeBlock(["a 1", "b 124"]),
          spacer(40),

          para(bold("Reasoning:")),
          numberedItem(1, [code("x()"), text(" is called. "), code("let d = 1"), text(" declares "), code("d"), text(" with value 1.")]),
          numberedItem(2, [code("fetch('/endpoint')"), text(" initiates an asynchronous HTTP request. It returns a Promise immediately. The "), code(".then()"), text(" callback is registered but will not execute until the fetch completes and the current synchronous execution finishes.")]),
          numberedItem(3, [code("console.log(\"a\", d)"), text(" executes synchronously, printing "), code("a 1"), text(".")]),
          numberedItem(4, [text("The function "), code("x()"), text(" returns. The call stack is now empty.")]),
          numberedItem(5, [text("The HTTP response arrives. The fetch Promise resolves. "), code("d += data.d"), text(" → "), code("d = 1 + 123 = 124"), text(". Prints "), code("b 124"), text(".")]),

          spacer(40),
          para(bold("Important note: "), text("In real code, "), code("fetch()"), text(" resolves to a Response object, not the JSON body. You would need "), code(".then(r => r.json()).then(data => ...)"), text(". Without "), code(".json()"), text(", the actual output would be "), code("a 1"), text(" then "), code("b NaN"), text(" (since 1 + undefined = NaN). I'm answering based on the question's assumption that the callback receives the parsed body.")),

          hr(),

          // ==================== 2b ====================
          heading("2b) Memory Allocation and Garbage Collection of Variable d", HeadingLevel.HEADING_2),

          heading("JavaScript VM Level (V8, SpiderMonkey, etc.)", HeadingLevel.HEADING_3),
          numberedItem(1, [bold("Parsing & Compilation. "), text("The JS engine parses the function and creates bytecode. It performs scope analysis and notices that "), code("d"), text(" is declared in "), code("x()"), text(" but referenced inside the "), code(".then()"), text(" callback — a "), bold("closure"), text(".")]),
          numberedItem(2, [bold("Closure creation. "), text("Because the inner function references "), code("d"), text(", the engine cannot allocate "), code("d"), text(" on the stack frame. Instead, it creates a "), bold("closure context"), text(" (V8 calls this a Context object) — a heap-allocated record that holds the shared variables. "), code("d"), text(" lives in this context object, not on the stack.")]),
          numberedItem(3, [bold("When x() returns. "), text("The stack frame is popped. But "), code("d"), text(" is NOT freed, because the "), code(".then()"), text(" callback still holds a reference to the closure context. The callback is alive because the Promise's internal reaction list references it.")]),
          numberedItem(4, [bold("When the .then() callback executes. "), text("It accesses "), code("d"), text(" via the closure context, modifies it (d = 124), and calls console.log. After the callback returns, there are no more references to the closure context — it becomes "), bold("unreachable"), text(" and eligible for garbage collection.")]),
          numberedItem(5, [bold("Garbage collection. "), text("Modern JS engines use "), bold("generational garbage collectors"), text(" with mark-and-sweep. The young generation (nursery) collects short-lived objects via scavenge (semi-space copy). The old generation collects via mark-sweep-compact. The closure context is initially in the young generation and may be promoted if the fetch takes long enough.")]),

          heading("OS Level", HeadingLevel.HEADING_3),
          para(text("From the OS perspective, the JS engine's heap is a region of virtual memory allocated via "), code("mmap"), text(" (macOS/Linux) or "), code("VirtualAlloc"), text(" (Windows). The GC manages objects within this region. When the GC compacts the heap, it may return pages to the OS via "), code("madvise(MADV_DONTNEED)"), text(", but this is coarse-grained — individual small objects are not individually returned to the OS.")),

          heading("Silicon Level", HeadingLevel.HEADING_3),
          bullet([code("d"), text(" (the number 1, later 124) is a 64-bit IEEE 754 double or a SMI (Small Integer, a tagged 31-bit integer in V8) stored in the heap memory region.")]),
          bullet([text("When actively being used in computation, it sits in a CPU register (e.g., "), code("xmm0"), text(" for float or "), code("rax"), text(" for tagged integers on x86-64).")]),
          bullet([text("When on the heap, it's in DRAM, potentially cached in L1/L2/L3 CPU cache.")]),
          bullet([text("\"Freeing\" memory doesn't zero it at the silicon level. The DRAM cells hold the bit pattern until overwritten.")]),

          heading("Summary of d's Journey", HeadingLevel.HEADING_3),
          ...codeBlock([
            "1. x() called       → d=1 allocated in closure context on JS heap (DRAM)",
            "2. x() returns      → stack frame gone, but closure context alive (d=1 on heap)",
            "3. callback runs    → d modified to 124, still on heap",
            "4. callback returns → closure context unreachable",
            "5. GC runs          → closure context's memory marked free in JS heap",
            "6. (maybe later)    → JS engine returns heap pages to OS",
            "7. (never explicit) → DRAM cells still hold bit pattern until reused",
          ]),

          hr(),

          // ==================== 2c ====================
          heading("2c) Replacing fetch with a Synchronously-Resolving Promise", HeadingLevel.HEADING_2),
          ...codeBlock(["fetch = () => new Promise((resolve) => resolve({ d: 234 }));"]),
          spacer(40),

          heading("Expected Output", HeadingLevel.HEADING_3),
          ...codeBlock(["a 1", "b 235"]),
          spacer(40),
          para(bold("NOT "), code("b 235"), text(" then "), code("a 1"), text(". The order remains the same.")),

          heading("Reasoning", HeadingLevel.HEADING_3),
          para(text("Even though the Promise is resolved immediately (synchronously, inside the Promise constructor), the "), code(".then()"), text(" callback is "), bold("not"), text(" invoked synchronously. The Promises/A+ specification (section 2.2.4) mandates:")),
          quotePara("\"onFulfilled or onRejected must not be called until the execution context stack contains only platform code.\""),
          para(text("This means "), code(".then()"), text(" callbacks are always deferred to a "), bold("microtask"), text(". They execute after the current synchronous code finishes but before any macrotask (like "), code("setTimeout"), text(").")),

          para(text("Execution order:")),
          numberedItem(1, [code("d = 1")]),
          numberedItem(2, [code("fetch()"), text(" runs → creates a Promise already resolved with "), code("{d: 234}")]),
          numberedItem(3, [code(".then(callback)"), text(" registers the callback. Since the Promise is already resolved, the callback is "), bold("scheduled as a microtask"), text(", not invoked immediately.")]),
          numberedItem(4, [code("console.log(\"a\", d)"), text(" runs synchronously → prints "), code("a 1")]),
          numberedItem(5, [code("x()"), text(" returns, call stack empties")]),
          numberedItem(6, [text("The microtask queue is drained: the callback runs")]),
          numberedItem(7, [code("d += 234"), text(" → "), code("d = 235")]),
          numberedItem(8, [code("console.log(\"b\", d)"), text(" → prints "), code("b 235")]),

          heading("Would This Be the Same in Any JavaScript VM?", HeadingLevel.HEADING_3),
          para(bold("Yes"), text(", in any spec-compliant VM (V8/Chrome/Node.js, SpiderMonkey/Firefox, JavaScriptCore/Safari). The ECMAScript specification (§27.2.5.4, PerformPromiseThen) requires that fulfilled handlers are enqueued as microtasks. This is normative, not implementation-defined.")),

          heading("Would It Be the Same for All Promise Implementations?", HeadingLevel.HEADING_3),
          para(bold("Not necessarily. "), text("Third-party Promise libraries (polyfills) could deviate:")),
          bullet([bold("Promises/A+ compliant libraries "), text("(Bluebird, Q, RSVP) will behave identically — the spec requires asynchronous resolution.")]),
          bullet([bold("Non-compliant implementations "), text("could theoretically invoke callbacks synchronously, changing the output to "), code("b 235"), text(" then "), code("a 235"), text(" (note: "), code("a 235"), text(" not "), code("a 1"), text(", because the callback would modify "), code("d"), text(" before the synchronous log).")]),
          bullet([bold("Historical note: "), text("jQuery's Deferred (pre-3.0) was a notable non-A+ implementation that could invoke callbacks synchronously. jQuery 3.0 fixed this by making Deferreds A+ compliant.")]),

          hr(),
          spacer(200),

          // ==================== RUNNING THE POC ====================
          heading("Running the POC"),

          heading("Prerequisites", HeadingLevel.HEADING_3),
          bullet([text("Node.js 18+")]),
          bullet([text("Docker Desktop")]),
          bullet([text("Supabase CLI ("), code("brew install supabase/tap/supabase"), text(")")]),

          heading("Setup", HeadingLevel.HEADING_3),
          ...codeBlock([
            "# Start local Supabase (Postgres + services)",
            "supabase start",
            "",
            "# Install dependencies",
            "npm install",
            "",
            "# Start the server",
            "npm start",
          ]),

          heading("Usage", HeadingLevel.HEADING_3),
          bullet([text("Open http://localhost:3000 in your browser")]),
          bullet([text("Click a demo user to autofill their email")]),
          bullet([text("Click \"Database-backed\" or \"HMAC-signed\" to generate a magic link")]),
          bullet([text("Click the generated link to verify and log in")]),
          bullet([text("View the token audit log at the bottom")]),

          heading("Run Tests", HeadingLevel.HEADING_3),
          ...codeBlock(["# (with server running)", "npm test"]),

          heading("Architecture", HeadingLevel.HEADING_3),
          ...codeBlock([
            "crisp-assessment/",
            "├── server.js                     # Express server with both approaches",
            "├── test.js                       # End-to-end tests",
            "├── public/",
            "│   └── index.html                # Frontend UI",
            "├── supabase/",
            "│   ├── config.toml               # Local Supabase configuration",
            "│   └── migrations/",
            "│       └── 20260303000001_...sql  # Database schema",
            "├── ANSWERS.md                    # Markdown version of this document",
            "└── package.json",
          ]),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = "Crisp_Technical_Assessment_Answers.docx";
  fs.writeFileSync(outPath, buffer);
  console.log(`Word document generated: ${outPath}`);
}

main().catch(console.error);
