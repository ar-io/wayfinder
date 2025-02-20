import { AoGateway } from "@ar.io/sdk/web";
import { ARIO_MAINNET_PROCESS_ID, DEFAULT_AO_CU_URL } from "./constants";
import { isBase64URL } from "./helpers";

// Check if the document is still loading, if not, call the function directly
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", afterPopupDOMLoaded);
} else {
  afterPopupDOMLoaded();
}

// Define the function to be called after the DOM is fully loaded
async function afterPopupDOMLoaded(): Promise<void> {
  const gatewayList = document.getElementById(
    "gatewayList"
  ) as HTMLElement | null;
  const gatewayListTitle = document.getElementById(
    "gatewayListTitle"
  ) as HTMLElement | null;
  const gatewayListHeader = document.getElementById(
    "gatewayListHeader"
  ) as HTMLElement | null;
  const refreshGateways = document.getElementById(
    "refreshGateways"
  ) as HTMLElement | null;
  const showGatewaysBtn = document.getElementById(
    "showGateways"
  ) as HTMLElement | null;
  const showSettingsBtn = document.getElementById(
    "showSettings"
  ) as HTMLElement | null;
  const aboutSection = document.getElementById(
    "aboutSection"
  ) as HTMLElement | null;
  const settingsSection = document.getElementById(
    "settingsSection"
  ) as HTMLElement | null;
  const settingsListTitle = document.getElementById(
    "settingsListTitle"
  ) as HTMLElement | null;
  const showHistoryBtn = document.getElementById(
    "showHistory"
  ) as HTMLElement | null;
  const historyList = document.getElementById(
    "historyList"
  ) as HTMLElement | null;
  const historyListTitle = document.getElementById(
    "historyListTitle"
  ) as HTMLElement | null;
  const themeToggle = document.getElementById(
    "themeToggle"
  ) as HTMLSelectElement | null;
  const routingToggle = document.getElementById(
    "routingToggle"
  ) as HTMLSelectElement | null;
  const saveStaticGatewayButton = document.getElementById(
    "saveStaticGateway"
  ) as HTMLElement | null;
  const saveArIOProcessIdButton = document.getElementById(
    "saveArIOProcessId"
  ) as HTMLElement | null;
  const saveAoCuUrlButton = document.getElementById(
    "saveAoCuUrl"
  ) as HTMLElement | null;
  const ensResolutionToggle = document.getElementById(
    "ensResolutionToggle"
  ) as HTMLInputElement | null;

  if (
    showGatewaysBtn &&
    aboutSection &&
    showSettingsBtn &&
    showHistoryBtn &&
    gatewayListHeader &&
    gatewayListTitle &&
    refreshGateways &&
    historyList &&
    historyListTitle &&
    settingsSection &&
    settingsListTitle &&
    themeToggle &&
    routingToggle &&
    saveStaticGatewayButton &&
    saveArIOProcessIdButton &&
    saveAoCuUrlButton &&
    ensResolutionToggle &&
    gatewayList
  ) {
    showGatewaysBtn.addEventListener("click", async function () {
      if (gatewayList.style.display === "block") {
        aboutSection.style.display = "block";
        showSettingsBtn.style.display = "block";
        showHistoryBtn.style.display = "block";
        gatewayListHeader.style.display = "none";
        gatewayListTitle.style.display = "none";
        gatewayList.style.display = "none";
        showGatewaysBtn.innerText = "Gateway Address Registry";
      } else {
        gatewayList.innerHTML = "";
        const { localGatewayAddressRegistry = {} } =
          await chrome.storage.local.get("localGatewayAddressRegistry");
        const sortedGateways = sortGatewaysByStake(localGatewayAddressRegistry);
        const { gatewayPerformance } = await chrome.storage.local.get([
          "gatewayPerformance",
        ]);
        for (const sortedGateway of sortedGateways) {
          const gateway = sortedGateway.data;

          // Create a new element for each gateway
          const listItem = document.createElement("div");
          listItem.className = "gateway";
          listItem.setAttribute("data-address", sortedGateway.address); // Binding the address to the row

          // Check if the gateway is blacklisted and apply the blacklisted class
          if (await checkIfBlacklisted(sortedGateway.address)) {
            listItem.classList.add("blacklisted");
          }

          listItem.onclick = async function () {
            await showMoreGatewayInfo(
              gateway,
              sortedGateway.address,
              gatewayPerformance
            );
          };
          let onlineStatus =
            '<span class="unknown" title="Gateway status unknown">?</span>';

          const performanceData = gatewayPerformance[gateway.settings?.fqdn];
          if (performanceData) {
            const { avgResponseTime, failures } = performanceData;

            if (failures > 10) {
              onlineStatus =
                '<span class="offline" title="Gateway failed last checks">❌</span>';
            } else if (avgResponseTime !== undefined) {
              if (avgResponseTime <= 150) {
                onlineStatus =
                  '<span class="fastest" title="Fastest gateway">🔥🔥🔥</span>';
              } else if (avgResponseTime <= 500) {
                onlineStatus =
                  '<span class="faster" title="Faster gateway">🔥🔥</span>';
              } else if (avgResponseTime <= 2000) {
                onlineStatus =
                  '<span class="fast" title="Fast gateway">🔥</span>';
              } else if (avgResponseTime <= 5000) {
                onlineStatus =
                  '<span class="slow" title="Moderate gateway">🟡</span>';
              } else {
                onlineStatus =
                  '<span class="slow" title="Slow gateway">🐢</span>';
              }
            }
          }

          const totalStake = Math.floor(
            (gateway.operatorStake + gateway.totalDelegatedStake) / 1000000
          );
          listItem.innerHTML = `
                        <div class="gateway-header">
                            <span class="gateway-url" title="Click to see gateway details">${gateway.settings.fqdn}</span>
                            <span class="online-status">${onlineStatus}</span>
                        </div>
                        <div class="gateway-info">
                            <span class="operator-stake">Total Stake:${totalStake} ARIO</span>
                        </div>
                    `;

          gatewayList.appendChild(listItem);
        }

        const activeCount = Object.values(localGatewayAddressRegistry).filter(
          (gateway: any) => gateway.status === "joined"
        ).length;

        document.getElementById("activeGatewayCount")!.textContent =
          `${activeCount}`;
        document.getElementById("totalGatewayCount")!.textContent = Object.keys(
          localGatewayAddressRegistry
        ).length.toString();

        // Close the modal when the close button is clicked
        (
          document.getElementsByClassName("close-btn")[0] as HTMLElement
        ).onclick = function () {
          (
            document.getElementById("gatewayModal") as HTMLElement
          ).style.display = "none";
        };

        // Also close the modal if clicked outside the modal content
        window.onclick = function (event) {
          if (event.target === document.getElementById("gatewayModal")) {
            (
              document.getElementById("gatewayModal") as HTMLElement
            ).style.display = "none";
          }
        };

        showSettingsBtn.style.display = "none";
        aboutSection.style.display = "none"; // hide the "about" section
        showHistoryBtn.style.display = "none";
        showSettingsBtn.style.display = "hide";
        gatewayListHeader.style.display = "block";
        gatewayList.style.display = "block";
        gatewayListTitle.style.display = "block";
        showGatewaysBtn.innerText = "Hide Gateway Address Registry";
      }
    });

    refreshGateways.addEventListener("click", async function () {
      gatewayList.innerHTML = '<span class="refreshing-text"></span>'; // use class here
      await syncGatewayAddressRegistryPopup();
      gatewayList.innerHTML = "";
      const { localGatewayAddressRegistry } = (await chrome.storage.local.get(
        "localGatewayAddressRegistry"
      )) as {
        localGatewayAddressRegistry: Record<string, any>;
      };
      const sortedGateways = sortGatewaysByStake(localGatewayAddressRegistry);
      const { gatewayPerformance } = await chrome.storage.local.get([
        "gatewayPerformance",
      ]);
      for (const sortedGateway of sortedGateways) {
        const gateway = sortedGateway.data;

        // Create a new element for each gateway
        const listItem = document.createElement("div");
        listItem.className = "gateway";
        listItem.setAttribute("data-address", sortedGateway.address); // Binding the address to the row

        // Check if the gateway is blacklisted and apply the blacklisted class
        if (await checkIfBlacklisted(sortedGateway.address)) {
          listItem.classList.add("blacklisted");
        }

        listItem.onclick = async function () {
          await showMoreGatewayInfo(
            gateway,
            sortedGateway.address,
            gatewayPerformance
          );
        };

        let onlineStatus =
          '<span class="unknown" title="Gateway status unknown">?</span>';

        const performanceData = gatewayPerformance[gateway.settings.fqdn];

        if (performanceData) {
          const { avgResponseTime, failures } = performanceData;

          if (failures > 10) {
            onlineStatus =
              '<span class="offline" title="Gateway failed last checks">❌</span>';
          } else if (avgResponseTime !== undefined) {
            if (avgResponseTime <= 150) {
              onlineStatus =
                '<span class="fastest" title="Fastest gateway">🔥🔥🔥</span>';
            } else if (avgResponseTime <= 500) {
              onlineStatus =
                '<span class="faster" title="Faster gateway">🔥🔥</span>';
            } else if (avgResponseTime <= 2000) {
              onlineStatus =
                '<span class="fast" title="Fast gateway">🔥</span>';
            } else if (avgResponseTime <= 5000) {
              onlineStatus =
                '<span class="slow" title="Moderate gateway">🟡</span>';
            } else {
              onlineStatus =
                '<span class="slow" title="Slow gateway">🐢</span>';
            }
          }
        }

        const totalStake = Math.floor(
          (gateway.operatorStake + gateway.totalDelegatedStake) / 1000000
        );

        listItem.innerHTML = `
                    <div class="gateway-header">
                        <span class="gateway-url" title="Click to see gateway details">${gateway.settings.fqdn}</span>
                        <span class="online-status">${onlineStatus}</span>
                    </div>
                    <div class="gateway-info">
                        <span class="operator-stake">Stake: ${totalStake} ARIO</span>
                    </div>
                `;
        gatewayList.appendChild(listItem);
      }

      const activeCount = Object.values(localGatewayAddressRegistry).filter(
        (gateway: any) => gateway.status === "joined"
      ).length;

      document.getElementById("activeGatewayCount")!.textContent =
        `${activeCount}`;
      document.getElementById("totalGatewayCount")!.textContent = Object.keys(
        localGatewayAddressRegistry
      ).length.toString();
    });

    showHistoryBtn.addEventListener("click", function () {
      if (historyList.style.display === "none") {
        chrome.storage.local.get("history", function (data) {
          const history = data.history || [];
          historyList.innerHTML = ""; // Clear previous items
          history.forEach(
            (item: {
              resolvedId: any;
              url: any;
              timestamp: string | number | Date;
            }) => {
              const listItem = document.createElement("li");
              listItem.innerHTML = `<a href="https://viewblock.io/arweave/tx/${
                item.resolvedId
              }" target="_blank">${item.url}</a>${new Date(
                item.timestamp
              ).toLocaleString()}`;
              historyList.appendChild(listItem);
            }
          );
          historyList.style.display = "block";
          historyListTitle.style.display = "block";
          showHistoryBtn.innerText = "Hide Usage History";
          showSettingsBtn.style.display = "none";
          aboutSection.style.display = "none";
          showSettingsBtn.style.display = "none";
          showGatewaysBtn.style.display = "none";
        });
      } else {
        historyList.style.display = "none";
        historyListTitle.style.display = "none";
        showHistoryBtn.innerText = "Usage History";
        showSettingsBtn.style.display = "block";
        aboutSection.style.display = "block";
        showSettingsBtn.style.display = "block";
        showGatewaysBtn.style.display = "block";
      }
    });

    showSettingsBtn.addEventListener("click", function () {
      if (settingsSection.style.display === "none") {
        aboutSection.style.display = "none"; // hide the "about" section
        showGatewaysBtn.style.display = "none";
        showHistoryBtn.style.display = "none";
        settingsSection.style.display = "block"; // show the "settings" section
        settingsListTitle.style.display = "block";
        showSettingsBtn.innerText = "Hide Settings";
      } else {
        aboutSection.style.display = "block"; // show the "about" section
        showGatewaysBtn.style.display = "block";
        showHistoryBtn.style.display = "block";
        settingsListTitle.style.display = "none";
        settingsSection.style.display = "none"; // hide the "settings" sections
        showSettingsBtn.innerText = "Settings";
      }
    });

    const body = document.body;

    themeToggle.addEventListener("change", function () {
      const selectedTheme = (this as HTMLSelectElement).value;
      if (selectedTheme === "dark") {
        body.classList.remove("light-mode");
        body.classList.add("dark-mode");
      } else if (selectedTheme === "light") {
        body.classList.remove("dark-mode");
        body.classList.add("light-mode");
      }
      saveThemeChoice(selectedTheme);
    });
    chrome.storage.local.get("theme", function (data) {
      if (data.theme) {
        (document.getElementById("themeToggle") as HTMLSelectElement).value =
          data.theme;
        if (data.theme === "dark") {
          body.classList.remove("light-mode");
          body.classList.add("dark-mode");
        } else if (data.theme === "light") {
          body.classList.remove("dark-mode");
          body.classList.add("light-mode");
        }
      }
    });

    routingToggle.addEventListener("change", function () {
      const selectedRoutingMethod = (this as HTMLSelectElement).value;
      saveRoutingMethod(selectedRoutingMethod);
    });

    chrome.storage.local.get("routingMethod", function (data) {
      if (data.routingMethod) {
        (document.getElementById("routingToggle") as HTMLSelectElement).value =
          data.routingMethod;
      }
    });

    saveStaticGatewayButton.addEventListener("click", function () {
      const gatewayValue = (
        document.getElementById("staticGateway") as HTMLInputElement
      ).value;
      const result = saveStaticGateway(gatewayValue);
      if (!result) {
        (document.getElementById("staticGateway") as HTMLInputElement).value =
          "";
      }
    });

    chrome.storage.local.get("staticGateway", function (data) {
      if (data.staticGateway) {
        const staticGatewayUrl = `${data.staticGateway.settings.protocol}://${data.staticGateway.settings.fqdn}:${data.staticGateway.settings.port}/`;
        (document.getElementById("staticGateway") as HTMLInputElement).value =
          staticGatewayUrl;
      }
    });

    saveArIOProcessIdButton.addEventListener("click", async function () {
      const arIOProcessId = (
        document.getElementById("arIOProcessId") as HTMLInputElement
      ).value;
      if (arIOProcessId === "") {
        const result = saveArIOProcessId(ARIO_MAINNET_PROCESS_ID);
        (document.getElementById("arIOProcessId") as HTMLInputElement).value =
          "";
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { message: "setArIOProcessId" },
            function (response) {
              if (chrome.runtime.lastError) {
                // Handle any error that might occur while sending the message
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });
      } else if (isBase64URL(arIOProcessId)) {
        const result = saveArIOProcessId(arIOProcessId);
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { message: "setArIOProcessId" },
            function (response) {
              if (chrome.runtime.lastError) {
                // Handle any error that might occur while sending the message
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });
      } else {
        (document.getElementById("arIOProcessId") as HTMLInputElement).value =
          "";
      }
    });

    chrome.storage.local.get("processId", function (data) {
      if (data.processId) {
        (document.getElementById("arIOProcessId") as HTMLInputElement).value =
          data.processId;
      }
    });

    saveAoCuUrlButton.addEventListener("click", async function () {
      const aoCuUrl = (document.getElementById("aoCuUrl") as HTMLInputElement)
        .value;
      if (aoCuUrl === "") {
        const result = saveAoCuUrl(DEFAULT_AO_CU_URL);
        (document.getElementById("aoCuUrl") as HTMLInputElement).value = "";
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { message: "setAoCuUrl" },
            function (response) {
              if (chrome.runtime.lastError) {
                // Handle any error that might occur while sending the message
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });
      } else {
        const result = saveAoCuUrl(aoCuUrl);
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { message: "setAoCuUrl" },
            function (response) {
              if (chrome.runtime.lastError) {
                // Handle any error that might occur while sending the message
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });
      }
    });

    chrome.storage.local.get("aoCuUrl", function (data) {
      if (data.aoCuUrl) {
        (document.getElementById("aoCuUrl") as HTMLInputElement).value =
          data.aoCuUrl;
      }
    });

    // Listen for toggle changes and save to storage
    ensResolutionToggle.addEventListener("change", () => {
      chrome.storage.local.set({
        ensResolutionEnabled: ensResolutionToggle.checked,
      });
    });

    chrome.storage.local.get(["ensResolutionEnabled"], (data) => {
      ensResolutionToggle.checked = data.ensResolutionEnabled ?? true;
    });
  }
}

async function syncGatewayAddressRegistryPopup() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { message: "syncGatewayAddressRegistry" },
      function (response) {
        if (chrome.runtime.lastError) {
          // Handle any error that might occur while sending the message
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      }
    );
  });
}

function saveThemeChoice(inputValue: any) {
  chrome.storage.local.set({ theme: inputValue }, function () {
    alert(`Theme set to ${inputValue}`);
  });
  return true;
}

function saveRoutingMethod(inputValue: any) {
  chrome.storage.local.set({ routingMethod: inputValue }, function () {
    alert(`Routing method set to ${inputValue}`);
  });
  return true;
}

function saveStaticGateway(inputValue: string | URL) {
  try {
    if (inputValue === "") {
      chrome.storage.local.set({ staticGateway: null });
      alert(`Static gateway removed. Back to dynamic gateway selection.`);
      return null;
    } else {
      const url = new URL(inputValue.toString()); // Ensure inputValue is treated as a string
      const protocol = url.protocol.replace(":", ""); // Removes the trailing colon
      const fqdn = url.hostname;
      let port = url.port;

      if (!port) {
        port = (protocol === "https" ? 443 : 80).toString(); // Default port values based on protocol
      }

      const staticGateway = {
        settings: {
          protocol,
          fqdn,
          port: parseInt(port, 10),
        },
      };

      chrome.storage.local.set({ staticGateway: staticGateway }, function () {
        alert(`Static gateway saved: ${inputValue}`);
      });
      return staticGateway;
    }
  } catch (error) {
    alert(`Invalid URL entered: ${inputValue}`);
  }
}

async function showMoreGatewayInfo(
  gateway: AoGateway,
  address: string,
  gatewayPerformance: any
) {
  // Get modal elements safely
  const modal = document.getElementById("gatewayModal") as HTMLElement;
  if (!modal) {
    console.error("❌ Modal not found.");
    return;
  }

  const modalUrl = document.getElementById(
    "modal-gateway-url"
  ) as HTMLAnchorElement;
  const modalGatewayWallet = document.getElementById(
    "modal-gateway-wallet"
  ) as HTMLAnchorElement;
  const modalTotalStake = document.getElementById(
    "modal-total-stake"
  ) as HTMLElement;
  const modalAverageResponseTime = document.getElementById(
    "modal-gateway-avg-response-time"
  ) as HTMLElement;
  const modalStart = document.getElementById("modal-start") as HTMLElement;
  const modalNote = document.getElementById("modal-note") as HTMLElement;
  const modalGatewayMoreInfo = document.getElementById(
    "modal-gateway-more-info"
  ) as HTMLAnchorElement;
  const blacklistButton = document.getElementById(
    "blacklistButton"
  ) as HTMLElement;

  // Ensure all required elements exist before updating them
  if (
    !modalUrl ||
    !modalGatewayWallet ||
    !modalTotalStake ||
    !modalAverageResponseTime ||
    !modalStart ||
    !modalNote ||
    !modalGatewayMoreInfo ||
    !blacklistButton
  ) {
    console.error(
      "❌ One or more modal elements are missing. Check your HTML structure."
    );
    return;
  }

  // Ensure gateway and its settings exist
  if (!gateway || !gateway.settings || !gateway.stats) {
    console.error("❌ Gateway data is missing or invalid.");
    return;
  }

  // ✅ Assign values to modal elements safely
  const { protocol, fqdn, port, note } = gateway.settings;

  modalUrl.textContent = `${protocol}://${fqdn}`;
  modalUrl.href = `${protocol}://${fqdn}:${port}`;

  modalGatewayWallet.textContent = `${address.slice(0, 6)}...`;
  modalGatewayWallet.href = `https://viewblock.io/arweave/address/${address}`;

  modalGatewayMoreInfo.textContent = "More info";
  modalGatewayMoreInfo.href = `${protocol}://gateways.${fqdn}:${port}/#/gateways/${address}`;

  // ✅ Display Stake Information
  const totalStake = gateway.operatorStake + gateway.totalDelegatedStake;
  modalTotalStake.textContent = `${Math.floor(totalStake / 1000000)} ARIO`;

  const avgResponseTime = gatewayPerformance[fqdn]?.avgResponseTime;
  modalAverageResponseTime.textContent =
    avgResponseTime !== undefined ? `${Math.floor(avgResponseTime)} ms` : "N/A"; // Fallback value if missing

  // ✅ Format and Display Start Date
  modalStart.textContent = new Date(
    gateway.startTimestamp
  ).toLocaleDateString();

  // ✅ Display Note (Handle missing note case)
  modalNote.textContent = note || "No note provided";

  // ✅ Blacklist Functionality
  const isBlacklisted = await checkIfBlacklisted(address);
  blacklistButton.textContent = isBlacklisted
    ? "Unblacklist Gateway"
    : "Blacklist Gateway";

  blacklistButton.onclick = async function () {
    await toggleBlacklist(address);
    await showMoreGatewayInfo(gateway, address, gatewayPerformance);
  };

  // ✅ Show Modal
  modal.style.display = "block";
}

async function checkIfBlacklisted(address: string) {
  // Check from local storage or other data source if the gateway is blacklisted
  const { blacklistedGateways = [] } = await chrome.storage.local.get([
    "blacklistedGateways",
  ]);
  return blacklistedGateways.includes(address);
}

async function toggleBlacklist(address: any) {
  // Get blacklistedGateways from chrome storage
  let { blacklistedGateways = [] } = await chrome.storage.local.get([
    "blacklistedGateways",
  ]);
  if (blacklistedGateways.includes(address)) {
    // Removing the address from blacklist
    blacklistedGateways = blacklistedGateways.filter(
      (gatewayAddress: any) => gatewayAddress !== address
    );

    // Find the corresponding row and remove the 'blacklisted' class
    const gatewayRow = document.querySelector(
      `.gateway[data-address='${address}']`
    );
    if (gatewayRow) {
      gatewayRow.classList.remove("blacklisted");
    }
  } else {
    // Adding the address to blacklist
    blacklistedGateways.push(address);

    // Find the corresponding row and add the 'blacklisted' class
    const gatewayRow = document.querySelector(
      `.gateway[data-address='${address}']`
    );
    if (gatewayRow) {
      gatewayRow.classList.add("blacklisted");
    }
  }
  // Set updated blacklistedGateways back to chrome storage
  console.log("Current black list: ", blacklistedGateways);
  chrome.storage.local.set({ blacklistedGateways: blacklistedGateways });
}

function sortGatewaysByStake(gateways: { [s: string]: any } | ArrayLike<any>) {
  // Check if gateways are valid and not empty
  if (!gateways || Object.keys(gateways).length === 0) {
    return [];
  }

  // Convert the object to an array of { address, data } pairs
  const gatewayArray = Object.entries(gateways).map(([address, data]) => ({
    address,
    data,
  }));

  // Compute total stake (operatorStake + totalDelegatedStake) for sorting
  const getTotalStake = (gateway: any) =>
    (gateway.data.operatorStake || 0) + (gateway.data.totalDelegatedStake || 0);

  // Sort the array based on total stake in descending order
  return gatewayArray.sort((a, b) => getTotalStake(b) - getTotalStake(a));
}

function saveArIOProcessId(processId: string) {
  if (processId === "") {
    chrome.storage.local.set({ processId: ARIO_MAINNET_PROCESS_ID });
    alert(`AR.IO Process ID set back to default.`);
  } else {
    chrome.storage.local.set({ processId: processId });
    alert(`AR.IO Process ID set to ${processId}`);
  }
  return true;
}

function saveAoCuUrl(aoCuUrl: string) {
  if (aoCuUrl === "") {
    chrome.storage.local.set({ aoCuUrl: DEFAULT_AO_CU_URL });
    alert(`AO CU Url set back to default.`);
  } else {
    chrome.storage.local.set({ aoCuUrl: aoCuUrl });
    alert(`AO CU Url set to ${aoCuUrl}`);
  }
  return true;
}
