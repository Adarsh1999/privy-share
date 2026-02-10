# Privy Share

Privy Share is a secure, TOTP-protected personal vault built with Next.js and Azure storage for accessing text, links, files, and images on public computers without logging into personal accounts.

Access is protected by a TOTP code (Microsoft Authenticator or any compatible app), not email/password login.

## What This Project Depends On

This app needs these runtime components to work:

- Web app: Next.js App Router (Node runtime)
- File storage: Azure Blob Storage container (private)
- Metadata/state storage: Azure Table Storage tables
- Auth mechanism: TOTP secret + signed session cookie

There is no separate MongoDB/SQL dependency in the current architecture.

## Architecture

- `src/app`:
  - UI + API routes
- `src/lib/auth`:
  - TOTP validation
  - lockout policy state
  - session cookie signing/verification
- `src/lib/storage`:
  - Azure Blob operations (file/image bytes)
  - Azure Table operations (metadata + auth lock state)

### Data model

- Blob container (`AZURE_BLOB_CONTAINER`, default `privy-files`):
  - stores uploaded file/image bytes only
- Items table (`AZURE_ITEMS_TABLE`, default `PrivyItems`):
  - stores text/link/file metadata records
- Auth table (`AZURE_AUTH_TABLE`, default `PrivyAuth`):
  - stores global failed-attempt counter + lock timestamp

### Security model

- Login uses 6-digit TOTP (`period=30s`, `epochTolerance=1`)
- Failed attempts lockout:
  - default `10` failures => `30` minutes lock
- Session cookie:
  - name: `privy_session`
  - signed JWT (`HS256`) with `SESSION_SECRET`
  - HTTP-only, SameSite Lax, Secure in production
- Blob container is private
- File downloads are short-lived read SAS URLs (20 minutes)

## Environment Variables

Use `.env.local` for local development. Do not commit secrets.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | - | Storage account connection string (Blob + Table). |
| `AZURE_BLOB_CONTAINER` | No | `privy-files` | Blob container name for uploaded files/images. |
| `AZURE_ITEMS_TABLE` | No | `PrivyItems` | Table name for item metadata. |
| `AZURE_AUTH_TABLE` | No | `PrivyAuth` | Table name for auth lockout state. |
| `TOTP_SECRET_BASE32` | Yes | - | Base32 secret used to validate authenticator codes. |
| `TOTP_ISSUER` | No | `Privy Share` | Issuer label shown in authenticator apps. |
| `TOTP_ACCOUNT_NAME` | No | `owner` | Account label shown in authenticator apps. |
| `SESSION_SECRET` | Yes | - | JWT signing secret (minimum 32 chars). |
| `SESSION_TTL_HOURS` | No | `12` | Session lifetime. |
| `AUTH_MAX_ATTEMPTS` | No | `10` | Failed attempts before lockout. |
| `AUTH_LOCK_MINUTES` | No | `30` | Lockout duration in minutes. |
| `MAX_UPLOAD_MB` | No | `20` | Max single file upload size. |

Reference template: `.env.example`

## Local Setup

### 1) Install

```bash
npm install
```

### 2) Generate secrets

```bash
npm run generate:secrets
```

This prints:

- `TOTP_SECRET_BASE32`
- `SESSION_SECRET`
- provisioning URI for authenticator apps

### 3) Create `.env.local`

```bash
cp .env.example .env.local
```

Fill all required values.

To fetch storage connection string from Azure:

```bash
az storage account show-connection-string \
  --name <storage-account-name> \
  --resource-group <resource-group> \
  --query connectionString -o tsv
```

### 4) Start

```bash
npm run dev
```

App URL: `http://localhost:3000`

## Production Provision + Deploy (Automated)

Script: `scripts/provision-and-deploy-azure.sh`

It creates/configures:

- Resource group
- Storage account
- Private blob container
- Two table storage tables
- Linux App Service plan
- Web App deployment
- App settings (env vars)

Run:

```bash
TOTP_SECRET_BASE32="<from generate:secrets>" \
SESSION_SECRET="<from generate:secrets>" \
TOTP_ACCOUNT_NAME="your-name" \
./scripts/provision-and-deploy-azure.sh
```

Optional overrides:

- `RESOURCE_GROUP`, `LOCATION`, `SKU`, `RUNTIME`
- `SUFFIX`, `STORAGE_ACCOUNT`, `WEBAPP_NAME`, `APP_SERVICE_PLAN`
- `AZURE_BLOB_CONTAINER`, `AZURE_ITEMS_TABLE`, `AZURE_AUTH_TABLE`
- `SESSION_TTL_HOURS`, `AUTH_MAX_ATTEMPTS`, `AUTH_LOCK_MINUTES`, `MAX_UPLOAD_MB`

## Authenticator Enrollment

After deployment, add account in Microsoft Authenticator:

1. Add account
2. Choose `Other account` / TOTP manual setup
3. Enter Issuer, Account, Secret
4. Use generated 6-digit code on login screen

## Deploying App Updates Safely

Recommended flow:

```bash
npm run lint
npm run build
```

Then deploy with your chosen method (`az webapp up` or `az webapp deploy`).

If deploy reports timeout (502/504), check background status:

```bash
az webapp log deployment list -n <webapp> -g <rg> -o table
az webapp log deployment show -n <webapp> -g <rg>
```

## Health/Operational Checks

### App availability

```bash
curl -I https://<webapp>.azurewebsites.net
```

### Auth state API

```bash
curl https://<webapp>.azurewebsites.net/api/auth/state
```

### Restart app

```bash
az webapp restart -n <webapp> -g <rg>
```

## Troubleshooting

### `az login` seems stuck (WSL)

Common fix in WSL: remove stale Azure CLI MSAL HTTP cache file:

- `~/.azure/msal_http_cache.bin`

Then retry device-code login:

```bash
az login --use-device-code
```

### Deployment shows 502/504 from CLI

Usually deploy continues in background. Confirm final deployment status via `az webapp log deployment list`.

### Hydration warning in local dev

Can be caused by browser extensions mutating DOM before React hydration. Test in incognito.

## Secret Rotation Runbook

Rotate immediately if secrets are exposed.

### Rotate TOTP

1. Generate a new `TOTP_SECRET_BASE32`
2. Update Azure app setting
3. Restart web app
4. Re-enroll authenticator app with new secret

### Rotate session signing key

1. Generate new `SESSION_SECRET`
2. Update Azure app setting
3. Restart web app

Note: rotating `SESSION_SECRET` invalidates all active sessions.

## Current Functional Limits

- Max single upload size: controlled by `MAX_UPLOAD_MB` (default 20 MB)
- No app-level total storage cap implemented
- Total retained data depends on Azure Storage usage and subscription/billing limits

## Project Scripts

- `npm run dev`: start local dev server
- `npm run lint`: lint code
- `npm run build`: production build check
- `npm run generate:secrets`: generate TOTP + session secrets
- `npm run provision:azure`: provision/deploy using Azure script

## Important Notes for Handover

- Keep `.env.local` and Azure app settings in sync when debugging env-related issues.
- Never commit `.env.local` or secrets.
- `AZURE_STORAGE_CONNECTION_STRING`, `TOTP_SECRET_BASE32`, and `SESSION_SECRET` are critical secrets.
- Any environment missing these values will fail at runtime.
