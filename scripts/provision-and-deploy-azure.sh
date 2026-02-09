#!/usr/bin/env bash
set -euo pipefail

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) not found"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOCATION="${LOCATION:-eastus}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-privy-share}"
SKU="${SKU:-B1}"
RUNTIME="${RUNTIME:-NODE:20-lts}"

SUFFIX="${SUFFIX:-$(openssl rand -hex 3)}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-privy${SUFFIX}}"
WEBAPP_NAME="${WEBAPP_NAME:-privy-share-${SUFFIX}}"
APP_SERVICE_PLAN="${APP_SERVICE_PLAN:-plan-privy-share-${SUFFIX}}"

AZURE_BLOB_CONTAINER="${AZURE_BLOB_CONTAINER:-privy-files}"
AZURE_ITEMS_TABLE="${AZURE_ITEMS_TABLE:-PrivyItems}"
AZURE_AUTH_TABLE="${AZURE_AUTH_TABLE:-PrivyAuth}"

TOTP_ISSUER="${TOTP_ISSUER:-Privy Share}"
TOTP_ACCOUNT_NAME="${TOTP_ACCOUNT_NAME:-owner}"
SESSION_TTL_HOURS="${SESSION_TTL_HOURS:-12}"
AUTH_MAX_ATTEMPTS="${AUTH_MAX_ATTEMPTS:-10}"
AUTH_LOCK_MINUTES="${AUTH_LOCK_MINUTES:-30}"
MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-20}"

if [ -z "${TOTP_SECRET_BASE32:-}" ] || [ -z "${SESSION_SECRET:-}" ]; then
  echo "TOTP_SECRET_BASE32 and SESSION_SECRET are required."
  echo "Run: node scripts/generate-secrets.mjs"
  exit 1
fi

echo "Using:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location: $LOCATION"
echo "  Storage Account: $STORAGE_ACCOUNT"
echo "  App Service Plan: $APP_SERVICE_PLAN"
echo "  Web App: $WEBAPP_NAME"

echo "Creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

echo "Creating storage account..."
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access false >/dev/null

CONNECTION_STRING="$(az storage account show-connection-string --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv)"

echo "Creating blob container and tables..."
az storage container create \
  --name "$AZURE_BLOB_CONTAINER" \
  --connection-string "$CONNECTION_STRING" \
  --public-access off >/dev/null

az storage table create --name "$AZURE_ITEMS_TABLE" --connection-string "$CONNECTION_STRING" >/dev/null
az storage table create --name "$AZURE_AUTH_TABLE" --connection-string "$CONNECTION_STRING" >/dev/null

echo "Creating app service plan..."
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --is-linux \
  --sku "$SKU" >/dev/null

echo "Deploying app source..."
(
  cd "$ROOT_DIR"
  az webapp up \
    --name "$WEBAPP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --plan "$APP_SERVICE_PLAN" \
    --location "$LOCATION" \
    --runtime "$RUNTIME" \
    --track-status false >/dev/null
)

echo "Configuring app settings..."
az webapp config appsettings set \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    AZURE_STORAGE_CONNECTION_STRING="$CONNECTION_STRING" \
    AZURE_BLOB_CONTAINER="$AZURE_BLOB_CONTAINER" \
    AZURE_ITEMS_TABLE="$AZURE_ITEMS_TABLE" \
    AZURE_AUTH_TABLE="$AZURE_AUTH_TABLE" \
    TOTP_SECRET_BASE32="$TOTP_SECRET_BASE32" \
    TOTP_ISSUER="$TOTP_ISSUER" \
    TOTP_ACCOUNT_NAME="$TOTP_ACCOUNT_NAME" \
    SESSION_SECRET="$SESSION_SECRET" \
    SESSION_TTL_HOURS="$SESSION_TTL_HOURS" \
    AUTH_MAX_ATTEMPTS="$AUTH_MAX_ATTEMPTS" \
    AUTH_LOCK_MINUTES="$AUTH_LOCK_MINUTES" \
    MAX_UPLOAD_MB="$MAX_UPLOAD_MB" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    ENABLE_ORYX_BUILD=true >/dev/null

HOSTNAME="$(az webapp show --name "$WEBAPP_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostName -o tsv)"

cat <<SUMMARY

Provisioning and deployment complete.

Web app URL: https://$HOSTNAME
Resource group: $RESOURCE_GROUP
Storage account: $STORAGE_ACCOUNT
Web app: $WEBAPP_NAME

Authenticator setup values:
  Issuer: $TOTP_ISSUER
  Account: $TOTP_ACCOUNT_NAME
  Secret: $TOTP_SECRET_BASE32

Add that secret in Microsoft Authenticator as a TOTP account.
SUMMARY
