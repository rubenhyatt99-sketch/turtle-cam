#!/usr/bin/env node
import { hashSync } from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage : node scripts/hash-password.mjs '<mot de passe>'");
  process.exit(1);
}
console.log(hashSync(password, 12));
