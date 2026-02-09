#!/usr/bin/env node
import crypto from "node:crypto";
import { generateSecret, generateURI } from "otplib";

const issuer = process.env.TOTP_ISSUER || "Privy Share";
const account = process.env.TOTP_ACCOUNT_NAME || "owner";

const totpSecret = generateSecret();
const sessionSecret = crypto.randomBytes(48).toString("base64url");
const provisioningUri = generateURI({
  strategy: "totp",
  issuer,
  label: account,
  secret: totpSecret,
  period: 30,
  digits: 6,
  algorithm: "sha1",
});

console.log("# Add these to your Azure App Settings (or .env.local)");
console.log(`TOTP_SECRET_BASE32=${totpSecret}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
console.log("\n# Add this account in Microsoft Authenticator (manual entry):");
console.log(`Issuer: ${issuer}`);
console.log(`Account: ${account}`);
console.log(`Secret key: ${totpSecret}`);
console.log("\n# Or use this otpauth URI in any QR generator:");
console.log(provisioningUri);
