# How to set up the GitHub App

GrepDocs links GitHub accounts through a **GitHub App** (not an OAuth App). Users authorize the
app and install it on their account or organization, choosing all repositories or a selected
subset. The app acts on the user's behalf with **user access tokens** that expire after 8 hours
and are renewed with a single-use refresh token (valid 6 months).

Why a GitHub App rather than an OAuth App:

- Permissions are fine-grained (only repository contents + metadata) instead of the `repo` scope,
  which grants full control over every private repository the user can reach.
- The user decides which repositories the app can see, per account or organization.
- Tokens expire and are refreshed, instead of being permanent credentials stored in our database.

Reference: <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app>.

## Register the app

Create one app per environment (e.g. `GrepDocs (dev)` for local development and `GrepDocs` for
production). Callback URLs and installation targets differ, and keeping them separate means a dev
secret can never touch production users.

1. Open <https://github.com/settings/apps> (Settings → Developer settings → GitHub Apps) and click
   **New GitHub App**. To own the app with an organization instead, use the organization's
   Settings → Developer settings → GitHub Apps.
2. Fill in the form:

   | Field | Value |
   | --- | --- |
   | GitHub App name | `GrepDocs (dev)` — must be unique on GitHub, max 34 characters |
   | Homepage URL | The frontend URL, e.g. `http://localhost:3000` in dev |
   | Callback URL | `http://localhost:3000/api/accounts/github/callback` (must match `GITHUB_REDIRECT_URL`) |
   | Expire user authorization tokens | **Checked** (default) — do not opt out |
   | Request user authorization (OAuth) during installation | **Checked** — installing and authorizing become one flow |
   | Enable Device Flow | Unchecked |
   | Setup URL | Leave empty — with the option above checked, users land on the callback URL after installing |
   | Webhook → Active | **Unchecked** for now (push webhooks come later with the sync engine) |
   | Where can this GitHub App be installed? | **Any account** — otherwise only you can install it. *Only on this account* is fine for a private dev app |

3. Under **Permissions**, set only:

   | Permission | Access | Why |
   | --- | --- | --- |
   | Repository → Contents | Read and write | Sync (clone/pull) and committing edits back |
   | Repository → Metadata | Read-only | Mandatory; repo listing and branch info |

   Leave everything else at *No access*. Every extra permission shows up on the install screen and
   makes users (and organization owners) less likely to accept.
4. Click **Create GitHub App**.

## Collect the credentials

On the app's **General** settings page:

1. Copy the **Client ID**.
2. Under **Client secrets**, click **Generate a new client secret** and copy it immediately — it is
   shown only once.
3. Note the app's **slug**: the last path segment of its public page, `https://github.com/apps/<slug>`
   (visible from **Public page** in the app settings). The install link is
   `https://github.com/apps/<slug>/installations/new`.

You do **not** need the App ID or a private key. Those are for installation tokens (the app acting
as itself), which GrepDocs does not use: everything runs on the user's own access token.

Put the values in `src/api/.env`:

```bash
GITHUB_CLIENT_ID=Iv23li...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URL=http://localhost:3000/api/accounts/github/callback
GITHUB_APP_SLUG=grepdocs-dev
```

Never commit `.env`. If the secret leaks, generate a new one and delete the old one on the same
page.

## Install the app on your account

Linking an account only authorizes the app; the app can reach a repository only if it is also
**installed** on the account or organization that owns it.

1. Open `https://github.com/apps/<slug>/installations/new`.
2. Pick your personal account (or an organization).
3. Choose **All repositories** (also covers repositories created later) or **Only select
   repositories**, then **Install**.
4. You can change the selection any time from GitHub → Settings → Applications → Installed GitHub
   Apps → *Configure*.

Organizations: only an **organization owner** can install the app. Members can request it, and the
owner approves the request from the organization's settings.

## Migrating from the old OAuth App

Tokens issued by the previous OAuth App belong to a different client ID and cannot be refreshed,
so every linked GitHub account must be re-linked through the new app.

- Local development: unlink the accounts (`DELETE /api/accounts/{id}`) or remove the
  `external_git_accounts` rows, then link again. Tracked repositories keep their rows;
  `repositories.account_id` is set to `NULL` when an account is deleted, so re-attach them after
  re-linking.
- Once nothing uses it, delete the old OAuth App from <https://github.com/settings/developers>.
  Deleting it revokes every token it issued.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `redirect_uri` mismatch error on GitHub | `GITHUB_REDIRECT_URL` differs from the app's Callback URL (scheme, port, and path must match exactly) |
| Account links but its repository list is empty | The app is authorized but not installed on that account, or installed with *Only select repositories* and none selected |
| A private repository returns `404` | The repository is not included in the installation — add it under *Configure* |
| An organization's repositories are missing | The app is not installed on the organization; an owner must install or approve it |
| Requests fail with "re-link your account" after ~6 months unused | Each refresh issues a new refresh token, but one left unused for 6 months expires; re-link the account |
