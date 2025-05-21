/**
 * AR.IO Gateway
 * Copyright (C) 2022-2023 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import {
	ARIO,
	AOProcess,
	Wayfinder,
	AoARIORead,
	NetworkGatewaysProvider,
	Logger,
	RandomRoutingStrategy,
	StaticRoutingStrategy,
	FastestPingRoutingStrategy,
	RoutingStrategy,
} from '@ar.io/sdk/web';
import {
	backgroundGatewayBenchmarking,
	isKnownGateway,
	saveToHistory,
	updateGatewayPerformance,
} from './helpers';
import { ARIO_MAINNET_PROCESS_ID, DEFAULT_AO_CU_URL } from './constants';
import { RedirectedTabInfo } from './types';
import { connect } from '@permaweb/aoconnect';

// set the log level of wayfinder to debug
Logger.default.setLogLevel('debug')

// Global variables
const redirectedTabs: Record<number, RedirectedTabInfo> = {};
const requestTimings = new Map<string, number>();

console.log('🚀 Initializing AR.IO...');
let ario = ARIO.mainnet();
console.log('🚀 AR.IO initialized with Process ID:', ario);

// TODO: implement a custom gateways provider that uses chrome storage to cache the gateways
let gatewaysProvider = new NetworkGatewaysProvider({
	ario,
});
let wayfinder = new Wayfinder({
	routingStrategy: getRouterFromStrategy({ strategy: 'topFiveOperatorStake' }),
});

export const getArio = () => ario;
export const getWayfinder = () => wayfinder;
export const getGatewaysProvider = () => gatewaysProvider;
// Set default values in Chrome storage
chrome.storage.local.set({
	routingStrategy: 'topFiveOperatorStake',
	localGatewayAddressRegistry: {},
	blacklistedGateways: [],
	processId: ARIO_MAINNET_PROCESS_ID,
	aoCuUrl: DEFAULT_AO_CU_URL,
	ensResolutionEnabled: true,
});

// Ensure we sync the registry before running benchmarking
async function initializeWayfinder() {
	console.log('🔄 Initializing Wayfinder...');
	await syncGatewayAddressRegistry({
		ario,
	}); // **Wait for GAR sync to complete**
	await backgroundGatewayBenchmarking(); // **Benchmark after GAR is ready**
}

initializeWayfinder().catch((err) =>
	console.error('🚨 Error during Wayfinder initialization:', err),
);

/**
 * Handles browser navigation for `ar://` links.
 */
chrome.webNavigation.onBeforeNavigate.addListener(
	(details) => {
		setTimeout(async () => {
			try {
				const redirectTo = await getWayfinder().resolveUrl({
					originalUrl: details.url,
				});

				// alert('Redirecting to: ' + redirectTo.toString());

				// modify the performance router to track response times
				if (redirectTo) {
					const startTime = performance.now();
					chrome.tabs.update(details.tabId, { url: redirectTo.toString() });

					// ✅ Track that this tab was redirected, but don't update performance yet
					redirectedTabs[details.tabId] = {
						originalGateway: redirectTo.hostname,
						expectedSandboxRedirect: /^[a-z0-9_-]{43}$/i.test(details.url.slice(5)), // True if it's a TxId
						startTime,
					};
				}
			} catch (error) {
				console.error('❌ Error processing ar:// navigation:', error);
			}
		}, 0); // 🔥 Defer execution to avoid blocking listener thread
	},
	{ url: [{ schemes: ['http', 'https'] }] },
);

/**
 * Tracks request start time.
 */
chrome.webRequest.onBeforeRequest.addListener(
	(details) => {
		requestTimings.set(details.requestId, performance.now());
	},
	{ urls: ['<all_urls>'] },
);

/**
 * Tracks successful gateway requests for performance metrics.
 */
chrome.webRequest.onCompleted.addListener(
	async (details) => {
		const gatewayFQDN = new URL(details.url).hostname;

		// ✅ Ignore non-ar:// navigation
		if (!redirectedTabs[details.tabId]) return;

		// ✅ Only track requests if they originated from an `ar://` redirection
		if (!(await isKnownGateway(gatewayFQDN))) return;

		const startTime = redirectedTabs[details.tabId].startTime;
		if (!startTime) return;

		// ✅ Cleanup tracking after use
		delete redirectedTabs[details.tabId];

		// ✅ Update performance metrics
		await updateGatewayPerformance(gatewayFQDN, startTime);
	},
	{ urls: ['<all_urls>'] },
);

/**
 * Tracks ArNS resolution responses.
 */
chrome.webRequest.onHeadersReceived.addListener(
	(details) => {
		const tabInfo = redirectedTabs[details.tabId];

		if (tabInfo) {
			for (const header of details.responseHeaders || []) {
				if (header.name.toLowerCase() === 'x-arns-resolved-id') {
					const timestamp = new Date().toISOString();
					saveToHistory(details.url, header.value || 'undefined', timestamp);
					break;
				}
			}

			// 🔥 Always remove tracking for this tab, regardless of headers
			delete redirectedTabs[details.tabId];
		}
	},
	{ urls: ['<all_urls>'] },
	['responseHeaders'],
);

/**
 * Handles failed gateway requests.
 */
/**
 * Handles failed gateway requests.
 */
chrome.webRequest.onErrorOccurred.addListener(
	async (details) => {
		// ✅ Ignore background benchmark failures to avoid double counting
		if (redirectedTabs[details.tabId]) return;

		const gatewayFQDN = new URL(details.url).hostname;
		if (!(await isKnownGateway(gatewayFQDN))) return;

		const { gatewayPerformance = {} } = await chrome.storage.local.get([
			'gatewayPerformance',
		]);

		if (!gatewayPerformance[gatewayFQDN]) {
			gatewayPerformance[gatewayFQDN] = {
				responseTimes: [],
				failures: 0,
				successCount: 0,
			};
		}

		gatewayPerformance[gatewayFQDN].failures += 1;

		await chrome.storage.local.set({ gatewayPerformance });
	},
	{ urls: ['<all_urls>'] },
);

/**
 * Periodically cleans up requestTimings to prevent memory leaks.
 */
setInterval(() => {
	const now = performance.now();
	for (const [requestId, timestamp] of requestTimings.entries()) {
		if (now - timestamp > 60000) {
			requestTimings.delete(requestId); // Remove old requests older than 1 min
		}
	}
}, 30000); // Runs every 30 seconds

/**
 * Handles messages from content scripts for syncing gateway data.
 */
chrome.runtime.onMessage.addListener(async (request, _, sendResponse) => {

	// handle convertArUrlToHttpUrl
	if (request.type === 'convertArUrlToHttpUrl') {
		const arUrl = request.arUrl;
		const redirectTo = await getWayfinder().resolveUrl({ originalUrl: arUrl });
		if (!redirectTo) {
			throw new Error('URL resolution failed, response is invalid');
		}
		sendResponse({ url: redirectTo.toString() }); // ✅ Extract only the URL
		return true; // Keeps the response channel open for async calls
	}

	switch (request.message) {
		case 'syncGatewayAddressRegistry':
			try {
				await syncGatewayAddressRegistry({
					ario,
				})
				backgroundGatewayBenchmarking()
				sendResponse({})
				return true; // ✅ Keeps connection open for async response
			} catch (error) {
				console.error('❌ Failed to sync GAR:', error);
				sendResponse({ error: 'Failed to sync gateway address registry.' });
			}
		case 'setAoCuUrl':
		case 'setArIOProcessId':
		case 'setRoutingStrategy':
			try {
				await reinitializeArIO()
				syncGatewayAddressRegistry({
					ario,
				})
				backgroundGatewayBenchmarking()
				sendResponse({})
				return true; // ✅ Keeps connection open for async response
			} catch (error) {
				console.error('❌ Failed to set new AO CU Url and reinitialize AR.IO:', error);
				sendResponse({
					error: 'Failed to set new AO CU Url and reinitialize AR.IO.',
				});
			}
		default:
			console.error('❌ Unknown message:', request.message);
			return true;
	}
});

/**
 * Fetches and stores the AR.IO Gateway Address Registry.
 */
async function syncGatewayAddressRegistry({
	ario,
}: {
	ario: AoARIORead;
}): Promise<void> {
	try {
		const { processId, aoCuUrl } = await chrome.storage.local.get([
			'processId',
			'aoCuUrl',
		]);

		if (!processId) {
			throw new Error('❌ Process ID missing in local storage.');
		}

		if (!aoCuUrl) {
			throw new Error('❌ AO CU Url missing in local storage.');
		}

		// get all the gateways
		const { items: gateways } = await ario.getGateways({
			limit: 1000,
		});

		// set the gateways to the local storage
		chrome.storage.local.set({
			localGatewayAddressRegistry: gateways,
		});

		// update the router with the new ario
		gatewaysProvider = new NetworkGatewaysProvider({ ario });
	} catch (error) {
		console.error('❌ Error syncing Gateway Address Registry:', error);
	}
}

/**
 * Returns a WayfinderRouter based on the strategy string.
 */
function getRouterFromStrategy({
	strategy,
	staticGateway,
}: { strategy: string, staticGateway?: string | URL }): RoutingStrategy {
	switch (strategy) {
		case 'random':
			return new RandomRoutingStrategy()
		case 'topFiveOperatorStake':
		case 'topFiveDelegateStake':
			return new FastestPingRoutingStrategy({
				timeoutMs: 1000,
			})
		case 'static':
			if (!staticGateway){
				throw new Error('Static gateway must be set')
			}
			const staticGatewayUrl = new URL(staticGateway)
			return new StaticRoutingStrategy({
				gateway: staticGatewayUrl.toString(),
			});
		default:
			throw new Error(`Unknown routing strategy: ${strategy}`);
	}
}

/**
 * Reinitializes AR.IO with updated process ID.
 */
async function reinitializeArIO(): Promise<void> {
	try {
		const { processId, aoCuUrl, routingStrategyString } =
			await chrome.storage?.local?.get([
				'processId',
				'aoCuUrl',
				'routingStrategy',
			]);
		ario = ARIO.init({
			process: new AOProcess({
				processId: processId,
				ao: connect({ MODE: 'legacy', CU_URL: aoCuUrl }),
			}),
		});
		const newRouter = getRouterFromStrategy({	
			strategy: routingStrategyString,
		});
		wayfinder = new Wayfinder({
			routingStrategy: newRouter,
		});
		await chrome.storage?.local?.set({
			routingStrategy: routingStrategyString,
		});
		console.log('🔄 AR.IO reinitialized with Process ID:', processId);
	} catch (error) {
		ario = ARIO.mainnet();
		wayfinder = new Wayfinder({
			routingStrategy: getRouterFromStrategy({ strategy: 'priority' }),
		});
		await chrome.storage?.local?.set({
			routingStrategy: 'priority',
		});
		console.error('❌ Failed to reinitialize AR.IO. Using default.', error);
	} finally {

		// set the processId to the new processId
		await chrome.storage?.local?.set({
			processId: ario.process.processId,
		});
	}
}
