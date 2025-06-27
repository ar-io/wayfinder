# Wayfinder

Wayfinder is a set of tools and libraries that enable decentralized and cryptographically verified access to data stored on Arweave via the [AR.IO Network](https://ar.io).

## Packages

This monorepo contains the following packages:

- **[@ar.io/wayfinder-core](./packages/core)**: Core JavaScript library for the Wayfinder routing and verification protocol (ALPHA)
- **[@ar.io/wayfinder-react](./packages/react)**: React components for Wayfinder, including Hooks and Context provider (ALPHA)
- **[@ar.io/wayfinder-extension](./packages/extension)**: Chrome extension for Wayfinder (ALPHA)
- **[@ar.io/wayfinder-cli](./packages/cli)**: CLI for interacting with Wayfinder in the terminal - COMING SOON

## What is it?

Wayfinder is a simple, open-source client-side routing and verification protocol for the permaweb. It leverages the [AR.IO Network](https://ar.io) to route users to the most optimal gateway for a given request.

## Who is it for?

- **Builders** referencing or pulling data from the centralized and overloaded `arweave.net` community gateway. Wayfinder allows developers to retrieve data from Arweave via the [AR.IO Network](https://ar.io), ensuring decentralized access to all assets of your permaweb app.
- **Browsers** using the Permaweb. The Wayfinder extension gives users total control of their browsing experience, without having to interact with tokens or upload data. Configure your preferred gateways, verification settings, and more.
- **Operators** who are part of the [AR.IO Network](https://ar.io). They can configure their gateways to optimally serve wayfinder traffic, and get rewarded for doing so.

## Releases

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and package releases.

### Creating a Changeset

To create a changeset when making changes:

```bash
npx changeset
```

This will guide you through the process of documenting your changes and selecting which packages are affected. Changesets will be used during the release process to update package versions and generate changelogs.

### Contributing

1. Branch from `alpha`
2. Create a new branch for your changes (e.g. `feat/my-feature`)
3. Make your changes on your branch, push them to your branch
4. As you make commits/changes or once you're ready to release, create a changeset describing your changes via `npx changeset`.
5. Follow the prompts to select the packages that are affected by your changes.
6. Add and commit the changeset to your branch
7. Request review from a maintainer, and once approved, merge your changes into the `alpha` branch
8. A release PR will be automatically created with all pending changesets to the `alpha` branch
9. The maintainer will review the PR and merge it into `alpha`, which will trigger the automated release process using all pending changesets

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
