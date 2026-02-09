# Privy Share

Privy Share is a personal, no-username vault for quick public-computer access.

- Unlock uses a 6-digit TOTP code from Microsoft Authenticator.
- After 10 wrong codes in a row, login is locked for 30 minutes.
- Text, links, and metadata are stored in Azure Table Storage.
- Files/images are stored in a private Azure Blob container.

## Stack

- Next.js (App Router, TypeScript)
- Azure Blob Storage (`@azure/storage-blob`)
- Azure Table Storage (`@azure/data-tables`)
- TOTP (`otplib`)
- Signed session cookie (`jose`)

## Local setup

1. Install deps:

```bash
npm install
```

2. Generate secrets (recommended):

```bash
node scripts/generate-secrets.mjs
```

3. Create `.env.local` from `.env.example` and fill values.

4. Run dev server:

```bash
npm run dev
```

## Azure provisioning + deploy

This script provisions everything and deploys the app:

- Resource Group
- Storage Account + private blob container
- Table Storage tables (`PrivyItems`, `PrivyAuth`)
- Linux App Service plan + Web App
- App settings (including TOTP/session secrets)

```bash
TOTP_SECRET_BASE32="<from generator>" \
SESSION_SECRET="<from generator>" \
TOTP_ACCOUNT_NAME="your-name" \
./scripts/provision-and-deploy-azure.sh
```

Optional env overrides for script:

- `RESOURCE_GROUP`, `LOCATION`, `SKU`
- `STORAGE_ACCOUNT`, `WEBAPP_NAME`, `APP_SERVICE_PLAN`
- `AUTH_MAX_ATTEMPTS`, `AUTH_LOCK_MINUTES`, `MAX_UPLOAD_MB`

## Authenticator enrollment

Use the script output values in Microsoft Authenticator:

1. Add account
2. Choose `Other account` (TOTP)
3. Enter issuer/account/secret manually
4. Use generated 6-digit codes to unlock Privy Share

## Security notes

- Sessions are HTTP-only signed cookies.
- Blob container is private; downloads use short-lived SAS URLs.
- No Outlook/password sign-in is required for the app.
- Keep `TOTP_SECRET_BASE32` and `SESSION_SECRET` private.
