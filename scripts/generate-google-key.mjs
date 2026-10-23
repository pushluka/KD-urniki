// Never print secrets or overwrite an existing encryption key.
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
await writeFile(
  ".env.google.local",
  `GOOGLE_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Šifrirni ključ je v prezrti .env.google.local (0600). Varno ga prenesite v Vercel; datoteke ne objavite.",
);
