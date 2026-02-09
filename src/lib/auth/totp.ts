import { generateURI, verifySync } from "otplib";
import { getEnv } from "@/lib/env";

export const verifyTotpCode = (code: string): boolean => {
  const normalized = code.replace(/\s+/g, "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const env = getEnv();
  const result = verifySync({
    strategy: "totp",
    token: normalized,
    secret: env.totpSecretBase32,
    period: 30,
    epochTolerance: 1,
  });

  return result.valid;
};

export const getTotpProvisioningUri = (): string => {
  const env = getEnv();

  return generateURI({
    strategy: "totp",
    issuer: env.totpIssuer,
    label: env.totpAccountName,
    secret: env.totpSecretBase32,
    period: 30,
    digits: 6,
    algorithm: "sha1",
  });
};
