# WayFinder

WayFinder is a set of tools for intelligently routing users to optimal AR.IO gateways, supporting client-side, cryptographic verification of data retrieved from the Arweave network, and ensuring streamlined access to the permaweb.

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
