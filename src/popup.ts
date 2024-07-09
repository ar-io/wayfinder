import { mIOToken, AoGateway } from "@ar.io/sdk/web";

// Check if the document is still loading, if not, call the function directly
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", afterPopupDOMLoaded);
} else {
  afterPopupDOMLoaded();
}

// Define the function to be called after the DOM is fully loaded
async function afterPopupDOMLoaded(): Promise<void> {
  const gatewayList = document.getElementById(
    "gatewayList",
  ) as HTMLElement | null;
  const gatewayListTitle = document.getElementById(
    "gatewayListTitle",
  ) as HTMLElement | null;
  const gatewayListHeader = document.getElementById(
    "gatewayListHeader",
  ) as HTMLElement | null;
  const refreshGateways = document.getElementById(
    "refreshGateways",
  ) as HTMLElement | null;
  const showGatewaysBtn = document.getElementById(
    "showGateways",
  ) as HTMLElement | null;
  const showSettingsBtn = document.getElementById(
    "showSettings",
  ) as HTMLElement | null;
  const aboutSection = document.getElementById(
    "aboutSection",
  ) as HTMLElement | null;
  const settingsSection = document.getElementById(
    "settingsSection",
  ) as HTMLElement | null;
  const settingsListTitle = document.getElementById(
    "settingsListTitle",
  ) as HTMLElement | null;
  const showHistoryBtn = document.getElementById(
    "showHistory",
  ) as HTMLElement | null;
  const historyList = document.getElementById(
    "historyList",
  ) as HTMLElement | null;
  const historyListTitle = document.getElementById(
    "historyListTitle",
  ) as HTMLElement | null;
  const themeToggle = document.getElementById(
    "themeToggle",
  ) as HTMLSelectElement | null;
  const routingToggle = document.getElementById(
    "routingToggle",
  ) as HTMLSelectElement | null;
  const saveStaticGatewayButton = document.getElementById(
    "saveStaticGateway",
  ) as HTMLElement | null;
  const saveGarCacheURLButton = document.getElementById(
    "saveGarCacheURL",
  ) as HTMLElement | null;

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
    saveGarCacheURLButton &&
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
        const { enrichedGarCache = {} } =
          await chrome.storage.local.get("enrichedGarCache");
        const sortedGateways = sortGatewaysByStake(enrichedGarCache);
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
            await showMoreGatewayInfo(gateway, sortedGateway.address);
          };

          let onlineStatus =
            '<span class="offline" title="Gateway is offline">✖</span>';
          if (gateway.online) {
            onlineStatus =
              '<span class="online" title="Gateway is online">✔</span>';
          }

          listItem.innerHTML = `
                        <div class="gateway-header">
                            <span class="gateway-url" title="Click to see gateway details">${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}</span>
                            <span class="online-status">${onlineStatus}</span>
                        </div>
                        <div class="gateway-info">
                            <span class="operator-stake">Stake: ${new mIOToken(gateway.operatorStake).toIO()} IO</span>
                        </div>
                    `;

          gatewayList.appendChild(listItem);
        }
        const onlineCount = Object.values(enrichedGarCache).filter(
          (gateway: any) => gateway.online,
        ).length;
        document.getElementById("onlineGatewayCount")!.textContent =
          `${onlineCount}`;
        document.getElementById("totalGatewayCount")!.textContent =
          Object.keys(enrichedGarCache).length.toString();

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
      const { enrichedGarCache } = (await chrome.storage.local.get(
        "enrichedGarCache",
      )) as {
        enrichedGarCache: Record<string, any>;
      };
      const sortedGateways = sortGatewaysByStake(enrichedGarCache);
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
          await showMoreGatewayInfo(gateway, sortedGateway.address);
        };

        let onlineStatus =
          '<span class="offline" title="Gateway is offline">✖</span>';
        if (gateway.online) {
          onlineStatus =
            '<span class="online" title="Gateway is online">✔</span>';
        }

        listItem.innerHTML = `
                    <div class="gateway-header">
                        <span class="gateway-url" title="Click to see gateway details">${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}</span>
                        <span class="online-status">${onlineStatus}</span>
                    </div>
                    <div class="gateway-info">
                        <span class="operator-stake">Stake: ${new mIOToken(gateway.operatorStake).toIO()} IO</span>
                    </div>
                `;
        gatewayList.appendChild(listItem);
      }

      const onlineCount = Object.values(enrichedGarCache).filter(
        (gateway: any) => gateway.online,
      ).length;
      document.getElementById("onlineGatewayCount")!.textContent =
        `${onlineCount}`;
      document.getElementById("totalGatewayCount")!.textContent =
        Object.keys(enrichedGarCache).length.toString();
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
                item.timestamp,
              ).toLocaleString()}`;
              historyList.appendChild(listItem);
            },
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

    saveGarCacheURLButton.addEventListener("click", async function () {
      const garCacheURL = (
        document.getElementById("garCacheURL") as HTMLInputElement
      ).value;
      if (garCacheURL === "") {
        const result = saveGarCacheURL(garCacheURL);
        (document.getElementById("garCacheURL") as HTMLInputElement).value = "";
      } else if (await isValidGarCacheURL(garCacheURL)) {
        const result = saveGarCacheURL(garCacheURL);
      } else {
        (document.getElementById("garCacheURL") as HTMLInputElement).value = "";
      }
    });

    chrome.storage.local.get("garCacheURL", function (data) {
      if (data.garCacheURL) {
        (document.getElementById("garCacheURL") as HTMLInputElement).value =
          data.garCacheURL;
      }
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
      },
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

async function showMoreGatewayInfo(gateway: AoGateway, address: string) {
  // Get modal elements
  const modal = document.getElementById("gatewayModal") as HTMLElement;
  const modalUrl = document.getElementById(
    "modal-gateway-url",
  ) as HTMLAnchorElement;
  const modalORR = document.getElementById("modal-gateway-orr") as HTMLElement;
  const modalGRR = document.getElementById("modal-gateway-grr") as HTMLElement;
  const modalGatewayWallet = document.getElementById(
    "modal-gateway-wallet",
  ) as HTMLAnchorElement;
  const modalObserverWallet = document.getElementById(
    "modal-observer-wallet",
  ) as HTMLAnchorElement;
  const modalStake = document.getElementById("modal-stake") as HTMLElement;
  const modalStatus = document.getElementById("modal-status") as HTMLElement;
  const modalStart = document.getElementById("modal-start") as HTMLElement;
  const modalProperties = document.getElementById(
    "modal-properties",
  ) as HTMLAnchorElement;
  const modalNote = document.getElementById("modal-note") as HTMLElement;

  const orr =
    gateway.stats.prescribedEpochCount > 0
      ? (gateway.stats.observedEpochCount /
          gateway.stats.prescribedEpochCount) *
        100
      : 100;
  // Convert observerRewardRatioWeight to percentage and format to one decimal place
  modalORR.textContent = `${orr}%`;

  const grr = gateway.stats.totalEpochParticipationCount
    ? (gateway.stats.passedEpochCount /
        gateway.stats.totalEpochParticipationCount) *
      100
    : 100;

  // Convert gatewayRewardRatioWeight to percentage and format to one decimal place
  modalGRR.textContent = `${grr}%`;

  // Assign values from the gateway object to modal elements
  modalUrl.textContent = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}`;
  modalUrl.href = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}`;
  modalGatewayWallet.textContent = address.slice(0, 6) + "...";
  modalGatewayWallet.href = `https://viewblock.io/arweave/address/${address}`;

  modalObserverWallet.textContent = gateway.observerAddress.slice(0, 6) + "...";
  modalObserverWallet.href = `https://viewblock.io/arweave/address/${gateway.observerAddress}`;

  modalStake.textContent = `${new mIOToken(gateway.operatorStake).toIO()} IO`;
  modalStatus.textContent = gateway.status;
  modalStart.textContent = `${new Date(gateway.startTimestamp).toLocaleDateString()}`;
  if (gateway.settings.properties) {
    modalProperties.textContent =
      gateway.settings.properties.slice(0, 6) + "...";
    modalProperties.href = `https://viewblock.io/arweave/tx/${gateway.settings.properties}`;
  } else {
    modalProperties.textContent = "No properties set";
    modalProperties.removeAttribute("href"); // remove link if no properties
  }

  modalNote.textContent = gateway.settings.note || "No note provided";

  // Blacklist functionality
  const blacklistButton = document.getElementById(
    "blacklistButton",
  ) as HTMLElement;

  // Check if the gateway is already blacklisted
  const isBlacklisted = await checkIfBlacklisted(address);

  if (isBlacklisted) {
    blacklistButton.textContent = "Unblacklist Gateway";
  } else {
    blacklistButton.textContent = "Blacklist Gateway";
  }

  // Toggle blacklist status
  blacklistButton.onclick = async function () {
    await toggleBlacklist(address);
    await showMoreGatewayInfo(gateway, address);
  };

  // Display the modal
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
      (gatewayAddress: any) => gatewayAddress !== address,
    );

    // Find the corresponding row and remove the 'blacklisted' class
    const gatewayRow = document.querySelector(
      `.gateway[data-address='${address}']`,
    );
    if (gatewayRow) {
      gatewayRow.classList.remove("blacklisted");
    }
  } else {
    // Adding the address to blacklist
    blacklistedGateways.push(address);

    // Find the corresponding row and add the 'blacklisted' class
    const gatewayRow = document.querySelector(
      `.gateway[data-address='${address}']`,
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
  console.log("Gateways before sort: ", gateways);
  // check the length
  if (gateways === undefined || Object.keys(gateways).length === 0) {
    return [];
  }
  // Convert the object to an array of {address, data} pairs
  const gatewayArray = Object.entries(gateways).map(([address, data]) => ({
    address,
    data,
  }));

  // Sort the array based on operatorStake
  const sortedGateways = gatewayArray.sort(
    (a, b) => b.data.operatorStake - a.data.operatorStake,
  );

  return sortedGateways;
}

async function isValidGarCacheURL(url: string | URL | Request) {
  try {
    // Fetch data from the URL
    const response = await fetch(url);
    // Check if the response is OK and content type is application/json
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      alert(`Error verifying Gateway Address Registry Cache URL: ${url}`);
      return false;
    }

    // Parse the JSON
    const data = await response.json();

    // Check if the JSON has a "gateways" property and it's an array
    if (!data.result && data.gateways && !data.state.gateways) {
      alert(`Cannot validate Gateways JSON within this Cache: ${url}`);
      return false;
    }

    // Further validation can be done here based on the expected structure of the GAR JSON object
    return true; // URL is a valid GAR cache
  } catch (error) {
    console.error(`Error verifying Gateway Address Registry Cache URL: ${url}`);
    console.error(error);
    return false; // URL is invalid or there was an error during verification
  }
}

function saveGarCacheURL(url: string) {
  if (url === "") {
    chrome.storage.local.set({ garCacheURL: null });
    alert(`GAR Cache URL removed.  Using default GAR Cache.`);
  } else {
    chrome.storage.local.set({ garCacheURL: url });
    alert(`Gateway Address Registry Cache URL set to ${url}`);
  }
  return true;
}
