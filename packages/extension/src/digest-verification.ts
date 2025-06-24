/**
 * Digest Verification Module
 * Compares x-ar-io-digest headers from multiple gateways to verify content integrity
 */

import { getWayfinderInstance } from './routing';
import { logger } from './utils/logger';

export interface DigestVerificationResult {
  verified: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  digest?: string;
  matchingGateways: number;
  totalGateways: number;
  details: {
    primaryDigest?: string;
    gatewayDigests: Array<{
      gateway: string;
      digest: string | null;
      error?: string;
    }>;
  };
}

/**
 * Verify content by comparing digests from multiple gateways
 */
export async function verifyContentDigest(
  arUrl: string,
  primaryDigest: string | null,
  dataId: string | null,
): Promise<DigestVerificationResult> {
  try {
    logger.info('[DIGEST-VERIFY] Starting digest verification', {
      arUrl,
      primaryDigest: primaryDigest?.substring(0, 16) + '...',
      dataId,
    });

    // If no primary digest, we can't verify
    if (!primaryDigest) {
      return {
        verified: false,
        confidence: 'none',
        matchingGateways: 0,
        totalGateways: 0,
        details: {
          gatewayDigests: [],
        },
      };
    }

    // Get trusted gateways for verification
    const _wayfinder = await getWayfinderInstance();
    const {
      verificationGatewayMode = 'automatic',
      verificationGatewayCount = 3,
      verificationTrustedGateways = [],
      localGatewayAddressRegistry = {},
    } = await chrome.storage.local.get([
      'verificationGatewayMode',
      'verificationGatewayCount',
      'verificationTrustedGateways',
      'localGatewayAddressRegistry',
    ]);

    let trustedGateways: URL[] = [];

    if (verificationGatewayMode === 'automatic') {
      // Get top gateways by stake
      const gateways = Object.entries(localGatewayAddressRegistry)
        .map(([address, gateway]: [string, any]) => ({
          address,
          fqdn: gateway.settings?.fqdn,
          protocol: gateway.settings?.protocol || 'https',
          port: gateway.settings?.port,
          operatorStake: gateway.operatorStake || 0,
          totalDelegatedStake: gateway.totalDelegatedStake || 0,
          status: gateway.status,
        }))
        .filter((gateway) => gateway.status === 'joined' && gateway.fqdn)
        .sort((a, b) => {
          const stakeA = a.operatorStake + a.totalDelegatedStake;
          const stakeB = b.operatorStake + b.totalDelegatedStake;
          return stakeB - stakeA;
        })
        .slice(0, verificationGatewayCount)
        .map((gateway) => {
          const port =
            gateway.port &&
            gateway.port !== (gateway.protocol === 'https' ? 443 : 80)
              ? `:${gateway.port}`
              : '';
          return new URL(`${gateway.protocol}://${gateway.fqdn}${port}`);
        });

      trustedGateways =
        gateways.length > 0 ? gateways : [new URL('https://arweave.net')];
    } else {
      // Manual mode
      trustedGateways = verificationTrustedGateways
        .filter((url: string) => url && url.length > 0)
        .map((url: string) => new URL(url));

      if (trustedGateways.length === 0) {
        trustedGateways = [new URL('https://arweave.net')];
      }
    }

    logger.info(
      '[DIGEST-VERIFY] Using trusted gateways:',
      trustedGateways.map((g) => g.hostname),
    );

    // Query digests from trusted gateways
    const digestPromises = trustedGateways.map(async (gateway) => {
      try {
        // Convert ar:// URL to gateway URL
        const gatewayUrl = arUrl.replace('ar://', `${gateway.origin}/`);

        // Make HEAD request to get digest header
        const response = await fetch(gatewayUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });

        const digest = response.headers.get('x-ar-io-digest');

        return {
          gateway: gateway.hostname,
          digest,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          gateway: gateway.hostname,
          digest: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const gatewayDigests = await Promise.all(digestPromises);

    // Count how many gateways return the same digest
    const matchingGateways = gatewayDigests.filter(
      (gd) => gd.digest && gd.digest === primaryDigest,
    ).length;

    const totalGateways = gatewayDigests.filter((gd) => gd.digest).length;

    // Determine confidence level
    let confidence: 'high' | 'medium' | 'low' | 'none';
    let verified = false;

    if (totalGateways === 0) {
      confidence = 'none';
    } else if (matchingGateways === totalGateways) {
      confidence = 'high';
      verified = true;
    } else if (matchingGateways >= Math.ceil(totalGateways / 2)) {
      confidence = 'medium';
      verified = true;
    } else if (matchingGateways > 0) {
      confidence = 'low';
    } else {
      confidence = 'none';
    }

    logger.info('[DIGEST-VERIFY] Verification result:', {
      verified,
      confidence,
      matchingGateways,
      totalGateways,
    });

    return {
      verified,
      confidence,
      digest: primaryDigest,
      matchingGateways,
      totalGateways,
      details: {
        primaryDigest,
        gatewayDigests,
      },
    };
  } catch (error) {
    logger.error('[DIGEST-VERIFY] Error:', error);
    return {
      verified: false,
      confidence: 'none',
      matchingGateways: 0,
      totalGateways: 0,
      details: {
        gatewayDigests: [],
      },
    };
  }
}

/**
 * Show verification toast in the content page
 */
export function showVerificationToast(
  tabId: number,
  result: DigestVerificationResult,
): void {
  const icon = result.verified
    ? '✓'
    : result.confidence === 'medium'
      ? '⚠️'
      : result.confidence === 'low'
        ? '⚡'
        : '✗';

  const message =
    result.confidence === 'high'
      ? `${icon} Content verified by ${result.matchingGateways} gateways`
      : result.confidence === 'medium'
        ? `${icon} Content partially verified (${result.matchingGateways}/${result.totalGateways} gateways)`
        : result.confidence === 'low'
          ? `${icon} Low confidence verification (${result.matchingGateways}/${result.totalGateways} gateways)`
          : `${icon} Content verification failed`;

  chrome.tabs.executeScript(tabId, {
    code: `
      (function() {
        // Remove any existing toast
        const existingToast = document.getElementById('wayfinder-verification-toast');
        if (existingToast) {
          existingToast.remove();
        }

        // Create new toast
        const toast = document.createElement('div');
        toast.id = 'wayfinder-verification-toast';
        toast.style.cssText = \`
          position: fixed;
          top: 20px;
          right: 20px;
          background: ${result.verified ? '#10b981' : result.confidence === 'medium' ? '#f59e0b' : '#ef4444'};
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          z-index: 2147483647;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          max-width: 350px;
          cursor: pointer;
          animation: slideIn 0.3s ease-out;
        \`;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = \`
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        \`;
        document.head.appendChild(style);
        
        toast.textContent = '${message}';
        toast.title = 'Click for details';
        
        // Click to dismiss
        toast.addEventListener('click', () => {
          toast.style.animation = 'slideOut 0.3s ease-out forwards';
          setTimeout(() => toast.remove(), 300);
        });
        
        // Add slide out animation
        const slideOutStyle = document.createElement('style');
        slideOutStyle.textContent = \`
          @keyframes slideOut {
            from {
              transform: translateX(0);
              opacity: 1;
            }
            to {
              transform: translateX(100%);
              opacity: 0;
            }
          }
        \`;
        document.head.appendChild(slideOutStyle);
        
        document.body.appendChild(toast);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
          if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => {
              if (toast.parentNode) {
                toast.remove();
              }
            }, 300);
          }
        }, 5000);
      })();
    `,
  });
}
