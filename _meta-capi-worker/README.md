# Meta Conversions API — setup

The website is static (GitHub Pages), so it can't safely hold Meta's access
token. This small Cloudflare Worker (free plan is plenty) receives events
from the site and forwards them to Meta with the token kept secret.

This folder starts with `_`, so GitHub Pages doesn't publish it.

## 1. Get your IDs from Meta

1. Events Manager → **Connect data sources → Web** → create a dataset (Pixel).
   Copy the **Pixel ID**.
2. In that dataset: **Settings → Conversions API → Generate access token**.
   Copy the token and keep it private.

## 2. Deploy the worker

```bash
cd _meta-capi-worker
npx wrangler login
# put the Pixel ID into wrangler.toml (PIXEL_ID = "...")
npx wrangler secret put META_ACCESS_TOKEN    # paste the token when asked
npx wrangler deploy
```

`deploy` prints a URL like `https://ek-meta-capi.<you>.workers.dev`.

## 3. Turn it on in the site

In `/meta.js` at the top of the repo, set:

```js
var PIXEL_ID = 'your pixel id';
var CAPI_ENDPOINT = 'https://ek-meta-capi.<you>.workers.dev';
```

Commit and push. The site loads the Pixel only when `PIXEL_ID` is filled in.

## 4. Test

1. Events Manager → your dataset → **Test events**, and copy the test code.
2. Uncomment `TEST_EVENT_CODE` in `wrangler.toml`, paste the code, and run `npx wrangler deploy`.
3. Open everkindhc.com, tap the phone number, and send a test form.
   You should see PageView, Contact and Lead, each from both
   **Browser** and **Server**, marked as deduplicated.
4. Remove `TEST_EVENT_CODE` and deploy again.

## Events

| Event    | When                                   |
| -------- | -------------------------------------- |
| PageView | Any page loads                         |
| Lead     | A care request form sends successfully |
| Contact  | A visitor taps a phone number          |

What's sent for a Lead: SHA-256-hashed email, phone and city, plus Meta's
`_fbp`/`_fbc` cookies, IP and browser. The name and the "care needs" text
are never sent.
