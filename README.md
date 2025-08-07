# Wayfinder

Wayfinder is a set of tools and libraries that enable decentralized and cryptographically verified access to data stored on Arweave via the [AR.IO Network](https://ar.io).

## Packages

This monorepo contains the following packages:

- **[@ar.io/wayfinder-core](./packages/wayfinder-core)** ![npm](https://img.shields.io/npm/v/@ar.io/wayfinder-core.svg)
: Core JavaScript library for the Wayfinder routing and verification protocol
- **[@ar.io/wayfinder-react](./packages/wayfinder-react)** ![npm](https://img.shields.io/npm/v/@ar.io/wayfinder-react.svg)
: React components for Wayfinder, including Hooks and Context provider
- **[@ar.io/wayfinder-extension](./packages/wayfinder-extension)** ![chrome](https://img.shields.io/chrome-web-store/v/hnhmeknhajanolcoihhkkaaimapnmgil?label=chrome)
: Chrome extension for Wayfinder
- **[@ar.io/wayfinder-cli](./packages/cli)** (coming soon)
: CLI for interacting with Wayfinder in the terminal

## What is it?

Wayfinder is a simple, open-source client-side routing and verification protocol for the permaweb. It leverages the [AR.IO Network](https://ar.io) to route users to the most optimal gateway for a given request.

## Who is it for?

- **Builders** who need reliable, decentralized access to Arweave data through the powerful [AR.IO Network](https://ar.io)
- **Browsers** who demand complete control over their permaweb journey with customizable gateways and robust verification settings for enhanced security and reliability
- **Operators** who power the [AR.IO Network](https://ar.io) and want to earn rewards<sup>*</sup> for serving wayfinder traffic to the growing permaweb ecosystem

## Contributing

1. Branch from `alpha`
2. Create a new branch for your changes (e.g. `feat/my-feature`)
3. Make your changes on your branch, push them to your branch
4. As you make commits/changes or once you're ready to release, create a changeset describing your changes via `npx changeset`.
5. Follow the prompts to select the packages that are affected by your changes.
6. Add and commit the changeset to your branch
7. Request review from a maintainer, and once approved, merge your changes into the `alpha` branch
8. A release PR will be automatically created with all pending changesets to the `alpha` branch
9. The maintainer will review the PR and merge it into `alpha`, which will trigger the automated release process using all pending changesets

## Releases

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and package releases.

### Creating a Changeset

To create a changeset when making changes:

```bash
npx changeset
```

This will guide you through the process of documenting your changes and selecting which packages are affected. Changesets will be used during the release process to update package versions and generate changelogs.

### Automated Releases

This repository is configured with GitHub Actions workflows that automate the release process:

- **Main Branch**: When changes are merged to `main`, a standard release is created
- **Alpha Branch**: When changes are merged to `alpha`, a prerelease (alpha tagged) is created

The workflow automatically:
1. Determines whether to create a prerelease or standard release based on the branch
2. Versions packages using changesets
3. Publishes to npm
4. Creates GitHub releases
5. Pushes tags back to the repository

To use the automated process:
1. Create changesets for your changes
2. Push your changes to a feature branch
3. Create a pull request to `alpha` (for prereleases) or `main` (for standard releases)
4. When the PR is merged, the release will be automatically created


### Manual Release Process

If you need to release manually, follow these steps:

#### Alpha Releases

To release a new alpha version:

```bash
npx changeset version
```

3. Review the version changes and changelogs
4. Commit the changes:

```bash
git add .
git commit -m "chore(release): version packages"
```

5. Publish the packages to npm:

```bash
npm run build
npx changeset publish
```

6. Push the changes and tags:

```bash
git push origin main --follow-tags
```

#### Prerelease Mode

For prerelease versions (e.g., beta, alpha):

1. Enter prerelease mode specifying the tag:

```bash
npx changeset pre enter beta
```

2. Create changesets as normal:

```bash
npx changeset
```

3. Version and publish as normal:

```bash
npx changeset version
# Review changes
git add .
git commit -m "chore(release): prerelease version packages"
npm run build
npx changeset publish
git push origin main --follow-tags
```

4. Exit prerelease mode when ready for a stable release:

```bash
npx changeset pre exit
```

5. Follow the normal release process for the stable version.


## Testing

- `yarn test` - runs all tests in all packages (monorepo)

## Linting & Formatting

- `yarn lint:check` - checks for linting errors
- `yarn lint:fix` - fixes linting errors
- `yarn format:check` - checks for formatting errors
- `yarn format:fix` - fixes formatting errors

## Architecture

- Code to interfaces.
- Prefer type safety over runtime safety.
- Prefer composition over inheritance.
- Prefer integration tests over unit tests.

## Advanced Configuration

Here are a few “lego-style” examples showing how existing routing strategies can
be composed to suit different use cases. Each strategy implements
`RoutingStrategy`, so they can be wrapped and combined freely.

### Random + Ping health checks

Pick a random gateway, then verify it responds with a `HEAD` request before
returning it.

```ts
import {
  RandomRoutingStrategy,
  PingRoutingStrategy,
} from "@ar.io/wayfinder-core";

const strategy = new PingRoutingStrategy({
  routingStrategy: new RandomRoutingStrategy(),
  retries: 2,
  timeoutMs: 500,
});
```

### Fastest ping wrapped with a simple cache

Find the lowest-latency gateway and cache the result for five minutes to avoid
constant pings.

```ts
import {
  FastestPingRoutingStrategy,
  SimpleCacheRoutingStrategy,
} from "@ar.io/wayfinder-core";

const strategy = new SimpleCacheRoutingStrategy({
  routingStrategy: new FastestPingRoutingStrategy({ timeoutMs: 500 }),
  ttlSeconds: 300,
});
```

### Preferred gateway with fallback to ping-random

Attempt to use a favorite gateway, but fall back to a ping-checked random choice
if it fails.

```ts
import {
  PreferredWithFallbackRoutingStrategy,
  RandomRoutingStrategy,
  PingRoutingStrategy,
} from "@ar.io/wayfinder-core";

const strategy = new PreferredWithFallbackRoutingStrategy({
  preferredGateway: "https://my-gateway.example",
  fallbackStrategy: new PingRoutingStrategy({
    routingStrategy: new RandomRoutingStrategy(),
  }),
});
```

### Round-robin + ping verification

Cycle through gateways sequentially, checking each one’s health before use.

```ts
import {
  RoundRobinRoutingStrategy,
  PingRoutingStrategy,
} from "@ar.io/wayfinder-core";

const strategy = new PingRoutingStrategy({
  routingStrategy: new RoundRobinRoutingStrategy({
    gateways: [new URL("https://gw1"), new URL("https://gw2")],
  }),
});
```

### Cache around any composed strategy

Because `SimpleCacheRoutingStrategy` accepts any `RoutingStrategy`, you can
cache more complex compositions too.

```ts
const pingRandom = new PingRoutingStrategy({
  routingStrategy: new RandomRoutingStrategy(),
});

const cachedStrategy = new SimpleCacheRoutingStrategy({
  routingStrategy: pingRandom,
  ttlSeconds: 600,
});
```

In all cases, you can supply the composed strategy to `Wayfinder` (or whatever
router factory you use) and pass in a gateways provider:

```ts
import { Wayfinder, StaticGatewaysProvider } from "@ar.io/wayfinder-core";

const router = new Wayfinder({
  gatewaysProvider: new StaticGatewaysProvider({
    gateways: [new URL("https://gw1"), new URL("https://gw2")],
  }),
  routingStrategy: strategy, // any of the compositions above
});
```
