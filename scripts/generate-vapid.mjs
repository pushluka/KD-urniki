// Generate locally; never print keys or overwrite an existing key pair.
import webpush from "web-push";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const subject = process.argv[2];
if (
  !subject ||
  !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject) ||
  /[\r\n]/.test(subject)
) {
  throw new Error(
    "Podajte javni kontakt: node scripts/generate-vapid.mjs mailto:skrbnik@vasa-domena.si",
  );
}
const keys = webpush.generateVAPIDKeys();
await writeFile(
  ".env.vapid.local",
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${subject}\nCRON_SECRET=${randomBytes(32).toString("hex")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Ključi so shranjeni v prezrti .env.vapid.local (0600). Prenesite jih v Vercel; datoteke ne objavite.",
);
