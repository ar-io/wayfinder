if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',afterDOMLoaded);
} else {
    afterDOMLoaded();
}

async function afterDOMLoaded(){
    const gatewayList = document.getElementById('gatewayList');
    const gatewayListTitle = document.getElementById('gatewayListTitle');
    const gatewayListHeader = document.getElementById('gatewayListHeader');
    const refreshGateways = document.getElementById("refreshGateways");
    const showGatewaysBtn = document.getElementById('showGateways');
    const showSettingsBtn = document.getElementById('showSettings');
    const aboutSection = document.getElementById('aboutSection');
    const settingsSection = document.getElementById('settingsSection');
    const settingsListTitle = document.getElementById('settingsListTitle');
    const showHistoryBtn = document.getElementById("showHistory");
    const historyList = document.getElementById("historyList");
    const historyListTitle = document.getElementById("historyListTitle");

    showGatewaysBtn.addEventListener('click', async function() {
        if (gatewayList.style.display === 'block') {
            aboutSection.style.display = 'block';
            showSettingsBtn.style.display = 'block';
            showHistoryBtn.style.display = 'block';
            gatewayListHeader.style.display = 'none';
            gatewayListTitle.style.display = 'none';
            gatewayList.style.display = 'none';
            showGatewaysBtn.innerText = 'Gateway Address Registry';
        } else {
            gatewayList.innerHTML = '';
            const { garLocal } = await chrome.storage.local.get(["garLocal"]);
            const sortedGateways = sortGatewaysByStake(garLocal);
            for (const sortedGateway of sortedGateways) {
                const gateway = sortedGateway.data;

                // Create a new element for each gateway
                const listItem = document.createElement('div');
                listItem.className = 'gateway';
                listItem.setAttribute('data-address', sortedGateway.address); // Binding the address to the row

                // Check if the gateway is blacklisted and apply the blacklisted class
                if (await checkIfBlacklisted(sortedGateway.address)) {
                    listItem.classList.add('blacklisted');
                }

                listItem.onclick = async function() {
                    await showMoreGatewayInfo(gateway, sortedGateway.address);
                };

                let onlineStatus = '<span class="offline" title="Gateway is offline">✖</span>'
                if (gateway.online){
                    onlineStatus = '<span class="online" title="Gateway is online">✔</span>'
                }

                listItem.innerHTML = `
                    <div class="gateway-header">
                        <span class="gateway-url" title="Click to see gateway details">${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}</span>
                        <span class="online-status">${onlineStatus}</span>
                    </div>
                    <div class="gateway-info">
                        <span class="operator-stake">Stake: ${gateway.operatorStake}</span>
                    </div>
                `;

                gatewayList.appendChild(listItem);
            }
            document.getElementById('onlineGatewayCount').textContent = (Object.values(garLocal).filter(gateway => gateway.online)).length;
            document.getElementById('totalGatewayCount').textContent = Object.keys(garLocal).length;
            // Close the modal when the close button is clicked
            document.getElementsByClassName('close-btn')[0].onclick = function() {
                document.getElementById('gatewayModal').style.display = "none";
            }

            // Also close the modal if clicked outside the modal content
            window.onclick = function(event) {
                if (event.target == document.getElementById('gatewayModal')) {
                    document.getElementById('gatewayModal').style.display = "none";
                }
            }
            
            showSettingsBtn.style.display = 'none';
            aboutSection.style.display = 'none';  // hide the "about" section
            showHistoryBtn.style.display = 'none';
            showSettingsBtn.style.display = 'hide';
            gatewayListHeader.style.display = 'block';
            gatewayList.style.display = 'block';
            gatewayListTitle.style.display = 'block';
            showGatewaysBtn.innerText = 'Hide Gateway Address Registry';
        }
    });

    refreshGateways.addEventListener("click", async function() {
        gatewayList.innerHTML = '<span class="refreshing-text"></span>';  // use class here
        await syncGatewayAddressRegistry();
        gatewayList.innerHTML = '';
        const { garLocal } = await chrome.storage.local.get(["garLocal"]);
        const sortedGateways = sortGatewaysByStake(garLocal);
        for (const sortedGateway of sortedGateways) {
            const gateway = sortedGateway.data;

            // Create a new element for each gateway
            const listItem = document.createElement('div');
            listItem.className = 'gateway';
            listItem.setAttribute('data-address', sortedGateway.address); // Binding the address to the row

            // Check if the gateway is blacklisted and apply the blacklisted class
            if (await checkIfBlacklisted(sortedGateway.address)) {
                listItem.classList.add('blacklisted');
            }

            listItem.onclick = async function() {
                await showMoreGatewayInfo(gateway, sortedGateway.address);
            };

            let onlineStatus = '<span class="offline" title="Gateway is offline">✖</span>'
            if (gateway.online){
                onlineStatus = '<span class="online" title="Gateway is online">✔</span>'
            }

            listItem.innerHTML = `
                <div class="gateway-header">
                    <span class="gateway-url" title="Click to see gateway details">${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}</span>
                    <span class="online-status">${onlineStatus}</span>
                </div>
                <div class="gateway-info">
                    <span class="operator-stake">Stake: ${gateway.operatorStake}</span>
                </div>
            `;
            gatewayList.appendChild(listItem);
        }
        document.getElementById('onlineGatewayCount').textContent = (Object.values(garLocal).filter(gateway => gateway.online)).length;
        document.getElementById('totalGatewayCount').textContent = Object.keys(garLocal).length;
    });

    showHistoryBtn.addEventListener("click", function() {
        if(historyList.style.display === "none") {
            chrome.storage.local.get("history", function(data) {
                const history = data.history || [];
                historyList.innerHTML = ''; // Clear previous items
                history.forEach(item => {
                    const listItem = document.createElement('li');
                    listItem.innerHTML = `<a href="https://viewblock.io/arweave/tx/${item.resolvedId}" target="_blank">${item.url}</a>${new Date(item.timestamp).toLocaleString()}`;
                    historyList.appendChild(listItem);
                });
                historyList.style.display = 'block';
                historyListTitle.style.display = 'block';
                showHistoryBtn.innerText = 'Hide Usage History';
                showSettingsBtn.style.display = 'none';
                aboutSection.style.display = 'none'; 
                showSettingsBtn.style.display = 'none';
                showGatewaysBtn.style.display = 'none';
            });
        } else {
            historyList.style.display = 'none';
            historyListTitle.style.display = 'none';
            showHistoryBtn.innerText = 'Usage History';
            showSettingsBtn.style.display = 'block';
            aboutSection.style.display = 'block'; 
            showSettingsBtn.style.display = 'block';
            showGatewaysBtn.style.display = 'block';
        }
    });

    showSettingsBtn.addEventListener('click', function() {
        if(settingsSection.style.display === "none") {
            aboutSection.style.display = 'none';  // hide the "about" section
            showGatewaysBtn.style.display = 'none';
            showHistoryBtn.style.display = 'none';
            settingsSection.style.display = "block"; // show the "settings" section
            settingsListTitle.style.display = 'block';
            showSettingsBtn.innerText = 'Hide Settings';
        } else {
            aboutSection.style.display = 'block'; // show the "about" section
            showGatewaysBtn.style.display = 'block';
            showHistoryBtn.style.display = 'block';
            settingsListTitle.style.display = 'none';
            settingsSection.style.display = "none"; // hide the "settings" sections
            showSettingsBtn.innerText = 'Settings';
        }
    });

    const body = document.body;
    const themeToggle = document.getElementById("themeToggle");
    themeToggle.addEventListener("change", function() {
        const selectedTheme = this.value;
        if (selectedTheme === "dark") {
            body.classList.remove("light-mode");
            body.classList.add("body");
        } else if (selectedTheme === "light") {
            body.classList.remove("body");
            body.classList.add("light-mode");
        }
        saveThemeChoice(selectedTheme)
    });
    chrome.storage.local.get('theme', function(data) {
        if (data.theme) {
            document.getElementById('themeToggle').value = data.theme;
            if (data.theme === "dark") {
                body.classList.remove("light-mode");
                body.classList.add("body");
            } else if (data.theme === "light") {
                body.classList.remove("body");
                body.classList.add("light-mode");
            }
        }
    });

    const routingToggle = document.getElementById("routingToggle");
    routingToggle.addEventListener("change", function() {
        const selectedRoutingMethod = this.value;
        saveRoutingMethod(selectedRoutingMethod);
    });

    chrome.storage.local.get('routingMethod', function(data) {
        if (data.routingMethod) {
            document.getElementById('routingToggle').value = data.routingMethod;
        }
    });

    const saveStaticGatewayButton = document.getElementById('saveStaticGateway');
    saveStaticGatewayButton.addEventListener('click', function() {
        const gatewayValue = document.getElementById('staticGateway').value;
        const result = saveStaticGateway(gatewayValue);
        if (!result) {
            document.getElementById('staticGateway').value = ''
        }
    });

    chrome.storage.local.get('staticGateway', function(data) {
        if (data.staticGateway) {
            const staticGatewayUrl = `${data.staticGateway.settings.protocol}://${data.staticGateway.settings.fqdn}:${data.staticGateway.settings.port}/`
            document.getElementById('staticGateway').value = staticGatewayUrl;
        }
    });

    const saveGarCacheURLButton = document.getElementById('saveGarCacheURL');
    saveGarCacheURLButton.addEventListener('click',async function() {
        const garCacheURL = document.getElementById('garCacheURL').value;
        if (garCacheURL === '') {
            const result = saveGarCacheURL(garCacheURL)
            document.getElementById('garCacheURL').value = ''
        } else if (await isValidGarCacheURL(garCacheURL)) {
            const result = saveGarCacheURL(garCacheURL)
        } else {
            document.getElementById('garCacheURL').value = ''
        }
    });

    chrome.storage.local.get('garCacheURL', function(data) {
        if (data.garCacheURL) {
            document.getElementById('garCacheURL').value = data.garCacheURL;
        }
    });
}

async function syncGatewayAddressRegistry() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({message: "syncGatewayAddressRegistry"}, function(response) {
            if (chrome.runtime.lastError) {
                // Handle any error that might occur while sending the message
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}

function saveThemeChoice(inputValue) {
    chrome.storage.local.set({ theme: inputValue }, function() {
        alert(`Theme set to ${inputValue}`);
});
return true;
}

function saveRoutingMethod(inputValue) {
    chrome.storage.local.set({ routingMethod: inputValue }, function() {
        alert(`Routing method set to ${inputValue}`);
    });
    return true;
}

function saveStaticGateway(inputValue) {
    try {
        if (inputValue === '') {
            chrome.storage.local.set({ staticGateway: null })
            alert(`Static gateway removed.  Back to dynamic gateway selection.`);
            return null;
        } else {
            const url = new URL(inputValue);
            const protocol = url.protocol.replace(':', '');  // Removes the trailing colon
            const fqdn = url.hostname;
            let port = url.port;

            if (!port) {
                port = protocol === 'https' ? 443 : 80;  // Default port values based on protocol
            }

            const staticGateway = {
                settings: {
                    protocol,
                    fqdn,
                    port: parseInt(port, 10)
                }
            };

            chrome.storage.local.set({ staticGateway: staticGateway }, function() {
                alert(`Static gateway saved: ${inputValue}`);
            });
            return staticGateway;
        }
    } catch (error) {
        alert(`Invalid URL entered: ${inputValue}`);
    }
}

async function showMoreGatewayInfo(gateway, address) {
    // Get modal elements
    const modal = document.getElementById('gatewayModal');
    const modalUrl = document.getElementById('modal-gateway-url')
    const modalAddress = document.getElementById('modal-gateway-address');
    const modalStake = document.getElementById('modal-stake');
    const modalStatus = document.getElementById('modal-status');
    const modalStart = document.getElementById('modal-start');
    const modalProperties = document.getElementById('modal-properties');
    const modalNote = document.getElementById('modal-note');

    // Assign values from the gateway object to modal elements
    modalUrl.textContent = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}`
    modalUrl.href = `${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}`
    modalAddress.textContent = address.slice(0, 6) + '...'
    modalAddress.href = `https://viewblock.io/arweave/address/${address}`;

    modalStake.textContent = gateway.operatorStake;
    modalStatus.textContent = gateway.status;
    modalStart.textContent = gateway.start; // start block height

    if (gateway.settings.properties) {
        modalProperties.textContent = gateway.settings.properties.slice(0, 6) + '...'
        modalProperties.href = `https://viewblock.io/arweave/tx/${gateway.settings.properties}`;
    } else {
        modalProperties.textContent = 'No properties set';
        modalProperties.removeAttribute('href');  // remove link if no properties
    }

    modalNote.textContent = gateway.settings.note || 'No note provided';

    // Blacklist functionality
    const blacklistButton = document.getElementById('blacklistButton');
        
    // Check if the gateway is already blacklisted
    const isBlacklisted = await checkIfBlacklisted(address);

    if (isBlacklisted) {
        blacklistButton.textContent = 'Unblacklist Gateway';
    } else {
        blacklistButton.textContent = 'Blacklist Gateway';
    }

    // Toggle blacklist status
    blacklistButton.onclick = async function() {
        await toggleBlacklist(address);
        await showMoreGatewayInfo(gateway, address);
    };

    // Display the modal
    modal.style.display = 'block';
}

async function checkIfBlacklisted(address) {
    // Check from local storage or other data source if the gateway is blacklisted
    const { blacklistedGateways = [] } = await chrome.storage.local.get(["blacklistedGateways"]);
    return blacklistedGateways.includes(address);
}

async function toggleBlacklist(address) {
    // Get blacklistedGateways from chrome storage
    let { blacklistedGateways = [] } = await chrome.storage.local.get(["blacklistedGateways"]);
    if (blacklistedGateways.includes(address)) {
        // Removing the address from blacklist
        blacklistedGateways = blacklistedGateways.filter(gatewayAddress => gatewayAddress !== address);
        
        // Find the corresponding row and remove the 'blacklisted' class
        const gatewayRow = document.querySelector(`.gateway[data-address='${address}']`);
        if (gatewayRow) {
            gatewayRow.classList.remove('blacklisted');
        }
    } else {
        // Adding the address to blacklist
        blacklistedGateways.push(address);
        
        // Find the corresponding row and add the 'blacklisted' class
        const gatewayRow = document.querySelector(`.gateway[data-address='${address}']`);
        if (gatewayRow) {
            gatewayRow.classList.add('blacklisted');
        }
    }
    // Set updated blacklistedGateways back to chrome storage
    console.log ("Current black list: ", blacklistedGateways)
    chrome.storage.local.set({blacklistedGateways: blacklistedGateways});
}

function sortGatewaysByStake(gateways) {
    // Convert the object to an array of {address, data} pairs
    const gatewayArray = Object.entries(gateways).map(([address, data]) => ({address, data}));

    // Sort the array based on operatorStake
    const sortedGateways = gatewayArray.sort((a, b) => b.data.operatorStake - a.data.operatorStake);

    return sortedGateways;
}

async function isValidGarCacheURL(url) {
    try {
        // Fetch data from the URL
        const response = await fetch(url);
        // Check if the response is OK and content type is application/json
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
            alert(`Error verifying Gateway Address Registry Cache URL: ${garCacheURL}`);
            return false;
        }

        // Parse the JSON
        const data = await response.json();

        // Check if the JSON has a "gateways" property and it's an array
        if (!data.gateways && !data.state.gateways) {
            alert(`Cannot validate Gateways JSON within this Cache: ${garCacheURL}`);
            return false;
        }

        // Further validation can be done here based on the expected structure of the GAR JSON object
        return true; // URL is a valid GAR cache
    } catch (error) {
        console.error(`Error verifying Gateway Address Registry Cache URL: ${garCacheURL}`);
        console.error(error);
        return false; // URL is invalid or there was an error during verification
    }
}

function saveGarCacheURL(url) {
    if (url === '') {
        chrome.storage.local.set({ garCacheURL: null })
        alert(`GAR Cache URL removed.  Using default GAR Cache.`);
    } else {
        chrome.storage.local.set({ garCacheURL: url })
        alert(`Gateway Address Registry Cache URL set to ${url}`);
    }
    return true;
}