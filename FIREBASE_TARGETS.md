# Firebase project targets

## There is deliberately no `default` alias

`.firebaserc` names exactly one project alias — `staging` — and no `default`.

That is not an omission. With no default, a bare

    firebase deploy

fails with "No project active" instead of quietly resolving to whatever
project the last person selected. Every deploy therefore has to say out loud
which environment it is for:

    firebase deploy --only firestore:rules --project staging          # restoflow-staging
    firebase deploy --only firestore:rules --project <prod-project-id> # production, typed in full

Production is not aliased anywhere in this repository. Deploying to it
requires someone to type the production project id, which is the point: the
irreversible action is the one that costs an extra deliberate keystroke, and
no script can perform it by accident.

## Aliases

| Alias     | Project ID              | What it is                                   |
|-----------|-------------------------|----------------------------------------------|
| `staging` | `restoflow-staging`     | Non-production. Synthetic data only. **Not yet created.** |
| —         | `restaurant-saas-64235` | **Production.** Deliberately unaliased — type it in full or you cannot reach it. |

Production is `restaurant-saas-64235`. The name resembles neither the product
nor the word "production", so it is written here once, plainly, rather than
left for someone to infer under time pressure.

## Before you deploy anything

    firebase use            # prints the active project — check it first
    firebase projects:list  # confirms the staging project exists and you can see it

## What must never cross the line

Staging holds synthetic restaurants, synthetic customers and Paystack TEST
keys. Production data must never be copied into it, and staging credentials
must never appear in a production environment variable. The two environments
share source code and share nothing else.
