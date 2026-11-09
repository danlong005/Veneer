// npm run api:token (node packages/server/dist/apiToken.js in a release): a
// new macro API client token. Give the token to the client system; put the
// sha256 line in the VENEER_API_CLIENTS file. Veneer keeps only the hash.

import { newToken } from './apiClients.ts';

const { token, hash } = newToken();
console.log(`Token, for the client system (shown once; keep it secret):\n  ${token}\n\nFor the VENEER_API_CLIENTS file:\n  "token": "${hash}"`);
