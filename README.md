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
- **[@ar.io/wayfinder-cli](./experimental/wayfinder-cli)** ![npm](https://img.shields.io/npm/v/@ar.io/wayfinder-cli.svg)
: Fast and user-friendly CLI for fetching files via wayfinder

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
