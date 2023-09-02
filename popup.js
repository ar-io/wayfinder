if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',afterDOMLoaded);
} else {
    afterDOMLoaded();
}

async function afterDOMLoaded(){
    const gatewayList = document.getElementById('gatewayList');
    const gatewayListTitle = document.getElementById('gatewayListTitle');
    const gatewayListHeader = document.getElementById('gatewayListHeader');
    const refreshGatewaysBtn = document.getElementById("refreshGateways");
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
            refreshGatewaysBtn.style.display = 'none';
            showGatewaysBtn.innerText = 'Display Gateway Address Registry';
        } else {
            gatewayList.innerHTML = '';
            const { garLocal } = await chrome.storage.local.get(["garLocal"]);
                for (const address in garLocal) {
                    const gateway = garLocal[address];

                    // Create a new element for each gateway
                    const listItem = document.createElement('div');
                    listItem.className = 'gateway';
                    listItem.onclick = function() {
                        console.log ("showing more gateway info")
                        showMoreGatewayInfo(gateway, address);
                    };

                    let onlineStatus = '<span class="offline">✖</span>'
                    if (gateway.online){
                        onlineStatus = '<span class="online">✔</span>'
                    }

                    listItem.innerHTML = `
                        <div class="gateway-header">
                            <span class="gateway-url">${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}</span>
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
            refreshGatewaysBtn.style.display = 'block'
            showGatewaysBtn.innerText = 'Hide Gateway Address Registry';
        }
    });

    refreshGatewaysBtn.addEventListener("click", async function() {
        gatewayList.innerHTML = '';
        const { garLocal } = await chrome.storage.local.get(["garLocal"]);
            for (const address in garLocal) {
                const gateway = garLocal[address];

                // Create a new element for each gateway
                const listItem = document.createElement('div');
                listItem.className = 'gateway';
                listItem.onclick = function() {
                    console.log ("showing more gateway info")
                    showMoreGatewayInfo(gateway, address);
                };

                let onlineStatus = '<span class="offline">✖</span>'
                if (gateway.online){
                    onlineStatus = '<span class="online">✔</span>'
                }

                listItem.innerHTML = `
                    <div class="gateway-header">
                        <span class="gateway-url">${gateway.settings.protocol}://${gateway.settings.fqdn}:${gateway.settings.port}</span>
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

    showHistoryBtn.addEventListener("click", async function() {
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
            showSettingsBtn.innerText = 'Hide';
        } else {
            aboutSection.style.display = 'block'; // show the "about" section
            showGatewaysBtn.style.display = 'block';
            showHistoryBtn.style.display = 'block';
            settingsListTitle.style.display = 'none';
            settingsSection.style.display = "none"; // hide the "settings" sections
            showSettingsBtn.innerText = 'Settings';
        }
    });

    const themeToggle = document.getElementById("themeToggle");
    const body = document.body;
    themeToggle.addEventListener("change", function() {
        const selectedTheme = this.value;
        if (selectedTheme === "dark") {
            body.classList.add("body");
            body.classList.remove("light-mode");
        } else if (selectedTheme === "light") {
            body.classList.add("light-mode");
            body.classList.remove("body");
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
    saveGarCacheURLButton.addEventListener('click', function() {
        const garCacheURL = document.getElementById('garCacheURL').value;
        console.log (garCacheURL)
        if (!result) {
            document.getElementById('garCacheURL').value = ''
        }
    });
}

async function syncGatewayAddressRegistry() {
    return new Promise((resolve, reject) => {
        // TO DO: fix this and handle rejects
        chrome.runtime.sendMessage({message: "syncGatewayAddressRegistry"}, function(response) {
                resolve(response);
        });
    });
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

function showMoreGatewayInfo(gateway, address) {
    const modal = document.getElementById('gatewayModal');
    const propertiesLink = document.getElementById('modal-properties');
    const noteElem = document.getElementById('modal-note');

    propertiesLink.href = `https://viewblock.io/arweave/tx/${gateway.settings.properties}`;
    propertiesLink.textContent = gateway.settings.properties;
    noteElem.textContent = gateway.settings.note;

    modal.style.display = "block";
}

function showMoreGatewayInfo(gateway, address) {
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

    // Display the modal
    modal.style.display = 'block';
}
