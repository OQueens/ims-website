# Deploy

This site deploys to Cloudflare Pages with custom domain `innovativemedicalstaffing.com`. DNS lives at Namecheap. Pages auto-deploys on push to `main`.

---

## One-time setup

### 1. Cloudflare Pages — connect the repo

1. Sign in or create a Cloudflare account: https://dash.cloudflare.com
2. **Workers & Pages → Create → Pages → Connect to Git**
3. Authorize the GitHub OAuth app for `OQueens` (read-only on this repo is enough)
4. Pick repo `OQueens/ias-website`, branch `main`
5. Build settings (Astro is auto-detected):
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
6. **Save and Deploy.** First build takes ~1-2 minutes. Resulting URL: `https://ias-website.pages.dev` (or similar).
7. Verify the maintenance page renders at the `*.pages.dev` URL.

### 2. Custom domain in Pages

1. In the Pages project → **Custom domains → Set up a custom domain**
2. Enter `innovativemedicalstaffing.com`
3. Cloudflare gives you a CNAME target like `ias-website.pages.dev`. Copy it.
4. Skip the "use Cloudflare DNS" path — we're keeping DNS at Namecheap for v0.

### 3. Namecheap DNS — point the domain

1. Log into https://www.namecheap.com → **Domain List → Manage** on `innovativemedicalstaffing.com`
2. Open the **Advanced DNS** tab
3. **Remove** any existing default URL forwarding / parking records (they will outrank our new ones if left)
4. Add records:

| Type           | Host | Value (paste from Cloudflare) | TTL       |
|----------------|------|-------------------------------|-----------|
| CNAME Record   | www  | `ias-website.pages.dev`       | Automatic |
| ALIAS Record   | @    | `ias-website.pages.dev`       | Automatic |

5. Save.

#### Apex workaround (if Namecheap blocks ALIAS at @)

Two paths:

- **(Easier) Migrate DNS to Cloudflare** — free, supports apex CNAME natively. Add the domain to Cloudflare DNS, copy the two Cloudflare nameservers it gives you, then in Namecheap go to **Domain → Nameservers → Custom DNS** and replace `pdns1.registrar-servers.com` / `pdns2.registrar-servers.com` with the Cloudflare ones. Propagation: 1-24 hours.
- **(Workaround at Namecheap)** Add an A record at `@` pointing to one of Cloudflare Pages' published anycast IPs (Cloudflare lists them in the Pages custom-domain dialog), plus a CNAME for `www`.

### 4. SSL

Cloudflare auto-issues a Universal SSL cert once DNS resolves. Usually 1-5 minutes after the records propagate.

### 5. Verify live

```bash
curl -I https://innovativemedicalstaffing.com
```

Expected:
- `HTTP/2 200`
- Valid TLS handshake (no `--insecure` needed)
- `content-type: text/html; charset=utf-8`

Visit https://innovativemedicalstaffing.com in a browser — the maintenance page should render in dark mode (or follow OS preference).

---

## Pushing changes

Pages auto-deploys on push to `main`. PRs get preview deploy URLs.
