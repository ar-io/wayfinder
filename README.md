# WayFinder

WayFinder is a set of tools and libraries that enable decentralized and cryptographically verified access to data stored on Arweave leveraging the [AR.IO Network](https://ar.io) via the Wayfinder protocol.

## Packages

This monorepo contains the following packages:

- **[@ar.io/wayfinder-core](./packages/core)**: Core JavaScript library for the Wayfinder routing and verification protocol
- **[@ar.io/wayfinder-react](./packages/react)**: React components for WayFinder, including Hooks and Context provider
- **[@ar.io/wayfinder-extension](./packages/extension)**: Chrome extension for WayFinder
- **[@ar.io/wayfinder-cli](./packages/cli)**: CLI for interacting with Wayfinder in the terminal

## What is it?

WayFinder (beta) is a simple, open-source client-side routing and verification protocol for the permaweb. It is designed to leverage the [ar.io network](https://ar.io) to route users to the most optimal gateway for a given request.

## Who is it built for?

- Anyone who wants to browse the Permaweb. Since no wallet is required, the user does not need to have ever touched tokens or uploaded data.
- Developers who want to integrate ar:// protocol. Wayfinder allows developers to retrieve data from Arweave via the [ar.io network], ensuring decentralized access to all assets of your permaweb app.

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
- **Alpha Branch**: When changes are merged to `alpha`, a prerelease (beta tagged) is created

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

#### Normal Releases

To release a new version:

1. Ensure all changes are documented with changesets
2. Run the version command to update package versions and changelogs:

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
